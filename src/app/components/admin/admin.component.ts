import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { NgTemplateOutlet } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { AdminService } from '../../services/admin.service';
import { AdminDataService } from './admin-data.service';
import { ADMIN_SECTIONS, AdminShellState } from './admin-shell.state';
import { AdminOverviewComponent } from './admin-overview.component';
import { AdminUsersComponent } from './admin-users.component';
import { AdminActivityComponent, AdminAccessComponent, AdminAuditComponent, AdminExportsComponent, AdminFeedbackComponent } from './admin-sections.component';
import { AdminCostComponent } from './admin-cost.component';
import { AdminPaletteComponent } from './admin-palette.component';
import { applyThemeChoice, currentEffectiveTheme, readStoredTheme, writeStoredTheme } from '../../utils/theme';
import { adminPreviewEnabled, seedPreview } from './admin-preview';

const ICONS: Record<string, string> = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  feedback: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9z"/></svg>',
  exports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  access: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
};

/**
 * The admin console shell (ADR-0036 decision 2/3): sidebar, top bar with the
 * command palette, section outlet, toasts. Renders only when app.ts has
 * already established a signed-in session; the claim check below decides
 * between the console and a one-line refusal.
 *
 * Dark leads, as it does in the app (ADR-0014): the first visit forces the
 * dark palette unless the browser already holds an explicit theme choice.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [NgTemplateOutlet, AdminOverviewComponent, AdminUsersComponent, AdminActivityComponent, AdminFeedbackComponent, AdminAuditComponent, AdminCostComponent, AdminAccessComponent, AdminExportsComponent, AdminPaletteComponent],
  // Styles are global (angular.json `styles`) — admin.css is shared by every section.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preview) {
      <ng-container *ngTemplateOutlet="console" />
    } @else if (!admin.ready()) {
      <div class="adm-empty" style="padding: 80px 0;">Resolving admin claim…</div>
    } @else if (!admin.isAdmin()) {
      @if (admin.canBootstrap()) {
        <div class="adm-card" style="max-width: 520px; margin: 60px auto;">
          <h2 class="adm-h2">Bootstrap admin</h2>
          <p class="adm-soft" style="font-size:13px;">No admin is configured. You are on the seed list; this mints the <span class="adm-mono">admin</span> claim once and then disables itself.</p>
          <div class="adm-actions" style="margin-top:12px;">
            <button type="button" class="adm-btn primary" (click)="bootstrap()" [disabled]="busy()">{{ busy() ? 'Working…' : 'Bootstrap' }}</button>
            <button type="button" class="adm-btn" (click)="admin.refreshAdminStatus()">Re-check claim</button>
          </div>
        </div>
      } @else {
        <!-- Signed in, not the admin. Say nothing a stranger could act on. -->
        <div class="adm-empty" style="padding: 80px 0;">Not an admin.</div>
      }
    } @else {
      <ng-container *ngTemplateOutlet="console" />
    }

    <ng-template #console>
      <div class="admin-root" [class.collapsed]="collapsed()">
        <aside class="adm-side">
          <a class="adm-brand" href="/">
            <span class="adm-brand-mark"></span>
            <span><div class="adm-brand-name">Ignia</div><div class="adm-brand-sub">console</div></span>
          </a>
          <nav class="adm-nav">
            @for (g of groups; track g) {
              <div class="adm-nav-group">{{ g }}</div>
              @for (s of sectionsIn(g); track s.id) {
                <button type="button" class="adm-nav-item" [class.active]="shell.section() === s.id" (click)="shell.go(s.id)" [title]="s.hint">
                  <span class="adm-nav-icon" [innerHTML]="icon(s.id)"></span>
                  <span class="adm-nav-label">{{ s.label }}</span>
                  @if (s.id === 'feedback' && data.unreadFeedback() > 0) { <span class="adm-nav-badge">{{ data.unreadFeedback() }}</span> }
                  @if (s.id === 'overview' && attention() > 0) { <span class="adm-nav-badge" style="background: var(--adm-warn); color:#1c1915;">{{ attention() }}</span> }
                </button>
              }
            }
          </nav>
          <div class="adm-side-foot">
            <button type="button" class="adm-nav-item" (click)="collapsed.set(!collapsed())" title="Collapse sidebar">
              <span class="adm-nav-icon">{{ collapsed() ? '»' : '«' }}</span><span class="adm-nav-label">Collapse</span>
            </button>
            <span class="adm-mono" style="padding: 0 10px;">{{ release() }}</span>
          </div>
        </aside>

        <header class="adm-top">
          <span class="adm-top-crumb">Admin /</span>
          <span class="adm-top-title">{{ current().label }}</span>
          <button type="button" class="adm-search" (click)="shell.paletteOpen.set(true)">
            <span>Search users, jump anywhere…</span><kbd>⌘K</kbd>
          </button>
          <button type="button" class="adm-iconbtn" (click)="toggleTheme()" [title]="'Switch to ' + (dark() ? 'light' : 'dark')">
            @if (dark()) { <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg> }
            @else { <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg> }
          </button>
          <span class="adm-avatar" [title]="auth.user()?.email ?? ''">{{ initials() }}</span>
          <button type="button" class="adm-btn sm" (click)="signOut()">Sign out</button>
        </header>

        <main class="adm-main">
          @if (data.error()) {
            <div class="adm-toast error" style="position:static; margin-bottom:14px;">{{ data.error() }} <button type="button" class="adm-btn sm ghost" style="color:#fff" (click)="data.error.set('')">dismiss</button></div>
          }
          @switch (shell.section()) {
            @case ('overview') { <adm-overview /> }
            @case ('users') { <adm-users /> }
            @case ('activity') { <adm-activity /> }
            @case ('feedback') { <adm-feedback /> }
            @case ('audit') { <adm-audit /> }
            @case ('ai') { <adm-cost /> }
            @case ('access') { <adm-access /> }
            @case ('exports') { <adm-exports /> }
          }
        </main>

        <adm-palette />
        <div class="adm-toasts" aria-live="polite">
          @for (t of shell.toasts(); track t.id) { <div class="adm-toast" [class]="'adm-toast ' + t.kind">{{ t.text }}</div> }
        </div>
      </div>
    </ng-template>
  `,
})
export class AdminComponent {
  readonly auth = inject(AuthService);
  readonly admin = inject(AdminService);
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  private readonly sanitizer = inject(DomSanitizer);
  // Static, hand-written SVG strings — trusted so Angular's sanitizer keeps the <svg>.
  private readonly icons = new Map<string, SafeHtml>(Object.entries(ICONS).map(([k, v]) => [k, this.sanitizer.bypassSecurityTrustHtml(v)]));

  /** Dev-only fixture mode — see admin-preview.ts. */
  readonly preview = adminPreviewEnabled();
  readonly busy = signal(false);
  readonly collapsed = signal(localStorage.getItem('ignia.admin.collapsed') === '1');
  readonly dark = signal(currentEffectiveTheme() === 'dark');
  readonly groups = ['Monitor', 'Operate', 'Govern'] as const;

  readonly current = computed(() => ADMIN_SECTIONS.find((s) => s.id === this.shell.section()) ?? ADMIN_SECTIONS[0]);
  readonly attention = computed(() => this.data.insights().filter((i) => i.level === 'bad').length);
  readonly release = computed(() => String((globalThis as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev').slice(0, 8));
  readonly initials = computed(() => (this.auth.user()?.email ?? '?').slice(0, 2).toUpperCase());

  constructor() {
    if (this.preview) seedPreview(this.data);
    // Dark leads (ADR-0014). Only an explicit stored choice overrides it.
    if (readStoredTheme() === 'auto') {
      this.dark.set(applyThemeChoice('dark') === 'dark');
    }
    effect(() => {
      try { localStorage.setItem('ignia.admin.collapsed', this.collapsed() ? '1' : '0'); } catch { /* private mode */ }
    });
  }

  sectionsIn(group: string) { return ADMIN_SECTIONS.filter((s) => s.group === group); }
  icon(id: string): SafeHtml | '' { return this.icons.get(id) ?? ''; }

  toggleTheme(): void {
    const next = this.dark() ? 'light' : 'dark';
    writeStoredTheme(next);
    this.dark.set(applyThemeChoice(next) === 'dark');
  }

  async bootstrap(): Promise<void> {
    this.busy.set(true);
    try {
      await this.admin.bootstrap();
      await this.admin.refreshAdminStatus();
      this.shell.toast('Admin bootstrapped', 'ok');
    } catch (err) {
      this.shell.toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { this.busy.set(false); }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    window.location.assign('/');
  }
}
