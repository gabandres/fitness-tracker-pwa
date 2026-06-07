import { Injectable, Injector, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { Auth, authState, signInWithCustomToken } from '@angular/fire/auth';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { CallableGateway } from './callable.gateway';

/**
 * Seed admin emails — kept in sync with SEED_ADMINS in
 * functions/src/admin-claims.ts and ADMIN_EMAILS in subscription.service.ts.
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
  readonly adminEmails = signal<string[]>([]);
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

  private unsubAdmins: (() => void) | null = null;
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
    const adminsRef = doc(this.firestore, 'config', 'admins');
    this.unsubAdmins = onSnapshot(
      adminsRef,
      (snap) => runInInjectionContext(this.injector, () => {
        this.adminEmails.set(snap.exists() ? (snap.data()?.['emails'] as string[] || []) : []);
      }),
      () => runInInjectionContext(this.injector, () => this.adminEmails.set([])),
    );

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

  async setAdmin(email: string, grant: boolean): Promise<void> {
    await this.callables.call('setAdminClaims', { email, grant });
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

  async getUserDetails(targetUid: string): Promise<unknown> {
    return this.callables.call<{ targetUid: string }, unknown>('adminGetUserDetails', { targetUid });
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
    this.unsubAdmins?.();
    this.unsubComped?.();
  }
}
