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
    <main class="min-h-screen px-5 sm:px-8 lg:px-12 py-8 sm:py-12">
      <div class="max-w-[560px] lg:max-w-[1100px] mx-auto">

        <!-- SwUpdate dialog (fixed overlay) -->
        @if (updateReady()) {
          <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-ink/40 backdrop-blur-sm ink-in"
            (click)="dismissUpdate()">
            <div class="w-full max-w-sm specimen px-6 py-5 bg-paper shadow-xl slide-down"
              (click)="$event.stopPropagation()">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <div class="flex items-center gap-3 mb-3">
                <span class="stamp-mark" style="transform: rotate(0deg)">new</span>
                <span class="font-display text-lg text-ink">Update Available</span>
              </div>
              <p class="font-sans text-sm text-graphite leading-relaxed mb-4">
                A new version of Macro Log is ready. Reload to get the latest features and fixes.
              </p>
              <div class="flex gap-2">
                <button type="button" (click)="reloadForUpdate()" class="stamp-btn flex-1">reload now</button>
                <button type="button" (click)="dismissUpdate()" class="tag-btn">later</button>
              </div>
            </div>
          </div>
        }

        <!-- Offline indicator -->
        @if (offline()) {
          <div class="mb-4 ink-in flex items-center gap-2">
            <span class="stamp-mark" style="transform: rotate(0deg);">offline</span>
            <span class="caption text-xs">entries will queue locally and sync when reconnected.</span>
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
              <span class="caption text-xs">you haven't logged today yet.</span>
            </div>
            <button type="button" (click)="dismissReminder()" class="tag-btn text-[11px]">dismiss</button>
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
            <!-- Responsive layout: single column on mobile, two columns on desktop -->
            <div class="lg:grid lg:grid-cols-[1fr_1.15fr] lg:gap-10 lg:items-start">
              <!-- Left column: Daily ledger (primary interaction) -->
              <div class="ink-in delay-3 lg:sticky lg:top-8">
                <app-daily-ledger />
              </div>
              <!-- Right column: Stats, measurements, AI coach -->
              <div class="space-y-12 mt-12 lg:mt-0">
                <div class="ink-in delay-4">
                  <app-measurements />
                </div>
                <div class="ink-in delay-6">
                  <app-dashboard />
                </div>
                <div class="ink-in delay-6">
                  <app-consultation />
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Footer -->
        <footer class="mt-16 ink-in delay-6">
          <div class="rule"><span>fin</span></div>
          <div class="mt-6 flex items-center justify-between text-xs tracking-[0.18em] uppercase text-graphite font-mono">
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
                &middot;
                <span class="text-graphite">remind at</span>
                <select
                  [value]="REMINDER_HOUR"
                  (change)="setReminderHour(+$any($event.target).value)"
                  class="bg-transparent text-ink font-sans text-xs border-b border-rule cursor-pointer">
                  @for (h of reminderHours; track h) {
                    <option [value]="h" [selected]="h === REMINDER_HOUR">{{ formatHour(h) }}</option>
                  }
                </select>
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
                  <div class="font-mono text-xs text-ink bg-paper-deep px-2 py-1.5 break-all select-all">
                    {{ key }}
                  </div>
                  <p class="caption text-xs mt-2">
                    endpoint: <span class="font-mono text-ink not-italic text-[11px]">{{ webhookUrl }}</span>
                  </p>
                  <div class="mt-2 flex gap-2">
                    <button type="button" (click)="copyWebhookKey()" class="tag-btn text-[11px]">copy key</button>
                    <button type="button" (click)="revokeWebhookKey()" class="tag-btn text-[11px] text-blood border-blood/40">revoke</button>
                  </div>
                } @else {
                  <p class="caption text-xs mb-2">
                    generate a key to log entries from apple shortcuts or any http client.
                  </p>
                  <button type="button" (click)="generateWebhookKey()" class="tag-btn text-[11px]">generate api key</button>
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
  protected readonly reminderHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly editingProfile = signal(false);
  protected readonly updateReady = signal(false);
  protected readonly offline = signal(!navigator.onLine);
  protected readonly darkMode = signal(false);
  protected readonly showWebhook = signal(false);
  protected readonly showReminder = signal(false);
  protected readonly webhookUrl = 'https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/logWebhook';
  protected get REMINDER_HOUR(): number {
    return (this.firebase.profile() as any)?.reminderHour ?? 20;
  }

  protected readonly todayLabel = computed(() => {
    const d = new Date();
    const iso = localDateKey(d).replace(/-/g, '.');
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

  protected formatHour(h: number): string {
    if (h === 0) return '12 AM';
    if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  }

  protected async setReminderHour(hour: number): Promise<void> {
    await this.firebase.saveReminderHour(hour);
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

  protected dismissUpdate(): void {
    this.updateReady.set(false);
  }

  protected async reloadForUpdate(): Promise<void> {
    try { await this.swUpdate.activateUpdate(); }
    finally { document.location.reload(); }
  }
}
