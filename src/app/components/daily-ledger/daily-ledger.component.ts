import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { DailyLog } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { TranslationService } from '../../services/translation.service';
import { DateKey, localDateKey } from '../../utils/date';
import { EntryFormComponent } from '../entry-form/entry-form.component';
import { PhotoCaptureComponent } from '../photo-capture/photo-capture.component';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner.component';
import { PresetPickerComponent } from '../preset-picker/preset-picker.component';
import { StarterFoodsComponent } from '../starter-foods/starter-foods.component';
import { FastingStripComponent } from '../fasting/fasting-strip.component';
import { InstallPromptComponent } from '../install-prompt/install-prompt.component';
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
  imports: [FormsModule, EntryFormComponent, PhotoCaptureComponent, BarcodeScannerComponent, PresetPickerComponent, StarterFoodsComponent, FastingStripComponent, InstallPromptComponent, TranslocoDirective],
  providers: [EntryFormManager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section>
      <!-- Ambient fasting strip: keeps elapsed time + end-fast CTA visible
           while you're logging meals, without occupying 200px for the dial. -->
      <app-fasting-strip />

      <!-- Install-as-app nudge. Hides on desktop standalone, on iOS
           standalone, and after dismiss (7-day cooldown). Only shows
           once the user has logged ≥1 meal so we don't pester first-
           visit cold-start users. -->
      <app-install-prompt />

      <!-- Travel mode banner -->
      @if (store.travelMode()) {
        <div class="specimen px-4 py-2.5 mb-4 flex items-center justify-between gap-3"
          style="border-color: var(--color-gold)">
          <span class="crop-bl" style="border-color: var(--color-gold)"></span>
          <span class="crop-br" style="border-color: var(--color-gold)"></span>
          <div class="flex items-center gap-2">
            <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-gold); color: var(--color-gold)">{{ t('daily.travel.stamp') }}</span>
            <span class="caption text-[11px]">{{ t('daily.travel.caption') }}</span>
          </div>
          <button type="button" (click)="store.toggleTravelMode()" class="tag-btn text-[11px]">{{ t('daily.travel.end') }}</button>
        </div>
      }

      <!-- ─── Hero: kcal remaining today ─────────────────────
           The primary user question ("can I eat this?") answered above
           all else. Shows once the profile is set (target > 0). Turns
           oxblood when over budget. -->
      @if (store.targetCalories() > 0) {
        <div class="mb-5 ink-in">
          <div class="data-label mb-1">{{ t('daily.hero.label') }}</div>
          <div class="flex items-baseline gap-4 flex-wrap">
            <span class="font-display italic leading-none tracking-tight tabular-nums"
              style="font-size: clamp(3rem, 13vw, 4.5rem);"
              [style.color]="remainingToday() < 0 ? 'var(--color-blood)' : 'var(--color-ink)'">
              {{ remainingToday() < 0 ? '−' : '' }}{{ Math.abs(remainingToday()).toLocaleString() }}
            </span>
            <div class="font-mono text-[11px] text-graphite tabular-nums leading-tight pb-2 tracking-[0.08em]">
              <div>{{ t('daily.hero.target') }} · {{ store.targetCalories().toLocaleString() }}</div>
              <div>{{ t('daily.hero.eaten') }}&nbsp; · {{ (store.todaySummary()?.totalCalories ?? 0).toLocaleString() }}</div>
            </div>
          </div>
        </div>
      }

      <!-- Streak badge -->
      @if (store.streak() > 0) {
        <div class="flex items-center gap-2 mb-4">
          <span class="font-mono text-xs tracking-[0.1em] text-graphite">
            <span class="font-medium text-ink">{{ store.streak() }}</span> {{ store.streak() === 1 ? t('daily.streak.day') : t('daily.streak.days') }} {{ t('daily.streak.logged') }}
          </span>
          @if (store.streak() >= 7) {
            <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">{{ t('daily.streak.stamp') }}</span>
          }
        </div>
      }

      <!-- Once-per-session swipe hint: the log tape supports swipe-to-
           change-day gestures on mobile, but there's no visual
           affordance. This hint shows once per browser session and
           dismisses on any interaction. -->
      @if (showSwipeHint()) {
        <button type="button" (click)="dismissSwipeHint()"
          class="w-full text-center font-display italic text-graphite text-xs py-1 mb-2 ink-in hover:text-ink transition-colors"
          [attr.aria-label]="t('daily.swipeHintAria')">
          {{ t('daily.swipeHint') }}
        </button>
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
                  [attr.aria-label]="t('daily.chipHasEntries')"></span>
              }
            </button>
          }
        </div>
      </div>

      <!-- ─── Today weight + add entry (top of tape) ────────── -->
      <div class="mb-4 flex items-center gap-3">
        @if (form.mode() === 'view') {
          <button type="button" (click)="form.startAdd()" class="stamp-btn">{{ t('daily.newEntry') }}</button>
          <!-- Today weight quick-input -->
          @if (editingWeightDay() === todayKey) {
            <form class="flex items-baseline gap-1" (ngSubmit)="saveTodayWeight()" (click)="$event.stopPropagation()">
              <input type="number" step="0.1" inputmode="decimal"
                [ngModel]="weightInput()" (ngModelChange)="weightInput.set($event)"
                name="todayWeight" [attr.placeholder]="t('daily.weight.placeholder')"
                class="field-input text-xs w-16 py-0.5 px-1 tabular-nums" />
              <span class="font-display italic text-graphite text-[11px]">{{ t('daily.weight.lb') }}</span>
              <button type="submit" [attr.aria-label]="t('daily.weight.saveAria')" class="tag-btn text-[11px] py-0 px-1">{{ t('daily.weight.ok') }}</button>
              <button type="button" (click)="cancelEditWeight()" [attr.aria-label]="t('daily.weight.cancelAria')" class="tag-btn text-[11px] py-0 px-1">{{ t('daily.weight.x') }}</button>
            </form>
          } @else {
            <button type="button" (click)="startEditWeight(todayKey, todayWeight())"
              [attr.aria-label]="todayWeight() != null ? t('daily.weight.editAria') : t('daily.weight.addAria')"
              class="font-sans text-xs tabular-nums hover:underline"
              [class.text-graphite]="todayWeight() != null"
              [class.text-graphite-soft]="todayWeight() == null"
              [class.italic]="todayWeight() == null">
              @if (todayWeight() != null) {
                {{ todayWeight() }}<span class="text-[11px] ml-0.5">{{ t('daily.weight.lb') }}</span>
              } @else {
                {{ t('daily.weight.addWeight') }}
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
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('daily.newStamp') }}</span>
              <span class="data-label">{{ t('daily.entryLabel') }}</span>
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
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('daily.editStamp') }}</span>
              <span class="data-label truncate max-w-[180px]">{{ form.editTarget()?.mealLabel || t('daily.mealFallback') }}</span>
            </div>
            <app-entry-form />
          </div>
        }
      </div>

      <!-- ─── Day-grouped log tape ─────────────────────────── -->
      <div class="rule"><span>{{ dayGroups().length > 0 ? t('daily.tapeTitle') : t('daily.tapeEmpty') }}</span></div>

      @if (isHydrating()) {
        <!-- Skeleton shimmer while the store hydrates from Firestore on
             cold load. Matches the tape-strip rhythm so the layout
             doesn't shift when real data arrives. -->
        <div class="mt-3 space-y-1" [attr.aria-busy]="true" [attr.aria-label]="t('daily.loadingAria')">
          @for (_ of skeletonRows; track $index) {
            <div class="skeleton-row">
              <span class="skeleton-line h-3" style="width: 30%"></span>
              <span class="skeleton-line h-3 ml-auto" style="width: 20%"></span>
            </div>
          }
        </div>
      }

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
                  {{ day.dateKey === todayKey ? t('daily.today') : day.dateLabel }}
                </span>
                <!-- Tappable daily weight -->
                @if (editingWeightDay() === day.dateKey) {
                  <form class="flex items-baseline gap-1" (ngSubmit)="saveWeight(day); $event.stopPropagation()" (click)="$event.stopPropagation()">
                    <input type="number" step="0.1" inputmode="decimal"
                      [ngModel]="weightInput()" (ngModelChange)="weightInput.set($event)"
                      name="dayWeight" [attr.placeholder]="t('daily.weight.placeholder')"
                      class="field-input text-xs w-16 py-0.5 px-1 tabular-nums" />
                    <span class="font-display italic text-graphite text-[11px]">{{ t('daily.weight.lb') }}</span>
                    <button type="submit" [attr.aria-label]="t('daily.weight.saveAria')" class="tag-btn text-[11px] py-0 px-1">{{ t('daily.weight.ok') }}</button>
                    <button type="button" (click)="cancelEditWeight()" [attr.aria-label]="t('daily.weight.cancelAria')" class="tag-btn text-[11px] py-0 px-1">{{ t('daily.weight.x') }}</button>
                  </form>
                } @else {
                  <button type="button" (click)="startEditWeight(day.dateKey, day.weight); $event.stopPropagation()"
                    class="font-sans text-xs tabular-nums hover:underline"
                    [class.text-graphite]="day.weight != null"
                    [class.text-graphite-soft]="day.weight == null"
                    [class.italic]="day.weight == null">
                    @if (day.weight != null) {
                      {{ day.weight }}<span class="text-[11px] ml-0.5">{{ t('daily.weight.lb') }}</span>
                    } @else {
                      {{ t('daily.weight.addWt') }}
                    }
                  </button>
                }
                <button type="button" (click)="toggleExercise(day); $event.stopPropagation()"
                  class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-sans tracking-[0.08em] uppercase font-medium border transition-colors duration-150"
                  [style.background]="day.exerciseCompleted ? 'var(--color-olive)' : 'transparent'"
                  [style.color]="day.exerciseCompleted ? 'var(--color-paper)' : 'var(--color-graphite-soft)'"
                  [style.border-color]="day.exerciseCompleted ? 'var(--color-olive)' : 'var(--color-rule)'"
                  [attr.aria-label]="day.exerciseCompleted ? t('daily.exerciseActiveAria') : t('daily.exerciseInactiveAria')"
                  [attr.title]="t('daily.exerciseTitle')">{{ t('daily.exercise') }}</button>
              </div>
              <div class="flex items-center gap-3">
                <span class="font-mono text-sm font-medium tabular-nums" style="color: var(--color-blood)">
                  {{ day.totalCalories }}<span class="text-[10px] ml-0.5 opacity-70">{{ t('daily.cal') }}</span>
                </span>
                @if (day.totalProtein > 0) {
                  <span class="font-mono text-xs tabular-nums" style="color: var(--color-protein)">
                    {{ day.totalProtein }}<span class="text-[10px] ml-0.5 opacity-70">{{ t('daily.g') }}</span>
                  </span>
                }
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
                  {{ Math.max(0, store.targetCalories() - day.totalCalories) }} {{ t('daily.remaining') }}
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
                  {{ t('daily.proteinProgress', { have: day.totalProtein, target: store.proteinTarget() }) }}
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
                    {{ meal.mealLabel || t('daily.mealN', { n: mi + 1 }) }}
                  </span>
                  @if (meal.exerciseCompleted || meal.liftCompleted || meal.cardioCompleted) {
                    <span class="text-[10px] font-sans font-medium" style="color: var(--color-olive)" [attr.title]="t('daily.exerciseTitle')">●</span>
                  }
                  <span class="font-mono text-base tabular-nums" style="color: var(--color-blood)">
                    {{ meal.calories }}<span class="text-[10px] ml-0.5 opacity-70">{{ t('daily.cal') }}</span>
                  </span>
                  @if (meal.protein != null) {
                    <span class="font-mono text-base tabular-nums" style="color: var(--color-protein)">
                      {{ meal.protein }}<span class="text-[10px] ml-0.5 opacity-70">{{ t('daily.g') }}</span>
                    </span>
                  }
                </div>
                <button type="button" (click)="startEdit(meal)" class="tag-btn text-[11px]">{{ t('daily.edit') }}</button>
              </div>

            </div>
          }

          </div>
        }

        <!-- Empty state — only once we've confirmed there's nothing to
             show (otherwise the skeleton above is doing the talking). -->
        @if (dayGroups().length === 0 && !isHydrating()) {
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
              {{ t('daily.emptyStatePrefix') }} <span class="text-ink">{{ t('daily.newEntry') }}</span> {{ t('daily.emptyStateSuffix') }}
            </p>
          </div>
        }
      </div>

      <!-- Undo delete toast: whole toast is tappable for easier thumb
           targeting. role=alert announces assertively (deletes are
           time-sensitive); the button is auto-focused so keyboard users
           can press Enter to undo without hunting for it. -->
      @if (store.undoEntry()) {
        <div class="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 ink-in"
          role="alert">
          <button #undoBtn type="button" (click)="store.undoDelete()"
            [attr.aria-label]="t('daily.undoAria')"
            class="specimen undo-toast px-4 py-3 flex items-center gap-3 bg-paper shadow-lg cursor-pointer"
            style="border-color: var(--color-blood)">
            <span class="crop-bl" style="border-color: var(--color-blood)"></span>
            <span class="crop-br" style="border-color: var(--color-blood)"></span>
            <span class="font-sans text-xs tracking-[0.08em] text-ink">{{ t('daily.undoLabel') }}</span>
            <span class="tag-btn text-[11px] pointer-events-none"
              style="border-color: var(--color-blood); color: var(--color-blood)">{{ t('daily.undoAction') }}</span>
          </button>
        </div>
      }
    </section>
    </ng-container>
  `,
})
export class DailyLedgerComponent implements AfterViewInit, OnDestroy {
  protected readonly store = inject(FitnessStore);
  protected readonly form = inject(EntryFormManager);
  protected readonly translation = inject(TranslationService);
  protected readonly Math = Math;
  protected readonly todayKey = localDateKey(new Date());
  protected readonly selectedDateKey = signal(this.todayKey);

  /** True during the initial cold-load before any logs have arrived.
      Used to swap the empty-state / log-tape for skeleton shimmer so
      there's no blank-cream flash on first paint. */
  protected readonly isHydrating = computed(() => {
    const status = this.store.status();
    return (status === 'idle' || status === 'loading') && this.store.logs().length === 0;
  });
  protected readonly skeletonRows = Array.from({ length: 4 });

  @ViewChild('swipeArea') private readonly swipeAreaRef!: ElementRef<HTMLElement>;
  @ViewChild('undoBtn') private readonly undoBtnRef?: ElementRef<HTMLButtonElement>;
  private readonly swipeStartFn = (e: TouchEvent) => this.onSwipeStart(e);
  private readonly swipeEndFn = (e: TouchEvent) => this.onSwipeEnd(e);

  constructor() {
    // Auto-focus the undo button when the toast appears so keyboard
    // users can hit Enter immediately. The toast is short-lived (the
    // store dismisses it after a few seconds), so focus naturally
    // returns to the document body — no manual restore needed.
    effect(() => {
      if (this.store.undoEntry()) {
        queueMicrotask(() => this.undoBtnRef?.nativeElement.focus());
      }
    });
  }
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
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  // ── Swipe hint (once per browser session) ──────────────────
  /** `true` until the user dismisses it or navigates away. sessionStorage
      persists across reloads within the tab but clears when the tab
      closes — perfect for "show once" nudges. */
  protected readonly showSwipeHint = signal(
    typeof sessionStorage !== 'undefined' &&
    !sessionStorage.getItem('macrolog.swipe-hint-dismissed'),
  );
  protected dismissSwipeHint(): void {
    this.showSwipeHint.set(false);
    try { sessionStorage.setItem('macrolog.swipe-hint-dismissed', '1'); } catch {}
  }

  // ── Date navigation strip: last 14 calendar days ────────────
  private localeForDates(): string {
    return this.translation.language() === 'es-PR' ? 'es' : 'en-US';
  }

  protected readonly dateChips = computed<DateChip[]>(() => {
    const groups = this.dayGroups();
    const dataKeys = new Set(groups.map((g) => g.dateKey));
    const chips: DateChip[] = [];
    const locale = this.localeForDates();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDateKey(d);
      chips.push({
        dateKey: key,
        dayLabel: d.toLocaleDateString(locale, { weekday: 'short' }).toUpperCase().slice(0, 3),
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
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    // A successful swipe proves the user has discovered the gesture —
    // don't keep showing the hint.
    if (this.showSwipeHint()) this.dismissSwipeHint();
  }

  // ── Day grouping ────────────────────────────────────────────
  protected readonly dayGroups = computed<DayGroup[]>(() => {
    const logs = this.store.logs();
    const dw = this.store.dailyWeights();
    const locale = this.localeForDates();
    const groups = new Map<string, DayGroup>();

    for (const log of logs) {
      const key = localDateKey(log.date);
      let group = groups.get(key);
      if (!group) {
        group = {
          dateKey: key,
          dateLabel: log.date.toLocaleDateString(locale, {
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
