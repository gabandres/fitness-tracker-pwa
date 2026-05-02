import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { TranslationService } from '../../services/translation.service';
import { AnalyticsService } from '../../services/analytics.service';
import { V2Card } from '../ui/card.component';
import { VS_PROFILES, VsProfile, vsProfileFor } from './vs-data';

/**
 * Comparison landing at /vs/<slug>. Targets comparison-intent search
 * traffic ("Macro Log vs MyFitnessPal", "MFP alternatives", etc.) —
 * the highest-converting top-of-funnel category for SaaS because the
 * visitor has already decided they want a tool and is shopping. Pages
 * are intentionally honest — Google's helpful-content signals down-
 * rank one-sided puff and visitors bounce off it.
 *
 * Each row in the comparison table calls out a winner; the matching
 * Article + ItemList JSON-LD at scripts/prerender-seo.mjs makes the
 * structured comparison eligible for rich snippets.
 */
@Component({
  selector: 'app-vs-page',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule, V2Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="max-w-[760px] mx-auto px-5 sm:px-6 pt-10 pb-16">
      @if (profile(); as p) {
        <header class="mb-6">
          <p class="v2-caption" style="color: var(--v2-accent);">
            {{ t('vs.eyebrow') }}
          </p>
          <h1 class="v2-h1 mt-1" style="font-size: clamp(1.875rem, 4vw, 2.5rem); line-height: 1.15;">
            {{ t('vs.heading', { name: p.name }) }}
          </h1>
          <p class="v2-body-soft mt-3">{{ p.tagline }}</p>
        </header>

        <v2-card class="block mb-6">
          <h2 class="v2-h3" style="font-size: 1rem;">{{ t('vs.honestTitle') }}</h2>
          <p class="v2-body-soft mt-2">{{ p.honestSummary }}</p>
        </v2-card>

        <h2 class="v2-h2 mb-3" style="font-size: 1.25rem;">{{ t('vs.tableTitle', { name: p.name }) }}</h2>
        <div class="overflow-x-auto">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--v2-rule);">
                <th class="v2-caption" style="text-align: left; padding: 8px 12px; font-weight: 600;">{{ t('vs.colFeature') }}</th>
                <th class="v2-caption" style="text-align: left; padding: 8px 12px; font-weight: 600;">Macro Log</th>
                <th class="v2-caption" style="text-align: left; padding: 8px 12px; font-weight: 600;">{{ p.name }}</th>
              </tr>
            </thead>
            <tbody>
              @for (row of p.rows; track row.feature) {
                <tr style="border-bottom: 1px solid var(--v2-rule);">
                  <td style="padding: 12px; vertical-align: top; color: var(--v2-ink); font-weight: 500;">{{ row.feature }}</td>
                  <td [style.background]="row.winner === 'us' ? 'rgba(180, 81, 58, 0.06)' : 'transparent'"
                      style="padding: 12px; vertical-align: top; color: var(--v2-ink-muted); line-height: 1.5;">
                    @if (row.winner === 'us') {
                      <lucide-icon name="check" [size]="14" [style.color]="'var(--v2-sage)'" style="margin-right: 4px; vertical-align: -2px;" />
                    }
                    {{ row.us }}
                  </td>
                  <td [style.background]="row.winner === 'them' ? 'rgba(180, 81, 58, 0.06)' : 'transparent'"
                      style="padding: 12px; vertical-align: top; color: var(--v2-ink-muted); line-height: 1.5;">
                    @if (row.winner === 'them') {
                      <lucide-icon name="check" [size]="14" [style.color]="'var(--v2-sage)'" style="margin-right: 4px; vertical-align: -2px;" />
                    }
                    {{ row.them }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <v2-card variant="accent" class="block mt-8 text-center">
          <h2 class="v2-h3">{{ t('vs.ctaTitle') }}</h2>
          <p class="v2-body-soft mt-2">{{ t('vs.ctaBody') }}</p>
          <div class="mt-5 flex flex-wrap justify-center gap-3">
            <a href="/calculator" class="v2-btn v2-btn--primary v2-btn--lg" (click)="trackCtaClick('calculator')">
              {{ t('vs.ctaCalculator') }}
            </a>
            <a href="/app" class="v2-btn v2-btn--ghost" (click)="trackCtaClick('signup')">
              {{ t('vs.ctaSignup') }}
            </a>
          </div>
        </v2-card>

        <!-- Sibling links to the other comparison pages — both an SEO
             crawl-graph signal and a way for visitors who came from
             "MFP alternatives" to keep browsing. -->
        <nav class="mt-10" aria-labelledby="other-comparisons">
          <h2 id="other-comparisons" class="v2-h2 mb-3" style="font-size: 1.125rem;">
            {{ t('vs.othersTitle') }}
          </h2>
          <div class="flex flex-wrap gap-2">
            @for (other of siblings(); track other.slug) {
              <a [href]="'/vs/' + other.slug" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">
                {{ t('vs.siblingLink', { name: other.name }) }}
              </a>
            }
          </div>
        </nav>
      }
    </article>
    </ng-container>
  `,
})
export class VsPageComponent {
  private readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly profile = signal<VsProfile | null>(this.parseSlug());

  protected readonly siblings = computed(() => {
    const p = this.profile();
    if (!p) return [];
    return VS_PROFILES.filter((o) => o.slug !== p.slug);
  });

  constructor() {
    effect(() => {
      this.translation.language();
      const p = this.profile();
      if (typeof document === 'undefined') return;
      if (!p) return;
      document.title = this.translation.t('vs.pageTitle', { name: p.name });
    });
    const p = this.profile();
    if (p) this.analytics.track('vs_page_viewed', { competitor: p.slug });
  }

  protected trackCtaClick(target: 'calculator' | 'signup'): void {
    const p = this.profile();
    if (!p) return;
    this.analytics.track('vs_cta_click', { competitor: p.slug, target });
  }

  private parseSlug(): VsProfile | null {
    const m = /^\/vs\/([a-z0-9-]+)\/?$/.exec(window.location.pathname);
    if (!m) return null;
    return vsProfileFor(m[1]);
  }
}
