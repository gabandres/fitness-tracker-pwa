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
   * Atomically consume one slot of today's quota. Throws
   * `resource-exhausted` with the kind's ErrorCode + `{ limit }` details
   * when the cap is already reached (the slot is NOT consumed).
   */
  async reserve(uid: string, kind: QuotaKind, paid: boolean): Promise<{ usedAfter: number; remaining: number }> {
    const cfg = KINDS[kind];
    const limit = this.limitFor(kind, paid);
    const today = utcDayKey();
    const ref = this.ref(kind, uid, today);
    let usedAfter = 1;
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const used: number = doc.exists ? (doc.data()!.count as number) : 0;
      if (used >= limit) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily limit of ${limit} ${cfg.label} reached. Resets at midnight UTC.`,
          { code: cfg.exceededCode, limit },
        );
      }
      usedAfter = used + 1;
      tx.set(ref, { count: usedAfter, uid, date: today }, { merge: true });
    });
    return { usedAfter, remaining: limit - usedAfter };
  }

  /**
   * Refund one previously-reserved slot. Will not go below zero — a bad
   * client can't build up credit by spam-calling release. Returns false
   * when there was nothing to refund.
   */
  async release(uid: string, kind: QuotaKind): Promise<boolean> {
    const ref = this.ref(kind, uid, utcDayKey());
    let released = false;
    await this.db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return;
      const used: number = doc.data()!.count as number;
      if (used <= 0) return;
      tx.set(ref, { count: used - 1 }, { merge: true });
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
