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
import { SubscriptionService } from '../../services/subscription.service';
import { UpsellService } from '../../services/upsell.service';
import { AuthService } from '../../services/auth.service';
import { addDays, localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { projectWeight, type WeightPoint } from '../../utils/weekly-insights';
import { resizeToJpegBlob } from '../../utils/resize-image';
import { latestNavyBodyFat } from '@macrolog/core';
import { Measurement } from '../../services/firebase.service';
import {
  ProgressPhotoService,
  type ProgressPhoto,
} from '../../services/progress-photo.service';
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
        <span style="color: var(--v2-hero-muted); font-size: 14px;">{{ currentWeight() ? t('v2.body.weight') : t('v2.body.noWeight') }}</span>

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
      @if (bodyFatPct(); as bf) {
        <ui-card variant="default" class="mt-4 block">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="section-title">{{ t('v2.body.bodyFatTitle') }}</h2>
              <p class="v2-caption mt-0.5">{{ t('v2.body.bodyFatEstimate') }}</p>
            </div>
            <span class="v2-num" style="font-size: 2rem; font-weight: 700; color: var(--v2-ink);">{{ bf }}%</span>
          </div>
        </ui-card>
      }

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

      <!-- ── Progress photos (ADR-0010) — owner-private, getBlob only, Pro-gated.
           Collapsed by default so a Pro gallery never dominates the tab. -->
      <ui-card variant="default" class="mt-4 block">
        <button
          type="button"
          class="flex items-center justify-between gap-3 w-full"
          style="background: none; border: none; padding: 0; cursor: pointer; min-height: var(--v2-tap-min);"
          [attr.aria-expanded]="photosExpanded()"
          aria-controls="photos-panel"
          (click)="photosExpanded.set(!photosExpanded())">
          <div class="flex items-baseline gap-3">
            <h2 class="section-title">{{ t('body.photosTitle') }}</h2>
            @if (photos().length) {
              <span class="v2-caption">{{ photos().length }}</span>
            }
          </div>
          <lucide-icon
            name="chevron-down"
            [size]="20"
            [style.transform]="photosExpanded() ? 'rotate(180deg)' : 'rotate(0deg)'"
            style="transition: transform 200ms var(--v2-ease); color: var(--v2-ink-muted)" />
        </button>

        @if (photosExpanded()) {
          <div id="photos-panel" class="mt-4">
            @if (subs.isPaid()) {
              <input #photoInput type="file" accept="image/*" capture="environment"
                style="display:none;" (change)="onPhotoSelected($event)" />
              <ui-button
                variant="ghost"
                size="sm"
                [block]="true"
                [disabled]="uploadingPhoto()"
                (click)="photoInput.click()"
                [ariaLabel]="t('body.photoAdd')">
                <span style="display:inline-flex; align-items:center; gap:6px;">
                  <lucide-icon name="camera" [size]="14" />
                  {{ uploadingPhoto() ? t('body.photoUploading') : t('body.photoAdd') }}
                </span>
              </ui-button>
              @if (photoError(); as err) {
                <p class="v2-caption mt-2" style="color: var(--v2-danger);">{{ err }}</p>
              }
              @if (photos().length) {
                <div class="grid grid-cols-3 gap-2 mt-3">
                  @for (p of photos(); track p.dateKey) {
                    <button type="button" class="relative block w-full rounded-lg overflow-hidden"
                      style="aspect-ratio: 1; background: var(--v2-paper-2);"
                      (click)="openViewer(p)"
                      [attr.aria-label]="t('body.photoViewAria', { date: photoDateLabel(p.dateKey) })">
                      @if (photoUrls()[p.dateKey]; as url) {
                        <img [src]="url" alt="" class="w-full h-full" style="object-fit: cover;" />
                      }
                      <span class="absolute left-1 bottom-1 px-1.5 py-0.5 rounded"
                        style="background: rgba(0,0,0,0.5); color: #fff; font-size: 0.62rem;">
                        {{ photoDateLabel(p.dateKey) }}
                      </span>
                    </button>
                  }
                </div>
              }
            } @else {
              <button type="button"
                class="flex items-center justify-between gap-3 w-full mt-1 px-3 py-2.5 rounded-xl"
                style="background: var(--v2-accent-soft);"
                (click)="openPhotoUpgrade()">
                <span class="flex items-center gap-2 v2-caption" style="color: var(--v2-ink);">
                  <lucide-icon name="camera" [size]="14" />
                  {{ t('body.photoProTitle') }}
                </span>
                <span class="v2-caption" style="color: var(--v2-accent); font-weight: 600;">
                  {{ t('body.photoProCta') }}
                </span>
              </button>
            }
          </div>
        }
      </ui-card>

      <!-- Full-screen photo viewer -->
      @if (viewer(); as v) {
        <div class="fixed inset-0 z-50 flex flex-col items-center justify-center p-4"
          style="background: rgba(0,0,0,0.92);" (click)="closeViewer()">
          @if (photoUrls()[v.dateKey]; as url) {
            <img [src]="url" alt="" style="max-width: 100%; max-height: 80vh; object-fit: contain;"
              class="rounded-lg" />
          }
          <div class="flex items-center gap-3 mt-4" (click)="$event.stopPropagation()">
            <span style="color: #fff;" class="v2-caption">
              {{ photoDateLabel(v.dateKey) }}@if (v.weightLb != null) { · {{ v.weightLb }} lb }
            </span>
            <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm" style="color: #fff;"
              (click)="removePhoto(v)">
              <lucide-icon name="trash-2" [size]="14" /> {{ t('body.photoDelete') }}
            </button>
            <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm" style="color: #fff;"
              (click)="closeViewer()">{{ t('body.photoClose') }}</button>
          </div>
        </div>
      }

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
  private readonly photoSvc = inject(ProgressPhotoService);
  protected readonly subs = inject(SubscriptionService);
  private readonly upsell = inject(UpsellService);

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
  protected readonly photosExpanded = signal(false);
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

  // ─── Progress photos (ADR-0010) ────────────────────────────
  protected readonly photos = signal<ProgressPhoto[]>([]);
  /** dateKey → object URL (from getBlob); revoked on reload/destroy. */
  protected readonly photoUrls = signal<Record<string, string>>({});
  protected readonly uploadingPhoto = signal(false);
  protected readonly photoError = signal<string | null>(null);
  protected readonly viewer = signal<ProgressPhoto | null>(null);

  ngOnInit(): void {
    // 30s ticker is enough — display is hh:mm.
    this.intervalId = setInterval(() => this.tick.update((n) => n + 1), 30_000);
    void this.loadPhotos();
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.revokePhotoUrls();
  }

  private revokePhotoUrls(): void {
    for (const url of Object.values(this.photoUrls())) URL.revokeObjectURL(url);
  }

  protected openPhotoUpgrade(): void {
    this.upsell.openSubscribe('body-progress-photos');
  }

  private async loadPhotos(): Promise<void> {
    // Photos are Pro-only; don't fetch (and incur egress) for free users.
    if (!this.subs.isPaid()) return;
    try {
      const list = await this.photoSvc.list();
      const urls: Record<string, string> = {};
      await Promise.all(
        list.map(async (p) => {
          try {
            urls[p.dateKey] = await this.photoSvc.objectUrl(p);
          } catch {
            /* one bad object shouldn't blank the whole grid */
          }
        }),
      );
      this.revokePhotoUrls();
      this.photos.set(list);
      this.photoUrls.set(urls);
    } catch {
      /* signed out / offline — leave the grid empty */
    }
  }

  protected async onPhotoSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file || !this.subs.isPaid()) return;
    this.photoError.set(null);
    this.uploadingPhoto.set(true);
    this.haptic(10);
    try {
      const blob = await resizeToJpegBlob(file);
      const dateKey = localDateKey(new Date());
      const w = this.body.dailyWeights()[dateKey] ?? this.currentWeight();
      await this.photoSvc.upload(dateKey, blob, typeof w === 'number' ? w : undefined);
      await this.loadPhotos();
    } catch {
      this.photoError.set(this.translation.t('body.photoFailed'));
      this.haptic(50);
    } finally {
      this.uploadingPhoto.set(false);
    }
  }

  protected openViewer(p: ProgressPhoto): void {
    this.haptic(10);
    this.viewer.set(p);
  }

  protected closeViewer(): void {
    this.viewer.set(null);
  }

  protected async removePhoto(p: ProgressPhoto): Promise<void> {
    if (!confirm(this.translation.t('body.photoDeleteConfirm'))) return;
    try {
      await this.photoSvc.delete(p.dateKey);
      this.closeViewer();
      await this.loadPhotos();
    } catch {
      this.photoError.set(this.translation.t('body.photoFailed'));
    }
  }

  protected photoDateLabel(dateKey: string): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(
      bcp47ForLang(this.translation.language()),
      { month: 'short', day: 'numeric' },
    );
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
