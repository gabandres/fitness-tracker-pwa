import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { SubscriptionService } from '../../services/subscription.service';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * Public marketing surface at `/`. Shows when the user is not signed
 * in and the path is the site root — any other combination falls
 * through to the sign-in / onboarding / app flow in app.ts.
 *
 * Structure (scroll top → bottom):
 *   1. Hero — the one question the app answers (primary "start logging" CTA)
 *   2. Product proof — three capture paths, measured TDEE, AI coach
 *   3. Privacy pledge — the "no ads / no selling" promise
 *   4. Pricing — free vs Pro (price sourced from SubscriptionService,
 *      not hardcoded, so landing never drifts from the Subscribe card)
 *
 * Aesthetic reuses the "Personal Calibration Log" primitives (specimen
 * frames, stamp marks, ruler edges, crop marks) so a first-time visitor
 * gets the product's voice before ever logging in.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [TranslocoDirective, UiCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="space-y-14 pb-8">
      <!-- ── 1. Hero ──────────────────────────────────────────────── -->
      <section>
        <p class="v2-caption mb-4" style="text-transform: uppercase; letter-spacing: 0.08em;">
          {{ t('landing.calibrationLogNo') }}
        </p>

        <div class="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:items-center">
          <div>
            <h1 class="v2-h1 v2-h1--hero" style="font-size: clamp(2.75rem, 5.5vw, 4.5rem); line-height: 1.05; letter-spacing: -0.025em;">
              {{ t('landing.heroLead') }}<br/>
              <span style="color: var(--v2-accent);">{{ t('landing.heroEm') }}</span>
            </h1>
            <p class="v2-body-soft mt-5 max-w-2xl" style="font-size: 1.0625rem;">
              {{ t('landing.heroSub') }}
            </p>

            <div class="mt-7 flex flex-wrap items-center gap-3">
              <a href="/app" class="v2-btn v2-btn--primary v2-btn--lg">
                {{ t('landing.startLogging') }}
              </a>
              <a href="/calculator" class="v2-btn v2-btn--secondary">
                {{ t('landing.tryCalculator') }}
              </a>
              <a href="#pricing" class="v2-btn v2-btn--ghost">{{ t('landing.seePricing') }}</a>
            </div>

            @if (socialProofCount(); as n) {
              <p class="v2-caption mt-4" role="note">
                {{ t('landing.socialProof', { n }) }}
              </p>
            }
          </div>

          <div>
            <img src="/hero-mockup.svg"
              alt="{{ t('landing.heroMockupAlt') }}"
              width="720" height="720"
              loading="eager"
              decoding="async"
              fetchpriority="high"
              class="w-full h-auto max-w-lg mx-auto lg:max-w-none" />
          </div>
        </div>
      </section>

      <!-- ── 2. Product proof — three capture paths + TDEE + AI ──── -->
      <section>
        <h2 class="v2-h2 mb-6" style="text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.875rem; color: var(--v2-ink-muted);">
          {{ t('landing.whatItDoesRule') }}
        </h2>
        <div class="grid gap-4 sm:grid-cols-3">
          <ui-card variant="default" class="block">
            <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
              {{ t('landing.proofCaptureStamp') }}
            </p>
            <h3 class="v2-h3 mt-2">{{ t('landing.proofCaptureTitle') }}</h3>
            <p class="v2-body-soft mt-2">{{ t('landing.proofCaptureBody') }}</p>
          </ui-card>
          <ui-card variant="default" class="block">
            <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
              {{ t('landing.proofTdeeStamp') }}
            </p>
            <h3 class="v2-h3 mt-2">{{ t('landing.proofTdeeTitle') }}</h3>
            <p class="v2-body-soft mt-2">{{ t('landing.proofTdeeBody') }}</p>
          </ui-card>
          <ui-card variant="default" class="block">
            <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
              {{ t('landing.proofCoachStamp') }}
            </p>
            <h3 class="v2-h3 mt-2">{{ t('landing.proofCoachTitle') }}</h3>
            <p class="v2-body-soft mt-2">{{ t('landing.proofCoachBody') }}</p>
          </ui-card>
        </div>
      </section>

      <!-- ── 3. Privacy pledge ───────────────────────────────────── -->
      <section>
        <ui-card variant="flat" class="block">
          <p class="v2-caption mb-2" style="text-transform: uppercase; letter-spacing: 0.08em;">
            {{ t('landing.privacyLabel') }}
          </p>
          <h2 class="v2-h2">
            {{ t('landing.privacyLead') }}
            <span style="color: var(--v2-accent);">{{ t('landing.privacyEm') }}</span>
          </h2>
          <p class="v2-body-soft mt-4 max-w-2xl">{{ t('landing.privacyBody') }}</p>
          <p class="v2-caption mt-4">
            <a href="/privacy" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('landing.privacyLink') }}</a>
            &nbsp;·&nbsp;
            <a href="/terms" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('landing.termsLink') }}</a>
          </p>
        </ui-card>
      </section>

      <!-- ── 3.5 Quick targets — internal links into the programmatic
              SEO grid. Doubles as a crawl-graph signal (Google ranks
              pages other pages link to) and a low-friction "see what
              this app's numbers look like" demo for the visitor. -->
      <section>
        <h2 class="v2-h2 mb-3" style="text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.875rem; color: var(--v2-ink-muted);">
          {{ t('landing.quickTargetsRule') }}
        </h2>
        <p class="v2-body-soft mb-4 max-w-2xl">{{ t('landing.quickTargetsLead') }}</p>
        <div class="grid gap-2 sm:grid-cols-3">
          <a href="/macros/lose/150-lb"     class="v2-card block" style="text-decoration: none;"><span class="v2-body" style="font-weight: 500;">{{ t('landing.qtLose150') }}</span><br/><span class="v2-caption">{{ t('landing.qtLose') }}</span></a>
          <a href="/macros/lose/180-lb"     class="v2-card block" style="text-decoration: none;"><span class="v2-body" style="font-weight: 500;">{{ t('landing.qtLose180') }}</span><br/><span class="v2-caption">{{ t('landing.qtLose') }}</span></a>
          <a href="/macros/lose/220-lb"     class="v2-card block" style="text-decoration: none;"><span class="v2-body" style="font-weight: 500;">{{ t('landing.qtLose220') }}</span><br/><span class="v2-caption">{{ t('landing.qtLose') }}</span></a>
          <a href="/macros/maintain/150-lb" class="v2-card block" style="text-decoration: none;"><span class="v2-body" style="font-weight: 500;">{{ t('landing.qtMaintain150') }}</span><br/><span class="v2-caption">{{ t('landing.qtMaintain') }}</span></a>
          <a href="/macros/maintain/180-lb" class="v2-card block" style="text-decoration: none;"><span class="v2-body" style="font-weight: 500;">{{ t('landing.qtMaintain180') }}</span><br/><span class="v2-caption">{{ t('landing.qtMaintain') }}</span></a>
          <a href="/macros/gain/170-lb"     class="v2-card block" style="text-decoration: none;"><span class="v2-body" style="font-weight: 500;">{{ t('landing.qtGain170') }}</span><br/><span class="v2-caption">{{ t('landing.qtGain') }}</span></a>
        </div>
        <p class="v2-caption mt-3">
          <a href="/calculator" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('landing.qtAllWeights') }}</a>
        </p>
      </section>

      <!-- ── 4. Pricing ───────────────────────────────────────────── -->
      <section id="pricing">
        <h2 class="v2-h2 mb-6" style="text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.875rem; color: var(--v2-ink-muted);">
          {{ t('landing.pricingRule') }}
        </h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <ui-card variant="default" class="block flex-col" style="display: flex;">
            <div class="flex items-baseline justify-between gap-3">
              <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600;">
                {{ t('landing.freeStamp') }}
              </p>
              <span class="v2-num" style="font-size: 2rem; font-weight: 600;">{{ t('landing.freePrice') }}</span>
            </div>
            <p class="v2-body-soft mt-3">{{ t('landing.freeBody') }}</p>
            <ul class="v2-body-soft mt-3 flex-1" style="font-size: 0.875rem; padding-left: 1.25rem; list-style: disc; line-height: 1.7;">
              <li>{{ t('landing.freeF1') }}</li>
              <li>{{ t('landing.freeF2') }}</li>
              <li>{{ t('landing.freeF3') }}</li>
              <li>{{ t('landing.freeF4') }}</li>
            </ul>
            <a href="/app" class="v2-btn v2-btn--secondary v2-btn--block mt-4" style="justify-content: center;">
              {{ t('landing.freeCta') }}
            </a>
          </ui-card>
          <ui-card variant="accent" class="block flex-col" style="display: flex;">
            <div class="flex items-baseline justify-between gap-3">
              <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
                {{ t('landing.proStamp') }}
              </p>
              <div class="text-right">
                <div>
                  @if (subs.displayPriceAnnualAnchor) {
                    <s class="v2-num" style="font-size: 1.125rem; opacity: 0.5; margin-right: 4px;" aria-hidden="true">
                      {{ subs.displayPriceAnnualAnchor }}
                    </s>
                  }
                  <span class="v2-num" style="font-size: 2rem; font-weight: 600; color: var(--v2-accent);">
                    {{ subs.displayPriceAnnual }}
                  </span>
                </div>
                <div class="v2-caption mt-1">
                  {{ t('landing.orMonthly', { price: subs.displayPriceMonthly }) }}
                </div>
              </div>
            </div>
            <div class="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1"
                 style="border: 1px solid var(--v2-accent); background: var(--v2-accent-soft); border-radius: 999px; align-self: flex-start;">
              <span class="v2-num" style="font-size: 0.625rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
                {{ t('landing.proTrialBadge') }}
              </span>
            </div>
            <p class="v2-body-soft mt-3">{{ t('landing.proBody') }}</p>
            <ul class="v2-body-soft mt-3 flex-1" style="font-size: 0.875rem; padding-left: 1.25rem; list-style: disc; line-height: 1.7;">
              <li>{{ t('landing.proF1') }}</li>
              <li>{{ t('landing.proF2') }}</li>
              <li>{{ t('landing.proF3') }}</li>
              <li>{{ t('landing.proF4') }}</li>
              <li>{{ t('landing.proF5') }}</li>
            </ul>
            <a href="/app?intent=pro" class="v2-btn v2-btn--primary v2-btn--block mt-4" style="justify-content: center;">
              {{ t('landing.proCta') }}
            </a>
          </ui-card>
        </div>
        <p class="v2-caption mt-4">{{ t('landing.pricingFinePrint') }}</p>
      </section>

      <!-- ── 5. Comparisons + FAQ footer ─────────────────────────── -->
      <footer class="mt-16 pt-8" style="border-top: 1px solid var(--v2-rule);">
        <h2 class="v2-h2 mb-3" style="text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.875rem; color: var(--v2-ink-muted);">
          {{ t('landing.comparisonsRule') }}
        </h2>
        <p class="v2-body-soft mb-3 max-w-2xl">{{ t('landing.comparisonsLead') }}</p>
        <div class="flex flex-wrap gap-2">
          <a href="/vs/myfitnesspal" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">vs MyFitnessPal</a>
          <a href="/vs/loseit" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">vs Lose It!</a>
          <a href="/vs/macrofactor" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">vs MacroFactor</a>
          <a href="/vs/cronometer" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">vs Cronometer</a>
          <a href="/vs/calai" class="v2-link" style="padding: 6px 10px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); text-decoration: none;">vs Cal AI</a>
        </div>
        <p class="v2-caption mt-5">
          <a href="/faq" class="v2-link">{{ t('landing.faqLink') }}</a>
        </p>
      </footer>

    </article>
    </ng-container>
  `,
})
export class LandingComponent {
  private readonly firestore = inject(Firestore);
  protected readonly subs = inject(SubscriptionService);

  /** Social-proof count from `public/stats.totalUsers`. Intentionally
      gated at 100 — below that we'd be doing anti-social-proof ("join
      7+ quiet loggers" is worse than no signal at all). */
  protected readonly socialProofCount = signal<number | null>(null);
  private static readonly SOCIAL_PROOF_MIN = 100;

  constructor() {
    void this.loadSocialProof();
  }

  private async loadSocialProof(): Promise<void> {
    try {
      const snap = await getDoc(doc(this.firestore, 'public', 'stats'));
      const total = (snap.data()?.['totalUsers'] as number | undefined) ?? 0;
      if (total >= LandingComponent.SOCIAL_PROOF_MIN) {
        // Round down to nearest 10 so "127" doesn't read as precise
        // (and shifts visibly every reload). "120+" feels calibrated.
        this.socialProofCount.set(Math.floor(total / 10) * 10);
      }
    } catch { /* non-critical; landing renders fine without it */ }
  }
}
