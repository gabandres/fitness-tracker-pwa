import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { FirebaseService, DailyLog } from '../../services/firebase.service';
import { TdeeCalculatorService, TdeeResult } from '../../services/tdee-calculator.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="w-full max-w-md mx-auto">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-100">Dashboard</h2>
        <button
          type="button"
          (click)="refresh()"
          class="text-xs text-slate-400 hover:text-emerald-400 transition"
          [disabled]="loading()"
        >
          {{ loading() ? 'Loading…' : 'Refresh' }}
        </button>
      </header>

      @if (logs().length < 14) {
        <p class="mb-3 text-xs text-amber-400 bg-amber-950/30 border border-amber-900/60 rounded-lg px-3 py-2">
          Using seed values. Log {{ 14 - logs().length }} more day{{ logs().length === 13 ? '' : 's' }} for a real TDEE estimate.
        </p>
      }

      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
          <p class="text-[11px] uppercase tracking-wide text-slate-400">Current Weight</p>
          <p class="mt-1 text-2xl font-bold text-slate-100">
            {{ currentWeight() !== null ? currentWeight() + ' lbs' : '—' }}
          </p>
        </div>

        <div class="rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
          <p class="text-[11px] uppercase tracking-wide text-slate-400">14-Day Trend</p>
          <p class="mt-1 text-2xl font-bold"
             [class.text-emerald-400]="tdee().weightChangeTrend > 0"
             [class.text-red-400]="tdee().weightChangeTrend < 0"
             [class.text-slate-100]="tdee().weightChangeTrend === 0">
            {{ trendLabel() }}
          </p>
        </div>

        <div class="rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
          <p class="text-[11px] uppercase tracking-wide text-slate-400">True TDEE</p>
          <p class="mt-1 text-2xl font-bold text-slate-100">{{ tdee().trueTdee }}</p>
          <p class="text-[10px] text-slate-500 mt-0.5">kcal/day</p>
        </div>

        <div class="rounded-2xl bg-emerald-900/30 ring-1 ring-emerald-700/60 p-4">
          <p class="text-[11px] uppercase tracking-wide text-emerald-300">Target Intake</p>
          <p class="mt-1 text-2xl font-bold text-emerald-300">{{ tdee().newDailyTarget }}</p>
          <p class="text-[10px] text-emerald-500/80 mt-0.5">kcal/day · 1.5 lb/wk cut</p>
        </div>
      </div>
    </section>
  `,
})
export class DashboardComponent implements OnInit {
  private readonly firebase = inject(FirebaseService);
  private readonly calculator = inject(TdeeCalculatorService);

  protected readonly logs = signal<DailyLog[]>([]);
  protected readonly loading = signal(false);

  protected readonly tdee = computed<TdeeResult>(() => this.calculator.calculate(this.logs()));

  protected readonly currentWeight = computed<number | null>(() => {
    const list = this.logs();
    if (list.length === 0) return null;
    // logs are oldest -> newest
    return list[list.length - 1].weight;
  });

  protected readonly trendLabel = computed<string>(() => {
    const change = this.tdee().weightChangeTrend;
    if (change === 0) return '—';
    const sign = change > 0 ? '-' : '+'; // positive change = lost weight
    return `${sign}${Math.abs(change).toFixed(1)} lbs`;
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
}
