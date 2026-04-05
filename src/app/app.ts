import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DailyLedgerComponent } from './components/daily-ledger/daily-ledger.component';
import { ContextBridgeComponent } from './components/context-bridge/context-bridge.component';
import { SignInComponent } from './components/sign-in/sign-in.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DashboardComponent, DailyLedgerComponent, ContextBridgeComponent, SignInComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen px-5 sm:px-8 py-8 sm:py-12">
      <div class="max-w-[560px] mx-auto">
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
              <button
                type="button"
                (click)="signOut()"
                class="tag-btn mt-3"
                title="Sign out"
              >
                sign out
              </button>
            }
          </div>
        </header>

        <!-- Ruler under masthead -->
        <div class="ruler-edge mt-5 ink-in delay-2">
          @for (_ of ticks; track $index) { <span></span> }
        </div>

        <p class="caption mt-3 ink-in delay-2">
          a rolling fourteen-day record of weight, intake, and expenditure.
        </p>

        <div class="mt-10 space-y-12">
          @if (!auth.ready()) {
            <div class="specimen p-10 text-center">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <p class="caption">loading field notes&hellip;</p>
            </div>
          } @else if (auth.isSignedIn()) {
            <div class="ink-in delay-3">
              <app-dashboard />
            </div>
            <div class="ink-in delay-4">
              <app-daily-ledger (logSaved)="onLogSaved()" />
            </div>
            <div class="ink-in delay-5">
              <app-context-bridge />
            </div>
          } @else {
            <div class="ink-in delay-3">
              <app-sign-in />
            </div>
          }
        </div>

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
            </p>
          }
        </footer>
      </div>
    </main>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly dashboard = viewChild(DashboardComponent);

  protected readonly ticks = Array.from({ length: 45 });

  protected readonly todayLabel = computed(() => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10).replace(/-/g, '.');
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return `${iso} · ${day}`;
  });

  protected onLogSaved(): void {
    this.dashboard()?.refresh();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
