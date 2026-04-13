import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DailyLog } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { DateKey, localDateKey } from '../../utils/date';
import { EntryFormComponent } from '../entry-form/entry-form.component';
import { PhotoCaptureComponent } from '../photo-capture/photo-capture.component';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner.component';
import { PresetPickerComponent } from '../preset-picker/preset-picker.component';
import { StarterFoodsComponent } from '../starter-foods/starter-foods.component';
import { FastingStripComponent } from '../fasting/fasting-strip.component';
import { MacroEstimate } from '../../models/macro-estimate';

interface DateChip {
  dateKey: DateKey;
  dayLabel: string;
  dateNum: string;
  isToday: boolean;
  hasData: boolean;
}

interface DayGroup {
  dateKey: DateKey;
  dateLabel: string;
  weight: number | null;
  exerciseCompleted: boolean;
  totalCalories: number;
  totalProtein: number;
  meals: DailyLog[];
}

@Component({
  selector: 'app-daily-ledger',
  standalone: true,
  imports: [FormsModule, EntryFormComponent, PhotoCaptureComponent, BarcodeScannerComponent, PresetPickerComponent, StarterFoodsComponent, FastingStripComponent],
  providers: [EntryFormManager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <!-- Ambient fasting strip: keeps elapsed time + end-fast CTA visible
           while you're logging meals, without occupying 200px for the dial. -->
      <app-fasting-strip />

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
          <button type="button" (click)="store.toggleTravelMode()" class="tag-btn text-[11px]">end trip</button>
        </div>
      }

      <!-- ─── Hero: kcal remaining today ─────────────────────
           The primary user question ("can I eat this?") answered above
           all else. Shows once the profile is set (target > 0). Turns
           oxblood when over budget. -->
      @if (store.targetCalories() > 0) {
        <div class="mb-5 ink-in">
          <div class="data-label mb-1">kcal remaining today</div>
          <div class="flex items-baseline gap-4 flex-wrap">
            <span class="font-display italic leading-none tracking-tight tabular-nums"
              style="font-size: clamp(3rem, 13vw, 4.5rem);"
              [style.color]="remainingToday() < 0 ? 'var(--color-blood)' : 'var(--color-ink)'">
              {{ remainingToday() < 0 ? '−' : '' }}{{ Math.abs(remainingToday()).toLocaleString() }}
            </span>
            <div class="font-mono text-[11px] text-graphite tabular-nums leading-tight pb-2 tracking-[0.08em]">
              <div>target · {{ store.targetCalories().toLocaleString() }}</div>
              <div>eaten&nbsp; · {{ (store.todaySummary()?.totalCalories ?? 0).toLocaleString() }}</div>
            </div>
          </div>
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

      <!-- ─── Date navigation strip ──────────────────────────── -->
      <div class="date-strip-scroll overflow-x-auto -mx-1 px-1 pb-2 mb-3">
        <div class="flex gap-1.5 min-w-max">
          @for (chip of dateChips(); track chip.dateKey) {
            <button type="button" (click)="scrollToDay(chip.dateKey)"
              class="date-chip flex flex-col items-center px-2 py-1.5 min-w-[42px]"
              [class.date-chip--selected]="chip.dateKey === selectedDateKey()"
              [class.date-chip--today]="chip.isToday"
              [class.date-chip--empty]="!chip.hasData">
              <span class="font-mono text-[11px] tracking-[0.12em] uppercase text-graphite">
                {{ chip.dayLabel }}
              </span>
              <span class="font-mono text-base tabular-nums font-medium"
                [class.text-ink]="chip.hasData"
                [class.text-graphite-soft]="!chip.hasData">
                {{ chip.dateNum }}
              </span>
              @if (chip.hasData) {
                <span class="w-1 h-1 rounded-full mt-0.5" style="background: var(--color-olive)"
                  aria-label="has entries"></span>
              }
            </button>
          }
        </div>
      </div>

      <!-- ─── Today weight + add entry (top of tape) ────────── -->
      <div class="mb-4 flex items-center gap-3">
        @if (form.mode() === 'view') {
          <button type="button" (click)="form.startAdd()" class="stamp-btn">+ new entry</button>
          <!-- Today weight quick-input -->
          @if (editingWeightDay() === todayKey) {
            <form class="flex items-baseline gap-1" (ngSubmit)="saveTodayWeight()" (click)="$event.stopPropagation()">
              <input type="number" step="0.1" inputmode="decimal"
                [ngModel]="weightInput()" (ngModelChange)="weightInput.set($event)"
                name="todayWeight" placeholder="___"
                class="field-input text-xs w-16 py-0.5 px-1 tabular-nums" />
              <span class="font-display italic text-graphite text-[11px]">lb</span>
              <button type="submit" aria-label="Save weight" class="tag-btn text-[11px] py-0 px-1">ok</button>
              <button type="button" (click)="cancelEditWeight()" aria-label="Cancel weight edit" class="tag-btn text-[11px] py-0 px-1">x</button>
            </form>
          } @else {
            <button type="button" (click)="startEditWeight(todayKey, todayWeight())"
              [attr.aria-label]="todayWeight() != null ? 'Edit weight for today' : 'Add weight for today'"
              class="font-sans text-xs tabular-nums hover:underline"
              [class.text-graphite]="todayWeight() != null"
              [class.text-graphite-soft]="todayWeight() == null"
              [class.italic]="todayWeight() == null">
              @if (todayWeight() != null) {
                {{ todayWeight() }}<span class="text-[11px] ml-0.5">lb</span>
              } @else {
                + weight
              }
            </button>
          }
        }
      </div>
      <div>
        @if (form.mode() === 'add' && !form.addingForDay()) {
          <div class="specimen px-4 py-5 slide-down">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">new</span>
              <span class="data-label">entry</span>
              <div class="flex gap-1.5 ml-auto">
                <app-barcode-scanner (estimated)="form.applyEstimate($event)" />
                <app-photo-capture (estimated)="form.applyEstimate($event)" />
              </div>
            </div>
            <app-preset-picker (estimated)="form.applyEstimate($event)" />
            <app-entry-form />
          </div>
        }
        @if (form.mode() === 'edit') {
          <div id="edit-panel" class="specimen px-4 py-5 slide-down">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">edit</span>
              <span class="data-label truncate max-w-[180px]">{{ form.editTarget()?.mealLabel || 'meal' }}</span>
            </div>
            <app-entry-form />
          </div>
        }
      </div>

      <!-- ─── Day-grouped log tape ─────────────────────────── -->
      <div class="rule"><span>{{ dayGroups().length > 0 ? 'log tape' : 'no entries yet' }}</span></div>

      <div class="mt-3 space-y-4" #swipeArea>
        @for (day of dayGroups(); track day.dateKey; let di = $index) {
          <div>
          <!-- Day header: date + weight + training + daily total + progress bar -->
          <div class="tape-strip tape-in border-b-2"
            [id]="'day-' + day.dateKey"
            [class.border-blood]="day.dateKey === todayKey"
            [class.border-rule/60]="day.dateKey !== todayKey"
            [class.bg-paper-deep]="day.dateKey === todayKey"
            [style.animation-delay]="(di * 60) + 'ms'" style="cursor: default;">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-3">
                <span class="font-sans text-xs tracking-[0.12em] font-medium"
                  [class.text-blood]="day.dateKey === todayKey"
                  [class.text-ink]="day.dateKey !== todayKey">
                  {{ day.dateKey === todayKey ? 'TODAY' : day.dateLabel }}
                </span>
                <!-- Tappable daily weight -->
                @if (editingWeightDay() === day.dateKey) {
                  <form class="flex items-baseline gap-1" (ngSubmit)="saveWeight(day); $event.stopPropagation()" (click)="$event.stopPropagation()">
                    <input type="number" step="0.1" inputmode="decimal"
                      [ngModel]="weightInput()" (ngModelChange)="weightInput.set($event)"
                      name="dayWeight" placeholder="___"
                      class="field-input text-xs w-16 py-0.5 px-1 tabular-nums" />
                    <span class="font-display italic text-graphite text-[11px]">lb</span>
                    <button type="submit" aria-label="Save weight" class="tag-btn text-[11px] py-0 px-1">ok</button>
                    <button type="button" (click)="cancelEditWeight()" aria-label="Cancel weight edit" class="tag-btn text-[11px] py-0 px-1">x</button>
                  </form>
                } @else {
                  <button type="button" (click)="startEditWeight(day.dateKey, day.weight); $event.stopPropagation()"
                    class="font-sans text-xs tabular-nums hover:underline"
                    [class.text-graphite]="day.weight != null"
                    [class.text-graphite-soft]="day.weight == null"
                    [class.italic]="day.weight == null">
                    @if (day.weight != null) {
                      {{ day.weight }}<span class="text-[11px] ml-0.5">lb</span>
                    } @else {
                      + wt
                    }
                  </button>
                }
                <button type="button" (click)="toggleExercise(day); $event.stopPropagation()"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-sans tracking-[0.08em] uppercase font-medium border transition-colors duration-150"
                  [style.background]="day.exerciseCompleted ? 'var(--color-olive)' : 'transparent'"
                  [style.color]="day.exerciseCompleted ? 'var(--color-paper)' : 'var(--color-graphite-soft)'"
                  [style.border-color]="day.exerciseCompleted ? 'var(--color-olive)' : 'var(--color-rule)'"
                  [attr.aria-label]="day.exerciseCompleted ? 'Exercise: active' : 'Exercise: inactive'"
                  title="Toggle exercise">● exercise</button>
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
                <button type="button" (click)="form.startAdd(day.dateKey); $event.stopPropagation()"
                  [attr.aria-label]="'Add meal to ' + (day.dateKey === todayKey ? 'today' : day.dateLabel)"
                  class="tag-btn text-[11px] py-0.5 px-1.5" title="Add meal">+</button>
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
                <span class="font-mono text-[11px] tracking-[0.1em] text-graphite tabular-nums">
                  {{ Math.max(0, store.targetCalories() - day.totalCalories) }} remaining
                </span>
                <span class="font-mono text-[11px] tracking-[0.1em] tabular-nums"
                  [style.color]="day.totalCalories > store.targetCalories() ? 'var(--color-blood)' : 'var(--color-graphite)'">
                  {{ Math.round((day.totalCalories / store.targetCalories()) * 100) }}%
                </span>
              </div>
            }
            <!-- Protein progress (today only) -->
            @if (day.dateKey === todayKey && store.proteinTarget() > 0) {
              <div class="mt-1 h-0.5 w-full bg-paper-deep relative overflow-hidden">
                <div class="h-full transition-all duration-300"
                  [style.width.%]="Math.min(100, (day.totalProtein / store.proteinTarget()) * 100)"
                  style="background: var(--color-protein)">
                </div>
              </div>
              <div class="flex justify-between mt-0.5">
                <span class="font-mono text-[11px] tracking-[0.1em] tabular-nums" style="color: var(--color-protein)">
                  {{ day.totalProtein }}g / {{ store.proteinTarget() }}g protein
                </span>
                <span class="font-mono text-[11px] tracking-[0.1em] tabular-nums"
                  [style.color]="day.totalProtein >= store.proteinMinTarget() ? 'var(--color-olive)' : 'var(--color-graphite)'">
                  {{ Math.round((day.totalProtein / store.proteinTarget()) * 100) }}%
                </span>
              </div>
            }
          </div>

          <!-- Meal entries nested under this day -->
          @for (meal of day.meals; track meal.id; let mi = $index) {
            <div class="tape-strip tape-in pl-6"
              [class.tape-editing]="form.editTarget()?.id === meal.id"
              [style.animation-delay]="(di * 60 + mi * 30 + 30) + 'ms'">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="font-sans text-xs tracking-[0.08em] text-graphite-soft truncate max-w-[100px]">
                    {{ meal.mealLabel || 'Meal ' + (mi + 1) }}
                  </span>
                  @if (meal.exerciseCompleted || meal.liftCompleted || meal.cardioCompleted) {
                    <span class="text-[10px] font-sans font-medium" style="color: var(--color-olive)" title="Exercise">●</span>
                  }
                  <span class="font-mono text-base tabular-nums" style="color: var(--color-blood)">
                    {{ meal.calories }}<span class="text-[10px] ml-0.5 opacity-70">cal</span>
                  </span>
                  @if (meal.protein != null) {
                    <span class="font-mono text-base tabular-nums" style="color: var(--color-protein)">
                      {{ meal.protein }}<span class="text-[10px] ml-0.5 opacity-70">g</span>
                    </span>
                  }
                </div>
                <button type="button" (click)="startEdit(meal)" class="tag-btn text-[11px]">edit</button>
              </div>

            </div>
          }

          <!-- Inline add form for this day -->
          @if (form.addingForDay() === day.dateKey && form.mode() === 'add') {
            <div class="tape-strip pl-6 slide-down bg-paper-deep" (click)="$event.stopPropagation()">
              <app-entry-form />
            </div>
          }
          </div>
        }

        <!-- Empty state -->
        @if (dayGroups().length === 0) {
          <!-- Cold-start: no logs yet. Show a tap-to-log menu of common
               foods so the user's first meal is one tap + one click, not
               a stare-at-blank-form moment. Hides as soon as the first
               entry lands. -->
          @if (form.mode() === 'view') {
            <div class="mt-4">
              <app-starter-foods (picked)="useStarterFood($event)" />
            </div>
          }
          <div class="py-6 text-center">
            <p class="caption text-[11px]">
              or tap <span class="text-ink">new entry</span> above to log anything else.
            </p>
          </div>
        }
      </div>

      <!-- Undo delete toast: whole toast is tappable for easier thumb targeting -->
      @if (store.undoEntry()) {
        <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 ink-in"
          role="status" aria-live="polite">
          <button type="button" (click)="store.undoDelete()"
            aria-label="Undo delete entry"
            class="specimen undo-toast px-4 py-3 flex items-center gap-3 bg-paper shadow-lg cursor-pointer"
            style="border-color: var(--color-blood)">
            <span class="crop-bl" style="border-color: var(--color-blood)"></span>
            <span class="crop-br" style="border-color: var(--color-blood)"></span>
            <span class="font-sans text-xs tracking-[0.08em] text-ink">entry deleted</span>
            <span class="tag-btn text-[11px] pointer-events-none"
              style="border-color: var(--color-blood); color: var(--color-blood)">undo</span>
          </button>
        </div>
      }
    </section>
  `,
})
export class DailyLedgerComponent implements AfterViewInit, OnDestroy {
  protected readonly store = inject(FitnessStore);
  protected readonly form = inject(EntryFormManager);
  protected readonly Math = Math;
  protected readonly todayKey = localDateKey(new Date());
  protected readonly selectedDateKey = signal(this.todayKey);

  @ViewChild('swipeArea') private readonly swipeAreaRef!: ElementRef<HTMLElement>;
  private readonly swipeStartFn = (e: TouchEvent) => this.onSwipeStart(e);
  private readonly swipeEndFn = (e: TouchEvent) => this.onSwipeEnd(e);
  // iOS fix: remove tape-in class after animation ends to release GPU compositing layers.
  // Nested compositing layers from fill-mode:both cause iOS Safari hit-test failures.
  private readonly animEndFn = (e: AnimationEvent) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('tape-in')) t.classList.remove('tape-in');
  };

  ngAfterViewInit(): void {
    const el = this.swipeAreaRef.nativeElement;
    el.addEventListener('touchstart', this.swipeStartFn, { passive: true });
    el.addEventListener('touchend', this.swipeEndFn, { passive: true });
    el.addEventListener('animationend', this.animEndFn as EventListener);
  }

  ngOnDestroy(): void {
    const el = this.swipeAreaRef.nativeElement;
    el.removeEventListener('touchstart', this.swipeStartFn);
    el.removeEventListener('touchend', this.swipeEndFn);
    el.removeEventListener('animationend', this.animEndFn as EventListener);
  }

  protected startEdit(meal: DailyLog): void {
    this.form.onTapMeal(meal);
    // Scroll edit panel into view after Angular renders it
    setTimeout(() => {
      const panel = document.getElementById('edit-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  // ── Day-level exercise toggle ──────────────────────────────
  protected async toggleExercise(day: DayGroup): Promise<void> {
    await this.store.toggleDayExercise(day.dateKey);
  }

  // ── Day-level weight editing ────────────────────────────────
  protected readonly editingWeightDay = signal<DateKey | null>(null);
  protected readonly weightInput = signal<number | null>(null);

  protected startEditWeight(dateKey: DateKey, currentWeight: number | null): void {
    this.editingWeightDay.set(dateKey);
    this.weightInput.set(currentWeight);
  }

  protected cancelEditWeight(): void {
    this.editingWeightDay.set(null);
    this.weightInput.set(null);
  }

  protected async saveWeight(day: DayGroup): Promise<void> {
    const w = this.weightInput();
    if (w == null || Number.isNaN(Number(w))) { this.cancelEditWeight(); return; }
    await this.store.setDailyWeight(day.dateKey, Number(w));
    this.cancelEditWeight();
  }

  // ── Today's weight (from dailyWeights collection) ────────────
  protected readonly todayWeight = computed(() => this.store.dailyWeights()[this.todayKey] ?? null);

  // ── Today's calorie budget: target minus consumed ────────────
  // Negative value means over target (hero turns oxblood).
  protected readonly remainingToday = computed(() => {
    const target = this.store.targetCalories();
    const eaten = this.store.todaySummary()?.totalCalories ?? 0;
    return target - eaten;
  });

  protected async saveTodayWeight(): Promise<void> {
    const w = this.weightInput();
    if (w == null || Number.isNaN(Number(w))) { this.cancelEditWeight(); return; }
    await this.store.setDailyWeight(this.todayKey, Number(w));
    this.cancelEditWeight();
  }

  /** Handle a tap on the cold-start starter foods: open the add form
      with values prefilled, so the user just reviews and hits submit. */
  protected useStarterFood(estimate: MacroEstimate): void {
    this.form.startAdd();
    this.form.applyEstimate(estimate);
  }

  // ── Date navigation strip: last 14 calendar days ────────────
  protected readonly dateChips = computed<DateChip[]>(() => {
    const groups = this.dayGroups();
    const dataKeys = new Set(groups.map((g) => g.dateKey));
    const chips: DateChip[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      chips.push({
        dateKey: key,
        dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 3),
        dateNum: String(d.getDate()).padStart(2, '0'),
        isToday: key === this.todayKey,
        hasData: dataKeys.has(key),
      });
    }
    return chips;
  });

  protected scrollToDay(dateKey: DateKey): void {
    this.selectedDateKey.set(dateKey);
    const el = document.getElementById('day-' + dateKey);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Day swipe gestures ──────────────────────────────────────
  private swipeStartX = 0;
  private swipeStartY = 0;

  protected onSwipeStart(e: TouchEvent): void {
    this.swipeStartX = e.touches[0].clientX;
    this.swipeStartY = e.touches[0].clientY;
  }

  protected onSwipeEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.swipeStartX;
    if (Math.abs(dx) < 60) return;
    const chips = this.dateChips();
    const idx = chips.findIndex((c) => c.dateKey === this.selectedDateKey());
    if (idx < 0) return;
    if (dx > 0 && idx > 0) {
      this.scrollToDay(chips[idx - 1].dateKey);
    } else if (dx < 0 && idx < chips.length - 1) {
      this.scrollToDay(chips[idx + 1].dateKey);
    }
  }

  // ── Day grouping ────────────────────────────────────────────
  protected readonly dayGroups = computed<DayGroup[]>(() => {
    const logs = this.store.logs();
    const dw = this.store.dailyWeights();
    const groups = new Map<string, DayGroup>();

    for (const log of logs) {
      const key = localDateKey(log.date);
      let group = groups.get(key);
      if (!group) {
        group = {
          dateKey: key,
          dateLabel: log.date.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          }).toUpperCase(),
          weight: null,
          exerciseCompleted: false,
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
      if (log.exerciseCompleted || log.liftCompleted || log.cardioCompleted) {
        group.exerciseCompleted = true;
      }
    }

    // Overlay daily weights (takes precedence over log-derived weights)
    for (const [key, weight] of Object.entries(dw)) {
      const group = groups.get(key);
      if (group) group.weight = weight;
    }

    return [...groups.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  });
}
