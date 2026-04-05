import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { TdeeCalculatorService } from '../../services/tdee-calculator.service';

type CopyStatus = 'idle' | 'copying' | 'copied' | 'error';

@Component({
  selector: 'app-context-bridge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="w-full max-w-md mx-auto">
      <button
        type="button"
        (click)="copyContext()"
        [disabled]="status() === 'copying'"
        class="w-full rounded-2xl bg-slate-900/70 hover:bg-slate-800 ring-1 ring-slate-800 hover:ring-emerald-700 py-3 text-sm font-semibold text-slate-200 transition flex items-center justify-center gap-2"
      >
        @switch (status()) {
          @case ('copying') { <span>Building context…</span> }
          @case ('copied')  { <span class="text-emerald-400">✓ Copied to clipboard</span> }
          @case ('error')   { <span class="text-red-400">{{ errorMsg() }}</span> }
          @default          { <span>Copy AI Context</span> }
        }
      </button>
      <p class="text-[11px] text-slate-500 text-center mt-2">
        Copies the last 14 days as Markdown so you can paste it into a chat.
      </p>
    </section>
  `,
})
export class ContextBridgeComponent {
  private readonly firebase = inject(FirebaseService);
  private readonly calculator = inject(TdeeCalculatorService);

  protected readonly status = signal<CopyStatus>('idle');
  protected readonly errorMsg = signal('');

  protected async copyContext(): Promise<void> {
    this.status.set('copying');
    try {
      const logs = await this.firebase.getRecentLogs(14);
      const tdee = this.calculator.calculate(logs);
      const markdown = this.buildMarkdown(logs, tdee);

      await navigator.clipboard.writeText(markdown);
      this.status.set('copied');
      setTimeout(() => this.status.set('idle'), 2500);
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Copy failed.');
      setTimeout(() => this.status.set('idle'), 3000);
    }
  }

  private buildMarkdown(
    logs: { date: Date; weight: number; calories: number }[],
    tdee: { trueTdee: number; newDailyTarget: number; weightChangeTrend: number },
  ): string {
    const lines: string[] = [];
    lines.push('# Fitness Tracker — 14 Day Context');
    lines.push('');
    lines.push(`- **True TDEE:** ${tdee.trueTdee} kcal/day`);
    lines.push(`- **New Daily Target:** ${tdee.newDailyTarget} kcal/day`);
    lines.push(`- **14-Day Weight Change:** ${tdee.weightChangeTrend} lbs (positive = lost)`);
    lines.push('');
    lines.push('## Daily Logs');
    lines.push('');
    lines.push('| Date | Weight (lbs) | Calories |');
    lines.push('| --- | --- | --- |');
    for (const log of logs) {
      lines.push(`| ${this.formatDate(log.date)} | ${log.weight} | ${log.calories} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  private formatDate(d: Date): string {
    // ISO date (YYYY-MM-DD) — unambiguous for the AI to parse.
    return d.toISOString().slice(0, 10);
  }
}
