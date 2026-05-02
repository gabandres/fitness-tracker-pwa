import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from '../../services/translation.service';
import { AnalyticsService } from '../../services/analytics.service';
import { V2Card } from '../ui/card.component';
import {
  GoalDirection,
  WEIGHT_MIN_LB,
  WEIGHT_MAX_LB,
  computeKcal,
  computeProtein,
} from '../../utils/macro-heuristic';
import { setCalcPrefill } from '../../utils/calc-prefill';

/**
 * Programmatic SEO landing for `/macros/<goal>/<weight>-lb`. Each URL
 * targets a long-tail query like "macros to lose 180 lb" or
 * "calorie target for 200 lb maintenance". The same heuristic that
 * drives /calculator and onboarding-v2 produces the numbers, so all
 * three surfaces stay in lock-step.
 *
 * Path is parsed from window.location at construction time — these
 * pages don't take inputs, they just render the answer for the
 * weight + goal in the URL. The CTA points to /calculator (refine
 * with their actual weight) and /app (sign-up).
 *
 * SEO checklist for this surface:
 *   - URL pattern is in sitemap.xml (one entry per common
 *     weight × goal combination)
 *   - H1 + canonical + title set per render via TranslationService
 *   - Body copy mentions weight + goal explicitly so on-page-text
 *     ranking matches the URL
 */
@Component({
  selector: 'app-macros-page',
  standalone: true,
  imports: [TranslocoDirective, V2Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="max-w-[640px] mx-auto px-5 sm:px-6 pt-10 pb-16">
      @if (parsed(); as p) {
        <header class="mb-6">
          <p class="v2-caption" style="color: var(--v2-accent);">
            {{ t('macrosPage.eyebrow') }}
          </p>
          <h1 class="v2-h1 mt-1" style="font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.15;">
            {{ heading() }}
          </h1>
          <p class="v2-body-soft mt-3">
            {{ subhead() }}
          </p>
        </header>

        <v2-card>
          <div class="flex items-center justify-between py-1">
            <span class="v2-caption">{{ t('macrosPage.kcalLabel') }}</span>
            <span class="v2-h3 font-mono">{{ kcal() }}</span>
          </div>
          <hr class="v2-hr" style="margin: var(--v2-space-2) 0;" />
          <div class="flex items-center justify-between py-1">
            <span class="v2-caption">{{ t('macrosPage.proteinLabel') }}</span>
            <span class="v2-h3 font-mono">{{ protein() }}{{ t('macrosPage.gramSuffix') }}</span>
          </div>
        </v2-card>

        <v2-card variant="accent" class="block mt-5 text-center">
          <h2 class="v2-h3">{{ t('macrosPage.ctaTitle') }}</h2>
          <p class="v2-body-soft mt-2">{{ t('macrosPage.ctaBody') }}</p>
          <div class="mt-5 flex flex-wrap justify-center gap-3">
            <a href="/app" class="v2-btn v2-btn--primary v2-btn--lg" (click)="onSignupClick()">
              {{ t('macrosPage.ctaSignup') }}
            </a>
            <a href="/calculator" class="v2-btn v2-btn--ghost">
              {{ t('macrosPage.ctaRefine') }}
            </a>
          </div>
        </v2-card>

        <section class="mt-10">
          <h2 class="v2-h2 mb-3" style="font-size: 1.125rem;">{{ t('macrosPage.howTitle') }}</h2>
          <p class="v2-body-soft">{{ explainer() }}</p>
          <p class="v2-caption mt-4">{{ t('macrosPage.disclaimer') }}</p>
        </section>

        <!-- Sibling cross-links: thicken the SEO crawl graph and let
             visitors hop to nearby weights / other goals at the same
             weight without bouncing back to /calculator. -->
        <nav class="mt-10" aria-labelledby="related-targets">
          <h2 id="related-targets" class="v2-h2 mb-3" style="font-size: 1.125rem;">
            {{ t('macrosPage.relatedTitle') }}
          </h2>
          <div class="flex flex-wrap gap-2">
            @for (link of siblingLinks(); track link.href) {
              <a [href]="link.href" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">
                {{ link.label }}
              </a>
            }
          </div>
        </nav>
      }
    </article>
    </ng-container>
  `,
})
export class MacrosPageComponent {
  private readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);

  protected readonly parsed = signal<{ goal: GoalDirection; weight: number } | null>(
    this.parsePath(),
  );

  protected readonly kcal = computed(() => {
    const p = this.parsed();
    return p ? computeKcal(p.weight, p.goal) : 0;
  });

  protected readonly protein = computed(() => {
    const p = this.parsed();
    return p ? computeProtein(p.weight, p.goal) : 0;
  });

  protected readonly heading = computed(() => {
    const p = this.parsed();
    if (!p) return '';
    return this.translation.t(`macrosPage.heading.${p.goal}`, { weight: p.weight });
  });

  protected readonly subhead = computed(() => {
    const p = this.parsed();
    if (!p) return '';
    return this.translation.t(`macrosPage.subhead.${p.goal}`, { weight: p.weight });
  });

  protected readonly explainer = computed(() => {
    const p = this.parsed();
    if (!p) return '';
    return this.translation.t(`macrosPage.explainer.${p.goal}`, {
      weight: p.weight,
      kcal: this.kcal(),
      protein: this.protein(),
    });
  });

  constructor() {
    // Set <title> per parsed weight/goal so each URL has a distinct
    // search-result title, not the static "Macro Log" default. The
    // effect reads translation.language() so it re-runs when the user
    // toggles language — without that, switching to es-PR while
    // viewing a /macros page would leave the English title stuck.
    effect(() => {
      this.translation.language();
      const p = this.parsed();
      if (typeof document === 'undefined') return;
      if (!p) return;
      document.title = this.translation.t(`macrosPage.title.${p.goal}`, { weight: p.weight });
    });

    const p = this.parsed();
    if (p) this.analytics.track('macros_page_viewed', { goal: p.goal, weight: p.weight });
  }

  /** Sibling SEO links: same goal at adjacent weights (±20 lb steps,
   *  matching sitemap.xml's enumeration), plus the other two goals at
   *  the current weight. Filters to weights in the valid band so we
   *  never link to a 404. */
  protected readonly siblingLinks = computed(() => {
    const p = this.parsed();
    if (!p) return [];
    const out: { href: string; label: string }[] = [];
    for (const delta of [-20, -10, 10, 20]) {
      const w = p.weight + delta;
      if (w < WEIGHT_MIN_LB || w > WEIGHT_MAX_LB) continue;
      out.push({
        href: `/macros/${p.goal}/${w}-lb`,
        label: this.translation.t(`macrosPage.sibling.${p.goal}`, { weight: w }),
      });
    }
    const goals: GoalDirection[] = ['lose', 'maintain', 'gain'];
    for (const g of goals) {
      if (g === p.goal) continue;
      out.push({
        href: `/macros/${g}/${p.weight}-lb`,
        label: this.translation.t(`macrosPage.sibling.${g}`, { weight: p.weight }),
      });
    }
    return out;
  });

  protected onSignupClick(): void {
    const p = this.parsed();
    if (!p) return;
    this.analytics.track('macros_cta_signup', { goal: p.goal, weight: p.weight });
    setCalcPrefill(p.weight, p.goal);
  }

  private parsePath(): { goal: GoalDirection; weight: number } | null {
    const m = /^\/macros\/(lose|maintain|gain)\/(\d{2,3})-lb\/?$/.exec(
      window.location.pathname,
    );
    if (!m) return null;
    const weight = parseInt(m[2], 10);
    // Out-of-range weights would emit junk SEO pages (e.g. 10 lb × 11
    // = 110 kcal). Sitemap.xml only enumerates 120-260 lb anyway, so
    // hits outside this band are typo'd direct visits — render empty
    // and let the parent surface fall through to the default branch.
    if (weight < WEIGHT_MIN_LB || weight > WEIGHT_MAX_LB) return null;
    return { goal: m[1] as GoalDirection, weight };
  }
}
