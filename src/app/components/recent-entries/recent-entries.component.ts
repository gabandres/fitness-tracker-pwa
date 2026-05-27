import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { FirebaseService, DailyLog } from '../../services/firebase.service';
import { MacroEstimate } from '../../models/macro-estimate';
import { AnalyticsService } from '../../services/analytics.service';

/**
 * "Recent" quick-add chip row. Computed from the trailing 14-row log
 * window in FitnessStore.recentEntries (deduped by lowercased meal
 * label, capped at 5). Tapping a chip pre-fills the entry form via the
 * shared MacroEstimate event.
 *
 * Manage mode: triggered by the "Manage" link beside the header. Each
 * chip becomes a delete affordance — but unlike the preset picker, we
 * never delete the underlying log entry (that's history, and the user
 * came here to log faster, not to lose data). Instead we add the
 * lowercased label to `profile.hiddenRecentLabels`; FitnessStore
 * filters chips against that list on every recompute. The historical
 * log entries remain visible in the ledger / history view.
 *
 * Hides when the computed list is empty.
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
          <div class="flex items-baseline justify-between mb-1.5">
            <div class="data-label">{{ t('recent.label') }}</div>
            <button type="button" (click)="toggleManage()"
              class="font-mono text-[10px] tracking-[0.08em] uppercase"
              [style.color]="manage() ? 'var(--color-blood)' : 'var(--color-graphite-soft)'"
              [attr.aria-pressed]="manage()">
              {{ manage() ? t('recent.done') : t('recent.manage') }}
            </button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            @for (log of store.recentEntries(); track log.id) {
              @if (manage()) {
                <button type="button" (click)="hide(log)"
                  [attr.aria-label]="t('recent.removeAria', { label: log.mealLabel })"
                  class="tag-btn text-[11px] inline-flex items-center gap-1.5"
                  style="border-color: var(--color-blood); color: var(--color-blood);">
                  <span aria-hidden="true">✕</span>
                  <span class="truncate max-w-[120px] inline-block align-middle">{{ log.mealLabel }}</span>
                  <span class="text-graphite-soft">{{ log.calories }}</span>
                </button>
              } @else {
                <button type="button" (click)="pick(log)"
                  [attr.title]="t('recent.pickTitle', { label: log.mealLabel, calories: log.calories })"
                  class="tag-btn text-[11px]">
                  <span class="truncate max-w-[120px] inline-block align-middle">{{ log.mealLabel }}</span>
                  <span class="text-graphite-soft ml-1">{{ log.calories }}</span>
                </button>
              }
            }
          </div>
        </div>
      }
    </ng-container>
  `,
})
export class RecentEntriesComponent {
  protected readonly store = inject(FitnessStore);
  private readonly firebase = inject(FirebaseService);
  private readonly analytics = inject(AnalyticsService);

  readonly estimated = output<MacroEstimate>();

  protected readonly manage = signal(false);

  protected toggleManage(): void {
    this.manage.update((v) => !v);
  }

  protected pick(log: DailyLog): void {
    this.analytics.track('recent_entry_tapped', { calories: log.calories });
    this.estimated.emit({
      calories: log.calories,
      protein: log.protein ?? null,
      label: log.mealLabel ?? '',
    });
  }

  protected async hide(log: DailyLog): Promise<void> {
    const label = log.mealLabel?.trim();
    if (!label) return;
    await this.firebase.hideRecentLabel(label);
    // If the chip we just hid was the last one in the row, exit manage
    // mode so the user isn't staring at an empty row with a "Done"
    // pill. The recentEntries() signal updates synchronously after the
    // profile signal flips, so checking length here is reliable.
    if (this.store.recentEntries().length === 0) {
      this.manage.set(false);
    }
  }
}
