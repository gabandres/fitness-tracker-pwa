import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { FitnessStore } from '../../services/fitness-store.service';
import { TdeeCalculatorService } from '../../services/tdee-calculator.service';
import { localDateKey } from '../../utils/date';

interface SparklinePoint { x: number; y: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule"><span>calibration readout</span></div>

      @if (store.logs().length === 0) {
        <div class="mt-4 py-6 text-center">
          <p class="caption text-[11px]">log your first entry above to see your readout here.</p>
          <div class="mt-4 flex justify-center">
            <button type="button" (click)="store.refresh()" class="tag-btn"
              [disabled]="store.status() === 'loading'">
              {{ store.status() === 'loading' ? 'loading…' : 'refresh ↻' }}
            </button>
          </div>
        </div>
      } @else {
        <!-- Target / TDEE / Weight (tap a ? to learn what each means) -->
        <div class="mt-4 grid grid-cols-3 gap-2">
          <div class="min-w-0" title="What you should eat each day to hit your weekly cut pace.">
            <div class="data-label mb-1 flex items-center gap-1">
              <span>target</span>
              <button type="button" (click)="toggleHelp('target')"
                aria-label="What is target?"
                class="readout-help">?</button>
            </div>
            <div class="readout-mono truncate">{{ store.tdee().newDailyTarget }}</div>
            <div class="data-label mt-0.5 opacity-60">kcal/day</div>
          </div>
          <div class="min-w-0" title="Estimated calories you burn on an average day. After 14 days of logging this shifts from the formula estimate to your real measured rate.">
            <div class="data-label mb-1 flex items-center gap-1">
              <span>true tdee</span>
              <button type="button" (click)="toggleHelp('tdee')"
                aria-label="What is true tdee?"
                class="readout-help">?</button>
            </div>
            <div class="readout-mono truncate">{{ store.tdee().trueTdee }}</div>
            <div class="data-label mt-0.5 opacity-60">kcal/day</div>
          </div>
          <div class="min-w-0" title="Latest logged weight. 14-day EMA smoothing is shown on the sparkline below.">
            <div class="data-label mb-1 flex items-center gap-1">
              <span>weight</span>
              <button type="button" (click)="toggleHelp('weight')"
                aria-label="What is weight?"
                class="readout-help">?</button>
            </div>
            <div class="readout-mono truncate">{{ store.currentWeight() ?? '—' }}</div>
            <div class="data-label mt-0.5 opacity-60">lbs</div>
          </div>
        </div>
        @if (helpOpen(); as which) {
          <p class="caption text-xs mt-2 italic text-graphite leading-relaxed slide-down">
            {{ helpText(which) }}
          </p>
        }

        @if (store.logs().length < 14) {
          <div class="mt-3 flex items-center gap-2">
            <span class="stamp-mark">{{ store.tdee().source }}</span>
            <p class="caption text-xs">
              {{ 14 - store.logs().length }} more day{{ store.logs().length === 13 ? '' : 's' }} to measured estimate.
            </p>
          </div>
        }

        <!-- Adaptive TDEE notification: shown once when measured mode kicks in -->
        @if (store.tdeeTransition(); as t) {
          <div class="mt-4 specimen px-4 py-3" style="border-color: var(--color-olive)">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">calibrated</span>
                <span class="data-label">measured tdee active</span>
              </div>
              <button type="button" (click)="dismissTdeeTransition()" class="tag-btn text-[11px]">dismiss</button>
            </div>
            <p class="font-sans text-sm text-ink leading-relaxed">
              Your real TDEE is <span class="font-mono font-semibold">{{ t.measuredTdee }}</span> kcal/day —
              <span class="font-mono font-semibold"
                [style.color]="t.diffPct < 0 ? 'var(--color-blood)' : 'var(--color-olive)'">
                {{ t.diffPct > 0 ? '+' : '' }}{{ t.diffPct }}%
              </span>
              vs the formula estimate of {{ t.formulaTdee }}. Your target has been updated automatically.
            </p>
          </div>
        }

        <!-- Goal progress bar -->
        @if (store.goalProgress(); as gp) {
          <div class="mt-5">
            <div class="flex items-center justify-between mb-1">
              <span class="data-label">goal progress</span>
              <span class="font-sans text-xs tabular-nums text-graphite">
                {{ gp.currentWeight }} → {{ gp.goalWeight }} lbs
              </span>
            </div>
            <div class="h-2 w-full bg-paper-deep relative overflow-hidden border border-rule/30">
              <div class="h-full transition-all duration-500"
                [style.width.%]="gp.pct"
                [style.background]="'var(--color-olive)'">
              </div>
            </div>
            <div class="flex items-center justify-between mt-1">
              <span class="font-sans text-[11px] tabular-nums text-graphite">{{ gp.startWeight }} lbs</span>
              <span class="font-sans text-[11px] tabular-nums" style="color: var(--color-olive)">
                {{ gp.pct }}% · {{ gp.remaining }} lbs to go
              </span>
            </div>
          </div>
        }

        <!-- Weekly summary -->
        @if (store.weekly(); as w) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-2">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ w.days }}d</span>
              <span class="data-label">weekly summary</span>
            </div>
            <div class="grid grid-cols-4 gap-2 text-center">
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.avgWeight }}</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">avg lb</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.avgCalories }}</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">avg cal</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium tabular-nums"
                  [style.color]="w.weightDelta <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ w.weightDelta > 0 ? '+' : '' }}{{ w.weightDelta }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">Δ lbs</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.adherencePct }}%</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">on target</div>
              </div>
            </div>
            @if (w.avgProtein != null) {
              <div class="mt-2 pt-2 border-t border-rule/30 text-center">
                <span class="font-mono text-xs tabular-nums" style="color: var(--color-protein)">
                  {{ w.avgProtein }}g
                </span>
                <span class="data-label ml-1 text-[11px]">avg protein/day</span>
              </div>
            }
          </div>
        }

        <!-- Weekly Calorie Envelope -->
        @if (store.envelope(); as env) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-2">
              <span class="stamp-mark" style="transform: rotate(0deg)">7d</span>
              <span class="data-label">weekly envelope</span>
            </div>
            <div class="flex items-center justify-between">
              <div>
                <div class="font-mono text-lg font-medium tabular-nums"
                  [style.color]="env.surplus > 0 ? 'var(--color-blood)' : 'var(--color-olive)'">
                  {{ env.surplus > 0 ? '+' : '' }}{{ env.surplus }}
                  <span class="text-graphite text-xs font-normal">kcal</span>
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">
                  {{ env.surplus > 0 ? 'over budget' : 'under budget' }} · {{ env.daysLogged }}d logged
                </div>
              </div>
              <div class="text-right">
                <div class="font-mono text-lg font-medium text-ink tabular-nums">
                  {{ env.adjustedDailyTarget }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">
                  aim/day · {{ env.daysRemaining }}d left
                </div>
              </div>
            </div>
            <!-- Budget bar: consumed / weeklyBudget -->
            <div class="mt-2 h-1.5 w-full bg-paper-deep relative overflow-hidden border border-rule/30">
              <div class="h-full transition-all duration-300"
                [style.width.%]="Math.min(100, (env.consumed / env.weeklyBudget) * 100)"
                [style.background]="env.consumed > env.weeklyBudget ? 'var(--color-blood)' : 'var(--color-olive)'">
              </div>
            </div>
            <div class="flex justify-between mt-1 font-sans text-[11px] tabular-nums text-graphite">
              <span>{{ env.consumed }} consumed</span>
              <span>{{ env.weeklyBudget }} budget</span>
            </div>
          </div>
        }

        <!-- Weekly AI Report -->
        @if (store.weeklyReport(); as report) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="stamp-mark" style="transform: rotate(0deg)">report</span>
                <span class="data-label">weekly review</span>
              </div>
              <span class="font-sans text-[11px] text-graphite">{{ reportAge() }}</span>
            </div>
            <div class="prose-field font-display text-ink text-[14px] leading-relaxed"
              [innerHTML]="reportHtml()"></div>
            <div class="mt-2 pt-2 border-t border-rule/30 flex justify-end">
              <button type="button" (click)="store.generateWeeklyReport()"
                [disabled]="store.reportLoading()"
                class="tag-btn text-[9px]">
                {{ store.reportLoading() ? 'generating…' : 'regenerate' }}
              </button>
            </div>
          </div>
        } @else if (store.reportLoading()) {
          <div class="mt-5 specimen px-4 py-3 text-center">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">generating</span>
            <p class="caption text-[11px] mt-2">compiling your first weekly report…</p>
          </div>
        }

        <!-- Long-term summary -->
        @if (store.monthlySummary(); as m) {
          <div class="mt-5 specimen px-4 py-3">
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ m.weeksTracked }}w</span>
              <span class="data-label">all-time progress</span>
            </div>
            <div class="grid grid-cols-3 gap-3 text-center">
              <div>
                <div class="font-mono text-lg font-semibold tabular-nums"
                  [style.color]="m.totalChange <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ m.totalChange > 0 ? '+' : '' }}{{ m.totalChange }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">lbs total</div>
              </div>
              <div>
                <div class="font-mono text-lg font-semibold tabular-nums"
                  [style.color]="m.avgWeeklyChange <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ m.avgWeeklyChange > 0 ? '+' : '' }}{{ m.avgWeeklyChange }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">lbs/week avg</div>
              </div>
              <div>
                <div class="font-mono text-lg font-semibold tabular-nums text-ink">{{ m.adherencePct }}%</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">adherence</div>
              </div>
            </div>
            <div class="mt-3 pt-2 border-t border-rule/30 flex items-center justify-between">
              <span class="font-sans text-xs text-graphite">
                {{ m.firstWeight }} → {{ m.lastWeight }} lbs over {{ m.daysTracked }} days
              </span>
              <span class="font-sans text-xs text-graphite">
                avg {{ m.avgCalories }} kcal/day
              </span>
            </div>
          </div>
        }

        <!-- Sparkline -->
        @if (sparklineRaw().length > 1) {
          <div class="mt-6">
            <div class="flex items-center justify-between mb-2">
              <span class="data-label">14-day trend</span>
              <span class="font-mono text-sm tabular-nums"
                [style.color]="store.tdee().weightChangeTrend > 0 ? 'var(--color-blood)' : store.tdee().weightChangeTrend < 0 ? 'var(--color-ink)' : 'var(--color-graphite)'">
                {{ store.trendLabel() }}
              </span>
            </div>
            <div class="relative">
              <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH"
                class="w-full h-16 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                <line [attr.x1]="svgW / 2" y1="0" [attr.x2]="svgW / 2" [attr.y2]="svgH"
                  stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3" class="text-aged" />
                <polyline [attr.points]="rawSvgPoints()" fill="none"
                  stroke="currentColor" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"
                  class="text-graphite-soft" />
                <polyline [attr.points]="emaSvgPoints()" fill="none"
                  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                  class="text-ink" />
                @if (sparklineEma().length > 0) {
                  @let p = sparklineEma()[sparklineEma().length - 1];
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-blood" />
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="6" class="fill-blood opacity-20" />
                }
              </svg>
              <div class="flex justify-between mt-1 font-sans text-[11px] tracking-[0.15em] text-graphite">
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

        <!-- All-time weight chart -->
        @if (allTimeRawPoints().length > 2) {
          <div class="mt-6">
            <div class="flex items-center justify-between mb-2">
              <span class="data-label">all-time trend</span>
              @if (store.monthlySummary(); as m) {
                <span class="font-mono text-sm tabular-nums"
                  [style.color]="m.totalChange < 0 ? 'var(--color-ink)' : m.totalChange > 0 ? 'var(--color-blood)' : 'var(--color-graphite)'">
                  {{ m.totalChange > 0 ? '+' : '' }}{{ m.totalChange }} lbs
                </span>
              }
            </div>
            <div class="relative">
              <svg [attr.viewBox]="'0 0 ' + allTimeSvgW + ' ' + allTimeSvgH"
                class="w-full h-20 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                <polyline [attr.points]="allTimeRawSvg()" fill="none"
                  stroke="currentColor" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"
                  class="text-graphite-soft" />
                <polyline [attr.points]="allTimeEmaSvg()" fill="none"
                  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                  class="text-ink" />
                @if (allTimeEmaPoints().length > 0) {
                  @let p = allTimeEmaPoints()[allTimeEmaPoints().length - 1];
                  <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-blood" />
                }
              </svg>
              <div class="flex justify-between mt-1 font-sans text-[11px] tracking-[0.15em] text-graphite">
                <span>{{ allTimeDateLabel(0) }}</span>
                <span>{{ allTimeDateLabel(-1) }}</span>
              </div>
            </div>
          </div>
        }

        <!-- Actions -->
        <div class="mt-5 flex items-center justify-between">
          <button type="button" (click)="exportCsv()" class="tag-btn">↓ export csv</button>
          <button type="button" (click)="store.refresh()" class="tag-btn"
            [disabled]="store.status() === 'loading'">
            {{ store.status() === 'loading' ? 'loading…' : 'refresh ↻' }}
          </button>
        </div>
      }
    </section>
  `,
})
export class DashboardComponent {
  protected readonly store = inject(FitnessStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly calc = inject(TdeeCalculatorService);
  protected readonly Math = Math;
  protected readonly svgW = 320;
  protected readonly svgH = 60;

  protected dismissTdeeTransition(): void {
    localStorage.setItem('macrolog.tdee-transition-dismissed', '1');
    // Force re-evaluation by refreshing store (the computed checks localStorage).
    this.store.refresh();
  }

  // ── Readout "?" help tooltips (tap to reveal, same tap to hide) ──
  protected readonly helpOpen = signal<'target' | 'tdee' | 'weight' | null>(null);
  protected toggleHelp(which: 'target' | 'tdee' | 'weight'): void {
    this.helpOpen.set(this.helpOpen() === which ? null : which);
  }
  protected helpText(which: 'target' | 'tdee' | 'weight'): string {
    switch (which) {
      case 'target': return 'what to eat each day to hit your weekly cut pace. auto-adjusts when your measured tdee drifts.';
      case 'tdee':   return 'calories you burn on an average day. after 14 days this switches from a formula estimate to your real measured rate.';
      case 'weight': return 'latest logged weight. the sparkline below shows a 14-day smoothed trend so day-to-day noise doesn\'t dominate.';
    }
  }

  // ── Weekly report rendering ──────────────────────────────────
  protected readonly reportHtml = computed<SafeHtml>(() => {
    const report = this.store.weeklyReport();
    if (!report) return '' as SafeHtml;
    const html = marked.parse(report.markdown, { gfm: true, breaks: true }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  protected readonly reportAge = computed<string>(() => {
    const report = this.store.weeklyReport();
    if (!report) return '';
    const days = Math.floor((Date.now() - report.generatedAt.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  });

  // ── Sparkline geometry (view-only math, stays local) ────────
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

  protected readonly sparklineRaw = computed(() => {
    const w = this.store.logs().map((l) => l.weight).filter((v): v is number => v != null);
    return this.scalePoints(w, w);
  });
  protected readonly sparklineEma = computed(() => {
    const w = this.store.logs().map((l) => l.weight).filter((v): v is number => v != null);
    return this.scalePoints(this.store.ema(), w);
  });
  protected readonly rawSvgPoints = computed(() =>
    this.sparklineRaw().map((p) => `${p.x},${p.y}`).join(' '));
  protected readonly emaSvgPoints = computed(() =>
    this.sparklineEma().map((p) => `${p.x},${p.y}`).join(' '));

  // ── All-time weight chart ─────────────────────────────────────
  protected readonly allTimeSvgW = 480;
  protected readonly allTimeSvgH = 80;

  /** All-time daily weights sorted oldest → newest, with sorted date keys for labels. */
  private readonly allTimeDailyData = computed(() => {
    const logs = this.store.allTimeLogs();
    if (logs.length < 7) return { weights: [] as number[], dateKeys: [] as string[] };
    const dw = this.store.dailyWeights();
    const byDay = new Map<string, number>();
    for (const log of logs) {
      const key = localDateKey(log.date);
      if (!byDay.has(key)) {
        const w = dw[key] ?? log.weight;
        if (w != null) byDay.set(key, w);
      }
    }
    const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { weights: sorted.map(([, w]) => w), dateKeys: sorted.map(([k]) => k) };
  });

  private readonly allTimeWeights = computed(() => this.allTimeDailyData().weights);
  private readonly allTimeDateKeys = computed(() => this.allTimeDailyData().dateKeys);
  private readonly allTimeEma14 = computed(() => this.calc.ema(this.allTimeWeights(), 14));

  private scaleAllTime(values: number[], rawWeights: number[]): SparklinePoint[] {
    if (values.length < 2 || rawWeights.length < 2) return [];
    const all = [...rawWeights, ...values];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const range = max - min || 1;
    const padY = 6;
    const usableH = this.allTimeSvgH - padY * 2;
    return values.map((v, i) => ({
      x: (i / (values.length - 1)) * this.allTimeSvgW,
      y: padY + (1 - (v - min) / range) * usableH,
    }));
  }

  protected readonly allTimeRawPoints = computed(() => {
    const w = this.allTimeWeights();
    return this.scaleAllTime(w, w);
  });
  protected readonly allTimeEmaPoints = computed(() =>
    this.scaleAllTime(this.allTimeEma14(), this.allTimeWeights()));
  protected readonly allTimeRawSvg = computed(() =>
    this.allTimeRawPoints().map((p) => `${p.x},${p.y}`).join(' '));
  protected readonly allTimeEmaSvg = computed(() =>
    this.allTimeEmaPoints().map((p) => `${p.x},${p.y}`).join(' '));

  protected allTimeDateLabel(index: number): string {
    const keys = this.allTimeDateKeys();
    if (keys.length === 0) return '';
    const i = index < 0 ? keys.length + index : index;
    const key = keys[i];
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }

  protected dateLabel(index: number): string {
    const data = this.store.logs();
    if (data.length === 0) return '';
    const i = index < 0 ? data.length + index : index;
    return data[i]?.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() ?? '';
  }

  protected async exportCsv(): Promise<void> {
    const allLogs = await this.store.getAllLogs();
    const rows = [
      ['Date', 'Weight (lbs)', 'Calories', 'Protein (g)', 'Exercise'].join(','),
      ...allLogs.map((l) =>
        [
          localDateKey(l.date),
          l.weight,
          l.calories,
          l.protein ?? '',
          (l.exerciseCompleted || l.liftCompleted || l.cardioCompleted) ? 'yes' : '',
        ].join(','),
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macrolog-export-${localDateKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
