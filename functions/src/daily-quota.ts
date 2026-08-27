import { DocumentData, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";

/** The two daily-capped features. Each maps to its own quota collection
    with docs keyed `${uid}_${utcDay}` carrying `{ count, uid, date }`. */
export type QuotaKind = "photo" | "consultation";

interface KindConfig {
  collection: string;
  exceededCode: ErrorCode;
  /** Human label for the over-limit server-log message. */
  label: string;
  limitFree: number;
  limitPaid: number;
}

// Tiered per-user daily caps (UTC). Admins + comped users bypass the
// quota entirely — callers check `Caller.unlimited` and never reserve.
// The freemium table in the UX plan promises 3/day free, 30/day paid.
const KINDS: Record<QuotaKind, KindConfig> = {
  photo: {
    collection: "photoQuota",
    exceededCode: ErrorCode.PHOTO_QUOTA_EXCEEDED,
    label: "photo analyses",
    limitFree: 3,
    limitPaid: 30,
  },
  consultation: {
    collection: "consultationQuota",
    exceededCode: ErrorCode.CONSULTATION_QUOTA_EXCEEDED,
    label: "consultations",
    limitFree: 3,
    limitPaid: 30,
  },
};

const ALL_KINDS = Object.keys(KINDS) as QuotaKind[];

/** YYYY-MM-DD in UTC — quotas reset at UTC midnight. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().split("T")[0];
}

/**
 * The daily-quota ledger. One module owns both quota collections —
 * doc-key format, the reserve transaction, the never-below-zero refund,
 * the per-tier limits, and the GDPR delete/export walks. Callables only
 * decide *whether* a caller is subject to quota; this module decides
 * everything about *how* a quota behaves.
 */
export class DailyQuota {
  constructor(private readonly db: Firestore) {}

  /** Daily cap for a billing tier. Unlimited tiers never reach quota
      code; they display the paid cap as a decorative ceiling. */
  limitFor(kind: QuotaKind, paid: boolean): number {
    const cfg = KINDS[kind];
    return paid ? cfg.limitPaid : cfg.limitFree;
  }

  /**
   * Atomically consume `units` slots of today's quota. Throws
   * `resource-exhausted` with the kind's ErrorCode + `{ limit }` details
   * when the cap would be exceeded (NOTHING is consumed).
   *
   * ## Why this counts units and not calls (ADR-0029 item 5)
   *
   * A photo scan used to be one call and one image, so "one call" and "one
   * unit of spend" were the same number and the distinction never surfaced.
   * Multi-image capture breaks that: three photos in one call cost roughly
   * three times the image tokens against what used to be a single slot.
   *
   * The exact multiplier is smaller than it sounds — measured 2026-08-26, a
   * 3-image scan is **~1.4x** a 1-image scan, not 3x, because output tokens
   * are two thirds of the cost at $2.50/MTok and do not scale with image
   * count. **The reason to count units is not the size of the multiplier, it
   * is that an uncounted one is unbounded.** A guard whose unit is wrong stops
   * being a guard the moment the feature it guards changes shape.
   *
   * All-or-nothing on purpose: reserving 2 of a requested 3 would charge a user
   * for a scan they never received.
   */
  async reserve(
    uid: string,
    kind: QuotaKind,
    paid: boolean,
    units = 1,
  ): Promise<{ usedAfter: number; remaining: number; day: string }> {
    const cfg = KINDS[kind];
    const limit = this.limitFor(kind, paid);
    const today = utcDayKey();
    const ref = this.ref(kind, uid, today);
    let usedAfter = 1;
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const used: number = doc.exists ? (doc.data()!.count as number) : 0;
      // `used + units > limit`, not `used >= limit`: a 3-image scan with 1 slot
      // left must be refused rather than allowed to overshoot to 3-of-3.
      if (used + units > limit) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily limit of ${limit} ${cfg.label} reached. Resets at midnight UTC.`,
          { code: cfg.exceededCode, limit },
        );
      }
      usedAfter = used + units;
      tx.set(ref, { count: usedAfter, uid, date: today }, { merge: true });
    });
    // `day` is returned so a caller refunding this reservation can target the
    // doc that was actually charged. A request that starts at 23:59:59 and
    // fails at 00:00:01 would otherwise refund the NEXT day's counter, which
    // hands the user a free scan tomorrow and leaves today's overcharge in
    // place — wrong in both directions at once.
    return { usedAfter, remaining: limit - usedAfter, day: today };
  }

  /**
   * Refund previously-reserved slots. Will not go below zero — a bad client
   * can't build up credit by spam-calling release. Returns false when there
   * was nothing to refund.
   *
   * Pass the `day` from the matching {@link reserve} call. It defaults to
   * today only for callers that cannot have crossed a UTC midnight; anything
   * that awaits a model between reserve and release should pass it explicitly.
   *
   * **`units` used to be accepted and then ignored — the body always refunded
   * exactly 1.** That was harmless while every caller reserved one slot, and it
   * stopped being harmless on 2026-08-26 when `analyzePhoto` briefly reserved
   * one per image: a failed 3-image scan charged three and refunded one,
   * permanently overcharging the user by two, silently, on the path that only
   * runs when something has already gone wrong. `analyzePhoto` reserves 1 again
   * so nothing is currently exposed to it — this is fixed because a parameter
   * that lies is a trap set for the next caller, not because anything is broken
   * today.
   */
  async release(uid: string, kind: QuotaKind, day: string = utcDayKey(), units = 1): Promise<boolean> {
    const ref = this.ref(kind, uid, day);
    let released = false;
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const used: number = doc.data()!.count as number;
      if (used <= 0) return;
      // Clamped at zero rather than trusting the caller: an over-large refund
      // is how a client mints credit.
      tx.set(ref, { count: Math.max(0, used - Math.max(1, units)) }, { merge: true });
      released = true;
    });
    return released;
  }

  /** Slots used today (0 when no doc yet). Plain read, no transaction. */
  async peek(uid: string, kind: QuotaKind): Promise<number> {
    const snap = await this.ref(kind, uid, utcDayKey()).get();
    return snap.exists ? (snap.data()!.count as number) : 0;
  }

  /** Admin knob: clear today's docs for both kinds so a user who hit the
      cap via a stuck client retry gets their slots back. */
  async resetToday(uid: string): Promise<void> {
    const today = utcDayKey();
    await Promise.all(
      ALL_KINDS.map((kind) => this.ref(kind, uid, today).delete().catch(() => undefined)),
    );
  }

  /** GDPR delete: remove every quota doc the uid ever wrote, both kinds. */
  async deleteAll(uid: string): Promise<void> {
    for (const kind of ALL_KINDS) {
      const snap = await this.db.collection(KINDS[kind].collection).where("uid", "==", uid).get();
      if (!snap.empty) {
        const batch = this.db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }

  /** GDPR export: every quota doc for the uid in one kind's collection. */
  async dump(uid: string, kind: QuotaKind): Promise<Array<{ id: string } & DocumentData>> {
    const snap = await this.db.collection(KINDS[kind].collection).where("uid", "==", uid).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  private ref(kind: QuotaKind, uid: string, day: string) {
    return this.db.collection(KINDS[kind].collection).doc(`${uid}_${day}`);
  }
}
