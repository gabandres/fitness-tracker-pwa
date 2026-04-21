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
      <a href="/" class="caption text-xs underline decoration-dotted hover:text-blood">
        {{ t('changelog.backLink') }}
      </a>

      <div class="mt-6 flex items-center gap-3 mb-1">
        <span class="stamp-mark">{{ t('changelog.stamp') }}</span>
        <span class="data-label">{{ t('changelog.section') }}</span>
      </div>
      <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        {{ t('changelog.titleLead') }}<br/><em class="text-blood">{{ t('changelog.titleEm') }}</em>
      </h1>
      <p class="caption mt-3 text-xs">{{ t('changelog.subtitle') }}</p>

      @if (status() === 'loading') {
        <p class="caption mt-10 text-center">{{ t('changelog.loading') }}</p>
      } @else if (status() === 'error') {
        <p class="caption mt-10 text-center" role="alert" style="color: var(--color-blood)">
          {{ t('changelog.error') }}
        </p>
      } @else {
        <article class="mt-8 prose-field changelog-body text-ink leading-relaxed"
          [innerHTML]="html()"></article>
      }
    </section>
    </ng-container>
  `,
  styles: [`
    /* Scoped rendering for marked's output. The app otherwise avoids
       generic markdown styling (most markdown is rendered via our own
       AI-report pipeline in dashboard), so we paint it in here where
       only the changelog uses it. */
    .changelog-body :is(h2) {
      font-family: var(--font-display);
      font-style: italic;
      font-size: 1.5rem;
      color: var(--color-blood);
      margin-top: 2rem;
      margin-bottom: 0.5rem;
    }
    .changelog-body :is(h3) {
      font-family: var(--font-display);
      font-size: 1.125rem;
      color: var(--color-ink);
      margin-top: 1.25rem;
      margin-bottom: 0.5rem;
    }
    .changelog-body :is(p) { margin: 0.5rem 0; }
    .changelog-body :is(ul, ol) { margin: 0.5rem 0 0.75rem 1.25rem; }
    .changelog-body :is(li) { margin: 0.25rem 0; }
    .changelog-body :is(code) {
      font-family: var(--font-mono);
      font-size: 0.9em;
      background: var(--color-paper-deep);
      padding: 0.1em 0.35em;
      border-radius: 3px;
    }
    .changelog-body :is(a) {
      color: var(--color-blood);
      text-decoration: underline;
      text-decoration-style: dotted;
    }
    .changelog-body :is(hr) {
      border: 0;
      border-top: 1px dashed var(--color-aged);
      margin: 2rem 0;
    }
  `],
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
