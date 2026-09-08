import { describe, expect, it } from "vitest";
import { describeLogRow } from "../src/activity-detail";

// The admin Activity feed line for a dailyLogs row. Pinned because the marker
// rows (exercise toggle, workout completion) used to render as "Entry · 0 kcal"
// and were read as a user logging an empty meal.

describe("describeLogRow", () => {
  it("prints a labelled meal with its calories", () => {
    expect(describeLogRow({ mealLabel: "QDOBA", calories: 570 })).toBe("QDOBA · 570 kcal");
  });

  it("names the exercise-toggle marker row instead of '0 kcal'", () => {
    expect(describeLogRow({ calories: 0, exerciseCompleted: true })).toBe(
      "Marked exercise done · streak marker, not a meal",
    );
  });

  it("prefers the specific lift/cardio flags over the generic exercise flag", () => {
    expect(describeLogRow({ calories: 0, exerciseCompleted: true, liftCompleted: true })).toBe(
      "Marked lift done · streak marker, not a meal",
    );
    expect(describeLogRow({ calories: 0, liftCompleted: true, cardioCompleted: true })).toBe(
      "Marked lift + cardio done · streak marker, not a meal",
    );
  });

  it("a labelled meal wins even when a marker flag is also set", () => {
    expect(describeLogRow({ mealLabel: "Lunch", calories: 400, exerciseCompleted: true })).toBe(
      "Lunch · 400 kcal",
    );
  });

  it("names a legacy weigh-in row", () => {
    expect(describeLogRow({ calories: 0, weight: 181.4 })).toBe("Weigh-in · 181.4");
  });

  it("falls back to the old line for an unlabelled meal with calories", () => {
    expect(describeLogRow({ calories: 250 })).toBe("Entry · 250 kcal");
    expect(describeLogRow({})).toBe("Entry · 0 kcal");
  });
});
