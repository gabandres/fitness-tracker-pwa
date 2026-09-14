import type { Caller } from "./caller-access";
import type { QuotaKind } from "./daily-quota";

/**
 * The two AI-cost guards, in the one order that is correct, as a callable
 * interface. Crossing them is no longer something a call site remembers to do:
 * it is the only way to reach the work.
 *
 * ## Why a wrapper and not prose
 *
 * `spendCeiling.check` → `dailyQuota.reserve` → `spendCeiling.record` → work →
 * `dailyQuota.release` on failure is five statements whose ORDER carries the
 * meaning, and the meaning was documented only in CLAUDE.md and re-typed at
 * every call site. Every one of the five has a silent failure mode:
 *
 *  - check AFTER reserve → an ordinary "you hit your own limit" rejection
 *    still drains the shared ceiling, which then drifts down all day.
 *  - record BEFORE the reserve → same drift, from the other direction.
 *  - release with units ≠ the reserved units → a permanent overcharge on the
 *    path that only runs when something already went wrong (see
 *    `DailyQuota.release`'s header for the day this actually happened).
 *  - release against today's doc after crossing UTC midnight → refunds
 *    tomorrow and leaves today overcharged.
 *  - a throwing release → the real error disappears out of a catch block.
 *
 * None of those are visible to tsc, to a unit test of either guard alone, or
 * to a reviewer reading one call site. They are visible here, once.
 *
 * ## The asymmetry is the design, not an oversight
 *
 * | | unit | exemption | refunded on failure |
 * |---|---|---|---|
 * | **quota** (fairness) | what a person perceives doing — a scan | `quotaExempt` skips it | **yes** |
 * | **ceiling** (solvency) | what actually costs money — images | `unlimited` skips the CHECK only | **never** |
 *
 * So `reserveUnits` and `recordUnits` are separate parameters on purpose. A
 * 3-image scan reserves 1 slot and records 3 units; collapsing them to one
 * number is exactly the bug that made a free user spend their whole day's
 * allowance on one meal (2026-08-26). The refund asymmetry is the same idea
 * seen from the failure path: the user did not get their scan, so they keep
 * their slot — but the tokens left the building either way, and a ceiling that
 * refunds real spend has stopped guarding the bill.
 *
 * ## The two exemption flags do different jobs (ADR-0008)
 *
 * They are NOT interchangeable and collapsing them re-opens a bug that was
 * already paid for:
 *
 *  - `caller.unlimited` (admin + comped) skips `check` — **recorded, never
 *    blocked**. If the ceiling has tripped, the owner still has to be able to
 *    use the feature in order to find out why.
 *  - `caller.quotaExempt` (comped ONLY) skips `reserve`. Admin deliberately
 *    counts like everyone else since 2026-08-12: exempting it meant the one
 *    person able to fix the quota UI was the one person who could never see it
 *    work. See `Caller.quotaExempt`.
 *
 * ## Where `record` sits, and why it is not after the work
 *
 * It runs once the call is AUTHORIZED, before the model round trip — the spend
 * happens the moment the request leaves, so a response that fails to parse
 * still cost money and still has to count. Moving it after the work would make
 * every failed call free to the ceiling, which is the unbounded case: a stream
 * of unreadable photos running up a real bill while every individual request
 * looks free.
 */

/** The half of `Caller` that decides guard behaviour. Narrow on purpose so a
    test can fabricate one without a Firestore-backed `CallerAccess`. */
export type GuardedCaller = Pick<Caller, "uid" | "tier" | "unlimited" | "quotaExempt">;

/** What `DailyQuota.reserve` hands back. Non-null means this request is
    holding a slot that the failure path has to give back — and `day` is what
    makes the refund target the doc that was actually charged, not tomorrow's. */
export interface Reservation {
  usedAfter: number;
  remaining: number;
  day: string;
}

/** Structural view of `DailyQuota` — the two methods this module drives. */
export interface QuotaLedgerLike {
  reserve(uid: string, kind: QuotaKind, paid: boolean, units?: number): Promise<Reservation>;
  release(uid: string, kind: QuotaKind, day?: string, units?: number): Promise<boolean>;
}

/** Structural view of `SpendCeiling` — the two methods this module drives. */
export interface SpendCeilingLike {
  check(kind: QuotaKind): Promise<void>;
  record(kind: QuotaKind, units?: number): Promise<void>;
}

export interface CostGuardSpec {
  kind: QuotaKind;
  caller: GuardedCaller;
  /** Per-user quota slots — the FAIRNESS unit, counted in whole user actions
      ("a scan", "an ask"). The same number is what gets refunded. Default 1. */
  reserveUnits?: number;
  /** Org-ceiling units — the SOLVENCY unit, counted in whatever actually
      costs money (images, calls). Never refunded. Default 1. */
  recordUnits?: number;
}

/** Everything the guarded work needs to know about what the guards did. */
export interface CostGuardContext {
  /** `null` when the caller is quota-exempt — no slot was taken, so there is
      no real "N left" to report. The call site decides what to show instead;
      the two existing ones disagree (paid cap vs. `-1`) and both are correct
      for their client. */
  reservation: Reservation | null;
}

export type GuardedWork<T> = (ctx: CostGuardContext) => Promise<T>;

export type WithCostGuards = <T>(spec: CostGuardSpec, work: GuardedWork<T>) => Promise<T>;

/**
 * Bind the guard sequence to a quota ledger and a ceiling.
 *
 * Dependencies are injected rather than imported from `init.ts` so this module
 * stays free of the admin-SDK bootstrap: the ordering rules above are pure
 * control flow and are testable without a Firestore emulator.
 */
export function makeCostGuards(quota: QuotaLedgerLike, ceiling: SpendCeilingLike): WithCostGuards {
  return async function withCostGuards<T>(spec: CostGuardSpec, work: GuardedWork<T>): Promise<T> {
    const { kind, caller } = spec;
    const reserveUnits = spec.reserveUnits ?? 1;
    const recordUnits = spec.recordUnits ?? 1;

    // 1. Solvency, read-only, BEFORE the reserve. Unlimited callers are
    //    metered but never blocked — see the header.
    if (!caller.unlimited) {
      await ceiling.check(kind);
    }

    // 2. Fairness. Throws the kind's quota ErrorCode having consumed nothing.
    const reservation = caller.quotaExempt
      ? null
      : await quota.reserve(caller.uid, kind, caller.tier === "paid", reserveUnits);

    // 3. Meter the spend. Every tier, unlimited included. Never throws.
    await ceiling.record(kind, recordUnits);

    try {
      return await work({ reservation });
    } catch (err) {
      // Refund the SLOT only. Same units and the same day as the reserve, so
      // a scan that fails across UTC midnight cannot refund tomorrow's
      // counter. A refund that does not land is a user overcharged by one
      // action; an exception thrown from here is the actual fault vanishing —
      // so this swallows and logs rather than propagating.
      if (reservation) {
        try {
          await quota.release(caller.uid, kind, reservation.day, reserveUnits);
        } catch (refundErr) {
          console.error(
            `costGuards: ${kind} quota refund FAILED uid=${caller.uid} day=${reservation.day}:`,
            refundErr,
          );
        }
      }
      throw err;
    }
  };
}
