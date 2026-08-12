import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
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
import { AuthService } from '../../services/auth.service';
import { localDateKey } from '@macrolog/core';
import { bcp47ForLang } from '../../utils/locale';
import { missingBodyFatInputs, projectWeight, type WeightPoint } from '@macrolog/core';
import {
  MEASUREMENT_BOUNDS_IN,
  implausibleMeasurementFields,
  latestNavyBodyFat,
} from '@macrolog/core';
import { Measurement } from '../../services/firebase.service';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';
import { UiAvatar } from '../ui/avatar.component';
import { UiSparkline } from '../ui/sparkline.component';
import { UiWeightSheet } from '../ui/weight-sheet.component';

const FAST_HOURS = 16;
type MField = 'waist' | 'chest' | 'bicep' | 'hip' | 'neck';
const M_FIELDS: { key: MField; labelKey: string }[] = [
  { key: 'waist', labelKey: 'v2.body.fieldWaist' },
  { key: 'chest', labelKey: 'v2.body.fieldChest' },
  { key: 'bicep', labelKey: 'v2.body.fieldBicep' },
  { key: 'hip', labelKey: 'v2.body.fieldHip' },
  { key: 'neck', labelKey: 'body.fieldNeck' },
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
    UiAvatar,
    UiSparkline,
    UiWeightSheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto flex flex-col">
      <!-- Header: title + avatar only (mirrors mobile Body) -->
      <header class="flex items-center justify-between gap-4 pt-2 pb-2">
        <h1 class="page-title" style="font-family: var(--v2-font-display);">{{ t('v2.body.title') }}</h1>
        <ui-avatar
          [photoUrl]="authUser()?.photoURL ?? null"
          [name]="authUser()?.displayName || authUser()?.email || null"
          [ariaLabel]="t('v2.body.settingsAria')"
          (activate)="settingsRequested.emit()" />
      </header>

      <!-- ── Weight hero (dark panel, mirrors mobile) ─────────── -->
      <div class="mt-6" style="background: var(--v2-hero-panel); border-radius: var(--v2-radius-xl); padding: var(--v2-space-5) var(--v2-space-4); display: flex; flex-direction: column; align-items: center; gap: var(--v2-space-2); box-shadow: var(--v2-shadow-2);">
        <div style="display: flex; align-items: flex-end; gap: var(--v2-space-1);">
          @if (currentWeight(); as w) {
            <span style="font-family: var(--v2-font-display); font-weight: 800; font-size: 56px; line-height: 1; color: var(--v2-hero-text);">{{ w.toFixed(1) }}</span>
            <span style="font-size: 24px; color: var(--v2-hero-muted); margin-bottom: 6px;">{{ t('v2.body.lb') }}</span>
          } @else {
            <span style="font-family: var(--v2-font-display); font-weight: 800; font-size: 56px; line-height: 1; color: var(--v2-hero-muted);">—</span>
          }
        </div>
        <!-- Which day this number is from, not just "Weight". The tab's whole
             job is change over time, and a nine-day-old reading rendered
             identically to this morning's. Mobile has said this since launch. -->
        <span style="color: var(--v2-hero-muted); font-size: 14px;">{{
          currentWeight()
            ? (hasTodayWeight() ? t('v2.body.todayWeighIn') : t('v2.body.recentWeight'))
            : t('v2.body.noWeight')
        }}</span>

        @if (weightSeries().length >= 2) {
          <div class="mt-2">
            <ui-sparkline
              [values]="weightSeries()"
              [projection]="projectedSeries()"
              [width]="300"
              [height]="64"
              tone="ring"
              [ariaLabel]="t('v2.body.weightTrendAria')" />
          </div>
        }

        @if (projectionLabel(); as pl) {
          <span style="font-size: 14px; color: var(--v2-hero-muted); background: var(--v2-hero-track); border-radius: 999px; padding: 4px 12px; margin-top: 4px;">{{ pl }}</span>
        }

        @if (goal(); as g) {
          <div class="w-full mt-3">
            <div class="flex items-center justify-between mb-1.5" style="font-size: 12px; color: var(--v2-hero-muted);">
              <span>{{ g.startWeight.toFixed(1) }} {{ t('v2.body.lb') }}</span>
              <span style="color: var(--v2-hero-text);">{{ g.pct }}%</span>
              <span>{{ g.goalWeight.toFixed(1) }} {{ t('v2.body.lb') }}</span>
            </div>
            <div style="height: 8px; border-radius: 999px; background: var(--v2-hero-track); overflow: hidden;">
              <div [style.width.%]="g.pct" style="height: 100%; background: #ff6a3d; border-radius: 999px;"></div>
            </div>
            <p style="font-size: 12px; color: var(--v2-hero-muted); margin-top: 6px; text-align: center;">
              {{ g.remaining > 0 ? t('v2.body.remaining', { n: g.remaining.toFixed(1) }) : t('v2.body.goalReached') }}
            </p>
          </div>
        }
      </div>

      <!-- Full-width ink log-weight button -->
      <button type="button" (click)="openWeightSheet()" class="mt-3 w-full"
              style="background: var(--v2-ink); color: var(--v2-paper); border: none; border-radius: var(--v2-radius-md); padding: var(--v2-space-4); font-weight: 700; font-size: 20px; cursor: pointer;">
        {{ t('v2.body.logWeight') }}
      </button>

      <!-- ── Body fat (standalone card) ───────────────────────── -->
      <!-- Rendered even with nothing to show. Hiding the card until it could
           compute meant a user never learned the feature existed, let alone
           what it wanted — and the one message that did exist told everyone
           "waist + neck", which a woman can satisfy in full and still get
           nothing, because the Navy formula also needs hip. -->
      <ui-card variant="default" class="mt-4 block">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="section-title">{{ t('v2.body.bodyFatTitle') }}</h2>
            @if (bodyFatPct()) {
              <p class="v2-caption mt-0.5">{{ t('v2.body.bodyFatEstimate') }}</p>
              <p class="v2-caption mt-0.5" style="font-size: 0.7rem;">{{ t('v2.body.navyAccuracy') }}</p>
            } @else {
              <p class="v2-caption mt-0.5">{{ bodyFatHint() }}</p>
            }
          </div>
          <span class="v2-num" style="font-size: 2rem; font-weight: 700; color: var(--v2-ink);">{{ bodyFatPct() ? bodyFatPct() + '%' : '—' }}</span>
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
            <h2 class="section-title">{{ t('v2.body.measurements') }}</h2>
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
            <!-- Says what a tape measurement is FOR before asking for one.
                 Mirrors the mobile Body screen word for word (ADR-0015 parity);
                 nothing here explained why these fields exist. -->
            <p class="v2-caption mb-2">{{ t('v2.body.measureIntro') }}</p>
            <button type="button" class="v2-caption mb-3"
              style="background: none; border: none; padding: 0; cursor: pointer; color: var(--v2-accent); text-decoration: underline;"
              [attr.aria-expanded]="howOpen()"
              aria-controls="measure-how"
              (click)="howOpen.set(!howOpen())">
              {{ howOpen() ? t('v2.body.howToMeasureHide') : t('v2.body.howToMeasure') }}
            </button>
            @if (howOpen()) {
              <ul id="measure-how" class="mb-3 space-y-1">
                @for (line of HOW_LINES; track line) {
                  <li class="v2-caption" style="color: var(--v2-ink);">{{ t(line) }}</li>
                }
                <li class="v2-caption pt-1">{{ t('v2.body.howConsistency') }}</li>
              </ul>
            }
            @if (formOpen()) {
              <form (submit)="saveMeasurement($event)" novalidate class="space-y-3">
                <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.06em;">
                  {{ editingMeasurementId() ? t('v2.body.editMeasurement') : t('v2.body.addMeasurement') }}
                </p>
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
              @if (measurementHistory().length) {
                <ul class="space-y-2 mb-2">
                  @for (row of visibleMeasurementHistory(); track row.m.id) {
                    <li class="flex items-start justify-between gap-3 py-2"
                        style="border-bottom: 1px solid var(--v2-hairline);">
                      <div class="min-w-0">
                        <div class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.06em;">
                          {{ row.dateLabel }}
                        </div>
                        <div class="v2-num mt-0.5" style="color: var(--v2-ink); font-weight: 500;">
                          @for (f of M_FIELDS; track f.key) {
                            @if (row.m[f.key] != null) {
                              <span style="margin-right: 10px; white-space: nowrap;">
                                <span style="color: var(--v2-ink-muted); font-weight: 400;">{{ t(f.labelKey) }}</span>
                                {{ row.m[f.key] }}{{ t('v2.body.inch') }}
                              </span>
                            }
                          }
                        </div>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <button type="button" class="v2-icon-btn"
                          style="background: none; border: none; padding: 8px; cursor: pointer; color: var(--v2-ink-muted);"
                          [attr.aria-label]="t('v2.body.editMeasurementAria', { date: row.dateLabel })"
                          (click)="editMeasurement(row.m)">
                          <lucide-icon name="pencil" [size]="16" />
                        </button>
                        <button type="button" class="v2-icon-btn"
                          style="background: none; border: none; padding: 8px; cursor: pointer; color: var(--v2-ink-muted);"
                          [attr.aria-label]="t('v2.body.deleteMeasurementAria', { date: row.dateLabel })"
                          (click)="deleteMeasurement(row.m)">
                          <lucide-icon name="trash-2" [size]="16" />
                        </button>
                      </div>
                    </li>
                  }
                </ul>
                @if (measurementHistory().length > visibleMeasurementHistory().length || showAllMeasurements()) {
                  <button type="button"
                    class="v2-caption mb-4"
                    style="background: none; border: none; padding: 6px 0; cursor: pointer; color: var(--v2-accent, var(--v2-ink)); text-transform: uppercase; letter-spacing: 0.06em;"
                    (click)="showAllMeasurements.set(!showAllMeasurements())">
                    {{ showAllMeasurements()
                       ? t('v2.body.showLess')
                       : t('v2.body.showAllMeasurements', { n: measurementHistory().length }) }}
                  </button>
                }
              } @else {
                <p class="v2-caption mb-4">{{ t('v2.body.measurementsNone') }}</p>
              }
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
  private readonly auth = inject(AuthService);
  protected readonly authUser = this.auth.user;
  private readonly translation = inject(TranslationService);

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
  readonly bodyRequested = output<void>();

  protected readonly FAST_HOURS = FAST_HOURS;
  protected readonly M_FIELDS = M_FIELDS;
  /** Per-site technique, one line each. Same order and same copy as the mobile
   *  Body screen — this is the kind of guidance that goes stale in one place
   *  first, so keep the two lists edited together. */
  protected readonly HOW_LINES = [
    'v2.body.howWaist',
    'v2.body.howNeck',
    'v2.body.howHip',
    'v2.body.howChest',
    'v2.body.howBicep',
  ] as const;
  protected readonly howOpen = signal(false);
  protected readonly fastCircumference = 2 * Math.PI * 52;
  // Backdating beyond 48h would already be past any plausible fasting window.
  private readonly MAX_BACKDATE_HOURS = 48;

  protected readonly todayKey = signal(localDateKey(new Date()));
  protected readonly weightSheetOpen = signal(false);
  // Measurements + photos open by default to mirror mobile (which shows them
  // expanded with an inline "Add" link rather than behind a collapse).
  protected readonly expanded = signal(true);
  protected readonly fastingExpanded = signal(false);
  /** Auto-open the (otherwise collapsed) Fasting card whenever a fast is
   *  active, so the running timer is never hidden behind the chevron. */
  private readonly _autoExpandFast = effect(() => {
    if (this.fasting.isFasting()) this.fastingExpanded.set(true);
  });
  protected readonly formOpen = signal(false);

  // Inline fasting start-time editor — used both to backdate a new fast
  // ("started earlier") and to correct the start of an active one.
  protected readonly editing = signal(false);
  protected readonly editValue = signal('');
  protected readonly editError = signal('');
  protected readonly formValues = signal<Record<MField, number | null>>({
    waist: null, chest: null, bicep: null, hip: null, neck: null,
  });
  protected readonly formError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** Id of the measurement being edited, or null when adding a new one. */
  protected readonly editingMeasurementId = signal<string | null>(null);

  /** How many measurement rows show before "Show all" — keeps the card short
   *  as history accumulates; the rest are one tap away. */
  private readonly MEASURE_PREVIEW = 4;
  protected readonly showAllMeasurements = signal(false);

  /** Measurement history newest-first with a formatted date label per row.
   *  Newest-first (not the old oldest-first) so the capped preview shows the
   *  most recent entries — the ones a user actually reaches for. */
  protected readonly measurementHistory = computed(() =>
    this.body.measurements().map((m) => ({
      m,
      dateLabel: m.date.toLocaleDateString(bcp47ForLang(this.translation.language()), {
        year: 'numeric', month: 'short', day: 'numeric',
      }),
    })),
  );

  /** The rows actually rendered: the recent {@link MEASURE_PREVIEW} unless the
   *  user expanded the full list. */
  protected readonly visibleMeasurementHistory = computed(() => {
    const all = this.measurementHistory();
    return this.showAllMeasurements() ? all : all.slice(0, this.MEASURE_PREVIEW);
  });

  // ─── Live ticker for fasting progress ──────────────────────
  private readonly tick = signal(0);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  protected readonly currentWeight = computed(() => this.store.currentWeight());

  protected readonly weightSeries = computed<number[]>(() =>
    // Last 14 days, oldest → newest; empty days drop out (the sparkline
    // filters nullables itself). Windowing lives on the store facet.
    this.body.weightsForLastDays(14).map((p) => p.weightLb),
  );

  protected readonly goal = computed(() => this.store.goalProgress());

  /** U.S. Navy body-fat estimate from the latest measurement + profile.
   *  Null until a measurement carries waist + neck (and hip for female)
   *  and the profile has height + sex. */
  protected readonly bodyFatPct = computed(() => {
    const p = this.store.profile();
    if (!p?.sex || !p?.heightIn) return null;
    // Most recent measurement that actually carries the tape inputs — not just
    // the single newest, which may be a partial (bicep-only) entry.
    return latestNavyBodyFat(this.body.measurements(), p.sex, p.heightIn);
  });

  /** True when the headline weight is today's reading rather than an older
   *  one carried forward. */
  protected readonly hasTodayWeight = computed(
    () => this.body.dailyWeights()[localDateKey(new Date())] != null,
  );

  /** What the body-fat card asks for when it cannot compute: the profile
   *  fields, or the exact tape inputs still missing — named, so a user can
   *  act on it. */
  protected readonly bodyFatHint = computed(() => {
    const p = this.store.profile();
    if (!p?.sex || !p?.heightIn) return this.translation.t('v2.body.bfNeedProfile');
    const missing = missingBodyFatInputs(this.body.measurements(), p.sex);
    const names = missing.map((k) =>
      this.translation.t('v2.body.field' + k[0].toUpperCase() + k.slice(1)).toLowerCase(),
    );
    const fields = names.length <= 1
      ? names[0] ?? ''
      : `${names.slice(0, -1).join(', ')} ${this.translation.t('v2.body.listAnd')} ${names[names.length - 1]}`;
    return this.translation.t('v2.body.bfNeedFields', { fields });
  });

  // ─── Weight projection (linear fit, no AI) ─────────────────
  // Fit over a longer window than the 14-day sparkline so the trend
  // isn't dominated by this week's water-weight noise.
  private static readonly PROJECTION_WINDOW_DAYS = 28;
  private static readonly PROJECTION_CHART_DAYS = 7;

  private readonly weightPoints = computed<WeightPoint[]>(() =>
    this.body.weightsForLastDays(BodyComponent.PROJECTION_WINDOW_DAYS),
  );

  protected readonly projection = computed(() =>
    projectWeight(
      this.weightPoints(),
      this.store.profile()?.targetWeightLbs ?? this.store.profile()?.goalWeightLbs ?? null,
    ),
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
    this.editingMeasurementId.set(null);
    this.formValues.set({ waist: null, chest: null, bicep: null, hip: null, neck: null });
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected editMeasurement(m: Measurement): void {
    this.haptic(10);
    this.editingMeasurementId.set(m.id ?? null);
    this.formValues.set({
      waist: m.waist ?? null,
      chest: m.chest ?? null,
      bicep: m.bicep ?? null,
      hip: m.hip ?? null,
      neck: m.neck ?? null,
    });
    this.formError.set(null);
    this.formOpen.set(true);
  }

  protected async deleteMeasurement(m: Measurement): Promise<void> {
    if (!m.id || !confirm(this.translation.t('v2.body.deleteMeasurementConfirm'))) return;
    this.haptic(30);
    try {
      await this.body.deleteMeasurement(m.id);
    } catch {
      this.formError.set(this.translation.t('v2.body.measurementError'));
      this.haptic(50);
    }
  }

  protected cancelMeasurement(): void {
    this.formOpen.set(false);
    this.formError.set(null);
    this.editingMeasurementId.set(null);
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
    if (
      entry.waist == null && entry.chest == null && entry.bicep == null &&
      entry.hip == null && entry.neck == null
    ) {
      this.formError.set(this.translation.t('v2.body.measurementError'));
      this.haptic(50);
      return;
    }
    // Per-field plausibility (shared with mobile and mirrored in
    // firestore.rules). Catches a value typed into the wrong field — a 15in
    // chest is a neck reading, and it silently moves the body-fat estimate.
    const implausible = implausibleMeasurementFields(entry);
    if (implausible.length > 0) {
      const bad = implausible[0];
      const [lo, hi] = MEASUREMENT_BOUNDS_IN[bad];
      // Label comes from M_FIELDS, not a constructed key — `neck` is
      // `body.fieldNeck` while the rest are `v2.body.field*`.
      const labelKey = M_FIELDS.find((f) => f.key === bad)?.labelKey ?? '';
      this.formError.set(
        this.translation.t('v2.body.measurementRange', {
          field: labelKey ? this.translation.t(labelKey) : bad,
          min: lo,
          max: hi,
        }),
      );
      this.haptic(50);
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    this.haptic(30);
    try {
      const editId = this.editingMeasurementId();
      if (editId) {
        await this.body.updateMeasurement(editId, entry);
      } else {
        await this.body.addMeasurement(entry);
      }
      this.formOpen.set(false);
      this.editingMeasurementId.set(null);
      this.formValues.set({ waist: null, chest: null, bicep: null, hip: null, neck: null });
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
