import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { APP_STORE_URL, PLAY_STORE_URL } from '../../utils/app-store';
import { UiCard } from '../ui/card.component';

/**
 * Where the logging app used to be (ADR-0036).
 *
 * Renders for `/app`, `/app/**`, `/history/**`, `/trends`, `/body`, `/train`
 * and `/onboarding` — the installed PWA's `start_url`, the tabs, and the
 * target of every "Open your log" button in every recap email ever sent. A
 * 404 there would read as data loss; this page says the browser version is
 * gone, that the data is not, and where the apps are.
 *
 * `noindex` because every one of these URLs was a signed-in surface and none
 * of them was ever meant to rank.
 */
@Component({
  selector: 'app-retired',
  standalone: true,
  imports: [TranslocoDirective, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[560px] mx-auto px-5 sm:px-6 py-16">
      <ui-card>
        <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">
          {{ t('retired.section') }}
        </p>
        <h1 class="v2-h1 mt-2">{{ t('retired.title') }}</h1>
        <p class="v2-body-soft mt-4">{{ t('retired.body') }}</p>
        <p class="v2-body-soft mt-3">{{ t('retired.dataSafe') }}</p>

        <div class="mt-8 flex flex-wrap items-center gap-4">
          <a [href]="APP_STORE_URL" rel="noopener" [attr.aria-label]="t('retired.appStoreAlt')">
            <img src="/appstore-badge.svg" alt="{{ t('retired.appStoreAlt') }}"
              width="180" height="60" loading="lazy" decoding="async" class="h-[52px] w-auto" />
          </a>
          <a [href]="PLAY_STORE_URL" rel="noopener" class="v2-btn v2-btn--secondary">
            {{ t('retired.playStore') }}
          </a>
        </div>

        <p class="v2-caption mt-8">
          {{ t('retired.exportLead') }}
          <a href="/privacy" class="v2-link">{{ t('retired.exportLink') }}</a>
        </p>
      </ui-card>
    </section>
    </ng-container>
  `,
})
export class RetiredComponent {
  protected readonly APP_STORE_URL = APP_STORE_URL;
  protected readonly PLAY_STORE_URL = PLAY_STORE_URL;

  constructor() {
    // Belt and braces: the prerenderer never emits these URLs, but the SPA
    // shell they fall through to carries the homepage's indexable <head>.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
  }
}
