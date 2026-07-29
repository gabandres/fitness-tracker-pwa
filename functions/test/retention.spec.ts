import { beforeAll, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { computeRetentionCohorts } from "../src/retention";
import { freshUid, testDb } from "./helpers";

const db = testDb();

// Fixed clock so cohort weeks and eligibility windows are deterministic.
// A Wednesday, so the Monday-anchored week key is a real shift, not a no-op.
const NOW = new Date("2026-07-15T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const ago = (days: number, hours = 0) =>
  Timestamp.fromDate(new Date(NOW.getTime() - days * DAY_MS - hours * 3_600_000));

/**
 * A user who signed up `signupDaysAgo` ago and logged on each of
 * `logDaysAgo`. `firstEntryAt` is stamped only when they logged, mirroring
 * the onDailyLogCreated latch.
 */
async function seedUser(
  signupDaysAgo: number,
  logDaysAgo: number[],
  opts: { synthetic?: boolean } = {},
): Promise<string> {
  const uid = freshUid("ret");
  const createdAt = ago(signupDaysAgo);
  await db.doc(`users/${uid}`).set({
    createdAt,
    lastSeenAt: ago(0),
    profileCompleted: true,
    ...(opts.synthetic ? { syntheticAccount: true } : {}),
    ...(logDaysAgo.length ? { firstEntryAt: ago(Math.max(...logDaysAgo)) } : {}),
  });
  const batch = db.batch();
  for (const [i, d] of logDaysAgo.entries()) {
    batch.set(db.doc(`users/${uid}/dailyLogs/log-${i}`), {
      calories: 500,
      timestamp: ago(d),
    });
  }
  await batch.commit();
  return uid;
}

/** Monday-anchored week key for a signup that many days before NOW. */
function weekFor(signupDaysAgo: number): string {
  const d = new Date(NOW.getTime() - signupDaysAgo * DAY_MS);
  const offset = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

/** Cohort row for a signup that many days before NOW. */
function cohortFor(
  summary: Awaited<ReturnType<typeof computeRetentionCohorts>>,
  signupDaysAgo: number,
) {
  const week = weekFor(signupDaysAgo);
  const row = summary.cohorts.find((c) => c.week === week);
  expect(row, `no cohort for week ${week}`).toBeDefined();
  return row!;
}

describe("computeRetentionCohorts", () => {
  let summary: Awaited<ReturnType<typeof computeRetentionCohorts>>;

  beforeAll(async () => {
    // 40 days ago — old enough to be eligible at every checkpoint.
    // Retained at D30: last log is 35 days after signup.
    await seedUser(40, [39, 38, 30, 5]);
    // Activated but churned: 3 logs in the first two days, nothing since.
    await seedUser(40, [40, 39, 38]);
    // A tourist: one log, never reached the activation threshold.
    await seedUser(40, [40]);
    // Never logged at all.
    await seedUser(40, []);

    // 3 days ago — eligible for D1 only. Retained at D1 (logged on day 2).
    await seedUser(3, [3, 2, 1]);

    // The seeded App Store demo/review logins, which are what this exclusion
    // exists for. Both are flawless users by construction: activated, and
    // still logging at every checkpoint. One shares a week with real signups
    // (so it would inflate that cohort); the other is alone in its week (so
    // the week itself must not appear).
    await seedUser(40, [40, 39, 38, 37, 5], { synthetic: true });
    await seedUser(60, [60, 59, 58, 30], { synthetic: true });

    summary = await computeRetentionCohorts(db, NOW);
  });

  it("counts a signup as activated only at 3+ logs", () => {
    const old = cohortFor(summary, 40);
    expect(old.signups).toBe(4);
    expect(old.activated).toBe(2); // the 4-log and 3-log users; not the 1-log or 0-log
  });

  it("excludes users too young for a checkpoint from its denominator", () => {
    const recent = cohortFor(summary, 3);
    expect(recent.retained["d1"].eligible).toBe(1);
    expect(recent.retained["d1"].retained).toBe(1);
    // 3 days old: it has not had the chance to reach day 7 or day 30, so
    // counting it as churned there would drag every fresh cohort to zero.
    expect(recent.retained["d7"].eligible).toBe(0);
    expect(recent.retained["d30"].eligible).toBe(0);
  });

  it("measures retention from the last LOG, not the last app open", () => {
    const old = cohortFor(summary, 40);
    // All four are eligible at D30; only the user whose last log is 35 days
    // after signup is retained. `lastSeenAt` is "now" for every one of them,
    // so a lastSeenAt-based definition would have said 4/4.
    expect(old.retained["d30"].eligible).toBe(4);
    expect(old.retained["d30"].retained).toBe(1);
  });

  it("segments the activated subset, which is the number that carries a verdict", () => {
    const old = cohortFor(summary, 40);
    // Aggregate D30 is 1/4 = 25%; among activated users it is 1/2 = 50%.
    // The gap between those two is the whole point of the segmentation.
    expect(old.retainedActivated["d30"].eligible).toBe(2);
    expect(old.retainedActivated["d30"].retained).toBe(1);
  });

  it("keeps a seeded account out of the cohort it signed up in", () => {
    const old = cohortFor(summary, 40);
    // Five profiles carry this week's createdAt; the seeded one is not a
    // signup and not an activated user, at either the aggregate or the
    // activated level.
    expect(old.signups).toBe(4);
    expect(old.activated).toBe(2);
    expect(old.retainedActivated["d30"].eligible).toBe(2);
    // The distortion this prevents: the seeded account logs on day 35 and
    // again 5 days ago, so counting it would read as a 3/3 perfect user.
    expect(old.retained["d30"].retained).toBe(1);
  });

  it("omits a week whose only signups were seeded", () => {
    // The real `config/retention` had a week reading "2 signups, 2 activated,
    // D1 2/2 D7 2/2 D30 2/2" — both of them seeded. A week with no real
    // signups is not a cohort with perfect retention; it is not a cohort.
    expect(summary.cohorts.map((c) => c.week)).not.toContain(weekFor(60));
  });

  it("reports the exclusions instead of silently subtracting them", () => {
    // usersExamined still counts every profile read, so the gap between it
    // and the cohort totals is visible and checkable rather than implied.
    expect(summary.excludedSynthetic).toBe(2);
    expect(summary.usersExamined).toBe(7);
  });

  it("flags a sample too small to read a decision from", () => {
    expect(summary.insufficientSample).toBe(true);
    expect(summary.activatedTotal).toBe(3);
  });

  it("reports logging frequency per activated user per day", () => {
    // Logs in the last 7 days across activated users: the 40-day user has
    // one (day 5), the 3-day user has three. 4 / 3 activated / 7 days.
    expect(summary.logsPerActivatedUserPerDay).toBeCloseTo(4 / 3 / 7, 2);
  });

  it("persists the snapshot and a history row", async () => {
    const doc = await db.doc("config/retention").get();
    expect(doc.exists).toBe(true);
    expect(doc.data()?.["activationThreshold"]).toBe(3);

    const history = await db.doc("config/retentionHistory").get();
    const days = history.data()?.["days"] as Array<Record<string, unknown>>;
    expect(days.length).toBeGreaterThan(0);
    expect(days[days.length - 1]?.["activatedTotal"]).toBe(3);
  });
});
