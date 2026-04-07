import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DailyLedgerComponent } from './components/daily-ledger/daily-ledger.component';
import { ConsultationComponent } from './components/consultation/consultation.component';
import { SignInComponent } from './components/sign-in/sign-in.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { FastingComponent } from './components/fasting/fasting.component';
import { MeasurementsComponent } from './components/measurements/measurements.component';
import { AuthService } from './services/auth.service';
import { FirebaseService } from './services/firebase.service';
import { FitnessStore } from './services/fitness-store.service';
import { localDateKey } from './utils/date';
import { PushNotificationService } from './services/push-notification.service';

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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen px-5 sm:px-8 py-8 sm:py-12">
      <div class="max-w-[560px] mx-auto">

        <!-- SwUpdate banner -->
        @if (updateReady()) {
          <div class="mb-6 ink-in specimen px-4 py-3 flex items-center justify-between gap-3 bg-paper-deep">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-3 min-w-0">
              <span class="stamp-mark shrink-0">new</span>
              <span class="caption text-[11px] truncate">a new version is available.</span>
            </div>
            <button type="button" (click)="reloadForUpdate()" class="tag-btn shrink-0">reload</button>
          </div>
        }

        <!-- Offline indicator -->
        @if (offline()) {
          <div class="mb-4 ink-in flex items-center gap-2">
            <span class="stamp-mark" style="transform: rotate(0deg);">offline</span>
            <span class="caption text-[11px]">entries will queue locally and sync when reconnected.</span>
          </div>
        }

        <!-- Daily reminder -->
        @if (showReminder()) {
          <div class="mb-4 ink-in specimen px-4 py-2.5 flex items-center justify-between gap-3"
            style="border-color: var(--color-gold)">
            <span class="crop-bl" style="border-color: var(--color-gold)"></span>
            <span class="crop-br" style="border-color: var(--color-gold)"></span>
            <div class="flex items-center gap-2">
              <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-gold); color: var(--color-gold)">reminder</span>
              <span class="caption text-[11px]">you haven't logged today yet.</span>
            </div>
            <button type="button" (click)="dismissReminder()" class="tag-btn text-[9px]">dismiss</button>
          </div>
        }

        <!-- Masthead -->
        <header class="ink-in delay-1 flex items-start justify-between gap-4">
          <div>
            <div class="flex items-baseline gap-2">
              <span class="monogram">M·L</span>
              <span class="caption">calibration log no. 001</span>
            </div>
            <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight mt-1 text-ink">
              Macro<br/><em class="text-blood">Log</em>
            </h1>
          </div>
          <div class="text-right shrink-0 pt-2">
            <div class="data-label">{{ todayLabel() }}</div>
            <div class="flex items-center justify-end gap-2 mt-1">
              <button type="button" (click)="toggleTheme()" class="tag-btn" title="Toggle dark/light mode">
                {{ darkMode() ? '☀' : '☾' }}
              </button>
              @if (auth.isSignedIn()) {
                <button type="button" (click)="signOut()" class="tag-btn" title="Sign out">out</button>
              }
            </div>
          </div>
        </header>

        <div class="ruler-edge mt-5 ink-in delay-2">
          @for (_ of ticks; track $index) { <span></span> }
        </div>

        <p class="caption mt-3 ink-in delay-2">
          a rolling fourteen-day record of weight, intake, and expenditure.
        </p>

        <!-- Main content gates: auth → profile → app -->
        <div class="mt-10 space-y-12">
          @if (!auth.ready()) {
            <div class="specimen p-10 text-center">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <p class="caption">loading field notes&hellip;</p>
            </div>
          } @else if (!auth.isSignedIn()) {
            <div class="ink-in delay-3">
              <app-sign-in />
            </div>
          } @else if (!firebase.profile()) {
            <div class="specimen p-10 text-center">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <p class="caption">opening your file&hellip;</p>
            </div>
          } @else if (!firebase.profileCompleted() || editingProfile()) {
            <div class="ink-in delay-3">
              <app-onboarding
                [editMode]="editingProfile()"
                (saved)="onProfileSaved()"
                (cancelled)="editingProfile.set(false)"
              />
            </div>
          } @else {
            <!-- Log-first layout -->
            <div class="ink-in delay-3">
              <app-daily-ledger />
            </div>
            <!-- Fasting chronometer removed per user preference -->
            <div class="ink-in delay-4">
              <app-measurements />
            </div>
            <div class="ink-in delay-6">
              <app-dashboard />
            </div>
            <div class="ink-in delay-6">
              <app-consultation />
            </div>
          }
        </div>

        <!-- Footer -->
        <footer class="mt-16 ink-in delay-6">
          <div class="rule"><span>fin</span></div>
          <div class="mt-6 flex items-center justify-between text-[10px] tracking-[0.18em] uppercase text-graphite font-mono">
            <span>specimen · personal use</span>
            <span class="stamp-mark">confidential</span>
          </div>
          @if (auth.user(); as u) {
            <p class="caption mt-4 text-center">
              logged in as <span class="text-ink">{{ u.email }}</span>
              @if (firebase.profileCompleted() && !editingProfile()) {
                &middot;
                <button type="button" (click)="editingProfile.set(true)" class="underline decoration-dotted hover:text-blood">
                  edit profile
                </button>
                &middot;
                <button type="button" (click)="store.toggleTravelMode()" class="underline decoration-dotted hover:text-blood"
                  [style.color]="store.travelMode() ? 'var(--color-gold)' : ''">
                  {{ store.travelMode() ? 'exit travel mode' : 'travel mode' }}
                </button>
                &middot;
                <button type="button" (click)="showWebhook.set(!showWebhook())" class="underline decoration-dotted hover:text-blood">
                  webhook
                </button>
                &middot;
                @if (pushService.permission() === 'granted') {
                  <span class="text-olive">push on</span>
                } @else if (pushService.permission() !== 'unsupported') {
                  <button type="button" (click)="enablePush()" class="underline decoration-dotted hover:text-blood">
                    enable push
                  </button>
                }
              }
            </p>

            <!-- Webhook settings (collapsible) -->
            @if (showWebhook()) {
              <div class="mt-4 specimen px-4 py-3 slide-down">
                <span class="crop-bl"></span><span class="crop-br"></span>
                <div class="flex items-center gap-2 mb-2">
                  <span class="stamp-mark" style="transform: rotate(0deg)">api</span>
                  <span class="data-label">apple shortcuts webhook</span>
                </div>
                @if (store.webhookApiKey(); as key) {
                  <div class="font-mono text-[11px] text-ink bg-paper-deep px-2 py-1.5 break-all select-all">
                    {{ key }}
                  </div>
                  <p class="caption text-[10px] mt-2">
                    endpoint: <span class="font-mono text-ink not-italic text-[9px]">{{ webhookUrl }}</span>
                  </p>
                  <div class="mt-2 flex gap-2">
                    <button type="button" (click)="copyWebhookKey()" class="tag-btn text-[9px]">copy key</button>
                    <button type="button" (click)="revokeWebhookKey()" class="tag-btn text-[9px] text-blood border-blood/40">revoke</button>
                  </div>
                } @else {
                  <p class="caption text-[10px] mb-2">
                    generate a key to log entries from apple shortcuts or any http client.
                  </p>
                  <button type="button" (click)="generateWebhookKey()" class="tag-btn text-[9px]">generate api key</button>
                }
              </div>
            }
          }
        </footer>
      </div>
    </main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(FirebaseService);
  protected readonly store = inject(FitnessStore); // triggers lifecycle via constructor effect
  private readonly swUpdate = inject(SwUpdate);
  protected readonly pushService = inject(PushNotificationService);

  protected readonly ticks = Array.from({ length: 45 });
  protected readonly editingProfile = signal(false);
  protected readonly updateReady = signal(false);
  protected readonly offline = signal(!navigator.onLine);
  protected readonly darkMode = signal(false);
  protected readonly showWebhook = signal(false);
  protected readonly showReminder = signal(false);
  protected readonly webhookUrl = 'https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/logWebhook';
  private get REMINDER_HOUR(): number {
    return (this.firebase.profile() as any)?.reminderHour ?? 20;
  }

  protected readonly todayLabel = computed(() => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10).replace(/-/g, '.');
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return `${iso} · ${day}`;
  });

  constructor() {
    // Theme: detect, apply, persist.
    const stored = localStorage.getItem('macrolog.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefersDark;
    this.darkMode.set(isDark);
    this.applyTheme(isDark);

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
    if (now.getHours() < this.REMINDER_HOUR) return;
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

  protected async enablePush(): Promise<void> {
    const token = await this.pushService.requestPermissionAndGetToken();
    if (token) {
      await this.firebase.saveFcmToken(token);
    }
  }

  protected async generateWebhookKey(): Promise<void> {
    await this.store.generateWebhookApiKey();
  }

  protected async revokeWebhookKey(): Promise<void> {
    await this.store.revokeWebhookApiKey();
  }

  protected async copyWebhookKey(): Promise<void> {
    const key = this.store.webhookApiKey();
    if (key) await navigator.clipboard.writeText(key);
  }

  protected onProfileSaved(): void {
    this.editingProfile.set(false);
    // Store will pick up the profile change via its firebase.profile() dependency.
    this.store.refresh();
  }

  protected toggleTheme(): void {
    const next = !this.darkMode();
    this.darkMode.set(next);
    this.applyTheme(next);
    localStorage.setItem('macrolog.theme', next ? 'dark' : 'light');
  }

  private applyTheme(dark: boolean): void {
    const el = document.documentElement;
    if (dark) {
      el.setAttribute('data-theme', 'dark');
    } else {
      el.removeAttribute('data-theme');
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1c1915' : '#f2ead7');
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  protected async reloadForUpdate(): Promise<void> {
    try { await this.swUpdate.activateUpdate(); }
    finally { document.location.reload(); }
  }
}
