import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { marked } from 'marked';

type FetchStatus = 'loading' | 'ready' | 'error';

/**
 * Public /changelog route — renders CHANGELOG.md so visitors and search
 * engines see proof of active development. The file is served from the
 * hosting root (see `angular.json` assets config); this component just
 * fetches it and pipes through `marked`.
 *
 * Only the repo CHANGELOG is rendered (no per-entry anchors, no RSS).
 * If we later want richer presentation we'll parse headings into cards,
 * but for now the plain rendered markdown already matches the audience.
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
      <h1 class="v2-h1 mt-1" style="font-size: 2.5rem; line-height: 1.05;">
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
      const res = await fetch('/CHANGELOG.md', { cache: 'no-cache' });
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
