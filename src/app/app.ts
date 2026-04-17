import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from './services/translation.service';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DailyLedgerComponent } from './components/daily-ledger/daily-ledger.component';
import { ConsultationComponent } from './components/consultation/consultation.component';
import { SignInComponent } from './components/sign-in/sign-in.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { FastingComponent } from './components/fasting/fasting.component';
import { MeasurementsComponent } from './components/measurements/measurements.component';
import { PrivacyComponent } from './components/privacy/privacy.component';
import { TermsComponent } from './components/terms/terms.component';
import { ChangelogComponent } from './components/changelog/changelog.component';
import { StatusComponent } from './components/status/status.component';
import { LandingComponent } from './components/landing/landing.component';
import { NotFoundComponent } from './components/not-found/not-found.component';
import { SettingsSheetComponent } from './components/settings-sheet/settings-sheet.component';
import { MobileTabsComponent, type MobileTab } from './components/mobile-tabs/mobile-tabs.component';
import { AuthService } from './services/auth.service';
import { FirebaseService } from './services/firebase.service';
import { FitnessStore } from './services/fitness-store.service';
import { SubscriptionService } from './services/subscription.service';
import { ThemeChoice, PRO_THEMES, isProTheme, readStoredTheme, writeStoredTheme } from './utils/theme';
import { localDateKey } from './utils/date';
import { mediaSignal } from './utils/media';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    DashboardComponent,
    DailyLedgerComponent,
    ConsultationComponent,
    SignInComponent,
    OnboardingComponent,
    FastingComponent,
    MeasurementsComponent,
    PrivacyComponent,
    TermsComponent,
    ChangelogComponent,
    StatusComponent,
    LandingComponent,
    NotFoundComponent,
    SettingsSheetComponent,
    MobileTabsComponent,
    TranslocoDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <a href="#main" class="skip-link">{{ t('app.skipToMain') }}</a>
    <main id="main" class="min-h-screen px-5 sm:px-8 lg:px-12 py-8 sm:py-12 pb-20 lg:pb-12">
      <div class="max-w-[560px] lg:max-w-[1100px] mx-auto">

        @if (route() === 'privacy') {
          @defer { <app-privacy /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'terms') {
          @defer { <app-terms /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'changelog') {
          @defer { <app-changelog /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'status') {
          @defer { <app-status /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'notFound') {
          @defer { <app-not-found /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'landing' && auth.ready() && !auth.isSignedIn()) {
          <!-- Public marketing surface at root. Bypasses the masthead +
               auth gate so a non-signed-in visitor sees product pitch,
               not a loading shell. Once signed in, the condition flips
               false and the authed flow below renders instead.
               Landing ships as its own chunk so returning users who
               deep-link to /app don't download the marketing code. -->
          @defer (on immediate) { <app-landing /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else {

        <!-- SwUpdate dialog (fixed overlay) -->
        @if (updateReady()) {
          <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink/40 backdrop-blur-sm ink-in"
            role="alertdialog" aria-labelledby="update-title" aria-describedby="update-body"
            (click)="dismissUpdate()">
            <div class="w-full max-w-sm specimen px-6 py-5 shadow-xl slide-down"
              style="background: var(--color-paper)"
              (click)="$event.stopPropagation()">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <div class="flex items-center gap-3 mb-3">
                <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('app.update.stamp') }}</span>
                <span id="update-title" class="font-display text-lg text-ink">{{ t('app.update.title') }}</span>
              </div>
              <p id="update-body" class="font-sans text-sm text-graphite leading-relaxed mb-4">
                {{ t('app.update.body') }}
              </p>
              <div class="flex gap-2">
                <button type="button" (click)="reloadForUpdate()" class="stamp-btn flex-1">{{ t('app.update.reload') }}</button>
                <button type="button" (click)="dismissUpdate()" class="tag-btn">{{ t('app.update.later') }}</button>
              </div>
            </div>
          </div>
        }

        <!-- Offline indicator with manual retry. The browser fires
             online events when the OS detects connectivity, but
             captive portals + flaky networks often leave us stuck even
             after the radio reconnects — the retry button forces a
             re-check + store refresh without waiting. -->
        @if (offline()) {
          <div class="mb-4 ink-in flex items-center gap-2 flex-wrap"
            role="status" aria-live="polite">
            <span class="stamp-mark" style="transform: rotate(0deg);">{{ t('app.offline.stamp') }}</span>
            <span class="caption text-xs flex-1 min-w-0">{{ t('app.offline.caption') }}</span>
            <button type="button" (click)="retryOffline()"
              [disabled]="retryingOffline()"
              [attr.aria-label]="t('app.offline.retryAria')"
              class="tag-btn text-[11px] shrink-0">
              {{ retryingOffline() ? t('app.offline.retrying') : t('app.offline.retry') }}
            </button>
          </div>
        }

        <!-- Daily reminder -->
        @if (showReminder()) {
          <div class="mb-4 ink-in specimen px-4 py-2.5 flex items-center justify-between gap-3"
            role="status" aria-live="polite"
            style="border-color: var(--color-gold)">
            <span class="crop-bl" style="border-color: var(--color-gold)"></span>
            <span class="crop-br" style="border-color: var(--color-gold)"></span>
            <div class="flex items-center gap-2">
              <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-gold); color: var(--color-gold)">{{ t('app.reminder.stamp') }}</span>
              <span class="caption text-xs">{{ t('app.reminder.caption') }}</span>
            </div>
            <button type="button" (click)="dismissReminder()"
              [attr.aria-label]="t('app.reminder.dismissAria')"
              class="tag-btn text-[11px]">{{ t('app.reminder.dismiss') }}</button>
          </div>
        }

        <!-- Masthead -->
        <header class="ink-in delay-1 flex items-start justify-between gap-4">
          <div>
            <div class="flex items-baseline gap-2">
              <span class="monogram">M·L</span>
              <span class="caption">{{ t('app.calibrationLogNo') }}</span>
            </div>
            <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight mt-1 text-ink">
              {{ t('app.taglineLead') }}<br/><em class="text-blood">{{ t('app.taglineEm') }}</em>
            </h1>
          </div>
          <div class="text-right shrink-0 pt-2">
            <div class="data-label">{{ todayLabel() }}</div>
            <!-- Theme + settings: spaced out with larger tap targets per
                 UX_AUDIT S9. Previously 2-char gap at ~24px touch size was
                 a mis-tap hazard on mobile. -->
            <div class="flex items-center justify-end gap-4 mt-1">
              <button type="button" (click)="toggleTheme()"
                class="tag-btn min-w-[36px] min-h-[36px] flex items-center justify-center"
                [attr.aria-label]="darkMode() ? t('app.masthead.themeAriaLight') : t('app.masthead.themeAriaDark')"
                [attr.title]="t('app.masthead.themeTitle')">
                {{ darkMode() ? t('app.masthead.themeIconLight') : t('app.masthead.themeIconDark') }}
              </button>
              @if (auth.isSignedIn() && firebase.profileCompleted()) {
                <button type="button" (click)="showSettings.set(true)"
                  class="tag-btn min-w-[36px] min-h-[36px] flex items-center justify-center"
                  [attr.aria-label]="t('app.masthead.settingsAria')"
                  [attr.title]="t('app.masthead.settingsTitle')">{{ t('app.masthead.settingsIcon') }}</button>
              }
            </div>
          </div>
        </header>

        <div class="ruler-edge mt-5 ink-in delay-2">
          @for (_ of ticks; track $index) { <span></span> }
        </div>

        <p class="caption mt-3 ink-in delay-2">
          {{ t('app.subtitle') }}
        </p>

        <!-- Main content gates: auth → profile → app -->
        <div class="mt-10 space-y-12">
          @if (!auth.ready()) {
            <div class="specimen p-10 text-center">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <p class="caption">{{ t('app.loadingFieldNotes') }}</p>
            </div>
          } @else if (!auth.isSignedIn()) {
            <div class="ink-in delay-3">
              <app-sign-in />
            </div>
          } @else if (!auth.emailVerified()) {
            <!-- Verification gate for email/password signups. Google
                 + Microsoft return verified emails by default, so they
                 skip past this immediately. -->
            <div class="ink-in delay-3">
              <section class="specimen px-6 py-8 sm:px-8 sm:py-10 relative">
                <span class="crop-bl"></span><span class="crop-br"></span>
                <div class="flex items-center gap-3 mb-3">
                  <span class="stamp-mark" style="border-color: var(--color-gold); color: var(--color-gold)">
                    {{ t('verify.stamp') }}
                  </span>
                  <span class="data-label">{{ t('verify.section') }}</span>
                </div>
                <h2 class="font-display text-2xl sm:text-3xl leading-tight text-ink">
                  {{ t('verify.title') }}
                </h2>
                <p class="font-sans text-sm text-ink-soft mt-3 leading-relaxed">
                  {{ t('verify.bodyPrefix') }}
                  <span class="font-mono text-ink">{{ auth.user()?.email }}</span>{{ t('verify.bodySuffix') }}
                </p>
                <p class="caption mt-3 text-[11px] leading-relaxed">
                  {{ t('verify.hint') }}
                </p>
                <div class="mt-6 flex flex-wrap items-center gap-2">
                  <button type="button" (click)="checkVerified()"
                    [disabled]="verifyChecking()"
                    class="stamp-btn">
                    {{ verifyChecking() ? t('verify.checking') : t('verify.checkNow') }}
                  </button>
                  <button type="button" (click)="resendVerification()"
                    [disabled]="verifyResending() || verifyResent()"
                    class="tag-btn">
                    @if (verifyResending()) { {{ t('verify.resending') }} }
                    @else if (verifyResent()) { ✓ {{ t('verify.resent') }} }
                    @else { {{ t('verify.resend') }} }
                  </button>
                  <button type="button" (click)="auth.signOut()"
                    class="tag-btn text-graphite">
                    {{ t('verify.signOut') }}
                  </button>
                </div>
                @if (verifyError()) {
                  <p class="font-mono text-[11px] text-blood mt-3" role="alert">✕ {{ verifyError() }}</p>
                }
              </section>
            </div>
          } @else if (!firebase.profile()) {
            <div class="specimen p-10 text-center">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <p class="caption">{{ t('app.openingYourFile') }}</p>
            </div>
          } @else if (!firebase.profileCompleted() || editingProfile()) {
            <div class="ink-in delay-3">
              @defer (on immediate) {
                <app-onboarding
                  [editMode]="editingProfile()"
                  (saved)="onProfileSaved()"
                  (cancelled)="editingProfile.set(false)"
                />
              } @placeholder {
                <div class="py-20 text-center caption">…</div>
              }
            </div>
          } @else {
            <!-- Settings sheet overlay (absolutely positioned outside
                 the two-column grid so it doesn't shift layout).
                 Deferred so the settings chunk isn't in first paint —
                 most sessions never open this sheet. -->
            @if (showSettings()) {
              @defer (on immediate) {
                <app-settings-sheet
                  [darkMode]="darkMode()"
                  [themeChoice]="themeChoice()"
                  (close)="showSettings.set(false)"
                  (editProfile)="editingProfile.set(true)"
                  (themeSelect)="setTheme($event)" />
              }
            }
            <!-- Responsive layout: single column on mobile (tabbed), two columns on desktop -->
            <div class="lg:grid lg:grid-cols-[1fr_1.15fr] lg:gap-10 lg:items-start">
              <!-- Left column: Daily ledger (tab: log) -->
              @if (isDesktop() || activeTab() === 'log') {
                <div class="ink-in delay-3 lg:sticky lg:top-8"
                  [attr.role]="isDesktop() ? null : 'tabpanel'"
                  [id]="'tabpanel-log'"
                  [attr.aria-labelledby]="isDesktop() ? null : 'tab-log'">
                  <app-daily-ledger />
                </div>
              }
              <!-- Right column: analytics + body tools.
                   Desktop always shows all; mobile splits into tabs. -->
              @if (isDesktop() || activeTab() === 'insights' || activeTab() === 'body') {
                <div class="space-y-12 mt-12 lg:mt-0">
                  @if (isDesktop() || activeTab() === 'insights') {
                    <div class="ink-in delay-3"
                      [attr.role]="isDesktop() ? null : 'tabpanel'"
                      [id]="'tabpanel-insights'"
                      [attr.aria-labelledby]="isDesktop() ? null : 'tab-insights'">
                      <app-dashboard />
                    </div>
                  }
                  @if (isDesktop() || activeTab() === 'body') {
                    <div [attr.role]="isDesktop() ? null : 'tabpanel'"
                      [id]="'tabpanel-body'"
                      [attr.aria-labelledby]="isDesktop() ? null : 'tab-body'">
                      @if (store.logs().length >= 3) {
                        <div class="ink-in delay-4">
                          @defer (on viewport; on idle) {
                            <app-consultation />
                          } @placeholder {
                            <div class="min-h-[180px]"></div>
                          }
                        </div>
                      }
                      <div class="ink-in delay-5">
                        <app-fasting />
                      </div>
                      <div class="ink-in delay-6">
                        <app-measurements />
                      </div>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Mobile tab bar (hidden on desktop via lg:hidden) -->
            <app-mobile-tabs
              [activeTab]="activeTab()"
              (tabChange)="onTabChange($event)" />
          }
        </div>

        <!-- Footer — version + legal only. Everything else moved to
             the settings sheet (gear icon in the masthead). -->
        <footer class="mt-16 ink-in delay-6">
          <div class="rule"></div>
          <div class="mt-6 flex items-center justify-between text-xs tracking-[0.18em] uppercase text-graphite font-mono">
            <span>{{ t('app.footer.madeForYou') }}</span>
            <span class="stamp-mark">{{ t('app.footer.private') }}</span>
          </div>
          @if (auth.user(); as u) {
            <p class="caption mt-4 text-center text-[11px]">
              <span class="text-graphite">{{ u.email }}</span>
              &middot;
              <a href="/privacy" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.privacy') }}</a>
              &middot;
              <a href="/terms" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.terms') }}</a>
              &middot;
              <a href="mailto:gabrielandresbermudez&#64;gmail.com" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.contact') }}</a>
            </p>
          }
        </footer>
        }
      </div>
    </main>
    </ng-container>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(FirebaseService);
  protected readonly store = inject(FitnessStore); // triggers lifecycle via constructor effect
  protected readonly subs = inject(SubscriptionService);
  private readonly swUpdate = inject(SwUpdate);
  private readonly translation = inject(TranslationService); // resolves locale on boot, updates <title>

  protected readonly ticks = Array.from({ length: 45 });
  protected readonly editingProfile = signal(false);
  protected readonly showSettings = signal(false);
  protected readonly activeTab = signal<MobileTab>('log');
  protected readonly isDesktop = mediaSignal('(min-width: 1024px)');
  /** URL-path based routing for the two public-static pages. Anything
      else (including '/' and unknown paths) falls through to the
      signal-gated main app. */
  protected readonly route = signal<'privacy' | 'terms' | 'changelog' | 'status' | 'landing' | 'notFound' | null>(this.detectRoute());
  protected readonly updateReady = signal(false);
  protected readonly offline = signal(!navigator.onLine);
  protected readonly retryingOffline = signal(false);
  protected readonly verifyChecking = signal(false);
  protected readonly verifyResending = signal(false);
  protected readonly verifyResent = signal(false);
  protected readonly verifyError = signal('');

  /** Pull a fresh user record from Firebase. After the user clicks
      the email-verification link, their server-side state flips to
      verified, but the local user object stays stale until reload. */
  protected async checkVerified(): Promise<void> {
    if (this.verifyChecking()) return;
    this.verifyChecking.set(true);
    this.verifyError.set('');
    try {
      await this.auth.reloadUser();
      if (!this.auth.emailVerified()) {
        this.verifyError.set(this.translation.t('verify.notYet'));
      }
    } catch (err) {
      this.verifyError.set(err instanceof Error ? err.message : this.translation.t('verify.checkFailed'));
    } finally {
      this.verifyChecking.set(false);
    }
  }

  /** Re-send the verification link. Disables itself for the rest of
      the session after one success to keep users from spamming the
      send-mail throttle (Firebase rate-limits this server-side too). */
  protected async resendVerification(): Promise<void> {
    if (this.verifyResending() || this.verifyResent()) return;
    this.verifyResending.set(true);
    this.verifyError.set('');
    try {
      await this.auth.resendVerificationEmail();
      this.verifyResent.set(true);
    } catch (err) {
      this.verifyError.set(err instanceof Error ? err.message : this.translation.t('verify.resendFailed'));
    } finally {
      this.verifyResending.set(false);
    }
  }

  /**
   * Manual reconnect: re-check `navigator.onLine`, ping a small known
   * URL to verify real reachability (not just radio state), and refresh
   * the store. Done on user click since the browser's `online` event
   * misses captive-portal recoveries.
   */
  protected async retryOffline(): Promise<void> {
    if (this.retryingOffline()) return;
    this.retryingOffline.set(true);
    try {
      // Probe a tiny static asset on our own origin so we don't false-
      // positive on cellular-router-reachable but internet-down states.
      // cache: 'no-store' avoids the SW serving the cached favicon and
      // hiding a real outage.
      const res = await fetch('/favicon.ico?_=' + Date.now(), {
        method: 'HEAD',
        cache: 'no-store',
      });
      if (res.ok) {
        this.offline.set(false);
        await this.store.refresh();
      }
    } catch {
      // Stay offline — user can tap again.
    } finally {
      this.retryingOffline.set(false);
    }
  }
  /** Current stored theme choice. `auto` means follow prefers-color-scheme.
      The three Pro values resolve to their literal data-theme on apply;
      free values map to `auto`/`light`/`dark`. */
  protected readonly themeChoice = signal<ThemeChoice>('auto');
  /** Effective dark flag for UI affordances (icon + color-meta). True
      when the resolved palette is a dark one (dark or oxblood-dark). */
  protected readonly darkMode = signal(false);
  protected readonly showReminder = signal(false);
  private get reminderHour(): number {
    return (this.firebase.profile() as any)?.reminderHour ?? 20;
  }

  private detectRoute(): 'privacy' | 'terms' | 'changelog' | 'status' | 'landing' | 'notFound' | null {
    const path = window.location.pathname.toLowerCase();
    if (path === '/privacy' || path === '/privacy/') return 'privacy';
    if (path === '/terms' || path === '/terms/') return 'terms';
    if (path === '/changelog' || path === '/changelog/') return 'changelog';
    if (path === '/status' || path === '/status/') return 'status';
    // Root path shows the public marketing surface to non-signed-in
    // visitors. Once the user signs in, the auth gate in the template
    // takes over and renders the app regardless of the 'landing' route.
    // `/app` and any `/app/*` sub-path bypass landing (PWA start_url,
    // returning-user deep links, and any future in-app route).
    if (path === '/' || path === '') return 'landing';
    if (path === '/app' || path.startsWith('/app/')) return null;
    // Unknown path → 404. Non-signed-in visitors see a branded page
    // instead of the loading shell; signed-in users still see it and
    // can click back into the app.
    return 'notFound';
  }

  protected readonly todayLabel = computed(() => {
    const d = new Date();
    const iso = localDateKey(d).replace(/-/g, '.');
    const locale = this.translation.language() === 'es-PR' ? 'es' : 'en-US';
    const day = d.toLocaleDateString(locale, { weekday: 'short' }).toLowerCase();
    return `${iso} · ${day}`;
  });

  constructor() {
    // Theme: load stored choice, enforce Pro gate once entitlement
    // resolves, apply the resulting palette, follow system-theme changes
    // while the choice is 'auto'.
    const initial = readStoredTheme();
    this.themeChoice.set(initial);
    this.applyThemeChoice(initial);

    // If the stored choice is a Pro palette but the user isn't paid
    // (subscription expired, logged out, trial over), silently revert
    // to 'auto' so they don't see a degraded/cropped palette.
    effect(() => {
      const choice = this.themeChoice();
      if (isProTheme(choice) && !this.subs.isPaid()) {
        this.setTheme('auto');
      }
    });

    // Track system preference so 'auto' responds live.
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (this.themeChoice() === 'auto') this.applyThemeChoice('auto');
      });

    // Online/offline tracking.
    window.addEventListener('online', () => this.offline.set(false));
    window.addEventListener('offline', () => this.offline.set(true));

    // Service-worker update detection.
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => this.updateReady.set(true));

      const doCheck = () => this.swUpdate.checkForUpdate().catch((err) => console.error(err));
      setInterval(doCheck, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          doCheck();
          this.checkReminder();
        }
      });
    }

    // Auto-dismiss reminder when user logs an entry.
    effect(() => {
      if (this.store.hasLoggedToday()) this.showReminder.set(false);
    });

    // Check reminder after data loads.
    setTimeout(() => this.checkReminder(), 3000);
  }

  private checkReminder(): void {
    if (!this.auth.isSignedIn() || !this.firebase.profileCompleted()) return;
    const now = new Date();
    if (now.getHours() < this.reminderHour) return;
    if (this.store.hasLoggedToday()) return;
    const key = `macrolog.reminder.dismissed.${localDateKey(now)}`;
    if (localStorage.getItem(key)) return;
    this.showReminder.set(true);
  }

  protected dismissReminder(): void {
    this.showReminder.set(false);
    localStorage.setItem(
      `macrolog.reminder.dismissed.${localDateKey(new Date())}`,
      '1',
    );
  }

  protected onProfileSaved(): void {
    this.editingProfile.set(false);
    // Store will pick up the profile change via its firebase.profile() dependency.
    this.store.refresh();
  }

  protected onTabChange(tab: MobileTab): void {
    this.activeTab.set(tab);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  /** Masthead affordance: flip between a light and dark palette.
      Any Pro palette toggles back to its free counterpart so the button
      stays predictable (power users use the settings picker). */
  protected toggleTheme(): void {
    this.setTheme(this.darkMode() ? 'light' : 'dark');
  }

  /** Explicit theme choice from the settings picker. Enforces the Pro
      gate here — an unpaid user who manages to pass a Pro value (via a
      stale state, console) gets downgraded to 'auto'. */
  protected setTheme(choice: ThemeChoice): void {
    const resolved: ThemeChoice = isProTheme(choice) && !this.subs.isPaid()
      ? 'auto' : choice;
    this.themeChoice.set(resolved);
    writeStoredTheme(resolved);
    this.applyThemeChoice(resolved);
  }

  /** Resolve a ThemeChoice against `prefers-color-scheme` and apply it
      to the document root. Updates `darkMode` + the `<meta name="theme-
      color">` so browser chrome matches. */
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

    // Keep darkMode aligned with the resolved palette so icons/meta work.
    const isDark = effective === 'dark' || effective === 'oxblood-dark';
    this.darkMode.set(isDark);

    // Map each palette to a matching browser-chrome color. Kept in sync
    // with the --color-paper values in styles.css.
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

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  protected dismissUpdate(): void {
    this.updateReady.set(false);
  }

  protected async reloadForUpdate(): Promise<void> {
    try { await this.swUpdate.activateUpdate(); }
    finally { document.location.reload(); }
  }
}
