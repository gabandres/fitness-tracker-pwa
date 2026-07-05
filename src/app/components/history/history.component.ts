import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { BodyMetricStore } from '../../services/body-metric-store.service';
import { TranslationService } from '../../services/translation.service';
import {
  localDateKey,
  monthGrid,
  startOfMonth,
} from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { UiIconButton } from '../ui/icon-button.component';

/**
 * Month-grid history view. Each day cell shows a mini kcal ring driven
 * by `store.summaryFor(key)`. Tapping a day emits `dayTapped(dateKey)`;
 * the parent (App) pushes the corresponding URL.
 *
 * Free-tier users beyond 90 days back see an upsell — `summaryFor` is
 * already gated by `allTimeLogs`, so cells just lack rings for that
 * period and we add an explanatory card above the grid.
 */
@Component({
  selector: 'app-history',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      <!-- Header: title + back (mirrors mobile History) -->
      <header class="flex items-center gap-2 pt-2 pb-2">
        <ui-icon-button
          icon="arrow-left"
          [ariaLabel]="t('v2.history.backAria')"
          (click)="closeRequested.emit()" />
        <h1 class="page-title" style="font-family: var(--v2-font-display);">{{ t('v2.history.title') }}</h1>
      </header>

      <!-- Month nav on its own row: chevrons flank the centered month -->
      <div class="flex items-center justify-between gap-3 mb-3">
        <ui-icon-button
          icon="chevron-left"
          [ariaLabel]="t('v2.history.prevMonthAria')"
          (click)="prevMonth()" />
        <h2 class="section-title" aria-live="polite" style="text-transform: capitalize;">{{ monthLabel() }}</h2>
        <ui-icon-button
          icon="chevron-right"
          [ariaLabel]="t('v2.history.nextMonthAria')"
          (click)="nextMonth()" />
      </div>

      <!-- Weekday header -->
      <div class="grid grid-cols-7 gap-1 mb-1" aria-hidden="true">
        @for (w of weekdays(); track $index) {
          <div class="text-center" style="font-size: 12px; font-weight: 700; color: var(--v2-ink-muted); text-transform: uppercase;">
            {{ w }}
          </div>
        }
      </div>

      <!-- Grid -->
      <div role="grid" [attr.aria-label]="t('v2.history.calendarAria')" class="grid grid-cols-7 gap-1">
        @if (loading()) {
          @for (row of placeholderRows; track $index) {
            <div role="row" style="display: contents">
              @for (i of row; track i) {
                <div
                  role="gridcell"
                  class="aspect-square rounded-md"
                  style="background: var(--v2-paper-2); opacity: 0.5;"
                  aria-hidden="true"></div>
              }
            </div>
          }
        } @else {
          @for (week of weeks(); track $index) {
            <div role="row" style="display: contents">
              @for (cell of week; track cell.key) {
                <button
                  type="button"
                  role="gridcell"
                  class="aspect-square flex flex-col items-center justify-center gap-1 rounded-md"
                  [class.opacity-60]="isFuture(cell.key)"
                  [class.cursor-not-allowed]="isFuture(cell.key)"
                  [style]="cellStyle(cell.key)"
                  [disabled]="isFuture(cell.key)"
                  [attr.aria-current]="cell.key === todayKey() ? 'date' : null"
                  [attr.aria-label]="cellAria(cell.date, cell.key)"
                  (click)="onTap(cell)">
                  <span [style.font-weight]="cell.key === todayKey() ? 800 : 500"
                        [style.color]="cellNumberColor(cell)"
                        style="font-size: 14px; line-height: 1;">{{ cell.date.getDate() }}</span>
                  <span style="display: flex; gap: 3px; height: 6px; align-items: center;">
                    @if (loggedOn(cell.key)) {
                      <span style="width: 6px; height: 6px; border-radius: 3px; background: var(--v2-accent);"></span>
                    }
                    @if (weighedOn(cell.key)) {
                      <span style="width: 6px; height: 6px; border-radius: 3px; background: var(--v2-teal);"></span>
                    }
                  </span>
                </button>
              }
            </div>
          }
        }
      </div>
    </section>
    </ng-container>
  `,
})
export class HistoryComponent {
  private readonly store = inject(FitnessStore);
  private readonly body = inject(BodyMetricStore);
  private readonly translation = inject(TranslationService);

  readonly dayTapped = output<string>();
  readonly closeRequested = output<void>();
  readonly bodyRequested = output<void>();

  /** 6 rows × 7 cells of loading placeholders, mirroring the month grid so
   *  the ARIA grid keeps a valid row → gridcell hierarchy while loading. */
  protected readonly placeholderRows = Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => r * 7 + c));

  protected readonly viewMonth = signal<Date>(startOfMonth(new Date()));
  protected readonly todayKey = signal(localDateKey(new Date()));

  protected readonly cells = computed(() => monthGrid(this.viewMonth()));

  /** Calendar cells chunked into weeks of 7 so the template can wrap each in
   *  a `role="row"` (ARIA grids require gridcells to sit inside rows). */
  protected readonly weeks = computed(() => {
    const c = this.cells();
    const out: (typeof c)[] = [];
    for (let i = 0; i < c.length; i += 7) out.push(c.slice(i, i + 7));
    return out;
  });

  protected readonly weekdays = computed(() =>
    this.translation.t('v2.history.weekdayInitials').split(','),
  );

  protected readonly monthLabel = computed(() => {
    const locale = bcp47ForLang(this.translation.language());
    return this.viewMonth().toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  });

  protected readonly loading = computed(() => this.store.status() !== 'ready');

  protected readonly kcalTarget = computed(() => this.store.targetCalories());

  protected summaryFor(key: string) {
    return this.store.summaryFor(key);
  }

  /** Any food logged that day (drives the coral dot, mirrors mobile). */
  protected loggedOn(key: string): boolean {
    return (this.store.summaryFor(key)?.totalCalories ?? 0) > 0;
  }

  /** A weight was recorded that day (drives the teal dot). */
  protected weighedOn(key: string): boolean {
    return typeof this.body.dailyWeights()[key] === 'number';
  }

  protected isFuture(key: string): boolean {
    return key > this.todayKey();
  }

  /** Today = filled cell + accent border; other days sit flush on the paper. */
  protected cellStyle(key: string): string {
    const isToday = key === this.todayKey();
    return isToday
      ? 'background: var(--v2-paper-2); border: 1px solid var(--v2-accent);'
      : 'background: transparent; border: 1px solid transparent;';
  }

  /** Today → accent; out-of-month → faint; else ink. */
  protected cellNumberColor(cell: { key: string; inMonth: boolean }): string {
    if (cell.key === this.todayKey()) return 'var(--v2-accent)';
    return cell.inMonth ? 'var(--v2-ink)' : 'var(--v2-ink-muted)';
  }

  protected cellAria(date: Date, key: string): string {
    const locale = bcp47ForLang(this.translation.language());
    const label = date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
    const s = this.store.summaryFor(key);
    if (!s) return label;
    return this.translation.t('v2.history.cellAriaWithKcal', { label, kcal: s.totalCalories });
  }

  protected prevMonth(): void {
    const d = new Date(this.viewMonth());
    d.setMonth(d.getMonth() - 1);
    this.viewMonth.set(d);
  }

  protected nextMonth(): void {
    const d = new Date(this.viewMonth());
    d.setMonth(d.getMonth() + 1);
    this.viewMonth.set(d);
  }

  protected onTap(cell: { key: string; inMonth: boolean }): void {
    // Out-of-month days stay tappable (mirrors mobile); only the future is inert.
    if (this.isFuture(cell.key)) return;
    this.haptic(10);
    this.dayTapped.emit(cell.key);
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
