import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { AdminDataService } from './admin-data.service';
import { AdminShellState } from './admin-shell.state';
import { fmtDateTime, relTime } from './admin-format';

// ─── Activity ──────────────────────────────────────────────────────

@Component({
  selector: 'adm-activity',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div><h1 class="adm-h1">Activity</h1><p class="adm-sub">Last 20 sign-ups and last 20 entries, merged by time. Cached 30 s server-side.</p></div>
      <button type="button" class="adm-btn" (click)="data.loadActivity(true)" [disabled]="data.isLoading('activity')">Refresh</button>
    </div>
    <section class="adm-card">
      <ul class="adm-timeline">
        @for (a of data.activity(); track a.timestamp + a.uid) {
          <li>
            <span class="when" [title]="a.timestamp">{{ fmt(a.timestamp) }}</span>
            <span class="what">
              <span class="adm-chip" [class.good]="a.type === 'signup'" [class.muted]="a.type !== 'signup'">{{ a.type }}</span>
              <button type="button" class="adm-btn sm ghost adm-mono" (click)="shell.openUser(a.uid); shell.go('users')">{{ a.email || a.uid.slice(0, 8) }}</button>
              <span class="adm-soft">{{ a.detail || '' }}</span>
              <span class="adm-muted" style="font-size:12px; margin-left:auto;">{{ rel(a.timestamp) }}</span>
            </span>
          </li>
        } @empty { <li><span class="adm-empty">{{ data.isLoading('activity') ? 'Loading…' : 'No activity yet.' }}</span></li> }
      </ul>
    </section>
  `,
})
export class AdminActivityComponent {
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  readonly fmt = fmtDateTime;
  readonly rel = relTime;
  constructor() { void this.data.loadActivity(); }
}

// ─── Feedback ──────────────────────────────────────────────────────

@Component({
  selector: 'adm-feedback',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div><h1 class="adm-h1">Feedback</h1><p class="adm-sub">{{ data.feedback().length }} reports from the mobile composer · {{ data.unreadFeedback() }} unread on this browser. Append-only: nobody, including this panel, can edit or delete them.</p></div>
      <div style="display:flex; gap:8px;">
        <button type="button" class="adm-btn" (click)="markAllSeen()" [disabled]="data.unreadFeedback() === 0">Mark all read</button>
        <button type="button" class="adm-btn" (click)="data.loadFeedback(true)" [disabled]="data.isLoading('feedback')">Refresh</button>
      </div>
    </div>
    <div class="adm-toolbar">
      <div class="adm-seg">
        <button type="button" [class.on]="filter() === 'all'" (click)="filter.set('all')">all</button>
        <button type="button" [class.on]="filter() === 'unread'" (click)="filter.set('unread')">unread</button>
      </div>
      <select class="adm-field adm-select" [ngModel]="category()" (ngModelChange)="category.set($event)">
        <option value="all">any category</option>
        @for (c of categories(); track c) { <option [value]="c">{{ c }}</option> }
      </select>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      @for (f of filtered(); track f.id) {
        <article class="adm-fb" [class.unread]="!data.seenFeedback().has(f.id)" (click)="data.markFeedbackSeen([f.id])">
          <div class="adm-fb-head">
            <span class="adm-chip" [class.accent]="f.category === 'bug'" [class.teal]="f.category === 'idea'" [class.muted]="f.category !== 'bug' && f.category !== 'idea'">{{ f.category }}</span>
            <span class="adm-mono">{{ fmt(f.createdAt) }}</span>
            <span>· {{ f.appVersion }} · {{ f.platform }} · {{ f.locale }}</span>
            <button type="button" class="adm-btn sm ghost adm-mono" style="margin-left:auto;" (click)="$event.stopPropagation(); shell.openUser(f.uid); shell.go('users')">{{ f.uid.slice(0, 10) }} →</button>
          </div>
          <div class="adm-fb-body">{{ f.message }}</div>
        </article>
      } @empty { <div class="adm-card"><div class="adm-empty">{{ data.isLoading('feedback') ? 'Loading…' : 'Nothing here.' }}</div></div> }
    </div>
  `,
})
export class AdminFeedbackComponent {
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  readonly fmt = fmtDateTime;
  readonly filter = signal<'all' | 'unread'>('all');
  readonly category = signal('all');
  readonly categories = computed(() => [...new Set(this.data.feedback().map((f) => f.category))].sort());
  readonly filtered = computed(() => this.data.feedback()
    .filter((f) => this.filter() === 'all' || !this.data.seenFeedback().has(f.id))
    .filter((f) => this.category() === 'all' || f.category === this.category()));
  constructor() { void this.data.loadFeedback(); }
  markAllSeen(): void { this.data.markFeedbackSeen(this.data.feedback().map((f) => f.id)); }
}

// ─── Audit log ─────────────────────────────────────────────────────

const ACTION_TONE: Record<string, string> = {
  user_delete: 'danger', user_suspend: 'danger', user_unsuspend: 'good',
  plan_override: 'good', quota_reset: 'teal', password_reset_link: 'warn',
  impersonation_start: 'warn', impersonation_stop: 'muted', data_export: 'info',
  spend_kill_engaged: 'danger', spend_kill_cleared: 'good', spend_limit_set: 'warn',
  comped_grant: 'teal', comped_revoke: 'muted', cost_ledger_set: 'info', admin_session: 'muted',
};

const AUDITED: ReadonlyArray<[string, string]> = [
  ['admin_session', 'the console was opened'],
  ['plan_override', 'grant / revoke paid'],
  ['user_suspend · user_unsuspend', 'suspend / unsuspend'],
  ['user_delete', 'delete an account'],
  ['quota_reset', "reset a user's AI quota"],
  ['password_reset_link', 'generate a reset link'],
  ['comped_grant · comped_revoke', 'comped list'],
  ['spend_limit_set · spend_kill_engaged · spend_kill_cleared', 'AI ceilings and kill-switch'],
  ['cost_ledger_set', 'fixed-cost ledger'],
  ['data_export', 'CSV export'],
];

@Component({
  selector: 'adm-audit',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div><h1 class="adm-h1">Audit log</h1><p class="adm-sub">{{ data.audit().length }} entr{{ data.audit().length === 1 ? 'y' : 'ies' }} · every mutating admin call and every console session, written server-side. Append-only; no client can write it.</p></div>
      <button type="button" class="adm-btn" (click)="data.loadAudit(true)" [disabled]="data.isLoading('audit')">Refresh</button>
    </div>
    <div class="adm-toolbar">
      <select class="adm-field adm-select" [ngModel]="action()" (ngModelChange)="action.set($event)">
        <option value="all">any action</option>
        @for (a of actions(); track a) { <option [value]="a">{{ a }}</option> }
      </select>
      <input type="search" class="adm-field grow" placeholder="Filter by target email or uid…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
    </div>
    <section class="adm-card">
      <ul class="adm-timeline">
        @for (l of filtered(); track l.id) {
          <li>
            <span class="when">{{ fmt(l.timestamp) }}</span>
            <span class="what">
              <span class="adm-chip" [class]="'adm-chip ' + (tone[l.action] ?? 'muted')">{{ l.action }}</span>
              @if (l.targetEmail || l.targetUid) {
                <button type="button" class="adm-btn sm ghost adm-mono" (click)="open(l.targetUid)">{{ l.targetEmail || l.targetUid }}</button>
              }
              <span class="details">{{ details(l.details) }}</span>
            </span>
          </li>
        } @empty {
          <li style="grid-template-columns:1fr;">
            @if (data.isLoading('audit')) { <span class="adm-empty">Loading…</span> }
            @else if (data.audit().length === 0) {
              <div class="adm-empty" style="text-align:left;">
                <strong style="color:var(--adm-ink);">Nothing has been audited yet.</strong> The log fills as admin actions happen — it is not a mirror of user activity (that is the Activity page). What writes here:
                <ul class="adm-timeline" style="margin-top:10px;">
                  @for (a of audited; track a[0]) { <li style="grid-template-columns:1fr; padding:6px 0;"><span class="adm-mono" style="font-size:12px;">{{ a[0] }}</span><span class="adm-muted" style="font-size:12px;">{{ a[1] }}</span></li> }
                </ul>
              </div>
            } @else { <span class="adm-empty">No entries match the filter.</span> }
          </li>
        }
      </ul>
      @if (data.auditHasMore()) {
        <div style="margin-top:12px;"><button type="button" class="adm-btn sm" (click)="data.loadMoreAudit()" [disabled]="data.isLoading('audit')">Load older entries</button></div>
      }
    </section>
  `,
})
export class AdminAuditComponent {
  readonly audited = AUDITED;
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  readonly fmt = fmtDateTime;
  readonly tone = ACTION_TONE;
  readonly action = signal('all');
  readonly q = signal('');
  readonly actions = computed(() => [...new Set(this.data.audit().map((l) => l.action))].sort());
  readonly filtered = computed(() => {
    const term = this.q().toLowerCase().trim();
    return this.data.audit()
      .filter((l) => this.action() === 'all' || l.action === this.action())
      .filter((l) => !term || (l.targetEmail ?? '').toLowerCase().includes(term) || (l.targetUid ?? '').toLowerCase().includes(term));
  });
  constructor() { void this.data.loadAudit(); }
  details(d: unknown): string { try { return d && typeof d === 'object' ? JSON.stringify(d) : ''; } catch { return ''; } }
  open(uid?: string): void { if (uid) { this.shell.openUser(uid); this.shell.go('users'); } }
}

// ─── Access ────────────────────────────────────────────────────────

@Component({
  selector: 'adm-access',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div><h1 class="adm-h1">Access</h1><p class="adm-sub">Who can do what, and where each rule is enforced. Read from the live session, not from a config screen.</p></div>
    </div>
    <div class="adm-grid adm-grid-main">
      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">The admin</h2><span class="adm-chip accent">exactly one</span></div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="adm-avatar">{{ initials }}</span>
          <div>
            <div class="adm-mono" style="font-weight:600;">{{ auth.user()?.email }}</div>
            <div class="adm-muted" style="font-size:12px;">uid {{ auth.user()?.uid }} · claim <span class="adm-chip" [class.good]="api.isAdmin()" [class.danger]="!api.isAdmin()">{{ api.isAdmin() ? 'admin: true' : 'no claim' }}</span></div>
          </div>
        </div>
        <dl class="adm-kv adm-section">
          <dt>Granted by</dt><dd style="font-family:inherit;">the <span class="adm-mono">admin</span> custom claim on this Firebase user, minted once by <span class="adm-mono">bootstrapAdmin</span></dd>
          <dt>Second admin</dt><dd style="font-family:inherit;"><strong>No path exists.</strong> <span class="adm-mono">setAdminClaims</span> was deleted 2026-08-30. Adding one means editing <span class="adm-mono">SEED_ADMINS</span>, deploying, and re-running bootstrap — a code change on purpose.</dd>
          <dt>Sign-in</dt><dd style="font-family:inherit;">Google only, on this page. No email/password, no sign-up, no other provider on the web.</dd>
          <dt>Enforced in</dt><dd style="font-family:inherit;"><span class="adm-mono">firestore.rules → isAdmin()</span> for reads, <span class="adm-mono">requireAdmin()</span> on every admin callable, and the audit log on every mutation.</dd>
        </dl>
        <div class="adm-section">
          <button type="button" class="adm-btn sm" (click)="refresh()" [disabled]="busy()">Re-check claim</button>
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Comped (friends &amp; family)</h2><span class="adm-chip teal">{{ api.compedEmails().length }}</span></div>
        <p class="adm-soft" style="font-size:12.5px; margin:0 0 10px;">Unlimited AI, no quota. Stored in <span class="adm-mono">config/accessList</span>; matched by email on the server.</p>
        <div style="display:flex; gap:8px;">
          <input type="email" class="adm-field grow" [(ngModel)]="newComped" placeholder="email@example.com" />
          <button type="button" class="adm-btn sm primary" (click)="addComped()" [disabled]="busy() || !newComped.trim()">Add</button>
        </div>
        <ul class="adm-timeline" style="margin-top:10px;">
          @for (e of api.compedEmails(); track e) {
            <li style="grid-template-columns: 1fr auto;">
              <span class="adm-mono" style="font-size:12.5px;">{{ e }}</span>
              <button type="button" class="adm-btn sm ghost" (click)="removeComped(e)" [disabled]="busy()">remove</button>
            </li>
          } @empty { <li><span class="adm-muted" style="font-size:12.5px;">nobody comped</span></li> }
        </ul>
      </section>
    </div>

    <section class="adm-card" style="margin-top:14px;">
      <div class="adm-card-head"><h2 class="adm-h2">Capability matrix</h2><span class="adm-muted" style="font-size:12px;">resolved server-side by <span class="adm-mono">resolveCaller()</span> · admin › comped › paid › free</span></div>
      <div class="adm-table-wrap" style="border:none;">
        <table class="adm-table adm-matrix">
          <thead><tr><th style="cursor:default;">Capability</th><th style="cursor:default;">Free</th><th style="cursor:default;">Paid</th><th style="cursor:default;">Comped</th><th style="cursor:default;">Admin</th></tr></thead>
          <tbody>
            @for (r of matrix; track r.cap) {
              <tr style="cursor:default;">
                <td>{{ r.cap }}<div class="adm-muted" style="font-size:11.5px;">{{ r.where }}</div></td>
                @for (v of r.cells; track $index) { <td>{{ v }}</td> }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="adm-muted" style="font-size:12px; margin:10px 0 0;">“Paid” is a Stripe custom claim or an admin plan override. v1 is free: with <span class="adm-mono">PRO_ENABLED=false</span> the app unlocks every non-cost perk for everyone; only the AI quotas still distinguish tiers, and they are enforced on the server.</p>
    </section>
  `,
})
export class AdminAccessComponent {
  readonly api = inject(AdminService);
  readonly auth = inject(AuthService);
  readonly shell = inject(AdminShellState);
  readonly busy = signal(false);
  newComped = '';
  get initials(): string { return (this.auth.user()?.email ?? '?').slice(0, 2).toUpperCase(); }
  readonly matrix = [
    { cap: 'Log meals, weight, workouts', where: 'firestore.rules · isOwner + email_verified', cells: ['✓', '✓', '✓', '✓'] },
    { cap: 'Photo scan / day', where: 'dailyQuota (photoQuota)', cells: ['3', '30', '∞', '∞'] },
    { cap: 'AI coach calls / day', where: 'dailyQuota (consultationQuota)', cells: ['3', '30', '∞', '∞'] },
    { cap: 'Counts against the spend ceiling', where: 'spendCeiling.record()', cells: ['✓', '✓', '✓', 'recorded, never blocked'] },
    { cap: 'Themes, higher limits, streak-freeze', where: 'isPro() — forced on while PRO_ENABLED=false', cells: ['✓', '✓', '✓', '✓'] },
    { cap: 'Weekly AI report', where: 'FEATURES gate — hidden (cost)', cells: ['—', '—', '—', '—'] },
    { cap: 'Read any user, audit log, config', where: 'firestore.rules · isAdmin()', cells: ['—', '—', '—', '✓'] },
    { cap: 'Suspend, delete, override plan, set ceilings', where: 'admin-ops callables · requireAdmin()', cells: ['—', '—', '—', '✓'] },
  ];
  private async run(label: string, op: () => Promise<unknown>) {
    this.busy.set(true);
    try { await op(); this.shell.toast(label, 'ok'); }
    catch (err) { this.shell.toast(err instanceof Error ? err.message : String(err), 'error'); }
    finally { this.busy.set(false); }
  }
  refresh() { return this.run('Claim re-checked', () => this.api.refreshAdminStatus()); }
  addComped() {
    const email = this.newComped.trim().toLowerCase();
    return this.run(`${email} comped`, async () => { await this.api.setCompedEmail(email, true); this.newComped = ''; });
  }
  removeComped(email: string) { return this.run(`${email} removed from comped`, () => this.api.setCompedEmail(email, false)); }
}

// ─── Exports ───────────────────────────────────────────────────────

@Component({
  selector: 'adm-exports',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head"><div><h1 class="adm-h1">Exports</h1><p class="adm-sub">CSV, generated server-side and written to the audit log. The logs export walks every user and can take up to a minute.</p></div></div>
    <div class="adm-grid adm-grid-3">
      @for (e of choices; track e.type) {
        <button type="button" class="adm-card" style="text-align:left; cursor:pointer;" (click)="download(e.type)" [disabled]="busy()">
          <span class="adm-label">{{ e.type }}</span>
          <div class="adm-h2" style="margin-top:6px;">{{ e.label }}</div>
          <div class="adm-muted" style="font-size:12.5px; margin-top:4px;">{{ e.hint }}</div>
        </button>
      }
    </div>
  `,
})
export class AdminExportsComponent {
  private readonly api = inject(AdminService);
  private readonly shell = inject(AdminShellState);
  readonly busy = signal(false);
  readonly choices = [
    { type: 'users' as const, label: 'Users', hint: 'uid, email, plan, created, last seen' },
    { type: 'logs' as const, label: 'Daily logs', hint: 'every log across all users' },
    { type: 'metrics' as const, label: 'Metrics', hint: 'the cached platform stats' },
  ];
  async download(type: 'users' | 'logs' | 'metrics'): Promise<void> {
    this.busy.set(true);
    try {
      const csv = await this.api.exportData(type);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `ignia-${type}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.shell.toast(`${type}.csv downloaded`, 'ok');
    } catch (err) { this.shell.toast(err instanceof Error ? err.message : String(err), 'error'); }
    finally { this.busy.set(false); }
  }
}
