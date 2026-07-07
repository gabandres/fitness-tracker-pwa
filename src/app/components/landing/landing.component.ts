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
    <style>
      .landing-hero {
        background: var(--v2-hero-panel, #161412);
        color: var(--v2-hero-text, #f3f1ec);
        border-radius: var(--v2-radius-xl);
        padding: var(--v2-space-8) var(--v2-space-5);
        position: relative;
        overflow: hidden;
        margin-top: var(--v2-space-4);
        box-shadow: 0 24px 48px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05);
      }
      .landing-hero::before {
        content: '';
        position: absolute;
        top: -50%; left: -50%; width: 200%; height: 200%;
        background: radial-gradient(circle at center, color-mix(in srgb, var(--v2-accent) 15%, transparent) 0%, transparent 60%);
        pointer-events: none;
      }
      .landing-hero-content {
        position: relative;
        z-index: 10;
      }
      .glass-card {
        background: color-mix(in srgb, var(--v2-paper-2) 60%, transparent);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid color-mix(in srgb, var(--v2-rule) 50%, transparent);
        border-radius: var(--v2-radius-xl);
        padding: var(--v2-space-5);
        transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .glass-card:hover {
        transform: translateY(-4px);
        box-shadow: var(--v2-shadow-3);
      }
      .section-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        background: var(--v2-accent-soft);
        color: var(--v2-accent);
        border-radius: 999px;
        font-family: var(--v2-font-mono);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: var(--v2-space-4);
      }
      .hover-link-card {
        text-decoration: none;
        display: block;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }
      .hover-link-card:hover {
        background: var(--v2-paper-3);
        border-color: var(--v2-accent);
        transform: scale(1.02);
      }
    </style>
    <article class="pb-16 px-4 max-w-6xl mx-auto space-y-16">
      <!-- ── 1. Hero ──────────────────────────────────────────────── -->
      <section class="landing-hero">
        <div class="landing-hero-content grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:items-center">
          <div>
            <div class="section-badge" style="background: rgba(255,255,255,0.1); color: var(--v2-accent);">
              {{ t('landing.calibrationLogNo') }}
            </div>
            <h1 class="v2-h1 v2-h1--hero" style="font-size: clamp(3rem, 6vw, 5rem); line-height: 1.05; letter-spacing: -0.03em; color: var(--v2-hero-text, #f3f1ec);">
              {{ t('landing.heroLead') }}<br/>
              <span style="color: var(--v2-accent);">{{ t('landing.heroEm') }}</span>
            </h1>
            <p class="mt-6 max-w-xl" style="font-size: 1.125rem; line-height: 1.6; color: var(--v2-hero-muted, #a39c91);">
              {{ t('landing.heroSub') }}
            </p>

            <div class="mt-8 flex flex-wrap items-center gap-4">
              <a href="/app" class="v2-btn v2-btn--primary v2-btn--lg" style="box-shadow: 0 8px 16px color-mix(in srgb, var(--v2-accent) 40%, transparent);">
                {{ t('landing.startLogging') }}
              </a>
              <a href="/calculator" class="v2-btn v2-btn--ghost" style="color: var(--v2-hero-text, #f3f1ec);">
                {{ t('landing.tryCalculator') }}
              </a>
            </div>

            @if (socialProofCount(); as n) {
              <div class="mt-8 flex items-center gap-3" style="color: var(--v2-hero-muted, #a39c91);">
                <div class="flex -space-x-2">
                  <div class="w-8 h-8 rounded-full bg-gray-600 border-2" style="border-color: var(--v2-hero-panel, #161412);"></div>
                  <div class="w-8 h-8 rounded-full bg-gray-500 border-2" style="border-color: var(--v2-hero-panel, #161412);"></div>
                  <div class="w-8 h-8 rounded-full bg-gray-400 border-2 flex items-center justify-center text-[10px] font-bold text-white" style="border-color: var(--v2-hero-panel, #161412);">+</div>
                </div>
                <p class="v2-caption" role="note" style="font-size: 0.875rem;">
                  {{ t('landing.socialProof', { n }) }}
                </p>
              </div>
            }
          </div>

          <div class="relative flex justify-center">
            <div class="absolute inset-0 bg-gradient-to-tr from-[var(--v2-accent)] to-[var(--v2-teal)] opacity-20 blur-3xl rounded-full" style="transform: scale(0.8);"></div>
            <img src="/hero-mockup.svg"
              alt="{{ t('landing.heroMockupAlt') }}"
              width="600" height="600"
              loading="eager"
              decoding="async"
              fetchpriority="high"
              class="relative z-10 w-full h-auto max-w-lg mx-auto drop-shadow-2xl hover:scale-105 transition-transform duration-700 ease-out" />
          </div>
        </div>
      </section>

      <!-- ── 2. Product proof — three capture paths + TDEE + AI ──── -->
      <section class="max-w-5xl mx-auto pt-8">
        <div class="text-center mb-12">
          <div class="section-badge">{{ t('landing.whatItDoesRule') }}</div>
          <h2 class="v2-display" style="font-size: clamp(2rem, 4vw, 3rem); line-height: 1.1;">Powerful, simple tracking.</h2>
        </div>
        <div class="grid gap-6 sm:grid-cols-3">
          <div class="glass-card flex flex-col justify-between">
            <div>
              <div class="w-12 h-12 rounded-full mb-4 flex items-center justify-center" style="background: var(--v2-accent-soft); color: var(--v2-accent);">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
              </div>
              <h3 class="v2-h3">{{ t('landing.proofCaptureTitle') }}</h3>
              <p class="v2-body-soft mt-3">{{ t('landing.proofCaptureBody') }}</p>
            </div>
            <p class="v2-caption mt-6 font-mono" style="color: var(--v2-accent);">{{ t('landing.proofCaptureStamp') }}</p>
          </div>
          <div class="glass-card flex flex-col justify-between" style="border-top-color: var(--v2-sage); box-shadow: 0 -2px 10px var(--v2-sage-soft);">
            <div>
              <div class="w-12 h-12 rounded-full mb-4 flex items-center justify-center" style="background: var(--v2-sage-soft); color: var(--v2-sage);">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
              </div>
              <h3 class="v2-h3">{{ t('landing.proofTdeeTitle') }}</h3>
              <p class="v2-body-soft mt-3">{{ t('landing.proofTdeeBody') }}</p>
            </div>
            <p class="v2-caption mt-6 font-mono" style="color: var(--v2-sage);">{{ t('landing.proofTdeeStamp') }}</p>
          </div>
          <div class="glass-card flex flex-col justify-between">
            <div>
              <div class="w-12 h-12 rounded-full mb-4 flex items-center justify-center" style="background: var(--v2-paper-3); color: var(--v2-ink);">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              </div>
              <h3 class="v2-h3">{{ t('landing.proofCoachTitle') }}</h3>
              <p class="v2-body-soft mt-3">{{ t('landing.proofCoachBody') }}</p>
            </div>
            <p class="v2-caption mt-6 font-mono" style="color: var(--v2-ink-muted);">{{ t('landing.proofCoachStamp') }}</p>
          </div>
        </div>
      </section>

      <!-- ── 3. Privacy pledge ───────────────────────────────────── -->
      <section class="max-w-3xl mx-auto text-center py-12">
        <div class="section-badge" style="background: transparent; border: 1px solid var(--v2-rule);">{{ t('landing.privacyLabel') }}</div>
        <h2 class="v2-display mt-4 mb-6">
          {{ t('landing.privacyLead') }}
          <span style="color: var(--v2-accent);">{{ t('landing.privacyEm') }}</span>
        </h2>
        <p class="v2-body-soft text-lg max-w-2xl mx-auto">{{ t('landing.privacyBody') }}</p>
        <p class="v2-caption mt-6">
          <a href="/privacy" class="v2-link">{{ t('landing.privacyLink') }}</a>
          &nbsp;·&nbsp;
          <a href="/terms" class="v2-link">{{ t('landing.termsLink') }}</a>
        </p>
      </section>

      <!-- ── 3.5 Quick targets ──────────────────────────────────── -->
      <section class="max-w-5xl mx-auto">
        <div class="flex items-end justify-between mb-6">
          <div>
            <h2 class="v2-h2">{{ t('landing.quickTargetsRule') }}</h2>
            <p class="v2-body-soft mt-1">{{ t('landing.quickTargetsLead') }}</p>
          </div>
          <a href="/calculator" class="v2-link hidden sm:inline-flex">{{ t('landing.qtAllWeights') }}</a>
        </div>
        <div class="grid gap-4 grid-cols-2 md:grid-cols-3">
          <a href="/macros/lose/150-lb"     class="v2-card hover-link-card"><span class="v2-body" style="font-weight: 600;">{{ t('landing.qtLose150') }}</span><br/><span class="v2-caption">{{ t('landing.qtLose') }}</span></a>
          <a href="/macros/lose/180-lb"     class="v2-card hover-link-card"><span class="v2-body" style="font-weight: 600;">{{ t('landing.qtLose180') }}</span><br/><span class="v2-caption">{{ t('landing.qtLose') }}</span></a>
          <a href="/macros/lose/220-lb"     class="v2-card hover-link-card"><span class="v2-body" style="font-weight: 600;">{{ t('landing.qtLose220') }}</span><br/><span class="v2-caption">{{ t('landing.qtLose') }}</span></a>
          <a href="/macros/maintain/150-lb" class="v2-card hover-link-card"><span class="v2-body" style="font-weight: 600;">{{ t('landing.qtMaintain150') }}</span><br/><span class="v2-caption">{{ t('landing.qtMaintain') }}</span></a>
          <a href="/macros/maintain/180-lb" class="v2-card hover-link-card"><span class="v2-body" style="font-weight: 600;">{{ t('landing.qtMaintain180') }}</span><br/><span class="v2-caption">{{ t('landing.qtMaintain') }}</span></a>
          <a href="/macros/gain/170-lb"     class="v2-card hover-link-card"><span class="v2-body" style="font-weight: 600;">{{ t('landing.qtGain170') }}</span><br/><span class="v2-caption">{{ t('landing.qtGain') }}</span></a>
        </div>
      </section>

      <!-- ── 4. Free ──────────────────────────────────────────────── -->
      <!-- Subscription/Pro pricing removed 2026-07-07 — Ignia is free (moving
           to a donations model, not a paid tier). -->
      <section id="pricing" class="max-w-3xl mx-auto text-center pt-8">
        <div class="section-badge" style="background: transparent; border: 1px solid var(--v2-rule);">{{ t('landing.freeStamp') }}</div>
        <h2 class="v2-display mt-4">{{ t('landing.freeHeadline') }}</h2>
        <p class="v2-body-soft mt-4 max-w-xl mx-auto">{{ t('landing.freeBody') }}</p>
        <a href="/app" class="v2-btn v2-btn--primary v2-btn--lg mt-8 inline-flex">
          {{ t('landing.freeCta') }}
        </a>
      </section>

      <!-- ── 5. Comparisons + FAQ footer ─────────────────────────── -->
      <footer class="mt-16 pt-12 max-w-5xl mx-auto flex flex-col md:flex-row justify-between gap-8 border-t" style="border-color: var(--v2-rule);">
        <div>
          <h2 class="v2-h3 mb-3">{{ t('landing.comparisonsRule') }}</h2>
          <div class="flex flex-wrap gap-2 mt-4">
            <a href="/vs/myfitnesspal" class="v2-link" style="padding: 6px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-full); text-decoration: none; font-size: 0.875rem;">vs MyFitnessPal</a>
            <a href="/vs/loseit" class="v2-link" style="padding: 6px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-full); text-decoration: none; font-size: 0.875rem;">vs Lose It!</a>
            <a href="/vs/macrofactor" class="v2-link" style="padding: 6px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-full); text-decoration: none; font-size: 0.875rem;">vs MacroFactor</a>
            <a href="/vs/cronometer" class="v2-link" style="padding: 6px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-full); text-decoration: none; font-size: 0.875rem;">vs Cronometer</a>
            <a href="/vs/calai" class="v2-link" style="padding: 6px 12px; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-full); text-decoration: none; font-size: 0.875rem;">vs Cal AI</a>
          </div>
        </div>
        <div class="md:text-right flex flex-col md:items-end justify-center">
          <a href="/faq" class="v2-link font-medium text-lg">{{ t('landing.faqLink') }}</a>
          <p class="v2-caption mt-2">&copy; {{ _getYear() }} Ignia</p>
        </div>
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

  protected _getYear(): number {
    return new Date().getFullYear();
  }
}
