import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DailyLedgerComponent } from './components/daily-ledger/daily-ledger.component';
import { ConsultationComponent } from './components/consultation/consultation.component';
import { SignInComponent } from './components/sign-in/sign-in.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { AuthService } from './services/auth.service';
import { FirebaseService } from './services/firebase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    DashboardComponent,
    DailyLedgerComponent,
    ConsultationComponent,
    SignInComponent,
    OnboardingComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen px-5 sm:px-8 py-8 sm:py-12">
      <div class="max-w-[560px] mx-auto">

        <!-- SwUpdate banner: appears when a new bundle has been fetched -->
        @if (updateReady()) {
          <div class="mb-6 ink-in specimen px-4 py-3 flex items-center justify-between gap-3 bg-paper-deep">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-3 min-w-0">
              <span class="stamp-mark shrink-0">new</span>
              <span class="caption text-[11px] truncate">a new version is available.</span>
            </div>
            <button type="button" (click)="reloadForUpdate()" class="tag-btn shrink-0">
              reload
            </button>
          </div>
        }

        <!-- Masthead -->
        <header class="ink-in delay-1 flex items-start justify-between gap-4">
          <div>
            <div class="flex items-baseline gap-2">
              <span class="monogram">F·T</span>
              <span class="caption">calibration log no. 001</span>
            </div>
            <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight mt-1 text-ink">
              Fitness<br/><em class="text-blood">Tracker</em>
            </h1>
          </div>
          <div class="text-right shrink-0 pt-2">
            <div class="data-label">{{ todayLabel() }}</div>
            <div class="font-mono text-[10px] tracking-[0.2em] text-graphite mt-0.5">vol. 01</div>
            @if (auth.isSignedIn()) {
              <button type="button" (click)="signOut()" class="tag-btn mt-3" title="Sign out">
                sign out
              </button>
            }
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
            <!-- Auth settled but profile still fetching -->
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
            <div class="ink-in delay-3">
              <app-dashboard />
            </div>
            <div class="ink-in delay-4">
              <app-daily-ledger (logSaved)="onLogSaved()" />
            </div>
            <div class="ink-in delay-5">
              <app-consultation />
            </div>
          }
        </div>

        <!-- Footer -->
        <footer class="mt-16 ink-in delay-6">
          <div class="rule">
            <span>fin</span>
          </div>
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
              }
            </p>
          }
        </footer>
      </div>
    </main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(FirebaseService);
  private readonly swUpdate = inject(SwUpdate);
  private readonly dashboard = viewChild(DashboardComponent);

  protected readonly ticks = Array.from({ length: 45 });
  protected readonly editingProfile = signal(false);
  protected readonly updateReady = signal(false);

  protected readonly todayLabel = computed(() => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10).replace(/-/g, '.');
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return `${iso} · ${day}`;
  });

  constructor() {
    // Load/refresh profile on every auth transition.
    effect(() => {
      const user = this.auth.user();
      if (user) {
        this.firebase.ensureUserProfile().catch((err) => {
          console.error('ensureUserProfile failed:', err);
        });
      } else {
        this.firebase.clearProfile();
      }
    });

    // Service-worker update detection. Fires once when a new bundle
    // has been downloaded and is ready to activate on reload.
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => this.updateReady.set(true));

      // Also proactively check for updates every 5 minutes while the
      // tab is open, so users on long-lived PWA sessions pick up
      // deploys without a full refresh.
      setInterval(() => {
        this.swUpdate.checkForUpdate().catch((err) => console.error(err));
      }, 5 * 60 * 1000);
    }
  }

  protected onLogSaved(): void {
    this.dashboard()?.refresh();
  }

  protected onProfileSaved(): void {
    this.editingProfile.set(false);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  protected async reloadForUpdate(): Promise<void> {
    try {
      await this.swUpdate.activateUpdate();
    } finally {
      document.location.reload();
    }
  }
}
