import { ChangeDetectionStrategy, Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { SubscriptionService } from '../../services/subscription.service';
import { DailyLog } from '../../services/firebase.service';

// History sheet: searchable view over all historical meal entries.
// Free users see the same 90-day window the charts use (via
// FitnessStore.allTimeLogs which already enforces the paywall). Pro
// sees unlimited history. Search matches meal label case-insensitively.
// Date-range filter bounds the result to inclusive [from, to].

@Component({
  selector: 'app-history-sheet',
  standalone: true,
  imports: [FormsModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="specimen px-5 py-6 relative">
      <span class="crop-bl"></span><span class="crop-br"></span>

      <div class="flex items-center gap-3 mb-1">
        <span class="stamp-mark">{{ t('history.stamp') }}</span>
        <span class="data-label">{{ t('history.section') }}</span>
      </div>
      <h2 class="font-display text-2xl sm:text-3xl leading-[0.95] text-ink mt-2">
        {{ t('history.titleLead') }}
        <em class="text-blood">{{ t('history.titleEm') }}</em>
      </h2>

      @if (!subs.isPaid()) {
        <p class="caption text-[11px] mt-3 leading-relaxed">
          {{ t('history.freeWindow') }}
        </p>
      }

      <!-- Filters -->
      <div class="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="data-label block mb-1" for="history-query">{{ t('history.queryLabel') }}</label>
          <input id="history-query" type="search"
            [(ngModel)]="queryValue" (ngModelChange)="onQueryInput($event)"
            [placeholder]="t('history.queryPlaceholder')"
            class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink" />
        </div>
        <div>
          <label class="data-label block mb-1" for="history-from">{{ t('history.fromLabel') }}</label>
          <input id="history-from" type="date"
            [(ngModel)]="fromValue" (ngModelChange)="fromDate.set($event)"
            class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink" />
        </div>
        <div>
          <label class="data-label block mb-1" for="history-to">{{ t('history.toLabel') }}</label>
          <input id="history-to" type="date"
            [(ngModel)]="toValue" (ngModelChange)="toDate.set($event)"
            class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink" />
        </div>
      </div>

      <div class="mt-3 flex items-center justify-between">
        <p class="caption text-[11px]">{{ t('history.resultCount', { count: filtered().length }) }}</p>
        @if (query() || fromDate() || toDate()) {
          <button type="button" (click)="clearFilters()"
            class="tag-btn text-[11px]">{{ t('history.clearFilters') }}</button>
        }
      </div>

      <!-- Results, grouped by day (newest first) -->
      <div class="mt-4 space-y-3" aria-live="polite">
        @for (group of grouped(); track group.key) {
          <div class="border-t border-rule/40 pt-3">
            <p class="data-label mb-2">{{ group.label }}</p>
            <ul class="space-y-1.5">
              @for (log of group.logs; track log.id) {
                <li class="flex items-baseline justify-between gap-3 font-mono text-xs text-ink">
                  <span class="flex-1 truncate" [title]="log.mealLabel ?? ''">
                    {{ log.mealLabel || t('history.unlabeled') }}
                  </span>
                  <span class="text-graphite">
                    {{ log.calories }} kcal{{ log.protein != null ? ' · ' + log.protein + 'p' : '' }}
                  </span>
                </li>
              }
            </ul>
          </div>
        } @empty {
          <p class="caption text-sm text-center py-6">{{ t('history.empty') }}</p>
        }
      </div>
    </section>
    </ng-container>
  `,
})
export class HistorySheetComponent {
  protected readonly fitness = inject(FitnessStore);
  protected readonly subs = inject(SubscriptionService);

  protected readonly query = signal<string>('');
  protected readonly fromDate = signal<string>(''); // yyyy-mm-dd
  protected readonly toDate = signal<string>('');
  protected queryValue = '';
  protected fromValue = '';
  protected toValue = '';

  // Pro accounts can accumulate thousands of logs; running the filter +
  // sort + groupBy on every keystroke drops frames on older phones.
  // Debounce the text query at 200ms so the expensive computeds only
  // re-run once the user pauses typing. Date inputs change infrequently
  // and stay undebounced.
  private queryDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyRef = inject(DestroyRef);
  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.queryDebounceTimer) clearTimeout(this.queryDebounceTimer);
    });
  }
  protected onQueryInput(value: string): void {
    if (this.queryDebounceTimer) clearTimeout(this.queryDebounceTimer);
    this.queryDebounceTimer = setTimeout(() => this.query.set(value), 200);
  }

  /** Logs filtered by date range + label text. Pre-sorted newest-first. */
  protected readonly filtered = computed<DailyLog[]>(() => {
    const q = this.query().trim().toLowerCase();
    const from = this.fromDate() ? new Date(this.fromDate() + 'T00:00:00').getTime() : null;
    const to = this.toDate() ? new Date(this.toDate() + 'T23:59:59').getTime() : null;
    return this.fitness.allTimeLogs()
      .filter((log) => {
        const t = log.date.getTime();
        if (from != null && t < from) return false;
        if (to != null && t > to) return false;
        if (q && !(log.mealLabel ?? '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  });

  /** Group filtered results by calendar day for display. */
  protected readonly grouped = computed(() => {
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const groups = new Map<string, { key: string; label: string; logs: DailyLog[] }>();
    for (const log of this.filtered()) {
      const key = log.date.toISOString().slice(0, 10);
      if (!groups.has(key)) {
        groups.set(key, { key, label: fmt.format(log.date), logs: [] });
      }
      groups.get(key)!.logs.push(log);
    }
    return [...groups.values()];
  });

  protected clearFilters(): void {
    if (this.queryDebounceTimer) clearTimeout(this.queryDebounceTimer);
    this.query.set('');
    this.fromDate.set('');
    this.toDate.set('');
    this.queryValue = '';
    this.fromValue = '';
    this.toValue = '';
  }
}
