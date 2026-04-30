import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { SubscriptionService } from '../../services/subscription.service';
import { UpsellService } from '../../services/upsell.service';
import { AnalyticsService } from '../../services/analytics.service';
import { V2Card } from '../ui/card.component';
import { V2Button } from '../ui/button.component';

type UpsellContext = 'photoQuota' | 'presetLimit' | 'csvExport' | 'chartHistory';

const CONTEXT_TO_SOURCE: Record<UpsellContext, 'photo' | 'preset' | 'csv' | 'chart'> = {
  photoQuota: 'photo',
  presetLimit: 'preset',
  csvExport: 'csv',
  chartHistory: 'chart',
};

/**
 * Small inline upsell card surfaced at the moment a free user hits a tier
 * wall. Aligns with the "calm upgrade" positioning — no dark patterns,
 * no countdown timers, no fear framing. Copy varies per `context`.
 *
 * Renders nothing for Pro / admin / comped users — callers can safely
 * place it anywhere and let the component gate itself.
 *
 * The CTA opens the Subscribe card in the settings sheet via the
 * `UpsellService`, which the App shell listens to.
 */
@Component({
  selector: 'app-upsell-card',
  standalone: true,
  imports: [TranslocoDirective, V2Card, V2Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (shouldShow()) {
        <v2-card variant="accent" class="block mt-2" role="note">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
                {{ t('upsell.stamp') }}
              </div>
              <p class="v2-body mt-1.5">
                {{ t('upsell.' + context() + '.body') }}
              </p>
            </div>
            <v2-button variant="primary" size="sm" (click)="open()">
              {{ t('upsell.cta') }}
            </v2-button>
          </div>
        </v2-card>
      }
    </ng-container>
  `,
})
export class UpsellCardComponent {
  private readonly subs = inject(SubscriptionService);
  private readonly upsell = inject(UpsellService);
  private readonly analytics = inject(AnalyticsService);

  readonly context = input.required<UpsellContext>();

  constructor() {
    // Contract: callers gate the component's creation with an `@if`
    // that matches the friction moment they're measuring (photos=0,
    // preset cap hit, export clicked). That means each mount IS the
    // event we want to count — `paywall_shown` fires once per mount,
    // which equals once per friction-hit per session for the current
    // callsites. The `fired` flag protects against the effect running
    // twice inside a single lifecycle (e.g. if `shouldShow()` flips
    // momentarily during change-detection), not against remounts.
    let fired = false;
    effect(() => {
      if (fired) return;
      if (!this.shouldShow()) return;
      fired = true;
      this.analytics.paywallShown(CONTEXT_TO_SOURCE[this.context()]);
    });
  }

  protected shouldShow(): boolean {
    // Only free-tier users see this. Admins and comped friends never see
    // a pitch; paid users don't need one.
    return !this.subs.isPaid() && !this.subs.isAdmin() && !this.subs.isComped();
  }

  protected open(): void {
    this.analytics.paywallClick(CONTEXT_TO_SOURCE[this.context()]);
    this.upsell.openSubscribe(this.context());
  }
}
