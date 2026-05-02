import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from '../../services/translation.service';
import { AnalyticsService } from '../../services/analytics.service';
import { V2Card } from '../ui/card.component';

interface FaqItem { q: string; a: string; }

/**
 * Public FAQ at /faq. Targets "people also ask" boxes for fitness +
 * macro queries — Google now sources answers in the SERP itself, so
 * thin pages with structured Q&A out-perform long-form blog posts for
 * acquisition. Each Q is rendered as a `<details>` so the page is
 * crawlable but compact for users.
 *
 * The matching FAQPage JSON-LD is injected at build time by
 * scripts/prerender-seo.mjs — see the /faq entry there. Without that
 * structured data Google won't promote the answers into the rich
 * snippet slots, which is the entire reason this page exists.
 */
@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [TranslocoDirective, V2Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="max-w-[720px] mx-auto px-5 sm:px-6 pt-10 pb-16">
      <header class="mb-8">
        <p class="v2-caption" style="color: var(--v2-accent);">
          {{ t('faq.eyebrow') }}
        </p>
        <h1 class="v2-h1 mt-1" style="font-size: clamp(1.875rem, 4vw, 2.75rem); line-height: 1.15;">
          {{ t('faq.title') }}
        </h1>
        <p class="v2-body-soft mt-3">
          {{ t('faq.intro') }}
        </p>
      </header>

      <div class="flex flex-col gap-3">
        @for (item of items(); track item.q) {
          <details class="v2-card" style="padding: 0;">
            <summary
              class="cursor-pointer"
              style="padding: var(--v2-space-4) var(--v2-space-5); list-style: none; font-weight: 600; color: var(--v2-ink);">
              {{ item.q }}
            </summary>
            <div style="padding: 0 var(--v2-space-5) var(--v2-space-5); color: var(--v2-ink-muted); line-height: 1.6;">
              {{ item.a }}
            </div>
          </details>
        }
      </div>

      <v2-card variant="accent" class="block mt-10 text-center">
        <h2 class="v2-h3">{{ t('faq.ctaTitle') }}</h2>
        <p class="v2-body-soft mt-2">{{ t('faq.ctaBody') }}</p>
        <div class="mt-5">
          <a href="/calculator" class="v2-btn v2-btn--primary v2-btn--lg" (click)="trackCtaClick()">
            {{ t('faq.ctaButton') }}
          </a>
        </div>
      </v2-card>
    </article>
    </ng-container>
  `,
  styles: [`
    details > summary::-webkit-details-marker { display: none; }
    details > summary::after {
      content: '+';
      float: right;
      font-size: 1.25rem;
      color: var(--v2-ink-muted);
      transition: transform 200ms var(--v2-ease);
    }
    details[open] > summary::after { content: '−'; }
  `],
})
export class FaqComponent {
  private readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);

  /** Pulls the array of {q, a} from the translation file so en + es-PR
   *  can diverge per-locale without code changes. Recomputed when the
   *  user toggles language. */
  protected readonly items = computed<FaqItem[]>(() => {
    // Language read for reactivity so the array re-resolves on toggle.
    this.translation.language();
    const raw = this.translation.tObject<FaqItem[]>('faq.items');
    return Array.isArray(raw) ? raw : [];
  });

  constructor() {
    effect(() => {
      this.translation.language();
      if (typeof document === 'undefined') return;
      document.title = this.translation.t('faq.pageTitle');
    });
    this.analytics.track('faq_viewed');
  }

  protected trackCtaClick(): void {
    this.analytics.track('faq_cta_calculator');
  }
}
