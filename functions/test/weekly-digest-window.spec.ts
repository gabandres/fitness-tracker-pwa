import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  computeWeightDelta,
  dayKeyOfShifted,
  digestWindow,
  walkStreak,
  weightDocFromId,
} from "../src/weekly-digest";

// The digest's date maths, isolated from Firestore. Every case here maps to a
// defect that reached a real inbox or was one send away from doing so.

const DAY = 86_400_000;
/** UTC-5 (Puerto Rico, AST) in `getTimezoneOffset()` terms: minutes WEST. */
const AST = 300;
/** UTC+2 — the sign that a west-of-UTC-only test would never exercise. */
const CET = -120;

/** Sunday 2026-08-16, 10:00 local in AST → 15:00 UTC. */
const SUNDAY_10_AST = Date.UTC(2026, 7, 16, 15, 0, 0);

function keysOf(win: { keys: string[] }): string[] {
  return win.keys;
}

describe("digestWindow", () => {
  it("is exactly seven days, ending today", () => {
    // The shipped bug: a rolling now−7×24h cutoff grouped by calendar day
    // spans EIGHT days for any send hour past midnight, and the email printed
    // "Days logged 8 / 7".
    const win = digestWindow(SUNDAY_10_AST, AST);
    expect(keysOf(win)).toHaveLength(7);
    expect(win.keys[6]).toBe("2026-08-16");
    expect(win.keys[0]).toBe("2026-08-10");
    expect(new Set(win.keys).size).toBe(7);
  });

  it("ends on the LOCAL date, not the UTC one", () => {
    // 2026-08-16 21:00 AST is 2026-08-17 01:00 UTC. A UTC-keyed window would
    // call that Monday and shift every stat by a day.
    const lateSunday = Date.UTC(2026, 7, 17, 1, 0, 0);
    expect(digestWindow(lateSunday, AST).keys[6]).toBe("2026-08-16");
    expect(digestWindow(lateSunday, 0).keys[6]).toBe("2026-08-17");
  });

  it("handles an east-of-UTC offset", () => {
    // 2026-08-16 23:30 UTC is already Monday 01:30 in CET.
    const lateUtc = Date.UTC(2026, 7, 16, 23, 30, 0);
    expect(digestWindow(lateUtc, CET).keys[6]).toBe("2026-08-17");
  });

  it("starts at local midnight, so the cutoff cannot clip today's morning", () => {
    const win = digestWindow(SUNDAY_10_AST, AST);
    // startMs is a real instant: 2026-08-10 00:00 AST = 05:00 UTC.
    expect(win.startMs).toBe(Date.UTC(2026, 7, 10, 5, 0, 0));
    expect(dayKeyOfShifted(win.todayShiftedMs)).toBe("2026-08-16");
  });
});

describe("walkStreak", () => {
  const today = digestWindow(SUNDAY_10_AST, AST).todayShiftedMs;
  const keyBack = (n: number): string => dayKeyOfShifted(today - n * DAY);

  it("counts consecutive days back from today", () => {
    const dates = new Set([keyBack(0), keyBack(1), keyBack(2)]);
    expect(walkStreak(dates, today, keyBack(6))).toEqual({ streak: 3, needMore: false });
  });

  it("survives a day that is not logged YET", () => {
    // Sunday 10am: most people have not logged breakfast. Starting the walk
    // at yesterday keeps the streak from reading 0 in every digest sent.
    const dates = new Set([keyBack(1), keyBack(2)]);
    expect(walkStreak(dates, today, keyBack(6)).streak).toBe(2);
  });

  it("is 0 when neither today nor yesterday has a log", () => {
    const dates = new Set([keyBack(3), keyBack(4)]);
    expect(walkStreak(dates, today, keyBack(6))).toEqual({ streak: 0, needMore: false });
  });

  it("reports needMore when the walk runs off the loaded range", () => {
    // The shipped bug: every key came from the 7-day window, so a 60-day
    // streak could only ever be reported as 8. `needMore` is what tells the
    // caller to page further back instead of printing a capped number.
    const dates = new Set([0, 1, 2, 3, 4, 5, 6].map(keyBack));
    expect(walkStreak(dates, today, keyBack(6))).toEqual({ streak: 7, needMore: true });
  });

  it("does not ask for more once a real gap is inside the loaded range", () => {
    const dates = new Set([0, 1, 2, 4, 5, 6].map(keyBack)); // gap at day 3
    expect(walkStreak(dates, today, keyBack(6))).toEqual({ streak: 3, needMore: false });
  });

  it("treats a null oldest key as 'nothing more to read'", () => {
    const dates = new Set([keyBack(0)]);
    expect(walkStreak(dates, today, null)).toEqual({ streak: 1, needMore: false });
  });
});

describe("computeWeightDelta", () => {
  const at = (isoDay: string, weight: number) => ({
    date: Timestamp.fromMillis(Date.parse(`${isoDay}T12:00:00Z`)),
    weight,
  });
  const windowStart = Date.parse("2026-08-10T05:00:00Z");

  it("is null with no readings at all", () => {
    expect(computeWeightDelta([], undefined, windowStart)).toBeNull();
  });

  it("is null — not 0.0 — with a single reading and no baseline", () => {
    // A user with one weigh-in must not be told their weight change was
    // zero. That is a fabricated measurement, not a missing one.
    expect(computeWeightDelta([at("2026-08-14", 180)], undefined, windowStart)).toBeNull();
  });

  it("uses first vs last inside the window", () => {
    const pts = [at("2026-08-11", 181.4), at("2026-08-13", 180.9), at("2026-08-16", 179.8)];
    expect(computeWeightDelta(pts, undefined, windowStart)).toBe(-1.6);
  });

  it("prefers a recent pre-window reading as the baseline", () => {
    // Someone who weighs in weekly has one reading in the window and used to
    // get an em dash. The last reading before the window IS their start-of-
    // week weight.
    const delta = computeWeightDelta(
      [at("2026-08-16", 179.0)],
      at("2026-08-09", 181.0),
      windowStart,
    );
    expect(delta).toBe(-2);
  });

  it("ignores a stale pre-window reading", () => {
    // A six-week-old weigh-in is not "this week's change" — reporting it as
    // one would overstate the number by an order of magnitude.
    expect(
      computeWeightDelta([at("2026-08-16", 179)], at("2026-07-01", 195), windowStart),
    ).toBeNull();
  });

  it("skips malformed rows rather than emitting NaN", () => {
    const rows = [
      { date: Timestamp.fromMillis(windowStart + DAY), weight: undefined },
      at("2026-08-16", 179.0),
    ] as Array<{ date: Timestamp; weight?: number }>;
    expect(computeWeightDelta(rows, at("2026-08-09", 180.0), windowStart)).toBe(-1);
  });

  it("rounds to a tenth", () => {
    const pts = [at("2026-08-11", 180.04), at("2026-08-16", 179.001)];
    expect(computeWeightDelta(pts, undefined, windowStart)).toBe(-1);
  });
});

describe("weightDocFromId", () => {
  // A dailyWeights doc is `users/{uid}/dailyWeights/{YYYY-MM-DD} -> { weight }`
  // and stores NO `date` field. The digest used to filter and order on `date`;
  // Firestore omits docs missing the ordered field, so those queries matched
  // nothing for everyone and WEIGHT CHANGE was a permanent em dash. Measured
  // 2026-08-23 on an account with 126 weigh-ins. These cases pin the mapping
  // that replaced them.
  it("resolves the doc ID through the user's offset, not UTC midnight", () => {
    // 240 = UTC-4. Local midnight on the 14th is 04:00Z the same day; reading
    // the key as UTC midnight would place it 4h early and can sort a weigh-in
    // to the wrong side of the window edge.
    const doc = weightDocFromId("2026-08-14", { weight: 180 }, 240);
    expect(doc.weight).toBe(180);
    expect(doc.date?.toMillis()).toBe(Date.parse("2026-08-14T04:00:00Z"));
  });

  it("is offset-symmetric for UTC", () => {
    expect(weightDocFromId("2026-08-14", { weight: 1 }, 0).date?.toMillis())
      .toBe(Date.parse("2026-08-14T00:00:00Z"));
  });

  it("yields no date for a malformed ID rather than an Invalid Date", () => {
    // computeWeightDelta treats a doc without a date as invalid and skips it,
    // so a stray key degrades to "no reading", never to NaN arithmetic.
    const doc = weightDocFromId("latest", { weight: 180 }, 240);
    expect(doc.date).toBeUndefined();
    expect(doc.weight).toBe(180);
  });

  it("feeds computeWeightDelta end to end", () => {
    const tz = 240;
    const windowStart = Date.parse("2026-08-10T04:00:00Z");
    const pts = [
      weightDocFromId("2026-08-11", { weight: 181.4 }, tz),
      weightDocFromId("2026-08-16", { weight: 179.8 }, tz),
    ];
    expect(computeWeightDelta(pts, undefined, windowStart)).toBe(-1.6);
  });
});
