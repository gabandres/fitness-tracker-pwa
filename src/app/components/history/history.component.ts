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
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import {
  addDays,
  localDateKey,
  monthGrid,
  startOfMonth,
} from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { UiIconButton } from '../ui/icon-button.component';
import { UiCard } from '../ui/card.component';
import { UiRing } from '../ui/ring.component';
import { UiFastingPill } from '../ui/fasting-pill.component';
import { CHART_HISTORY_DAYS_FREE } from '../../models/tier-limits';

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
  imports: [LucideAngularModule, TranslocoDirective, UiIconButton, UiCard, UiRing, UiFastingPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto pb-32 md:pb-28">
      <!-- Top bar -->
      <header class="flex items-center justify-between gap-3 pt-2 pb-4">
        <ui-icon-button
          icon="arrow-left"
          [ariaLabel]="t('v2.history.backAria')"
          (click)="closeRequested.emit()" />
        <h1 class="v2-h2" aria-live="polite">{{ monthLabel() }}</h1>
        <div class="flex items-center gap-2">
          <ui-fasting-pill (bodyRequested)="bodyRequested.emit()" />
          <ui-icon-button
            icon="chevron-left"
            [ariaLabel]="t('v2.history.prevMonthAria')"
            (click)="prevMonth()" />
          <ui-icon-button
            icon="chevron-right"
            [ariaLabel]="t('v2.history.nextMonthAria')"
            (click)="nextMonth()" />
        </div>
      </header>

      @if (showFreeTierUpsell()) {
        <ui-card variant="accent" class="block mb-4">
          <p class="v2-body">
            {{ t('v2.history.freeTierBody') }}
          </p>
        </ui-card>
      }

      <!-- Weekday header -->
      <div class="grid grid-cols-7 gap-1 mb-1" aria-hidden="true">
        @for (w of weekdays(); track $index) {
          <div class="v2-caption text-center" style="text-transform: uppercase; letter-spacing: 0.08em;">
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
                  class="aspect-square flex flex-col items-center justify-center gap-0.5 rounded-md"
                  [class.opacity-60]="!cell.inMonth || isFuture(cell.key)"
                  [class.cursor-not-allowed]="isFuture(cell.key) || !cell.inMonth"
                  [style]="cellStyle(cell.key)"
                  [disabled]="isFuture(cell.key) || !cell.inMonth"
                  [attr.aria-current]="cell.key === todayKey() ? 'date' : null"
                  [attr.aria-label]="cellAria(cell.date, cell.key)"
                  (click)="onTap(cell)">
                  <span class="v2-caption" style="font-weight: 500;">{{ cell.date.getDate() }}</span>
                  @if (summaryFor(cell.key); as s) {
                    <ui-ring
                      [value]="s.totalCalories"
                      [target]="kcalTarget()"
                      [size]="28"
                      [stroke]="3"
                      [tone]="s.totalCalories > kcalTarget() ? 'warn' : 'accent'"
                      ariaLabel="" />
                  }
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
  private readonly subs = inject(SubscriptionService);
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

  /** Show whenever a free user views a month where ANY cell falls
   *  outside the 90-day window — this includes the current month when
   *  it's old enough that day-1 is already past the cutoff. The earliest
   *  visible cell is `cells()[0]` (Sunday before the first of the month). */
  protected readonly showFreeTierUpsell = computed(() => {
    if (this.subs.isPaid()) return false;
    const cutoffKey = localDateKey(addDays(new Date(), -CHART_HISTORY_DAYS_FREE));
    return this.cells()[0].key < cutoffKey;
  });

  protected summaryFor(key: string) {
    return this.store.summaryFor(key);
  }

  protected isFuture(key: string): boolean {
    return key > this.todayKey();
  }

  protected cellStyle(key: string): string {
    const isToday = key === this.todayKey();
    const base = 'background: var(--v2-paper-2); transition: background-color var(--v2-motion-fast) var(--v2-ease);';
    return isToday
      ? `${base} outline: 2px solid var(--v2-accent); outline-offset: -2px;`
      : base;
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
    if (this.isFuture(cell.key) || !cell.inMonth) return;
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
