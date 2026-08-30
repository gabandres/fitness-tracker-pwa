import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from './services/translation.service';
import { stripLangPrefix } from './i18n/locale-path';
import { SignInComponent } from './components/sign-in/sign-in.component';
import { CalculatorComponent } from './components/calculator/calculator.component';
import { MacrosPageComponent } from './components/macros-page/macros-page.component';
import { FaqComponent } from './components/faq/faq.component';
import { VsPageComponent } from './components/vs-page/vs-page.component';
import { PublicProfileComponent } from './components/public-profile/public-profile.component';
import { TransformationsComponent } from './components/transformations/transformations.component';
import { PrivacyComponent } from './components/privacy/privacy.component';
import { TermsComponent } from './components/terms/terms.component';
import { ChangelogComponent } from './components/changelog/changelog.component';
import { StatusComponent } from './components/status/status.component';
import { LandingComponent } from './components/landing/landing.component';
import { AdminComponent } from './components/admin/admin.component';
import { NotFoundComponent } from './components/not-found/not-found.component';
import { RetiredComponent } from './components/retired/retired.component';
import { AuthService } from './services/auth.service';
import { ThemeChoice, readStoredTheme } from './utils/theme';
import { mediaSignal } from './utils/media';
import { AnalyticsService } from './services/analytics.service';
import { AdminService } from './services/admin.service';
import { DeferErrorComponent } from './components/ui/defer-error.component';

/**
 * Every URL the shell answers. The logging app's routes (`/app`, `/history`,
 * `/trends`, `/body`, `/train`, `/onboarding`) collapse into `retired` —
 * ADR-0036 — so an installed PWA or an old email link lands on a page that
 * says where the app went, not on a 404.
 */
type Route =
  | 'privacy' | 'terms' | 'changelog' | 'status' | 'admin' | 'landing' | 'notFound'
  | 'calculator' | 'macros' | 'faq' | 'vs' | 'publicProfile' | 'transformations'
  | 'retired';

/**
 * The web shell (ADR-0036): the public marketing/compliance pages, and one
 * signed-in surface, `/admin`. There is no `<router-outlet>` — the route is a
 * signal read off `location.pathname`, which is what `prerender-seo.mjs`
 * relies on to serve each page from the same `index.html`.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    DeferErrorComponent,
    SignInComponent,
    CalculatorComponent,
    MacrosPageComponent,
    FaqComponent,
    VsPageComponent,
    PublicProfileComponent,
    TransformationsComponent,
    PrivacyComponent,
    TermsComponent,
    ChangelogComponent,
    StatusComponent,
    LandingComponent,
    AdminComponent,
    NotFoundComponent,
    RetiredComponent,
    TranslocoDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <a href="#main" class="skip-link">{{ t('app.skipToMain') }}</a>

    <main id="main" class="min-h-screen px-5 sm:px-8 md:px-12 pt-[max(0.5rem,env(safe-area-inset-top))] sm:pt-5 pb-12">
      <div class="max-w-[560px] md:max-w-[1100px] mx-auto">

        @if (route() === 'landing') {
          @defer (on immediate) { <app-landing /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'calculator') {
          @defer (on immediate) { <app-calculator /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'macros') {
          @defer (on immediate) { <app-macros-page /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'faq') {
          @defer (on immediate) { <app-faq /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'vs') {
          @defer (on immediate) { <app-vs-page /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'publicProfile') {
          @defer (on immediate) { <app-public-profile /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'transformations') {
          @defer (on immediate) { <app-transformations /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'privacy') {
          @defer { <app-privacy /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'terms') {
          @defer { <app-terms /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'changelog') {
          @defer { <app-changelog /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'status') {
          @defer { <app-status /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'retired') {
          @defer { <app-retired /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        } @else if (route() === 'admin') {
          @if (!isDesktop()) {
            <!-- The admin panel is desktop-only by design: dense tables and
                 a multi-tab layout that do not pack onto a phone. On a
                 narrow viewport say so instead of rendering the shell's
                 landing page, which is what used to happen. -->
            <div class="max-w-[480px] mx-auto px-5 py-16 text-center">
              <h1 class="v2-h2">Admin</h1>
              <p class="v2-body-soft mt-2">Open this page on a desktop-width window.</p>
            </div>
          } @else if (!auth.ready()) {
            <div class="py-20 text-center caption">…</div>
          } @else if (!auth.isSignedIn()) {
            <!-- The only sign-in surface left on the web. The admin guard
                 inside AdminComponent handles the signed-in-but-not-admin
                 case. -->
            <div class="ink-in delay-3 mt-10">
              <app-sign-in />
            </div>
          } @else {
            <!-- Impersonation banner. When an admin is signed in as another
                 user the admin claim is on their own account, not the
                 target's, so the panel is unreachable — this is the only
                 way back. -->
            @if (admin.impersonating()) {
              <div class="mb-4 specimen px-4 py-2.5 flex items-center justify-between gap-3 ink-in"
                role="status" aria-live="polite"
                style="border-color: var(--color-gold); background: color-mix(in srgb, var(--color-gold) 8%, transparent)">
                <span class="crop-bl" style="border-color: var(--color-gold)"></span>
                <span class="crop-br" style="border-color: var(--color-gold)"></span>
                <div class="flex items-center gap-2 min-w-0">
                  <span class="stamp-mark" style="border-color: var(--color-gold); color: var(--color-gold)">IMPERSONATING</span>
                  <span class="caption text-xs truncate">signed in as {{ auth.user()?.email }}</span>
                </div>
                <button type="button" (click)="exitImpersonation()"
                  [disabled]="exitingImpersonation()" class="tag-btn text-[11px] shrink-0">
                  {{ exitingImpersonation() ? 'returning…' : 'exit impersonation' }}
                </button>
              </div>
            }
            @defer (on immediate) { <app-admin /> }
            @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
          }
        } @else {
          @defer { <app-not-found /> }
          @placeholder { <div class="py-20 text-center caption">…</div> } @error { <app-defer-error /> }
        }

        <footer class="mt-16">
          <hr style="border: none; border-top: 1px solid var(--v2-rule);" />
          <div class="mt-5 v2-caption text-center">
            @if (auth.user(); as u) {
              <span style="color: var(--v2-ink);">{{ u.email }}</span>
              &middot;
              <button type="button" (click)="signOut()" class="v2-link v2-link--muted" style="min-height: 44px; padding: 0 6px;">{{ t('verify.signOut') }}</button>
              &middot;
            }
            <a href="/privacy" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted; display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; vertical-align: middle;">{{ t('app.footer.privacy') }}</a>
            &middot;
            <a href="/terms" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted; display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; vertical-align: middle;">{{ t('app.footer.terms') }}</a>
            &middot;
            <a href="/status" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted; display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; vertical-align: middle;">{{ t('app.footer.status') }}</a>
            &middot;
            <a href="mailto:gabrielandresbermudez&#64;gmail.com" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted; display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; vertical-align: middle;">{{ t('app.footer.contact') }}</a>
            <!-- Open Food Facts is ODbL — attribution is a licence obligation,
                 and Apple 5.2.2 asks for proof of third-party data rights. -->
            <p class="v2-caption" style="margin-top: 8px; opacity: 0.75;">{{ t('app.footer.dataCredit') }}</p>
          </div>
        </footer>
      </div>
    </main>
    </ng-container>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly admin = inject(AdminService);
  private readonly analytics = inject(AnalyticsService);
  private readonly translation = inject(TranslationService); // resolves locale on boot, updates <title>

  /** `/admin` renders only at desktop width — see the template. */
  protected readonly isDesktop = mediaSignal('(min-width: 768px)');
  protected readonly route = signal<Route>(this.detectRoute());
  protected readonly exitingImpersonation = signal(false);

  private detectRoute(): Route {
    // The `/es` prefix on the indexed Spanish URLs is a locale marker, not
    // a route: `/es/calculator` is the same view as `/calculator`, and
    // TranslationService reads the same prefix to pick the language. Strip
    // it here so every match below stays written once.
    const path = stripLangPrefix(window.location.pathname.toLowerCase()).replace(/\/+$/, '') || '/';
    if (path === '/') return 'landing';
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    if (path === '/changelog') return 'changelog';
    if (path === '/status') return 'status';
    if (path === '/admin') return 'admin';
    if (path === '/calculator') return 'calculator';
    // Programmatic SEO variants — same component, different intent + meta.
    // Adding a variant: register the path here AND in calculator.component.ts
    // VARIANT_PATHS AND in prerender-seo.mjs.
    if (/^\/(tdee-calculator-women|tdee-calculator-men|cutting-calculator|bulking-calculator|maintenance-calculator|keto-macro-calculator|weight-loss-calculator|protein-calculator)$/.test(path)) return 'calculator';
    if (path === '/faq') return 'faq';
    if (/^\/vs\/[a-z0-9-]+$/.test(path)) return 'vs';
    if (/^\/u\/[a-z0-9-]+$/.test(path)) return 'publicProfile';
    if (path === '/transformations') return 'transformations';
    if (/^\/macros\/(lose|maintain|gain)\/\d{2,3}-lb$/.test(path)) return 'macros';
    // The retired logging app (ADR-0036). `/app` is the installed PWA's
    // start_url and the target of every recap email's "Open your log"
    // button; the rest are its tabs. All of them get the "moved" page.
    if (path === '/app' || path.startsWith('/app/')) return 'retired';
    if (/^\/(history|trends|body|train|onboarding)(\/.*)?$/.test(path)) return 'retired';
    return 'notFound';
  }

  /** Exit impersonation from the banner. Lives here (not in AdminComponent)
   *  because the admin cannot reach the panel while impersonating. */
  protected async exitImpersonation(): Promise<void> {
    if (this.exitingImpersonation()) return;
    this.exitingImpersonation.set(true);
    try {
      await this.admin.stopImpersonating();
      window.location.assign('/admin');
    } catch (err) {
      console.error('stopImpersonation failed', err);
      this.exitingImpersonation.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  constructor() {
    // v2 design-system token scope — drives the [data-ui="v2"] attribute
    // selectors in styles-v2.css.
    document.documentElement.setAttribute('data-ui', 'v2');

    // Browser back/forward re-syncs the route signal so the template
    // re-renders without a full page reload.
    window.addEventListener('popstate', () => this.route.set(this.detectRoute()));

    // One pageview per boot, for whenever Plausible is turned on. The web no
    // longer writes `usageEvents` — a shell visit is not an app open, and the
    // admin's own visits must not count as users (ADR-0036 decision 6).
    this.analytics.pageview();

    // Theme: the stored choice survives from the logging app, and every
    // palette is free (v1 has no Pro tier), so apply whatever is there and
    // follow the system while it is 'auto'.
    const choice = readStoredTheme();
    this.applyThemeChoice(choice);
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (readStoredTheme() === 'auto') this.applyThemeChoice('auto');
      });

    // Per-route document.title. /changelog and /status set their own
    // in-component; the content pages carry theirs in the prerendered
    // <head>. Everything else inherits the base title from index.html.
    effect(() => {
      const r = this.route();
      const key =
        r === 'privacy' ? 'privacy.pageTitle' :
        r === 'terms' ? 'terms.pageTitle' :
        r === 'notFound' ? 'notFound.pageTitle' :
        r === 'changelog' ? 'changelog.pageTitle' :
        r === 'status' ? 'status.pageTitle' :
        r === 'retired' ? 'retired.pageTitle' :
        null;
      this.translation.setTitleKey(key);
      if (r === 'admin') document.title = 'Admin — Ignia';
    });
  }

  /** Resolve a ThemeChoice against `prefers-color-scheme` and apply it to
      the document root, keeping `<meta name="theme-color">` in step so the
      browser chrome matches. */
  private applyThemeChoice(choice: ThemeChoice): void {
    const el = document.documentElement;
    let effective: Exclude<ThemeChoice, 'auto'>;
    if (choice === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      effective = prefersDark ? 'dark' : 'light';
    } else {
      effective = choice;
    }

    if (effective === 'light') {
      el.removeAttribute('data-theme');
    } else {
      el.setAttribute('data-theme', effective);
    }

    // Kept in sync with the --color-paper values in styles.css.
    const chromeColor: Record<Exclude<ThemeChoice, 'auto'>, string> = {
      light: '#f2ead7',
      dark: '#1c1915',
      sepia: '#efe6d2',
      graphite: '#e8e6e2',
      'oxblood-dark': '#1a1010',
    };
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', chromeColor[effective]);
  }
}
