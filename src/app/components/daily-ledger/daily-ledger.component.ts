import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseService } from '../../services/firebase.service';

type Status = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-daily-ledger',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="w-full max-w-md mx-auto rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 shadow-xl p-5 sm:p-6"
    >
      <header class="mb-4">
        <h2 class="text-lg font-semibold text-slate-100">Daily Ledger</h2>
        <p class="text-xs text-slate-400 mt-0.5">Log this morning's weight and yesterday's calories.</p>
      </header>

      <form (ngSubmit)="onSubmit()" class="space-y-4">
        <div>
          <label for="weight" class="block text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">
            Morning Weight (lbs)
          </label>
          <input
            id="weight"
            name="weight"
            type="number"
            step="0.1"
            inputmode="decimal"
            required
            [ngModel]="weight()"
            (ngModelChange)="weight.set($event)"
            placeholder="e.g. 184.6"
            class="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition"
          />
        </div>

        <div>
          <label for="calories" class="block text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">
            Total Calories Consumed
          </label>
          <input
            id="calories"
            name="calories"
            type="number"
            step="1"
            inputmode="numeric"
            required
            [ngModel]="calories()"
            (ngModelChange)="calories.set($event)"
            placeholder="e.g. 1850"
            class="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition"
          />
        </div>

        <button
          type="submit"
          [disabled]="status() === 'saving'"
          class="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-semibold py-2.5 transition"
        >
          {{ status() === 'saving' ? 'Saving…' : 'Save Entry' }}
        </button>

        @if (status() === 'saved') {
          <p class="text-xs text-emerald-400 text-center">Saved — dashboard refreshed.</p>
        }
        @if (status() === 'error') {
          <p class="text-xs text-red-400 text-center">{{ errorMsg() }}</p>
        }
      </form>
    </section>
  `,
})
export class DailyLedgerComponent {
  private readonly firebase = inject(FirebaseService);

  /** Notify parent so the dashboard can re-fetch. */
  readonly logSaved = output<void>();

  protected readonly weight = signal<number | null>(null);
  protected readonly calories = signal<number | null>(null);
  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');

  protected async onSubmit(): Promise<void> {
    const w = this.weight();
    const c = this.calories();
    if (w == null || c == null || Number.isNaN(w) || Number.isNaN(c)) {
      this.status.set('error');
      this.errorMsg.set('Both fields are required.');
      return;
    }

    this.status.set('saving');
    try {
      await this.firebase.addLog(Number(w), Number(c));
      this.status.set('saved');
      this.weight.set(null);
      this.calories.set(null);
      this.logSaved.emit();
      setTimeout(() => this.status.set('idle'), 2500);
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to save log.');
    }
  }
}
