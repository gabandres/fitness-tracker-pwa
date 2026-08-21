import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";
import { utcDayKey, type QuotaKind } from "./daily-quota";

/**
 * Org-wide spend guard for the AI-cost features.
 *
 * ## Why this exists alongside DailyQuota
 *
 * `DailyQuota` caps what ONE user can spend in a day. It cannot cap what
 * EVERYONE can spend in a day, and those are different risks. A free photo
 * tier scales the AI bill with people who never pay: 10,000 active free users
 * at 3 scans a week is ~$6,200/yr with no revenue attached, and every one of
 * those calls is individually within its per-user quota. Per-user limits are a
 * fairness mechanism; this is a solvency mechanism.
 *
 * ## Two controls, and conflating them is the trap
 *
 * | | Resets | Set by | For |
 * |---|---|---|---|
 * | **ceiling** (`limit`) | UTC midnight, automatically | config | "today got expensive" |
 * | **kill-switch** (`killed`) | never — only a human clears it | admin | "stop, something is wrong" |
 *
 * The ceiling self-clears because tomorrow is a new budget. The kill-switch
 * does **not**, and that is the whole point of having one: a switch that turns
 * itself back on at midnight is not a kill-switch, it is a delay. If a key
 * leaks at 23:50, an auto-clearing switch protects you for ten minutes.
 *
 * ## Ordering: read first, write after
 *
 * {@link check} is a plain read run BEFORE the per-user reserve; {@link record}
 * is the transactional increment run AFTER the call is authorized. That order
 * matters. If the global counter were incremented first, every ordinary
 * "you hit your own daily limit" rejection would leak a count against the org
 * ceiling, and the ceiling would drift down over a day of normal rejections.
 *
 * The cost is a race: two calls can pass {@link check} concurrently and both
 * be recorded, so the ceiling can be overshot by roughly the number of
 * in-flight requests. That is fine and deliberate. This is a budget guard, not
 * an invariant — overshooting a 2,000/day ceiling by five calls is two cents.
 * Making it exact would mean a transaction on the same document for every
 * request, which serializes every AI call in the product through one Firestore
 * doc and buys nothing.
 *
 * ## Admins are counted, never blocked
 *
 * Admin and comped callers bypass `DailyQuota` entirely, but their calls cost
 * the same real money, so they are **recorded**. They are not **checked** —
 * if the ceiling has tripped or the switch is thrown, the owner still needs to
 * be able to use the feature to find out why. A guard that locks out the person
 * diagnosing the incident is a worse guard.
 */

/** Server-only collection. Denied to all clients in `firestore.rules`. */
const COLLECTION = "opsBudget";

/**
 * Default daily ceilings, used until an admin sets one explicitly.
 *
 * Sized as runaway-protection, NOT as a business limit — they should sit well
 * above any plausible real day so that hitting one is a signal, not a routine
 * event. At Haiku-4.5 itemiser rates (~$0.004/scan) 2,000 photo scans is about
 * $8; the same ceiling on Opus 5 would be ~$40, which is the other reason
 * model choice is a cost decision and not only a quality one.
 *
 * Re-derived 2026-08-21 for the active `gemini-3.5-flash-lite`: a measured scan
 * is ~1,840 input + ~443 output tokens at $0.30/$2.50 per MTok = **~$0.0017**,
 * so this ceiling now bounds the worst day at ~$3.40 rather than ~$8. The
 * 3.x line bills ~1.8x the input tokens of `gemini-2.5-flash` for the same
 * image (a different image tokenizer, not a bigger upload), which is why this
 * was checked rather than assumed — the count is unchanged because the new
 * bound is strictly tighter, not because nothing moved.
 *
 * Raise them from the admin panel as real traffic arrives. If a ceiling is
 * being hit by legitimate use, that is a pricing conversation, not a bug.
 */
const DEFAULT_LIMITS: Record<QuotaKind, number> = {
  photo: 2_000,
  consultation: 1_000,
};

/** What the admin panel and the hourly warning read. */
export interface CeilingStatus {
  kind: QuotaKind;
  date: string;
  used: number;
  limit: number;
  killed: boolean;
  killedReason: string;
  /** `used / limit`, clamped at 1. Convenience for the warning threshold. */
  ratio: number;
}

export class SpendCeiling {
  constructor(private readonly db: Firestore) {}

  /**
   * Throw if the feature is switched off or today's ceiling is spent.
   *
   * A plain read — no write, no transaction, no slot consumed. Call it before
   * the per-user reserve. Callers that bypass per-user quota (admin, comped)
   * should skip this and call {@link record} only.
   *
   * Fails OPEN. If Firestore is unreachable this returns rather than throws:
   * the guard exists to stop a runaway bill, and taking the feature down for
   * everyone because the guard itself could not be read trades a small,
   * bounded cost risk for a total outage. The per-user quota still applies, so
   * "fails open" is never "unlimited".
   */
  async check(kind: QuotaKind): Promise<void> {
    let snap;
    try {
      snap = await this.db.collection(COLLECTION).doc(kind).get();
    } catch (err) {
      console.error(`spendCeiling: check(${kind}) could not read; failing open`, err);
      return;
    }
    if (!snap.exists) return;
    const d = snap.data()!;

    if (d["killed"] === true) {
      console.warn(`spendCeiling: ${kind} is KILLED — rejecting. Reason: ${d["killedReason"] || "(none given)"}`);
      throw new HttpsError(
        "unavailable",
        "This feature is temporarily switched off. Please try again later.",
        { code: ErrorCode.FEATURE_DISABLED },
      );
    }

    // A stale date means nothing has been spent *today*, so the stored
    // counter reads as zero here; `record` performs the actual reset. Note
    // the zeroing happens BEFORE the comparison rather than short-circuiting
    // out of it — with `limit: 0` (the documented way to close a feature via
    // the ceiling rather than the switch) an early return would let the first
    // call of each day through.
    const sameDay = d["date"] === utcDayKey();
    const used = sameDay ? ((d["used"] as number) ?? 0) : 0;
    const limit = (d["limit"] as number) ?? DEFAULT_LIMITS[kind];
    if (used >= limit) {
      console.error(`spendCeiling: ${kind} hit the daily ceiling (${used}/${limit}) — rejecting until UTC midnight.`);
      throw new HttpsError(
        "resource-exhausted",
        "This feature has reached its daily limit across all users. It resets at midnight UTC.",
        { code: ErrorCode.SERVICE_CEILING_REACHED },
      );
    }
  }

  /**
   * Count one call against today's ceiling. Run AFTER the call is authorized.
   *
   * Rolls the counter over when the stored date is not today — that rollover
   * deliberately preserves `limit` and `killed`, so a manual switch survives
   * midnight and a configured ceiling is not silently reset to the default.
   *
   * Never throws. A failure to record is a lost count, which is a metering
   * problem; letting it propagate would turn it into a failed user request
   * for work that already succeeded.
   */
  async record(kind: QuotaKind): Promise<void> {
    const ref = this.db.collection(COLLECTION).doc(kind);
    const today = utcDayKey();
    try {
      await this.db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const sameDay = doc.exists && doc.data()!["date"] === today;
        const used = sameDay ? ((doc.data()!["used"] as number) ?? 0) : 0;
        tx.set(
          ref,
          { date: today, used: used + 1, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      });
    } catch (err) {
      console.error(`spendCeiling: record(${kind}) failed; count lost`, err);
    }
  }

  /** Current state of one ceiling, defaults applied. */
  async status(kind: QuotaKind): Promise<CeilingStatus> {
    const snap = await this.db.collection(COLLECTION).doc(kind).get();
    const d = snap.exists ? snap.data()! : {};
    const today = utcDayKey();
    // A stale date means zero spent today, whatever the stored counter says.
    const used = d["date"] === today ? ((d["used"] as number) ?? 0) : 0;
    const limit = (d["limit"] as number) ?? DEFAULT_LIMITS[kind];
    return {
      kind,
      date: today,
      used,
      limit,
      killed: d["killed"] === true,
      killedReason: (d["killedReason"] as string) ?? "",
      ratio: limit > 0 ? Math.min(1, used / limit) : 1,
    };
  }

  /** Every ceiling, for the admin panel and the hourly warning. */
  async statusAll(): Promise<CeilingStatus[]> {
    return Promise.all((Object.keys(DEFAULT_LIMITS) as QuotaKind[]).map((k) => this.status(k)));
  }

  /**
   * Throw or clear the kill-switch. Sticky by design — see the class header.
   * `by` is stamped so the audit log and the doc agree on who switched it.
   */
  async setKill(kind: QuotaKind, killed: boolean, reason: string, by: string): Promise<void> {
    await this.db.collection(COLLECTION).doc(kind).set(
      {
        killed,
        killedReason: killed ? reason : "",
        killedBy: killed ? by : "",
        killedAt: killed ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.warn(`spendCeiling: ${kind} kill-switch ${killed ? "ENGAGED" : "cleared"} by ${by}. ${reason}`);
  }

  /** Change today's and every future day's ceiling. Takes effect immediately. */
  async setLimit(kind: QuotaKind, limit: number): Promise<void> {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new HttpsError("invalid-argument", "limit must be a non-negative integer.");
    }
    await this.db
      .collection(COLLECTION)
      .doc(kind)
      .set({ limit, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

/**
 * Hourly warning task.
 *
 * **A kill-switch with no alarm is a trap.** Without this, the first sign that
 * photo scan died for every user at 40% through the day is a support email —
 * and the ceiling silently re-opens at UTC midnight, so by the time anyone
 * looks the evidence has rolled over. Logged at `error` so it is greppable in
 * Cloud Functions logs and can carry a log-based alert later.
 *
 * Folded into `hourly-tasks.ts` rather than given its own schedule: Cloud
 * Scheduler's free tier is 3 jobs and all 3 are spent (`CLAUDE.md`).
 */
export async function runSpendCeilingWatch(db: Firestore): Promise<void> {
  const WARN_AT = 0.8;
  for (const s of await new SpendCeiling(db).statusAll()) {
    if (s.killed) {
      console.error(`spendCeilingWatch: ${s.kind} is KILLED and serving nobody. Reason: ${s.killedReason || "(none given)"}`);
    } else if (s.ratio >= 1) {
      console.error(`spendCeilingWatch: ${s.kind} ceiling SPENT (${s.used}/${s.limit}) — rejecting until UTC midnight.`);
    } else if (s.ratio >= WARN_AT) {
      console.error(`spendCeilingWatch: ${s.kind} at ${Math.round(s.ratio * 100)}% of today's ceiling (${s.used}/${s.limit}).`);
    }
  }
}
