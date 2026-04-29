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
import { FitnessStore } from '../../services/fitness-store.service';
import { localDateKey } from '../../utils/date';
import { Measurement } from '../../services/firebase.service';
import { V2Card } from '../ui/card.component';
import { V2Button } from '../ui/button.component';
import { V2IconButton } from '../ui/icon-button.component';
import { V2Sparkline } from '../ui/sparkline.component';
import { V2WeightSheet } from '../ui/weight-sheet.component';
import { V2FastingPill } from '../ui/fasting-pill.component';

const FAST_HOURS = 16;
type MField = 'waist' | 'chest' | 'bicep' | 'hip';
const M_FIELDS: { key: MField; label: string }[] = [
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'bicep', label: 'Bicep' },
  { key: 'hip', label: 'Hip' },
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
  selector: 'app-body-v2',
  standalone: true,
  imports: [
    LucideAngularModule,
    V2Card,
    V2Button,
    V2IconButton,
    V2Sparkline,
    V2WeightSheet,
    V2FastingPill,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-12">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">Body</h1>
          <p class="v2-caption mt-0.5">Weight, fasting, measurements</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <v2-fasting-pill (bodyRequested)="bodyRequested.emit()" />
          <v2-icon-button icon="calendar" ariaLabel="History" (click)="historyRequested.emit()" />
          <v2-icon-button icon="settings" ariaLabel="Settings" (click)="settingsRequested.emit()" />
        </div>
      </header>

      <!-- ── Weight ──────────────────────────────────────────── -->
      <v2-card variant="default" class="mt-6 block">
        <div class="flex items-baseline justify-between gap-3 mb-3">
          <h2 class="v2-h2">Weight</h2>
          <v2-button variant="secondary" size="sm" (click)="openWeightSheet()">
            <lucide-icon name="plus" [size]="14" />
            Log weight
          </v2-button>
        </div>

        <div class="flex items-baseline gap-2">
          @if (currentWeight(); as w) {
            <span class="v2-num" style="font-size: 2.5rem; line-height: 1; font-weight: 600;">
              {{ w.toFixed(1) }}
            </span>
            <span class="v2-caption" style="font-size: 0.875rem;">lb</span>
          } @else {
            <span class="v2-num" style="font-size: 2.5rem; line-height: 1; color: var(--v2-ink-muted);">—</span>
            <span class="v2-caption" style="font-size: 0.875rem;">no weight logged</span>
          }
        </div>

        <div class="mt-4">
          <v2-sparkline
            [values]="weightSeries()"
            [width]="280"
            [height]="56"
            tone="accent"
            ariaLabel="14-day weight trend" />
        </div>

        @if (goal(); as g) {
          <div class="mt-5">
            <div class="flex items-center justify-between v2-caption mb-1.5">
              <span>{{ g.startWeight.toFixed(1) }} lb</span>
              <span style="color: var(--v2-ink)">{{ g.pct }}%</span>
              <span>{{ g.goalWeight.toFixed(1) }} lb</span>
            </div>
            <div class="v2-progress" role="progressbar"
              [attr.aria-valuemin]="0"
              [attr.aria-valuemax]="100"
              [attr.aria-valuenow]="g.pct">
              <div class="v2-progress__fill" [style.width.%]="g.pct"></div>
            </div>
            <p class="v2-caption mt-1.5">
              {{ g.remaining > 0 ? g.remaining.toFixed(1) + ' lb to go' : 'Goal reached' }}
            </p>
          </div>
        }

        <v2-button
          variant="ghost"
          size="sm"
          [block]="true"
          [disabled]="true"
          ariaLabel="Take photo (coming soon)">
          <span title="Coming in v2.0" style="display:inline-flex; align-items:center; gap:6px;">
            <lucide-icon name="camera" [size]="14" />
            Take photo
            <span class="v2-caption" style="opacity: 0.6;">Soon</span>
          </span>
        </v2-button>
      </v2-card>

      <!-- ── Fasting ─────────────────────────────────────────── -->
      <v2-card variant="default" class="mt-4 block">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="v2-h2">Fasting</h2>
          @if (store.isFasting()) {
            <span class="v2-num" style="font-size: 0.8125rem; color: var(--v2-sage); font-weight: 600;">Active</span>
          } @else {
            <span class="v2-caption">Idle</span>
          }
        </div>

        <div class="mt-4 flex flex-col items-center">
          <!-- Compact ring: 120px, fills clockwise to 16h target. -->
          <div class="relative" style="width: 120px; height: 120px;">
            <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" fill="none"
                stroke="var(--v2-rule)" stroke-width="6" />
              @if (store.isFasting()) {
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
                {{ store.isFasting() ? elapsedDisplay() : '—' }}
              </span>
              <span class="v2-caption" style="font-size: 0.6875rem; margin-top: 2px;">
                {{ store.isFasting() ? 'of ' + FAST_HOURS + 'h' : FAST_HOURS + 'h target' }}
              </span>
            </div>
          </div>

          <div class="mt-5 w-full">
            @if (store.isFasting()) {
              <v2-button variant="destructive" [block]="true" (click)="endFast()">
                End fast
              </v2-button>
            } @else {
              <v2-button variant="primary" [block]="true" (click)="startFast()">
                <lucide-icon name="timer" [size]="16" />
                Start fast
              </v2-button>
            }
          </div>
        </div>
      </v2-card>

      <!-- ── Measurements ────────────────────────────────────── -->
      <v2-card variant="default" class="mt-4 block">
        <button
          type="button"
          class="flex items-center justify-between gap-3 w-full"
          style="background: none; border: none; padding: 0; cursor: pointer; min-height: var(--v2-tap-min);"
          [attr.aria-expanded]="expanded()"
          aria-controls="measurements-panel"
          (click)="toggleExpanded()">
          <div class="flex items-baseline gap-3">
            <h2 class="v2-h2">Measurements</h2>
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
            @if (store.latestMeasurement(); as m) {
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
                        {{ f.label }}
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
                        {{ f.label }} (in)
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
                  <v2-button variant="ghost" (click)="cancelMeasurement()">Cancel</v2-button>
                  <v2-button type="submit" variant="primary" [block]="true" [disabled]="saving()">
                    @if (saving()) { Saving… } @else { Save }
                  </v2-button>
                </div>
              </form>
            } @else {
              <v2-button variant="secondary" size="sm" [block]="true" (click)="openMeasurementForm()">
                <lucide-icon name="plus" [size]="14" />
                Add measurement
              </v2-button>
            }
          </div>
        }
      </v2-card>

      <!-- Weight log sheet -->
      <v2-weight-sheet
        [open]="weightSheetOpen()"
        [dateKey]="todayKey()"
        (close)="weightSheetOpen.set(false)" />
    </section>
  `,
})
export class BodyV2Component implements OnInit, OnDestroy {
  protected readonly store = inject(FitnessStore);

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
  readonly bodyRequested = output<void>();

  protected readonly FAST_HOURS = FAST_HOURS;
  protected readonly M_FIELDS = M_FIELDS;
  protected readonly fastCircumference = 2 * Math.PI * 52;

  protected readonly todayKey = signal(localDateKey(new Date()));
  protected readonly weightSheetOpen = signal(false);
  protected readonly expanded = signal(false);
  protected readonly formOpen = signal(false);
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
    const map = this.store.dailyWeights();
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

  protected readonly elapsedHours = computed<number>(() => {
    this.tick();
    const start = this.store.fastStartedAt();
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

  protected readonly summaryLabel = computed(() => {
    const m = this.store.latestMeasurement();
    if (!m) return 'None yet';
    const d = new Date(m.date);
    return 'Last logged ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
      this.formError.set('Enter at least one measurement.');
      this.haptic(50);
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    this.haptic(30);
    try {
      await this.store.addMeasurement(entry);
      this.formOpen.set(false);
      this.formValues.set({ waist: null, chest: null, bicep: null, hip: null });
    } catch (err) {
      this.formError.set(err instanceof Error ? err.message : 'Could not save measurement.');
    } finally {
      this.saving.set(false);
    }
  }

  protected deltaFor(key: MField): number | null {
    const d = this.store.measurementDeltas();
    return d?.[key] ?? null;
  }

  protected formatDelta(d: number): string {
    return Math.abs(d) < 0.05 ? '0' : d.toFixed(1);
  }

  protected async startFast(): Promise<void> {
    this.haptic(30);
    await this.store.startFast();
  }

  protected async endFast(): Promise<void> {
    this.haptic(50);
    await this.store.breakFast();
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
