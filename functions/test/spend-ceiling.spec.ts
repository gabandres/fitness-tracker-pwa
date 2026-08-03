import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { SpendCeiling } from "../src/spend-ceiling";
import { testDb } from "./helpers";

/**
 * The org-wide guard's two controls are easy to conflate and the failure is
 * silent either way, so both directions are pinned here:
 *
 *   - the daily CEILING must reset at UTC midnight (tomorrow is a new budget)
 *   - the KILL-SWITCH must NOT (a switch that re-arms itself is a delay)
 *
 * `SpendCeiling` keys its doc by kind, so tests must not share a kind or they
 * contend on one document. Each test gets its own via a cast — the class only
 * uses the value as a doc id, and using the real union here would make the
 * tests fight over `photo` and `consultation`.
 */
const db = testDb();
const ceiling = new SpendCeiling(db);

let n = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const freshKind = () => `test-kind-${Date.now()}-${n++}` as any;

const utcToday = () => new Date().toISOString().split("T")[0];

async function expectThrows(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.unreachable(`expected ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpsError);
    expect((err as HttpsError).details).toMatchObject({ code });
  }
}

describe("check + record", () => {
  it("passes while under the ceiling and counts each recorded call", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 3);

    await ceiling.check(kind);
    await ceiling.record(kind);
    await ceiling.record(kind);

    const s = await ceiling.status(kind);
    expect(s.used).toBe(2);
    expect(s.limit).toBe(3);
    expect(s.ratio).toBeCloseTo(2 / 3);
  });

  it("rejects once the ceiling is spent", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 2);
    await ceiling.record(kind);
    await ceiling.record(kind);

    await expectThrows(ceiling.check(kind), "SERVICE_CEILING_REACHED");
  });

  it("check is read-only — a rejected check consumes nothing", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 1);
    await ceiling.record(kind);

    await expectThrows(ceiling.check(kind), "SERVICE_CEILING_REACHED");
    await expectThrows(ceiling.check(kind), "SERVICE_CEILING_REACHED");
    // Still 1. If check() incremented, every ordinary per-user rejection
    // would drift the shared ceiling down over the course of a day.
    expect((await ceiling.status(kind)).used).toBe(1);
  });

  it("passes when no doc exists yet — the guard is opt-in, not opt-out", async () => {
    await expect(ceiling.check(freshKind())).resolves.toBeUndefined();
  });
});

describe("UTC midnight rollover", () => {
  it("resets the ceiling but NOT the kill-switch", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 2);
    await ceiling.setKill(kind, true, "runaway bill", "owner@example.com");
    // Simulate yesterday's spend by rewriting the stored date.
    await ceiling.record(kind);
    await ceiling.record(kind);
    await db.collection("opsBudget").doc(kind).set({ date: "2020-01-01" }, { merge: true });

    const s = await ceiling.status(kind);
    // Ceiling: yesterday's count does not carry into today.
    expect(s.used).toBe(0);
    expect(s.date).toBe(utcToday());
    // Kill-switch: survives. This is the whole point of having one — a
    // switch that clears itself at midnight protects you for ten minutes
    // if the incident starts at 23:50.
    expect(s.killed).toBe(true);
    expect(s.killedReason).toBe("runaway bill");
    await expectThrows(ceiling.check(kind), "FEATURE_DISABLED");
  });

  it("a configured limit survives the rollover too", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 42);
    await ceiling.record(kind);
    await db.collection("opsBudget").doc(kind).set({ date: "2020-01-01" }, { merge: true });

    const s = await ceiling.status(kind);
    expect(s.used).toBe(0);
    // Not silently reset to the built-in default.
    expect(s.limit).toBe(42);
  });
});

describe("kill-switch", () => {
  it("blocks regardless of how much ceiling is left", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 1000);
    await ceiling.setKill(kind, true, "key leaked", "owner@example.com");

    await expectThrows(ceiling.check(kind), "FEATURE_DISABLED");
    expect((await ceiling.status(kind)).used).toBe(0);
  });

  it("clearing it restores service and wipes the reason", async () => {
    const kind = freshKind();
    await ceiling.setKill(kind, true, "investigating", "owner@example.com");
    await expectThrows(ceiling.check(kind), "FEATURE_DISABLED");

    await ceiling.setKill(kind, false, "", "owner@example.com");
    await expect(ceiling.check(kind)).resolves.toBeUndefined();
    const s = await ceiling.status(kind);
    expect(s.killed).toBe(false);
    expect(s.killedReason).toBe("");
  });

  it("still records while killed — the meter must stay honest", async () => {
    // Admin and comped callers skip check() but are always recorded, so a
    // killed feature still accrues their spend. If record() honoured the
    // switch, the owner would be flying blind during the exact incident the
    // switch exists for.
    const kind = freshKind();
    await ceiling.setKill(kind, true, "incident", "owner@example.com");
    await ceiling.record(kind);
    expect((await ceiling.status(kind)).used).toBe(1);
  });
});

describe("setLimit", () => {
  it("rejects a negative or fractional limit", async () => {
    const kind = freshKind();
    await expect(ceiling.setLimit(kind, -1)).rejects.toBeInstanceOf(HttpsError);
    await expect(ceiling.setLimit(kind, 1.5)).rejects.toBeInstanceOf(HttpsError);
  });

  it("accepts zero — the documented way to close a feature via the ceiling", async () => {
    const kind = freshKind();
    await ceiling.setLimit(kind, 0);
    // Blocks from the very first call, with no doc for today yet. An earlier
    // version returned early on a stale date and let one call through each
    // morning, which makes a limit of 0 mean "one a day".
    await expectThrows(ceiling.check(kind), "SERVICE_CEILING_REACHED");
    await ceiling.record(kind);
    await expectThrows(ceiling.check(kind), "SERVICE_CEILING_REACHED");
  });
});
