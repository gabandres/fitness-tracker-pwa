import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { DailyLog } from '../../services/firebase.service';
import { MacroEstimate } from '../../models/macro-estimate';
import { AnalyticsService } from '../../services/analytics.service';

/**
 * "Recent" quick-add row shown in the new-entry sheet above the preset
 * picker. Renders the last 5 unique meal labels from the trailing 14
 * days; tapping any one prefills the entry form via the same
 * `MacroEstimate` event the preset picker and photo capture use.
 *
 * Why this exists: the market-audit roadmap flagged that most users'
 * meal vocabulary is small and recurring. Repeat-yesterday handles the
 * "same day as yesterday" case; this handles the narrower "I ate this
 * one specific thing last Tuesday and I want it again." Together they
 * cover the majority of logging friction for habitual users.
 *
 * Hides when the computed list is empty — day-zero users see nothing
 * here, preset-picker renders its own empty state underneath.
 */
@Component({
  selector: 'app-recent-entries',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (store.recentEntries().length > 0) {
        <div class="mb-3">
          <div class="data-label mb-1.5">{{ t('recent.label') }}</div>
          <div class="flex flex-wrap gap-1.5">
            @for (log of store.recentEntries(); track log.id) {
              <button type="button" (click)="pick(log)"
                [attr.title]="t('recent.pickTitle', { label: log.mealLabel, calories: log.calories })"
                class="tag-btn text-[11px]">
                <span class="truncate max-w-[120px] inline-block align-middle">{{ log.mealLabel }}</span>
                <span class="text-graphite-soft ml-1">{{ log.calories }}</span>
              </button>
            }
          </div>
        </div>
      }
    </ng-container>
  `,
})
export class RecentEntriesComponent {
  protected readonly store = inject(FitnessStore);
  private readonly analytics = inject(AnalyticsService);

  readonly estimated = output<MacroEstimate>();

  protected pick(log: DailyLog): void {
    this.analytics.track('recent_entry_tapped', { calories: log.calories });
    this.estimated.emit({
      calories: log.calories,
      protein: log.protein ?? null,
      label: log.mealLabel ?? '',
    });
  }
}
