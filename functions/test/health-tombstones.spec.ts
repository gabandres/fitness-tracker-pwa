import { describe, expect, it } from "vitest";
import { planTombstones, tombstoneDocId } from "../src/health-tombstones";

/**
 * Item 2 of the 2026-10-20 export review: the 10/14 Watch walk was deleted on
 * 10/15 (15:28Z, `dismissedSourceIds` written) and was back at 15:34Z — a phone
 * still on JS that ignored `dismissedSourceIds` re-imported it by `sourceId`.
 * The server plan below is what makes the deletion hold whatever build writes.
 */
const WALK = "24D8F0AB-583D-46D3-8E78-C735547D0358";
const zone2 = { label: "Zone 2", source: "manual", durationSec: 1200 };
const walk = { modality: "walk", durationSec: 1048, source: "health", sourceId: WALK };
const lift = [{ exerciseId: "row", sets: [] }];

describe("planTombstones — a deleted Health workout stays deleted", () => {
  it("a dismissal becomes an account tombstone", () => {
    const plan = planTombstones(
      { cardio: [zone2, walk], exercises: lift },
      { cardio: [zone2], exercises: lift, dismissedSourceIds: [WALK] },
      new Set(),
    );
    expect(plan.add).toEqual([WALK]);
    expect(plan.cardio).toBeUndefined();
  });

  it("the 10/15 15:34 re-add by an older build is stripped (dismissed on the session)", () => {
    const plan = planTombstones(
      { cardio: [zone2], exercises: lift, dismissedSourceIds: [WALK] },
      { cardio: [zone2, walk], exercises: lift, dismissedSourceIds: [WALK] },
      new Set([WALK]),
    );
    expect(plan.cardio).toEqual([zone2]);
    expect(plan.deleteSession).toBeUndefined();
  });

  it("a re-add into a DIFFERENT session — no dismissal there, only the account tombstone — is stripped", () => {
    // Reinstall / another device / a session with no dismissedSourceIds.
    const plan = planTombstones({ cardio: [], exercises: lift }, { cardio: [walk], exercises: lift }, new Set([WALK]));
    expect(plan.cardio).toEqual([]);
    expect(plan.deleteSession).toBeUndefined(); // it has lifts
  });

  it("an import-only session re-created around a tombstoned workout is deleted", () => {
    const plan = planTombstones(undefined, { status: "completed", cardio: [walk], exercises: [] }, new Set([WALK]));
    expect(plan.deleteSession).toBe(true);
  });

  it("deleting a completed session tombstones every imported workout it held", () => {
    const plan = planTombstones({ status: "completed", cardio: [zone2, walk], exercises: lift }, undefined, new Set());
    expect(plan.add).toEqual([WALK]);
  });

  it("discarding an ACTIVE session records nothing (imports never go into one)", () => {
    expect(planTombstones({ status: "active", cardio: [walk] }, undefined, new Set()).add).toEqual([]);
  });

  it("Undo — the id leaves dismissedSourceIds with its block back — removes the tombstone and keeps the block", () => {
    const plan = planTombstones(
      { cardio: [zone2], exercises: lift, dismissedSourceIds: [WALK] },
      { cardio: [zone2, walk], exercises: lift, dismissedSourceIds: [] },
      new Set([WALK]),
    );
    expect(plan.remove).toEqual([WALK]);
    expect(plan.cardio).toBeUndefined();
  });

  it("a write with no tombstoned block changes nothing — the trigger's own write is a no-op", () => {
    const plan = planTombstones(
      { cardio: [zone2, walk], exercises: lift, dismissedSourceIds: [WALK] },
      { cardio: [zone2], exercises: lift, dismissedSourceIds: [WALK] },
      new Set([WALK]),
    );
    expect(plan).toEqual({ add: [], remove: [] });
  });

  it("tombstone ids cannot add a path segment", () => {
    expect(tombstoneDocId("a/b")).toBe("a%2Fb");
    expect(tombstoneDocId(WALK)).toBe(WALK);
  });
});
