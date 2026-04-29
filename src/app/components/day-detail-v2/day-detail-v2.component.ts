import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FitnessStore } from '../../services/fitness-store.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { localDateKey, parseYmd } from '../../utils/date';
import { V2DaySummary } from '../ui/day-summary.component';
import { V2Fab } from '../ui/fab.component';
import { V2IconButton } from '../ui/icon-button.component';

/**
 * Day-detail surface for `/history/YYYY-MM-DD`. Renders the shared
 * `<v2-day-summary>` block plus a back chevron, formatted date label,
 * and FAB that calls `entryForm.startAdd(dateKey)` so the entry sheet
 * opens pre-targeted at this day.
 *
 * No day-0 hero (today-only). No repeat-yesterday. Future days render
 * read-only — past + today are fully editable, matching v1 behavior.
 */
@Component({
  selector: 'app-day-detail-v2',
  standalone: true,
  imports: [LucideAngularModule, V2DaySummary, V2Fab, V2IconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-12">
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div class="flex items-center gap-2 min-w-0">
          <v2-icon-button
            icon="arrow-left"
            ariaLabel="Back to history"
            (click)="closeRequested.emit()" />
          <div class="min-w-0">
            <h1 class="v2-h1 truncate">{{ dateLabel() }}</h1>
            @if (showStreak()) {
              <div class="flex items-center gap-1.5 mt-0.5 v2-caption" style="color: var(--v2-accent)">
                <lucide-icon name="flame" [size]="14" />
                <span>{{ streak() }} day streak</span>
              </div>
            }
          </div>
        </div>
      </header>

      <v2-day-summary [dateKey]="dateKey()" [editable]="!isFuture()" />
    </section>

    @if (!isFuture()) {
      <v2-fab icon="plus" ariaLabel="Add food" (click)="addFood()" />
    }
  `,
})
export class DayDetailV2Component {
  private readonly store = inject(FitnessStore);
  private readonly entryForm = inject(EntryFormManager);

  readonly dateKey = input.required<string>();
  readonly closeRequested = output<void>();

  protected readonly streak = computed(() => this.store.streak());

  protected readonly isToday = computed(() => this.dateKey() === localDateKey(new Date()));

  protected readonly isFuture = computed(() => this.dateKey() > localDateKey(new Date()));

  protected readonly showStreak = computed(() => this.isToday() && this.streak() >= 2);

  protected readonly dateLabel = computed(() => {
    const d = parseYmd(this.dateKey());
    return d.toLocaleDateString('en-US', {
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
