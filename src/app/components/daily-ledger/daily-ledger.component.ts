import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DailyLog, LogEntry, MealPreset } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { PhotoMacrosService } from '../../services/photo-macros.service';

type Mode = 'view' | 'add' | 'edit';
type Status = 'idle' | 'saving' | 'saved' | 'error';

/** Grouped view: one header per calendar day, meals nested under it. */
interface DayGroup {
  dateKey: string;
  dateLabel: string;
  weight: number | null;
  liftCompleted: boolean;
  cardioCompleted: boolean;
  totalCalories: number;
  totalProtein: number;
  meals: DailyLog[];
}

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
          <button type="button" (click)="store.toggleTravelMode()" class="tag-btn text-[9px]">end trip</button>
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

      <!-- ─── Day-grouped log tape ─────────────────────────── -->
      <div class="rule"><span>{{ dayGroups().length > 0 ? 'log tape' : 'no entries yet' }}</span></div>

      <div class="mt-3">
        @for (day of dayGroups(); track day.dateKey; let di = $index) {
          <!-- Day header: date + weight + training + daily total + progress bar -->
          <div class="tape-strip tape-in border-b-2 border-rule/60"
            [style.animation-delay]="(di * 60) + 'ms'" style="cursor: default;">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-3">
                <span class="font-mono text-[11px] tracking-[0.12em] font-medium text-ink">
                  {{ day.dateLabel }}
                </span>
                @if (day.weight != null) {
                  <span class="font-mono text-[11px] text-graphite tabular-nums">
                    {{ day.weight }}<span class="text-[9px] ml-0.5">lb</span>
                  </span>
                }
                <div class="flex items-center gap-1">
                  @if (day.liftCompleted) {
                    <span class="inline-block w-2 h-2 rounded-full" style="background: var(--color-blood)" title="Lift"></span>
                  }
                  @if (day.cardioCompleted) {
                    <span class="inline-block w-2 h-2" style="background: var(--color-olive); clip-path: polygon(50% 0%, 100% 100%, 0% 100%);" title="Cardio"></span>
                  }
                </div>
              </div>
              <div class="flex items-center gap-3">
                <span class="font-mono text-sm font-medium tabular-nums" style="color: var(--color-blood)">
                  {{ day.totalCalories }}<span class="text-[10px] ml-0.5 opacity-70">cal</span>
                </span>
                @if (day.totalProtein > 0) {
                  <span class="font-mono text-xs tabular-nums" style="color: var(--color-protein)">
                    {{ day.totalProtein }}<span class="text-[10px] ml-0.5 opacity-70">g</span>
                  </span>
                }
                <!-- Add meal to this day -->
                <button type="button" (click)="startAdd(day.dateKey); $event.stopPropagation()"
                  class="tag-btn text-[9px] py-0.5 px-1.5" title="Add meal">+</button>
              </div>
            </div>

            <!-- Progress bar for today only -->
            @if (day.dateKey === todayKey && store.targetCalories() > 0) {
              <div class="mt-1.5 h-1 w-full bg-paper-deep relative overflow-hidden">
                <div class="h-full transition-all duration-300"
                  [style.width.%]="Math.min(100, (day.totalCalories / store.targetCalories()) * 100)"
                  [style.background]="day.totalCalories > store.targetCalories() ? 'var(--color-blood)' : 'var(--color-olive)'">
                </div>
              </div>
              <div class="flex justify-between mt-0.5">
                <span class="font-mono text-[8px] tracking-[0.1em] text-graphite tabular-nums">
                  {{ Math.max(0, store.targetCalories() - day.totalCalories) }} remaining
                </span>
                <span class="font-mono text-[8px] tracking-[0.1em] tabular-nums"
                  [style.color]="day.totalCalories > store.targetCalories() ? 'var(--color-blood)' : 'var(--color-graphite)'">
                  {{ Math.round((day.totalCalories / store.targetCalories()) * 100) }}%
                </span>
              </div>
            }
          </div>

          <!-- Meal entries nested under this day -->
          @for (meal of day.meals; track meal.id; let mi = $index) {
            <div class="tape-strip tape-in pl-6"
              [class.tape-editing]="editTarget()?.id === meal.id"
              [style.animation-delay]="(di * 60 + mi * 30 + 30) + 'ms'"
              (click)="onTapMeal(meal)">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="font-mono text-[10px] tracking-[0.08em] text-graphite-soft truncate max-w-[100px]">
                    {{ meal.mealLabel || 'Meal ' + (mi + 1) }}
                  </span>
                  <span class="font-mono text-sm tabular-nums" style="color: var(--color-blood)">
                    {{ meal.calories }}<span class="text-[10px] ml-0.5 opacity-70">cal</span>
                  </span>
                  @if (meal.protein != null) {
                    <span class="font-mono text-sm tabular-nums" style="color: var(--color-protein)">
                      {{ meal.protein }}<span class="text-[10px] ml-0.5 opacity-70">g</span>
                    </span>
                  }
                </div>
                <span class="font-mono text-[9px] text-graphite-soft opacity-60">tap to edit</span>
              </div>

              <!-- Inline edit form -->
              @if (editTarget()?.id === meal.id && mode() === 'edit') {
                <div class="slide-down mt-3 pt-3 border-t border-rule/40" (click)="$event.stopPropagation()">
                  <ng-container *ngTemplateOutlet="entryForm"></ng-container>
                </div>
              }
            </div>
          }

          <!-- Inline add form for this day -->
          @if (addingForDay() === day.dateKey && mode() === 'add') {
            <div class="tape-strip pl-6 slide-down bg-paper-deep" (click)="$event.stopPropagation()">
              <ng-container *ngTemplateOutlet="entryForm"></ng-container>
            </div>
          }
        }

        <!-- Empty state -->
        @if (dayGroups().length === 0) {
          <div class="py-8 text-center">
            <p class="caption text-[11px]">tap the button below to record your first entry.</p>
          </div>
        }
      </div>

      <!-- Global add button (for new day or first entry) -->
      <div class="mt-4">
        @if (mode() === 'view') {
          <button type="button" (click)="startAdd()" class="stamp-btn">+ new entry</button>
        } @else if (mode() === 'add' && !addingForDay()) {
          <div class="specimen px-4 py-5 slide-down">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">new</span>
              <span class="data-label">entry</span>
              <!-- Photo-to-Macros camera button -->
              <button type="button" (click)="photoInput.click()"
                [disabled]="photoStatus() === 'analyzing'"
                class="tag-btn text-[9px] ml-auto">
                {{ photoStatus() === 'analyzing' ? 'analyzing…' : '📷 snap meal' }}
              </button>
              <input #photoInput type="file" accept="image/*" capture="environment"
                class="hidden" (change)="onPhotoCaptured($event)" />
            </div>
            @if (photoStatus() === 'error') {
              <p class="font-mono text-[11px] text-blood mb-3">✕ {{ photoError() }}</p>
            }
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

      <!-- ─── Shared form template ──────────────────────────── -->
      <ng-template #entryForm>
        <form (ngSubmit)="onSubmit()" class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <!-- Weight (optional) -->
            <div>
              <label class="data-label block mb-1">
                weight <span class="normal-case italic text-graphite-soft tracking-normal text-[9px]">opt</span>
              </label>
              <div class="flex items-baseline gap-1">
                <input type="number" step="0.1" inputmode="decimal"
                  [ngModel]="weight()" (ngModelChange)="weight.set($event)"
                  name="weight" placeholder="___" class="field-input text-base" />
                <span class="font-display italic text-graphite text-xs">lbs</span>
              </div>
            </div>
            <!-- Calories (required) -->
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

          <div class="grid grid-cols-2 gap-3">
            <!-- Protein -->
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
            <!-- Training -->
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
  private readonly photoService = inject(PhotoMacrosService);
  protected readonly Math = Math;
  protected readonly todayKey = new Date().toISOString().slice(0, 10);

  // ── Form state ──────────────────────────────────────────────
  protected readonly mode = signal<Mode>('view');
  protected readonly editTarget = signal<DailyLog | null>(null);
  protected readonly addingForDay = signal<string | null>(null);
  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly savingPreset = signal(false);
  protected readonly presetName = signal('');
  protected readonly activePresetName = signal<string | null>(null);
  protected readonly photoStatus = signal<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  protected readonly photoError = signal('');

  protected readonly weight = signal<number | null>(null);
  protected readonly calories = signal<number | null>(null);
  protected readonly protein = signal<number | null>(null);
  protected readonly liftDone = signal(false);
  protected readonly cardioDone = signal(false);

  // ── Day grouping ────────────────────────────────────────────
  protected readonly dayGroups = computed<DayGroup[]>(() => {
    const logs = this.store.logs();
    const groups = new Map<string, DayGroup>();

    for (const log of logs) {
      const key = log.date.toISOString().slice(0, 10);
      let group = groups.get(key);
      if (!group) {
        group = {
          dateKey: key,
          dateLabel: log.date.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          }).toUpperCase(),
          weight: null,
          liftCompleted: false,
          cardioCompleted: false,
          totalCalories: 0,
          totalProtein: 0,
          meals: [],
        };
        groups.set(key, group);
      }
      group.meals.push(log);
      group.totalCalories += log.calories;
      group.totalProtein += log.protein ?? 0;
      if (group.weight == null && log.weight != null) group.weight = log.weight;
      if (log.liftCompleted) group.liftCompleted = true;
      if (log.cardioCompleted) group.cardioCompleted = true;
    }

    // Sort newest day first.
    return [...groups.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  });

  // ── Interactions ────────────────────────────────────────────
  protected onTapMeal(meal: DailyLog): void {
    if (this.editTarget()?.id === meal.id && this.mode() === 'edit') {
      this.cancel();
      return;
    }
    this.editTarget.set(meal);
    this.addingForDay.set(null);
    this.mode.set('edit');
    this.weight.set(meal.weight ?? null);
    this.calories.set(meal.calories);
    this.protein.set(meal.protein ?? null);
    this.liftDone.set(meal.liftCompleted ?? false);
    this.cardioDone.set(meal.cardioCompleted ?? false);
    this.status.set('idle');
  }

  protected startAdd(dateKey: string | null = null): void {
    this.resetForm();
    this.mode.set('add');
    this.editTarget.set(null);
    this.addingForDay.set(dateKey);
    this.status.set('idle');
  }

  protected cancel(): void {
    this.mode.set('view');
    this.editTarget.set(null);
    this.addingForDay.set(null);
    this.resetForm();
    this.status.set('idle');
  }

  protected async onSubmit(): Promise<void> {
    const c = this.calories();
    if (c == null || Number.isNaN(c)) {
      this.status.set('error');
      this.errorMsg.set('Calories are required.');
      return;
    }

    const entry: LogEntry = { calories: Number(c) };
    const w = this.weight();
    if (w != null && !Number.isNaN(Number(w))) entry.weight = Number(w);
    const p = this.protein();
    if (p != null && !Number.isNaN(Number(p))) entry.protein = Number(p);
    entry.liftCompleted = this.liftDone();
    entry.cardioCompleted = this.cardioDone();

    // Meal label: from active preset name, or auto-generated.
    if (this.activePresetName()) {
      entry.mealLabel = this.activePresetName()!;
    }

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

  private resetForm(): void {
    this.weight.set(null);
    this.calories.set(null);
    this.protein.set(null);
    this.liftDone.set(false);
    this.cardioDone.set(false);
    this.activePresetName.set(null);
  }

  // ── Presets ─────────────────────────────────────────────────
  protected applyPreset(p: MealPreset): void {
    this.calories.set(p.calories);
    if (p.protein != null) this.protein.set(p.protein);
    this.activePresetName.set(p.name);
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

  // ── Photo-to-Macros ─────────────────────────────────────────
  protected async onPhotoCaptured(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.photoStatus.set('analyzing');
    this.photoError.set('');

    try {
      const base64 = await this.resizeAndEncode(file, 1024);
      const result = await this.photoService.analyze(base64);

      // Pre-fill the form with estimates.
      this.calories.set(result.calories);
      this.protein.set(result.protein);
      this.activePresetName.set(result.description);
      this.photoStatus.set('idle');
    } catch (err) {
      this.photoStatus.set('error');
      this.photoError.set(err instanceof Error ? err.message : 'Photo analysis failed.');
    } finally {
      // Reset the input so the same file can be re-selected.
      input.value = '';
    }
  }

  /** Resize image to maxDim and return base64 (no data: prefix). */
  private resizeAndEncode(file: File, maxDim: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load image'));
      };
      img.src = URL.createObjectURL(file);
    });
  }
}
