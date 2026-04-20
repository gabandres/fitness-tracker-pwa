import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { DailyLog } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { TranslationService } from '../../services/translation.service';
import { DateKey, localDateKey } from '../../utils/date';
import { AnalyticsService } from '../../services/analytics.service';
import { EntryFormComponent } from '../entry-form/entry-form.component';
import { PhotoCaptureComponent } from '../photo-capture/photo-capture.component';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner.component';
import { PresetPickerComponent } from '../preset-picker/preset-picker.component';
import { RecentEntriesComponent } from '../recent-entries/recent-entries.component';
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
  imports: [FormsModule, EntryFormComponent, PhotoCaptureComponent, BarcodeScannerComponent, PresetPickerComponent, RecentEntriesComponent, StarterFoodsComponent, FastingStripComponent, InstallPromptComponent, TranslocoDirective],
  // EntryFormManager is providedIn:'root' so dashboard and future
  // surfaces can call startAdd()/requestLogFocus() without going
  // through an event-bus service.
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
      <div class="mb-4 flex items-center gap-3 flex-wrap">
        @if (form.mode() === 'view') {
          <button type="button" (click)="form.startAdd()" class="stamp-btn">{{ t('daily.newEntry') }}</button>
          <!-- Repeat-yesterday: the single highest-leverage retention fix
               per the 2026-04-17 market audit. Only visible when today
               has no entries yet AND yesterday has at least one — otherwise
               it's noise or a dangerous button. Clones every yesterday
               entry into today in one tap; weight is deliberately
               excluded because weight is a same-day measurement. -->
          @if (canRepeatYesterday()) {
            <button type="button" (click)="repeatYesterday()"
              [disabled]="repeatingYesterday()"
              [attr.aria-label]="t('daily.repeatYesterdayAria')"
              class="tag-btn text-[11px]">
              {{ repeatingYesterday() ? t('daily.repeatingYesterday') : t('daily.repeatYesterday') }}
            </button>
          }
          <!-- Today weight quick-input.
               The inline input is suppressed while the TODAY row in the
               log tape is also rendering its own weight editor — prior
               behaviour duplicated the input in both places, which both
               looks broken (two identical forms on one screen) and makes
               a11y tooling announce the field twice. We fall back to the
               read-only "+ weight" affordance while the tape's editor is
               open; once editing completes, this top input reappears as
               the canonical quick-log path on days where the tape row
               isn't visible (e.g. mobile insights tab). -->
          @if (editingWeightDay() === todayKey && !hasTodayRow()) {
            <form class="flex items-baseline gap-1" (ngSubmit)="saveTodayWeight()" (click)="$event.stopPropagation()">
              <input type="number" step="0.1" inputmode="decimal"
                [ngModel]="weightInput()" (ngModelChange)="weightInput.set($event)"
                name="todayWeight" [attr.placeholder]="t('daily.weight.placeholder')"
                [attr.aria-label]="t('daily.weight.inputAria')"
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
            <app-recent-entries (estimated)="form.applyEstimate($event)" />
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
                <!-- Tappable daily weight. Input + buttons widen on mobile
                     to hit the 44px tap-target minimum and use 16px font
                     size so iOS Safari doesn't zoom the viewport on focus
                     (below 16px it auto-zooms, which kicks the user out of
                     the ledger view). Desktop stays compact via sm:. -->
                @if (editingWeightDay() === day.dateKey) {
                  <form class="flex flex-wrap items-center gap-1.5 sm:gap-1" (ngSubmit)="saveWeight(day); $event.stopPropagation()" (click)="$event.stopPropagation()">
                    <input type="number" step="0.1" inputmode="decimal"
                      [ngModel]="weightInput()" (ngModelChange)="weightInput.set($event)"
                      name="dayWeight" [attr.placeholder]="t('daily.weight.placeholder')"
                      [attr.aria-label]="t('daily.weight.inputAria')"
                      class="field-input text-base sm:text-xs w-24 sm:w-16 min-h-[44px] sm:min-h-0 py-2 sm:py-0.5 px-2 sm:px-1 tabular-nums" />
                    <span class="font-display italic text-graphite text-xs sm:text-[11px]">{{ t('daily.weight.lb') }}</span>
                    <button type="submit" [attr.aria-label]="t('daily.weight.saveAria')"
                      class="tag-btn text-xs sm:text-[11px] min-h-[44px] sm:min-h-0 py-2 sm:py-0 px-3 sm:px-1">{{ t('daily.weight.ok') }}</button>
                    <button type="button" (click)="cancelEditWeight()" [attr.aria-label]="t('daily.weight.cancelAria')"
                      class="tag-btn text-xs sm:text-[11px] min-h-[44px] sm:min-h-0 py-2 sm:py-0 px-3 sm:px-1">{{ t('daily.weight.x') }}</button>
                  </form>
                } @else {
                  <button type="button" (click)="startEditWeight(day.dateKey, day.weight); $event.stopPropagation()"
                    class="font-sans text-sm sm:text-xs tabular-nums hover:underline min-h-[36px] sm:min-h-0 py-1 sm:py-0 px-2 sm:px-0 -mx-2 sm:mx-0"
                    [class.text-graphite]="day.weight != null"
                    [class.text-graphite-soft]="day.weight == null"
                    [class.italic]="day.weight == null">
                    @if (day.weight != null) {
                      {{ day.weight }}<span class="text-xs sm:text-[11px] ml-0.5">{{ t('daily.weight.lb') }}</span>
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
                <!-- Copy-this-day-to-today: past days only, when there's
                     anything to copy and today isn't already mirroring this
                     day. Disabled while a copy is in flight so double-taps
                     don't double-post. -->
                @if (day.dateKey !== todayKey && day.meals.length > 0) {
                  <button type="button"
                    (click)="copyDayToToday(day.dateKey); $event.stopPropagation()"
                    [disabled]="copyingDayKey() === day.dateKey"
                    [attr.aria-label]="t('daily.copyDayAria', { count: day.meals.length })"
                    [attr.title]="t('daily.copyDayTitle')"
                    class="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-sans tracking-[0.08em] uppercase font-medium border transition-colors duration-150 text-graphite-soft border-rule hover:text-ink">
                    {{ copyingDayKey() === day.dateKey ? t('daily.copyingDay') : t('daily.copyDay') }}
                  </button>
                }
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

          <!-- Meal entries nested under this day. Wrapped in a positioned
               container so swipe-to-delete can slide the row over a red
               "delete" indicator underneath. Touch events only; pointer
               input on desktop still uses the Edit button + delete flow. -->
          @for (meal of day.meals; track meal.id; let mi = $index) {
            <div class="relative overflow-hidden">
              @if (swipeState()?.id === meal.id) {
                <div aria-hidden="true" class="absolute inset-0 flex items-center justify-end pr-6 pointer-events-none"
                  style="background: var(--color-blood)">
                  <span class="font-sans text-[10px] tracking-[0.12em] uppercase" style="color: #f4f0e8">
                    {{ t('daily.swipeDelete') }}
                  </span>
                </div>
              }
              <div class="tape-strip tape-in pl-6 relative"
                [class.tape-editing]="form.editTarget()?.id === meal.id"
                [style.animation-delay]="(di * 60 + mi * 30 + 30) + 'ms'"
                [style.transform]="'translateX(' + swipeDx(meal.id) + 'px)'"
                [style.transition]="swipeState()?.id === meal.id ? 'none' : 'transform 200ms ease'"
                (touchstart)="onRowSwipeStart($event, meal.id)"
                (touchmove)="onRowSwipeMove($event, meal.id)"
                (touchend)="onRowSwipeEnd($event, meal.id)"
                (touchcancel)="onRowSwipeEnd($event, meal.id)">
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
            </div>
          }

          </div>
        }

        <!-- Empty state — only once we've confirmed there's nothing to
             show (otherwise the skeleton above is doing the talking). -->
        @if (dayGroups().length === 0 && !isHydrating()) {
          <!-- Cold-start: no logs yet. Show a tap-to-log menu of common
               foods so the user's first meal is one tap + one click,
               not a stare-at-blank-form moment. Previously hidden
               while the entry form was open (mode='add'), which forced
               day-one users to cancel the form just to see the preset
               list — we now keep it visible in every mode so tapping a
               starter food still works as a prefill + save. -->
          <div class="mt-4">
            <app-starter-foods (picked)="useStarterFood($event)" />
          </div>
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
        <div class="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 toast-in"
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

      <!-- Day-budget closure toast: fires once per day the first time
           today's calorie total crosses the computed daily target. The
           store's effect guards re-firing via localStorage. -->
      @if (store.budgetCrossed()) {
        <div class="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 toast-in"
          role="status">
          <button type="button" (click)="store.ackBudgetCrossed()"
            [attr.aria-label]="t('daily.budgetCrossedAria')"
            class="specimen undo-toast px-4 py-3 flex items-center gap-3 bg-paper shadow-lg cursor-pointer"
            style="border-color: var(--color-blood)">
            <span class="crop-bl" style="border-color: var(--color-blood)"></span>
            <span class="crop-br" style="border-color: var(--color-blood)"></span>
            <span class="font-sans text-xs tracking-[0.08em] text-ink">{{ t('daily.budgetCrossedLabel') }}</span>
            <span class="tag-btn text-[11px] pointer-events-none"
              style="border-color: var(--color-blood); color: var(--color-blood)">{{ t('daily.budgetCrossedAction') }}</span>
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
  private readonly analytics = inject(AnalyticsService);
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

  /** Repeat-yesterday control state. `canRepeatYesterday` is true when
      today has no entries AND yesterday has at least one — the only
      state where cloning yesterday is a safe, useful one-tap. */
  protected readonly repeatingYesterday = signal(false);
  /** True when the log tape contains a row for today. Drives the guard
      that prevents the top "+ weight" form from rendering alongside the
      per-day inline weight editor — previously both appeared at once,
      showing two identical weight inputs on the same screen. */
  protected readonly hasTodayRow = computed(() =>
    this.dayGroups().some((d) => d.dateKey === this.todayKey),
  );
  protected readonly canRepeatYesterday = computed(() => {
    const logs = this.store.logs();
    const todayHasEntries = logs.some((l) => localDateKey(l.date) === this.todayKey);
    if (todayHasEntries) return false;
    const yesterdayKey = localDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    return logs.some((l) => localDateKey(l.date) === yesterdayKey);
  });

  /** Which past-day's copy operation is currently in flight, if any.
      Scoped per-day rather than a boolean so two rapid taps on
      different days still surface the right spinner state. */
  protected readonly copyingDayKey = signal<string | null>(null);

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

    // Horizontally scroll the date strip so today's chip is visible on
    // first paint. Without this, narrow viewports (mobile ~390px) cut
    // the strip at day 07 and the current day sits off-screen — users
    // had to swipe before they could see the most important chip.
    requestAnimationFrame(() => {
      const strip = document.querySelector<HTMLElement>('.date-strip-scroll');
      if (!strip) return;
      strip.scrollLeft = strip.scrollWidth;
    });
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

  // ── Swipe-to-delete on meal rows ────────────────────────────
  // The undo toast from FitnessStore.deleteLog() gives users 5s to
  // recover from an accidental swipe — same safety net as the Edit
  // → Delete button path.
  protected readonly swipeState = signal<{ id: string; dx: number } | null>(null);
  private rowSwipeStartX = 0;
  private readonly SWIPE_DELETE_THRESHOLD = -80;

  protected swipeDx(mealId: string | undefined): number {
    const s = this.swipeState();
    return s && mealId && s.id === mealId ? s.dx : 0;
  }

  protected onRowSwipeStart(e: TouchEvent, mealId: string | undefined): void {
    if (!mealId) return;
    // Stop the gesture from also bubbling to the ledger-wide swipeArea
    // handler, which interprets |dx| ≥ 60 as a day-change. Without this,
    // a successful swipe-delete ALSO advances to the next day — deleting
    // the row and yanking the user off the current day's context.
    e.stopPropagation();
    this.rowSwipeStartX = e.touches[0].clientX;
    this.swipeState.set({ id: mealId, dx: 0 });
  }

  protected onRowSwipeMove(e: TouchEvent, mealId: string | undefined): void {
    if (!mealId || this.swipeState()?.id !== mealId) return;
    e.stopPropagation();
    // Left swipes only — clamp at 0 so the row can't slide right.
    const dx = Math.min(0, e.touches[0].clientX - this.rowSwipeStartX);
    this.swipeState.set({ id: mealId, dx });
  }

  protected async onRowSwipeEnd(e: TouchEvent, mealId: string | undefined): Promise<void> {
    e.stopPropagation();
    const state = this.swipeState();
    if (!state || !mealId || state.id !== mealId) {
      this.swipeState.set(null);
      return;
    }
    const crossedThreshold = state.dx <= this.SWIPE_DELETE_THRESHOLD;
    this.swipeState.set(null);
    if (!crossedThreshold) return;
    // Require an explicit confirmation before destroying the entry. A
    // single accidental swipe shouldn't nuke a log row — the existing
    // undo toast runs for 5s, but users expect a prompt too. Pairs
    // with the end-fast confirm dialog pattern.
    const ok = window.confirm(this.translation.t('daily.swipeDeleteConfirm'));
    if (!ok) return;
    try { navigator.vibrate?.(15); } catch { /* ignore */ }
    try { await this.store.deleteLog(mealId); } catch { /* store logs + undo toast handles it */ }
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

  /** Clones yesterday's entries into today in one tap. UX is intentionally
      silent on success — the log tape re-renders with the new entries,
      which is its own confirmation. Button hides after success via the
      `canRepeatYesterday` guard. */
  protected async repeatYesterday(): Promise<void> {
    // Cross-action guard: if a per-day copy is already in flight, refuse —
    // otherwise two concurrent bulk writes can interleave and double-post.
    if (this.repeatingYesterday() || this.copyingDayKey() !== null) return;
    this.repeatingYesterday.set(true);
    try {
      const cloned = await this.store.repeatYesterday();
      this.analytics.track('repeat_yesterday', { count: cloned });
    } finally {
      this.repeatingYesterday.set(false);
    }
  }

  /** Generalized bulk-copy: clone the chosen past day's entries into
      today. Guards against: (a) the same day tapped twice rapidly,
      (b) a different day tapped while one is in flight, (c) a copy
      launched while `repeatYesterday` is mid-write — any of which
      would cause overlapping sequential writes and duplicate rows. */
  protected async copyDayToToday(dateKey: string): Promise<void> {
    if (this.copyingDayKey() !== null || this.repeatingYesterday()) return;
    this.copyingDayKey.set(dateKey);
    try {
      const cloned = await this.store.copyDayToToday(dateKey);
      this.analytics.track('copy_day_to_today', { count: cloned, sourceDateKey: dateKey });
    } finally {
      this.copyingDayKey.set(null);
    }
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
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    // No row exists for that day (nothing logged yet). The chip tap
    // previously looked dead — selection moved but nothing happened.
    // Open the entry form pre-filled with the tapped date so the user
    // can log retroactively, which matches the intent of the click.
    this.form.startAdd(dateKey);
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
