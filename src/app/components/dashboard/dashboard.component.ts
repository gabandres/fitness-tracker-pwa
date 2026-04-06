import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FitnessStore } from '../../services/fitness-store.service';

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
        <!-- Target / TDEE / Weight -->
        <div class="mt-4 grid grid-cols-3 gap-4">
          <div>
            <div class="data-label mb-1">target</div>
            <div class="readout-mono">{{ store.tdee().newDailyTarget }}</div>
            <div class="data-label mt-0.5 opacity-60">kcal/day</div>
          </div>
          <div>
            <div class="data-label mb-1">true tdee</div>
            <div class="readout-mono">{{ store.tdee().trueTdee }}</div>
            <div class="data-label mt-0.5 opacity-60">kcal/day</div>
          </div>
          <div>
            <div class="data-label mb-1">weight</div>
            <div class="readout-mono">{{ store.currentWeight() ?? '—' }}</div>
            <div class="data-label mt-0.5 opacity-60">lbs</div>
          </div>
        </div>

        @if (store.logs().length < 14) {
          <div class="mt-3 flex items-center gap-2">
            <span class="stamp-mark">{{ store.tdee().source }}</span>
            <p class="caption text-[11px]">
              {{ 14 - store.logs().length }} more day{{ store.logs().length === 13 ? '' : 's' }} to measured estimate.
            </p>
          </div>
        }

        <!-- Goal progress bar -->
        @if (store.goalProgress(); as gp) {
          <div class="mt-5">
            <div class="flex items-center justify-between mb-1">
              <span class="data-label">goal progress</span>
              <span class="font-mono text-[10px] tabular-nums text-graphite">
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
              <span class="font-mono text-[9px] tabular-nums text-graphite">{{ gp.startWeight }} lbs</span>
              <span class="font-mono text-[9px] tabular-nums" style="color: var(--color-olive)">
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
  protected readonly svgW = 320;
  protected readonly svgH = 60;

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
    const w = this.store.logs().map((l) => l.weight);
    return this.scalePoints(w, w);
  });
  protected readonly sparklineEma = computed(() => {
    const w = this.store.logs().map((l) => l.weight);
    return this.scalePoints(this.store.ema(), w);
  });
  protected readonly rawSvgPoints = computed(() =>
    this.sparklineRaw().map((p) => `${p.x},${p.y}`).join(' '));
  protected readonly emaSvgPoints = computed(() =>
    this.sparklineEma().map((p) => `${p.x},${p.y}`).join(' '));

  protected dateLabel(index: number): string {
    const data = this.store.logs();
    if (data.length === 0) return '';
    const i = index < 0 ? data.length + index : index;
    return data[i]?.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() ?? '';
  }

  protected async exportCsv(): Promise<void> {
    const allLogs = await this.store.getAllLogs();
    const rows = [
      ['Date', 'Weight (lbs)', 'Calories', 'Protein (g)', 'Lift', 'Cardio'].join(','),
      ...allLogs.map((l) =>
        [l.date.toISOString().slice(0, 10), l.weight, l.calories, l.protein ?? '', l.liftCompleted ? 'yes' : '', l.cardioCompleted ? 'yes' : ''].join(','),
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
