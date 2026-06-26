import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { TranslationService } from '../../services/translation.service';
import { localDateKey, parseYmd } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { UiDaySummary } from '../ui/day-summary.component';
import { UiFab } from '../ui/fab.component';
import { UiIconButton } from '../ui/icon-button.component';
import { UiFastingPill } from '../ui/fasting-pill.component';

/**
 * Day-detail surface for `/history/YYYY-MM-DD`. Renders the shared
 * `<ui-day-summary>` block plus a back chevron, formatted date label,
 * and FAB that calls `entryForm.startAdd(dateKey)` so the entry sheet
 * opens pre-targeted at this day.
 *
 * No day-0 hero (today-only). No repeat-yesterday. Future days render
 * read-only — past + today are fully editable, matching v1 behavior.
 */
@Component({
  selector: 'app-day-detail',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    UiDaySummary,
    UiFab,
    UiIconButton,
    UiFastingPill,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto pb-32 md:pb-28">
      <header class="flex items-start justify-between gap-4 pt-2 pb-2">
        <div class="flex items-center gap-2 min-w-0">
          <ui-icon-button
            icon="arrow-left"
            [ariaLabel]="t('v2.dayDetail.backAria')"
            (click)="closeRequested.emit()" />
          <div class="min-w-0">
            <h1 class="v2-h1 truncate">{{ dateLabel() }}</h1>
            @if (showStreak()) {
              <div class="flex items-center gap-1.5 mt-0.5 v2-caption" style="color: var(--v2-accent)">
                <lucide-icon name="flame" [size]="14" />
                <span>{{ t('v2.dayDetail.dayStreak', { n: streak() }) }}</span>
              </div>
            }
          </div>
        </div>
        <div class="shrink-0">
          <ui-fasting-pill (bodyRequested)="bodyRequested.emit()" />
        </div>
      </header>

      <ui-day-summary [dateKey]="dateKey()" [editable]="!isFuture()" />
    </section>

    @if (!isFuture()) {
      <ui-fab icon="plus" [ariaLabel]="t('v2.dayDetail.addFoodAria')" (click)="addFood()" />
    }
    </ng-container>
  `,
})
export class DayDetailComponent {
  private readonly store = inject(FitnessStore);
  private readonly entryForm = inject(EntryFormManager);
  private readonly translation = inject(TranslationService);

  readonly dateKey = input.required<string>();
  readonly closeRequested = output<void>();
  readonly bodyRequested = output<void>();

  protected readonly streak = computed(() => this.store.streak());

  protected readonly isToday = computed(() => this.dateKey() === localDateKey(new Date()));

  protected readonly isFuture = computed(() => this.dateKey() > localDateKey(new Date()));

  protected readonly showStreak = computed(() => this.isToday() && this.streak() >= 2);

  protected readonly dateLabel = computed(() => {
    const d = parseYmd(this.dateKey());
    const locale = bcp47ForLang(this.translation.language());
    return d.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  });

  protected addFood(): void {
    if (this.isFuture()) return;
    this.haptic(10);
    this.entryForm.startAdd(this.dateKey());
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
