import { ChangeDetectionStrategy, Component, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DailyLog, FirebaseService, LogEntry } from '../../services/firebase.service';

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
          <label for="weight" class="data-label block mb-1">i. morning weight</label>
          <div class="flex items-baseline gap-3">
            <input id="weight" name="weight" type="number" step="0.1" inputmode="decimal" required
              [ngModel]="weight()" (ngModelChange)="weight.set($event)"
              placeholder="___.__" class="field-input flex-1" />
            <span class="font-display italic text-graphite text-sm shrink-0">lbs</span>
          </div>
        </div>

        <!-- Calories -->
        <div>
          <label for="calories" class="data-label block mb-1">ii. total calories consumed</label>
          <div class="flex items-baseline gap-3">
            <input id="calories" name="calories" type="number" step="1" inputmode="numeric" required
              [ngModel]="calories()" (ngModelChange)="calories.set($event)"
              placeholder="____" class="field-input flex-1" />
            <span class="font-display italic text-graphite text-sm shrink-0">kcal</span>
          </div>
        </div>

        <!-- Protein -->
        <div>
          <label for="protein" class="data-label block mb-1">
            iii. protein
            <span class="normal-case italic text-graphite tracking-normal text-[11px]">(optional)</span>
          </label>
          <div class="flex items-baseline gap-3">
            <input id="protein" name="protein" type="number" step="1" inputmode="numeric"
              [ngModel]="protein()" (ngModelChange)="protein.set($event)"
              placeholder="___" class="field-input flex-1" />
            <span class="font-display italic text-graphite text-sm shrink-0">g</span>
          </div>
        </div>

        <!-- Training toggles -->
        <div>
          <label class="data-label block mb-2">iv. training</label>
          <div class="flex flex-wrap gap-3">
            <button type="button" (click)="liftDone.set(!liftDone())"
              [class.selected]="liftDone()"
              class="radio-card flex-1 min-w-[120px] text-center">
              <div class="font-mono text-xs tracking-[0.12em] uppercase">
                {{ liftDone() ? '✓' : '○' }} lift
              </div>
            </button>
            <button type="button" (click)="cardioDone.set(!cardioDone())"
              [class.selected]="cardioDone()"
              class="radio-card flex-1 min-w-[120px] text-center">
              <div class="font-mono text-xs tracking-[0.12em] uppercase">
                {{ cardioDone() ? '✓' : '○' }} cardio
              </div>
            </button>
          </div>
        </div>

        <!-- Submit -->
        <div class="pt-2 flex gap-3">
          <button type="submit" [disabled]="status() === 'saving'" class="stamp-btn flex-1">
            {{ status() === 'saving' ? 'committing…' : editingLog() ? 'save changes' : 'commit entry' }}
          </button>
          @if (editingLog()) {
            <button type="button" (click)="cancelEdit()" class="tag-btn">cancel</button>
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
          <p class="font-mono text-[11px] text-blood mt-3 leading-relaxed">✕ {{ errorMsg() }}</p>
        }
      </form>

      <!-- Recent entries -->
      @if (recentLogs().length > 0) {
        <div class="mt-10">
          <div class="rule"><span>recent entries</span></div>
          <div class="mt-4 space-y-0">
            @for (log of recentLogs(); track log.id) {
              <div class="flex items-center justify-between gap-3 py-2.5 border-b border-rule/30 group"
                [class.bg-paper-deep]="editingLog()?.id === log.id">
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-[11px] text-graphite tracking-[0.1em]">
                    {{ formatDate(log.date) }}
                    @if (log.liftCompleted) { <span class="text-blood ml-1" title="Lift completed">●</span> }
                    @if (log.cardioCompleted) { <span class="text-graphite-soft ml-0.5" title="Cardio completed">◆</span> }
                  </div>
                  <div class="flex items-baseline gap-3 mt-0.5 flex-wrap">
                    <span class="font-mono text-sm text-ink">{{ log.weight }} <span class="text-graphite text-[10px]">lbs</span></span>
                    <span class="font-mono text-sm text-ink">{{ log.calories }} <span class="text-graphite text-[10px]">kcal</span></span>
                    @if (log.protein != null) {
                      <span class="font-mono text-sm text-ink">{{ log.protein }} <span class="text-graphite text-[10px]">g pro</span></span>
                    }
                  </div>
                </div>
                <div class="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button type="button" (click)="startEdit(log)" title="Edit entry"
                    class="font-mono text-[10px] tracking-[0.15em] uppercase text-ink hover:text-blood transition-colors px-1.5 py-0.5">
                    edit
                  </button>
                  <button type="button" (click)="deleteEntry(log)" title="Delete entry"
                    class="font-mono text-[10px] tracking-[0.15em] uppercase text-graphite hover:text-blood transition-colors px-1.5 py-0.5">
                    ✕
                  </button>
                </div>
              </div>
            }
          </div>
          <div class="mt-3 flex items-center gap-3 text-[10px] font-mono text-graphite tracking-[0.1em]">
            <span class="text-blood">●</span> lift &nbsp;
            <span class="text-graphite-soft">◆</span> cardio
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .radio-card {
      padding: 10px 14px;
      background: transparent;
      border: 1px solid var(--color-rule);
      cursor: pointer;
      transition: all 180ms ease;
    }
    .radio-card:hover { background: rgba(26, 22, 18, 0.04); }
    .radio-card.selected {
      background: var(--color-ink);
      color: var(--color-paper);
      border-color: var(--color-ink);
      box-shadow: 2px 2px 0 0 var(--color-blood);
    }
  `],
})
export class DailyLedgerComponent implements OnInit {
  private readonly firebase = inject(FirebaseService);

  readonly logSaved = output<void>();

  protected readonly weight = signal<number | null>(null);
  protected readonly calories = signal<number | null>(null);
  protected readonly protein = signal<number | null>(null);
  protected readonly liftDone = signal(false);
  protected readonly cardioDone = signal(false);
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
      this.errorMsg.set('Weight and calories are required.');
      return;
    }

    const entry: LogEntry = {
      weight: Number(w),
      calories: Number(c),
    };
    const p = this.protein();
    if (p != null && !Number.isNaN(Number(p))) entry.protein = Number(p);
    entry.liftCompleted = this.liftDone();
    entry.cardioCompleted = this.cardioDone();

    this.status.set('saving');
    try {
      const editing = this.editingLog();
      if (editing?.id) {
        await this.firebase.updateLog(editing.id, entry);
      } else {
        await this.firebase.addLog(entry);
      }
      this.status.set('saved');
      this.resetForm();
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
    this.protein.set(log.protein ?? null);
    this.liftDone.set(log.liftCompleted ?? false);
    this.cardioDone.set(log.cardioCompleted ?? false);
    this.status.set('idle');
  }

  protected cancelEdit(): void {
    this.editingLog.set(null);
    this.resetForm();
    this.status.set('idle');
  }

  protected async deleteEntry(log: DailyLog): Promise<void> {
    if (!log.id) return;
    try {
      await this.firebase.deleteLog(log.id);
      this.logSaved.emit();
      this.loadRecent();
      if (this.editingLog()?.id === log.id) this.cancelEdit();
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to delete.');
    }
  }

  protected formatDate(d: Date): string {
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    }).toUpperCase();
  }

  private resetForm(): void {
    this.weight.set(null);
    this.calories.set(null);
    this.protein.set(null);
    this.liftDone.set(false);
    this.cardioDone.set(false);
    this.editingLog.set(null);
  }

  private async loadRecent(): Promise<void> {
    try {
      this.recentLogs.set(await this.firebase.getRecentLogs(7));
    } catch { /* non-critical */ }
  }
}
