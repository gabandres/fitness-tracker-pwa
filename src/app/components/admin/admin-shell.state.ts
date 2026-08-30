import { Injectable, signal } from '@angular/core';

export type AdminSection = 'overview' | 'users' | 'activity' | 'feedback' | 'audit' | 'ai' | 'access' | 'exports';

export interface AdminSectionDef {
  readonly id: AdminSection;
  readonly label: string;
  readonly group: 'Monitor' | 'Operate' | 'Govern';
  readonly hint: string;
}

export const ADMIN_SECTIONS: readonly AdminSectionDef[] = [
  { id: 'overview', label: 'Overview', group: 'Monitor', hint: 'Product health, insights, system status' },
  { id: 'activity', label: 'Activity', group: 'Monitor', hint: 'Latest sign-ups and entries' },
  { id: 'feedback', label: 'Feedback', group: 'Monitor', hint: 'In-app reports from the mobile composer' },
  { id: 'users', label: 'Users', group: 'Operate', hint: 'Search, inspect, suspend, override plan' },
  { id: 'ai', label: 'Cost & AI', group: 'Operate', hint: 'What the app costs: modelled, billed, fixed — plus the AI guards' },
  { id: 'exports', label: 'Exports', group: 'Operate', hint: 'CSV dumps' },
  { id: 'access', label: 'Access', group: 'Govern', hint: 'Who is admin, tiers, what each can do' },
  { id: 'audit', label: 'Audit log', group: 'Govern', hint: 'Every admin action, append-only' },
];

export interface Toast { readonly id: number; readonly text: string; readonly kind: 'ok' | 'error' | 'info'; }

/**
 * Cross-component UI state for the console: which section is open, which
 * user is in the drawer, the toast stack and the command palette. Kept out
 * of AdminDataService so data loading and chrome never share a file.
 */
@Injectable({ providedIn: 'root' })
export class AdminShellState {
  readonly section = signal<AdminSection>(AdminShellState.readInitialSection());
  readonly selectedUid = signal<string | null>(null);
  readonly paletteOpen = signal(false);
  readonly toasts = signal<Toast[]>([]);
  private nextToast = 1;

  private static readInitialSection(): AdminSection {
    try {
      const q = new URLSearchParams(window.location.search).get('tab');
      // `feedback-notify.ts` links to /admin?tab=feedback; honour that.
      if (q && ADMIN_SECTIONS.some((s) => s.id === q)) return q as AdminSection;
    } catch { /* no window */ }
    return 'overview';
  }

  go(section: AdminSection): void {
    this.section.set(section);
    try {
      const url = new URL(window.location.href);
      if (section === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', section);
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    } catch { /* non-critical */ }
  }

  openUser(uid: string): void {
    this.selectedUid.set(uid);
  }

  toast(text: string, kind: Toast['kind'] = 'info'): void {
    const id = this.nextToast++;
    this.toasts.update((t) => [...t, { id, text, kind }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }
}
