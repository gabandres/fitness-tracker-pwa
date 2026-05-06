import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
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
export const WHATS_NEW_VERSION = '2026-05-06';
const STORAGE_KEY = 'macrolog.lastSeenWhatsNew';

const ITEMS: ReadonlyArray<{ id: string; iconKey: string }> = [
  { id: 'recipes', iconKey: 'chef-hat' },
  { id: 'csvExport', iconKey: 'download' },
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
        class="mt-4"
        style="padding: 12px 14px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-left: 3px solid var(--v2-accent); border-radius: var(--v2-radius-md); position: relative;">
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

  private readonly seen = signal(this.readSeen());

  protected readonly visible = computed(() => this.seen() !== WHATS_NEW_VERSION);

  protected dismiss(): void {
    try { localStorage.setItem(STORAGE_KEY, WHATS_NEW_VERSION); } catch { /* private mode — banner returns next session */ }
    this.seen.set(WHATS_NEW_VERSION);
  }

  private readSeen(): string {
    try { return localStorage.getItem(STORAGE_KEY) ?? ''; }
    catch { return WHATS_NEW_VERSION; }
  }
}
