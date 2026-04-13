import { Injectable, inject, signal, effect } from '@angular/core';
import {
  Firestore, addDoc, collection, doc, onSnapshot, query, where, Unsubscribe,
} from '@angular/fire/firestore';
import { Auth, authState, onIdTokenChanged } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { environment } from '../../environments/environment';

/**
 * Subscription record as written by the Firebase Extension. We only
 * need enough fields to decide whether to show "Subscribe" vs
 * "Manage subscription" and surface trial/renewal info.
 */
export interface Subscription {
  id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused';
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  priceId: string;
}

type CheckoutSessionDoc = {
  url?: string;
  error?: { message?: string };
};

/**
 * Thin wrapper over the @invertase/firestore-stripe-payments Firebase
 * Extension. We do not depend on @invertase/firestore-stripe-payments
 * (the JS SDK wrapper) — we talk to the same Firestore collections
 * directly, which is simpler and avoids another dep.
 *
 * The extension must be installed as instance id
 *   `firestore-stripe-payments`
 * with the default collection names (`customers`, `products`). If the
 * installer picks different names or an instance id, update the
 * constants below.
 */
const CUSTOMERS = 'customers';
const EXTENSION_INSTANCE = 'firestore-stripe-payments';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);

  /** Current active (trialing OR active) subscription, or null. */
  private readonly _subscription = signal<Subscription | null>(null);
  readonly subscription = this._subscription.asReadonly();

  /** True when the user has any non-lapsed subscription (trialing or active). */
  readonly isPaid = signal(false);

  /** Non-fatal UI-facing error (e.g. checkout failed). */
  private readonly _error = signal<string | null>(null);
  readonly error = this._error.asReadonly();

  private authedUser = toSignal(authState(this.auth));
  private unsubSubscriptions: Unsubscribe | null = null;

  constructor() {
    // Whenever the user signs in/out, tear down the old listener and
    // open a new one for that user's subscriptions subcollection.
    effect(() => {
      const user = this.authedUser();
      this.teardown();
      if (user) this.watchSubscriptions(user.uid);
      else {
        this._subscription.set(null);
        this.isPaid.set(false);
      }
    });
  }

  /**
   * Start a Stripe Checkout flow for the given price ID. Redirects the
   * current tab to Stripe's hosted Checkout page. After completion,
   * Stripe redirects back to success_url or cancel_url.
   *
   * @param priceId Stripe price ID — usually from environment.stripe.priceId
   * @param trialDays Optional trial period (e.g. 7 for 7-day free trial)
   */
  async startCheckout(priceId: string, trialDays?: number): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      this._error.set('Sign in first to subscribe.');
      return;
    }
    if (!priceId) {
      this._error.set('Subscription is not configured yet — missing Stripe price ID.');
      return;
    }
    this._error.set(null);

    // The extension watches this subcollection. When we add a doc with
    // `price`, it creates a Stripe Checkout Session and writes back
    // `url` (to redirect to) or `error`.
    const ref = collection(this.firestore, `${CUSTOMERS}/${user.uid}/checkout_sessions`);
    const payload: Record<string, unknown> = {
      price: priceId,
      allow_promotion_codes: true,
      success_url: window.location.origin,
      cancel_url: window.location.origin,
    };
    if (trialDays && trialDays > 0) {
      payload['trial_period_days'] = trialDays;
    }

    const docRef = await addDoc(ref, payload);

    // Poll for the result via onSnapshot.
    await new Promise<void>((resolve, reject) => {
      const unsub = onSnapshot(docRef, (snap) => {
        const data = snap.data() as CheckoutSessionDoc | undefined;
        if (!data) return;
        if (data.error) {
          unsub();
          this._error.set(data.error.message ?? 'Checkout failed.');
          reject(new Error(data.error.message ?? 'Checkout failed.'));
        } else if (data.url) {
          unsub();
          window.location.assign(data.url);
          resolve();
        }
      });
    });
  }

  /**
   * Redirect to the Stripe Customer Portal where the user can cancel,
   * swap card, view invoices, etc. Returns to the app afterward.
   */
  async openCustomerPortal(): Promise<void> {
    const callable = httpsCallable<
      { returnUrl: string; locale?: string },
      { url: string }
    >(this.functions, `ext-${EXTENSION_INSTANCE}-createPortalLink`);
    try {
      this._error.set(null);
      const { data } = await callable({
        returnUrl: window.location.origin,
        locale: 'auto',
      });
      window.location.assign(data.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not open subscription manager.';
      this._error.set(msg);
      throw err;
    }
  }

  /** Stripe price ID injected at build time via environment. */
  get priceId(): string {
    return environment.stripe?.priceId ?? '';
  }

  /** $-amount string for the Subscribe button label. */
  get displayPrice(): string {
    return environment.stripe?.displayPrice ?? '';
  }

  /** Optional trial period (days) from env, default none. */
  get trialDays(): number {
    return environment.stripe?.trialDays ?? 0;
  }

  private watchSubscriptions(uid: string): void {
    const subsRef = collection(this.firestore, `${CUSTOMERS}/${uid}/subscriptions`);
    // Listen for any non-canceled subscription. The extension flips
    // status to 'canceled' at period end when the user cancels.
    const q = query(subsRef, where('status', 'in', ['trialing', 'active', 'past_due']));
    this.unsubSubscriptions = onSnapshot(q, (snap) => {
      if (snap.empty) {
        this._subscription.set(null);
        this.isPaid.set(false);
        return;
      }
      const d = snap.docs[0];
      const data = d.data() as Record<string, any>;
      const sub: Subscription = {
        id: d.id,
        status: data['status'] as Subscription['status'],
        trialEndsAt: data['trial_end']?.toDate?.() ?? null,
        currentPeriodEnd: data['current_period_end']?.toDate?.() ?? null,
        priceId: (data['price']?.id as string) ?? '',
      };
      this._subscription.set(sub);
      this.isPaid.set(sub.status === 'trialing' || sub.status === 'active');
    });
  }

  private teardown(): void {
    if (this.unsubSubscriptions) {
      this.unsubSubscriptions();
      this.unsubSubscriptions = null;
    }
  }
}
