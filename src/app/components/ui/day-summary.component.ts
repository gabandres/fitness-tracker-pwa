import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { BodyMetricStore } from '../../services/body-metric-store.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { TranslationService } from '../../services/translation.service';
import type { DailyLog } from '../../services/firebase.service';
import { localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { FastingStore } from '../../services/fasting-store.service';
import { UiButton } from './button.component';
import { UiCard } from './card.component';

/**
 * Shared rings + entries + water + exercise block. Renders the day
 * identified by [dateKey]. Used by today-v2 (today) and day-detail-v2
 * (any past day).
 *
 * When [editable] is false, all mutating actions (toggle exercise,
 * tap-to-edit entries, water buttons) are inert. Today-v2 always passes
 * editable=true; day-detail-v2 passes false for future days.
 */
@Component({
  selector: 'ui-day-summary',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiButton, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <!-- Hero rings — dark concentric dual-ring panel (mirrors mobile HeroRings):
         calories outer (coral), protein inner (sage), remaining-kcal in center,
         legend + carbs/fat chips below, all on the shared dark hero panel. -->
    <div class="mt-6" style="background: var(--v2-hero-panel); border-radius: var(--v2-radius-xl); padding: var(--v2-space-5) var(--v2-space-4); display: flex; flex-direction: column; align-items: center; gap: var(--v2-space-4); box-shadow: var(--v2-shadow-2);">
      <div style="position: relative; width: 236px; height: 236px;">
        <svg width="236" height="236" viewBox="0 0 236 236" role="img"
          [attr.aria-label]="t('v2.daySummary.kcalAria', { consumed: kcalConsumed(), target: kcalTarget() })">
          <circle cx="118" cy="118" r="110.5" stroke="var(--v2-hero-track)" stroke-width="15" fill="none" />
          <circle cx="118" cy="118" r="110.5" stroke-width="15" fill="none" stroke-linecap="round"
            [attr.stroke]="kcalOver() ? 'var(--v2-danger)' : '#ff6a3d'"
            [attr.stroke-dasharray]="outerC"
            [attr.stroke-dashoffset]="outerC * (1 - calRingProgress())"
            transform="rotate(-90 118 118)" />
          <circle cx="118" cy="118" r="88.5" stroke="var(--v2-hero-track)" stroke-width="12" fill="none" />
          <circle cx="118" cy="118" r="88.5" stroke="var(--v2-sage)" stroke-width="12" fill="none" stroke-linecap="round"
            [attr.stroke-dasharray]="innerC"
            [attr.stroke-dashoffset]="innerC * (1 - protRingProgress())"
            transform="rotate(-90 118 118)" />
        </svg>
        <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;">
          <span style="font-family: var(--v2-font-display); font-weight: 800; font-size: 44px; line-height: 1; color: var(--v2-hero-text);">{{ kcalRemainingAbs() }}</span>
          <span style="font-size: 14px; color: var(--v2-hero-muted); margin-top: 2px;">{{ t('v2.daySummary.kcal') }} {{ kcalOver() ? t('v2.daySummary.over') : t('v2.daySummary.left') }}</span>
        </div>
      </div>

      <!-- Legend -->
      <div style="display: flex; gap: var(--v2-space-5); align-items: center;">
        <div style="display: flex; align-items: center; gap: var(--v2-space-1);">
          <span style="width: 8px; height: 8px; border-radius: 4px;" [style.background]="kcalOver() ? 'var(--v2-danger)' : '#ff6a3d'"></span>
          <span style="font-family: var(--v2-font-display); font-weight: 700; font-size: 14px; color: var(--v2-hero-text);">{{ kcalConsumed().toLocaleString() }} / {{ kcalTarget().toLocaleString() }} {{ t('v2.daySummary.kcal') }}</span>
        </div>
        <div style="display: flex; align-items: center; gap: var(--v2-space-1);">
          <span style="width: 8px; height: 8px; border-radius: 4px; background: var(--v2-sage);"></span>
          <span style="font-family: var(--v2-font-display); font-weight: 700; font-size: 14px; color: var(--v2-hero-text);">{{ proteinConsumed() }}g / {{ proteinTargetG() }}g {{ t('v2.daySummary.protein') }}</span>
        </div>
      </div>

      <!-- Carbs + fat value chips (always shown, mirrors mobile) -->
      <div style="display: flex; gap: var(--v2-space-4);">
        <span style="font-size: 12px; color: var(--v2-hero-muted); text-transform: capitalize;"><span style="color: #f59e0b;">●</span> {{ t('entry.carbsChip', { n: carbsConsumed() }) }}</span>
        <span style="font-size: 12px; color: var(--v2-hero-muted); text-transform: capitalize;"><span style="color: #8b5cf6;">●</span> {{ t('entry.fatChip', { n: fatConsumed() }) }}</span>
      </div>
    </div>

    <!-- Entries list, grouped by diary slot. Days with no slotted
         entries (every row pre-dates mealType) render as one flat
         heading-less group, so legacy history looks unchanged. -->
    @if (dayLogs().length > 0) {
      <h2 class="card-title mt-8 mb-3">{{ entriesHeading() }}</h2>
      @for (group of mealGroups(); track group.key) {
        @if (grouped()) {
          <div class="flex items-baseline justify-between mt-4 mb-2">
            <h3 class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em;">
              {{ t('entry.mealType.' + group.key) }}
            </h3>
            <span class="v2-caption v2-num">{{ t('entry.mealTypeSubtotal', { n: group.kcal }) }}</span>
          </div>
        }
        <ul class="space-y-2" role="list">
          @for (log of group.logs; track log.id) {
            <li>
              <button
                type="button"
                class="w-full text-left v2-card flex items-center justify-between gap-3"
                style="padding: var(--v2-space-3) var(--v2-space-4); transition: background-color var(--v2-motion-fast) var(--v2-ease);"
                [disabled]="!editable()"
                (click)="editLog(log)"
                [attr.aria-label]="t('v2.daySummary.editEntryAria', { label: log.mealLabel || t('v2.daySummary.entryFallback'), kcal: log.calories })">
                <div class="min-w-0 flex-1">
                  <div class="v2-body" style="color: var(--v2-ink); font-weight: 500;">
                    {{ log.mealLabel || t('v2.daySummary.untitled') }}
                  </div>
                  <div class="v2-caption mt-0.5">{{ logTime(log) }}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="v2-num" style="font-weight: 600;">{{ log.calories }}</div>
                  <div class="v2-caption">
                    @if (log.protein != null) { {{ t('v2.daySummary.proGrams', { n: log.protein }) }} }
                    @else { {{ t('v2.daySummary.kcalUnit') }} }
                  </div>
                </div>
              </button>
            </li>
          }
        </ul>
      }
    }

    <!-- Daily Metrics (Fasting, Water, Sleep) — mirrors mobile DailyMetrics -->
    <ui-card class="mt-4 block p-0 overflow-hidden" style="padding: 0;">

      <!-- Fasting Row -->
      <div class="flex items-center justify-between" style="padding: var(--v2-space-3) var(--v2-space-4); border-bottom: 1px solid var(--v2-rule);">
        <div>
          <div class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.05em; color: var(--v2-ink-soft); font-weight: 600;">{{ t('metrics.fasting') }}</div>
          <div class="v2-body" style="font-weight: 700; color: var(--v2-ink); margin-top: 2px;">{{ fastingValue() }}</div>
        </div>
        @if (editable()) {
          <button type="button" (click)="toggleFast()" class="v2-caption"
            [style.color]="fasting.isFasting() ? 'var(--v2-danger)' : 'var(--v2-ink)'"
            [style.border-color]="fasting.isFasting() ? 'var(--v2-danger)' : 'var(--v2-ink)'"
            style="font-weight: 700; background: transparent; border-width: 1px; border-style: solid; border-radius: 999px; padding: 4px 12px;">
            {{ fasting.isFasting() ? t('metrics.end') : t('metrics.startFast') }}
          </button>
        }
      </div>

      <!-- Water Row -->
      <div class="flex items-center justify-between" style="padding: var(--v2-space-3) var(--v2-space-4); border-bottom: 1px solid var(--v2-rule);">
        <div>
          <div class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.05em; color: var(--v2-ink-soft); font-weight: 600;">{{ t('metrics.water') }}</div>
          <div class="v2-body" style="font-weight: 700; color: var(--v2-teal); margin-top: 2px;">{{ waterOz() }} fl oz</div>
        </div>
        <div class="flex items-center gap-1.5">
          @if (waterOz() > 0 && editable()) {
            <button type="button" (click)="addWaterOz(-8)" class="v2-caption" style="font-weight: 700; color: var(--v2-teal); background: var(--v2-sage-soft); border: 1px solid var(--v2-sage-soft); border-radius: 999px; padding: 4px 12px; transition: transform 0.15s ease;">−8</button>
          }
          @if (editable()) {
            <button type="button" (click)="addWaterOz(8)" class="v2-caption" style="font-weight: 700; color: var(--v2-teal); background: var(--v2-sage-soft); border: 1px solid var(--v2-sage-soft); border-radius: 999px; padding: 4px 12px; transition: transform 0.15s ease;">+8</button>
            <button type="button" (click)="addWaterOz(16)" class="v2-caption" style="font-weight: 700; color: var(--v2-teal); background: var(--v2-sage-soft); border: 1px solid var(--v2-sage-soft); border-radius: 999px; padding: 4px 12px; transition: transform 0.15s ease;">+16</button>
            <button type="button" (click)="addWaterOz(24)" class="v2-caption" style="font-weight: 700; color: var(--v2-teal); background: var(--v2-sage-soft); border: 1px solid var(--v2-sage-soft); border-radius: 999px; padding: 4px 12px; transition: transform 0.15s ease;">+24</button>
          }
        </div>
      </div>

      <!-- Sleep Row -->
      <div class="flex items-center justify-between" style="padding: var(--v2-space-3) var(--v2-space-4);">
        <div>
          <div class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.05em; color: var(--v2-ink-soft); font-weight: 600;">{{ t('metrics.sleep') }}</div>
          <div class="v2-body" style="font-weight: 700; color: var(--v2-ink); margin-top: 2px;">{{ hasSleep() ? sleepHoursVal() + 'h' : '—' }}</div>
        </div>
        @if (editable()) {
          <button type="button" (click)="openSleepEditor()" class="v2-caption" style="font-weight: 700; color: var(--v2-ink); background: transparent; border: 1px solid var(--v2-ink); border-radius: 999px; padding: 4px 12px; transition: transform 0.15s ease;">
            {{ hasSleep() ? t('metrics.edit') : t('metrics.log') }}
          </button>
        }
      </div>
    </ui-card>

    <!-- Inline sleep editor (opens under the card when editing) -->
    @if (editable() && editingSleep()) {
      <ui-card variant="flat" class="mt-3 block">
        <label class="v2-caption block" style="text-transform: uppercase; letter-spacing: 0.06em;">
          {{ t('metrics.hoursSlept') }}
        </label>
        <div class="flex flex-wrap gap-2 items-center mt-2">
          <input
            type="number"
            inputmode="decimal"
            step="0.5"
            min="0"
            max="24"
            class="v2-field v2-field--num"
            style="max-width: 140px;"
            [value]="sleepEditInput()"
            (input)="onSleepInput($event)"
            (keydown.enter)="saveSleep()" />
          <ui-button variant="primary" size="sm" (click)="saveSleep()">{{ t('v2.daySummary.save') }}</ui-button>
          <ui-button variant="ghost" size="sm" (click)="cancelSleepEdit()">{{ t('v2.daySummary.cancel') }}</ui-button>
          <ui-button variant="ghost" size="sm" (click)="clearSleep()">{{ t('v2.daySummary.clear') }}</ui-button>
        </div>
      </ui-card>
    }
    </ng-container>
  `,
})
export class UiDaySummary {
  protected readonly store = inject(FitnessStore);
  protected readonly body = inject(BodyMetricStore);
  protected readonly fasting = inject(FastingStore);
  private readonly entryForm = inject(EntryFormManager);
  private readonly translation = inject(TranslationService);

  readonly dateKey = input.required<string>();
  readonly editable = input<boolean>(true);
  readonly bodyRequested = output<void>();

  // ─── Fasting row (inline, mirrors mobile DailyMetrics) ──────────
  // 30s ticker keeps the elapsed clock live without a 1s timer; cleared
  // on destroy so route swaps don't leak the handle.
  private readonly fastTick = signal(0);
  constructor() {
    const id = setInterval(() => this.fastTick.update((n) => n + 1), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  /** "Not fasting" when idle, else "14h 03m" elapsed since the fast start. */
  protected readonly fastingValue = computed(() => {
    this.fastTick();
    const start = this.fasting.fastStartedAt();
    if (!start) return this.translation.t('metrics.notFasting');
    const mins = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
  });

  protected toggleFast(): void {
    if (!this.editable()) return;
    this.haptic(10);
    void (this.fasting.isFasting() ? this.fasting.breakFast() : this.fasting.startFast());
  }

  /** "Today's food" on today, "Food" on past days. */
  protected readonly entriesHeading = computed(() =>
    this.dateKey() === localDateKey(new Date())
      ? this.translation.t('v2.daySummary.todaysFood')
      : this.translation.t('v2.daySummary.food'),
  );

  protected readonly dayLogs = computed<DailyLog[]>(() =>
    this.store.logsForDay(this.dateKey()),
  );

  /** Slot order is fixed (meal sequence), not entry order. The "other"
   *  bucket collects legacy/unslotted rows and always renders last. */
  private static readonly SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack', 'other'] as const;

  protected readonly mealGroups = computed(() =>
    UiDaySummary.SLOT_ORDER
      .map((key) => ({ key, logs: this.dayLogs().filter((l) => (l.mealType ?? 'other') === key) }))
      .filter((g) => g.logs.length > 0)
      .map((g) => ({ ...g, kcal: g.logs.reduce((s, l) => s + l.calories, 0) })),
  );

  /** False when every entry is unslotted — render flat, no headings. */
  protected readonly grouped = computed(() =>
    this.mealGroups().some((g) => g.key !== 'other'),
  );

  protected readonly summary = computed(() => this.store.summaryFor(this.dateKey()));

  protected readonly kcalTarget = computed(() => this.store.targetCalories());
  protected readonly kcalConsumed = computed(() => this.summary()?.totalCalories ?? 0);
  protected readonly kcalRemaining = computed(() => {
    const r = this.kcalTarget() - this.kcalConsumed();
    return r >= 0 ? r.toLocaleString() : `+${(-r).toLocaleString()}`;
  });
  protected readonly kcalRemainingLabel = computed(() =>
    this.kcalTarget() - this.kcalConsumed() >= 0
      ? this.translation.t('v2.daySummary.left')
      : this.translation.t('v2.daySummary.over'),
  );
  protected readonly kcalTone = computed<'accent' | 'warn'>(() =>
    this.kcalConsumed() > this.kcalTarget() ? 'warn' : 'accent',
  );

  // ─── Hero rings geometry (mirrors mobile HeroRings: SIZE 236, outer
  //     stroke 15 / r 110.5, inner stroke 12 / r 88.5) ─────────────
  protected readonly outerC = 2 * Math.PI * 110.5;
  protected readonly innerC = 2 * Math.PI * 88.5;
  protected readonly kcalOver = computed(() => this.kcalConsumed() > this.kcalTarget());
  protected readonly kcalRemainingAbs = computed(() =>
    Math.abs(this.kcalTarget() - this.kcalConsumed()).toLocaleString(),
  );
  protected readonly calRingProgress = computed(() => {
    const tgt = this.kcalTarget();
    return tgt > 0 ? Math.min(1, Math.max(0, this.kcalConsumed() / tgt)) : 0;
  });
  protected readonly protRingProgress = computed(() => {
    const tgt = this.proteinTargetG();
    return tgt > 0 ? Math.min(1, Math.max(0, this.proteinConsumed() / tgt)) : 0;
  });

  protected readonly proteinTargetG = computed(() => this.store.proteinTarget());
  protected readonly proteinConsumed = computed(() => this.summary()?.totalProtein ?? 0);

  protected readonly carbsConsumed = computed(() => this.summary()?.totalCarbs ?? 0);
  protected readonly fatConsumed = computed(() => this.summary()?.totalFat ?? 0);

  protected readonly exercised = computed(() => this.summary()?.exercised ?? false);

  /** Stored and displayed in US fluid ounces. */
  protected readonly waterOz = computed(
    () => this.body.dailyWater()[this.dateKey()] ?? 0,
  );

  protected logTime(log: DailyLog): string {
    const locale = bcp47ForLang(this.translation.language());
    return log.date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }

  protected editLog(log: DailyLog): void {
    if (!this.editable()) return;
    this.haptic(10);
    this.entryForm.onTapMeal(log);
  }

  protected toggleExercise(): void {
    if (!this.editable()) return;
    this.haptic(10);
    void this.store.toggleDayExercise(this.dateKey());
  }

  protected addWaterOz(deltaOz: number): void {
    if (!this.editable()) return;
    this.haptic(10);
    void this.body.addWater(this.dateKey(), deltaOz);
  }

  protected readonly editingWater = signal(false);
  /** Editor input is in fl oz, not ml. */
  protected readonly waterEditInput = signal<number | null>(null);

  protected openWaterEditor(): void {
    if (!this.editable()) return;
    this.haptic(10);
    this.waterEditInput.set(this.waterOz());
    this.editingWater.set(true);
  }

  protected onWaterInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') { this.waterEditInput.set(null); return; }
    const n = Number(v);
    this.waterEditInput.set(Number.isNaN(n) ? null : n);
  }

  protected saveWater(): void {
    const oz = this.waterEditInput();
    if (oz == null || oz < 0) return;
    this.haptic(30);
    void this.body.setDailyWater(this.dateKey(), oz);
    this.editingWater.set(false);
  }

  protected clearWater(): void {
    this.haptic(30);
    void this.body.setDailyWater(this.dateKey(), 0);
    this.editingWater.set(false);
  }

  protected cancelWaterEdit(): void {
    this.editingWater.set(false);
  }

  // ─── Sleep (hours, canonical daily metric) ──────────────────────
  protected readonly sleepHoursVal = computed<number | null>(
    () => this.body.dailySleep()[this.dateKey()] ?? null,
  );

  /** A logged sleep value of 0 is treated as "none" (nobody logs 0h). */
  protected readonly hasSleep = computed(() => {
    const v = this.sleepHoursVal();
    return v != null && v > 0;
  });

  protected readonly sleepDisplay = computed(() =>
    this.hasSleep()
      ? `${this.sleepHoursVal()} ${this.translation.t('v2.daySummary.hours')}`
      : this.translation.t('v2.daySummary.weightNone'),
  );

  protected readonly editingSleep = signal(false);
  // Hold the raw input string (not a parsed number) so decimal entry like
  // "6.5" isn't normalized mid-keystroke by the value binding — parsing a
  // half-typed "6." back to 6 would drop the dot. Parsed only on save.
  protected readonly sleepEditInput = signal<string>('');

  protected openSleepEditor(): void {
    if (!this.editable()) return;
    this.haptic(10);
    this.sleepEditInput.set(this.hasSleep() ? String(this.sleepHoursVal()) : '');
    this.editingSleep.set(true);
  }

  protected onSleepInput(e: Event): void {
    this.sleepEditInput.set((e.target as HTMLInputElement).value);
  }

  protected saveSleep(): void {
    const raw = this.sleepEditInput().trim();
    if (raw === '') return;
    const h = Number(raw);
    if (Number.isNaN(h) || h < 0) return;
    this.haptic(30);
    void this.body.setDailySleep(this.dateKey(), h);
    this.editingSleep.set(false);
  }

  protected clearSleep(): void {
    this.haptic(30);
    void this.body.setDailySleep(this.dateKey(), 0);
    this.editingSleep.set(false);
  }

  protected cancelSleepEdit(): void {
    this.editingSleep.set(false);
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
