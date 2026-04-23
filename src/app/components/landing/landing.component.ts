import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { SubscriptionService } from '../../services/subscription.service';

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
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="space-y-16 pb-8">
      <!-- ── 1. Hero ──────────────────────────────────────────────── -->
      <section class="ink-in">
        <div class="flex items-baseline gap-2 mb-4">
          <span class="monogram">M·L</span>
          <span class="caption">{{ t('landing.calibrationLogNo') }}</span>
        </div>

        <div class="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:items-center">
          <div>
            <h1 class="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-ink">
              {{ t('landing.heroLead') }}<br/>
              <em class="text-blood">{{ t('landing.heroEm') }}</em>
            </h1>
            <p class="mt-6 font-sans text-lg text-ink-soft max-w-2xl leading-relaxed">
              {{ t('landing.heroSub') }}
            </p>

            <div class="mt-8 flex flex-wrap items-center gap-3">
              <a href="/app" class="stamp-btn">
                {{ t('landing.startLogging') }}
              </a>
              <a href="#pricing" class="tag-btn">{{ t('landing.seePricing') }}</a>
            </div>

            @if (socialProofCount(); as n) {
              <p class="caption mt-4 italic" role="note">
                {{ t('landing.socialProof', { n }) }}
              </p>
            }
          </div>

          <div>
            <img src="/hero-mockup.png"
              alt="{{ t('landing.heroMockupAlt') }}"
              width="720" height="720"
              loading="eager"
              decoding="async"
              fetchpriority="high"
              class="w-full h-auto max-w-lg mx-auto lg:max-w-none" />
          </div>
        </div>

        <div class="ruler-edge mt-10">
          @for (_ of ticks; track $index) { <span></span> }
        </div>
      </section>

      <!-- ── 2. Product proof — three capture paths + TDEE + AI ──── -->
      <section class="ink-in delay-1">
        <h2 class="rule"><span>{{ t('landing.whatItDoesRule') }}</span></h2>
        <div class="mt-6 grid gap-5 sm:grid-cols-3">
          <div class="specimen px-4 py-5">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('landing.proofCaptureStamp') }}</span>
            <h3 class="font-display text-xl text-ink mt-3">{{ t('landing.proofCaptureTitle') }}</h3>
            <p class="font-sans text-sm text-ink-soft mt-2 leading-relaxed">{{ t('landing.proofCaptureBody') }}</p>
          </div>
          <div class="specimen px-4 py-5">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('landing.proofTdeeStamp') }}</span>
            <h3 class="font-display text-xl text-ink mt-3">{{ t('landing.proofTdeeTitle') }}</h3>
            <p class="font-sans text-sm text-ink-soft mt-2 leading-relaxed">{{ t('landing.proofTdeeBody') }}</p>
          </div>
          <div class="specimen px-4 py-5">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('landing.proofCoachStamp') }}</span>
            <h3 class="font-display text-xl text-ink mt-3">{{ t('landing.proofCoachTitle') }}</h3>
            <p class="font-sans text-sm text-ink-soft mt-2 leading-relaxed">{{ t('landing.proofCoachBody') }}</p>
          </div>
        </div>
      </section>

      <!-- ── 3. Privacy pledge ───────────────────────────────────── -->
      <section class="ink-in delay-2">
        <div class="specimen px-6 py-8">
          <span class="crop-bl"></span><span class="crop-br"></span>
          <div class="flex items-center gap-3 mb-3">
            <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('landing.privacyStamp') }}</span>
            <span class="data-label">{{ t('landing.privacyLabel') }}</span>
          </div>
          <h2 class="font-display text-3xl sm:text-4xl leading-[0.95] text-ink">
            {{ t('landing.privacyLead') }}<br/>
            <em class="text-blood">{{ t('landing.privacyEm') }}</em>
          </h2>
          <p class="font-sans text-sm text-ink-soft mt-4 leading-relaxed max-w-2xl">
            {{ t('landing.privacyBody') }}
          </p>
          <p class="caption mt-4">
            <a href="/privacy" class="underline decoration-dotted hover:text-blood">{{ t('landing.privacyLink') }}</a>
            &nbsp;·&nbsp;
            <a href="/terms" class="underline decoration-dotted hover:text-blood">{{ t('landing.termsLink') }}</a>
          </p>
        </div>
      </section>

      <!-- ── 4. Pricing ───────────────────────────────────────────── -->
      <section id="pricing" class="ink-in delay-3">
        <h2 class="rule"><span>{{ t('landing.pricingRule') }}</span></h2>
        <div class="mt-6 grid gap-5 sm:grid-cols-2">
          <div class="specimen px-5 py-6 flex flex-col">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-baseline justify-between gap-3">
              <span class="stamp-mark">{{ t('landing.freeStamp') }}</span>
              <span class="font-display text-4xl text-ink">{{ t('landing.freePrice') }}</span>
            </div>
            <p class="font-sans text-sm text-ink-soft mt-3">{{ t('landing.freeBody') }}</p>
            <ul class="font-sans text-[13px] text-graphite mt-3 space-y-1 flex-1">
              <li>{{ t('landing.freeF1') }}</li>
              <li>{{ t('landing.freeF2') }}</li>
              <li>{{ t('landing.freeF3') }}</li>
              <li>{{ t('landing.freeF4') }}</li>
            </ul>
            <a href="/app" class="tag-btn mt-4 justify-center">{{ t('landing.freeCta') }}</a>
          </div>
          <div class="specimen px-5 py-6 flex flex-col" style="border-color: var(--color-blood)">
            <span class="crop-bl" style="border-color: var(--color-blood)"></span>
            <span class="crop-br" style="border-color: var(--color-blood)"></span>
            <div class="flex items-baseline justify-between gap-3">
              <span class="stamp-mark" style="border-color: var(--color-blood); color: var(--color-blood)">{{ t('landing.proStamp') }}</span>
              <!-- Primary price = annual with anchor (matches Subscribe
                   card default cadence). Monthly shown below as the
                   secondary path so the 33% savings vs 12× monthly is
                   visible in one glance — source of truth is
                   environment.stripe so landing never drifts from
                   Subscribe when prices change. -->
              <div class="text-right">
                <div>
                  @if (subs.displayPriceAnnualAnchor) {
                    <s class="font-display text-xl text-graphite-soft mr-1" aria-hidden="true">{{ subs.displayPriceAnnualAnchor }}</s>
                  }
                  <span class="font-display text-4xl text-blood">{{ subs.displayPriceAnnual }}</span>
                </div>
                <div class="caption text-[11px] mt-1">{{ t('landing.orMonthly', { price: subs.displayPriceMonthly }) }}</div>
              </div>
            </div>
            <div class="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm"
                 style="border: 1px solid var(--color-blood); background: rgba(111, 26, 16, 0.05);">
              <span class="font-mono text-[10px] tracking-[0.15em] uppercase" style="color: var(--color-blood);">
                ✦ {{ t('landing.proTrialBadge') }}
              </span>
            </div>
            <p class="font-sans text-sm text-ink-soft mt-3">{{ t('landing.proBody') }}</p>
            <ul class="font-sans text-[13px] text-graphite mt-3 space-y-1 flex-1">
              <li>{{ t('landing.proF1') }}</li>
              <li>{{ t('landing.proF2') }}</li>
              <li>{{ t('landing.proF3') }}</li>
              <li>{{ t('landing.proF4') }}</li>
              <li>{{ t('landing.proF5') }}</li>
            </ul>
            <!-- intent=pro deep-links into /app; once signed in, the App
                 shell reads the query and opens Settings → Subscribe
                 without the user hunting for it (UX report 2026-04-21 §2.8). -->
            <a href="/app?intent=pro" class="stamp-btn mt-4">{{ t('landing.proCta') }}</a>
          </div>
        </div>
        <p class="caption mt-4 text-[11px]">{{ t('landing.pricingFinePrint') }}</p>
      </section>

    </article>
    </ng-container>
  `,
})
export class LandingComponent {
  private readonly firestore = inject(Firestore);
  protected readonly subs = inject(SubscriptionService);
  protected readonly ticks = Array.from({ length: 45 });

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
