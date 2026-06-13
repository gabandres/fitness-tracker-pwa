import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { FastingStore } from '../../services/fasting-store.service';
import { BodyMetricStore } from '../../services/body-metric-store.service';
import { TranslationService } from '../../services/translation.service';
import { addDays, localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { projectWeight, type WeightPoint } from '../../utils/weekly-insights';
import { Measurement } from '../../services/firebase.service';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';
import { UiIconButton } from '../ui/icon-button.component';
import { UiSparkline } from '../ui/sparkline.component';
import { UiWeightSheet } from '../ui/weight-sheet.component';
import { UiFastingPill } from '../ui/fasting-pill.component';

const FAST_HOURS = 16;
type MField = 'waist' | 'chest' | 'bicep' | 'hip';
const M_FIELDS: { key: MField; labelKey: string }[] = [
  { key: 'waist', labelKey: 'v2.body.fieldWaist' },
  { key: 'chest', labelKey: 'v2.body.fieldChest' },
  { key: 'bicep', labelKey: 'v2.body.fieldBicep' },
  { key: 'hip', labelKey: 'v2.body.fieldHip' },
];

/**
 * v2 Body — stacked single-page surface. Three sections:
 *  1. Weight: current value, 14d sparkline, goal-progress bar, log button.
 *  2. Fasting: compact ring + start/end action.
 *  3. Measurements: collapsed by default, inline form when expanded.
 *
 * Replaces the Week-4 placeholder that wrapped v1 components.
 */
@Component({
  selector: 'app-body',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    UiCard,
    UiButton,
    UiIconButton,
    UiSparkline,
    UiWeightSheet,
    UiFastingPill,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-28">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">{{ t('v2.body.title') }}</h1>
          <p class="v2-caption mt-0.5">{{ t('v2.body.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <ui-fasting-pill (bodyRequested)="bodyRequested.emit()" />
          <ui-icon-button icon="calendar" [ariaLabel]="t('v2.body.historyAria')" (click)="historyRequested.emit()" />
          <ui-icon-button icon="settings" [ariaLabel]="t('v2.body.settingsAria')" (click)="settingsRequested.emit()" />
        </div>
      </header>

      <!-- ── Weight ──────────────────────────────────────────── -->
      <ui-card variant="default" class="mt-6 block">
        <div class="flex items-baseline justify-between gap-3 mb-3">
          <h2 class="v2-h2">{{ t('v2.body.weight') }}</h2>
          <ui-button variant="secondary" size="sm" (click)="openWeightSheet()">
            <lucide-icon name="plus" [size]="14" />
            {{ t('v2.body.logWeight') }}
          </ui-button>
        </div>

        <div class="flex items-baseline gap-2">
          @if (currentWeight(); as w) {
            <span class="v2-num" style="font-size: 2.5rem; line-height: 1; font-weight: 600;">
              {{ w.toFixed(1) }}
            </span>
            <span class="v2-caption" style="font-size: 0.875rem;">{{ t('v2.body.lb') }}</span>
          } @else {
            <span class="v2-num" style="font-size: 2.5rem; line-height: 1; color: var(--v2-ink-muted);">—</span>
            <span class="v2-caption" style="font-size: 0.875rem;">{{ t('v2.body.noWeight') }}</span>
          }
        </div>

        <div class="mt-4">
          <ui-sparkline
            [values]="weightSeries()"
            [projection]="projectedSeries()"
            [width]="280"
            [height]="56"
            tone="accent"
            [ariaLabel]="t('v2.body.weightTrendAria')" />
          @if (projectionLabel(); as pl) {
            <p class="v2-caption mt-2 inline-flex items-center gap-1.5">
              <lucide-icon name="trending-up" [size]="13" style="color: var(--v2-ink-muted)" />
              {{ pl }}
            </p>
          }
        </div>

        @if (goal(); as g) {
          <div class="mt-5">
            <div class="flex items-center justify-between v2-caption mb-1.5">
              <span>{{ g.startWeight.toFixed(1) }} {{ t('v2.body.lb') }}</span>
              <span style="color: var(--v2-ink)">{{ g.pct }}%</span>
              <span>{{ g.goalWeight.toFixed(1) }} {{ t('v2.body.lb') }}</span>
            </div>
            <div class="v2-progress" role="progressbar"
              [attr.aria-valuemin]="0"
              [attr.aria-valuemax]="100"
              [attr.aria-valuenow]="g.pct">
              <div class="v2-progress__fill" [style.width.%]="g.pct"></div>
            </div>
            <p class="v2-caption mt-1.5">
              {{ g.remaining > 0 ? t('v2.body.remaining', { n: g.remaining.toFixed(1) }) : t('v2.body.goalReached') }}
            </p>
          </div>
        }

        <ui-button
          variant="ghost"
          size="sm"
          [block]="true"
          [disabled]="true"
          [ariaLabel]="t('v2.body.takePhotoComingAria')">
          <span title="Coming in v2.0" style="display:inline-flex; align-items:center; gap:6px;">
            <lucide-icon name="camera" [size]="14" />
            {{ t('v2.body.takePhoto') }}
            <span class="v2-caption" style="opacity: 0.6;">{{ t('v2.body.takePhotoSoon') }}</span>
          </span>
        </ui-button>
      </ui-card>

      <!-- ── Fasting ─────────────────────────────────────────── -->
      <ui-card variant="default" class="mt-4 block">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="v2-h2">{{ t('v2.body.fasting') }}</h2>
          @if (fasting.isFasting()) {
            <span class="v2-num" style="font-size: 0.8125rem; color: var(--v2-sage); font-weight: 600;">{{ t('v2.body.active') }}</span>
          } @else {
            <span class="v2-caption">{{ t('v2.body.idle') }}</span>
          }
        </div>

        <div class="mt-4 flex flex-col items-center">
          <!-- Compact ring: 120px, fills clockwise to 16h target. -->
          <div class="relative" style="width: 120px; height: 120px;">
            <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" fill="none"
                stroke="var(--v2-rule)" stroke-width="6" />
              @if (fasting.isFasting()) {
                <circle cx="60" cy="60" r="52" fill="none"
                  [attr.stroke]="elapsedHours() >= FAST_HOURS ? 'var(--v2-sage)' : 'var(--v2-accent)'"
                  stroke-width="6" stroke-linecap="round"
                  [attr.stroke-dasharray]="fastCircumference"
                  [attr.stroke-dashoffset]="fastDashOffset()"
                  style="transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset 600ms var(--v2-ease);" />
              }
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="v2-num" style="font-size: 1.5rem; font-weight: 600; line-height: 1;">
                {{ fasting.isFasting() ? elapsedDisplay() : '—' }}
              </span>
              <span class="v2-caption" style="font-size: 0.6875rem; margin-top: 2px;">
                {{ fasting.isFasting() ? t('v2.body.ofHours', { n: FAST_HOURS }) : t('v2.body.hourTarget', { n: FAST_HOURS }) }}
              </span>
            </div>
          </div>

          <div class="mt-5 w-full">
            @if (fasting.isFasting()) {
              @if (!editing()) {
                <p class="v2-caption text-center mb-3" style="font-size: 0.75rem;">
                  {{ t('v2.body.startedAt', { time: startTimeLabel() }) }}
                  <button type="button" (click)="beginEdit()"
                    [attr.aria-label]="t('v2.body.editStartAria')"
                    class="ml-1 underline"
                    style="background: none; border: none; padding: 0; cursor: pointer; color: var(--v2-ink-muted); font: inherit;">
                    {{ t('v2.body.edit') }}
                  </button>
                </p>
                <ui-button variant="destructive" [block]="true" (click)="endFast()">
                  {{ t('v2.body.endFast') }}
                </ui-button>
              } @else {
                <p class="v2-caption text-center mb-2" style="font-size: 0.75rem;">
                  {{ t('v2.body.editStartActivePrompt') }}
                </p>
                <div class="flex items-center justify-center mb-2">
                  <input type="time" [value]="editValue()"
                    (input)="editValue.set($any($event.target).value)"
                    [attr.aria-label]="t('v2.body.fastStartTimeAria')"
                    [attr.aria-invalid]="editError() ? 'true' : null"
                    [attr.aria-describedby]="editError() ? 'v2-fast-edit-error' : null"
                    class="v2-num"
                    style="font-size: 1rem; padding: 8px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); background: var(--v2-paper); color: var(--v2-ink); min-height: var(--v2-tap-min);" />
                </div>
                @if (editError()) {
                  <p id="v2-fast-edit-error" role="alert"
                    class="v2-caption text-center mb-2"
                    style="font-size: 0.75rem; color: var(--v2-danger);">
                    {{ editError() }}
                  </p>
                }
                <div class="flex items-center justify-center gap-2">
                  <ui-button variant="ghost" (click)="cancelEdit()">{{ t('v2.body.cancel') }}</ui-button>
                  <ui-button variant="primary" (click)="commitEdit()">{{ t('v2.body.save') }}</ui-button>
                </div>
              }
            } @else {
              @if (!editing()) {
                <ui-button variant="primary" [block]="true" (click)="startFast()">
                  <lucide-icon name="timer" [size]="16" />
                  {{ t('v2.body.startFast') }}
                </ui-button>
                <p class="text-center mt-2">
                  <button type="button" (click)="beginEdit()"
                    class="v2-caption underline"
                    style="background: none; border: none; padding: 0; cursor: pointer; color: var(--v2-ink-muted); font-size: 0.75rem;">
                    {{ t('v2.body.startedEarlier') }}
                  </button>
                </p>
              } @else {
                <p class="v2-caption text-center mb-2" style="font-size: 0.75rem;">
                  {{ t('v2.body.editStartIdlePrompt') }}
                </p>
                <div class="flex items-center justify-center mb-2">
                  <input type="time" [value]="editValue()"
                    (input)="editValue.set($any($event.target).value)"
                    [attr.aria-label]="t('v2.body.fastStartTimeAria')"
                    [attr.aria-invalid]="editError() ? 'true' : null"
                    [attr.aria-describedby]="editError() ? 'v2-fast-edit-error' : null"
                    class="v2-num"
                    style="font-size: 1rem; padding: 8px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); background: var(--v2-paper); color: var(--v2-ink); min-height: var(--v2-tap-min);" />
                </div>
                @if (editError()) {
                  <p id="v2-fast-edit-error" role="alert"
                    class="v2-caption text-center mb-2"
                    style="font-size: 0.75rem; color: var(--v2-danger);">
                    {{ editError() }}
                  </p>
                }
                <div class="flex items-center justify-center gap-2">
                  <ui-button variant="ghost" (click)="cancelEdit()">{{ t('v2.body.cancel') }}</ui-button>
                  <ui-button variant="primary" (click)="commitEdit()">{{ t('v2.body.startFast') }}</ui-button>
                </div>
              }
            }
          </div>
        </div>
      </ui-card>

      <!-- ── Measurements ────────────────────────────────────── -->
      <ui-card variant="default" class="mt-4 block">
        <button
          type="button"
          class="flex items-center justify-between gap-3 w-full"
          style="background: none; border: none; padding: 0; cursor: pointer; min-height: var(--v2-tap-min);"
          [attr.aria-expanded]="expanded()"
          aria-controls="measurements-panel"
          (click)="toggleExpanded()">
          <div class="flex items-baseline gap-3">
            <h2 class="v2-h2">{{ t('v2.body.measurements') }}</h2>
            <span class="v2-caption">{{ summaryLabel() }}</span>
          </div>
          <lucide-icon
            name="chevron-down"
            [size]="20"
            [style.transform]="expanded() ? 'rotate(180deg)' : 'rotate(0deg)'"
            style="transition: transform 200ms var(--v2-ease); color: var(--v2-ink-muted)" />
        </button>

        @if (expanded()) {
          <div id="measurements-panel" class="mt-4">
            @if (body.latestMeasurement(); as m) {
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                @for (f of M_FIELDS; track f.key) {
                  @if (m[f.key] != null) {
                    <div>
                      <div class="v2-num" style="font-size: 1.125rem; font-weight: 600; color: var(--v2-ink)">
                        {{ m[f.key] }}
                        @if (deltaFor(f.key); as d) {
                          <span class="v2-num"
                            [style.color]="d < 0 ? 'var(--v2-sage)' : d > 0 ? 'var(--v2-accent)' : 'var(--v2-ink-muted)'"
                            style="font-size: 0.75rem; margin-left: 4px;">
                            {{ d > 0 ? '+' : '' }}{{ formatDelta(d) }}
                          </span>
                        }
                      </div>
                      <div class="v2-caption mt-0.5" style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em;">
                        {{ t(f.labelKey) }}
                      </div>
                    </div>
                  }
                }
              </div>
            }

            @if (formOpen()) {
              <form (submit)="saveMeasurement($event)" novalidate class="space-y-3">
                <div class="grid grid-cols-2 gap-3">
                  @for (f of M_FIELDS; track f.key) {
                    <div>
                      <label class="v2-caption block mb-1" style="text-transform: uppercase; letter-spacing: 0.06em;">
                        {{ t('v2.body.fieldUnit', { label: t(f.labelKey) }) }}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        inputmode="decimal"
                        class="v2-field v2-field--num"
                        [value]="formValues()[f.key] ?? ''"
                        (input)="onMeasurementInput(f.key, $event)" />
                    </div>
                  }
                </div>
                @if (formError()) {
                  <p class="v2-caption" role="alert" style="color: var(--v2-danger)">{{ formError() }}</p>
                }
                <div class="flex gap-2 pt-1">
                  <ui-button variant="ghost" (click)="cancelMeasurement()">{{ t('v2.body.cancel') }}</ui-button>
                  <ui-button type="submit" variant="primary" [block]="true" [disabled]="saving()">
                    @if (saving()) { {{ t('v2.body.saving') }} } @else { {{ t('v2.body.save') }} }
                  </ui-button>
                </div>
              </form>
            } @else {
              <ui-button variant="secondary" size="sm" [block]="true" (click)="openMeasurementForm()">
                <lucide-icon name="plus" [size]="14" />
                {{ t('v2.body.addMeasurement') }}
              </ui-button>
            }
          </div>
        }
      </ui-card>

      <!-- Weight log sheet -->
      <ui-weight-sheet
        [open]="weightSheetOpen()"
        [dateKey]="todayKey()"
        (close)="weightSheetOpen.set(false)" />
    </section>
    </ng-container>
  `,
})
export class BodyComponent implements OnInit, OnDestroy {
  protected readonly store = inject(FitnessStore);
  protected readonly fasting = inject(FastingStore);
  protected readonly body = inject(BodyMetricStore);
  private readonly translation = inject(TranslationService);

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
  readonly bodyRequested = output<void>();

  protected readonly FAST_HOURS = FAST_HOURS;
  protected readonly M_FIELDS = M_FIELDS;
  protected readonly fastCircumference = 2 * Math.PI * 52;
  // Backdating beyond 48h would already be past any plausible fasting window.
  private readonly MAX_BACKDATE_HOURS = 48;

  protected readonly todayKey = signal(localDateKey(new Date()));
  protected readonly weightSheetOpen = signal(false);
  protected readonly expanded = signal(false);
  protected readonly formOpen = signal(false);

  // Inline fasting start-time editor — used both to backdate a new fast
  // ("started earlier") and to correct the start of an active one.
  protected readonly editing = signal(false);
  protected readonly editValue = signal('');
  protected readonly editError = signal('');
  protected readonly formValues = signal<Record<MField, number | null>>({
    waist: null, chest: null, bicep: null, hip: null,
  });
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);

  // ─── Live ticker for fasting progress ──────────────────────
  private readonly tick = signal(0);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  protected readonly currentWeight = computed(() => this.store.currentWeight());

  protected readonly weightSeries = computed<number[]>(() => {
    // Last 14 days, oldest → newest, with EMA fallback so missed days
    // don't leave the sparkline jumping. Empty days drop out (the
    // sparkline filters nullables itself).
    const map = this.body.dailyWeights();
    const today = new Date();
    const series: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const v = map[localDateKey(d)];
      if (typeof v === 'number') series.push(v);
    }
    return series;
  });

  protected readonly goal = computed(() => this.store.goalProgress());

  // ─── Weight projection (linear fit, no AI) ─────────────────
  // Fit over a longer window than the 14-day sparkline so the trend
  // isn't dominated by this week's water-weight noise.
  private static readonly PROJECTION_WINDOW_DAYS = 28;
  private static readonly PROJECTION_CHART_DAYS = 7;

  private readonly weightPoints = computed<WeightPoint[]>(() => {
    const map = this.body.dailyWeights();
    const today = new Date();
    const out: WeightPoint[] = [];
    for (let i = BodyComponent.PROJECTION_WINDOW_DAYS - 1; i >= 0; i--) {
      const key = localDateKey(addDays(today, -i));
      const v = map[key];
      if (typeof v === 'number') out.push({ dateKey: key, weightLb: v });
    }
    return out;
  });

  protected readonly projection = computed(() =>
    projectWeight(this.weightPoints(), this.store.profile()?.goalWeightLbs ?? null),
  );

  /** Dashed forecast for the sparkline: step from the last plotted
   *  weight along the fitted slope so the dashed line joins the solid
   *  one. Empty (no dashes) when there's no trend to project. */
  protected readonly projectedSeries = computed<number[]>(() => {
    const p = this.projection();
    const series = this.weightSeries();
    if (!p || series.length < 2) return [];
    const last = series[series.length - 1];
    const perDay = p.slopeLbPerWeek / 7;
    return Array.from(
      { length: BodyComponent.PROJECTION_CHART_DAYS },
      (_, k) => +(last + perDay * (k + 1)).toFixed(1),
    );
  });

  /** One-line projection caption. Prefers a concrete goal date; falls
   *  back to the bare weekly trend; "holding steady" when essentially
   *  flat (< 0.1 lb/wk either way). Null when there's no fit. */
  protected readonly projectionLabel = computed<string | null>(() => {
    const p = this.projection();
    if (!p) return null;
    const slope = p.slopeLbPerWeek;
    if (Math.abs(slope) < 0.1) return this.translation.t('body.projectionSteady');
    if (p.goalDateKey) {
      const goal = this.store.goalProgress()?.goalWeight;
      return this.translation.t('body.projectionGoalDate', {
        weight: goal != null ? goal.toFixed(0) : '',
        date: this.formatProjectionDate(p.goalDateKey),
      });
    }
    const signed = slope > 0 ? `+${slope.toFixed(1)}` : slope.toFixed(1);
    return this.translation.t('body.projectionRate', { n: signed });
  });

  private formatProjectionDate(dateKey: string): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(
      bcp47ForLang(this.translation.language()),
      { month: 'short', day: 'numeric', year: 'numeric' },
    );
  }

  protected readonly elapsedHours = computed<number>(() => {
    this.tick();
    const start = this.fasting.fastStartedAt();
    if (!start) return 0;
    return Math.max(0, (Date.now() - start.getTime()) / 3_600_000);
  });

  protected readonly elapsedDisplay = computed(() => {
    const h = this.elapsedHours();
    const totalMin = Math.floor(h * 60);
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return `${hh}:${mm.toString().padStart(2, '0')}`;
  });

  protected readonly fastDashOffset = computed(() => {
    const fraction = Math.min(1, this.elapsedHours() / FAST_HOURS);
    return this.fastCircumference * (1 - fraction);
  });

  protected readonly startTimeLabel = computed(() => {
    const start = this.fasting.fastStartedAt();
    if (!start) return '';
    const locale = bcp47ForLang(this.translation.language());
    return start
      .toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
      .toLowerCase();
  });

  protected readonly summaryLabel = computed(() => {
    const m = this.body.latestMeasurement();
    if (!m) return this.translation.t('v2.body.measurementsNone');
    const d = new Date(m.date);
    const locale = bcp47ForLang(this.translation.language());
    const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    return this.translation.t('v2.body.measurementsLastLogged', { date });
  });

  ngOnInit(): void {
    // 30s ticker is enough — display is hh:mm.
    this.intervalId = setInterval(() => this.tick.update((n) => n + 1), 30_000);
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }

  protected openWeightSheet(): void {
    this.haptic(10);
    this.weightSheetOpen.set(true);
  }

  protected toggleExpanded(): void {
    this.haptic(10);
    this.expanded.update((v) => !v);
  }

  protected openMeasurementForm(): void {
    this.haptic(10);
    this.formValues.set({ waist: null, chest: null, bicep: null, hip: null });
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected cancelMeasurement(): void {
    this.formOpen.set(false);
    this.formError.set(null);
  }

  protected onMeasurementInput(key: MField, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    const n = v === '' ? null : Number(v);
    this.formValues.update((vals) => ({ ...vals, [key]: Number.isNaN(n) ? null : n }));
  }

  protected async saveMeasurement(e: Event): Promise<void> {
    e.preventDefault();
    const vals = this.formValues();
    const entry: Omit<Measurement, 'id' | 'date'> = {};
    for (const f of M_FIELDS) {
      if (vals[f.key] != null) entry[f.key] = vals[f.key]!;
    }
    if (entry.waist == null && entry.chest == null && entry.bicep == null && entry.hip == null) {
      this.formError.set(this.translation.t('v2.body.measurementError'));
      this.haptic(50);
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    this.haptic(30);
    try {
      await this.body.addMeasurement(entry);
      this.formOpen.set(false);
      this.formValues.set({ waist: null, chest: null, bicep: null, hip: null });
    } catch (err) {
      this.formError.set(err instanceof Error ? err.message : 'Could not save measurement.');
    } finally {
      this.saving.set(false);
    }
  }

  protected deltaFor(key: MField): number | null {
    const d = this.body.measurementDeltas();
    return d?.[key] ?? null;
  }

  protected formatDelta(d: number): string {
    return Math.abs(d) < 0.05 ? '0' : d.toFixed(1);
  }

  protected async startFast(): Promise<void> {
    this.haptic(30);
    await this.fasting.startFast();
  }

  protected async endFast(): Promise<void> {
    this.haptic(50);
    await this.fasting.breakFast();
  }

  protected beginEdit(): void {
    this.haptic(10);
    const start = this.fasting.fastStartedAt() ?? new Date();
    this.editValue.set(this.toTimeInputValue(start));
    this.editError.set('');
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.editError.set('');
  }

  protected async commitEdit(): Promise<void> {
    const parsed = this.parseEditValue(this.editValue());
    if (!parsed) {
      this.editError.set(this.translation.t('v2.body.editStartInvalid'));
      this.haptic(50);
      return;
    }
    this.haptic(30);
    await this.fasting.startFast(parsed);
    this.editing.set(false);
    this.editError.set('');
  }

  private toTimeInputValue(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Parse "HH:MM" as "today at that local time". If that's later than now,
   * roll back to yesterday (handles late-night entries like 5:15pm at 1am).
   * Reject anything older than MAX_BACKDATE_HOURS.
   */
  private parseEditValue(v: string): Date | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const now = new Date();
    const candidate = new Date(now);
    candidate.setHours(hh, mm, 0, 0);
    if (candidate.getTime() > now.getTime()) {
      candidate.setDate(candidate.getDate() - 1);
      // Re-apply wall-clock so a DST boundary doesn't shift the hour by ±1.
      candidate.setHours(hh, mm, 0, 0);
    }
    const ageMs = now.getTime() - candidate.getTime();
    if (ageMs > this.MAX_BACKDATE_HOURS * 60 * 60 * 1000) return null;
    return candidate;
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
