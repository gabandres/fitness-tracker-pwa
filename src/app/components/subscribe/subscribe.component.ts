import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslocoDirective } from '@jsverse/transloco';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';

/**
 * Subscribe / Manage-subscription card.
 *
 * Rendered inside the footer (or wherever settings live). Handles
 * three states:
 *   1. Not configured — neither monthly nor annual Stripe price ID is
 *      set in environment.ts. Shows nothing. This is the default
 *      until the Firebase Extension is installed and the price IDs
 *      are pasted in.
 *   2. Not subscribed — shows pitch + cadence toggle (monthly/annual)
 *      + "Support Macro Log · $X" button. Toggle hides if only one
 *      cadence is configured.
 *   3. Subscribed (trialing or active) — shows status + "Manage"
 *      button. Renewal copy adapts to the active subscription's
 *      cadence via displayPriceFor().
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
    @if (subs.hasAnyPrice) {
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
              {{ t('subscribe.thenRenewsAt', { price: subs.displayPriceFor(s.priceId) }) }}
            } @else if (s.status === 'active') {
              <span class="text-olive">{{ t('subscribe.active') }}</span>{{ s.currentPeriodEnd
                ? t('subscribe.renewsAt', { date: (s.currentPeriodEnd | date: 'MMM d'), price: subs.displayPriceFor(s.priceId) })
                : t('subscribe.renewsMonthly', { price: subs.displayPriceFor(s.priceId) }) }}
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
          <!-- Not subscribed — pitch + cadence toggle + subscribe button -->
          <p class="font-sans text-sm text-ink leading-relaxed mb-2">
            {{ t('subscribe.pitchBody') }}
          </p>
          <ul class="font-sans text-[13px] text-graphite leading-relaxed mb-3 list-disc list-inside">
            <li>{{ t('subscribe.featureConsultations') }}</li>
            <li>{{ t('subscribe.featurePhoto') }}</li>
            <li>{{ t('subscribe.featureWebhook') }}</li>
            <li>{{ t('subscribe.featureReports') }}</li>
          </ul>

          @if (subs.priceIdMonthly && subs.priceIdAnnual) {
            <div class="mb-3" role="radiogroup" [attr.aria-label]="t('subscribe.cadenceAria')">
              <div class="inline-flex rounded border border-rule overflow-hidden text-[12px]">
                <button type="button" role="radio"
                  [attr.aria-checked]="cadence() === 'annual'"
                  (click)="setCadence('annual')"
                  [attr.aria-label]="subs.displayPriceAnnualAnchor
                    ? t('subscribe.annualAnchorAria', { anchor: subs.displayPriceAnnualAnchor, price: subs.displayPriceAnnual })
                    : t('subscribe.toggleAnnual') + ' ' + subs.displayPriceAnnual"
                  [class.bg-ink]="cadence() === 'annual'"
                  [class.text-cream]="cadence() === 'annual'"
                  [class.text-graphite]="cadence() !== 'annual'"
                  class="px-3 py-1.5 font-sans transition-colors">
                  {{ t('subscribe.toggleAnnual') }} &middot;
                  @if (subs.displayPriceAnnualAnchor) {
                    <!-- Anchor price shown only for the annual toggle so
                         the 33% savings reads at a glance without the
                         user doing math. Hidden when no anchor price is
                         configured so we never show a made-up strike-
                         through number. Use the semantic strike element
                         with aria-hidden because the button's aria-label
                         already verbalises "was $36, now $24" for
                         screen readers. -->
                    <s class="opacity-60 mr-1" aria-hidden="true">{{ subs.displayPriceAnnualAnchor }}</s>
                  }
                  {{ subs.displayPriceAnnual }}
                  @if (subs.annualSavingsPercent > 0) {
                    <span class="ml-1 text-[10px] uppercase tracking-wider"
                      [class.text-olive]="cadence() === 'annual'"
                      [class.text-blood]="cadence() !== 'annual'">
                      &middot; {{ t('subscribe.savingsBadge', { n: subs.annualSavingsPercent }) }}
                    </span>
                  }
                </button>
                <button type="button" role="radio"
                  [attr.aria-checked]="cadence() === 'monthly'"
                  (click)="setCadence('monthly')"
                  [class.bg-ink]="cadence() === 'monthly'"
                  [class.text-cream]="cadence() === 'monthly'"
                  [class.text-graphite]="cadence() !== 'monthly'"
                  class="px-3 py-1.5 font-sans transition-colors border-l border-rule">
                  {{ t('subscribe.toggleMonthly') }} &middot; {{ subs.displayPriceMonthly }}
                </button>
              </div>
            </div>
          }

          <div class="flex items-center gap-2">
            <button type="button" (click)="subscribe()"
              [disabled]="busy()"
              [attr.aria-label]="t('subscribe.subscribeAria')"
              class="stamp-btn max-w-xs">
              @if (busy()) {
                {{ t('subscribe.startingCheckout') }}
              } @else if (subs.trialDays > 0) {
                <!-- Trial-led CTA: industry research shows a 7-day free
                     trial converts 2-4x better than a raw price offer
                     for health apps. Keep the price visible underneath
                     for transparency, but it's secondary to the trial. -->
                <span>{{ t('subscribe.startFreeTrial', { n: subs.trialDays }) }}</span>
                <span class="font-sans text-[11px] normal-case opacity-80 ml-1">{{ t('subscribe.thenBilled', { price: selectedDisplayPrice() }) }}</span>
              } @else {
                {{ t('subscribe.support') }} &middot; {{ selectedDisplayPrice() }}
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
  private readonly analytics = inject(AnalyticsService);
  protected readonly busy = signal(false);
  protected readonly sub = computed(() => this.subs.subscription());

  // Default to annual to anchor on the higher-LTV option; users who want
  // monthly explicitly toggle. Falls back gracefully when only one
  // price is configured.
  protected readonly cadence = signal<'monthly' | 'annual'>('annual');

  protected setCadence(c: 'monthly' | 'annual'): void {
    this.cadence.set(c);
  }

  protected selectedPriceId(): string {
    if (this.cadence() === 'annual' && this.subs.priceIdAnnual) return this.subs.priceIdAnnual;
    if (this.subs.priceIdMonthly) return this.subs.priceIdMonthly;
    return this.subs.priceIdAnnual;
  }

  protected selectedDisplayPrice(): string {
    return this.cadence() === 'annual' && this.subs.priceIdAnnual
      ? this.subs.displayPriceAnnual
      : this.subs.displayPriceMonthly;
  }

  protected async subscribe(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    // Fire analytics before the Stripe redirect — once the user lands on
    // Stripe's hosted Checkout, this client context is gone.
    this.analytics.track('trial_started', {
      cadence: this.cadence(),
      trialDays: this.subs.trialDays,
    });
    try {
      await this.subs.startCheckout(this.selectedPriceId(), this.subs.trialDays);
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
