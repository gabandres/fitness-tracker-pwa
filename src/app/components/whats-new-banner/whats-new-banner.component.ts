import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Bump this whenever you ship something user-visible. The banner
 * compares against `localStorage[STORAGE_KEY]` and surfaces only when
 * the stored value is missing or older than `WHATS_NEW_VERSION`.
 *
 * Translation keys for the items live under `v2.whatsNew.items.<id>`
 * so each release writes copy in en + es-PR before flipping the
 * version. The component renders nothing if there are no items.
 */
export const WHATS_NEW_VERSION = '2026-06-13';
const STORAGE_KEY = 'macrolog.lastSeenWhatsNew';

/**
 * Whether the what's-new banner *wants* to show (stored version is missing
 * or stale). Today's one-Nudge gate reads this to rank the banner against
 * the other nudges without owning the localStorage key. Private-mode reads
 * fall back to "not visible" so the banner never blocks a higher nudge.
 */
export function whatsNewVisible(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== WHATS_NEW_VERSION; }
  catch { return false; }
}

const ITEMS: ReadonlyArray<{ id: string; iconKey: string }> = [
  { id: 'mealSlots', iconKey: 'sparkles' },
  { id: 'trendsFree', iconKey: 'trending-up' },
  { id: 'bodyTrain', iconKey: 'dumbbell' },
  { id: 'shareStreak', iconKey: 'share-2' },
];

@Component({
  selector: 'app-whats-new-banner',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (visible()) {
      <div
        role="status"
        aria-live="polite"
        class="mt-4 v2-active-highlight"
        style="padding: 12px 14px; border-radius: var(--v2-radius-md); position: relative;">
        <button
          type="button"
          (click)="dismiss()"
          [attr.aria-label]="t('v2.whatsNew.dismissAria')"
          style="position: absolute; top: 6px; right: 6px; min-height: 28px; min-width: 28px; display: flex; align-items: center; justify-content: center; background: transparent; border: none; color: var(--v2-ink-muted); cursor: pointer;">
          <lucide-icon name="x" [size]="14" />
        </button>
        <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600; margin-bottom: 6px;">
          {{ t('v2.whatsNew.label') }}
        </p>
        <ul style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px;">
          @for (item of items; track item.id) {
            <li class="flex items-start gap-2">
              <lucide-icon [name]="item.iconKey" [size]="14"
                style="color: var(--v2-accent); margin-top: 2px; flex-shrink: 0;" />
              <span class="v2-body" style="font-size: 0.875rem;">
                {{ t('v2.whatsNew.items.' + item.id) }}
              </span>
            </li>
          }
        </ul>
      </div>
    }
    </ng-container>
  `,
})
export class WhatsNewBannerComponent {
  protected readonly items = ITEMS;

  /** Set by Today's one-Nudge gate when a higher-priority nudge wins. */
  readonly suppressed = input(false);

  private readonly seen = signal(this.readSeen());

  protected readonly visible = computed(
    () => !this.suppressed() && this.seen() !== WHATS_NEW_VERSION,
  );

  protected dismiss(): void {
    try { localStorage.setItem(STORAGE_KEY, WHATS_NEW_VERSION); } catch { /* private mode — banner returns next session */ }
    this.seen.set(WHATS_NEW_VERSION);
  }

  private readSeen(): string {
    try { return localStorage.getItem(STORAGE_KEY) ?? ''; }
    catch { return WHATS_NEW_VERSION; }
  }
}
