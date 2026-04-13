import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SubscriptionService } from '../../services/subscription.service';

/**
 * Subscribe / Manage-subscription card.
 *
 * Rendered inside the footer (or wherever settings live). Handles
 * three states:
 *   1. Not configured — Stripe price ID not set. Shows nothing. This
 *      is the default until the Firebase Extension is installed and
 *      the price ID is pasted into environment.ts.
 *   2. Not subscribed — shows "Support Macro Log · $X/mo" button.
 *   3. Subscribed (trialing or active) — shows status + "Manage" button.
 *
 * We do NOT gate features behind subscription status yet; this is a
 * voluntary-support surface. Hard gates come in a later PR once there
 * are real subscribers.
 */
@Component({
  selector: 'app-subscribe',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (subs.priceId) {
      <div class="mt-4 specimen px-4 py-3 slide-down">
        <span class="crop-bl"></span><span class="crop-br"></span>
        <div class="flex items-center gap-2 mb-2">
          <span class="stamp-mark" style="transform: rotate(0deg)"
            [style.border-color]="subs.isAdmin() ? 'var(--color-olive)' : ''"
            [style.color]="subs.isAdmin() ? 'var(--color-olive)' : ''">
            {{ subs.isAdmin() ? 'admin' : 'support' }}
          </span>
          <span class="data-label">{{ subs.isAdmin() ? 'access' : (sub() ? 'subscription' : 'pro') }}</span>
        </div>

        @if (subs.isAdmin()) {
          <!-- Admin bypass: all features unlocked, no checkout needed. -->
          <p class="font-sans text-sm text-ink leading-relaxed">
            admin access &mdash; all features unlocked, no subscription required.
          </p>
        } @else if (sub(); as s) {
          <!-- Already subscribed — show status + manage button -->
          <p class="font-sans text-sm text-ink leading-relaxed">
            @if (s.status === 'trialing') {
              on <span class="text-olive">free trial</span> until
              {{ s.trialEndsAt ? (s.trialEndsAt | date: 'MMM d') : 'end of trial' }}.
              then renews at {{ subs.displayPrice }}.
            } @else if (s.status === 'active') {
              <span class="text-olive">active</span>, renews
              {{ s.currentPeriodEnd ? (s.currentPeriodEnd | date: 'MMM d') : 'monthly' }}
              at {{ subs.displayPrice }}.
            } @else if (s.status === 'past_due') {
              <span class="text-blood">payment past due</span> — update your card to keep access.
            }
          </p>
          <div class="mt-2 flex gap-2">
            <button type="button" (click)="manage()"
              [disabled]="busy()"
              aria-label="Manage subscription in Stripe Customer Portal"
              class="tag-btn text-[11px]">
              {{ busy() ? 'opening…' : 'manage' }}
            </button>
          </div>
        } @else {
          <!-- Not subscribed — pitch + subscribe button -->
          <p class="font-sans text-sm text-ink leading-relaxed mb-2">
            Macro Log is built by one person. If it's useful to you, subscribing keeps it running and pays for the AI coach.
          </p>
          <ul class="font-sans text-[13px] text-graphite leading-relaxed mb-3 list-disc list-inside">
            <li>unlimited AI coach consultations</li>
            <li>higher photo-to-macros quota</li>
            <li>apple shortcuts webhook</li>
            <li>automatic weekly reports</li>
          </ul>
          <div class="flex items-center gap-2">
            <button type="button" (click)="subscribe()"
              [disabled]="busy()"
              aria-label="Start subscription checkout"
              class="stamp-btn max-w-xs">
              @if (busy()) {
                starting checkout…
              } @else {
                support &middot; {{ subs.displayPrice }}
                @if (subs.trialDays > 0) { <span class="font-sans text-[11px] normal-case opacity-80 ml-1">({{ subs.trialDays }}-day free trial)</span> }
              }
            </button>
          </div>
        }

        @if (subs.error()) {
          <p class="font-mono text-[11px] text-blood mt-2">✕ {{ subs.error() }}</p>
        }
      </div>
    }
  `,
})
export class SubscribeComponent {
  protected readonly subs = inject(SubscriptionService);
  protected readonly busy = signal(false);
  protected readonly sub = computed(() => this.subs.subscription());

  protected async subscribe(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.subs.startCheckout(this.subs.priceId, this.subs.trialDays);
    } finally {
      // If redirect succeeded we never get here; otherwise re-enable.
      this.busy.set(false);
    }
  }

  protected async manage(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.subs.openCustomerPortal();
    } finally {
      this.busy.set(false);
    }
  }
}
