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
import { AdminComponent } from './components/admin/admin.component';
import { NotFoundComponent } from './components/not-found/not-found.component';
import { SettingsSheetComponent } from './components/settings-sheet/settings-sheet.component';
import { MobileTabsComponent, type MobileTab } from './components/mobile-tabs/mobile-tabs.component';
import { MobileFabComponent } from './components/mobile-fab/mobile-fab.component';
import { AuthService } from './services/auth.service';
import { LEDGER_PORT } from './ledger/ports/ledger.port';
import { FitnessStore } from './services/fitness-store.service';
import { SubscriptionService } from './services/subscription.service';
import { ThemeChoice, PRO_THEMES, isProTheme, readStoredTheme, writeStoredTheme } from './utils/theme';
import { localDateKey } from './utils/date';
import { mediaSignal } from './utils/media';
import { UpsellService } from './services/upsell.service';
import { AnalyticsService } from './services/analytics.service';
import { EntryFormManager } from './services/entry-form-manager.service';
import { AdminService } from './services/admin.service';
import { V2DevGallery } from './components/ui/dev-gallery.component';
import { TodayV2Component } from './components/today-v2/today-v2.component';
import { EntrySheetV2Component } from './components/entry-sheet-v2/entry-sheet-v2.component';
import { HistoryV2Component } from './components/history-v2/history-v2.component';
import { DayDetailV2Component } from './components/day-detail-v2/day-detail-v2.component';
import { TrendsV2Component } from './components/trends-v2/trends-v2.component';
import { BodyV2Component } from './components/body-v2/body-v2.component';
import { V2TabBar, type V2Tab } from './components/ui/tab-bar.component';

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
    AdminComponent,
    NotFoundComponent,
    SettingsSheetComponent,
    MobileTabsComponent,
    MobileFabComponent,
    TranslocoDirective,
    V2DevGallery,
    TodayV2Component,
    EntrySheetV2Component,
    HistoryV2Component,
    DayDetailV2Component,
    TrendsV2Component,
    BodyV2Component,
    V2TabBar,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <a href="#main" class="skip-link">{{ t('app.skipToMain') }}</a>
    @if (route() === 'devGallery') {
      <!-- v2 primitives gallery — internal dev surface, not in
           production navigation. Mounted at /dev/components while the
           v2 rebuild is in flight (Weeks 1-6). -->
      <v2-dev-gallery />
    } @else {
    <main id="main" class="min-h-screen px-5 sm:px-8 md:px-12 py-8 sm:py-12 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-12">
      <div class="max-w-[560px] md:max-w-[1100px] mx-auto">

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
            @if (uiV2()) {
              <!-- v2 authed app. Week 2 shipped Today; Week 3 adds
                   History (month grid) + day-detail. Trends + Body stay
                   on v1 until Weeks 4-5. The entry sheet is mounted
                   once and self-gates via the entry-form-manager mode
                   signal — works across all three v2 surfaces. -->
              @switch (route()) {
                @case ('history') {
                  @defer (on immediate) {
                    <app-history-v2
                      (dayTapped)="pushHistoryDay($event)"
                      (closeRequested)="popHistory()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('historyDay') {
                  @defer (on immediate) {
                    <app-day-detail-v2
                      [dateKey]="historyDay()!"
                      (closeRequested)="popHistory()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('trends') {
                  @defer (on immediate) {
                    <app-trends-v2
                      (settingsRequested)="showSettings.set(true)"
                      (historyRequested)="onHistoryRequestedV2()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @case ('body') {
                  @defer (on immediate) {
                    <app-body-v2
                      (settingsRequested)="showSettings.set(true)"
                      (historyRequested)="onHistoryRequestedV2()"
                      (bodyRequested)="onBodyRequestedV2()" />
                  } @placeholder {
                    <div class="py-20 text-center caption">…</div>
                  }
                }
                @default {
                  <app-today-v2
                    (settingsRequested)="showSettings.set(true)"
                    (historyRequested)="onHistoryRequestedV2()"
                    (bodyRequested)="onBodyRequestedV2()" />
                }
              }
              <app-entry-sheet-v2 />
              <v2-tab-bar
                [tabs]="v2Tabs"
                [activeId]="activeV2Tab()"
                (select)="onV2TabSelect($event)" />
            } @else {
            <!-- Responsive layout: single column on mobile (tabbed), two columns on desktop -->
            <div class="md:grid md:grid-cols-[1fr_1.15fr] md:gap-10 md:items-start">
              <!-- Left column: Daily ledger (tab: log) -->
              @if (isDesktop() || activeTab() === 'log') {
                <div class="ink-in delay-3 md:sticky md:top-8"
                  [attr.role]="isDesktop() ? null : 'tabpanel'"
                  [id]="'tabpanel-log'"
                  [attr.aria-labelledby]="isDesktop() ? null : 'tab-log'">
                  <app-daily-ledger />
                </div>
              }
              <!-- Right column: analytics + body tools.
                   Desktop always shows all; mobile splits into tabs. -->
              @if (isDesktop() || activeTab() === 'insights' || activeTab() === 'body') {
                <div class="space-y-12 mt-12 md:mt-0">
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
            <!-- Mobile floating + button. Only renders on mobile; hidden
                 while the entry form is open so it doesn't double the
                 add affordance. -->
            <app-mobile-fab />
            }
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
              <a href="/status" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.status') }}</a>
              &middot;
              <a href="mailto:gabrielandresbermudez&#64;gmail.com" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.contact') }}</a>
            </p>
          } @else {
            <!-- Pre-auth visitors land on the sign-in screen and need
                 privacy/terms access before consenting. Previously the
                 legal links only rendered once auth.user resolved,
                 hiding them exactly when they're load-bearing. -->
            <p class="caption mt-4 text-center text-[11px]">
              <a href="/privacy" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.privacy') }}</a>
              &middot;
              <a href="/terms" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.terms') }}</a>
              &middot;
              <a href="/status" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.status') }}</a>
              &middot;
              <a href="mailto:gabrielandresbermudez&#64;gmail.com" class="underline decoration-dotted hover:text-blood">{{ t('app.footer.contact') }}</a>
            </p>
          }
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
  protected readonly subs = inject(SubscriptionService);
  private readonly upsell = inject(UpsellService);
  private readonly analytics = inject(AnalyticsService);
  private readonly entryForm = inject(EntryFormManager);
  private readonly swUpdate = inject(SwUpdate);
  private readonly translation = inject(TranslationService); // resolves locale on boot, updates <title>
  protected readonly admin = inject(AdminService);

  protected readonly ticks = Array.from({ length: 45 });
  protected readonly editingProfile = signal(false);
  protected readonly showSettings = signal(false);
  // Deep-link support for ?tab=body (used by the day-3 coach push and
  // future share-sheet links). Falls back to 'log' when missing/invalid.
  protected readonly activeTab = signal<MobileTab>(this.readInitialTab());
  // Two-column layout kicks in at 768px (md) so iPad portrait and tablets
  // in general get the full desktop experience instead of mobile-tabs +
  // wasted width. Below 768px we stay single-column with the bottom tab
  // bar. Prior value of 1024px was a Tailwind-default import that never
  // had a design rationale — tablets were getting a phone layout.
  protected readonly isDesktop = mediaSignal('(min-width: 768px)');
  /** URL-path based routing for the two public-static pages. Anything
      else (including '/' and unknown paths) falls through to the
      signal-gated main app. */
  protected readonly route = signal<'privacy' | 'terms' | 'changelog' | 'status' | 'admin' | 'landing' | 'notFound' | 'devGallery' | 'history' | 'historyDay' | 'trends' | 'body' | null>(this.detectRoute());
  /** Selected day for `/history/YYYY-MM-DD`. Null on the grid view. */
  protected readonly historyDay = signal<string | null>(this.detectHistoryDay());
  /** Stack depth of OUR pushState calls. popHistory() falls back to a
   *  pushState('/app') when this is 0 — `history.length > 1` lies for
   *  deep-links (a fresh tab opening /history reports length 1+ already)
   *  and `history.back()` would leave the SPA. */
  private historyPushDepth = 0;
  /** v2 UI flag — true when `?ui=v2` was passed or saved in localStorage.
   *  Set by `applyUiV2Flag()` in the constructor before the first paint
   *  so the template fork hits the correct branch on initial render. */
  protected readonly uiV2 = signal(false);
  protected readonly updateReady = signal(false);
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

  private readInitialTab(): MobileTab {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      if (q === 'log' || q === 'insights' || q === 'body') return q;
    } catch { /* ignore */ }
    return 'log';
  }

  private detectRoute(): 'privacy' | 'terms' | 'changelog' | 'status' | 'admin' | 'landing' | 'notFound' | 'devGallery' | 'history' | 'historyDay' | 'trends' | 'body' | null {
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

  /** Tap handler from the month grid: push /history/<key> and re-sync. */
  protected pushHistoryDay(key: string): void {
    history.pushState({}, '', '/history/' + key);
    this.historyPushDepth++;
    this.applyLocation();
  }

  /** v2 tab-bar definition. Order = visual order. */
  protected readonly v2Tabs: V2Tab[] = [
    { id: 'today', label: 'Today', icon: 'home' },
    { id: 'trends', label: 'Trends', icon: 'trending-up' },
    { id: 'body', label: 'Body', icon: 'user' },
  ];

  /** Maps the current `route()` value back onto a tab id so the tab bar
   *  highlights the correct segment. Calendar routes (history /
   *  historyDay) inherit Today highlight — they're a sub-surface of the
   *  Today tab, not a separate primary section. */
  protected readonly activeV2Tab = computed<string>(() => {
    const r = this.route();
    if (r === 'trends') return 'trends';
    if (r === 'body') return 'body';
    return 'today';
  });

  /** Tab-bar tap handler. No-op when tapping the actual current route —
   *  not the derived tab. The history routes report `today` as their
   *  active tab so the bar lights up correctly, but a Today tap from
   *  inside /history must still navigate to /app. */
  protected onV2TabSelect(id: string): void {
    const r = this.route();
    if (id === 'today' && r !== 'history' && r !== 'historyDay' && r !== 'trends' && r !== 'body') return;
    if (id === 'trends' && r === 'trends') return;
    if (id === 'body' && r === 'body') return;
    if (id === 'today') {
      history.pushState({}, '', '/app');
    } else if (id === 'trends') {
      history.pushState({}, '', '/trends');
    } else if (id === 'body') {
      history.pushState({}, '', '/body');
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

  protected readonly todayLabel = computed(() => {
    const d = new Date();
    const iso = localDateKey(d).replace(/-/g, '.');
    const locale = this.translation.language() === 'es-PR' ? 'es' : 'en-US';
    const day = d.toLocaleDateString(locale, { weekday: 'short' }).toLowerCase();
    return `${iso} · ${day}`;
  });

  constructor() {
    // v2 design-system flag. Active when ?ui=v2 is present OR the user
    // has saved the preference in localStorage, OR when on the internal
    // /dev/components gallery (which is v2-only by definition). Setting
    // [data-ui="v2"] on <html> activates the v2 token scope in
    // styles-v2.css; v1 surfaces remain untouched until Week 6 cutover.
    try {
      const qs = new URLSearchParams(window.location.search);
      const flag = qs.get('ui');
      if (flag === 'v2') localStorage.setItem('macrolog.ui', 'v2');
      if (flag === 'v1') localStorage.removeItem('macrolog.ui');
      const stored = localStorage.getItem('macrolog.ui');
      const onGallery = window.location.pathname.toLowerCase().startsWith('/dev/components');
      if (stored === 'v2' || onGallery) {
        document.documentElement.setAttribute('data-ui', 'v2');
        // The gallery surface is v2-only by definition but should not
        // flip the rest of the app to v2 — it owns its own render path
        // outside the authed-app branch. Only the persisted preference
        // counts toward the global v2 fork.
        if (stored === 'v2') this.uiV2.set(true);
      }
    } catch { /* localStorage unavailable — fail open to v1 */ }

    // Browser back/forward must update route + historyDay signals so the
    // template re-renders without a full page reload. The constructor
    // already seeded both via detectRoute()/detectHistoryDay(); this
    // listener catches subsequent pushState/back transitions. The depth
    // counter decrements regardless of trigger (our `popHistory` or the
    // browser's back button) so it stays accurate.
    window.addEventListener('popstate', () => {
      if (this.historyPushDepth > 0) this.historyPushDepth--;
      this.applyLocation();
    });

    // v2-only routes (history, historyDay, trends, body) need a redirect
    // for v1 users — a deep-linked /trends bookmark would otherwise show
    // v1 chrome with a mismatched URL bar. Send them to /app so the v1
    // template renders normally and the URL matches.
    effect(() => {
      const r = this.route();
      if (
        !this.uiV2() &&
        (r === 'history' || r === 'historyDay' || r === 'trends' || r === 'body')
      ) {
        history.replaceState({}, '', '/app');
        this.applyLocation();
      }
    });

    // One pageview per app boot. The SPA is a single-URL experience from
    // Plausible's perspective — tab switches don't navigate — so this
    // gives the dashboard a traffic denominator for the conversion-rate
    // ratio against custom events like paywall_click / trial_started.
    this.analytics.pageview();

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

    // Dashboard empty-state hero (and future quick-add surfaces) call
    // `EntryFormManager.requestLogFocus()` to switch to the log tab and
    // scroll the ledger into view. Guarded by a counter so repeat clicks
    // re-fire without an intermediate reset.
    let lastLogFocusCount = 0;
    effect(() => {
      const n = this.entryForm.logTabRequestCount();
      if (n === lastLogFocusCount) return;
      lastLogFocusCount = n;
      this.activeTab.set('log');
      requestAnimationFrame(() => {
        document.getElementById('main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
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
