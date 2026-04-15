import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslocoDirective } from '@jsverse/transloco';
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
  imports: [DatePipe, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (subs.priceId) {
      <div class="mt-4 specimen px-4 py-3 slide-down">
        <span class="crop-bl"></span><span class="crop-br"></span>
        <div class="flex items-center gap-2 mb-2">
          <span class="stamp-mark" style="transform: rotate(0deg)"
            [style.border-color]="subs.isAdmin() || subs.isComped() ? 'var(--color-olive)' : ''"
            [style.color]="subs.isAdmin() || subs.isComped() ? 'var(--color-olive)' : ''">
            {{ subs.isAdmin() ? t('subscribe.stampAdmin') : subs.isComped() ? t('subscribe.stampFriend') : t('subscribe.stampSupport') }}
          </span>
          <span class="data-label">
            {{ subs.isAdmin() ? t('subscribe.access') : subs.isComped() ? t('subscribe.access') : (sub() ? t('subscribe.subscription') : t('subscribe.pro')) }}
          </span>
        </div>

        @if (subs.isAdmin()) {
          <!-- Admin bypass: all features unlocked, no checkout needed. -->
          <p class="font-sans text-sm text-ink leading-relaxed">
            {{ t('subscribe.adminBody') }}
          </p>
        } @else if (subs.isComped()) {
          <!-- Comped friend: same outcome as paid, different framing. -->
          <p class="font-sans text-sm text-ink leading-relaxed">
            {{ t('subscribe.compedBody') }}
          </p>
        } @else if (sub(); as s) {
          <!-- Already subscribed — show status + manage button -->
          <p class="font-sans text-sm text-ink leading-relaxed">
            @if (s.status === 'trialing') {
              {{ t('subscribe.trialOn') }} <span class="text-olive">{{ t('subscribe.freeTrial') }}</span> {{ t('subscribe.until') }}
              {{ s.trialEndsAt ? (s.trialEndsAt | date: 'MMM d') : t('subscribe.endOfTrial') }}.
              {{ t('subscribe.thenRenewsAt', { price: subs.displayPrice }) }}
            } @else if (s.status === 'active') {
              <span class="text-olive">{{ t('subscribe.active') }}</span>{{ s.currentPeriodEnd
                ? t('subscribe.renewsAt', { date: (s.currentPeriodEnd | date: 'MMM d'), price: subs.displayPrice })
                : t('subscribe.renewsMonthly', { price: subs.displayPrice }) }}
            } @else if (s.status === 'past_due') {
              <span class="text-blood">{{ t('subscribe.paymentPastDue') }}</span> {{ t('subscribe.paymentPastDueSuffix') }}
            }
          </p>
          <div class="mt-2 flex gap-2">
            <button type="button" (click)="manage()"
              [disabled]="busy()"
              [attr.aria-label]="t('subscribe.manageAria')"
              class="tag-btn text-[11px]">
              {{ busy() ? t('subscribe.opening') : t('subscribe.manage') }}
            </button>
          </div>
        } @else {
          <!-- Not subscribed — pitch + subscribe button -->
          <p class="font-sans text-sm text-ink leading-relaxed mb-2">
            {{ t('subscribe.pitchBody') }}
          </p>
          <ul class="font-sans text-[13px] text-graphite leading-relaxed mb-3 list-disc list-inside">
            <li>{{ t('subscribe.featureConsultations') }}</li>
            <li>{{ t('subscribe.featurePhoto') }}</li>
            <li>{{ t('subscribe.featureWebhook') }}</li>
            <li>{{ t('subscribe.featureReports') }}</li>
          </ul>
          <div class="flex items-center gap-2">
            <button type="button" (click)="subscribe()"
              [disabled]="busy()"
              [attr.aria-label]="t('subscribe.subscribeAria')"
              class="stamp-btn max-w-xs">
              @if (busy()) {
                {{ t('subscribe.startingCheckout') }}
              } @else {
                {{ t('subscribe.support') }} &middot; {{ subs.displayPrice }}
                @if (subs.trialDays > 0) { <span class="font-sans text-[11px] normal-case opacity-80 ml-1">{{ t('subscribe.trialHint', { n: subs.trialDays }) }}</span> }
              }
            </button>
          </div>
        }

        @if (subs.error()) {
          <p class="font-mono text-[11px] text-blood mt-2">✕ {{ subs.error() }}</p>
        }
      </div>
    }
    </ng-container>
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
