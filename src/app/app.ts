import { ApplicationRef, ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { concat, filter, first, interval } from 'rxjs';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from './services/translation.service';
import { SignInComponent } from './components/sign-in/sign-in.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
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
import { SettingsSheetComponent } from './components/settings-sheet/settings-sheet.component';
import { AuthService } from './services/auth.service';
import { LEDGER_PORT } from './ledger/ports/ledger.port';
import { FitnessStore } from './services/fitness-store.service';
import { WeeklyReportStore } from './services/weekly-report-store.service';
import { SubscriptionService } from './services/subscription.service';
import { ThemeChoice, PRO_THEMES, isProTheme, readStoredTheme, writeStoredTheme } from './utils/theme';
import { localDateKey } from './utils/date';
import { captureReferrerFromUrl } from './utils/referral';
import { bcp47ForLang } from './utils/locale';
import { mediaSignal } from './utils/media';
import { UpsellService } from './services/upsell.service';
import { AnalyticsService } from './services/analytics.service';
import { EntryFormManager } from './services/entry-form-manager.service';
import { AdminService } from './services/admin.service';
import { PushNotificationService } from './services/push-notification.service';
import { UiDevGallery } from './components/ui/dev-gallery.component';
import { TodayComponent } from './components/today/today.component';
import { EntrySheetComponent } from './components/entry-sheet/entry-sheet.component';
import { HistoryComponent } from './components/history/history.component';
import { DayDetailComponent } from './components/day-detail/day-detail.component';
import { TrendsComponent } from './components/trends/trends.component';
import { BodyComponent } from './components/body/body.component';
import { TrainComponent } from './components/train/train.component';
import { UiTabBar, type UiTab } from './components/ui/tab-bar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    SignInComponent,
    OnboardingComponent,
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
    SettingsSheetComponent,
    TranslocoDirective,
    UiDevGallery,
    TodayComponent,
    EntrySheetComponent,
    HistoryComponent,
    DayDetailComponent,
    TrendsComponent,
    BodyComponent,
    TrainComponent,
    UiTabBar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <a href="#main" class="skip-link">{{ t('app.skipToMain') }}</a>

    <!-- Persistent update banner. Pinned to the top of the viewport
         (z-[55] sits above v2 sheets at z-50 but below the global
         update modal at z-[60]). Stays visible across every route
         until the user taps Reload — solves the "I never noticed
         the update was ready" failure mode that pushed users to dig
         into settings. The modal still fires once on detection;
         this is the always-on backstop. -->
    @if (pendingUpdate()) {
      <div
        class="fixed left-0 right-0 z-[55] flex items-center justify-between gap-3 px-4 py-2 text-sm"
        style="top: env(safe-area-inset-top); background: var(--v2-accent); color: white; box-shadow: 0 1px 8px rgba(0,0,0,0.18);"
        role="status"
        aria-live="polite">
        <span class="truncate">{{ t('app.update.bannerText') }}</span>
        <button
          type="button"
          class="shrink-0 px-3 py-1 text-xs font-semibold"
          style="background: white; color: var(--v2-accent); border-radius: var(--v2-radius-full); border: none; min-height: 32px;"
          (click)="reloadForUpdate()">
          {{ t('app.update.reload') }}
        </button>
      </div>
    }

    @if (route() === 'devGallery') {
      <!-- v2 primitives gallery — internal dev surface, not in
           production navigation. Mounted at /dev/components while the
           v2 rebuild is in flight (Weeks 1-6). -->
      <ui-dev-gallery />
    } @else {
    <main id="main" class="min-h-screen px-5 sm:px-8 md:px-12 py-8 sm:py-12 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-12">
      <div class="max-w-[560px] md:max-w-[1100px] mx-auto">

        @if (route() === 'calculator') {
          @defer (on immediate) { <app-calculator /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'macros') {
          @defer (on immediate) { <app-macros-page /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'faq') {
          @defer (on immediate) { <app-faq /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'vs') {
          @defer (on immediate) { <app-vs-page /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'publicProfile') {
          @defer (on immediate) { <app-public-profile /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'transformations') {
          @defer (on immediate) { <app-transformations /> }
          @placeholder { <div class="py-20 text-center caption">…</div> }
        } @else if (route() === 'privacy') {
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
        } @else if (route() === 'admin' && isDesktop()) {
          <!-- Admin panel is desktop-only by design — the dense tables
               and multi-tab layout don't pack onto a phone screen.
               Narrow viewports silently fall through to the regular
               app below so the admin on their phone just sees the app. -->
          @if (!auth.ready()) {
            <div class="py-20 text-center caption">…</div>
          } @else if (!auth.isSignedIn()) {
            <!-- Non-signed-in visitors see the same sign-in card as /app.
                 The admin guard inside AdminComponent handles the post-auth
                 "not an admin" case — we just make sure they can reach a
                 sign-in surface here. -->
            <div class="ink-in delay-3">
              <app-sign-in />
            </div>
          } @else {
            @defer (on immediate) { <app-admin /> }
            @placeholder { <div class="py-20 text-center caption">…</div> }
          }
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

        <!-- Impersonation banner. Renders above the masthead whenever an
             admin is signed in as another user. Loss of the admin claim
             during impersonation means the admin panel is unreachable
             from the target account — this banner is the only way back. -->
        @if (admin.impersonating()) {
          <div class="mb-4 specimen px-4 py-2.5 flex items-center justify-between gap-3 ink-in"
            role="status" aria-live="polite"
            style="border-color: var(--color-gold); background: color-mix(in srgb, var(--color-gold) 8%, transparent)">
            <span class="crop-bl" style="border-color: var(--color-gold)"></span>
            <span class="crop-br" style="border-color: var(--color-gold)"></span>
            <div class="flex items-center gap-2 min-w-0">
              <span class="stamp-mark" style="border-color: var(--color-gold); color: var(--color-gold)">IMPERSONATING</span>
              <span class="caption text-xs truncate">viewing app as {{ auth.user()?.email }}</span>
            </div>
            <button type="button" (click)="exitImpersonation()"
              [disabled]="exitingImpersonation()" class="tag-btn text-[11px] shrink-0">
              {{ exitingImpersonation() ? 'returning…' : 'exit impersonation' }}
            </button>
          </div>
        }

        <!-- SwUpdate dialog (fixed overlay) -->
        @if (updateReady()) {
          <div class="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-ink/40 backdrop-blur-sm ink-in"
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

        <!-- Main content gates: auth → profile → app -->
        <div class="mt-10 space-y-12">
          @if (!auth.ready()) {
            <div class="v2-loader-stack" role="status" aria-live="polite">
              <div class="v2-loader" aria-hidden="true"></div>
              <p class="v2-loader-label">{{ t('app.loadingFieldNotes') }}</p>
            </div>
          } @else if (!auth.isSignedIn()) {
            <div class="ink-in delay-3">
              <app-sign-in />
            </div>
          } @else if (!auth.emailVerified()) {
            <!-- Verification gate for email/password signups. Google
                 + Microsoft return verified emails by default, so they
                 skip past this immediately. -->
            <div class="max-w-[640px] mx-auto px-5 sm:px-6 pt-10">
              <section style="padding: 1.75rem; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-lg, 12px);">
                <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">
                  {{ t('verify.section') }}
                </p>
                <h2 class="v2-h1 mt-2" style="font-size: clamp(1.75rem, 4vw, 2.25rem);">
                  {{ t('verify.title') }}
                </h2>
                <p class="v2-body-soft mt-3">
                  {{ t('verify.bodyPrefix') }}
                  <span class="v2-num" style="color: var(--v2-ink); font-size: 0.9375rem;">{{ auth.user()?.email }}</span>{{ t('verify.bodySuffix') }}
                </p>
                <p class="v2-caption mt-3">
                  {{ t('verify.hint') }}
                </p>
                <div class="mt-6 flex flex-wrap items-center gap-2">
                  <button type="button" (click)="checkVerified()"
                    [disabled]="verifyChecking()"
                    class="v2-btn v2-btn--primary">
                    {{ verifyChecking() ? t('verify.checking') : t('verify.checkNow') }}
                  </button>
                  <button type="button" (click)="resendVerification()"
                    [disabled]="verifyResending() || verifyResent()"
                    class="v2-btn v2-btn--secondary">
                    @if (verifyResending()) { {{ t('verify.resending') }} }
                    @else if (verifyResent()) { ✓ {{ t('verify.resent') }} }
                    @else { {{ t('verify.resend') }} }
                  </button>
                  <button type="button" (click)="auth.signOut()"
                    class="v2-btn v2-btn--ghost">
                    {{ t('verify.signOut') }}
                  </button>
                </div>
                @if (verifyError()) {
                  <p class="v2-caption mt-3" role="alert" style="color: var(--v2-accent);">✕ {{ verifyError() }}</p>
                }
              </section>
            </div>
          } @else if (!firebase.profile()) {
            @if (store.status() === 'error') {
              <!-- Profile load failed (504, rules deny, network drop).
                   Without this branch the loader span forever. -->
              <div class="max-w-[480px] mx-auto px-5 py-16 text-center">
                <h2 class="v2-h2">{{ t('app.openingErrorTitle') }}</h2>
                <p class="v2-body-soft mt-2">{{ t('app.openingErrorBody') }}</p>
                @if (store.error(); as err) {
                  <p class="v2-caption mt-3 font-mono" style="color: var(--v2-ink-muted); word-break: break-all;">
                    {{ err }}
                  </p>
                }
                <div class="mt-5 flex flex-col gap-2">
                  <button type="button" class="v2-btn v2-btn--primary v2-btn--lg" (click)="reloadApp()">
                    {{ t('app.openingErrorRetry') }}
                  </button>
                  <button type="button" class="v2-btn v2-btn--ghost v2-btn--md" (click)="auth.signOut()">
                    {{ t('verify.signOut') }}
                  </button>
                </div>
              </div>
            } @else {
              <div class="v2-loader-stack" role="status" aria-live="polite">
                <div class="v2-loader" aria-hidden="true"></div>
                <p class="v2-loader-label">{{ t('app.openingYourFile') }}</p>
              </div>
            }
          } @else if (!firebase.profileCompleted()) {
            <!-- New users go through the 2-question v2 onboarding (Q10
                 of UX revamp v2). saveOnboardingV2 also flips
                 profileCompleted so we never re-enter this branch. -->
            <div class="ink-in delay-3">
              @defer (on immediate) {
                <app-onboarding
                  (completed)="onOnboardingV2Completed()"
                  (cancelled)="onOnboardingV2Cancelled()" />
              } @placeholder {
                <div class="py-20 text-center caption">…</div>
              }
            </div>
          } @else {
            <!-- Settings sheet overlay. Deferred so the settings chunk
                 isn't in first paint — most sessions never open it. -->
            @if (showSettings()) {
              @defer (on immediate) {
                <app-settings-sheet
                  [darkMode]="darkMode()"
                  [themeChoice]="themeChoice()"
                  (close)="showSettings.set(false)"
                  (redoOnboarding)="goToOnboardingV2()"
                  (themeSelect)="setTheme($event)" />
              }
            }
            <!-- v2 authed app. Entry sheet is mounted once and
                 self-gates via the entry-form-manager mode signal —
                 works across all surfaces. -->
              @switch (route()) {
                @case ('onboarding') {
                  <!-- v2 2-question onboarding. Reachable via /onboarding
                       directly (redo from settings) or from the new-user
                       redirect below when no onboarding doc exists. -->
                  <app-onboarding
                    (completed)="onOnboardingV2Completed()"
                    (cancelled)="onOnboardingV2Cancelled()" />
                }
                @case ('history') {
                  @defer (on immediate) {
                    <app-history
                      (dayTapped)="pushHistoryDay($event)"
                      (closeRequested)="popHistory()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('historyDay') {
                  @defer (on immediate) {
                    <app-day-detail
                      [dateKey]="historyDay()!"
                      (closeRequested)="popHistory()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('trends') {
                  @defer (on immediate) {
                    <app-trends
                      (settingsRequested)="showSettings.set(true)"
                      (historyRequested)="onHistoryRequestedV2()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('body') {
                  @defer (on immediate) {
                    <app-body
                      (settingsRequested)="showSettings.set(true)"
                      (historyRequested)="onHistoryRequestedV2()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('train') {
                  @defer (on immediate) {
                    <app-train
                      (settingsRequested)="showSettings.set(true)"
                      (historyRequested)="onHistoryRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @default {
                  <app-today
                    (settingsRequested)="showSettings.set(true)"
                    (historyRequested)="onHistoryRequestedV2()"
                    (bodyRequested)="onBodyRequestedV2()" />
                }
              }
              <app-entry-sheet />
              <ui-tab-bar
                [tabs]="v2Tabs"
                [activeId]="activeUiTab()"
                (select)="onUiTabSelect($event)" />
          }
        </div>

        <!-- Footer — minimal v2 chrome. Settings/theme/profile all
             live in the settings sheet now. -->
        <footer class="mt-16">
          <hr style="border: none; border-top: 1px solid var(--v2-rule);" />
          <div class="mt-5 v2-caption text-center">
            @if (auth.user(); as u) {
              <span style="color: var(--v2-ink);">{{ u.email }}</span>
              &middot;
            }
            <a href="/privacy" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted;">{{ t('app.footer.privacy') }}</a>
            &middot;
            <a href="/terms" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted;">{{ t('app.footer.terms') }}</a>
            &middot;
            <a href="/status" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted;">{{ t('app.footer.status') }}</a>
            &middot;
            <a href="mailto:gabrielandresbermudez&#64;gmail.com" style="color: var(--v2-ink-muted); text-decoration: underline; text-decoration-style: dotted;">{{ t('app.footer.contact') }}</a>
          </div>
        </footer>
        }
      </div>
    </main>
    }
    </ng-container>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(LEDGER_PORT);
  protected readonly store = inject(FitnessStore); // triggers lifecycle via constructor effect
  // Eagerly construct WeeklyReportStore so its constructor wires its
  // refresh/clear hooks into FitnessStore before the first _load() runs.
  // Otherwise a sign-in that completes before any /trends visit would
  // skip the staleness check.
  private readonly _weeklyReport = inject(WeeklyReportStore);
  protected readonly subs = inject(SubscriptionService);
  private readonly upsell = inject(UpsellService);
  private readonly analytics = inject(AnalyticsService);
  private readonly entryForm = inject(EntryFormManager);
  private readonly swUpdate = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);
  private readonly translation = inject(TranslationService); // resolves locale on boot, updates <title>
  protected readonly admin = inject(AdminService);
  private readonly pushService = inject(PushNotificationService);

  protected readonly showSettings = signal(false);
  // Admin route is desktop-only — the dense tables don't pack onto a
  // phone screen. The matchMedia query stays so the /admin gate works.
  protected readonly isDesktop = mediaSignal('(min-width: 768px)');
  /** URL-path based routing for the two public-static pages. Anything
      else (including '/' and unknown paths) falls through to the
      signal-gated main app. */
  protected readonly route = signal<'privacy' | 'terms' | 'changelog' | 'status' | 'admin' | 'landing' | 'notFound' | 'devGallery' | 'history' | 'historyDay' | 'trends' | 'body' | 'train' | 'onboarding' | 'calculator' | 'macros' | 'faq' | 'vs' | 'publicProfile' | 'transformations' | null>(this.detectRoute());
  /** Selected day for `/history/YYYY-MM-DD`. Null on the grid view. */
  protected readonly historyDay = signal<string | null>(this.detectHistoryDay());
  /** Stack depth of OUR pushState calls. popHistory() falls back to a
   *  pushState('/app') when this is 0 — `history.length > 1` lies for
   *  deep-links (a fresh tab opening /history reports length 1+ already)
   *  and `history.back()` would leave the SPA. */
  private historyPushDepth = 0;
  protected readonly updateReady = signal(false);
  /** Latched when SwUpdate fires VERSION_READY. Stays true after the
   *  user dismisses the prompt so the next focus re-surfaces it AND
   *  drives the always-on top banner. Cleared only by activateUpdate
   *  (i.e. the user actually reloaded). */
  protected readonly pendingUpdate = signal(false);
  protected readonly offline = signal(!navigator.onLine);
  protected readonly retryingOffline = signal(false);
  protected readonly verifyChecking = signal(false);
  protected readonly verifyResending = signal(false);
  protected readonly verifyResent = signal(false);
  protected readonly verifyError = signal('');
  protected readonly exitingImpersonation = signal(false);

  /** Exit impersonation from the global banner. Lives here (not in
   *  AdminComponent) because the admin can't reach the admin panel
   *  while impersonating — the `admin` custom claim is on their own
   *  account, not the target's. */
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

  private detectRoute(): 'privacy' | 'terms' | 'changelog' | 'status' | 'admin' | 'landing' | 'notFound' | 'devGallery' | 'history' | 'historyDay' | 'trends' | 'body' | 'train' | 'onboarding' | 'calculator' | 'macros' | 'faq' | 'vs' | 'publicProfile' | 'transformations' | null {
    const path = window.location.pathname.toLowerCase();
    if (path === '/privacy' || path === '/privacy/') return 'privacy';
    if (path === '/terms' || path === '/terms/') return 'terms';
    if (path === '/changelog' || path === '/changelog/') return 'changelog';
    if (path === '/status' || path === '/status/') return 'status';
    if (path === '/admin' || path === '/admin/') return 'admin';
    if (path === '/dev/components' || path === '/dev/components/') return 'devGallery';
    if (path === '/history' || path === '/history/') return 'history';
    if (/^\/history\/\d{4}-\d{2}-\d{2}\/?$/.test(path)) return 'historyDay';
    if (path === '/trends' || path === '/trends/') return 'trends';
    if (path === '/body' || path === '/body/') return 'body';
    if (path === '/train' || path === '/train/') return 'train';
    if (path === '/onboarding' || path === '/onboarding/') return 'onboarding';
    if (path === '/calculator' || path === '/calculator/') return 'calculator';
    // Programmatic SEO variants — same component, different intent + meta.
    // Adding a variant: register the path here AND in calculator.component.ts
    // VARIANT_PATHS AND in sitemap.xml.
    if (path === '/tdee-calculator-women' || path === '/tdee-calculator-women/') return 'calculator';
    if (path === '/tdee-calculator-men' || path === '/tdee-calculator-men/') return 'calculator';
    if (path === '/cutting-calculator' || path === '/cutting-calculator/') return 'calculator';
    if (path === '/bulking-calculator' || path === '/bulking-calculator/') return 'calculator';
    if (path === '/maintenance-calculator' || path === '/maintenance-calculator/') return 'calculator';
    if (path === '/keto-macro-calculator' || path === '/keto-macro-calculator/') return 'calculator';
    if (path === '/weight-loss-calculator' || path === '/weight-loss-calculator/') return 'calculator';
    if (path === '/protein-calculator' || path === '/protein-calculator/') return 'calculator';
    if (path === '/faq' || path === '/faq/') return 'faq';
    if (/^\/vs\/[a-z0-9-]+\/?$/.test(path)) return 'vs';
    if (/^\/u\/[a-z0-9-]+\/?$/.test(path)) return 'publicProfile';
    if (path === '/transformations' || path === '/transformations/') return 'transformations';
    if (/^\/macros\/(lose|maintain|gain)\/\d{2,3}-lb\/?$/.test(path)) return 'macros';
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

  /** Extract the YYYY-MM-DD segment from `/history/<date>` paths. Null
   *  for any other path. Validated by the same regex as `detectRoute`. */
  private detectHistoryDay(): string | null {
    const m = /^\/history\/(\d{4}-\d{2}-\d{2})\/?$/.exec(window.location.pathname);
    return m ? m[1] : null;
  }

  /** Sync `route` + `historyDay` signals to the current URL. Called from
   *  the constructor on cold load and from the popstate listener on each
   *  back/forward navigation so browser-back works without a reload. */
  private applyLocation(): void {
    this.route.set(this.detectRoute());
    this.historyDay.set(this.detectHistoryDay());
  }

  /** v2 calendar-icon handler — pushes /history into the history stack
   *  and re-syncs route signals. */
  protected onHistoryRequestedV2(): void {
    history.pushState({}, '', '/history');
    this.historyPushDepth++;
    this.applyLocation();
  }

  /** Fasting pill tap from any v2 surface → /body. No-op when already
   *  on /body (the pill is still rendered there as a state indicator
   *  but tapping it from the same route would just push a duplicate
   *  history entry). */
  protected onBodyRequestedV2(): void {
    if (this.route() === 'body') return;
    history.pushState({}, '', '/body');
    this.historyPushDepth++;
    this.applyLocation();
  }

  /** Settings → Redo onboarding link. Pushes /onboarding so the route-
   *  switch renders OnboardingV2 in redo mode. */
  protected goToOnboardingV2(): void {
    history.pushState({}, '', '/onboarding');
    this.historyPushDepth++;
    this.applyLocation();
  }

  /** v2 onboarding completed — pop the /onboarding route if we're on it
   *  and land back on /app. Used both for the explicit /onboarding route
   *  (redo flow from settings) and the inline new-user gate. */
  protected onOnboardingV2Completed(): void {
    if (this.route() === 'onboarding') {
      history.pushState({}, '', '/app');
      this.historyPushDepth++;
      this.applyLocation();
    }
  }

  /** v2 onboarding cancelled (Keep current). Same nav as completed. */
  protected onOnboardingV2Cancelled(): void {
    if (this.route() === 'onboarding') {
      history.pushState({}, '', '/app');
      this.historyPushDepth++;
      this.applyLocation();
    }
  }

  /** Tap handler from the month grid: push /history/<key> and re-sync. */
  protected pushHistoryDay(key: string): void {
    history.pushState({}, '', '/history/' + key);
    this.historyPushDepth++;
    this.applyLocation();
  }

  /** v2 tab-bar definition. Order = visual order. */
  protected readonly v2Tabs: UiTab[] = [
    { id: 'today', label: 'Today', icon: 'home' },
    { id: 'trends', label: 'Trends', icon: 'trending-up' },
    { id: 'body', label: 'Body', icon: 'user' },
    { id: 'train', label: 'Train', icon: 'dumbbell' },
  ];

  /** Maps the current `route()` value back onto a tab id so the tab bar
   *  highlights the correct segment. Calendar routes (history /
   *  historyDay) inherit Today highlight — they're a sub-surface of the
   *  Today tab, not a separate primary section. */
  protected readonly activeUiTab = computed<string>(() => {
    const r = this.route();
    if (r === 'trends') return 'trends';
    if (r === 'body') return 'body';
    if (r === 'train') return 'train';
    return 'today';
  });

  /** Tab-bar tap handler. No-op when tapping the actual current route —
   *  not the derived tab. The history routes report `today` as their
   *  active tab so the bar lights up correctly, but a Today tap from
   *  inside /history must still navigate to /app. */
  protected onUiTabSelect(id: string): void {
    const r = this.route();
    if (id === 'today' && r !== 'history' && r !== 'historyDay' && r !== 'trends' && r !== 'body' && r !== 'train') return;
    if (id === 'trends' && r === 'trends') return;
    if (id === 'body' && r === 'body') return;
    if (id === 'train' && r === 'train') return;
    if (id === 'today') {
      history.pushState({}, '', '/app');
    } else if (id === 'trends') {
      history.pushState({}, '', '/trends');
    } else if (id === 'body') {
      history.pushState({}, '', '/body');
    } else if (id === 'train') {
      history.pushState({}, '', '/train');
    } else {
      return;
    }
    this.historyPushDepth++;
    this.applyLocation();
  }

  /** Back affordance from history surfaces. Only call `history.back()`
   *  when WE have pushes on the stack — otherwise we'd leave the SPA on
   *  a deep-linked cold load. The popstate listener decrements the
   *  counter so browser-back is tracked too. */
  protected popHistory(): void {
    if (this.historyPushDepth > 0) {
      // Counter decrements via the popstate listener; don't double-decrement.
      history.back();
    } else {
      history.pushState({}, '', '/app');
      this.historyPushDepth++;
      this.applyLocation();
    }
  }


  constructor() {
    // v2 design-system token scope — set unconditionally now that v1
    // is fully retired. Drives the [data-ui="v2"] attribute selectors
    // in styles-v2.css.
    document.documentElement.setAttribute('data-ui', 'v2');
    // Pre-cutover users had `macrolog.ui=v1` written by the old
    // applyUiV2Flag block; harmless dead state but cleaner to evict.
    try { localStorage.removeItem('macrolog.ui'); } catch { /* private mode */ }

    // Browser back/forward must update route + historyDay signals so the
    // template re-renders without a full page reload. The constructor
    // already seeded both via detectRoute()/detectHistoryDay(); this
    // listener catches subsequent pushState/back transitions.
    window.addEventListener('popstate', () => {
      if (this.historyPushDepth > 0) this.historyPushDepth--;
      this.applyLocation();
    });

    // One pageview per app boot. The SPA is a single-URL experience from
    // Plausible's perspective — tab switches don't navigate — so this
    // gives the dashboard a traffic denominator for the conversion-rate
    // ratio against custom events like paywall_click / trial_started.
    this.analytics.pageview();

    // Capture ?ref=<uid> if the user landed via a friend's share link.
    // Held in localStorage; the next profile-create writes it onto the
    // new user's `referredBy` field. See utils/referral.ts.
    captureReferrerFromUrl();

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

    // Upsell cards deep inside child components call `UpsellService.openSubscribe()`
    // to request the Subscribe card; we respond by opening the settings sheet and
    // deep-linking to the #settings-subscription anchor. Counter (not boolean)
    // so repeat clicks re-trigger without an intermediate reset.
    let lastOpenCount = 0;
    effect(() => {
      const n = this.upsell.requestOpenCount();
      if (n === lastOpenCount) return;
      lastOpenCount = n;
      this.showSettings.set(true);
      // Settings sheet is wrapped in `@defer`, so on the first open the
      // chunk hasn't loaded yet and the anchor element won't exist on the
      // next frame. Poll with bounded retries (every 50ms, up to 2s)
      // until the element appears, then scroll. Gives up silently on
      // timeout rather than throwing — a failed scroll is not worth
      // interrupting the user's upgrade intent.
      const start = Date.now();
      const tryScroll = (): void => {
        const el = document.getElementById('settings-subscription');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        if (Date.now() - start >= 2000) return;
        setTimeout(tryScroll, 50);
      };
      tryScroll();
    });

    // Track system preference so 'auto' responds live.
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        if (this.themeChoice() === 'auto') this.applyThemeChoice('auto');
      });

    // Online/offline tracking.
    window.addEventListener('online', () => this.offline.set(false));
    window.addEventListener('offline', () => this.offline.set(true));

    // Service-worker update detection. Pattern follows the official
    // Angular guidance:
    //   1. Subscribe to versionUpdates → on VERSION_READY, latch
    //      pendingUpdate AND surface the dialog.
    //   2. Subscribe to unrecoverable → cache state is corrupt, only
    //      escape is a hard reload.
    //   3. Run the first checkForUpdate() AFTER ApplicationRef.isStable
    //      emits true (avoids racing hydration; without this the first
    //      check can silently no-op — angular/angular#55975, #44044),
    //      then poll every 60s while foregrounded.
    //   4. On visibilitychange → re-check AND re-surface a previously
    //      dismissed prompt (versionUpdates only fires VERSION_READY
    //      once per ship, so dismissing once would otherwise mute the
    //      nag until the next deploy).
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          this.pendingUpdate.set(true);
          this.updateReady.set(true);
        });

      this.swUpdate.unrecoverable.subscribe((evt) => {
        console.error('SW unrecoverable:', evt.reason);
        document.location.reload();
      });

      const doCheck = () => this.swUpdate.checkForUpdate().catch((err) => console.error(err));
      const stable$ = this.appRef.isStable.pipe(first((s) => s));
      concat(stable$, interval(60 * 1000)).subscribe(() => {
        if (document.visibilityState === 'visible') doCheck();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        doCheck();
        if (this.pendingUpdate()) this.updateReady.set(true);
        this.checkReminder();
      });
    }

    // Per-route document.title. /changelog and /status already set their
    // own title in-component; everything else inherits the static base
    // title from index.html, which is misleading for SEO + screen-reader
    // announcements. Drive from route() so SPA navigations (when added)
    // stay in sync.
    effect(() => {
      const r = this.route();
      const key =
        r === 'privacy' ? 'privacy.pageTitle' :
        r === 'terms' ? 'terms.pageTitle' :
        r === 'notFound' ? 'notFound.pageTitle' :
        r === 'changelog' ? 'changelog.pageTitle' :
        r === 'status' ? 'status.pageTitle' :
        null;
      this.translation.setTitleKey(key);
      // /admin: static title when we're actually rendering the panel.
      // Mobile viewports fall through to the regular app, so they get
      // the default Macro Log title instead of "Admin".
      if (r === 'admin' && this.isDesktop()) document.title = 'Admin — Macro Log';
    });

    // Deep-link: /app?intent=pro (from landing Pro CTA) opens the
    // Subscribe card as soon as the user is signed in + profile
    // completed. Consumed once per boot so the query persisting in
    // history doesn't keep re-triggering on tab changes. Fires through
    // the upsell counter so it dedupes with the contextual upsell path.
    let intentConsumed = false;
    effect(() => {
      if (intentConsumed) return;
      if (!this.auth.isSignedIn() || !this.firebase.profileCompleted()) return;
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('intent') !== 'pro') return;
      intentConsumed = true;
      this.upsell.openSubscribe('landing_pro_cta');
      // Strip the query so a refresh doesn't re-open Subscribe + a
      // stray `?intent=pro` doesn't leak into shared URLs.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('intent');
        window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
      } catch { /* non-critical */ }
    });

    // Deep-link: /app?action=add (PWA manifest "Log food" shortcut) opens
    // the entry sheet once signed in. One-shot + query strip, mirroring the
    // intent=pro path so a lingering query can't re-trigger on tab changes.
    let addActionConsumed = false;
    effect(() => {
      if (addActionConsumed) return;
      if (!this.auth.isSignedIn() || !this.firebase.profileCompleted()) return;
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('action') !== 'add') return;
      addActionConsumed = true;
      this.entryForm.startAdd();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('action');
        window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
      } catch { /* non-critical */ }
    });

    // Auto-dismiss reminder when user logs an entry.
    effect(() => {
      if (this.store.hasLoggedToday()) this.showReminder.set(false);
    });

    // FCM token refresh on boot. Tokens rotate (browser data clear,
    // server-side stale-token cleanup, device wipe) so the saved token
    // silently goes dead without this. Only fires once per signed-in
    // boot; settings-sheet enablePush() still owns the first-time flow.
    let fcmRefreshed = false;
    effect(() => {
      if (fcmRefreshed) return;
      if (!this.auth.isSignedIn() || !this.firebase.profileCompleted()) return;
      fcmRefreshed = true;
      void this.pushService.refreshTokenIfGranted().then((token) => {
        if (!token) return;
        const current = this.firebase.profile()?.fcmToken;
        if (current === token) return; // unchanged — skip the write
        void this.firebase.saveFcmToken(token);
      });
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
    finally {
      this.pendingUpdate.set(false);
      document.location.reload();
    }
  }

  /** Plain reload — exposed for the profile-load error fallback so the
   *  user can retry without digging into browser chrome. Kept separate
   *  from `reloadForUpdate` because there's no SwUpdate dance to do. */
  protected reloadApp(): void {
    document.location.reload();
  }
}
