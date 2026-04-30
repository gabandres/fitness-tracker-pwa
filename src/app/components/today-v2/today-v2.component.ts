import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { TranslationService } from '../../services/translation.service';
import { localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { V2Button } from '../ui/button.component';
import { V2IconButton } from '../ui/icon-button.component';
import { V2Card } from '../ui/card.component';
import { V2Fab } from '../ui/fab.component';
import { V2DaySummary } from '../ui/day-summary.component';
import { V2FastingPill } from '../ui/fasting-pill.component';

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
    TranslocoDirective,
    V2Button,
    V2IconButton,
    V2Card,
    V2Fab,
    V2DaySummary,
    V2FastingPill,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-12">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">{{ t('v2.today.title') }}</h1>
          <p class="v2-caption mt-0.5">{{ dateLabel() }}</p>
          @if (streak() >= 2) {
            <div class="flex items-center gap-1.5 mt-2 v2-caption" style="color: var(--v2-accent)">
              <lucide-icon name="flame" [size]="14" />
              <span>{{ t('v2.today.dayStreak', { n: streak() }) }}</span>
            </div>
          }
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <v2-fasting-pill (bodyRequested)="bodyRequested.emit()" />
          <v2-icon-button
            icon="calendar"
            [ariaLabel]="t('v2.today.historyAria')"
            (click)="historyRequested.emit()" />
          <v2-icon-button
            icon="settings"
            [ariaLabel]="t('v2.today.settingsAria')"
            (click)="settingsRequested.emit()" />
        </div>
      </header>

      @if (showDay0Hero()) {
        <!-- Day 0 hero — replaces rings until first entry. -->
        <v2-card variant="accent" class="mt-6 block text-center">
          <h2 class="v2-h2">{{ t('v2.today.day0Title') }}</h2>
          <p class="v2-body-soft mt-2">
            {{ t('v2.today.day0Body') }}
          </p>
          <div class="mt-5">
            <v2-button variant="primary" size="lg" [block]="true" (click)="addFood()">
              <lucide-icon name="plus" [size]="18" />
              {{ t('v2.today.addFood') }}
            </v2-button>
          </div>
          <p class="v2-caption mt-4">
            {{ t('v2.today.day0Targets', { kcal: kcalTarget(), protein: proteinTargetG() }) }}
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
            {{ t('v2.today.repeatYesterday') }}
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
            {{ t('v2.today.deleted', { label: undo.mealLabel || t('v2.today.deletedFallback') }) }}
          </span>
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            style="background: transparent; color: var(--v2-paper); border-color: rgba(255,255,255,0.3); font-weight: 600;"
            (click)="undoDelete()">
            {{ t('v2.today.undo') }}
          </button>
        </div>
      }
    </section>

    <!-- FAB — hidden on day 0 (in-card button is the only affordance). -->
    @if (!showDay0Hero()) {
      <v2-fab icon="plus" [ariaLabel]="t('v2.today.addFoodAria')" (click)="addFood()" />
    }
    </ng-container>
  `,
})
export class TodayV2Component {
  protected readonly store = inject(FitnessStore);
  protected readonly profile = inject(LEDGER_PORT);
  private readonly entryForm = inject(EntryFormManager);
  private readonly translation = inject(TranslationService);

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
  readonly bodyRequested = output<void>();

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
    const locale = bcp47ForLang(this.translation.language());
    return d.toLocaleDateString(locale, {
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
