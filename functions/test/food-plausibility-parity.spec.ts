import { describe, expect, it } from "vitest";
import * as mirror from "../src/food-plausibility";
import * as core from "../../packages/core/src/food-plausibility";

/**
 * The server copy and the shared copy must agree, food for food.
 *
 * `functions/` is not a workspace, so `food-plausibility.ts` exists twice by
 * hand (see the mirror's header). A hand-mirror with nothing holding it
 * together is a divergence waiting to happen, and this one would diverge
 * *invisibly*: the server would filter a food out of search while a client
 * still considered it fine, or the reverse, and the only symptom would be a
 * result that appears in one place and not another.
 *
 * So this does not test the rules — `packages/core/src/food-plausibility.test.ts`
 * does that, and duplicating it here would just be a second thing to keep in
 * step. It tests that the two implementations are the same implementation.
 */

/** Spread across every branch: each verdict, each reason, and the boundaries. */
const SAMPLES: mirror.MacroSample[] = [
  { kcal: 884, protein: 0, carb: 0, fat: 100 },
  { kcal: 400, protein: 0, carb: 100, fat: 0 },
  { kcal: 120, protein: 22.5, carb: 0, fat: 2.6 },
  { kcal: 0, protein: 0, carb: 0, fat: 0 },
  { kcal: 418, protein: 5, carb: 12, fat: 3 },
  { kcal: 2400, protein: 8, carb: 60, fat: 10 },
  { kcal: 400, protein: 60, carb: 60, fat: 30 },
  { kcal: 400, protein: 200, carb: 0, fat: 0 },
  { kcal: -10 },
  { kcal: Number.NaN },
  { kcal: 90, protein: 10, carb: 40, fat: 8 },
  { kcal: 900, protein: 10, carb: 40, fat: 8 },
  { kcal: 200, protein: 5, carb: 20, fat: 2 },
  { kcal: 150 },
  { kcal: 231, protein: 0, carb: 0, fat: 0 },
  { kcal: 250, protein: 13, carb: 80, fat: 4 },
  { kcal: 100, protein: null, carb: null, fat: null },
  { kcal: mirror.KCAL_PER_100G_MAX },
  { kcal: mirror.KCAL_PER_100G_MAX + 1 },
];

describe("food-plausibility mirror parity", () => {
  it("exposes the same constants", () => {
    expect(mirror.KCAL_PER_100G_MAX).toBe(core.KCAL_PER_100G_MAX);
  });

  it.each(SAMPLES.map((s) => [JSON.stringify(s), s] as const))(
    "agrees on %s",
    (_label, sample) => {
      expect(mirror.assessMacros(sample)).toEqual(core.assessMacros(sample as core.MacroSample));
      expect(mirror.atwaterKcal(sample)).toEqual(core.atwaterKcal(sample as core.MacroSample));
      expect(mirror.isLoggableFood(sample)).toBe(
        core.isLoggableFood(sample as core.MacroSample),
      );
    },
  );

  it.each(["foundation_food", "sr_legacy_food", "survey_fndds_food", "OFF", undefined])(
    "agrees on the trust bucket for %s",
    (dataType) => {
      expect(mirror.trustForDataType(dataType)).toBe(core.trustForDataType(dataType));
      expect(mirror.trustRank(mirror.trustForDataType(dataType))).toBe(
        core.trustRank(core.trustForDataType(dataType)),
      );
    },
  );

  it("covers every verdict and reason the module can produce", () => {
    // A parity suite that only exercised the happy path would pass while the
    // interesting branches drifted.
    const verdicts = new Set(SAMPLES.map((s) => mirror.assessMacros(s).verdict));
    const reasons = new Set(
      SAMPLES.map((s) => mirror.assessMacros(s).reason).filter(Boolean),
    );
    expect(verdicts).toEqual(new Set(["ok", "suspect", "reject"]));
    expect(reasons).toEqual(
      new Set([
        "kcal-not-finite",
        "kcal-negative",
        "kcal-impossible",
        "macros-exceed-mass",
        "energy-far-above-macros",
        "energy-above-macros",
        "energy-below-macros",
        "macros-missing",
      ]),
    );
  });
});
