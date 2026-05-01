import { Injectable, Injector, computed, effect, inject, runInInjectionContext, signal } from '@angular/core';
import { Auth, authState, signInWithCustomToken } from '@angular/fire/auth';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { toSignal } from '@angular/core/rxjs-interop';

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
  private readonly functions = inject(Functions);
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
    const fn = httpsCallable<unknown, { seeded: string[] }>(this.functions, 'bootstrapAdmin');
    const res = await fn({});
    return res.data;
  }

  async setAdmin(email: string, grant: boolean): Promise<void> {
    const fn = httpsCallable(this.functions, 'setAdminClaims');
    await fn({ email, grant });
  }

  async listUsers(): Promise<{ users: AdminUserRow[] }> {
    const fn = httpsCallable<unknown, { users: AdminUserRow[] }>(this.functions, 'listUsers');
    const res = await fn({});
    return res.data;
  }

  async getPlatformStats(refresh = false): Promise<PlatformStats> {
    const fn = httpsCallable<{ refresh: boolean }, PlatformStats>(this.functions, 'getPlatformStats');
    const res = await fn({ refresh });
    return res.data;
  }

  async getRecentActivity(): Promise<{ items: ActivityItem[] }> {
    const fn = httpsCallable<unknown, { items: ActivityItem[] }>(
      this.functions, 'getRecentActivity',
    );
    const res = await fn({});
    return res.data;
  }

  async getAuditLogs(params: {
    limit?: number;
    startAfterTimestamp?: string;
    actionFilter?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<{ logs: AuditLog[]; hasMore: boolean }> {
    const fn = httpsCallable<typeof params, { logs: AuditLog[]; hasMore: boolean }>(
      this.functions, 'getAuditLogs',
    );
    const res = await fn(params);
    return res.data;
  }

  async suspendUser(targetUid: string, disabled: boolean): Promise<void> {
    const fn = httpsCallable(this.functions, 'adminSuspendUser');
    await fn({ targetUid, disabled });
  }

  async deleteUser(targetUid: string): Promise<void> {
    const fn = httpsCallable(this.functions, 'adminDeleteUser');
    await fn({ targetUid });
  }

  async resetPassword(targetEmail: string): Promise<{ link: string }> {
    const fn = httpsCallable<{ targetEmail: string }, { link: string }>(
      this.functions, 'adminResetPassword',
    );
    const res = await fn({ targetEmail });
    return res.data;
  }

  async overridePlan(targetUid: string, role: string | null): Promise<void> {
    const fn = httpsCallable(this.functions, 'adminOverridePlan');
    await fn({ targetUid, role });
  }

  async setCompedEmail(email: string, grant: boolean): Promise<void> {
    const fn = httpsCallable(this.functions, 'adminSetCompedEmail');
    await fn({ email, grant });
  }

  async resetQuotas(targetUid: string): Promise<void> {
    const fn = httpsCallable(this.functions, 'adminResetQuotas');
    await fn({ targetUid });
  }

  async exportData(type: 'users' | 'logs' | 'metrics'): Promise<string> {
    const fn = httpsCallable<{ type: string }, { csv: string }>(this.functions, 'adminExportData');
    const res = await fn({ type });
    return res.data.csv;
  }

  async getUserDetails(targetUid: string): Promise<unknown> {
    const fn = httpsCallable<{ targetUid: string }, unknown>(this.functions, 'adminGetUserDetails');
    const res = await fn({ targetUid });
    return res.data;
  }

  // ─── Impersonation ────────────────────────────────────────────

  async impersonate(targetEmail: string): Promise<void> {
    const originalUid = this.auth.currentUser?.uid;
    if (!originalUid) throw new Error('Not signed in.');

    const fn = httpsCallable<{ targetEmail: string }, { customToken: string }>(
      this.functions, 'startImpersonation',
    );
    const res = await fn({ targetEmail });

    // Capture BEFORE the sign-in swap so a refresh mid-swap still
    // remembers where to return to.
    localStorage.setItem(IMPERSONATION_KEY, originalUid);
    this.originalAdminUid.set(originalUid);

    await signInWithCustomToken(this.auth, res.data.customToken);
  }

  async stopImpersonating(): Promise<void> {
    const originalUid = this.originalAdminUid();
    if (!originalUid) throw new Error('Not impersonating.');
    const fn = httpsCallable<{ originalUid: string }, { customToken: string }>(
      this.functions, 'stopImpersonation',
    );
    const res = await fn({ originalUid });
    await signInWithCustomToken(this.auth, res.data.customToken);
    localStorage.removeItem(IMPERSONATION_KEY);
    this.originalAdminUid.set(null);
  }

  cleanup(): void {
    this.unsubAdmins?.();
    this.unsubComped?.();
  }
}
