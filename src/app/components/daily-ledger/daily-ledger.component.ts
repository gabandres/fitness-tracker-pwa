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
    <section>
      <!-- Section header: editorial rule with label -->
      <div class="rule">
        <span>today&rsquo;s entry</span>
      </div>

      <form (ngSubmit)="onSubmit()" class="mt-6 space-y-7">
        <!-- Morning weight -->
        <div>
          <label for="weight" class="data-label block mb-1">
            i. morning weight
          </label>
          <div class="flex items-baseline gap-3">
            <input
              id="weight"
              name="weight"
              type="number"
              step="0.1"
              inputmode="decimal"
              required
              [ngModel]="weight()"
              (ngModelChange)="weight.set($event)"
              placeholder="___.__"
              class="field-input flex-1"
            />
            <span class="font-display italic text-graphite text-sm shrink-0">lbs</span>
          </div>
        </div>

        <!-- Calories -->
        <div>
          <label for="calories" class="data-label block mb-1">
            ii. total calories consumed
          </label>
          <div class="flex items-baseline gap-3">
            <input
              id="calories"
              name="calories"
              type="number"
              step="1"
              inputmode="numeric"
              required
              [ngModel]="calories()"
              (ngModelChange)="calories.set($event)"
              placeholder="____"
              class="field-input flex-1"
            />
            <span class="font-display italic text-graphite text-sm shrink-0">kcal</span>
          </div>
        </div>

        <!-- Submit -->
        <div class="pt-2">
          <button
            type="submit"
            [disabled]="status() === 'saving'"
            class="stamp-btn"
          >
            {{ status() === 'saving' ? 'committing…' : 'commit entry' }}
          </button>
        </div>

        <!-- Status messages -->
        @if (status() === 'saved') {
          <div class="flex items-center gap-3 mt-3">
            <span class="stamp-mark">filed</span>
            <p class="caption text-[11px]">entry committed to the record.</p>
          </div>
        }
        @if (status() === 'error') {
          <p class="font-mono text-[11px] text-blood mt-3 leading-relaxed">
            ✕ {{ errorMsg() }}
          </p>
        }
      </form>
    </section>
  `,
})
export class DailyLedgerComponent {
  private readonly firebase = inject(FirebaseService);

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
      setTimeout(() => this.status.set('idle'), 2800);
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to save log.');
    }
  }
}
