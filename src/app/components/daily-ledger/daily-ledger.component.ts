import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DailyLog, LogEntry, MealPreset } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';

type Mode = 'view' | 'add' | 'edit';
type Status = 'idle' | 'saving' | 'saved' | 'error';

@Component({
  selector: 'app-daily-ledger',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <!-- Travel mode banner -->
      @if (store.travelMode()) {
        <div class="specimen px-4 py-2.5 mb-4 flex items-center justify-between gap-3"
          style="border-color: var(--color-gold)">
          <span class="crop-bl" style="border-color: var(--color-gold)"></span>
          <span class="crop-br" style="border-color: var(--color-gold)"></span>
          <div class="flex items-center gap-2">
            <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-gold); color: var(--color-gold)">travel</span>
            <span class="caption text-[11px]">maintenance mode — deficit suspended.</span>
          </div>
          <button type="button" (click)="store.toggleTravelMode()" class="tag-btn text-[9px]">
            end trip
          </button>
        </div>
      }

      <!-- Streak badge -->
      @if (store.streak() > 0) {
        <div class="flex items-center gap-2 mb-4">
          <span class="font-mono text-xs tracking-[0.1em] text-graphite">
            <span class="font-medium text-ink">{{ store.streak() }}</span> day{{ store.streak() === 1 ? '' : 's' }} logged
          </span>
          @if (store.streak() >= 7) {
            <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">streak</span>
          }
        </div>
      }

      <!-- Today so far + progress bar -->
      @if (store.todaySummary(); as s) {
        <div class="specimen px-4 py-3 mb-6">
          <span class="crop-bl"></span><span class="crop-br"></span>
          <div class="flex items-center justify-between">
            <div>
              <div class="data-label">today so far</div>
              <div class="font-mono text-2xl font-medium text-ink mt-0.5 tabular-nums">
                {{ s.totalCalories }}
                <span class="text-graphite text-sm font-normal">/ {{ store.targetCalories() }} kcal</span>
              </div>
            </div>
            @if (s.totalProtein > 0) {
              <div class="text-right">
                <div class="data-label" style="color: var(--color-protein)">protein</div>
                <div class="font-mono text-2xl font-medium tabular-nums mt-0.5" style="color: var(--color-protein)">
                  {{ s.totalProtein }}
                  <span class="text-sm font-normal opacity-70">g</span>
                </div>
              </div>
            }
          </div>
          @if (store.targetCalories() > 0) {
            <div class="mt-2 h-1.5 w-full bg-paper-deep relative overflow-hidden">
              <div class="h-full transition-all duration-300"
                [style.width.%]="Math.min(100, (s.totalCalories / store.targetCalories()) * 100)"
                [style.background]="s.totalCalories > store.targetCalories() ? 'var(--color-blood)' : 'var(--color-olive)'">
              </div>
            </div>
            <div class="flex justify-between mt-1">
              <span class="font-mono text-[9px] tracking-[0.1em] text-graphite tabular-nums">
                {{ Math.max(0, store.targetCalories() - s.totalCalories) }} remaining
              </span>
              <span class="font-mono text-[9px] tracking-[0.1em] tabular-nums"
                [style.color]="s.totalCalories > store.targetCalories() ? 'var(--color-blood)' : 'var(--color-graphite)'">
                {{ Math.round((s.totalCalories / store.targetCalories()) * 100) }}%
              </span>
            </div>
          }
        </div>
      }

      <!-- Log tape -->
      <div class="rule"><span>{{ store.logs().length > 0 ? 'log tape' : 'no entries yet' }}</span></div>

      <div class="mt-3">
        @for (log of store.logs(); track log.id; let i = $index) {
          <div class="tape-strip tape-in"
            [class.tape-editing]="editTarget()?.id === log.id"
            [style.animation-delay]="(i * 40) + 'ms'"
            (click)="onTapEntry(log)">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-3 min-w-0">
                <span class="font-mono text-[10px] tracking-[0.12em] text-graphite shrink-0 w-[70px]">
                  {{ formatDate(log.date) }}
                </span>
                <span class="font-mono text-sm text-ink tabular-nums">
                  {{ log.weight }}<span class="text-graphite text-[10px] ml-0.5">lb</span>
                </span>
                <span class="font-mono text-sm tabular-nums" style="color: var(--color-blood)">
                  {{ log.calories }}<span class="text-[10px] ml-0.5 opacity-70">cal</span>
                </span>
                @if (log.protein != null) {
                  <span class="font-mono text-sm tabular-nums" style="color: var(--color-protein)">
                    {{ log.protein }}<span class="text-[10px] ml-0.5 opacity-70">g</span>
                  </span>
                }
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                @if (log.liftCompleted) {
                  <span class="inline-block w-2 h-2 rounded-full" style="background: var(--color-blood)" title="Lift"></span>
                }
                @if (log.cardioCompleted) {
                  <span class="inline-block w-2 h-2" style="background: var(--color-olive); clip-path: polygon(50% 0%, 100% 100%, 0% 100%);" title="Cardio"></span>
                }
              </div>
            </div>
            @if (editTarget()?.id === log.id && mode() === 'edit') {
              <div class="slide-down mt-3 pt-3 border-t border-rule/40" (click)="$event.stopPropagation()">
                <ng-container *ngTemplateOutlet="entryForm"></ng-container>
              </div>
            }
          </div>
        }

        @if (store.logs().length === 0) {
          <div class="py-8 text-center">
            <p class="caption text-[11px]">tap the button below to record your first entry.</p>
          </div>
        }
      </div>

      <!-- Add new / form -->
      <div class="mt-4">
        @if (mode() === 'view') {
          <button type="button" (click)="startAdd()" class="stamp-btn">+ new entry</button>
        } @else if (mode() === 'add') {
          <div class="specimen px-4 py-5 slide-down">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">new</span>
              <span class="data-label">entry</span>
            </div>

            @if (store.presets().length > 0) {
              <div class="mb-4">
                <div class="data-label mb-1.5">quick add</div>
                <div class="flex flex-wrap gap-1.5">
                  @for (p of store.presets(); track p.id) {
                    <button type="button" (click)="applyPreset(p)" class="tag-btn text-[9px] group relative">
                      {{ p.name }}
                      <span class="text-graphite-soft">{{ p.calories }}</span>
                      <button type="button" (click)="removePreset(p, $event)"
                        class="ml-1 opacity-0 group-hover:opacity-100 text-blood text-[9px] transition-opacity"
                        title="Remove preset">✕</button>
                    </button>
                  }
                </div>
              </div>
            }

            <ng-container *ngTemplateOutlet="entryForm"></ng-container>
          </div>
        }
      </div>

      <!-- Shared form template -->
      <ng-template #entryForm>
        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="data-label block mb-1">weight</label>
              <div class="flex items-baseline gap-1">
                <input type="number" step="0.1" inputmode="decimal" required
                  [ngModel]="weight()" (ngModelChange)="weight.set($event)"
                  name="weight" placeholder="___" class="field-input text-base" />
                <span class="font-display italic text-graphite text-xs">lbs</span>
              </div>
            </div>
            <div>
              <label class="data-label block mb-1">calories</label>
              <div class="flex items-baseline gap-1">
                <input type="number" step="1" inputmode="numeric" required
                  [ngModel]="calories()" (ngModelChange)="calories.set($event)"
                  name="calories" placeholder="____" class="field-input text-base" />
                <span class="font-display italic text-graphite text-xs">kcal</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="data-label block mb-1">
                protein <span class="normal-case italic text-graphite-soft tracking-normal text-[9px]">opt</span>
              </label>
              <div class="flex items-baseline gap-1">
                <input type="number" step="1" inputmode="numeric"
                  [ngModel]="protein()" (ngModelChange)="protein.set($event)"
                  name="protein" placeholder="___" class="field-input text-base" />
                <span class="font-display italic text-graphite text-xs">g</span>
              </div>
            </div>
            <div>
              <label class="data-label block mb-1">training</label>
              <div class="flex gap-2 mt-1">
                <button type="button" (click)="liftDone.set(!liftDone())"
                  [class.selected]="liftDone()" class="radio-card flex-1 text-center py-1.5">
                  <span class="font-mono text-[10px] tracking-[0.1em] uppercase">
                    {{ liftDone() ? '●' : '○' }} lift
                  </span>
                </button>
                <button type="button" (click)="cardioDone.set(!cardioDone())"
                  [class.selected]="cardioDone()" class="radio-card flex-1 text-center py-1.5">
                  <span class="font-mono text-[10px] tracking-[0.1em] uppercase">
                    {{ cardioDone() ? '▲' : '△' }} cardio
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div class="flex gap-2 pt-1">
            <button type="submit" [disabled]="status() === 'saving'" class="stamp-btn flex-1">
              {{ status() === 'saving' ? 'saving…' : mode() === 'edit' ? 'save' : 'commit' }}
            </button>
            @if (mode() === 'edit') {
              <button type="button" (click)="deleteEntry()" class="tag-btn text-blood border-blood/40 hover:bg-blood hover:text-paper">
                delete
              </button>
            }
            <button type="button" (click)="cancel()" class="tag-btn">cancel</button>
          </div>

          @if (status() === 'saved') {
            <div class="flex items-center gap-2">
              <span class="stamp-mark" style="transform: rotate(0deg)">ok</span>
              <span class="caption text-[11px]">saved.</span>
              @if (mode() === 'add' && !savingPreset()) {
                <button type="button" (click)="promptSavePreset()"
                  class="tag-btn text-[9px] ml-auto">save as preset</button>
              }
            </div>
            @if (savingPreset()) {
              <div class="flex items-center gap-2 mt-2">
                <input type="text" [value]="presetName()"
                  (input)="presetName.set($any($event.target).value)"
                  placeholder="preset name" class="field-input text-sm flex-1" />
                <button type="button" (click)="confirmSavePreset()" class="tag-btn">save</button>
              </div>
            }
          }
          @if (status() === 'error') {
            <p class="font-mono text-[11px] text-blood">✕ {{ errorMsg() }}</p>
          }
        </form>
      </ng-template>
    </section>
  `,
})
export class DailyLedgerComponent {
  protected readonly store = inject(FitnessStore);
  protected readonly Math = Math;

  // ── Form-local state ────────────────────────────────────────
  protected readonly mode = signal<Mode>('view');
  protected readonly editTarget = signal<DailyLog | null>(null);
  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly savingPreset = signal(false);
  protected readonly presetName = signal('');

  protected readonly weight = signal<number | null>(null);
  protected readonly calories = signal<number | null>(null);
  protected readonly protein = signal<number | null>(null);
  protected readonly liftDone = signal(false);
  protected readonly cardioDone = signal(false);

  // ── Interactions ────────────────────────────────────────────
  protected onTapEntry(log: DailyLog): void {
    if (this.editTarget()?.id === log.id && this.mode() === 'edit') {
      this.cancel();
      return;
    }
    this.editTarget.set(log);
    this.mode.set('edit');
    this.weight.set(log.weight);
    this.calories.set(log.calories);
    this.protein.set(log.protein ?? null);
    this.liftDone.set(log.liftCompleted ?? false);
    this.cardioDone.set(log.cardioCompleted ?? false);
    this.status.set('idle');
    this.errorMsg.set('');
  }

  protected startAdd(): void {
    this.resetForm();
    this.mode.set('add');
    this.editTarget.set(null);
    this.status.set('idle');
  }

  protected cancel(): void {
    this.mode.set('view');
    this.editTarget.set(null);
    this.resetForm();
    this.status.set('idle');
  }

  protected async onSubmit(): Promise<void> {
    const w = this.weight();
    const c = this.calories();
    if (w == null || c == null || Number.isNaN(w) || Number.isNaN(c)) {
      this.status.set('error');
      this.errorMsg.set('Weight and calories are required.');
      return;
    }

    const entry: LogEntry = { weight: Number(w), calories: Number(c) };
    const p = this.protein();
    if (p != null && !Number.isNaN(Number(p))) entry.protein = Number(p);
    entry.liftCompleted = this.liftDone();
    entry.cardioCompleted = this.cardioDone();

    this.status.set('saving');
    try {
      const editing = this.editTarget();
      if (this.mode() === 'edit' && editing?.id) {
        await this.store.updateLog(editing.id, entry);
      } else {
        await this.store.addLog(entry);
      }
      this.status.set('saved');
      this.savingPreset.set(false);
      if (this.mode() === 'edit') {
        setTimeout(() => this.cancel(), 800);
      }
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to save.');
    }
  }

  protected async deleteEntry(): Promise<void> {
    const target = this.editTarget();
    if (!target?.id) return;
    try {
      await this.store.deleteLog(target.id);
      this.cancel();
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to delete.');
    }
  }

  protected formatDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }

  private resetForm(): void {
    this.weight.set(null);
    this.calories.set(null);
    this.protein.set(null);
    this.liftDone.set(false);
    this.cardioDone.set(false);
  }

  // ── Presets ─────────────────────────────────────────────────
  protected applyPreset(p: MealPreset): void {
    this.calories.set(p.calories);
    if (p.protein != null) this.protein.set(p.protein);
  }

  protected async removePreset(p: MealPreset, event: Event): Promise<void> {
    event.stopPropagation();
    if (p.id) await this.store.deletePreset(p.id);
  }

  protected promptSavePreset(): void {
    this.savingPreset.set(true);
    this.presetName.set('');
  }

  protected async confirmSavePreset(): Promise<void> {
    const name = this.presetName().trim();
    const cal = this.calories();
    if (!name || cal == null) return;
    const preset: Omit<MealPreset, 'id'> = { name, calories: Number(cal) };
    const pro = this.protein();
    if (pro != null) preset.protein = Number(pro);
    await this.store.addPreset(preset);
    this.savingPreset.set(false);
  }
}
