import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { marked } from 'marked';

type FetchStatus = 'loading' | 'ready' | 'error';

/**
 * Public /changelog route — renders `public/changelog-public.md`, a short
 * curated, user-facing list of highlights, so visitors and search engines
 * see proof of active development. Linked from the landing directory,
 * /status, the 404 page and the sitemap.
 *
 * Until 2026-10-15 this fetched the repo's CHANGELOG.md (copied to the
 * hosting root by angular.json), which is the internal engineering log —
 * ~310 KB of build ledgers, owner-data repairs and infrastructure notes,
 * published to anyone. Add a line to the public file when a release ships;
 * never point this back at CHANGELOG.md.
 */
@Component({
  selector: 'app-changelog',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[720px] mx-auto">
      <a href="/" class="v2-caption" style="text-decoration: underline; text-decoration-style: dotted;">
        {{ t('changelog.backLink') }}
      </a>

      <p class="v2-caption mt-6" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('changelog.section') }}
      </p>
      <h1 class="v2-h1 v2-display mt-1">
        {{ t('changelog.titleLead') }}
        <span style="color: var(--v2-accent);">{{ t('changelog.titleEm') }}</span>
      </h1>
      <p class="v2-caption mt-3">{{ t('changelog.subtitle') }}</p>

      @if (status() === 'loading') {
        <p class="v2-caption mt-10 text-center">{{ t('changelog.loading') }}</p>
      } @else if (status() === 'error') {
        <p class="v2-caption mt-10 text-center" role="alert" style="color: var(--v2-danger);">
          {{ t('changelog.error') }}
        </p>
      } @else {
        <article class="mt-8 v2-prose v2-prose--changelog" [innerHTML]="html()"></article>
      }
    </section>
    </ng-container>
  `,
})
export class ChangelogComponent {
  protected readonly status = signal<FetchStatus>('loading');
  protected readonly html = signal<string>('');

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch('/changelog-public.md', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const md = await res.text();
      const rendered = marked.parse(md, { gfm: true, breaks: false }) as string;
      this.html.set(rendered);
      this.status.set('ready');
    } catch (err) {
      console.error('Failed to load changelog:', err);
      this.status.set('error');
    }
  }
}
