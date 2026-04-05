import { ChangeDetectionStrategy, Component, OnInit, inject, signal, viewChild } from '@angular/core';
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
    <main class="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 sm:py-10">
      <div class="max-w-md mx-auto space-y-6">
        <header class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-slate-100">Fitness Tracker</h1>
            <p class="text-xs text-slate-500 mt-1">Rolling 14-day TDEE, adjusted daily.</p>
          </div>
          @if (auth.isSignedIn()) {
            <button
              type="button"
              (click)="signOut()"
              class="text-[11px] text-slate-400 hover:text-red-400 transition px-2 py-1 rounded border border-slate-800 hover:border-red-900"
              title="Sign out"
            >
              Sign out
            </button>
          }
        </header>

        @if (!auth.ready()) {
          <div class="rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-8 text-center text-xs text-slate-500">
            Loading…
          </div>
        } @else if (auth.isSignedIn()) {
          <app-dashboard />
          <app-daily-ledger (logSaved)="onLogSaved()" />
          <app-context-bridge />
        } @else {
          <app-sign-in />
        }

        <footer class="text-center text-[10px] text-slate-600 pt-4">
          Client-side only · Firebase · PWA
          @if (auth.user(); as u) {
            <span class="block mt-1">Signed in as {{ u.email }}</span>
          }
        </footer>
      </div>
    </main>
  `,
})
export class App implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly dashboard = viewChild(DashboardComponent);

  async ngOnInit(): Promise<void> {
    // If this load is the result of clicking the magic link, finish sign-in.
    try {
      await this.auth.completeSignInFromUrl();
    } catch (err) {
      console.error('Email-link sign-in failed:', err);
    }
  }

  protected onLogSaved(): void {
    this.dashboard()?.refresh();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
