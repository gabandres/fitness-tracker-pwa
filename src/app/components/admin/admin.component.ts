import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { AdminService, AdminUserRow, AuditLog, PlatformStats } from '../../services/admin.service';

type AdminTab =
  | 'stats' | 'users' | 'admins' | 'subscriptions'
  | 'comped' | 'audit' | 'support' | 'export';

interface TabDef { readonly id: AdminTab; readonly label: string; }

/**
 * Superuser admin panel — renders at /admin. The route is gated in app.ts:
 * if the signed-in user doesn't hold the `admin` custom claim we fall
 * through to the not-found page instead of rendering this.
 *
 * Built as a single component with inline tabs because there's only one
 * admin (me) and the UI surface is small enough that splitting into
 * per-tab components just adds navigational overhead. If tabs grow
 * interactive state or are shared with another panel later, extract
 * them at that point.
 *
 * Desktop-first layout with a mobile fallback. The tabs row scrolls
 * horizontally on narrow viewports so all tabs remain reachable.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .admin-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    .admin-table th, .admin-table td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid color-mix(in srgb, var(--color-rule) 40%, transparent);
      text-align: left;
      vertical-align: middle;
    }
    .admin-table th {
      font-family: var(--font-mono, ui-monospace);
      font-size: 0.65rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--color-graphite);
      font-weight: 500;
    }
    .admin-table tr:hover td { background: color-mix(in srgb, var(--color-gold) 8%, transparent); }
    .chip {
      display: inline-flex; align-items: center; padding: 0.1rem 0.5rem;
      border: 1px solid currentColor; border-radius: 999px;
      font-family: var(--font-mono, ui-monospace); font-size: 0.65rem;
      letter-spacing: 0.1em; text-transform: uppercase;
    }
    .chip-olive { color: var(--color-olive); }
    .chip-blood { color: var(--color-blood); }
    .chip-gold { color: var(--color-gold); }
    .chip-graphite { color: var(--color-graphite); }
  `],
  template: `
    <section class="max-w-[1200px] mx-auto">
      <a href="/app" class="caption text-xs underline decoration-dotted hover:text-blood">
        &larr; back to app
      </a>

      <header class="mt-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <span class="stamp-mark" style="border-color: var(--color-blood); color: var(--color-blood)">
              ADMIN
            </span>
            <span class="data-label">superuser panel</span>
          </div>
          <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
            Operator<br/><em class="text-blood">Console</em>
          </h1>
          <p class="caption mt-2 text-xs">
            signed in as <span class="font-mono">{{ auth.user()?.email }}</span>
          </p>
        </div>
        <div class="flex gap-2 items-center shrink-0 pt-2">
          @if (admin.impersonating()) {
            <span class="chip chip-gold">impersonating</span>
            <button type="button" (click)="stopImpersonating()" class="tag-btn">
              exit impersonation
            </button>
          }
          <button type="button" (click)="signOut()" class="tag-btn">sign out</button>
        </div>
      </header>

      <div class="ruler-edge mt-4">
        @for (_ of ticks; track $index) { <span></span> }
      </div>

      @if (!admin.ready()) {
        <div class="specimen p-10 mt-8 text-center">
          <p class="caption">resolving admin claim…</p>
        </div>
      } @else if (!admin.isAdmin()) {
        @if (admin.canBootstrap()) {
          <div class="specimen p-8 mt-8">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <h2 class="font-display text-2xl text-ink">Bootstrap admin</h2>
            <p class="caption mt-2 text-xs">
              No admin is configured yet. You're on the seed list; click to grant yourself the
              <code class="font-mono">admin</code> custom claim.
            </p>
            <div class="mt-4 flex items-center gap-2">
              <button type="button" (click)="bootstrap()" [disabled]="busy()" class="stamp-btn">
                {{ busy() ? 'working…' : 'bootstrap admin system' }}
              </button>
              <button type="button" (click)="refreshClaim()" class="tag-btn">
                refresh claim
              </button>
            </div>
            @if (error()) {
              <p class="font-mono text-[11px] text-blood mt-3" role="alert">✕ {{ error() }}</p>
            }
          </div>
        } @else {
          <div class="specimen p-8 mt-8">
            <p class="caption">Access denied. This surface is gated on the <code class="font-mono">admin</code> custom claim.</p>
            <div class="mt-3">
              <button type="button" (click)="refreshClaim()" class="tag-btn">refresh claim</button>
            </div>
          </div>
        }
      } @else {
        <!-- Tab navigation -->
        <nav class="mt-8 overflow-x-auto">
          <div class="flex gap-1 border-b border-rule/50 min-w-max">
            @for (tab of tabs; track tab.id) {
              <button type="button" (click)="setTab(tab.id)"
                class="px-4 py-2 text-sm font-sans transition-colors whitespace-nowrap border-b-2"
                [class.border-blood]="activeTab() === tab.id"
                [class.text-blood]="activeTab() === tab.id"
                [class.border-transparent]="activeTab() !== tab.id"
                [class.text-graphite]="activeTab() !== tab.id">
                {{ tab.label }}
              </button>
            }
          </div>
        </nav>

        @if (error()) {
          <p class="font-mono text-[11px] text-blood mt-4" role="alert">✕ {{ error() }}</p>
        }
        @if (notice()) {
          <p class="font-mono text-[11px] mt-4" style="color: var(--color-olive)" role="status">
            ✓ {{ notice() }}
          </p>
        }

        <!-- STATS TAB -->
        @if (activeTab() === 'stats') {
          <div class="mt-6 space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="font-display text-2xl text-ink">Platform stats</h2>
              <button type="button" (click)="loadStats(true)" [disabled]="busy()" class="tag-btn">
                {{ busy() ? 'refreshing…' : 'refresh' }}
              </button>
            </div>
            @if (stats(); as s) {
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                @for (m of statMetrics(s); track m.label) {
                  <div class="specimen px-4 py-3">
                    <span class="crop-bl"></span><span class="crop-br"></span>
                    <div class="data-label text-[10px]">{{ m.label }}</div>
                    <div class="font-display text-2xl mt-1 text-ink">{{ m.value }}</div>
                  </div>
                }
              </div>
              <div class="mt-2">
                <h3 class="data-label">providers</h3>
                <ul class="mt-2 flex gap-2 flex-wrap">
                  @for (p of providerEntries(s); track p.id) {
                    <li class="chip chip-graphite">{{ p.id }} · {{ p.count }}</li>
                  }
                </ul>
              </div>
            } @else {
              <p class="caption">loading…</p>
            }
          </div>
        }

        <!-- USERS TAB -->
        @if (activeTab() === 'users') {
          <div class="mt-6 space-y-4">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <h2 class="font-display text-2xl text-ink">Users</h2>
              <div class="flex items-center gap-2">
                <input type="search" [ngModel]="userSearch()" (ngModelChange)="userSearch.set($event)"
                  placeholder="email, name, or uid"
                  class="px-3 py-1.5 border border-rule/60 rounded bg-paper text-ink text-sm min-w-[260px]"
                />
                <button type="button" (click)="loadUsers()" [disabled]="busy()" class="tag-btn">
                  {{ busy() ? 'loading…' : 'reload' }}
                </button>
              </div>
            </div>

            @if (filteredUsers().length === 0) {
              <p class="caption">no users.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="admin-table">
                  <thead>
                    <tr>
                      <th>email</th><th>name</th><th>created</th><th>last seen</th>
                      <th>plan</th><th>flags</th><th>actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (u of filteredUsers(); track u.uid) {
                      <tr>
                        <td class="font-mono text-xs">{{ u.email }}</td>
                        <td>{{ u.displayName || '—' }}</td>
                        <td class="font-mono text-[11px]">{{ shortDate(u.createdAt) }}</td>
                        <td class="font-mono text-[11px]">{{ shortDate(u.lastSignInAt) }}</td>
                        <td>
                          @if (u.admin) { <span class="chip chip-blood">admin</span> }
                          @else if (u.stripeRole === 'paid') { <span class="chip chip-olive">paid</span> }
                          @else { <span class="chip chip-graphite">free</span> }
                        </td>
                        <td class="font-mono text-[11px]">
                          @if (!u.emailVerified) { <span class="chip chip-gold">unverified</span> }
                          @if (u.disabled) { <span class="chip chip-blood">disabled</span> }
                          @if (!u.profileCompleted) { <span class="chip chip-graphite">no profile</span> }
                        </td>
                        <td>
                          <div class="flex gap-1 flex-wrap">
                            <button type="button" class="tag-btn text-[11px]"
                              (click)="impersonate(u)"
                              [disabled]="busy() || u.uid === auth.user()?.uid">
                              as user
                            </button>
                            <button type="button" class="tag-btn text-[11px]"
                              (click)="togglePlan(u)" [disabled]="busy()">
                              {{ u.stripeRole === 'paid' ? 'revoke paid' : 'grant paid' }}
                            </button>
                            <button type="button" class="tag-btn text-[11px]"
                              (click)="toggleSuspend(u)" [disabled]="busy() || u.uid === auth.user()?.uid">
                              {{ u.disabled ? 'unsuspend' : 'suspend' }}
                            </button>
                            <button type="button" class="tag-btn text-[11px]"
                              (click)="resetQuotas(u)" [disabled]="busy()">
                              reset quotas
                            </button>
                            <button type="button" class="tag-btn text-[11px]"
                              (click)="resetPassword(u)" [disabled]="busy()">
                              password link
                            </button>
                            <button type="button" class="tag-btn text-[11px]" style="color: var(--color-blood)"
                              (click)="deleteUserConfirm(u)"
                              [disabled]="busy() || u.uid === auth.user()?.uid">
                              delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="caption text-[11px]">{{ filteredUsers().length }} of {{ allUsers().length }} shown.</p>
            }
          </div>
        }

        <!-- ADMINS TAB -->
        @if (activeTab() === 'admins') {
          <div class="mt-6 space-y-4 max-w-[640px]">
            <h2 class="font-display text-2xl text-ink">Admin users</h2>
            <p class="caption text-xs">
              Manage who holds the <code class="font-mono">admin</code> custom claim. Claim changes
              revoke the target's refresh token — they'll have to sign in again to pick up the new state.
            </p>
            <div class="flex gap-2 items-center">
              <input type="email" [ngModel]="newAdminEmail()" (ngModelChange)="newAdminEmail.set($event)"
                placeholder="email@example.com"
                class="flex-1 px-3 py-1.5 border border-rule/60 rounded bg-paper text-ink text-sm" />
              <button type="button" (click)="addAdmin()"
                [disabled]="busy() || !newAdminEmail().trim()" class="stamp-btn">
                {{ busy() ? 'working…' : 'grant admin' }}
              </button>
            </div>

            <ul class="space-y-2">
              @for (email of admin.adminEmails(); track email) {
                <li class="flex items-center justify-between specimen px-4 py-2">
                  <span class="crop-bl"></span><span class="crop-br"></span>
                  <span class="font-mono text-xs">{{ email }}</span>
                  <button type="button" (click)="removeAdmin(email)"
                    [disabled]="busy() || admin.adminEmails().length <= 1"
                    class="tag-btn text-[11px]" style="color: var(--color-blood)">
                    revoke
                  </button>
                </li>
              } @empty {
                <li class="caption text-xs">no admins configured.</li>
              }
            </ul>
          </div>
        }

        <!-- COMPED TAB -->
        @if (activeTab() === 'comped') {
          <div class="mt-6 space-y-4 max-w-[640px]">
            <h2 class="font-display text-2xl text-ink">Comped friends</h2>
            <p class="caption text-xs">
              Emails here bypass all per-user quotas (photos, consultations) and are treated as paid server-side.
              Propagation takes up to 60 seconds due to an in-memory cache on the CF side.
            </p>
            <div class="flex gap-2 items-center">
              <input type="email" [ngModel]="newCompedEmail()" (ngModelChange)="newCompedEmail.set($event)"
                placeholder="friend@example.com"
                class="flex-1 px-3 py-1.5 border border-rule/60 rounded bg-paper text-ink text-sm" />
              <button type="button" (click)="addComped()"
                [disabled]="busy() || !newCompedEmail().trim()" class="stamp-btn">
                {{ busy() ? 'working…' : 'add' }}
              </button>
            </div>
            <ul class="space-y-2">
              @for (email of admin.compedEmails(); track email) {
                <li class="flex items-center justify-between specimen px-4 py-2">
                  <span class="crop-bl"></span><span class="crop-br"></span>
                  <span class="font-mono text-xs">{{ email }}</span>
                  <button type="button" (click)="removeComped(email)" [disabled]="busy()"
                    class="tag-btn text-[11px]" style="color: var(--color-blood)">remove</button>
                </li>
              } @empty {
                <li class="caption text-xs">nobody comped.</li>
              }
            </ul>
          </div>
        }

        <!-- SUBSCRIPTIONS TAB -->
        @if (activeTab() === 'subscriptions') {
          <div class="mt-6 space-y-4">
            <h2 class="font-display text-2xl text-ink">Subscriptions</h2>
            <p class="caption text-xs">
              All paid users. Granular billing actions (refunds, cancellations) still happen in the Stripe
              dashboard — this view is for a quick "who's paying and for how long" check.
            </p>
            @if (paidUsers().length === 0) {
              <p class="caption">no paid users yet.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="admin-table">
                  <thead>
                    <tr><th>email</th><th>role</th><th>via</th><th>created</th></tr>
                  </thead>
                  <tbody>
                    @for (u of paidUsers(); track u.uid) {
                      <tr>
                        <td class="font-mono text-xs">{{ u.email }}</td>
                        <td><span class="chip chip-olive">{{ u.stripeRole }}</span></td>
                        <td class="font-mono text-[11px]">{{ u.admin ? 'admin override' : 'stripe' }}</td>
                        <td class="font-mono text-[11px]">{{ shortDate(u.createdAt) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }

        <!-- AUDIT LOG TAB -->
        @if (activeTab() === 'audit') {
          <div class="mt-6 space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="font-display text-2xl text-ink">Audit log</h2>
              <button type="button" (click)="loadAuditLogs()" [disabled]="busy()" class="tag-btn">
                {{ busy() ? 'loading…' : 'reload' }}
              </button>
            </div>
            @if (auditLogs().length === 0) {
              <p class="caption">no audit entries yet.</p>
            } @else {
              <div class="overflow-x-auto">
                <table class="admin-table">
                  <thead>
                    <tr><th>timestamp</th><th>action</th><th>admin</th><th>target</th><th>details</th></tr>
                  </thead>
                  <tbody>
                    @for (log of auditLogs(); track log.id) {
                      <tr>
                        <td class="font-mono text-[11px]">{{ shortDate(log.timestamp) }}</td>
                        <td><span class="chip chip-graphite">{{ log.action }}</span></td>
                        <td class="font-mono text-[11px]">{{ log.adminEmail }}</td>
                        <td class="font-mono text-[11px]">{{ log.targetEmail || log.targetUid || '—' }}</td>
                        <td class="font-mono text-[10px]">{{ formatDetails(log.details) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }

        <!-- SUPPORT TAB -->
        @if (activeTab() === 'support') {
          <div class="mt-6 space-y-4 max-w-[640px]">
            <h2 class="font-display text-2xl text-ink">Support tools</h2>
            <p class="caption text-xs">
              Quick lookups for common support asks. All actions write an audit log entry.
            </p>
            <div class="specimen p-4">
              <span class="crop-bl"></span><span class="crop-br"></span>
              <h3 class="data-label">find user</h3>
              <div class="flex gap-2 items-center mt-2">
                <input type="search" [(ngModel)]="supportLookup" placeholder="email"
                  class="flex-1 px-3 py-1.5 border border-rule/60 rounded bg-paper text-ink text-sm" />
                <button type="button" (click)="lookupUser()" [disabled]="busy()" class="tag-btn">
                  lookup
                </button>
              </div>
              @if (lookupResult(); as u) {
                <div class="mt-3 font-mono text-[11px] space-y-1">
                  <div><span class="data-label text-[10px]">uid:</span> {{ u.uid }}</div>
                  <div><span class="data-label text-[10px]">email:</span> {{ u.email }} {{ u.emailVerified ? '✓' : '(unverified)' }}</div>
                  <div><span class="data-label text-[10px]">created:</span> {{ shortDate(u.createdAt) }}</div>
                  <div><span class="data-label text-[10px]">last seen:</span> {{ shortDate(u.lastSignInAt) }}</div>
                  <div><span class="data-label text-[10px]">plan:</span> {{ u.stripeRole || 'free' }}{{ u.admin ? ' + admin' : '' }}</div>
                  <div><span class="data-label text-[10px]">providers:</span> {{ u.providers.join(', ') }}</div>
                </div>
                <div class="mt-3 flex gap-2 flex-wrap">
                  <button type="button" (click)="impersonate(u)" [disabled]="busy()" class="tag-btn text-[11px]">
                    impersonate
                  </button>
                  <button type="button" (click)="resetQuotas(u)" [disabled]="busy()" class="tag-btn text-[11px]">
                    reset today's quotas
                  </button>
                  <button type="button" (click)="resetPassword(u)" [disabled]="busy()" class="tag-btn text-[11px]">
                    password reset link
                  </button>
                </div>
              }
            </div>
          </div>
        }

        <!-- EXPORT TAB -->
        @if (activeTab() === 'export') {
          <div class="mt-6 space-y-4 max-w-[640px]">
            <h2 class="font-display text-2xl text-ink">Data export</h2>
            <p class="caption text-xs">
              CSV dumps for spreadsheet analysis. Large exports (all logs) may take up to 60 seconds.
            </p>
            <div class="grid gap-3 sm:grid-cols-3">
              @for (exp of exportChoices; track exp.type) {
                <button type="button" (click)="downloadExport(exp.type)"
                  [disabled]="busy()"
                  class="specimen px-4 py-5 text-left hover:bg-[color:var(--color-gold)]/10 transition-colors">
                  <span class="crop-bl"></span><span class="crop-br"></span>
                  <div class="data-label text-[10px]">{{ exp.type }}</div>
                  <div class="font-display text-lg mt-1 text-ink">{{ exp.label }}</div>
                  <div class="caption mt-1 text-[11px]">{{ exp.hint }}</div>
                </button>
              }
            </div>
          </div>
        }
      }
    </section>
  `,
})
export class AdminComponent {
  readonly auth = inject(AuthService);
  readonly admin = inject(AdminService);

  readonly ticks = Array.from({ length: 45 });

  readonly tabs: readonly TabDef[] = [
    { id: 'stats',         label: 'Stats' },
    { id: 'users',         label: 'Users' },
    { id: 'admins',        label: 'Admins' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'comped',        label: 'Comped' },
    { id: 'audit',         label: 'Audit log' },
    { id: 'support',       label: 'Support' },
    { id: 'export',        label: 'Export' },
  ];

  readonly activeTab = signal<AdminTab>('stats');
  readonly busy = signal(false);
  readonly error = signal<string>('');
  readonly notice = signal<string>('');

  readonly stats = signal<PlatformStats | null>(null);
  readonly allUsers = signal<AdminUserRow[]>([]);
  readonly auditLogs = signal<AuditLog[]>([]);
  readonly lookupResult = signal<AdminUserRow | null>(null);

  readonly userSearch = signal('');
  newAdminEmail = signal('');
  newCompedEmail = signal('');
  supportLookup = '';

  readonly filteredUsers = computed(() => {
    const term = this.userSearch().toLowerCase().trim();
    const users = this.allUsers();
    if (!term) return users;
    return users.filter((u) =>
      u.email.toLowerCase().includes(term) ||
      u.displayName.toLowerCase().includes(term) ||
      u.uid.toLowerCase().includes(term),
    );
  });

  readonly paidUsers = computed(() =>
    this.allUsers().filter((u) => u.stripeRole === 'paid' || u.admin),
  );

  readonly exportChoices = [
    { type: 'users' as const,   label: 'Users',   hint: 'uid, email, plan, created, last seen' },
    { type: 'logs' as const,    label: 'Logs',    hint: 'every daily log across all users' },
    { type: 'metrics' as const, label: 'Metrics', hint: 'cached platform stats' },
  ];

  setTab(tab: AdminTab): void {
    this.activeTab.set(tab);
    this.error.set('');
    this.notice.set('');
    // Lazy-load data per tab so we don't issue every admin CF on mount.
    if (tab === 'stats' && !this.stats()) this.loadStats();
    if (tab === 'users' && this.allUsers().length === 0) this.loadUsers();
    if (tab === 'subscriptions' && this.allUsers().length === 0) this.loadUsers();
    if (tab === 'audit' && this.auditLogs().length === 0) this.loadAuditLogs();
  }

  constructor() {
    // Default tab prefetch.
    queueMicrotask(() => this.loadStats());
  }

  // ─── Operations ────────────────────────────────────────────────

  async bootstrap(): Promise<void> {
    await this.run('bootstrapping', async () => {
      const res = await this.admin.bootstrap();
      await this.admin.refreshAdminStatus();
      this.notice.set(`bootstrapped: ${res.seeded.join(', ')}`);
    });
  }

  async refreshClaim(): Promise<void> {
    await this.run('refreshing', async () => {
      const ok = await this.admin.refreshAdminStatus();
      this.notice.set(ok ? 'admin claim active' : 'no admin claim on this account');
    });
  }

  async loadStats(refresh = false): Promise<void> {
    await this.run('loading stats', async () => {
      const s = await this.admin.getPlatformStats(refresh);
      this.stats.set(s);
    });
  }

  async loadUsers(): Promise<void> {
    await this.run('loading users', async () => {
      const { users } = await this.admin.listUsers();
      users.sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || ''),
      );
      this.allUsers.set(users);
    });
  }

  async loadAuditLogs(): Promise<void> {
    await this.run('loading audit log', async () => {
      const { logs } = await this.admin.getAuditLogs({ limit: 100 });
      this.auditLogs.set(logs);
    });
  }

  async addAdmin(): Promise<void> {
    const email = this.newAdminEmail().trim().toLowerCase();
    if (!email) return;
    await this.run('granting admin', async () => {
      await this.admin.setAdmin(email, true);
      this.newAdminEmail.set('');
      this.notice.set(`${email} is now an admin`);
    });
  }

  async removeAdmin(email: string): Promise<void> {
    if (!confirm(`Revoke admin from ${email}?`)) return;
    await this.run('revoking admin', async () => {
      await this.admin.setAdmin(email, false);
      this.notice.set(`${email} revoked`);
    });
  }

  async addComped(): Promise<void> {
    const email = this.newCompedEmail().trim().toLowerCase();
    if (!email) return;
    await this.run('adding comped', async () => {
      await this.admin.setCompedEmail(email, true);
      this.newCompedEmail.set('');
      this.notice.set(`${email} comped`);
    });
  }

  async removeComped(email: string): Promise<void> {
    if (!confirm(`Remove ${email} from comped list?`)) return;
    await this.run('removing comped', async () => {
      await this.admin.setCompedEmail(email, false);
      this.notice.set(`${email} removed`);
    });
  }

  async impersonate(user: AdminUserRow): Promise<void> {
    if (!confirm(`Sign in as ${user.email}? You can return via the "exit impersonation" button.`)) return;
    await this.run('impersonating', async () => {
      await this.admin.impersonate(user.email);
      // After custom-token swap the app shell will re-render in the target
      // user's context. Navigate back to /app so they land on the user's
      // dashboard rather than this (now-inaccessible) admin panel.
      window.location.assign('/app');
    });
  }

  async stopImpersonating(): Promise<void> {
    await this.run('returning to admin', async () => {
      await this.admin.stopImpersonating();
      window.location.assign('/admin');
    });
  }

  async togglePlan(user: AdminUserRow): Promise<void> {
    const newRole = user.stripeRole === 'paid' ? null : 'paid';
    const label = newRole ? 'grant paid' : 'revoke paid';
    if (!confirm(`${label} for ${user.email}?`)) return;
    await this.run('updating plan', async () => {
      await this.admin.overridePlan(user.uid, newRole);
      this.notice.set(`${user.email} plan: ${newRole || 'free'}`);
      await this.loadUsers();
    });
  }

  async toggleSuspend(user: AdminUserRow): Promise<void> {
    const disable = !user.disabled;
    const label = disable ? 'suspend' : 'unsuspend';
    if (!confirm(`${label} ${user.email}?`)) return;
    await this.run(label, async () => {
      await this.admin.suspendUser(user.uid, disable);
      this.notice.set(`${user.email} ${disable ? 'suspended' : 'unsuspended'}`);
      await this.loadUsers();
    });
  }

  async resetQuotas(user: AdminUserRow): Promise<void> {
    await this.run('resetting quotas', async () => {
      await this.admin.resetQuotas(user.uid);
      this.notice.set(`${user.email} quotas reset for today`);
    });
  }

  async resetPassword(user: AdminUserRow): Promise<void> {
    await this.run('generating reset link', async () => {
      const { link } = await this.admin.resetPassword(user.email);
      // Copy rather than display so it isn't just sitting on screen for shoulder-surfers.
      try {
        await navigator.clipboard.writeText(link);
        this.notice.set(`password reset link copied for ${user.email}`);
      } catch {
        // Clipboard API unavailable — fall back to alerting the raw link.
        alert(`Password reset link:\n\n${link}`);
      }
    });
  }

  async deleteUserConfirm(user: AdminUserRow): Promise<void> {
    const typed = prompt(`Type DELETE to permanently remove ${user.email} and all their data.`);
    if (typed !== 'DELETE') return;
    await this.run('deleting user', async () => {
      await this.admin.deleteUser(user.uid);
      this.notice.set(`${user.email} deleted`);
      await this.loadUsers();
    });
  }

  async lookupUser(): Promise<void> {
    const email = (this.supportLookup || '').trim().toLowerCase();
    if (!email) return;
    await this.run('looking up', async () => {
      if (this.allUsers().length === 0) await this.loadUsers();
      const match = this.allUsers().find((u) => u.email.toLowerCase() === email) || null;
      this.lookupResult.set(match);
      if (!match) this.error.set(`no user found with email: ${email}`);
    });
  }

  async downloadExport(type: 'users' | 'logs' | 'metrics'): Promise<void> {
    await this.run(`exporting ${type}`, async () => {
      const csv = await this.admin.exportData(type);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `macrolog-${type}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.notice.set(`${type} CSV downloaded`);
    });
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    window.location.assign('/');
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /** Wraps an async op with busy/error/notice state. Any thrown error
   *  is surfaced via the error banner rather than propagated. */
  private async run(_label: string, op: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await op();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error.set(msg);
    } finally {
      this.busy.set(false);
    }
  }

  shortDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toISOString().slice(0, 16).replace('T', ' ');
    } catch {
      return iso;
    }
  }

  formatDetails(d: unknown): string {
    if (!d || typeof d !== 'object') return '';
    try {
      return JSON.stringify(d);
    } catch {
      return '';
    }
  }

  statMetrics(s: PlatformStats): Array<{ label: string; value: string }> {
    return [
      { label: 'total users', value: String(s.totalUsers) },
      { label: 'new 7d',      value: String(s.newUsers7d) },
      { label: 'new 30d',     value: String(s.newUsers30d) },
      { label: 'verified',    value: String(s.verifiedCount) },
      { label: 'active 7d',   value: String(s.active7d) },
      { label: 'active 30d',  value: String(s.active30d) },
      { label: 'paid subs',   value: String(s.activePaidSubs) },
      { label: 'comped',      value: String(s.compedCount) },
      { label: 'mrr est',     value: `$${s.estimatedMRR.toFixed(2)}` },
      { label: 'disabled',    value: String(s.disabledCount) },
    ];
  }

  providerEntries(s: PlatformStats): Array<{ id: string; count: number }> {
    return Object.entries(s.providersBreakdown).map(([id, count]) => ({ id, count }));
  }
}
