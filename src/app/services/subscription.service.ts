import { Injectable, computed, inject, signal, effect } from '@angular/core';
import {
  Firestore, addDoc, collection, doc, onSnapshot, query, where, Unsubscribe,
} from '@angular/fire/firestore';
import { Auth, authState, onIdTokenChanged } from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';
import { environment } from '../../environments/environment';
import { TranslationService } from './translation.service';

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

/**
 * Emails here skip all quotas (consultations, photos) and get treated
 * as paid. Keep in sync with ADMIN_EMAILS in functions/src/index.ts —
 * the two projects can't share code. The server is the source of
 * truth for enforcement; this client list only shapes the UI
 * (hides the Subscribe pitch, shows an "admin access" badge).
 */
const ADMIN_EMAILS = new Set<string>([
  'gabrielandresbermudez@gmail.com',
]);

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);
  private readonly translation = inject(TranslationService);

  /** Current active (trialing OR active) subscription, or null. */
  private readonly _subscription = signal<Subscription | null>(null);
  readonly subscription = this._subscription.asReadonly();

  /** Raw subscription-based paid state (used by the effect below). */
  private readonly _subscriptionActive = signal(false);

  /** Server-reported comped-friend status for the current user.
      Populated by `refreshAccessStatus()` after sign-in. */
  private readonly _isComped = signal(false);
  readonly isComped = this._isComped.asReadonly();

  /** Remaining free-tier quotas for today (null = unlimited / not yet
      fetched). Populated alongside isComped on sign-in so components
      (photo-capture, consultation) can show "N left" pre-action. */
  private readonly _photosRemaining = signal<number | null>(null);
  readonly photosRemaining = this._photosRemaining.asReadonly();
  private readonly _consultationsRemaining = signal<number | null>(null);
  readonly consultationsRemaining = this._consultationsRemaining.asReadonly();
  private readonly _photoLimit = signal<number>(8);
  readonly photoLimit = this._photoLimit.asReadonly();
  private readonly _consultationLimit = signal<number>(5);
  readonly consultationLimit = this._consultationLimit.asReadonly();

  /** Decrement the local photosRemaining counter after a successful
      photo analysis. Components call this so UI stays fresh without a
      second round-trip. Server remains the source of truth. */
  decrementPhotosRemaining(newValue: number): void {
    this._photosRemaining.set(Math.max(0, newValue));
  }
  decrementConsultationsRemaining(newValue: number): void {
    this._consultationsRemaining.set(Math.max(0, newValue));
  }

  /** True when the signed-in user's email is on the admin allowlist. */
  readonly isAdmin = computed(() => {
    const email = this.authedUser()?.email;
    return email ? ADMIN_EMAILS.has(email) : false;
  });

  /** True when the user gets paid features for any reason
      (subscription, admin, or comped friend). Server enforcement is
      independent — see functions/src/index.ts. */
  readonly isPaid = computed(() =>
    this.isAdmin() || this._isComped() || this._subscriptionActive(),
  );

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
      if (user) {
        this.watchSubscriptions(user.uid);
        void this.refreshAccessStatus();
      } else {
        this._subscription.set(null);
        this._subscriptionActive.set(false);
        this._isComped.set(false);
        this._photosRemaining.set(null);
        this._consultationsRemaining.set(null);
      }
    });

    // Force an ID-token refresh whenever the subscription status
    // transitions to paid. The Stripe Firebase Extension sets the
    // `stripeRole=paid` custom claim server-side, but clients cache
    // ID tokens for up to an hour — without this refresh, paid users
    // could be told "daily limit reached" on their first consultation
    // after checkout because the token still reads as free-tier.
    let wasPaid = false;
    let lastSubDocChangeAt = 0;
    effect(() => {
      const nowPaid = this.isPaid();
      const sub = this._subscription();
      if (sub) lastSubDocChangeAt = Date.now();
      if (nowPaid && !wasPaid) {
        this.auth.currentUser?.getIdToken(true).catch((err) => {
          console.warn('Failed to refresh ID token after subscription change:', err);
        });
      }
      wasPaid = nowPaid;
    });

    // Defensive signal: if a subscription doc was written but the paid
    // claim hasn't flipped after 10s, the Stripe extension's claim-sync
    // trigger may be lagging or misconfigured. Logs loudly so we notice
    // in Sentry/console without failing the UX — quota calls will hit
    // "free tier" in the meantime, which is a soft degradation.
    effect(() => {
      const sub = this._subscription();
      if (!sub) return;
      const isActive = sub.status === 'trialing' || sub.status === 'active';
      if (!isActive) return;
      const docAgeMs = Date.now() - lastSubDocChangeAt;
      if (docAgeMs < 10_000 || this.isPaid()) return;
      console.warn(
        `[SubscriptionService] subscription doc says ${sub.status} for ${(docAgeMs / 1000).toFixed(1)}s ` +
        `but stripeRole claim is not yet 'paid'. Check the firestore-stripe-payments extension's claim-sync trigger.`,
      );
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
      this._error.set(this.translation.t('subscribe.errorSignInFirst'));
      return;
    }
    if (!priceId) {
      this._error.set(this.translation.t('subscribe.errorNotConfigured'));
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
          const fallback = this.translation.t('subscribe.errorCheckoutFailed');
          this._error.set(data.error.message ?? fallback);
          reject(new Error(data.error.message ?? fallback));
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
  /** Ask the server whether the current user is comped (on the access
      list in Firestore config). Admin status is already known client-
      side from the hard-coded list, so we only fetch this for comped.
      Fire-and-forget — failures just leave `_isComped` at false. */
  private async refreshAccessStatus(): Promise<void> {
    try {
      const callable = httpsCallable<
        undefined,
        {
          admin: boolean;
          comped: boolean;
          photosRemaining: number | null;
          consultationsRemaining: number | null;
          photoLimit: number;
          consultationLimit: number;
        }
      >(this.functions, 'checkAccessStatus');
      const { data } = await callable();
      this._isComped.set(!!data.comped);
      this._photosRemaining.set(data.photosRemaining);
      this._consultationsRemaining.set(data.consultationsRemaining);
      if (typeof data.photoLimit === 'number') this._photoLimit.set(data.photoLimit);
      if (typeof data.consultationLimit === 'number') this._consultationLimit.set(data.consultationLimit);
    } catch (err) {
      console.warn('checkAccessStatus failed; assuming not comped.', err);
      this._isComped.set(false);
    }
  }

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
      const msg = err instanceof Error ? err.message : this.translation.t('subscribe.errorCouldNotOpenPortal');
      this._error.set(msg);
      throw err;
    }
  }

  /** Stripe monthly price ID injected at build time. */
  get priceIdMonthly(): string {
    return environment.stripe?.priceIdMonthly ?? '';
  }

  /** Stripe annual price ID injected at build time. */
  get priceIdAnnual(): string {
    return environment.stripe?.priceIdAnnual ?? '';
  }

  /** True when at least one price is configured (controls whether the
      Subscribe card renders at all). */
  get hasAnyPrice(): boolean {
    return !!(this.priceIdMonthly || this.priceIdAnnual);
  }

  /** $-amount strings for the Subscribe button labels. The raw env
      value carries an English suffix ("/mo", "/yr") that reads wrong in
      Spanish, so we swap the tail for a localized cadence marker when
      the user's language is es-PR. The numeric amount is untranslated
      because pricing is USD regardless of locale. */
  get displayPriceMonthly(): string {
    return this.localizePriceSuffix(environment.stripe?.displayPriceMonthly ?? '', 'monthly');
  }
  get displayPriceAnnual(): string {
    return this.localizePriceSuffix(environment.stripe?.displayPriceAnnual ?? '', 'annual');
  }
  /** Strike-through anchor shown next to the annual price so the savings
      are visible at the same glance. Usually 12× the monthly rate — e.g.
      "$36/yr" when monthly is $3 and annual is $24. Empty string hides
      the strike-through; we never invent an anchor. */
  get displayPriceAnnualAnchor(): string {
    return this.localizePriceSuffix(environment.stripe?.displayPriceAnnualAnchor ?? '', 'annual');
  }

  /** Swap the English "/mo" / "/yr" tail for a locale-appropriate one. */
  private localizePriceSuffix(price: string, cadence: 'monthly' | 'annual'): string {
    if (!price) return price;
    const lang = this.translation.language();
    if (!lang.startsWith('es')) return price;
    const suffix = cadence === 'monthly' ? '/mes' : '/año';
    return price.replace(/\/(mo|yr)$/i, suffix);
  }

  /** Percent saved on annual vs 12× monthly (e.g. 33). 0 hides the badge. */
  get annualSavingsPercent(): number {
    return environment.stripe?.annualSavingsPercent ?? 0;
  }

  /** Optional trial period (days) from env, default none. */
  get trialDays(): number {
    return environment.stripe?.trialDays ?? 0;
  }

  /** Map a Stripe price ID to its cadence so the manage UI can label
      the active subscription correctly. */
  cadenceFor(priceId: string): 'monthly' | 'annual' | 'unknown' {
    if (priceId && priceId === this.priceIdAnnual) return 'annual';
    if (priceId && priceId === this.priceIdMonthly) return 'monthly';
    return 'unknown';
  }

  /** Display string matching the active subscription's cadence, falling
      back to monthly. Used by renewal copy. */
  displayPriceFor(priceId: string): string {
    return this.cadenceFor(priceId) === 'annual'
      ? this.displayPriceAnnual
      : this.displayPriceMonthly;
  }

  private watchSubscriptions(uid: string): void {
    const subsRef = collection(this.firestore, `${CUSTOMERS}/${uid}/subscriptions`);
    // Listen for any non-canceled subscription. The extension flips
    // status to 'canceled' at period end when the user cancels.
    const q = query(subsRef, where('status', 'in', ['trialing', 'active', 'past_due']));
    this.unsubSubscriptions = onSnapshot(q, (snap) => {
      if (snap.empty) {
        this._subscription.set(null);
        this._subscriptionActive.set(false);
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
      this._subscriptionActive.set(sub.status === 'trialing' || sub.status === 'active');
    });
  }

  private teardown(): void {
    if (this.unsubSubscriptions) {
      this.unsubSubscriptions();
      this.unsubSubscriptions = null;
    }
  }
}
