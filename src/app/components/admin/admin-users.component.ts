import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService, type AdminUserDetails, type AdminUserRow } from '../../services/admin.service';
import { AuthService } from '../../services/auth.service';
import { AdminDataService } from './admin-data.service';
import { AdminShellState } from './admin-shell.state';
import { fmtDate, fmtDateTime, initials, relTime } from './admin-format';
import { adminPreviewEnabled } from './admin-preview';

type SortKey = 'email' | 'createdAt' | 'lastSignInAt' | 'plan';
type PlanFilter = 'all' | 'free' | 'paid' | 'comped' | 'admin';
type FlagFilter = 'all' | 'unverified' | 'disabled' | 'noProfile';

/**
 * The Users workspace: one table, filters that compose, a sortable header,
 * and a drawer with the full record and every action. Actions confirm in
 * place (no browser `confirm()`); the destructive one asks for a typed word.
 */
@Component({
  selector: 'adm-users',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div>
        <h1 class="adm-h1">Users</h1>
        <p class="adm-sub">{{ filtered().length }} of {{ data.users().length }} accounts · {{ counts().paid }} paid · {{ counts().comped }} comped · {{ counts().disabled }} suspended</p>
      </div>
      <button type="button" class="adm-btn" (click)="data.loadUsers(true)" [disabled]="data.isLoading('users')">{{ data.isLoading('users') ? 'Loading…' : 'Reload' }}</button>
    </div>

    <div class="adm-toolbar">
      <input type="search" class="adm-field grow" placeholder="Search email, name or uid…" [ngModel]="q()" (ngModelChange)="q.set($event)" />
      <div class="adm-seg">
        @for (p of planFilters; track p) { <button type="button" [class.on]="plan() === p" (click)="plan.set(p)">{{ p }}</button> }
      </div>
      <select class="adm-field adm-select" [ngModel]="flag()" (ngModelChange)="flag.set($event)">
        <option value="all">any status</option>
        <option value="unverified">unverified</option>
        <option value="disabled">suspended</option>
        <option value="noProfile">no profile</option>
      </select>
      <select class="adm-field adm-select" [ngModel]="provider()" (ngModelChange)="provider.set($event)">
        <option value="all">any provider</option>
        @for (p of providers(); track p) { <option [value]="p">{{ p }}</option> }
      </select>
    </div>

    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead>
          <tr>
            <th (click)="sortBy('email')" [class.sorted]="sort() === 'email'">Account {{ arrow('email') }}</th>
            <th (click)="sortBy('plan')" [class.sorted]="sort() === 'plan'">Tier {{ arrow('plan') }}</th>
            <th>Status</th>
            <th>Providers</th>
            <th (click)="sortBy('createdAt')" [class.sorted]="sort() === 'createdAt'">Joined {{ arrow('createdAt') }}</th>
            <th (click)="sortBy('lastSignInAt')" [class.sorted]="sort() === 'lastSignInAt'">Last sign-in {{ arrow('lastSignInAt') }}</th>
          </tr>
        </thead>
        <tbody>
          @for (u of filtered(); track u.uid) {
            <tr (click)="shell.openUser(u.uid)" [class.selected]="shell.selectedUid() === u.uid">
              <td>
                <div style="display:flex; align-items:center; gap:10px;">
                  <span class="adm-avatar" style="width:26px;height:26px;font-size:10px;background:var(--adm-surface-2);color:var(--adm-ink-soft);">{{ initials(u.email) }}</span>
                  <div>
                    <div class="adm-mono" style="font-size:12.5px;">{{ u.email }}</div>
                    <div class="adm-muted" style="font-size:11.5px;">{{ u.displayName || u.uid.slice(0, 10) }}</div>
                  </div>
                </div>
              </td>
              <td>
                @if (u.admin) { <span class="adm-chip accent">admin</span> }
                @else if (isComped(u)) { <span class="adm-chip teal">comped</span> }
                @else if (u.stripeRole === 'paid') { <span class="adm-chip good">paid</span> }
                @else { <span class="adm-chip muted">free</span> }
              </td>
              <td>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                  @if (u.disabled) { <span class="adm-chip danger">suspended</span> }
                  @if (!u.emailVerified) { <span class="adm-chip warn">unverified</span> }
                  @if (!u.profileCompleted) { <span class="adm-chip muted">no profile</span> }
                  @if (u.emailVerified && u.profileCompleted && !u.disabled) { <span class="adm-chip good">active</span> }
                </div>
              </td>
              <td class="adm-muted" style="font-size:12px;">{{ u.providers.map(shortProvider).join(' · ') || '—' }}</td>
              <td class="adm-mono" style="font-size:12px;">{{ fmtDate(u.createdAt) }}</td>
              <td class="adm-mono" style="font-size:12px;" [title]="fmtDateTime(u.lastSignInAt)">{{ relTime(u.lastSignInAt) }}</td>
            </tr>
          } @empty {
            <tr><td colspan="6"><div class="adm-empty">{{ data.isLoading('users') ? 'Loading accounts…' : 'No accounts match.' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>

    <!-- Drawer -->
    @if (shell.selectedUid(); as uid) {
      <div class="adm-drawer-scrim" (click)="close()"></div>
      <aside class="adm-drawer" role="dialog" aria-label="User details">
        @if (selected(); as u) {
          <div class="adm-drawer-head">
            <div style="display:flex; align-items:center; gap:12px;">
              <span class="adm-avatar">{{ initials(u.email) }}</span>
              <div>
                <div class="adm-mono" style="font-size:14px; font-weight:600;">{{ u.email }}</div>
                <div class="adm-muted" style="font-size:12px;">{{ u.displayName || 'no display name' }}</div>
              </div>
            </div>
            <button type="button" class="adm-iconbtn" (click)="close()" aria-label="Close">✕</button>
          </div>

          <div class="adm-section">
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              @if (u.admin) { <span class="adm-chip accent">admin</span> }
              @if (isComped(u)) { <span class="adm-chip teal">comped</span> }
              @if (u.stripeRole === 'paid') { <span class="adm-chip good">paid override</span> }
              @if (u.disabled) { <span class="adm-chip danger">suspended</span> }
              @if (!u.emailVerified) { <span class="adm-chip warn">unverified</span> }
              @if (!u.profileCompleted) { <span class="adm-chip muted">no profile</span> }
            </div>
          </div>

          <div class="adm-section">
            <span class="adm-label">Account</span>
            <dl class="adm-kv">
              <dt>uid</dt><dd>{{ u.uid }}</dd>
              <dt>Joined</dt><dd>{{ fmtDateTime(u.createdAt) }}</dd>
              <dt>Last sign-in</dt><dd>{{ fmtDateTime(u.lastSignInAt) }} <span class="adm-muted">({{ relTime(u.lastSignInAt) }})</span></dd>
              <dt>Providers</dt><dd>{{ u.providers.join(', ') || '—' }}</dd>
              <dt>Locale</dt><dd>{{ u.preferredLocale || '—' }}</dd>
            </dl>
          </div>

          <div class="adm-section">
            <span class="adm-label">Data</span>
            @if (details(); as d) {
              <dl class="adm-kv">
                <dt>Daily logs</dt><dd>{{ d.counts.dailyLogs }}</dd>
                <dt>Presets</dt><dd>{{ d.counts.presets }}</dd>
                <dt>Measurements</dt><dd>{{ d.counts.measurements }}</dd>
                <dt>Reports</dt><dd>{{ d.counts.reports }}</dd>
                <dt>Goal</dt><dd>{{ profileStr(d.profile, 'goalDirection') }} · target {{ profileStr(d.profile, 'targetWeightLbs') }} lb</dd>
                <dt>Onboarded</dt><dd>{{ profileStr(d.profile, 'onboardingV2CompletedAt') }}</dd>
                <dt>Subscriptions</dt><dd>{{ d.subscriptions.length ? d.subscriptions.map(subLabel).join(', ') : 'none' }}</dd>
              </dl>
            } @else if (detailsError()) {
              <p class="adm-muted" style="font-size:12.5px;">{{ detailsError() }}</p>
            } @else { <p class="adm-muted" style="font-size:12.5px;">loading…</p> }
          </div>

          <div class="adm-section">
            <span class="adm-label">Actions <span class="adm-muted" style="letter-spacing:0; text-transform:none;">— every one is written to the audit log</span></span>
            <div class="adm-actions">
              <button type="button" class="adm-btn sm" (click)="togglePlan(u)" [disabled]="busy()">{{ u.stripeRole === 'paid' ? 'Revoke paid' : 'Grant paid' }}</button>
              <button type="button" class="adm-btn sm" (click)="toggleComped(u)" [disabled]="busy()">{{ isComped(u) ? 'Remove comped' : 'Add comped' }}</button>
              <button type="button" class="adm-btn sm" (click)="resetQuotas(u)" [disabled]="busy()">Reset today's AI quota</button>
              <button type="button" class="adm-btn sm" (click)="passwordLink(u)" [disabled]="busy()">Copy password-reset link</button>
              <button type="button" class="adm-btn sm" [class.danger]="!u.disabled" (click)="toggleSuspend(u)" [disabled]="busy() || u.uid === me()">{{ u.disabled ? 'Unsuspend' : 'Suspend' }}</button>
            </div>
          </div>

          <div class="adm-section">
            <span class="adm-label">Danger zone</span>
            @if (!confirmingDelete()) {
              <button type="button" class="adm-btn sm danger" (click)="confirmingDelete.set(true)" [disabled]="busy() || u.uid === me()">Delete account and all data…</button>
            } @else {
              <p class="adm-soft" style="font-size:12.5px; margin: 0 0 8px;">Irreversible. Removes Firestore data, the Auth user and any Stripe customer. Type <span class="adm-mono">DELETE</span> to confirm.</p>
              <div style="display:flex; gap:8px;">
                <input class="adm-field" [(ngModel)]="deleteWord" placeholder="DELETE" style="width:140px;" />
                <button type="button" class="adm-btn sm danger" (click)="deleteUser(u)" [disabled]="busy() || deleteWord !== 'DELETE'">Delete forever</button>
                <button type="button" class="adm-btn sm ghost" (click)="confirmingDelete.set(false); deleteWord = ''">Cancel</button>
              </div>
            }
          </div>
        } @else {
          <p class="adm-empty">Loading {{ uid }}…</p>
        }
      </aside>
    }
  `,
})
export class AdminUsersComponent {
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  private readonly api = inject(AdminService);
  private readonly auth = inject(AuthService);

  readonly fmtDate = fmtDate;
  readonly fmtDateTime = fmtDateTime;
  readonly relTime = relTime;
  readonly initials = initials;
  readonly planFilters: readonly PlanFilter[] = ['all', 'free', 'paid', 'comped', 'admin'];

  readonly q = signal('');
  readonly plan = signal<PlanFilter>('all');
  readonly flag = signal<FlagFilter>('all');
  readonly provider = signal<string>('all');
  readonly sort = signal<SortKey>('createdAt');
  readonly dir = signal<1 | -1>(-1);
  readonly busy = signal(false);
  readonly details = signal<AdminUserDetails | null>(null);
  readonly detailsError = signal('');
  readonly confirmingDelete = signal(false);
  deleteWord = '';

  readonly me = computed(() => this.auth.user()?.uid ?? null);
  readonly selected = computed(() => this.data.users().find((u) => u.uid === this.shell.selectedUid()) ?? null);
  readonly providers = computed(() => [...new Set(this.data.users().flatMap((u) => u.providers))].sort());
  readonly counts = computed(() => ({
    paid: this.data.users().filter((u) => u.stripeRole === 'paid').length,
    comped: this.data.users().filter((u) => this.isComped(u)).length,
    disabled: this.data.users().filter((u) => u.disabled).length,
  }));

  readonly filtered = computed(() => {
    const term = this.q().toLowerCase().trim();
    const plan = this.plan();
    const flag = this.flag();
    const prov = this.provider();
    const key = this.sort();
    const dir = this.dir();
    return this.data.users()
      .filter((u) => !term || u.email.toLowerCase().includes(term) || u.displayName.toLowerCase().includes(term) || u.uid.toLowerCase().includes(term))
      .filter((u) => plan === 'all'
        || (plan === 'admin' && u.admin)
        || (plan === 'paid' && u.stripeRole === 'paid')
        || (plan === 'comped' && this.isComped(u))
        || (plan === 'free' && !u.admin && u.stripeRole !== 'paid' && !this.isComped(u)))
      .filter((u) => flag === 'all' || (flag === 'unverified' && !u.emailVerified) || (flag === 'disabled' && u.disabled) || (flag === 'noProfile' && !u.profileCompleted))
      .filter((u) => prov === 'all' || u.providers.includes(prov))
      .sort((a, b) => {
        const av = key === 'plan' ? this.tierRank(a) : (a[key] ?? '');
        const bv = key === 'plan' ? this.tierRank(b) : (b[key] ?? '');
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      });
  });

  constructor() {
    void this.data.loadUsers();
    // Load the drawer's deep record whenever a different user is selected.
    effect(() => {
      const uid = this.shell.selectedUid();
      this.details.set(null);
      this.detailsError.set('');
      this.confirmingDelete.set(false);
      this.deleteWord = '';
      if (!uid) return;
      if (this.data.users().length === 0) void this.data.loadUsers();
      if (adminPreviewEnabled()) {
        const u = this.data.users().find((x) => x.uid === uid);
        if (u) this.details.set({ user: u, profile: { goalDirection: 'lose', targetWeightLbs: 165 }, counts: { dailyLogs: 212, presets: 9, reports: 2, measurements: 14 }, subscriptions: [] });
        return;
      }
      void this.api.getUserDetails(uid)
        .then((d) => { if (this.shell.selectedUid() === uid) this.details.set(d); })
        .catch((err) => this.detailsError.set(err instanceof Error ? err.message : String(err)));
    });
  }

  close(): void { this.shell.selectedUid.set(null); }
  isComped(u: AdminUserRow): boolean { return this.api.compedEmails().includes(u.email.toLowerCase()); }
  tierRank(u: AdminUserRow): number { return u.admin ? 3 : this.isComped(u) ? 2 : u.stripeRole === 'paid' ? 1 : 0; }
  shortProvider(p: string): string { return p.replace('.com', ''); }
  sortBy(key: SortKey): void {
    if (this.sort() === key) this.dir.set(this.dir() === 1 ? -1 : 1);
    else { this.sort.set(key); this.dir.set(key === 'email' ? 1 : -1); }
  }
  arrow(key: SortKey): string { return this.sort() === key ? (this.dir() === 1 ? '↑' : '↓') : ''; }
  profileStr(p: Record<string, unknown> | null, k: string): string {
    const v = p?.[k];
    if (v == null) return '—';
    if (typeof v === 'object' && v && 'toDate' in (v as object)) return fmtDate((v as { toDate: () => Date }).toDate().toISOString());
    if (typeof v === 'object' && v && 'seconds' in (v as object)) return fmtDate(new Date((v as { seconds: number }).seconds * 1000).toISOString());
    return String(v);
  }
  subLabel(s: AdminUserDetails['subscriptions'][number]): string { return `${s.status}${s.cancel_at_period_end ? ' (cancelling)' : ''}`; }

  private async run(label: string, op: () => Promise<void>, reload = true): Promise<void> {
    this.busy.set(true);
    try {
      await op();
      this.shell.toast(label, 'ok');
      if (reload) await this.data.loadUsers(true);
    } catch (err) {
      this.shell.toast(err instanceof Error ? err.message : String(err), 'error');
    } finally { this.busy.set(false); }
  }

  togglePlan(u: AdminUserRow) {
    const next = u.stripeRole === 'paid' ? null : 'paid';
    return this.run(`${u.email}: plan → ${next ?? 'free'}`, () => this.api.overridePlan(u.uid, next));
  }
  toggleComped(u: AdminUserRow) {
    const grant = !this.isComped(u);
    return this.run(`${u.email}: ${grant ? 'comped' : 'comped removed'}`, () => this.api.setCompedEmail(u.email.toLowerCase(), grant), false);
  }
  toggleSuspend(u: AdminUserRow) {
    return this.run(`${u.email}: ${u.disabled ? 'unsuspended' : 'suspended'}`, () => this.api.suspendUser(u.uid, !u.disabled));
  }
  resetQuotas(u: AdminUserRow) {
    return this.run(`${u.email}: today's AI quotas reset`, () => this.api.resetQuotas(u.uid), false);
  }
  passwordLink(u: AdminUserRow) {
    return this.run(`Password-reset link copied for ${u.email}`, async () => {
      const { link } = await this.api.resetPassword(u.email);
      await navigator.clipboard.writeText(link);
    }, false);
  }
  deleteUser(u: AdminUserRow) {
    return this.run(`${u.email} deleted`, async () => {
      await this.api.deleteUser(u.uid);
      this.close();
    });
  }
}
