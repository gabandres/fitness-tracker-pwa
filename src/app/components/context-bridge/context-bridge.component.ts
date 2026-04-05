import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FirebaseService } from '../../services/firebase.service';
import { TdeeCalculatorService } from '../../services/tdee-calculator.service';

type CopyStatus = 'idle' | 'copying' | 'copied' | 'error';

@Component({
  selector: 'app-context-bridge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule">
        <span>dispatch</span>
      </div>

      <div class="mt-6 flex items-center justify-between gap-6">
        <div class="flex-1">
          <p class="font-display text-xl leading-snug text-ink">
            Send the last fortnight<br/>
            <em class="text-blood">to the wire.</em>
          </p>
          <p class="caption mt-2 text-[11px]">
            copies a markdown transcript of the rolling 14-day record
            for pasting into correspondence.
          </p>
        </div>

        <button
          type="button"
          (click)="copyContext()"
          [disabled]="status() === 'copying'"
          class="tag-btn shrink-0"
        >
          @switch (status()) {
            @case ('copying') { <span>wiring…</span> }
            @case ('copied')  { <span>✓ copied</span> }
            @case ('error')   { <span>retry</span> }
            @default          { <span>copy ⎘</span> }
          }
        </button>
      </div>

      @if (status() === 'error') {
        <p class="font-mono text-[10px] text-blood mt-3">{{ errorMsg() }}</p>
      }
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
    return d.toISOString().slice(0, 10);
  }
}
