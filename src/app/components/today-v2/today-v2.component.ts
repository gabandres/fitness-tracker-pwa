import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FitnessStore } from '../../services/fitness-store.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import type { DailyLog } from '../../services/firebase.service';
import { localDateKey } from '../../utils/date';
import { V2Button } from '../ui/button.component';
import { V2IconButton } from '../ui/icon-button.component';
import { V2Card } from '../ui/card.component';
import { V2Ring } from '../ui/ring.component';
import { V2Fab } from '../ui/fab.component';

/**
 * v2 Today screen. Replaces the v1 daily-ledger for users on `?ui=v2`.
 *
 * Layout (top → bottom):
 *   header → day-0 hero OR rings hero → exercise toggle →
 *   entries list → repeat-yesterday → water row → FAB.
 *
 * Data + actions all flow through the existing FitnessStore +
 * EntryFormManager singletons; this component is a pure view layer.
 */
@Component({
  selector: 'app-today-v2',
  standalone: true,
  imports: [
    LucideAngularModule,
    V2Button,
    V2IconButton,
    V2Card,
    V2Ring,
    V2Fab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-12">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">Today</h1>
          <p class="v2-caption mt-0.5">{{ dateLabel() }}</p>
          @if (streak() >= 2) {
            <div class="flex items-center gap-1.5 mt-2 v2-caption" style="color: var(--v2-accent)">
              <lucide-icon name="flame" [size]="14" />
              <span>{{ streak() }} day streak</span>
            </div>
          }
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <v2-icon-button
            icon="calendar"
            ariaLabel="History"
            (click)="historyRequested.emit()" />
          <v2-icon-button
            icon="settings"
            ariaLabel="Settings"
            (click)="settingsRequested.emit()" />
        </div>
      </header>

      @if (showDay0Hero()) {
        <!-- Day 0 hero — replaces rings until first entry. -->
        <v2-card variant="accent" class="mt-6 block text-center">
          <h2 class="v2-h2">Log your first meal</h2>
          <p class="v2-body-soft mt-2">
            We'll show your kcal and protein progress as you go.
          </p>
          <div class="mt-5">
            <v2-button variant="primary" size="lg" [block]="true" (click)="addFood()">
              <lucide-icon name="plus" [size]="18" />
              Add food
            </v2-button>
          </div>
          <p class="v2-caption mt-4">
            Today's targets · {{ kcalTarget() }} kcal · {{ proteinTargetG() }}g protein
          </p>
        </v2-card>
      } @else {
        <!-- Rings hero -->
        <div class="flex items-center justify-around gap-4 mt-6">
          <div class="flex flex-col items-center">
            <v2-ring
              [value]="kcalConsumed()"
              [target]="kcalTarget()"
              [size]="148"
              [stroke]="14"
              [tone]="kcalTone()"
              ariaLabel="Calories: {{ kcalConsumed() }} of {{ kcalTarget() }}">
              <span class="v2-num text-2xl font-semibold">{{ kcalRemaining() }}</span>
              <span class="v2-caption mt-0.5">{{ kcalRemainingLabel() }}</span>
            </v2-ring>
            <span class="v2-caption mt-2">kcal</span>
          </div>
          <div class="flex flex-col items-center">
            <v2-ring
              [value]="proteinConsumed()"
              [target]="proteinTargetG()"
              [size]="120"
              [stroke]="12"
              tone="sage"
              ariaLabel="Protein: {{ proteinConsumed() }}g of {{ proteinTargetG() }}g">
              <span class="v2-num text-xl font-semibold">{{ proteinConsumed() }}g</span>
              <span class="v2-caption mt-0.5">/ {{ proteinTargetG() }}g</span>
            </v2-ring>
            <span class="v2-caption mt-2">protein</span>
          </div>
        </div>

        <!-- Exercise toggle -->
        <div class="flex justify-center mt-4">
          <v2-button
            variant="ghost"
            size="sm"
            (click)="toggleExercise()"
            [attr.aria-pressed]="exercisedToday()">
            @if (exercisedToday()) {
              <lucide-icon name="check" [size]="16" style="color: var(--v2-sage)" />
            } @else {
              <lucide-icon name="footprints" [size]="16" />
            }
            {{ exercisedToday() ? 'Exercised today' : 'Did you exercise today?' }}
          </v2-button>
        </div>
      }

      <!-- Entries list -->
      @if (todayLogs().length > 0) {
        <h2 class="v2-h3 mt-8 mb-3">Today's food</h2>
        <ul class="space-y-2" role="list">
          @for (log of todayLogs(); track log.id) {
            <li>
              <button
                type="button"
                class="w-full text-left v2-card flex items-center justify-between gap-3"
                style="padding: var(--v2-space-3) var(--v2-space-4); transition: background-color var(--v2-motion-fast) var(--v2-ease);"
                (click)="editLog(log)"
                [attr.aria-label]="'Edit ' + (log.mealLabel || 'entry') + ', ' + log.calories + ' kcal'">
                <div class="min-w-0 flex-1">
                  <div class="v2-body" style="color: var(--v2-ink); font-weight: 500;">
                    {{ log.mealLabel || 'Untitled' }}
                  </div>
                  <div class="v2-caption mt-0.5">{{ logTime(log) }}</div>
                </div>
                <div class="text-right shrink-0">
                  <div class="v2-num" style="font-weight: 600;">{{ log.calories }}</div>
                  <div class="v2-caption">
                    @if (log.protein != null) { {{ log.protein }}g pro }
                    @else { kcal }
                  </div>
                </div>
              </button>
            </li>
          }
        </ul>
      }

      <!-- Repeat-yesterday — only when today is empty + yesterday has entries -->
      @if (canRepeatYesterday()) {
        <div class="mt-6">
          <v2-button variant="secondary" [block]="true" (click)="repeatYesterday()">
            <lucide-icon name="check" [size]="16" />
            Same as yesterday
          </v2-button>
        </div>
      }

      <!-- Water row -->
      @if (!showDay0Hero()) {
        <v2-card variant="flat" class="mt-6 block">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <lucide-icon name="droplets" [size]="18" style="color: var(--v2-ink-muted)" />
              <span class="v2-body-soft">
                Water · <span class="v2-num" style="color: var(--v2-ink); font-weight: 500;">{{ waterDisplay() }}</span>
              </span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 mt-3">
            <v2-button variant="ghost" size="sm" (click)="addWater(250)">+250 ml</v2-button>
            <v2-button variant="ghost" size="sm" (click)="addWater(500)">+500 ml</v2-button>
            <v2-button variant="ghost" size="sm" (click)="addWater(1000)">+1 L</v2-button>
          </div>
        </v2-card>
      }

      <!-- Undo-delete toast (auto-dismisses via store) -->
      @if (store.undoEntry(); as undo) {
        <div
          class="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5"
          style="bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--v2-ink); color: var(--v2-paper); border-radius: var(--v2-radius-full); box-shadow: var(--v2-shadow-2);"
          role="status"
          aria-live="polite">
          <span class="v2-body" style="color: inherit;">
            Deleted {{ undo.mealLabel || 'entry' }}
          </span>
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            style="background: transparent; color: var(--v2-paper); border-color: rgba(255,255,255,0.3); font-weight: 600;"
            (click)="undoDelete()">
            Undo
          </button>
        </div>
      }
    </section>

    <!-- FAB — hidden on day 0 (in-card button is the only affordance). -->
    @if (!showDay0Hero()) {
      <v2-fab icon="plus" ariaLabel="Add food" (click)="addFood()" />
    }
  `,
})
export class TodayV2Component {
  protected readonly store = inject(FitnessStore);
  protected readonly profile = inject(LEDGER_PORT);
  private readonly entryForm = inject(EntryFormManager);

  /** Forwarded from the header icons up to the app root, which decides
   *  whether to navigate to /history (Week 3) or open the v1 settings
   *  sheet (Week 6 replaces). Keeping these as outputs avoids the today
   *  component owning routing or settings concerns. */
  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();

  protected readonly todayKey = signal(localDateKey(new Date()));

  protected readonly todayLogs = computed<DailyLog[]>(() => {
    const today = this.todayKey();
    return this.store
      .logs()
      .filter((l) => localDateKey(l.date) === today)
      .sort((a, b) => +b.date - +a.date);
  });

  protected readonly showDay0Hero = computed(
    () => this.store.logs().length === 0 && this.store.status() === 'ready',
  );

  protected readonly streak = computed(() => this.store.streak());

  protected readonly kcalTarget = computed(() => this.store.targetCalories());
  protected readonly kcalConsumed = computed(
    () => this.store.todaySummary()?.totalCalories ?? 0,
  );
  protected readonly kcalRemaining = computed(() => {
    const remaining = this.kcalTarget() - this.kcalConsumed();
    return remaining >= 0 ? remaining.toLocaleString() : `+${(-remaining).toLocaleString()}`;
  });
  protected readonly kcalRemainingLabel = computed(() =>
    this.kcalTarget() - this.kcalConsumed() >= 0 ? 'left' : 'over',
  );
  protected readonly kcalTone = computed<'accent' | 'warn'>(() =>
    this.kcalConsumed() > this.kcalTarget() ? 'warn' : 'accent',
  );

  protected readonly proteinTargetG = computed(() => this.store.proteinTarget());
  protected readonly proteinConsumed = computed(
    () => Math.round(this.store.todaySummary()?.totalProtein ?? 0),
  );

  protected readonly waterMl = computed(
    () => this.store.dailyWater()[this.todayKey()] ?? 0,
  );
  protected readonly waterDisplay = computed(() => {
    const ml = this.waterMl();
    if (ml === 0) return '0 ml';
    if (ml < 1000) return `${ml} ml`;
    return `${(ml / 1000).toFixed(1)} L`;
  });

  /** A day counts as "exercised" when at least one of today's logs has
   *  the `exerciseCompleted` flag set. The store toggles all of today's
   *  entries together via `toggleDayExercise`. */
  protected readonly exercisedToday = computed(() =>
    this.todayLogs().some((l) => l.exerciseCompleted),
  );

  /** Visible only when today has no entries AND yesterday has entries.
   *  Avoids the awkward "Same as yesterday" prompt for a user who's
   *  already started today, or for a fresh account with no history. */
  protected readonly canRepeatYesterday = computed(() => {
    if (this.todayLogs().length > 0) return false;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = localDateKey(yesterday);
    return this.store.logs().some((l) => localDateKey(l.date) === yKey);
  });

  protected readonly dateLabel = computed(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  });

  protected logTime(log: DailyLog): string {
    return log.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  protected addFood(): void {
    this.haptic(10);
    this.entryForm.startAdd();
  }

  protected editLog(log: DailyLog): void {
    this.haptic(10);
    this.entryForm.onTapMeal(log);
  }

  protected toggleExercise(): void {
    this.haptic(10);
    void this.store.toggleDayExercise(this.todayKey());
  }

  protected addWater(deltaMl: number): void {
    this.haptic(10);
    void this.store.addWater(this.todayKey(), deltaMl);
  }

  protected repeatYesterday(): void {
    this.haptic(30);
    void this.store.repeatYesterday();
  }

  protected undoDelete(): void {
    this.haptic(10);
    void this.store.undoDelete();
  }

  /** Best-effort haptic. No-ops when `navigator.vibrate` is missing
   *  (iOS Safari, desktop) or `prefers-reduced-motion` is set. */
  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
