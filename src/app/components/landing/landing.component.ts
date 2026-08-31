import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { APP_STORE_URL, PLAY_STORE_URL, PLAY_STORE_LIVE } from '../../utils/app-store';
import { TranslationService } from '../../services/translation.service';
import { localizedPath } from '../../i18n/locale-path';

/**
 * Public marketing surface at `/` — redesigned 2026-08-30 (round two of the
 * post-ADR-0036 revamp: same brand, new page).
 *
 * Scroll rhythm (top → bottom):
 *   0. Sticky glass nav — brand wordmark, three anchors, one CTA
 *   1. Full-bleed dark hero — display serif headline + a CSS-built phone
 *      frame rendering the Today screen (ring, protein bar, entries)
 *   2. Features — six numbered cells in one hairline grid
 *   3. Quick targets — the /macros/* SEO links as a compact chip strip
 *   4. Manifesto band — full-bleed dark, the privacy pledge at display size
 *   5. Comparisons — the /vs/* links as chips
 *   6. Closing CTA — ember-tinted panel with the store row (id="pricing")
 *   7. Footer — site directory (the visible SEO link graph: every
 *      calculator variant, comparison, resource + the /es language
 *      switch) above the made-by credit + secondary nav
 *
 * Layout note: app.ts wraps every page in a max-width column with side
 * padding. This page escapes it with `.lp-bleed` (negative 50vw margins —
 * safe because styles.css already clips body x-overflow) so the dark bands
 * can run edge to edge; every band then carries its own `.lp-wrap` inner
 * column, which is what keeps the whole page on one 1104px grid.
 *
 * Motion: sections tagged `.lp-reveal` fade/rise once via one
 * IntersectionObserver armed in afterNextRender. The hidden initial state
 * only exists under `prefers-reduced-motion: no-preference` AND after JS
 * adds `.lp-motion` to the host — no JS (or reduced motion) means
 * everything simply renders visible.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">

    <article style="padding-bottom: clamp(48px, 7vw, 80px);">

      <!-- ── 0. sticky glass nav ─────────────────────────────── -->
      <div class="lp-navwrap lp-bleed" style="--lp-ember: #ff8a5c;">
        <nav class="lp-nav" aria-label="Ignia">
          <a href="/" class="lp-brand">ignia</a>
          <div class="lp-navlinks">
            <a href="#features">{{ t('landing.whatItDoesRule') }}</a>
            <a [href]="lp('/calculator')">{{ t('landing.navCalculator') }}</a>
            <a [href]="lp('/faq')">{{ t('landing.navFaq') }}</a>
            <a [href]="supportPath()">{{ t('landing.navSupport') }}</a>
          </div>
          <a [href]="APP_STORE_URL" rel="noopener" class="lp-nav-cta">{{ t('landing.startLogging') }}</a>
        </nav>
      </div>

      <!-- ── 1. hero ─────────────────────────────────────────── -->
      <section class="lp-hero lp-bleed">
        <div class="lp-wrap lp-hero-grid">
          <div class="lp-hero-copy">
            <p class="lp-kicker">{{ t('landing.calibrationLogNo') }}</p>
            <h1 class="lp-display lp-hero-h1">
              {{ t('landing.heroLead') }}<br />
              <em>{{ t('landing.heroEm') }}</em>
            </h1>
            <p class="lp-hero-sub">{{ t('landing.heroSub') }}</p>
            <div class="lp-cta-row">
              <a [href]="APP_STORE_URL" rel="noopener" class="lp-badge" [attr.aria-label]="t('landing.appStoreAlt')">
                <img src="/appstore-badge.svg" alt="{{ t('landing.appStoreAlt') }}"
                  width="180" height="60" loading="eager" decoding="async" fetchpriority="high" />
              </a>
              <!-- Android state: flip PLAY_STORE_LIVE (utils/app-store.ts,
                   one line) when the Play listing returns 200. -->
              @if (PLAY_STORE_LIVE) {
                <a [href]="PLAY_STORE_URL" rel="noopener" class="lp-play-live">{{ t('landing.freeCta') }}</a>
              } @else {
                <span class="lp-soon">{{ t('landing.playSoon') }}</span>
              }
            </div>
            <div class="lp-hero-links">
              <a [href]="lp('/calculator')" class="v2-link">{{ t('landing.tryCalculator') }} →</a>
              @if (socialProofCount(); as n) {
                <p class="lp-proof" role="note">{{ t('landing.socialProof', { n }) }}</p>
              }
            </div>
          </div>

          <div class="lp-hero-visual">
            <div class="lp-glow" aria-hidden="true"></div>
            <figure class="lp-phone" role="img" [attr.aria-label]="t('landing.heroMockupAlt')">
              <div class="lp-screen" aria-hidden="true">
                <div class="lp-island"></div>
                <div class="lp-scr-head">
                  <p class="lp-scr-title">{{ t('landing.mockToday') }}</p>
                  <span class="lp-scr-streak">{{ t('landing.mockStreak') }}</span>
                </div>
                <div class="lp-ring-wrap">
                  <svg viewBox="0 0 180 180" fill="none">
                    <circle cx="90" cy="90" r="80" stroke="rgba(255,255,255,0.08)" stroke-width="12" />
                    <circle cx="90" cy="90" r="80" stroke="#ff8a5c" stroke-width="12" stroke-linecap="round"
                      stroke-dasharray="382 503" transform="rotate(-90 90 90)" />
                  </svg>
                  <div class="lp-ring-center">
                    <p class="lp-ring-num">1,553</p>
                    <p class="lp-ring-den">/ 2,040 kcal</p>
                  </div>
                </div>
                <div>
                  <div class="lp-macro-row">
                    <span>{{ t('landing.mockProtein') }}</span>
                    <span><strong>138g</strong> <em>/ 150g</em></span>
                  </div>
                  <div class="lp-bar"><i></i></div>
                </div>
                <div class="lp-chips">
                  <span>{{ t('landing.mockCarbs') }} · 184g</span>
                  <span>{{ t('landing.mockFat') }} · 62g</span>
                </div>
                <div class="lp-entries">
                  <div class="lp-entry">
                    <div>
                      <p class="lp-entry-name">{{ t('landing.mockEntry1Name') }}</p>
                      <p class="lp-entry-meta">{{ t('landing.mockEntry1Meta') }}</p>
                    </div>
                    <span class="lp-entry-kcal">540</span>
                  </div>
                  <div class="lp-entry">
                    <div>
                      <p class="lp-entry-name">{{ t('landing.mockEntry2Name') }}</p>
                      <p class="lp-entry-meta">{{ t('landing.mockEntry2Meta') }}</p>
                    </div>
                    <span class="lp-entry-kcal">310</span>
                  </div>
                </div>
              </div>
            </figure>
          </div>
        </div>
      </section>

      <!-- ── 2. features — one hairline grid, six numbered cells ── -->
      <section id="features" class="lp-bleed lp-sec">
        <div class="lp-wrap">
          <div class="lp-reveal">
            <p class="lp-eyebrow">{{ t('landing.whatItDoesRule') }}</p>
            <h2 class="lp-display lp-lead">{{ t('landing.proofHeadline') }}</h2>
          </div>
          <div class="lp-featgrid lp-reveal">
            @for (f of FEATURES; track f.n) {
              <article class="lp-feat">
                <p class="lp-feat-n">{{ f.n }} — {{ t('landing.proof' + f.k + 'Stamp') }}</p>
                <h3>{{ t('landing.proof' + f.k + 'Title') }}</h3>
                <p>{{ t('landing.proof' + f.k + 'Body') }}</p>
              </article>
            }
          </div>
        </div>
      </section>

      <!-- ── 3. quick targets (the /macros/* SEO links) ──────── -->
      <section class="lp-bleed" style="padding-bottom: clamp(48px, 7vw, 88px);">
        <div class="lp-wrap lp-reveal">
          <div class="lp-targets-head">
            <div>
              <h2>{{ t('landing.quickTargetsRule') }}</h2>
              <p class="v2-caption" style="margin-top: 6px; max-width: 46ch;">{{ t('landing.quickTargetsLead') }}</p>
            </div>
            <a [href]="lp('/calculator')" class="v2-link" style="font-size: 0.875rem;">{{ t('landing.qtAllWeights') }}</a>
          </div>
          <div class="lp-target-chips">
            <a [href]="lp('/macros/lose/150-lb')">{{ t('landing.qtLose150') }}</a>
            <a [href]="lp('/macros/lose/180-lb')">{{ t('landing.qtLose180') }}</a>
            <a [href]="lp('/macros/lose/220-lb')">{{ t('landing.qtLose220') }}</a>
            <a [href]="lp('/macros/maintain/150-lb')">{{ t('landing.qtMaintain150') }}</a>
            <a [href]="lp('/macros/maintain/180-lb')">{{ t('landing.qtMaintain180') }}</a>
            <a [href]="lp('/macros/gain/170-lb')">{{ t('landing.qtGain170') }}</a>
          </div>
        </div>
      </section>

      <!-- ── 4. manifesto band ───────────────────────────────── -->
      <section class="lp-manifesto lp-bleed">
        <div class="lp-wrap lp-reveal">
          <p class="lp-eyebrow">{{ t('landing.privacyLabel') }}</p>
          <h2 class="lp-display lp-manifesto-h2">
            {{ t('landing.privacyLead') }}
            <em>{{ t('landing.privacyEm') }}</em>
          </h2>
          <p class="lp-manifesto-body">{{ t('landing.privacyBody') }}</p>
          <p class="lp-manifesto-links">
            <a [href]="lp('/privacy')">{{ t('landing.privacyLink') }}</a>
            &nbsp;·&nbsp;
            <a [href]="lp('/terms')">{{ t('landing.termsLink') }}</a>
          </p>
        </div>
      </section>

      <!-- ── 5. comparisons ──────────────────────────────────── -->
      <section class="lp-bleed lp-sec" style="padding-bottom: clamp(40px, 5vw, 64px);">
        <div class="lp-wrap lp-reveal">
          <p class="lp-eyebrow">{{ t('landing.comparisonsRule') }}</p>
          <div class="lp-vs-row">
            <a [href]="lp('/vs/myfitnesspal')">vs MyFitnessPal</a>
            <a [href]="lp('/vs/loseit')">vs Lose It!</a>
            <a [href]="lp('/vs/macrofactor')">vs MacroFactor</a>
            <a [href]="lp('/vs/cronometer')">vs Cronometer</a>
            <a [href]="lp('/vs/calai')">vs Cal AI</a>
          </div>
        </div>
      </section>

      <!-- ── 6. closing CTA ──────────────────────────────────── -->
      <section id="pricing" class="lp-bleed" style="padding-bottom: clamp(56px, 8vw, 96px);">
        <div class="lp-wrap">
          <div class="lp-cta-panel lp-reveal">
            <p class="lp-eyebrow">{{ t('landing.downloadStamp') }}</p>
            <h2 class="lp-display">{{ t('landing.downloadHeadline') }}</h2>
            <p class="lp-cta-body">{{ t('landing.downloadBody') }}</p>
            <div class="lp-cta-stores">
              <a [href]="APP_STORE_URL" rel="noopener" class="lp-badge" [attr.aria-label]="t('landing.appStoreAlt')">
                <img src="/appstore-badge.svg" alt="{{ t('landing.appStoreAlt') }}"
                  width="180" height="60" loading="lazy" decoding="async" />
              </a>
              <!-- Same one-line flip as the hero (PLAY_STORE_LIVE). -->
              @if (PLAY_STORE_LIVE) {
                <a [href]="PLAY_STORE_URL" rel="noopener" class="v2-btn v2-btn--primary v2-btn--lg">{{ t('landing.freeCta') }}</a>
              } @else {
                <span class="lp-soon">{{ t('landing.playSoon') }}</span>
              }
            </div>
            <p class="lp-cta-note">{{ PLAY_STORE_LIVE ? t('landing.downloadAndroidLive') : t('landing.downloadAndroidSoon') }}</p>
            <p class="lp-cta-note"><a [href]="downloadPath()">{{ t('landing.downloadMore') }}</a></p>
          </div>
        </div>
      </section>

      <!-- ── 7. footer: site directory + credits ─────────────── -->
      <!-- The directory is the human-visible half of the SEO link graph:
           every calculator variant, comparison and resource page gets a
           real <a href> from the landing page, plus the language switch
           into the /es/ half. The crawlable copy for first-pass bots is
           injected into the served HTML by scripts/prerender-seo.mjs
           (inside <noscript> on the shell); this one is what people see. -->
      <nav class="lp-dir" [attr.aria-label]="t('landing.dirLabel')">
        <div>
          <h2 class="lp-dir-h">{{ t('landing.dirCalculators') }}</h2>
          <ul>
            <li><a [href]="lp('/calculator')">{{ t('landing.navCalculator') }}</a></li>
            @for (v of CALC_VARIANTS; track v.slug) {
              <li><a [href]="lp('/' + v.slug)">{{ variantLabel(t('calcVariants.' + v.key + '.title')) }}</a></li>
            }
          </ul>
        </div>
        <div>
          <h2 class="lp-dir-h">{{ t('landing.dirCompare') }}</h2>
          <ul>
            <li><a [href]="lp('/vs/myfitnesspal')">vs MyFitnessPal</a></li>
            <li><a [href]="lp('/vs/loseit')">vs Lose It!</a></li>
            <li><a [href]="lp('/vs/macrofactor')">vs MacroFactor</a></li>
            <li><a [href]="lp('/vs/cronometer')">vs Cronometer</a></li>
            <li><a [href]="lp('/vs/calai')">vs Cal AI</a></li>
          </ul>
        </div>
        <div>
          <h2 class="lp-dir-h">{{ t('landing.dirResources') }}</h2>
          <ul>
            <li><a [href]="downloadPath()">{{ t('landing.dirDownload') }}</a></li>
            <li><a [href]="lp('/faq')">{{ t('landing.dirFaq') }}</a></li>
            <li><a [href]="supportPath()">{{ t('landing.dirSupport') }}</a></li>
            <li><a [href]="lp('/transformations')">{{ t('landing.dirTransformations') }}</a></li>
            <li><a [href]="lp('/changelog')">{{ t('landing.dirChangelog') }}</a></li>
            <li><a [href]="lp('/status')">{{ t('landing.dirStatus') }}</a></li>
          </ul>
        </div>
        <div>
          <h2 class="lp-dir-h">{{ t('landing.dirLegal') }}</h2>
          <ul>
            <li><a [href]="lp('/privacy')">{{ t('landing.dirPrivacy') }}</a></li>
            <li><a [href]="lp('/terms')">{{ t('landing.dirTerms') }}</a></li>
            <li><a [href]="otherLangPath()" [attr.hreflang]="otherLangCode()" [attr.lang]="otherLangCode()">{{ t('landing.otherLang') }}</a></li>
          </ul>
        </div>
      </nav>

      <footer class="lp-footer">
        <div>
          <p class="lp-footer-brand">ignia</p>
          <!-- The publisher claim is safe to make (and link): the Apple
               membership migrated to the LLC on 2026-08-25 and the Play
               app transfer landed 2026-08-29. -->
          <p class="lp-footer-made">
            {{ t('landing.madeBy') }}
            <a href="https://bermudezsystems.com/" target="_blank" rel="noopener">Bermudez Systems LLC</a>
            &nbsp;·&nbsp;&copy; {{ _getYear() }}
          </p>
        </div>
        <div class="lp-footer-nav">
          <a [href]="downloadPath()" class="v2-link font-medium">{{ t('landing.getOnIphone') }}</a>
          <a href="/faq" class="v2-link font-medium">{{ t('landing.faqLink') }}</a>
          <a [href]="supportPath()" class="v2-link font-medium" style="color: var(--v2-accent);">{{ t('landing.supportLink') }} ♥</a>
        </div>
      </footer>
    </article>
    </ng-container>
  `,
})
export class LandingComponent {
  private readonly firestore = inject(Firestore);
  private readonly i18n = inject(TranslationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** `/download` and `/support` are hand-written files in `public/`, not SPA
   *  routes, so they don't pick up the active language the way the rest of
   *  the app does. Hard-coding the English paths sent every Spanish visitor
   *  from the Spanish landing page to an English page at the exact step
   *  where they decide to install. */
  protected readonly downloadPath = computed(() => localizedPath('/download', this.i18n.language()));
  protected readonly supportPath = computed(() => localizedPath('/support', this.i18n.language()));

  /** Locale-aware internal link: a Spanish visitor stays on `/es/...` URLs.
   *  Navigation here is full page loads (plain anchors, no router — ADR-0036),
   *  so an unprefixed href would silently drop an /es visitor back into the
   *  English half. Same mechanism as downloadPath/supportPath above. */
  protected lp(path: string): string {
    return localizedPath(path, this.i18n.language());
  }

  /** The other locale's landing page — the visible half of the hreflang
   *  pair (`/` ↔ `/es/`), and the only crawlable entry into the /es half
   *  the client-rendered page carries. */
  protected readonly otherLangPath = computed(() =>
    this.i18n.language() === 'es-PR' ? '/' : '/es/');
  protected readonly otherLangCode = computed(() =>
    this.i18n.language() === 'es-PR' ? 'en' : 'es');

  /** Footer-directory rows for the calculator variants. slug → i18n key —
   *  must stay in sync with VARIANT_PATHS in calculator.component.ts and
   *  CALC_VARIANTS in scripts/prerender-seo.mjs (same dual-maintenance rule
   *  those two already declare for each other). */
  protected readonly CALC_VARIANTS = [
    { slug: 'tdee-calculator-women', key: 'tdeeWomen' },
    { slug: 'tdee-calculator-men', key: 'tdeeMen' },
    { slug: 'cutting-calculator', key: 'cutting' },
    { slug: 'bulking-calculator', key: 'bulking' },
    { slug: 'maintenance-calculator', key: 'maintenance' },
    { slug: 'keto-macro-calculator', key: 'keto' },
    { slug: 'weight-loss-calculator', key: 'weightLoss' },
    { slug: 'protein-calculator', key: 'protein' },
  ] as const;

  /** "Cutting Calculator · Calorie Deficit & Protein · Ignia" → "Cutting
   *  Calculator". The calcVariants titles are page titles; the first `·`
   *  segment is the name, the rest is SEO qualifier + brand. */
  protected variantLabel(title: string): string {
    return title.split('·')[0].trim();
  }

  /** App Store listing. The ID is the ASC app ID — same value as
   *  `submit.production.ios.ascAppId` in apps/mobile/eas.json and the
   *  `apple-itunes-app` smart-banner meta in src/index.html. */
  protected readonly APP_STORE_URL = APP_STORE_URL;
  protected readonly PLAY_STORE_URL = PLAY_STORE_URL;
  protected readonly PLAY_STORE_LIVE = PLAY_STORE_LIVE;

  /** The six feature cells — `k` indexes the `landing.proof{k}*` i18n
   *  triads, `n` is the printed calibration-log numeral. */
  protected readonly FEATURES = [
    { n: '01', k: 'Photo' },
    { n: '02', k: 'Capture' },
    { n: '03', k: 'Tdee' },
    { n: '04', k: 'Trends' },
    { n: '05', k: 'Sync' },
    { n: '06', k: 'Coach' },
  ] as const;

  /** Social-proof count from `public/stats.totalUsers`. Intentionally
      gated at 100 — below that we'd be doing anti-social-proof ("join
      7+ quiet loggers" is worse than no signal at all). */
  protected readonly socialProofCount = signal<number | null>(null);
  private static readonly SOCIAL_PROOF_MIN = 100;

  constructor() {
    void this.loadSocialProof();
    // Scroll-reveal: browser-only, additive, and inert both without JS
    // (the hidden state exists only under `.lp-motion`) and under
    // prefers-reduced-motion (the hidden state is media-gated in CSS).
    afterNextRender(() => this.armReveal());
  }

  private armReveal(): void {
    const root = this.host.nativeElement as HTMLElement;
    if (typeof IntersectionObserver === 'undefined') return;
    root.classList.add('lp-motion');
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add('lp-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    );
    root.querySelectorAll('.lp-reveal').forEach((el) => io.observe(el));
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
