import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import {
  makeCostGuards,
  type GuardedCaller,
  type QuotaLedgerLike,
  type Reservation,
  type SpendCeilingLike,
} from "../src/cost-guards";

/**
 * The ordering rule is the product here, so these tests pin the ORDER and the
 * asymmetry, not the arithmetic — `daily-quota.spec.ts` and
 * `spend-ceiling.spec.ts` already own each guard's own behaviour against a
 * real Firestore.
 *
 * Deliberately emulator-free: `makeCostGuards` takes its two collaborators as
 * arguments precisely so the sequence can be tested as pure control flow. The
 * fakes below append to one shared `trace`, which is what makes "check before
 * reserve" and "nothing recorded on a rejection" assertable at all — both are
 * invisible to a test that only inspects final counters.
 */

type Trace = string[];

function fakeQuota(trace: Trace, opts: { reserveThrows?: HttpsError; releaseThrows?: Error } = {}) {
  const calls = { reserve: [] as unknown[][], release: [] as unknown[][] };
  const quota: QuotaLedgerLike = {
    async reserve(uid, kind, paid, units = 1): Promise<Reservation> {
      trace.push(`reserve:${kind}:${uid}:paid=${paid}:units=${units}`);
      calls.reserve.push([uid, kind, paid, units]);
      if (opts.reserveThrows) throw opts.reserveThrows;
      return { usedAfter: units, remaining: 3 - units, day: "2026-09-14" };
    },
    async release(uid, kind, day, units) {
      trace.push(`release:${kind}:${uid}:day=${day}:units=${units}`);
      calls.release.push([uid, kind, day, units]);
      if (opts.releaseThrows) throw opts.releaseThrows;
      return true;
    },
  };
  return { quota, calls };
}

function fakeCeiling(trace: Trace, opts: { checkThrows?: HttpsError } = {}) {
  const calls = { check: 0, record: [] as number[] };
  const ceiling: SpendCeilingLike = {
    async check(kind) {
      trace.push(`check:${kind}`);
      calls.check++;
      if (opts.checkThrows) throw opts.checkThrows;
    },
    async record(kind, units = 1) {
      trace.push(`record:${kind}:${units}`);
      calls.record.push(units);
    },
  };
  return { ceiling, calls };
}

const FREE: GuardedCaller = { uid: "u-free", tier: "free", unlimited: false, quotaExempt: false };
/** Admin is `unlimited` but NOT `quotaExempt` — the two flags are not the same
    flag, and 2026-08-12 is the day that mattered (see `Caller.quotaExempt`). */
const ADMIN: GuardedCaller = { uid: "u-admin", tier: "admin", unlimited: true, quotaExempt: false };
const COMPED: GuardedCaller = { uid: "u-comped", tier: "comped", unlimited: true, quotaExempt: true };
const PAID: GuardedCaller = { uid: "u-paid", tier: "paid", unlimited: false, quotaExempt: false };

const ceilingReached = new HttpsError("resource-exhausted", "spent", { code: "SERVICE_CEILING_REACHED" });
const quotaExceeded = new HttpsError("resource-exhausted", "over", { code: "PHOTO_QUOTA_EXCEEDED" });

describe("order", () => {
  it("checks the org ceiling BEFORE reserving the per-user slot", async () => {
    const trace: Trace = [];
    const { quota } = fakeQuota(trace);
    const { ceiling } = fakeCeiling(trace);

    await makeCostGuards(quota, ceiling)({ kind: "photo", caller: FREE }, async () => {
      trace.push("work");
      return "ok";
    });

    // The reverse order is the silent bug: every ordinary "you hit your own
    // daily limit" rejection would leak a count against the shared ceiling.
    expect(trace).toEqual(["check:photo", "reserve:photo:u-free:paid=false:units=1", "record:photo:1", "work"]);
  });

  it("passes the paid flag from the tier, not from the exemption flags", async () => {
    const trace: Trace = [];
    const { quota, calls } = fakeQuota(trace);
    const { ceiling } = fakeCeiling(trace);
    await makeCostGuards(quota, ceiling)({ kind: "consultation", caller: PAID }, async () => undefined);
    expect(calls.reserve[0]).toEqual(["u-paid", "consultation", true, 1]);
  });
});

describe("record", () => {
  it("records once the call is AUTHORIZED, and never un-records it when the work fails", async () => {
    // Not "after successful work": the spend happens the moment the request
    // leaves. A stream of unreadable photos that cost real money must still
    // count against the ceiling, or the worst day is unbounded.
    const trace: Trace = [];
    const { quota } = fakeQuota(trace);
    const { ceiling, calls } = fakeCeiling(trace);

    await expect(
      makeCostGuards(quota, ceiling)({ kind: "photo", caller: FREE }, async () => {
        throw new Error("model exploded");
      }),
    ).rejects.toThrow("model exploded");

    expect(calls.record).toEqual([1]);
    expect(trace.indexOf("record:photo:1")).toBeLessThan(trace.indexOf("release:photo:u-free:day=2026-09-14:units=1"));
  });

  it("records nothing when the ceiling rejects — and consumes no quota either", async () => {
    const trace: Trace = [];
    const { quota, calls: q } = fakeQuota(trace);
    const { ceiling, calls: c } = fakeCeiling(trace, { checkThrows: ceilingReached });
    let ran = false;

    await expect(
      makeCostGuards(quota, ceiling)({ kind: "photo", caller: FREE }, async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ details: { code: "SERVICE_CEILING_REACHED" } });

    expect(ran).toBe(false);
    expect(q.reserve).toEqual([]); // the user keeps their whole day's allowance
    expect(q.release).toEqual([]); // nothing to refund, so nothing is refunded
    expect(c.record).toEqual([]);
  });

  it("records nothing when the per-user reserve rejects", async () => {
    const trace: Trace = [];
    const { quota } = fakeQuota(trace, { reserveThrows: quotaExceeded });
    const { ceiling, calls } = fakeCeiling(trace);

    await expect(
      makeCostGuards(quota, ceiling)({ kind: "photo", caller: FREE }, async () => undefined),
    ).rejects.toMatchObject({ details: { code: "PHOTO_QUOTA_EXCEEDED" } });

    expect(calls.record).toEqual([]);
    expect(trace).toEqual(["check:photo", "reserve:photo:u-free:paid=false:units=1"]);
  });
});

describe("refund asymmetry", () => {
  it("refunds the SLOT on a thrown work, against the day that was charged", async () => {
    const trace: Trace = [];
    const { quota, calls } = fakeQuota(trace);
    const { ceiling } = fakeCeiling(trace);

    const boom = new Error("gemini 503");
    await expect(
      makeCostGuards(quota, ceiling)({ kind: "consultation", caller: FREE }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom); // the original error, not one manufactured by the guard

    // The DAY comes from the reservation, not from "today": a request that
    // starts at 23:59:59 and fails at 00:00:01 must not refund tomorrow.
    expect(calls.release).toEqual([["u-free", "consultation", "2026-09-14", 1]]);
  });

  it("refunds exactly the units it reserved, never the units it recorded", async () => {
    // A 3-image photo scan: 1 fairness slot, 3 solvency units. Refunding 3
    // would mint credit; refunding by recordUnits is the bug the wrapper makes
    // unrepresentable.
    const trace: Trace = [];
    const { quota, calls: q } = fakeQuota(trace);
    const { ceiling, calls: c } = fakeCeiling(trace);

    await expect(
      makeCostGuards(quota, ceiling)(
        { kind: "photo", caller: FREE, reserveUnits: 1, recordUnits: 3 },
        async () => {
          throw new Error("unparseable");
        },
      ),
    ).rejects.toThrow("unparseable");

    expect(q.reserve[0]).toEqual(["u-free", "photo", false, 1]);
    expect(c.record).toEqual([3]);
    expect(q.release[0]).toEqual(["u-free", "photo", "2026-09-14", 1]);
  });

  it("does not refund a successful call", async () => {
    const trace: Trace = [];
    const { quota, calls } = fakeQuota(trace);
    const { ceiling } = fakeCeiling(trace);
    await makeCostGuards(quota, ceiling)({ kind: "photo", caller: FREE }, async () => "fine");
    expect(calls.release).toEqual([]);
  });

  it("lets the real error through even when the refund itself fails", async () => {
    // A refund that does not land is a user overcharged by one scan; an
    // exception thrown out of the refund is the actual fault disappearing.
    const trace: Trace = [];
    const { quota } = fakeQuota(trace, { releaseThrows: new Error("firestore down") });
    const { ceiling } = fakeCeiling(trace);

    await expect(
      makeCostGuards(quota, ceiling)({ kind: "photo", caller: FREE }, async () => {
        throw new HttpsError("internal", "analysis failed", { code: "PHOTO_ANALYZE_FAILED" });
      }),
    ).rejects.toMatchObject({ details: { code: "PHOTO_ANALYZE_FAILED" } });
  });
});

describe("the two exemption flags are not one flag", () => {
  it("admin (unlimited, NOT quotaExempt): never checked, still reserves, still recorded", async () => {
    const trace: Trace = [];
    const { quota, calls: q } = fakeQuota(trace);
    const { ceiling, calls: c } = fakeCeiling(trace, { checkThrows: ceilingReached });

    // The ceiling is tripped, and the admin still gets through — a guard that
    // locks out the person diagnosing the incident is a worse guard.
    const out = await makeCostGuards(quota, ceiling)({ kind: "photo", caller: ADMIN }, async () => "served");

    expect(out).toBe("served");
    expect(c.check).toBe(0);
    expect(c.record).toEqual([1]); // recorded: the call cost the same real money
    expect(q.reserve).toHaveLength(1); // admin counts like anyone else
  });

  it("comped (unlimited AND quotaExempt): no check, no reserve, no refund — but recorded", async () => {
    const trace: Trace = [];
    const { quota, calls: q } = fakeQuota(trace);
    const { ceiling, calls: c } = fakeCeiling(trace, { checkThrows: ceilingReached });

    await expect(
      makeCostGuards(quota, ceiling)({ kind: "consultation", caller: COMPED }, async () => {
        throw new Error("gemini 503");
      }),
    ).rejects.toThrow("gemini 503");

    expect(trace).toEqual(["record:consultation:1"]);
    expect(c.check).toBe(0);
    expect(q.reserve).toEqual([]);
    expect(q.release).toEqual([]); // nothing was reserved, so there is nothing to give back
  });

  it("hands the work a reservation for a counted caller and null for an exempt one", async () => {
    const trace: Trace = [];
    const { quota } = fakeQuota(trace);
    const { ceiling } = fakeCeiling(trace);
    const guards = makeCostGuards(quota, ceiling);

    // `remaining` is what `analyzePhoto` returns to the client as
    // `photosRemaining`; null is the signal a call site uses to substitute its
    // own decorative value.
    expect(
      await guards({ kind: "photo", caller: FREE }, async ({ reservation }) => reservation?.remaining ?? null),
    ).toBe(2);
    expect(
      await guards({ kind: "photo", caller: COMPED }, async ({ reservation }) => reservation?.remaining ?? null),
    ).toBeNull();
  });
});
