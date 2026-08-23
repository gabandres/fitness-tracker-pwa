import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { APP_STORE_URL } from '../../utils/app-store';
import { TranslationService } from '../../services/translation.service';
import { localizedPath } from '../../i18n/locale-path';

/**
 * Public marketing surface at `/`. Shows when the user is not signed
 * in and the path is the site root — any other combination falls
 * through to the sign-in / onboarding / app flow in app.ts.
 *
 * Structure (scroll top → bottom):
 *   1. Hero — the one question the app answers (primary "start logging" CTA)
 *   2. Product proof — three capture paths, measured TDEE, AI coach
 *   3. Privacy pledge — the "no ads / no selling" promise
 *   4. Free — Ignia is free (donations model, no paid tier)
 *
 * Aesthetic reuses the "Personal Calibration Log" primitives (specimen
 * frames, stamp marks, ruler edges, crop marks) so a first-time visitor
 * gets the product's voice before ever logging in.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [TranslocoDirective],
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
      /* The hero sets the brand voice — Instrument Serif italic, lowercase —
         and then the page abandoned it: every heading below the fold was
         Manrope Title Case, so the site read as two sites stapled together
         and lost all its energy the moment you scrolled. The .v2-display
         class cannot
         carry the serif itself; it is the shared marketing <h1> for the
         calculator, /macros, /faq, /vs and the legal pages, and changing it
         would restyle a dozen surfaces. So the treatment is scoped here. */
      .landing-h2 {
        font-family: "Instrument Serif", "Geist", system-ui, serif;
        font-weight: 400;
        font-style: italic;
        letter-spacing: -0.015em;
        line-height: 1.05;
        font-size: clamp(2.25rem, 1.4rem + 3.4vw, 3.5rem);
        color: var(--v2-ink);
        /* Serif italic at display size strands single words badly — the
           proof headline broke as "one honest number / out." Balance costs
           nothing where unsupported. */
        text-wrap: balance;
      }
      /* Section eyebrow, mono and quiet, so the serif underneath does the
         talking. */
      .landing-rule {
        font-family: var(--v2-font-mono);
        font-size: 0.6875rem;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--v2-accent);
        font-weight: 700;
      }
      .proof-card {
        background: var(--v2-paper-2);
        border: 1px solid var(--v2-rule);
        border-top: 2px solid var(--v2-rule);
        border-radius: var(--v2-radius-lg, 14px);
        padding: var(--v2-space-5);
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-top-color 0.25s ease, transform 0.25s ease;
      }
      .proof-card:hover { transform: translateY(-3px); }
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

            <!-- App Store badge sits below the primary CTA, not beside it:
                 the web loop stays the fastest path to value (no install),
                 while iOS visitors still get a one-tap route to the listing.
                 It appears here and once more in the closing section, and
                 nowhere in between — a badge repeated at every scroll stop
                 stops reading as an offer. -->
            <div class="mt-6 flex flex-wrap items-center gap-4">
              <a [href]="APP_STORE_URL" rel="noopener" [attr.aria-label]="t('landing.appStoreAlt')">
                <img src="/appstore-badge.svg" alt="{{ t('landing.appStoreAlt') }}"
                  width="180" height="60" loading="lazy" decoding="async"
                  class="h-[52px] w-auto transition-transform duration-200 hover:scale-105" />
              </a>
            </div>

            <!-- This used to sit behind three empty grey circles standing in for
                 faces. They represented nobody: there are no avatars in this
                 product and never have been, so it was decoration pretending
                 to be evidence — on the one page whose whole argument is that
                 Ignia does not do that sort of thing. The count is real
                 (public/stats.totalUsers, floored to a ten), so let it stand
                 on its own. -->
            @if (socialProofCount(); as n) {
              <p class="mt-8 v2-caption" role="note"
                style="font-size: 0.875rem; color: var(--v2-hero-muted, #a39c91); display: flex; align-items: center; gap: 10px;">
                <span aria-hidden="true"
                  style="display: inline-block; width: 6px; height: 6px; border-radius: 999px; background: var(--v2-accent); flex: none;"></span>
                {{ t('landing.socialProof', { n }) }}
              </p>
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
      <!-- Left-aligned on purpose. Every section on this page used to be
           centred at the same width with the same badge-heading-paragraph
           rhythm, seven times over, which is what made a short page feel
           long. The privacy pledge keeps the centred treatment because it is
           the one emotional beat; the rest now vary. -->
      <section class="max-w-5xl mx-auto pt-8">
        <div class="mb-10 max-w-3xl">
          <p class="landing-rule mb-3">{{ t('landing.whatItDoesRule') }}</p>
          <!-- Was the literal English string "Powerful, simple tracking." —
               hardcoded in a fully translated template, so it was both the
               only untranslated line on the page and the most generic one on
               it. Every tracker claims to be powerful and simple. -->
          <h2 class="landing-h2">{{ t('landing.proofHeadline') }}</h2>
        </div>
        <!-- The stamp moved from the bottom of each card to the top and
             became the card's index. It was already the most characterful
             thing in the block and it was set at caption size under 60px of
             whitespace, where nobody read it. The generic outline glyphs it
             replaces (a plus, a trend line, a tick) said nothing the heading
             underneath did not already say. -->
        <div class="grid gap-5 sm:grid-cols-3">
          <div class="proof-card" style="border-top-color: var(--v2-accent);">
            <p class="landing-rule">{{ t('landing.proofCaptureStamp') }}</p>
            <h3 class="v2-h3">{{ t('landing.proofCaptureTitle') }}</h3>
            <p class="v2-body-soft">{{ t('landing.proofCaptureBody') }}</p>
          </div>
          <div class="proof-card" style="border-top-color: var(--v2-sage);">
            <p class="landing-rule" style="color: var(--v2-sage);">{{ t('landing.proofTdeeStamp') }}</p>
            <h3 class="v2-h3">{{ t('landing.proofTdeeTitle') }}</h3>
            <p class="v2-body-soft">{{ t('landing.proofTdeeBody') }}</p>
          </div>
          <div class="proof-card" style="border-top-color: var(--v2-ink-muted);">
            <p class="landing-rule" style="color: var(--v2-ink-muted);">{{ t('landing.proofCoachStamp') }}</p>
            <h3 class="v2-h3">{{ t('landing.proofCoachTitle') }}</h3>
            <p class="v2-body-soft">{{ t('landing.proofCoachBody') }}</p>
          </div>
        </div>
      </section>

      <!-- ── 3. Privacy pledge ───────────────────────────────────── -->
      <section class="max-w-3xl mx-auto text-center py-12">
        <p class="landing-rule mb-4">{{ t('landing.privacyLabel') }}</p>
        <h2 class="landing-h2 mb-6">
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
          <div class="max-w-2xl">
            <h2 class="landing-h2" style="font-size: clamp(1.75rem, 1.2rem + 2.2vw, 2.5rem);">{{ t('landing.quickTargetsRule') }}</h2>
            <p class="v2-body-soft mt-3">{{ t('landing.quickTargetsLead') }}</p>
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

      <!-- ── 4. The close: it's free, and it's on your phone ──────── -->
      <!-- This was TWO sections — a "download" block and a "free" block —
           sitting one under the other, each with its own badge, its own
           centred display heading, its own paragraph and its own CTA, and
           between them they made four calls to action inside one screen
           height while saying the same two facts. The store funnel still
           matters (organic traffic from /calculator, /macros/* and /vs/*
           only becomes an install if there is a visible store route, and
           install velocity is what moves store ranking) — it just does not
           need a section of its own to carry one badge.
           The id="pricing" anchor is kept: /faq and the footer link to it. -->
      <section id="pricing" class="max-w-3xl mx-auto text-center py-4">
        <p class="landing-rule mb-4">{{ t('landing.downloadStamp') }}</p>
        <h2 class="landing-h2">{{ t('landing.downloadHeadline') }}</h2>
        <p class="v2-body-soft mt-5 max-w-xl mx-auto">{{ t('landing.downloadBody') }}</p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a href="/app" class="v2-btn v2-btn--primary v2-btn--lg">{{ t('landing.freeCta') }}</a>
          <a [href]="APP_STORE_URL" rel="noopener" [attr.aria-label]="t('landing.appStoreAlt')">
            <img src="/appstore-badge.svg" alt="{{ t('landing.appStoreAlt') }}"
              width="180" height="60" loading="lazy" decoding="async"
              class="h-[52px] w-auto transition-transform duration-200 hover:scale-105" />
          </a>
        </div>
        <p class="v2-caption mt-6">{{ t('landing.downloadAndroid') }}</p>
        <p class="v2-caption mt-2"><a [href]="downloadPath()" class="v2-link">{{ t('landing.downloadMore') }}</a></p>
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
          <a [href]="downloadPath()" class="v2-link font-medium text-lg">{{ t('landing.getOnIphone') }}</a>
          <a href="/faq" class="v2-link font-medium text-lg mt-1">{{ t('landing.faqLink') }}</a>
          <a [href]="supportPath()" class="v2-link font-medium text-lg mt-1" style="color: var(--v2-accent);">{{ t('landing.supportLink') }} ♥</a>
          <!-- Names the operating company, and deliberately stops there. The
               App Store listing is still on an individual Apple account and
               the Play transfer to the org account is in progress, so any
               claim about who PUBLISHES the apps would contradict what the
               two stores currently show. -->
          <p class="v2-caption mt-2">&copy; {{ _getYear() }} Bermudez Systems LLC</p>
        </div>
      </footer>
    </article>
    </ng-container>
  `,
})
export class LandingComponent {
  private readonly firestore = inject(Firestore);
  private readonly i18n = inject(TranslationService);

  /** `/download` and `/support` are hand-written files in `public/`, not SPA
   *  routes, so they don't pick up the active language the way the rest of
   *  the app does. Hard-coding the English paths sent every Spanish visitor
   *  from the Spanish landing page to an English page at the exact step
   *  where they decide to install. */
  protected readonly downloadPath = computed(() => localizedPath('/download', this.i18n.language()));
  protected readonly supportPath = computed(() => localizedPath('/support', this.i18n.language()));

  /** App Store listing. The ID is the ASC app ID — same value as
   *  `submit.production.ios.ascAppId` in apps/mobile/eas.json and the
   *  `apple-itunes-app` smart-banner meta in src/index.html. */
  protected readonly APP_STORE_URL = APP_STORE_URL;

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
