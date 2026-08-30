import { Injectable, Injector, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { Auth, authState, signInWithCustomToken } from '@angular/fire/auth';
import { Firestore, collectionGroup, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query } from '@angular/fire/firestore';
import type { CeilingStatus, RetentionSummary, UsageSeries } from '../components/admin/admin-insights';
import { toSignal } from '@angular/core/rxjs-interop';
import { CallableGateway } from './callable.gateway';

/**
 * Seed admin emails — kept in sync with SEED_ADMINS in
 * functions/src/admin-claims.ts and ADMIN_EMAILS in functions/src/caller-access.ts.
 * Used only to show the "Bootstrap Admin" CTA before any admin custom
 * claim has been minted. Post-bootstrap, access is gated purely on the
 * custom claim.
 */
const SEED_ADMIN_EMAILS = new Set<string>(['gabrielandresbermudez@gmail.com']);

export interface AuditLog {
  id: string;
  action: string;
  adminUid: string;
  adminEmail: string;
  targetUid?: string;
  targetEmail?: string;
  details?: Record<string, unknown>;
  timestamp: string | null;
}

/** One in-app feedback report, as the admin panel shows it. Read straight
 *  from Firestore over the admin-only collection-group rule — no callable in
 *  between, because there is nothing to compute and a Cloud Function here
 *  would just add a cold start to a list query. */
export interface FeedbackRow {
  id: string;
  /** Owner of the subcollection the doc lives in, recovered from the path —
   *  the document itself does not carry a uid field. */
  uid: string;
  message: string;
  category: string;
  appVersion: string;
  platform: string;
  locale: string;
  createdAt: string | null;
}

export interface AdminUserRow {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  providers: string[];
  admin: boolean;
  profileCompleted: boolean;
  stripeRole: string | null;
  preferredLocale: string | null;
  /** Active day-documents per platform, last 90 days (`usageEvents`). Empty = never opened an app since the counters shipped. */
  platforms: Record<string, number>;
  lastActiveDay: string | null;
  activeDays90: number;
}

export interface PlatformStats {
  totalUsers: number;
  newUsers1d: number;
  newUsers7d: number;
  newUsers30d: number;
  verifiedCount: number;
  disabledCount: number;
  providersBreakdown: Record<string, number>;
  active7d: number;
  active30d: number;
  activePaidSubs: number;
  compedCount: number;
  estimatedMRR: number;
  // Activation funnel: counts that let me see whether new users are
  // making it through onboarding and reaching the first-entry "aha"
  // moment. Computed by getPlatformStats from the users + dailyLogs
  // collections.
  profileCompletedCount: number;
  onboardingV2CompletedCount: number;
  usersWithFirstEntryCount: number;
  // Referral-funnel signals — derived from the same profile aggregate
  // read; tells me where invest next (top of funnel vs activation latency
  // vs reward conversion). Optional because older cached docs may pre-date
  // these fields.
  signupsViaReferralCount?: number;
  referralRewardGrantedCount?: number;
  currentlyCompedCount?: number;
  firstEntryWithin24hCount?: number;
  firstEntryWithin72hCount?: number;
}

export interface AdminUserDetails {
  user: AdminUserRow;
  profile: Record<string, unknown> | null;
  counts: { dailyLogs: number; presets: number; reports: number; measurements: number };
  subscriptions: Array<{ id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean }>;
}

export interface CostLine {
  service: string; sku: string; usage: number; unit: string; freeAllowance: number; billableUsage: number;
  unitPrice: number; perUnit: string; cost: number; note?: string;
}
export interface CostModel {
  computedAt: string; pricesAsOf: string; month: string; daysElapsed: number; daysInMonth: number;
  monthToDate: number; projectedMonth: number; byService: Record<string, number>; lines: CostLine[];
  perFunction: Array<{ name: string; requests: number; instanceSeconds: number; vcpuSeconds: number; gibSeconds: number }>;
  ai: {
    kinds: Record<string, { calls: number; promptTokens: number; outputTokens: number; thoughtTokens: number; images: number }>;
    models: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; cost: number; priceKnown: boolean }>;
    byDay: Record<string, number>;
  } | null;
  firestoreByDay: { reads: Record<string, number>; writes: Record<string, number>; deletes: Record<string, number> };
  warnings: string[];
}
export type BillingRow = Record<string, string | null>;
export interface BillingReport {
  enabled: boolean; reason?: string; table?: string; queriedAt?: string;
  byMonth?: BillingRow[]; byProjectService?: BillingRow[]; bySku?: BillingRow[]; lifetime?: BillingRow[];
}
export interface LedgerItem { id: string; label: string; amountUsd: number; cadence: 'monthly' | 'yearly' | 'once'; note?: string; }

export interface RetentionHistoryRow {
  date: string;
  activatedTotal: number;
  logsPerActivatedUserPerDay: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export type ActivityItemType = 'signup' | 'entry';

export interface ActivityItem {
  type: ActivityItemType;
  uid: string;
  email: string | null;
  timestamp: string;       // ISO
  detail?: string;         // e.g. "Lunch · 540 kcal" for entries
}

/** localStorage key for the original-admin uid captured before an
 *  impersonation swap. Survives page reloads so the admin can return
 *  to their own account even if they refreshed mid-impersonation. */
const IMPERSONATION_KEY = 'macrolog.admin.originalUid';

/**
 * Admin panel client service. Mirrors the subscription.service pattern:
 * signal-based state, Firestore snapshot listeners for shared-state docs
 * (config/admins, config/accessList), callable wrappers for ops.
 *
 * Security model: `isAdmin` fires ONLY when the Firebase custom claim is
 * present — email match alone is not enough to render the panel. The
 * email check exists purely to show the "Bootstrap" CTA on a fresh
 * project where no admin has been minted yet.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private readonly callables = inject(CallableGateway);
  private readonly injector = inject(Injector);

  private readonly authedUser = toSignal(authState(this.auth));

  /** True once we've resolved the admin claim check for the current user. */
  readonly ready = signal(false);
  /** True when the current Firebase user holds the `admin` custom claim. */
  readonly isAdmin = signal(false);
  /** Emails currently present in config/admins. Updated via snapshot. */
  /** Emails currently present in config/accessList.compedEmails. */
  readonly compedEmails = signal<string[]>([]);

  /** True when the signed-in user's email is a seed admin but no claim
   *  has been set yet (fresh project / pre-bootstrap state). */
  readonly canBootstrap = computed(() => {
    const email = this.authedUser()?.email ?? null;
    return !!email && SEED_ADMIN_EMAILS.has(email) && !this.isAdmin();
  });

  /** Uid of the original admin when an impersonation session is active.
   *  Null outside impersonation. Persisted in localStorage so refresh
   *  doesn't lock the admin out of their own account. */
  readonly originalAdminUid = signal<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem(IMPERSONATION_KEY) : null,
  );
  readonly impersonating = computed(() => this.originalAdminUid() !== null);

  private unsubComped: (() => void) | null = null;
  private adminCheckPromise: Promise<void> | null = null;

  constructor() {
    // Every time the auth user flips, re-run the claim check. Snapshot
    // listeners track config docs independently because admins need to
    // see themselves after a grant before their own claim has refreshed.
    effect(() => {
      const user = this.authedUser();
      if (user) {
        this.adminCheckPromise = this.checkAdminClaim();
      } else {
        this.isAdmin.set(false);
        this.ready.set(true);
      }
    });

    this.subscribeConfigDocs();
  }

  private subscribeConfigDocs(): void {
    const compedRef = doc(this.firestore, 'config', 'accessList');
    this.unsubComped = onSnapshot(
      compedRef,
      (snap) => runInInjectionContext(this.injector, () => {
        this.compedEmails.set(snap.exists() ? (snap.data()?.['compedEmails'] as string[] || []) : []);
      }),
      () => runInInjectionContext(this.injector, () => this.compedEmails.set([])),
    );
  }

  private async checkAdminClaim(): Promise<void> {
    this.ready.set(false);
    const user = this.auth.currentUser;
    if (!user) {
      this.isAdmin.set(false);
      this.ready.set(true);
      return;
    }
    try {
      const result = await user.getIdTokenResult();
      this.isAdmin.set(result.claims['admin'] === true);
    } catch {
      // First attempt after refresh can fail transiently; force-refresh once.
      try {
        const result = await user.getIdTokenResult(true);
        this.isAdmin.set(result.claims['admin'] === true);
      } catch {
        this.isAdmin.set(false);
      }
    } finally {
      this.ready.set(true);
    }
  }

  /** Force-refresh the ID token and re-evaluate the claim. Call after
   *  setAdmin so the panel stops hiding tabs that just became visible. */
  async refreshAdminStatus(): Promise<boolean> {
    const user = this.auth.currentUser;
    if (!user) return false;
    try {
      const result = await user.getIdTokenResult(true);
      const admin = result.claims['admin'] === true;
      this.isAdmin.set(admin);
      return admin;
    } catch {
      this.isAdmin.set(false);
      return false;
    }
  }

  /** Waits for any in-flight admin check to settle. Used by the route
   *  guard so we don't flash a redirect before the first claim read. */
  async ensureChecked(): Promise<void> {
    if (this.adminCheckPromise) await this.adminCheckPromise;
  }

  // ─── Callable wrappers ─────────────────────────────────────────

  async bootstrap(): Promise<{ seeded: string[] }> {
    return this.callables.call<unknown, { seeded: string[] }>('bootstrapAdmin', {});
  }

  async listUsers(): Promise<{ users: AdminUserRow[] }> {
    return this.callables.call<unknown, { users: AdminUserRow[] }>('listUsers', {});
  }

  async getPlatformStats(refresh = false): Promise<PlatformStats> {
    return this.callables.call<{ refresh: boolean }, PlatformStats>('getPlatformStats', { refresh });
  }

  async getRecentActivity(): Promise<{ items: ActivityItem[] }> {
    return this.callables.call<unknown, { items: ActivityItem[] }>('getRecentActivity', {});
  }

  async getAuditLogs(params: {
    limit?: number;
    startAfterTimestamp?: string;
    actionFilter?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<{ logs: AuditLog[]; hasMore: boolean }> {
    return this.callables.call<typeof params, { logs: AuditLog[]; hasMore: boolean }>(
      'getAuditLogs', params,
    );
  }

  /**
   * Every user's feedback, newest first.
   *
   * `collectionGroup` needs its OWN index — a collection-group query does not
   * inherit the automatic single-field one — so `firestore.indexes.json`
   * carries a `feedback`/`createdAt` fieldOverride. Without it this fails with
   * FAILED_PRECONDITION rather than returning nothing, which at least says so.
   */
  async getFeedback(max = 200): Promise<FeedbackRow[]> {
    const q = query(
      collectionGroup(this.firestore, 'feedback'),
      orderBy('createdAt', 'desc'),
      limit(max),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const createdAt = data['createdAt'] as { toDate?: () => Date } | undefined;
      return {
        id: d.id,
        uid: d.ref.parent.parent?.id ?? '—',
        message: String(data['message'] ?? ''),
        category: String(data['category'] ?? 'none'),
        appVersion: String(data['appVersion'] ?? '—'),
        platform: String(data['platform'] ?? '—'),
        locale: String(data['locale'] ?? '—'),
        createdAt: createdAt?.toDate ? createdAt.toDate().toISOString() : null,
      };
    });
  }

  async suspendUser(targetUid: string, disabled: boolean): Promise<void> {
    await this.callables.call('adminSuspendUser', { targetUid, disabled });
  }

  async deleteUser(targetUid: string): Promise<void> {
    await this.callables.call('adminDeleteUser', { targetUid });
  }

  async resetPassword(targetEmail: string): Promise<{ link: string }> {
    return this.callables.call<{ targetEmail: string }, { link: string }>(
      'adminResetPassword', { targetEmail },
    );
  }

  async overridePlan(targetUid: string, role: string | null): Promise<void> {
    await this.callables.call('adminOverridePlan', { targetUid, role });
  }

  async setCompedEmail(email: string, grant: boolean): Promise<void> {
    await this.callables.call('adminSetCompedEmail', { email, grant });
  }

  async resetQuotas(targetUid: string): Promise<void> {
    await this.callables.call('adminResetQuotas', { targetUid });
  }

  async exportData(type: 'users' | 'logs' | 'metrics'): Promise<string> {
    const { csv } = await this.callables.call<{ type: string }, { csv: string }>(
      'adminExportData', { type },
    );
    return csv;
  }

  async getUserDetails(targetUid: string): Promise<AdminUserDetails> {
    return this.callables.call<{ targetUid: string }, AdminUserDetails>('adminGetUserDetails', { targetUid });
  }

  // ─── Product-health reads (ADR-0036 admin revamp) ──────────────

  /** DAU/WAU/MAU and per-day platform + event totals, aggregated server-side
   *  because `usageEvents` is owner-read only in the rules. Cached 5 min. */
  async getUsageSeries(days = 30, refresh = false): Promise<UsageSeries> {
    return this.callables.call<{ days: number; refresh: boolean }, UsageSeries>('adminGetUsageSeries', { days, refresh });
  }

  /** `config/retention`, written daily by the hourly dispatcher. Admin-read
   *  under the `config/{doc}` rule, so no callable is needed. */
  async getRetention(): Promise<RetentionSummary | null> {
    const snap = await getDoc(doc(this.firestore, 'config', 'retention'));
    return snap.exists() ? (snap.data() as RetentionSummary) : null;
  }

  async getRetentionHistory(): Promise<RetentionHistoryRow[]> {
    const snap = await getDoc(doc(this.firestore, 'config', 'retentionHistory'));
    const days = snap.exists() ? (snap.data()?.['days'] as RetentionHistoryRow[] | undefined) : undefined;
    return Array.isArray(days) ? days : [];
  }

  /** Age of the last `statusPulse` write, in minutes. Null when unreadable. */
  async getHeartbeatAgeMin(): Promise<number | null> {
    try {
      const snap = await getDoc(doc(this.firestore, 'status', 'heartbeat'));
      const ts = snap.data()?.['lastPulseAt'] as { toMillis?: () => number } | undefined;
      const ms = ts?.toMillis?.();
      return typeof ms === 'number' ? (Date.now() - ms) / 60_000 : null;
    } catch {
      return null;
    }
  }

  async getSpendCeilings(): Promise<CeilingStatus[]> {
    const { ceilings } = await this.callables.call<unknown, { ceilings: CeilingStatus[] }>('adminGetSpendCeilings', {});
    return ceilings;
  }

  /** Audit "the console was opened" once per browser session. Fire-and-forget. */
  noteSession(): void {
    try {
      if (sessionStorage.getItem('ignia.admin.sessionNoted') === '1') return;
      sessionStorage.setItem('ignia.admin.sessionNoted', '1');
    } catch { /* private mode — note it anyway */ }
    void this.callables.call('adminNoteSession', {
      userAgent: navigator.userAgent,
      release: String((globalThis as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev').slice(0, 8),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    }).catch(() => undefined);
  }

  // ─── Cost page ─────────────────────────────────────────────────

  async getCostModel(): Promise<CostModel> {
    return this.callables.call<unknown, CostModel>('adminGetCostModel', {});
  }

  async getBilling(): Promise<BillingReport> {
    return this.callables.call<unknown, BillingReport>('adminGetBilling', {});
  }

  /** `config/costLedger` — admin-read under the config rule. */
  async getCostLedger(): Promise<LedgerItem[]> {
    const snap = await getDoc(doc(this.firestore, 'config', 'costLedger'));
    const items = snap.exists() ? (snap.data()?.['items'] as LedgerItem[] | undefined) : undefined;
    return Array.isArray(items) ? items : [];
  }

  async setCostLedger(items: LedgerItem[]): Promise<LedgerItem[]> {
    const r = await this.callables.call<{ items: LedgerItem[] }, { items: LedgerItem[] }>('adminSetCostLedger', { items });
    return r.items;
  }

  async setSpendCeiling(input: { kind: string; limit?: number; killed?: boolean; reason?: string }): Promise<CeilingStatus> {
    const { ceiling } = await this.callables.call<typeof input, { ceiling: CeilingStatus }>('adminSetSpendCeiling', input);
    return ceiling;
  }

  // ─── Impersonation ────────────────────────────────────────────

  async impersonate(targetEmail: string): Promise<void> {
    const originalUid = this.auth.currentUser?.uid;
    if (!originalUid) throw new Error('Not signed in.');

    const { customToken } = await this.callables.call<
      { targetEmail: string }, { customToken: string }
    >('startImpersonation', { targetEmail });

    // Capture BEFORE the sign-in swap so a refresh mid-swap still
    // remembers where to return to.
    localStorage.setItem(IMPERSONATION_KEY, originalUid);
    this.originalAdminUid.set(originalUid);

    await signInWithCustomToken(this.auth, customToken);
  }

  async stopImpersonating(): Promise<void> {
    const originalUid = this.originalAdminUid();
    if (!originalUid) throw new Error('Not impersonating.');
    const { customToken } = await this.callables.call<
      { originalUid: string }, { customToken: string }
    >('stopImpersonation', { originalUid });
    await signInWithCustomToken(this.auth, customToken);
    localStorage.removeItem(IMPERSONATION_KEY);
    this.originalAdminUid.set(null);
  }

  cleanup(): void {
    this.unsubComped?.();
  }
}
