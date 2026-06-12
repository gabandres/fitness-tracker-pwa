import { Firestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";

// ─── Admin bypass list ────────────────────────────────────────────
// Emails listed here skip all per-user quotas (consultations, photos)
// and behave like paid subscribers server-side. Keep this in sync
// with ADMIN_EMAILS in src/app/services/subscription.service.ts —
// the two projects can't share code, so it's a deliberate duplicate.
const ADMIN_EMAILS = new Set([
  "gabrielandresbermudez@gmail.com",
]);

/** Resolved access tier, most privileged first. `admin` and `comped`
    are the "unlimited" tiers — they bypass daily quotas entirely. */
export type CallerTier = "admin" | "comped" | "paid" | "free";

export interface Caller {
  uid: string;
  email: string | undefined;
  tier: CallerTier;
  /** true for admin + comped — the quota-bypass tiers. */
  unlimited: boolean;
  /** Raw `stripeRole === "paid"` claim. Tiers are mutually exclusive
      (admin/comped outrank paid), so an unlimited caller who ALSO pays
      needs this to keep seeing paid-cap numbers in decorative UI. */
  paidClaim: boolean;
}

/** Per-uid minimum-interval rate limit, run before tier resolution so a
    throttled call never costs a Firestore profile read. */
export interface RateLimitSpec {
  collection: string;
  minIntervalMs: number;
  errorCode: ErrorCode;
}

/** Structural subset of CallableRequest — lets tests fabricate callers
    without constructing a full firebase-functions request. */
export interface CallerRequestLike {
  auth?: {
    uid: string;
    token: { email?: string; stripeRole?: string } & Record<string, unknown>;
  } | null;
}

// Both comped sources are cached in memory per function instance to
// avoid hammering Firestore on every quota check. Newly-granted access
// takes up to 60s to pick up; acceptable tradeoff for simpler code.
const ACCESS_CACHE_TTL_MS = 60_000;

/**
 * Who is calling, and what are they entitled to?
 *
 * The single home for the caller-access preamble every callable used to
 * re-implement: auth check, per-uid rate limit, and tier resolution.
 * Tier folds together all three privilege sources:
 *
 *   - admin  — ADMIN_EMAILS above
 *   - comped — /config/accessList `compedEmails` (friends-and-family)
 *              OR a future `compedUntil` Timestamp on the user profile
 *              (referral reward). Both grant the same unlimited tier —
 *              everywhere, not just in the UI badge.
 *   - paid   — Stripe custom claim `stripeRole === "paid"`
 *   - free   — everyone else
 */
export class CallerAccess {
  private accessListCache: { emails: Set<string>; fetchedAt: number } | null = null;
  private readonly compedUntilCache = new Map<string, { until: number | null; fetchedAt: number }>();

  constructor(private readonly db: Firestore) {}

  /** Test hook — drop the 60s caches so grants are visible immediately. */
  clearCaches(): void {
    this.accessListCache = null;
    this.compedUntilCache.clear();
  }

  isAdmin(email: string | undefined | null): boolean {
    return !!email && ADMIN_EMAILS.has(email);
  }

  /**
   * Resolve the caller or throw. Order: auth → rate limit → tier.
   * Throws UNAUTHENTICATED when unauthenticated and the spec'd rate-limit
   * error when called too soon after the previous call.
   */
  async resolveCaller(request: CallerRequestLike, rateLimit?: RateLimitSpec): Promise<Caller> {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }
    const uid = request.auth.uid;
    const email = request.auth.token.email;

    if (rateLimit) {
      await this.enforceRateLimit(rateLimit.collection, uid, rateLimit.minIntervalMs, rateLimit.errorCode);
    }

    const stripeRole = request.auth.token.stripeRole;
    const tier = await this.resolveTier(uid, email, stripeRole);
    return {
      uid,
      email,
      tier,
      unlimited: tier === "admin" || tier === "comped",
      paidClaim: stripeRole === "paid",
    };
  }

  /**
   * Enforce a per-uid minimum interval on the given rate-limit collection.
   * Reads the last-call timestamp, throws if too recent, writes the new one.
   * Public for the rare callable that rate-limits without needing a tier
   * (e.g. the unauthenticated checkAccessStatus path).
   */
  async enforceRateLimit(
    collectionName: string,
    uid: string,
    minIntervalMs: number,
    errorCode: ErrorCode,
  ): Promise<void> {
    const ref = this.db.collection(collectionName).doc(uid);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const last = (snap.data()?.lastCallAt as Timestamp | undefined)?.toMillis() ?? 0;
      const now = Date.now();
      if (last && now - last < minIntervalMs) {
        throw new HttpsError(
          "resource-exhausted",
          "Too many requests. Please slow down.",
          { code: errorCode, retryAfterMs: minIntervalMs - (now - last) },
        );
      }
      tx.set(ref, { lastCallAt: Timestamp.now(), uid }, { merge: true });
    });
  }

  private async resolveTier(
    uid: string,
    email: string | undefined,
    stripeRole: string | undefined,
  ): Promise<CallerTier> {
    if (this.isAdmin(email)) return "admin";
    if (await this.isCompedByList(email)) return "comped";
    if (await this.isCompedByReferral(uid)) return "comped";
    return stripeRole === "paid" ? "paid" : "free";
  }

  // Friends the owner has comped for free access. Lives at
  //   /config/accessList  { compedEmails: string[] }
  // Edit via the Firebase console — no redeploy needed.
  private async isCompedByList(email: string | undefined | null): Promise<boolean> {
    if (!email) return false;
    const now = Date.now();
    if (!this.accessListCache || now - this.accessListCache.fetchedAt >= ACCESS_CACHE_TTL_MS) {
      const snap = await this.db.doc("config/accessList").get();
      const emails = new Set<string>(
        ((snap.data()?.compedEmails as string[] | undefined) ?? [])
          .map((e) => e.trim().toLowerCase())
          .filter((e) => !!e),
      );
      this.accessListCache = { emails, fetchedAt: now };
    }
    return this.accessListCache.emails.has(email.toLowerCase());
  }

  // Referral reward: the referral trigger stamps `compedUntil` on the
  // user profile. A future timestamp grants the same comped tier as the
  // accessList. Cached per-uid with the same 60s TTL.
  private async isCompedByReferral(uid: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.compedUntilCache.get(uid);
    if (cached && now - cached.fetchedAt < ACCESS_CACHE_TTL_MS) {
      return cached.until !== null && cached.until > now;
    }
    const snap = await this.db.doc(`users/${uid}`).get();
    const compedUntil = snap.exists ? (snap.data()?.["compedUntil"] as Timestamp | undefined) : undefined;
    const until = compedUntil ? compedUntil.toMillis() : null;
    this.compedUntilCache.set(uid, { until, fetchedAt: now });
    return until !== null && until > now;
  }
}
