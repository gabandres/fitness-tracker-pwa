import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { SubscriptionService } from '../../services/subscription.service';
import { UpsellService } from '../../services/upsell.service';

type UpsellContext = 'photoQuota' | 'presetLimit' | 'csvExport' | 'chartHistory';

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
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (shouldShow()) {
        <div class="specimen px-3 py-2.5 mt-2"
             role="note"
             style="border-color: var(--color-blood);">
          <span class="crop-bl" style="border-color: var(--color-blood)"></span>
          <span class="crop-br" style="border-color: var(--color-blood)"></span>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="stamp-mark text-[10px]"
                   style="border-color: var(--color-blood); color: var(--color-blood)">
                {{ t('upsell.stamp') }}
              </div>
              <p class="font-sans text-xs text-ink mt-1.5 leading-relaxed">
                {{ t('upsell.' + context() + '.body') }}
              </p>
            </div>
            <button type="button"
                    (click)="open()"
                    class="tag-btn text-[11px] shrink-0"
                    style="border-color: var(--color-blood); color: var(--color-blood);">
              {{ t('upsell.cta') }}
            </button>
          </div>
        </div>
      }
    </ng-container>
  `,
})
export class UpsellCardComponent {
  private readonly subs = inject(SubscriptionService);
  private readonly upsell = inject(UpsellService);

  readonly context = input.required<UpsellContext>();

  protected shouldShow(): boolean {
    // Only free-tier users see this. Admins and comped friends never see
    // a pitch; paid users don't need one.
    return !this.subs.isPaid() && !this.subs.isAdmin() && !this.subs.isComped();
  }

  protected open(): void {
    this.upsell.openSubscribe(this.context());
  }
}
