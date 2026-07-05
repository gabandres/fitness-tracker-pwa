import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslocoDirective } from '@jsverse/transloco';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';
import { UiButton } from '../ui/button.component';

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
 *      + "Support Ignia · $X" button. Toggle hides if only one
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
  imports: [DatePipe, TranslocoDirective, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (subs.hasAnyPrice) {
      <div>
        <p class="v2-caption mb-3" style="text-transform: uppercase; letter-spacing: 0.08em;"
          [style.color]="subs.isAdmin() || subs.isComped() ? 'var(--v2-sage)' : 'var(--v2-ink-muted)'">
          {{ subs.isAdmin() ? t('subscribe.access') : subs.isComped() ? t('subscribe.access') : (sub() ? t('subscribe.subscription') : t('subscribe.pro')) }}
        </p>

        @if (subs.isAdmin()) {
          <p class="v2-body">{{ t('subscribe.adminBody') }}</p>
        } @else if (subs.isComped()) {
          <p class="v2-body">{{ t('subscribe.compedBody') }}</p>
        } @else if (sub(); as s) {
          <p class="v2-body">
            @if (s.status === 'trialing') {
              {{ t('subscribe.trialOn') }}
              <span style="color: var(--v2-sage); font-weight: 500;">{{ t('subscribe.freeTrial') }}</span>
              {{ t('subscribe.until') }}
              {{ s.trialEndsAt ? (s.trialEndsAt | date: 'MMM d') : t('subscribe.endOfTrial') }}.
              {{ t('subscribe.thenRenewsAt', { price: subs.displayPriceFor(s.priceId) }) }}
            } @else if (s.status === 'active') {
              <span style="color: var(--v2-sage); font-weight: 500;">{{ t('subscribe.active') }}</span>{{ s.currentPeriodEnd
                ? t('subscribe.renewsAt', { date: (s.currentPeriodEnd | date: 'MMM d'), price: subs.displayPriceFor(s.priceId) })
                : t('subscribe.renewsMonthly', { price: subs.displayPriceFor(s.priceId) }) }}
            } @else if (s.status === 'past_due') {
              <span style="color: var(--v2-danger); font-weight: 500;">{{ t('subscribe.paymentPastDue') }}</span>
              {{ t('subscribe.paymentPastDueSuffix') }}
            }
          </p>
          <div class="mt-3">
            <ui-button
              variant="secondary"
              size="sm"
              (click)="manage()"
              [disabled]="busy()"
              [ariaLabel]="t('subscribe.manageAria')">
              {{ busy() ? t('subscribe.opening') : t('subscribe.manage') }}
            </ui-button>
          </div>
        } @else {
          <p class="v2-body mb-3">{{ t('subscribe.pitchBody') }}</p>
          <ul class="v2-body-soft mb-4" style="font-size: 0.875rem; padding-left: 1.25rem; list-style: disc;">
            <li>{{ t('subscribe.featureConsultations') }}</li>
            <li>{{ t('subscribe.featureProgressPhotos') }}</li>
            <li>{{ t('subscribe.featurePhoto') }}</li>
            <li>{{ t('subscribe.featureWebhook') }}</li>
            <li>{{ t('subscribe.featureReports') }}</li>
          </ul>

          @if (subs.priceIdMonthly && subs.priceIdAnnual) {
            <div class="mb-4" role="radiogroup" [attr.aria-label]="t('subscribe.cadenceAria')">
              <!-- v2 segmented control: paper-2 background, primary tab is rust-tinted -->
              <div class="grid grid-cols-2 gap-1 p-1"
                style="background: var(--v2-paper-2); border-radius: var(--v2-radius-md);">
                <button type="button" role="radio"
                  [attr.aria-checked]="cadence() === 'annual'"
                  (click)="setCadence('annual')"
                  [attr.aria-label]="subs.displayPriceAnnualAnchor
                    ? t('subscribe.annualAnchorAria', { anchor: subs.displayPriceAnnualAnchor, price: subs.displayPriceAnnual })
                    : t('subscribe.toggleAnnual') + ' ' + subs.displayPriceAnnual"
                  [class]="cadence() === 'annual' ? 'v2-btn v2-btn--sm v2-btn--primary' : 'v2-btn v2-btn--sm v2-btn--ghost'"
                  style="justify-content: center;">
                  {{ t('subscribe.toggleAnnual') }} &middot;
                  @if (subs.displayPriceAnnualAnchor) {
                    <s style="opacity: 0.6; margin-right: 4px;" aria-hidden="true">{{ subs.displayPriceAnnualAnchor }}</s>
                  }
                  {{ subs.displayPriceAnnual }}
                  @if (subs.annualSavingsPercent > 0) {
                    <span style="margin-left: 6px; font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.06em;"
                      [style.color]="cadence() === 'annual' ? 'rgba(255,255,255,0.85)' : 'var(--v2-sage)'">
                      &middot; {{ t('subscribe.savingsBadge', { n: subs.annualSavingsPercent }) }}
                    </span>
                  }
                </button>
                <button type="button" role="radio"
                  [attr.aria-checked]="cadence() === 'monthly'"
                  (click)="setCadence('monthly')"
                  [class]="cadence() === 'monthly' ? 'v2-btn v2-btn--sm v2-btn--primary' : 'v2-btn v2-btn--sm v2-btn--ghost'"
                  style="justify-content: center;">
                  {{ t('subscribe.toggleMonthly') }} &middot; {{ subs.displayPriceMonthly }}
                </button>
              </div>
            </div>
          }

          <ui-button
            variant="primary"
            size="lg"
            [block]="true"
            (click)="subscribe()"
            [disabled]="busy()"
            [ariaLabel]="t('subscribe.subscribeAria')">
            @if (busy()) {
              {{ t('subscribe.startingCheckout') }}
            } @else if (subs.trialDays > 0) {
              <span>{{ t('subscribe.startFreeTrial', { n: subs.trialDays }) }}</span>
              <span style="font-size: 0.75rem; opacity: 0.85; margin-left: 6px; font-weight: 400;">
                {{ t('subscribe.thenBilled', { price: selectedDisplayPrice() }) }}
              </span>
            } @else {
              {{ t('subscribe.support') }} &middot; {{ selectedDisplayPrice() }}
            }
          </ui-button>
        }

        @if (subs.error()) {
          <p class="v2-caption mt-3" role="alert" style="color: var(--v2-danger);">
            {{ subs.error() }}
          </p>
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
