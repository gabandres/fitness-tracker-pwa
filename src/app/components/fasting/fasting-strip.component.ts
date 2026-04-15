import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { TranslationService } from '../../services/translation.service';

/**
 * Compact fasting strip rendered at the top of the daily ledger when
 * a fast is active. This is the *ambient* presentation — elapsed time
 * + "end fast" button in one line. The full analog dial lives in its
 * own section in the right column for users who want the detail.
 *
 * The strip keeps fasting visible during the user's primary activity
 * (logging meals) without taking 200px of vertical space.
 */
@Component({
  selector: 'app-fasting-strip',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (store.isFasting()) {
        <!-- No aria-live here: the elapsed time changes every 30s, which
             would cause a screen reader to re-announce the whole strip
             on every tick. Tab-navigable via the button's aria-label. -->
        <div class="specimen px-4 py-2.5 mb-4 flex items-center justify-between gap-3"
          style="border-color: var(--color-gold)">
          <span class="crop-bl" style="border-color: var(--color-gold)"></span>
          <span class="crop-br" style="border-color: var(--color-gold)"></span>
          <div class="flex items-center gap-2 min-w-0">
            <span class="stamp-mark"
              style="transform: rotate(0deg); border-color: var(--color-gold); color: var(--color-gold)">
              {{ t('fasting.stamp') }}
            </span>
            <span class="font-mono text-sm tabular-nums text-ink">
              {{ elapsedLabel() }}
            </span>
            <span class="caption text-[11px] hidden sm:inline">
              {{ t('fasting.sinceShort', { time: startTimeLabel() }) }}
            </span>
          </div>
          <button type="button" (click)="breakFast()"
            [attr.aria-label]="t('fasting.endFastAria')"
            class="tag-btn text-[11px] shrink-0">
            {{ t('fasting.endFast') }}
          </button>
        </div>
      }
    </ng-container>
  `,
})
export class FastingStripComponent implements OnInit, OnDestroy {
  protected readonly store = inject(FitnessStore);
  private readonly translation = inject(TranslationService);

  // Tick every 30s so the elapsed time stays fresh without a full
  // re-render of the ledger.
  private readonly _now = signal(new Date());
  private tick: ReturnType<typeof setInterval> | null = null;

  protected readonly elapsedLabel = computed(() => {
    const start = this.store.fastStartedAt();
    if (!start) return '0:00';
    const ms = this._now().getTime() - start.getTime();
    const h = Math.floor(ms / (1000 * 60 * 60));
    const m = Math.floor((ms / (1000 * 60)) % 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  });

  protected readonly startTimeLabel = computed(() => {
    const start = this.store.fastStartedAt();
    if (!start) return '';
    const locale = this.translation.language() === 'es-PR' ? 'es' : 'en-US';
    return start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  });

  ngOnInit(): void {
    this.tick = setInterval(() => this._now.set(new Date()), 30_000);
  }
  ngOnDestroy(): void {
    if (this.tick) clearInterval(this.tick);
  }

  protected async breakFast(): Promise<void> {
    await this.store.breakFast();
  }
}
