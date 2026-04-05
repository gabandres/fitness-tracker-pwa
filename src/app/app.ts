import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { DailyLedgerComponent } from './components/daily-ledger/daily-ledger.component';
import { ContextBridgeComponent } from './components/context-bridge/context-bridge.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DashboardComponent, DailyLedgerComponent, ContextBridgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-slate-950 text-slate-100 px-4 py-6 sm:py-10">
      <div class="max-w-md mx-auto space-y-6">
        <header class="text-center">
          <h1 class="text-2xl font-bold tracking-tight text-slate-100">Fitness Tracker</h1>
          <p class="text-xs text-slate-500 mt-1">Rolling 14-day TDEE, adjusted daily.</p>
        </header>

        <app-dashboard />

        <app-daily-ledger (logSaved)="onLogSaved()" />

        <app-context-bridge />

        <footer class="text-center text-[10px] text-slate-600 pt-4">
          Client-side only · Firebase Firestore · PWA
        </footer>
      </div>
    </main>
  `,
})
export class App {
  private readonly dashboard = viewChild.required(DashboardComponent);

  protected onLogSaved(): void {
    this.dashboard().refresh();
  }
}
