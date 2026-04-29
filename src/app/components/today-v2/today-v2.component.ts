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
import { localDateKey } from '../../utils/date';
import { V2Button } from '../ui/button.component';
import { V2IconButton } from '../ui/icon-button.component';
import { V2Card } from '../ui/card.component';
import { V2Fab } from '../ui/fab.component';
import { V2DaySummary } from '../ui/day-summary.component';

/**
 * v2 Today screen. Owns the today-only chrome (header, day-0 hero,
 * repeat-yesterday, undo-delete toast, FAB) and delegates the rings +
 * entries + water + exercise block to <v2-day-summary>, which is also
 * reused by day-detail-v2 for past days.
 */
@Component({
  selector: 'app-today-v2',
  standalone: true,
  imports: [
    LucideAngularModule,
    V2Button,
    V2IconButton,
    V2Card,
    V2Fab,
    V2DaySummary,
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
        <v2-day-summary [dateKey]="todayKey()" />
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

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();

  protected readonly todayKey = signal(localDateKey(new Date()));

  protected readonly showDay0Hero = computed(
    () => this.store.logs().length === 0 && this.store.status() === 'ready',
  );

  protected readonly streak = computed(() => this.store.streak());
  protected readonly kcalTarget = computed(() => this.store.targetCalories());
  protected readonly proteinTargetG = computed(() => this.store.proteinTarget());

  protected readonly canRepeatYesterday = computed(() => {
    const today = this.todayKey();
    const todayHas = this.store.logs().some((l) => localDateKey(l.date) === today);
    if (todayHas) return false;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yKey = localDateKey(y);
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

  protected addFood(): void {
    this.haptic(10);
    this.entryForm.startAdd();
  }

  protected repeatYesterday(): void {
    this.haptic(30);
    void this.store.repeatYesterday();
  }

  protected undoDelete(): void {
    this.haptic(10);
    void this.store.undoDelete();
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
