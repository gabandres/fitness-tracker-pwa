import { Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { CallableGateway } from '../../services/callable.gateway';
import {
  AdminService,
  type ActivityItem,
  type AdminUserDetails,
  type AdminUserRow,
  type AuditLog,
  type BillingReport,
  type CostModel,
  type FeedbackRow,
  type LedgerItem,
  type PlatformStats,
  type RetentionHistoryRow,
  type StoreVersionDoc,
  type StoreVersionSync,
} from '../../services/admin.service';
import { AdminShellState } from './admin-shell.state';
import { adminPreviewEnabled } from './admin-preview';
import {
  buildInsights,
  type CeilingStatus,
  type Insight,
  type RetentionSummary,
  type UsageSeries,
} from './admin-insights';

/**
 * One loadable thing the console shows. Reads like a signal (`console.users()`)
 * and carries its own busy flag, its own last error and its own refresh — so a
 * section never hand-rolls a `busy = signal(false)` or a `catch → toast` again.
 *
 * `load()` is idempotent: it fetches once and then serves the cache until
 * something asks for `refresh()`. Concurrent calls collapse into the first.
 */
export interface AdminResource<T> {
  (): T;
  /** True while a fetch for THIS resource is in flight. Never global. */
  readonly loading: Signal<boolean>;
  /** Message from this resource's last failed fetch; cleared by a success. */
  readonly error: Signal<string>;
  /** Fetch unless already loaded. `force` re-fetches. */
  load(force?: boolean): Promise<void>;
  /** `load(true)` — what a section's Refresh button calls. */
  refresh(): Promise<void>;
  /** Overwrite without fetching (preview fixtures, post-write echoes). */
  set(value: T): void;
  /**
   * Run a DIFFERENT producer through this resource's busy flag and error
   * policy — for the two operations that write into a resource without being
   * a plain re-read of it (the store-version sync, the audit-log "load older").
   */
  replace(op: () => Promise<T>): Promise<void>;
}

/** Every cached thing the console can show, by key. */
export interface AdminSections {
  stats: PlatformStats | null;
  usage: UsageSeries | null;
  retention: RetentionSummary | null;
  retentionHistory: RetentionHistoryRow[];
  ceilings: CeilingStatus[];
  heartbeat: number | null;
  storeVersions: StoreVersionDoc | null;
  users: AdminUserRow[];
  activity: ActivityItem[];
  audit: AuditLog[];
  feedback: FeedbackRow[];
  costModel: CostModel | null;
  billing: BillingReport | null;
  costLedger: LedgerItem[];
}
export type AdminSectionKey = keyof AdminSections;

/** What the Overview page and the palette's "Refresh everything" pull. */
const OVERVIEW_KEYS = ['stats', 'usage', 'ceilings', 'heartbeat', 'storeVersions', 'feedback', 'activity'] as const;

/** Display name of a spend-ceiling kind. Shared by the Cost page and its toasts. */
export function ceilingLabel(kind: string): string {
  return kind === 'photo' ? 'Photo scan' : kind === 'consultation' ? 'AI coach' : kind;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The admin console's single interface: every number a section shows and every
 * mutation a section can run, behind one injection.
 *
 * Sections do not talk to Cloud Functions, to Firestore or to `AdminService`.
 * They ask for a resource (cache + busy + error + refresh) or call a command
 * (busy + toast + reload, in that operation's exact order). That is the whole
 * contract, and it is why no section can quietly acquire its own error policy.
 *
 * `AdminService` is still the session service behind this one — the admin
 * claim, the config snapshots, impersonation — and its state is re-exported
 * below rather than injected a second time by the shell.
 */
@Injectable({ providedIn: 'root' })
export class AdminConsole {
  private readonly api = inject(AdminService);
  private readonly callables = inject(CallableGateway);
  private readonly shell = inject(AdminShellState);

  /** Every resource's busy flag, in creation order — the source of `anyLoading`. */
  private readonly loadingFlags: Array<Signal<boolean>> = [];

  // ─── Session state, re-exported so /admin needs one injection ──────
  /** True once the admin-claim check for the current user has settled. */
  readonly ready: Signal<boolean> = this.api.ready;
  /** True when the signed-in user holds the `admin` custom claim. */
  readonly isAdmin: Signal<boolean> = this.api.isAdmin;
  /** Seed-admin email with no claim yet — the one-time bootstrap CTA. */
  readonly canBootstrap: Signal<boolean> = this.api.canBootstrap;
  /** Emails in `config/accessList`, live from the snapshot listener. */
  readonly compedEmails: Signal<string[]> = this.api.compedEmails;

  // ─── Resources ─────────────────────────────────────────────────────
  readonly stats = this.res<PlatformStats | null>('stats', null,
    (force) => this.callables.call<{ refresh: boolean }, PlatformStats>('getPlatformStats', { refresh: force }));

  readonly usage = this.res<UsageSeries | null>('usage', null,
    (force) => this.callables.call<{ days: number; refresh: boolean }, UsageSeries>('adminGetUsageSeries', { days: 30, refresh: force }));

  readonly retention = this.res<RetentionSummary | null>('retention', null, () => this.api.getRetention());
  readonly retentionHistory = this.res<RetentionHistoryRow[]>('retentionHistory', [], () => this.api.getRetentionHistory());

  readonly ceilings = this.res<CeilingStatus[]>('ceilings', [],
    async () => (await this.callables.call<unknown, { ceilings: CeilingStatus[] }>('adminGetSpendCeilings', {})).ceilings);

  /** Age of the last `statusPulse` write, in minutes. Re-read every time it is
   *  asked for — a cached heartbeat is a heartbeat that cannot go stale. */
  readonly heartbeat = this.res<number | null>('heartbeat', null, () => this.api.getHeartbeatAgeMin(), 'always');

  /** What the mobile update banner is being told (the public JSON). */
  readonly storeVersions = this.res<StoreVersionDoc | null>('storeVersions', null, () => this.api.getStoreVersions());

  readonly users = this.res<AdminUserRow[]>('users', [], async () => {
    const { users } = await this.callables.call<unknown, { users: AdminUserRow[] }>('listUsers', {});
    return users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  });

  readonly activity = this.res<ActivityItem[]>('activity', [],
    async () => (await this.callables.call<unknown, { items: ActivityItem[] }>('getRecentActivity', {})).items);

  readonly audit = this.res<AuditLog[]>('audit', [], async () => {
    const { logs, hasMore } = await this.auditPage();
    this.auditHasMore.set(hasMore);
    return logs;
  });

  readonly feedback = this.res<FeedbackRow[]>('feedback', [], () => this.api.getFeedback());
  readonly costModel = this.res<CostModel | null>('costModel', null, () => this.callables.call<unknown, CostModel>('adminGetCostModel', {}));
  readonly billing = this.res<BillingReport | null>('billing', null, () => this.callables.call<unknown, BillingReport>('adminGetBilling', {}));
  readonly costLedger = this.res<LedgerItem[]>('costLedger', [], () => this.api.getCostLedger());

  /** Generic access by key: `section('users')` is the same object as `users`. */
  private readonly sections: { [K in AdminSectionKey]: AdminResource<AdminSections[K]> } = {
    stats: this.stats, usage: this.usage, retention: this.retention, retentionHistory: this.retentionHistory,
    ceilings: this.ceilings, heartbeat: this.heartbeat, storeVersions: this.storeVersions, users: this.users,
    activity: this.activity, audit: this.audit, feedback: this.feedback, costModel: this.costModel,
    billing: this.billing, costLedger: this.costLedger,
  };
  section<K extends AdminSectionKey>(key: K): AdminResource<AdminSections[K]> { return this.sections[key]; }

  // ─── Console-wide state ────────────────────────────────────────────
  /** Per-side reasons the last manual store sync left a value alone. */
  readonly storeSyncNotes = signal<string[]>([]);
  readonly auditHasMore = signal(false);
  /** Last load failure, `key: message` — the dismissible banner in the shell. */
  readonly error = signal<string>('');
  readonly lastLoadedAt = signal<Date | null>(null);
  readonly anyLoading = computed(() => this.loadingFlags.some((l) => l()));

  // ── Feedback "seen" marks are per-browser: the collection is append-only and
  //    the panel has no write path to it (by design — see admin.service).
  private static readonly SEEN_KEY = 'ignia.admin.feedbackSeen';
  readonly seenFeedback = signal<Set<string>>(AdminConsole.readSeen());
  readonly unreadFeedback = computed(() => this.feedback().filter((f) => !this.seenFeedback().has(f.id)).length);

  readonly insights = computed<Insight[]>(() => buildInsights({
    stats: this.stats(),
    usage: this.usage(),
    retention: this.retention(),
    ceilings: this.ceilings(),
    heartbeatAgeMin: this.heartbeat(),
    unreadFeedback: this.unreadFeedback(),
  }));

  private static readSeen(): Set<string> {
    try {
      const raw = localStorage.getItem(AdminConsole.SEEN_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  }

  markFeedbackSeen(ids: readonly string[]): void {
    const next = new Set(this.seenFeedback());
    for (const id of ids) next.add(id);
    this.seenFeedback.set(next);
    try { localStorage.setItem(AdminConsole.SEEN_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
  }

  /** One audit row per browser session, once the claim is confirmed. */
  noteSession(): void { this.api.noteSession(); }

  // ─── Composite loads ───────────────────────────────────────────────

  /** Everything the Overview needs, in parallel, each failure isolated: one
   *  dead callable greys out its own card, never the page. */
  async loadOverview(force = false): Promise<void> {
    await Promise.allSettled([
      ...OVERVIEW_KEYS.map((k) => this.section(k).load(force)),
      this.loadRetention(force),
    ]);
    this.lastLoadedAt.set(new Date());
  }

  /** The summary doc and its history are one thing to the operator. */
  async loadRetention(force = false): Promise<void> {
    await this.retention.load(force);
    await this.retentionHistory.load(force);
  }

  /** The "Sync now" button: re-read both stores, then show what was written. */
  syncStoreVersions(): Promise<void> {
    return this.storeVersions.replace(async () => {
      const r = await this.callables.call<unknown, StoreVersionSync>('adminSyncAppVersion', {});
      this.storeSyncNotes.set(r.notes);
      return r.doc;
    });
  }

  /** Append the next page of audit rows, oldest-first from the last one held. */
  async loadMoreAudit(): Promise<void> {
    const last = this.audit().at(-1);
    if (!last?.timestamp) return;
    await this.audit.replace(async () => {
      const { logs, hasMore } = await this.auditPage(last.timestamp ?? undefined);
      this.auditHasMore.set(hasMore);
      return [...this.audit(), ...logs];
    });
  }

  private auditPage(startAfterTimestamp?: string): Promise<{ logs: AuditLog[]; hasMore: boolean }> {
    const params = { limit: 100, ...(startAfterTimestamp ? { startAfterTimestamp } : {}) };
    return this.callables.call<typeof params, { logs: AuditLog[]; hasMore: boolean }>('getAuditLogs', params);
  }

  // ─── Commands ──────────────────────────────────────────────────────
  private readonly busyScopes = signal<Record<string, boolean>>({});

  /** True while a mutation from `scope` is running — one flag per section. */
  running(scope: string): boolean { return this.busyScopes()[scope] === true; }

  /**
   * The console's one error policy for writes: hold the section's busy flag,
   * let the body toast its own success (some bodies reload first, some after),
   * and turn any throw into a single error toast. Resolves `true` when the
   * body completed, so a caller can clear a form only on success.
   */
  async run(scope: string, body: () => Promise<void>): Promise<boolean> {
    this.busyScopes.update((b) => ({ ...b, [scope]: true }));
    try {
      await body();
      return true;
    } catch (err) {
      this.shell.toast(message(err), 'error');
      return false;
    } finally {
      this.busyScopes.update((b) => ({ ...b, [scope]: false }));
    }
  }

  // ── Bootstrap (shell)
  bootstrap(): Promise<boolean> {
    return this.run('bootstrap', async () => {
      await this.callables.call('bootstrapAdmin', {});
      await this.refreshClaim();
      this.shell.toast('Admin bootstrapped', 'ok');
    });
  }

  // ── Access
  /** Force-refresh the ID token and re-read the claim. Bare: the bootstrap
   *  card calls this before there IS a console to toast into. */
  refreshClaim(): Promise<boolean> { return this.api.refreshAdminStatus(); }

  /** The Access page's button: the same re-check, with busy + a toast. */
  recheckClaim(): Promise<boolean> {
    return this.run('access', async () => {
      await this.refreshClaim();
      this.shell.toast('Claim re-checked', 'ok');
    });
  }

  setComped(email: string, grant: boolean): Promise<boolean> {
    return this.run('access', async () => {
      await this.callables.call('adminSetCompedEmail', { email, grant });
      this.shell.toast(grant ? `${email} comped` : `${email} removed from comped`, 'ok');
    });
  }

  // ── Users
  isComped(u: AdminUserRow): boolean { return this.compedEmails().includes(u.email.toLowerCase()); }

  /** The drawer's deep record. Not cached: it is per-uid and the drawer shows
   *  its own inline failure rather than a toast. */
  getUserDetails(targetUid: string): Promise<AdminUserDetails> {
    return this.callables.call<{ targetUid: string }, AdminUserDetails>('adminGetUserDetails', { targetUid });
  }

  togglePlan(u: AdminUserRow): Promise<boolean> {
    const next = u.stripeRole === 'paid' ? null : 'paid';
    return this.run('users', async () => {
      await this.callables.call('adminOverridePlan', { targetUid: u.uid, role: next });
      this.shell.toast(`${u.email}: plan → ${next ?? 'free'}`, 'ok');
      await this.users.refresh();
    });
  }

  toggleComped(u: AdminUserRow): Promise<boolean> {
    const grant = !this.isComped(u);
    return this.run('users', async () => {
      await this.callables.call('adminSetCompedEmail', { email: u.email.toLowerCase(), grant });
      this.shell.toast(`${u.email}: ${grant ? 'comped' : 'comped removed'}`, 'ok');
    });
  }

  toggleSuspend(u: AdminUserRow): Promise<boolean> {
    return this.run('users', async () => {
      await this.callables.call('adminSuspendUser', { targetUid: u.uid, disabled: !u.disabled });
      this.shell.toast(`${u.email}: ${u.disabled ? 'unsuspended' : 'suspended'}`, 'ok');
      await this.users.refresh();
    });
  }

  resetQuotas(u: AdminUserRow): Promise<boolean> {
    return this.run('users', async () => {
      await this.callables.call('adminResetQuotas', { targetUid: u.uid });
      this.shell.toast(`${u.email}: today's AI quotas reset`, 'ok');
    });
  }

  copyPasswordLink(u: AdminUserRow): Promise<boolean> {
    return this.run('users', async () => {
      const { link } = await this.callables.call<{ targetEmail: string }, { link: string }>('adminResetPassword', { targetEmail: u.email });
      await navigator.clipboard.writeText(link);
      this.shell.toast(`Password-reset link copied for ${u.email}`, 'ok');
    });
  }

  deleteUser(u: AdminUserRow): Promise<boolean> {
    return this.run('users', async () => {
      await this.callables.call('adminDeleteUser', { targetUid: u.uid });
      this.shell.selectedUid.set(null);
      this.shell.toast(`${u.email} deleted`, 'ok');
      await this.users.refresh();
    });
  }

  // ── Exports
  /** CSV, generated server-side and handed straight to the browser. */
  exportCsv(type: 'users' | 'logs' | 'metrics'): Promise<boolean> {
    return this.run('exports', async () => {
      const { csv } = await this.callables.call<{ type: string }, { csv: string }>('adminExportData', { type });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ignia-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.shell.toast(`${type}.csv downloaded`, 'ok');
    });
  }

  // ── Cost & AI
  saveLedger(items: LedgerItem[]): Promise<boolean> {
    return this.run('cost', async () => {
      const r = await this.callables.call<{ items: LedgerItem[] }, { items: LedgerItem[] }>('adminSetCostLedger', { items });
      this.costLedger.set(r.items);
      this.shell.toast('Ledger saved', 'ok');
    });
  }

  setCeilingLimit(kind: string, limit: number): Promise<boolean> {
    return this.ceilingWrite({ kind, limit }, `${ceilingLabel(kind)} ceiling → ${limit}`);
  }

  setCeilingKill(kind: string, killed: boolean, reason: string): Promise<boolean> {
    return this.ceilingWrite({ kind, killed, reason }, `${ceilingLabel(kind)} switched ${killed ? 'OFF' : 'on'}`);
  }

  private ceilingWrite(input: { kind: string; limit?: number; killed?: boolean; reason?: string }, label: string): Promise<boolean> {
    return this.run('cost', async () => {
      await this.callables.call<typeof input, { ceiling: CeilingStatus }>('adminSetSpendCeiling', input);
      await this.ceilings.refresh();
      this.shell.toast(label, 'ok');
    });
  }

  // ─── Resource factory ──────────────────────────────────────────────
  /**
   * Build one resource. `mode` is how "already loaded" is decided:
   * `cache` — a non-null value, or a non-empty array, is enough (so an empty
   * list is retried, which is what the panel wants for append-only feeds);
   * `always` — never cached (the heartbeat).
   *
   * Nothing fetches in preview mode: `/admin?preview=1` seeds fixtures through
   * `set()` and must never reach a callable (see admin-preview.ts).
   */
  private res<T>(key: string, initial: T, op: (force: boolean) => Promise<T>, mode: 'cache' | 'always' = 'cache'): AdminResource<T> {
    const value = signal<T>(initial);
    const loading = signal(false);
    const error = signal('');
    const isList = Array.isArray(initial);

    const through = async (producer: () => Promise<T>): Promise<void> => {
      if (adminPreviewEnabled()) return;
      if (loading()) return;
      loading.set(true);
      try {
        value.set(await producer());
        error.set('');
      } catch (err) {
        error.set(message(err));
        this.error.set(`${key}: ${message(err)}`);
      } finally {
        loading.set(false);
      }
    };

    const resource = (() => value()) as AdminResource<T>;
    Object.defineProperties(resource, {
      loading: { value: loading.asReadonly() },
      error: { value: error.asReadonly() },
      set: { value: (v: T) => value.set(v) },
      replace: { value: through },
      load: {
        value: (force = false) => {
          if (mode === 'cache') {
            const current = value();
            const loaded = isList ? (current as unknown[]).length > 0 : current !== null;
            if (loaded && !force) return Promise.resolve();
          }
          return through(() => op(force));
        },
      },
      refresh: { value: () => resource.load(true) },
    });
    this.loadingFlags.push(loading);
    return resource;
  }
}
