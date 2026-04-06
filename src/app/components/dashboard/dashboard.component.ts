import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { FirebaseService, DailyLog } from '../../services/firebase.service';
import { TdeeCalculatorService, TdeeResult } from '../../services/tdee-calculator.service';

interface SparklinePoint {
  x: number;
  y: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule"><span>calibration readout</span></div>

      @if (logs().length === 0) {
        <!-- Empty state: no entries yet -->
        <div class="mt-4 py-6 text-center">
          <p class="caption text-[11px]">log your first entry above to see your readout here.</p>
          <div class="mt-4 flex justify-center">
            <button type="button" (click)="refresh()" class="tag-btn"
              [disabled]="loading()">
              {{ loading() ? 'loading…' : 'refresh ↻' }}
            </button>
          </div>
        </div>
      } @else {
        <!-- Compact target + TDEE + weight row -->
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

        <!-- Refresh -->
        <div class="mt-4 flex justify-end">
          <button type="button" (click)="refresh()" class="tag-btn"
            [disabled]="loading()">
            {{ loading() ? 'loading…' : 'refresh ↻' }}
          </button>
        </div>
      }

      <!-- Trend + sparkline (only when there's data) -->
      @if (logs().length > 1) {
      <div class="mt-6">
        <!-- 14 day trend with sparkline -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="data-label">14-day trend</span>
            <span
              class="font-mono text-sm tabular-nums"
              [class.text-blood]="tdee().weightChangeTrend > 0"
              [class.text-graphite]="tdee().weightChangeTrend === 0"
              [class.text-ink]="tdee().weightChangeTrend < 0"
            >
              {{ trendLabel() }}
            </span>
          </div>

          @if (sparklinePoints().length > 1) {
            <div class="relative">
              <svg
                [attr.viewBox]="'0 0 ' + svgWidth + ' ' + svgHeight"
                class="w-full h-16 overflow-visible"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <!-- Week divider -->
                <line
                  [attr.x1]="svgWidth / 2"
                  y1="0"
                  [attr.x2]="svgWidth / 2"
                  [attr.y2]="svgHeight"
                  stroke="currentColor"
                  stroke-width="0.5"
                  stroke-dasharray="2 3"
                  class="text-aged"
                />

                <!-- Main weight line -->
                <polyline
                  [attr.points]="sparklineSvgPoints()"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.25"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="text-ink"
                />

                <!-- First point (oldest) -->
                @if (sparklinePoints()[0]; as p) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2" class="fill-graphite" />
                }

                <!-- Last point (most recent) — highlighted -->
                @if (sparklinePoints()[sparklinePoints().length - 1]; as p) {
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-blood" />
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="6" class="fill-blood opacity-20" />
                }
              </svg>

              <!-- Week labels beneath -->
              <div class="flex justify-between mt-1 font-mono text-[9px] tracking-[0.15em] text-graphite">
                <span>{{ weekOneRange() }}</span>
                <span class="italic font-display not-italic text-[10px] normal-case tracking-normal">week boundary</span>
                <span>{{ weekTwoRange() }}</span>
              </div>
            </div>
          } @else {
            <p class="caption text-[11px]">no trend data yet.</p>
          }
        </div>
      </div>
      }
    </section>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly firebase = inject(FirebaseService);
  private readonly calculator = inject(TdeeCalculatorService);

  protected readonly svgWidth = 320;
  protected readonly svgHeight = 60;

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
    if (list.length === 0) return null;
    return list[list.length - 1].weight;
  });

  protected readonly trendLabel = computed<string>(() => {
    const change = this.tdee().weightChangeTrend;
    if (change === 0) return '—';
    // Positive change from the calculator = weight LOST. Display as ↓ in ink.
    const arrow = change > 0 ? '↓' : '↑';
    return `${arrow} ${Math.abs(change).toFixed(1)} lbs`;
  });

  /** Sparkline points in SVG coordinates, scaled to fit the viewport. */
  protected readonly sparklinePoints = computed<SparklinePoint[]>(() => {
    const data = this.logs();
    if (data.length < 2) return [];

    const weights = data.map((l) => l.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const range = max - min || 1;

    const padY = 6;
    const usableH = this.svgHeight - padY * 2;

    return data.map((log, i) => ({
      x: (i / (data.length - 1)) * this.svgWidth,
      // Invert Y so higher weight is higher on the chart.
      y: padY + (1 - (log.weight - min) / range) * usableH,
    }));
  });

  protected readonly sparklineSvgPoints = computed<string>(() =>
    this.sparklinePoints().map((p) => `${p.x},${p.y}`).join(' ')
  );

  protected readonly weekOneRange = computed<string>(() => {
    const data = this.logs();
    if (data.length < 2) return '';
    return this.shortDate(data[0].date);
  });

  protected readonly weekTwoRange = computed<string>(() => {
    const data = this.logs();
    if (data.length < 2) return '';
    return this.shortDate(data[data.length - 1].date);
  });

  ngOnInit(): void {
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await this.firebase.getRecentLogs(14);
      this.logs.set(data);
    } finally {
      this.loading.set(false);
    }
  }

  private shortDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }
}
