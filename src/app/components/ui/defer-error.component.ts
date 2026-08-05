import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from './button.component';

/**
 * What a failed `@defer` shows instead of nothing.
 *
 * Every route in this app is lazy (`@defer (on immediate)`), so when a chunk
 * fails to load the user is left staring at the `@placeholder` ellipsis
 * forever — no error, no retry, nothing to act on. That is Angular NG0750, and
 * it happened in production on 2026-08-05: a returning user on a
 * service-worker-cached shell requested a chunk hash that no longer existed on
 * hosting (two deploys the same day rotated the hashes), and `/body` simply
 * never rendered for them.
 *
 * Reload rather than retry, deliberately: the failure is almost always a stale
 * shell asking for a chunk that is gone, and re-requesting the same dead URL
 * cannot succeed. A full reload fetches the new index, which fixes it for good.
 */
@Component({
  selector: 'app-defer-error',
  standalone: true,
  imports: [TranslocoDirective, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <div class="py-16 px-4 text-center" role="alert" data-testid="defer-error">
        <p class="v2-caption mb-3">{{ t('common.chunkFailed') }}</p>
        <ui-button variant="secondary" size="sm" (click)="reload()">
          {{ t('common.reload') }}
        </ui-button>
      </div>
    </ng-container>
  `,
})
export class DeferErrorComponent {
  // Through DOCUMENT rather than the global `window` so this is injectable in
  // a test and safe under prerendering, where there is no window at all
  // (`prerender-seo.mjs` renders 105 pages at build time).
  private readonly doc = inject(DOCUMENT);

  protected reload(): void {
    this.doc.defaultView?.location.reload();
  }
}
