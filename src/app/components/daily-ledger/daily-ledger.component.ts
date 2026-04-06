import { ChangeDetectionStrategy, Component, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DailyLog, FirebaseService } from '../../services/firebase.service';

type Status = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-daily-ledger',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule">
        <span>{{ editingLog() ? 'amend entry' : "today's entry" }}</span>
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
        <div class="pt-2 flex gap-3">
          <button
            type="submit"
            [disabled]="status() === 'saving'"
            class="stamp-btn flex-1"
          >
            {{ status() === 'saving' ? 'committing…' : editingLog() ? 'save changes' : 'commit entry' }}
          </button>
          @if (editingLog()) {
            <button
              type="button"
              (click)="cancelEdit()"
              class="tag-btn"
            >
              cancel
            </button>
          }
        </div>

        @if (status() === 'saved') {
          <div class="flex items-center gap-3 mt-3">
            <span class="stamp-mark">filed</span>
            <p class="caption text-[11px]">
              {{ editingLog() ? 'entry amended.' : 'entry committed to the record.' }}
            </p>
          </div>
        }
        @if (status() === 'error') {
          <p class="font-mono text-[11px] text-blood mt-3 leading-relaxed">
            ✕ {{ errorMsg() }}
          </p>
        }
      </form>

      <!-- Recent entries -->
      @if (recentLogs().length > 0) {
        <div class="mt-10">
          <div class="rule">
            <span>recent entries</span>
          </div>
          <div class="mt-4 space-y-0">
            @for (log of recentLogs(); track log.id) {
              <div
                class="flex items-center justify-between gap-3 py-2.5 border-b border-rule/30 group"
                [class.bg-paper-deep]="editingLog()?.id === log.id"
              >
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-[11px] text-graphite tracking-[0.1em]">
                    {{ formatDate(log.date) }}
                  </div>
                  <div class="flex items-baseline gap-4 mt-0.5">
                    <span class="font-mono text-sm text-ink">{{ log.weight }} <span class="text-graphite text-[10px]">lbs</span></span>
                    <span class="font-mono text-sm text-ink">{{ log.calories }} <span class="text-graphite text-[10px]">kcal</span></span>
                  </div>
                </div>
                <div class="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    (click)="startEdit(log)"
                    class="font-mono text-[10px] tracking-[0.15em] uppercase text-ink hover:text-blood transition-colors px-1.5 py-0.5"
                    title="Edit entry"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    (click)="deleteEntry(log)"
                    class="font-mono text-[10px] tracking-[0.15em] uppercase text-graphite hover:text-blood transition-colors px-1.5 py-0.5"
                    title="Delete entry"
                  >
                    ✕
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class DailyLedgerComponent implements OnInit {
  private readonly firebase = inject(FirebaseService);

  readonly logSaved = output<void>();

  protected readonly weight = signal<number | null>(null);
  protected readonly calories = signal<number | null>(null);
  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly editingLog = signal<DailyLog | null>(null);
  protected readonly recentLogs = signal<DailyLog[]>([]);

  ngOnInit(): void {
    this.loadRecent();
  }

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
      const editing = this.editingLog();
      if (editing?.id) {
        await this.firebase.updateLog(editing.id, Number(w), Number(c));
      } else {
        await this.firebase.addLog(Number(w), Number(c));
      }
      this.status.set('saved');
      this.weight.set(null);
      this.calories.set(null);
      this.editingLog.set(null);
      this.logSaved.emit();
      this.loadRecent();
      setTimeout(() => this.status.set('idle'), 2800);
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to save log.');
    }
  }

  protected startEdit(log: DailyLog): void {
    this.editingLog.set(log);
    this.weight.set(log.weight);
    this.calories.set(log.calories);
    this.status.set('idle');
    this.errorMsg.set('');
  }

  protected cancelEdit(): void {
    this.editingLog.set(null);
    this.weight.set(null);
    this.calories.set(null);
    this.status.set('idle');
  }

  protected async deleteEntry(log: DailyLog): Promise<void> {
    if (!log.id) return;
    try {
      await this.firebase.deleteLog(log.id);
      this.logSaved.emit();
      this.loadRecent();
      // If we were editing this entry, cancel the edit.
      if (this.editingLog()?.id === log.id) {
        this.cancelEdit();
      }
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to delete.');
    }
  }

  protected formatDate(d: Date): string {
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).toUpperCase();
  }

  private async loadRecent(): Promise<void> {
    try {
      const logs = await this.firebase.getRecentLogs(7);
      this.recentLogs.set(logs);
    } catch {
      // Non-critical — the list just doesn't render.
    }
  }
}
