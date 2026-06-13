import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
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
import { UiButton } from './button.component';
import { UiCard } from './card.component';
import { UiRing } from './ring.component';
import { UiWeightSheet } from './weight-sheet.component';

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
  imports: [LucideAngularModule, TranslocoDirective, UiButton, UiCard, UiRing, UiWeightSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <!-- Rings hero -->
    <div class="flex items-center justify-around gap-4 mt-6">
      <div class="flex flex-col items-center">
        <ui-ring
          [value]="kcalConsumed()"
          [target]="kcalTarget()"
          [size]="148"
          [stroke]="14"
          [tone]="kcalTone()"
          [ariaLabel]="t('v2.daySummary.kcalAria', { consumed: kcalConsumed(), target: kcalTarget() })">
          <span class="v2-num text-2xl font-semibold">{{ kcalRemaining() }}</span>
          <span class="v2-caption mt-0.5">{{ kcalRemainingLabel() }}</span>
        </ui-ring>
        <span class="v2-caption mt-2">{{ t('v2.daySummary.kcal') }}</span>
      </div>
      <div class="flex flex-col items-center">
        <ui-ring
          [value]="proteinConsumed()"
          [target]="proteinTargetG()"
          [size]="120"
          [stroke]="12"
          tone="sage"
          [ariaLabel]="t('v2.daySummary.proteinAria', { consumed: proteinConsumed(), target: proteinTargetG() })">
          <span class="v2-num text-xl font-semibold">{{ proteinConsumed() }}g</span>
          <span class="v2-caption mt-0.5">/ {{ proteinTargetG() }}g</span>
        </ui-ring>
        <span class="v2-caption mt-2">{{ t('v2.daySummary.protein') }}</span>
      </div>
    </div>

    <!-- Carbs + fat chips — hidden until the day has macro-carrying
         entries (older rows predate the carbs/fat fields, and a
         "0g · 0g" row would read as data rather than absence). -->
    @if (carbsConsumed() > 0 || fatConsumed() > 0) {
      <div class="flex justify-center gap-2 mt-4">
        <span class="v2-num v2-caption inline-flex items-center gap-1"
          style="padding: 4px 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: 999px; color: var(--v2-ink);">
          {{ t('entry.carbsChip', { n: carbsConsumed() }) }}
        </span>
        <span class="v2-num v2-caption inline-flex items-center gap-1"
          style="padding: 4px 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: 999px; color: var(--v2-ink);">
          {{ t('entry.fatChip', { n: fatConsumed() }) }}
        </span>
      </div>
    }

    <!-- Exercise toggle -->
    @if (editable()) {
      <div class="flex justify-center mt-4">
        <ui-button
          variant="ghost"
          size="sm"
          (click)="toggleExercise()"
          [attr.aria-pressed]="exercised()">
          @if (exercised()) {
            <lucide-icon name="check" [size]="16" style="color: var(--v2-sage)" />
          } @else {
            <lucide-icon name="footprints" [size]="16" />
          }
          {{ exercised() ? t('v2.daySummary.exercised') : t('v2.daySummary.didYouExercise') }}
        </ui-button>
      </div>
    } @else if (exercised()) {
      <div class="flex justify-center mt-4">
        <span class="v2-caption inline-flex items-center gap-1.5">
          <lucide-icon name="check" [size]="14" style="color: var(--v2-sage)" />
          {{ t('v2.daySummary.exercised') }}
        </span>
      </div>
    }

    <!-- Entries list, grouped by diary slot. Days with no slotted
         entries (every row pre-dates mealType) render as one flat
         heading-less group, so legacy history looks unchanged. -->
    @if (dayLogs().length > 0) {
      <h2 class="v2-h3 mt-8 mb-3">{{ entriesHeading() }}</h2>
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

    <!-- Water row -->
    <ui-card variant="flat" class="mt-6 block">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <lucide-icon name="droplets" [size]="18" style="color: var(--v2-ink-muted)" />
          @if (editable()) {
            <button
              type="button"
              class="v2-body-soft"
              style="background: none; border: none; padding: 0; cursor: pointer; text-align: left;"
              [attr.aria-label]="t('v2.daySummary.editWaterAria', { value: waterDisplay() })"
              (click)="openWaterEditor()">
              {{ t('v2.daySummary.water') }} · <span class="v2-num" style="color: var(--v2-ink); font-weight: 500;">{{ waterDisplay() }}</span>
              <lucide-icon name="pencil" [size]="12" style="color: var(--v2-ink-muted); margin-left: 4px;" />
            </button>
          } @else {
            <span class="v2-body-soft">
              {{ t('v2.daySummary.water') }} · <span class="v2-num" style="color: var(--v2-ink); font-weight: 500;">{{ waterDisplay() }}</span>
            </span>
          }
        </div>
      </div>
      @if (editable()) {
        @if (editingWater()) {
          <div class="mt-3 space-y-2">
            <label class="v2-caption block" style="text-transform: uppercase; letter-spacing: 0.06em;">
              {{ t('v2.daySummary.setExactMl') }}
            </label>
            <div class="flex flex-wrap gap-2 items-center">
              <input
                type="number"
                inputmode="numeric"
                step="50"
                min="0"
                max="20000"
                class="v2-field v2-field--num"
                style="max-width: 140px;"
                [value]="waterEditInput() ?? ''"
                (input)="onWaterInput($event)"
                (keydown.enter)="saveWater()" />
              <ui-button variant="primary" size="sm" (click)="saveWater()">{{ t('v2.daySummary.save') }}</ui-button>
              <ui-button variant="ghost" size="sm" (click)="cancelWaterEdit()">{{ t('v2.daySummary.cancel') }}</ui-button>
              <ui-button variant="ghost" size="sm" (click)="clearWater()">{{ t('v2.daySummary.clear') }}</ui-button>
            </div>
          </div>
        } @else {
          <div class="flex flex-wrap gap-2 mt-3">
            <ui-button variant="ghost" size="sm" (click)="addWater(250)">{{ t('v2.daySummary.addMl', { n: 250 }) }}</ui-button>
            <ui-button variant="ghost" size="sm" (click)="addWater(500)">{{ t('v2.daySummary.addMl', { n: 500 }) }}</ui-button>
            <ui-button variant="ghost" size="sm" (click)="addWater(1000)">{{ t('v2.daySummary.addLiter') }}</ui-button>
          </div>
        }
      }
    </ui-card>

    <!-- Weight row -->
    <ui-card variant="flat" class="mt-3 block">
      <div class="flex items-center justify-between gap-3" style="min-height: var(--v2-tap-min);">
        <div class="flex items-center gap-2 min-w-0">
          <lucide-icon name="scale" [size]="18" style="color: var(--v2-ink-muted)" />
          @if (editable() && loggedWeight() == null) {
            <button
              type="button"
              class="v2-body-soft"
              style="background: none; border: none; padding: 0; cursor: pointer; text-align: left;"
              [attr.aria-label]="t('v2.daySummary.logWeightAria')"
              (click)="openWeightSheet()">
              {{ t('v2.daySummary.weight') }} · <span class="v2-num" style="color: var(--v2-ink-muted); font-weight: 500;">{{ t('v2.daySummary.weightNone') }}</span>
              <lucide-icon name="pencil" [size]="12" style="color: var(--v2-ink-muted); margin-left: 4px;" />
            </button>
          } @else {
            <span class="v2-body-soft">
              {{ t('v2.daySummary.weight') }} ·
              @if (loggedWeight() != null) {
                <span class="v2-num" style="color: var(--v2-ink); font-weight: 500;">{{ loggedWeight() }} {{ t('v2.daySummary.lb') }}</span>
              } @else {
                <span class="v2-num" style="color: var(--v2-ink-muted); font-weight: 500;">{{ t('v2.daySummary.weightNone') }}</span>
              }
            </span>
          }
        </div>
        @if (editable() && loggedWeight() != null) {
          <button
            type="button"
            class="v2-icon-btn"
            style="background: none; border: none; padding: 6px; cursor: pointer; color: var(--v2-ink-muted); display: inline-flex; align-items: center; justify-content: center;"
            [attr.aria-label]="t('v2.daySummary.editWeightAria', { value: loggedWeight() })"
            (click)="openWeightSheet()">
            <lucide-icon name="pencil" [size]="14" />
          </button>
        }
      </div>
    </ui-card>

    <ui-weight-sheet
      [open]="weightSheetOpen()"
      [dateKey]="dateKey()"
      (close)="weightSheetOpen.set(false)" />
    </ng-container>
  `,
})
export class UiDaySummary {
  protected readonly store = inject(FitnessStore);
  protected readonly body = inject(BodyMetricStore);
  private readonly entryForm = inject(EntryFormManager);
  private readonly translation = inject(TranslationService);

  readonly dateKey = input.required<string>();
  readonly editable = input<boolean>(true);

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

  protected readonly proteinTargetG = computed(() => this.store.proteinTarget());
  protected readonly proteinConsumed = computed(() => this.summary()?.totalProtein ?? 0);

  protected readonly carbsConsumed = computed(() => this.summary()?.totalCarbs ?? 0);
  protected readonly fatConsumed = computed(() => this.summary()?.totalFat ?? 0);

  protected readonly exercised = computed(() => this.summary()?.exercised ?? false);

  protected readonly waterMl = computed(
    () => this.body.dailyWater()[this.dateKey()] ?? 0,
  );

  protected readonly weightSheetOpen = signal(false);

  protected readonly loggedWeight = computed<number | null>(() => {
    const w = this.body.dailyWeights()[this.dateKey()];
    return typeof w === 'number' ? w : null;
  });

  protected openWeightSheet(): void {
    if (!this.editable()) return;
    this.haptic(10);
    this.weightSheetOpen.set(true);
  }
  protected readonly waterDisplay = computed(() => {
    const ml = this.waterMl();
    const unitMl = this.translation.t('v2.daySummary.ml');
    const unitL = this.translation.t('v2.daySummary.liter');
    if (ml === 0) return `0 ${unitMl}`;
    if (ml < 1000) return `${ml} ${unitMl}`;
    return `${(ml / 1000).toFixed(1)} ${unitL}`;
  });

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

  protected addWater(deltaMl: number): void {
    if (!this.editable()) return;
    this.haptic(10);
    void this.body.addWater(this.dateKey(), deltaMl);
  }

  protected readonly editingWater = signal(false);
  protected readonly waterEditInput = signal<number | null>(null);

  protected openWaterEditor(): void {
    if (!this.editable()) return;
    this.haptic(10);
    this.waterEditInput.set(this.waterMl());
    this.editingWater.set(true);
  }

  protected onWaterInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') { this.waterEditInput.set(null); return; }
    const n = Number(v);
    this.waterEditInput.set(Number.isNaN(n) ? null : n);
  }

  protected saveWater(): void {
    const n = this.waterEditInput();
    if (n == null || n < 0) return;
    this.haptic(30);
    void this.body.setDailyWater(this.dateKey(), Math.round(n));
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

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
