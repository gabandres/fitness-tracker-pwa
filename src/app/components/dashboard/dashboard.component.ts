import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { FirebaseService, DailyLog } from '../../services/firebase.service';
import { TdeeCalculatorService, TdeeResult, WeeklySummary } from '../../services/tdee-calculator.service';

interface SparklinePoint { x: number; y: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule"><span>calibration readout</span></div>

      @if (logs().length === 0) {
        <div class="mt-4 py-6 text-center">
          <p class="caption text-[11px]">log your first entry above to see your readout here.</p>
          <div class="mt-4 flex justify-center">
            <button type="button" (click)="refresh()" class="tag-btn" [disabled]="loading()">
              {{ loading() ? 'loading…' : 'refresh ↻' }}
            </button>
          </div>
        </div>
      } @else {
        <!-- Target / TDEE / Weight row -->
        <div class="mt-4 grid grid-cols-3 gap-4">
          <div>
            <div class="data-label mb-1">target</div>
            <div class="readout-mono">{{ tdee().newDailyTarget }}</div>
            <div class="data-label mt-0.5 opacity-60">kcal/day</div>
          </div>
          <div>
            <div class="data-label mb-1">true tdee</div>
            <div class="readout-mono">{{ tdee().trueTdee }}</div>
            <div class="data-label mt-0.5 opacity-60">kcal/day</div>
          </div>
          <div>
            <div class="data-label mb-1">weight</div>
            <div class="readout-mono">{{ currentWeight() ?? '—' }}</div>
            <div class="data-label mt-0.5 opacity-60">lbs</div>
          </div>
        </div>

        @if (logs().length < 14) {
          <div class="mt-3 flex items-center gap-2">
            <span class="stamp-mark">{{ tdee().source }}</span>
            <p class="caption text-[11px]">
              {{ 14 - logs().length }} more day{{ logs().length === 13 ? '' : 's' }} to measured estimate.
            </p>
          </div>
        }

        <!-- Weekly summary card -->
        @if (weekly(); as w) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-2">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ w.days }}d</span>
              <span class="data-label">weekly summary</span>
            </div>
            <div class="grid grid-cols-4 gap-2 text-center">
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.avgWeight }}</div>
                <div class="data-label mt-0.5 opacity-60 text-[8px]">avg lb</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.avgCalories }}</div>
                <div class="data-label mt-0.5 opacity-60 text-[8px]">avg cal</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium tabular-nums"
                  [style.color]="w.weightDelta <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ w.weightDelta > 0 ? '+' : '' }}{{ w.weightDelta }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[8px]">Δ lbs</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.adherencePct }}%</div>
                <div class="data-label mt-0.5 opacity-60 text-[8px]">on target</div>
              </div>
            </div>
            @if (w.avgProtein != null) {
              <div class="mt-2 pt-2 border-t border-rule/30 text-center">
                <span class="font-mono text-xs tabular-nums" style="color: var(--color-protein)">
                  {{ w.avgProtein }}g
                </span>
                <span class="data-label ml-1 text-[8px]">avg protein/day</span>
              </div>
            }
          </div>
        }

        <!-- Sparkline with EMA overlay -->
        @if (sparklineRaw().length > 1) {
          <div class="mt-6">
            <div class="flex items-center justify-between mb-2">
              <span class="data-label">14-day trend</span>
              <span class="font-mono text-sm tabular-nums"
                [style.color]="tdee().weightChangeTrend > 0 ? 'var(--color-blood)' : tdee().weightChangeTrend < 0 ? 'var(--color-ink)' : 'var(--color-graphite)'">
                {{ trendLabel() }}
              </span>
            </div>
            <div class="relative">
              <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH"
                class="w-full h-16 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                <!-- Week divider -->
                <line [attr.x1]="svgW / 2" y1="0" [attr.x2]="svgW / 2" [attr.y2]="svgH"
                  stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3" class="text-aged" />
                <!-- Raw weight (thin, faded) -->
                <polyline [attr.points]="rawSvgPoints()" fill="none"
                  stroke="currentColor" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"
                  class="text-graphite-soft" />
                <!-- EMA smoothed (bold, dark) -->
                <polyline [attr.points]="emaSvgPoints()" fill="none"
                  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                  class="text-ink" />
                <!-- Latest point -->
                @if (sparklineEma().length > 0) {
                  @let p = sparklineEma()[sparklineEma().length - 1];
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-blood" />
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="6" class="fill-blood opacity-20" />
                }
              </svg>
              <div class="flex justify-between mt-1 font-mono text-[9px] tracking-[0.15em] text-graphite">
                <span>{{ dateLabel(0) }}</span>
                <span class="font-display italic text-[10px] tracking-normal">
                  <span class="text-graphite-soft">— raw</span> &nbsp;
                  <span class="text-ink">— smoothed</span>
                </span>
                <span>{{ dateLabel(-1) }}</span>
              </div>
            </div>
          </div>
        }

        <!-- Actions row: refresh + export -->
        <div class="mt-5 flex items-center justify-between">
          <button type="button" (click)="exportCsv()" class="tag-btn">
            ↓ export csv
          </button>
          <button type="button" (click)="refresh()" class="tag-btn" [disabled]="loading()">
            {{ loading() ? 'loading…' : 'refresh ↻' }}
          </button>
        </div>
      }
    </section>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly firebase = inject(FirebaseService);
  private readonly calculator = inject(TdeeCalculatorService);

  protected readonly svgW = 320;
  protected readonly svgH = 60;

  protected readonly logs = signal<DailyLog[]>([]);
  protected readonly loading = signal(false);

  protected readonly tdee = computed<TdeeResult>(() => {
    const profile = this.firebase.profile();
    const fields = profile?.profileCompleted
      ? {
          heightIn: profile.heightIn!,
          age: profile.age!,
          sex: profile.sex!,
          activityLevel: profile.activityLevel!,
          targetPaceLbsPerWeek: profile.targetPaceLbsPerWeek!,
          goalWeightLbs: profile.goalWeightLbs,
        }
      : null;
    return this.calculator.calculate(this.logs(), fields);
  });

  protected readonly currentWeight = computed<number | null>(() => {
    const list = this.logs();
    return list.length > 0 ? list[list.length - 1].weight : null;
  });

  protected readonly trendLabel = computed<string>(() => {
    const change = this.tdee().weightChangeTrend;
    if (change === 0) return '—';
    const arrow = change > 0 ? '↓' : '↑';
    return `${arrow} ${Math.abs(change).toFixed(1)} lbs`;
  });

  // ── Weekly summary ────────────────────────────────────────
  protected readonly weekly = computed<WeeklySummary | null>(() =>
    this.calculator.weeklySummary(this.logs(), this.tdee().newDailyTarget),
  );

  // ── Sparkline: raw + EMA points ───────────────────────────
  private scalePoints(values: number[], rawWeights: number[]): SparklinePoint[] {
    if (values.length < 2) return [];
    const allVals = [...rawWeights, ...values];
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const range = max - min || 1;
    const padY = 6;
    const usableH = this.svgH - padY * 2;
    return values.map((v, i) => ({
      x: (i / (values.length - 1)) * this.svgW,
      y: padY + (1 - (v - min) / range) * usableH,
    }));
  }

  protected readonly sparklineRaw = computed<SparklinePoint[]>(() => {
    const weights = this.logs().map((l) => l.weight);
    return this.scalePoints(weights, weights);
  });

  protected readonly sparklineEma = computed<SparklinePoint[]>(() => {
    const weights = this.logs().map((l) => l.weight);
    const smoothed = this.calculator.ema(weights, 7);
    return this.scalePoints(smoothed, weights);
  });

  protected readonly rawSvgPoints = computed(() =>
    this.sparklineRaw().map((p) => `${p.x},${p.y}`).join(' '),
  );
  protected readonly emaSvgPoints = computed(() =>
    this.sparklineEma().map((p) => `${p.x},${p.y}`).join(' '),
  );

  protected dateLabel(index: number): string {
    const data = this.logs();
    if (data.length === 0) return '';
    const i = index < 0 ? data.length + index : index;
    return data[i]?.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() ?? '';
  }

  ngOnInit(): void {
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try { this.logs.set(await this.firebase.getRecentLogs(14)); }
    finally { this.loading.set(false); }
  }

  // ── CSV Export ────────────────────────────────────────────
  protected async exportCsv(): Promise<void> {
    // Fetch ALL logs (not just 14) for the export.
    const allLogs = await this.firebase.getRecentLogs(9999);
    const rows = [
      ['Date', 'Weight (lbs)', 'Calories', 'Protein (g)', 'Lift', 'Cardio'].join(','),
      ...allLogs.map((l) =>
        [
          l.date.toISOString().slice(0, 10),
          l.weight,
          l.calories,
          l.protein ?? '',
          l.liftCompleted ? 'yes' : '',
          l.cardioCompleted ? 'yes' : '',
        ].join(','),
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macrolog-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
