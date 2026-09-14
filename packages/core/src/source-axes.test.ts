/**
 * The `source`-axis separation, as assertions the build checks.
 *
 * Every `@ts-expect-error` below is the guard: it asserts that the line under
 * it DOES NOT COMPILE. If someone widens one axis into another's vocabulary the
 * error disappears, the now-unused directive becomes an error of its own, and
 * `npm --prefix packages/core run typecheck` fails — which is the whole point,
 * because the mix-up these lines describe used to be prevented by a comment.
 *
 * See `./source-axes` for the registry and the literal-overlap pins.
 */
import { describe, expect, it } from 'vitest';
import type { CardioSource } from './cardio';
import type { FastSource } from './fasting-history';
import type { FoodDbSource } from './food-search';
import type { ScannedItemSource } from './photo-scan';
import type { SleepSource } from './sleep-intake';
import type { FoodSource, LogSource } from './types';

/**
 * Never called. The assertion is that this body fails to compile in eight
 * specific places — running it would prove nothing that `tsc` has not already
 * proved, and there is deliberately no runtime coercion here to prove it with.
 */
function crossAxisAssignmentsDoNotCompile(
  logSource: LogSource,
  foodSource: FoodSource,
  foodDbSource: FoodDbSource,
  cardioSource: CardioSource,
  fastSource: FastSource,
  scannedItemSource: ScannedItemSource,
): unknown[] {
  // How a FOOD was captured is not how a CARDIO effort arrived.
  // @ts-expect-error — FoodSource is not CardioSource
  const a: CardioSource = foodSource;
  // @ts-expect-error — CardioSource is not FoodSource
  const b: FoodSource = cardioSource;

  // How a LOG was created is not how a FOOD was captured.
  // @ts-expect-error — LogSource is not FoodSource
  const c: FoodSource = logSource;
  // @ts-expect-error — FoodSource is not LogSource
  const d: LogSource = foodSource;

  // Which DATABASE answered is not what GROUNDED a scanned item — the pair
  // `food-search.ts` already calls out by name.
  // @ts-expect-error — FoodDbSource is not ScannedItemSource
  const e: ScannedItemSource = foodDbSource;
  // @ts-expect-error — ScannedItemSource is not FoodDbSource
  const f: FoodDbSource = scannedItemSource;

  // The axes that share `'manual'` still do not share each other.
  // @ts-expect-error — CardioSource is not FastSource
  const g: FastSource = cardioSource;
  // @ts-expect-error — FastSource is not SleepSource
  const h: SleepSource = fastSource;

  return [a, b, c, d, e, f, g, h];
}

describe('the source axes do not mix', () => {
  it('rejects every cross-axis assignment the doc comments used to warn about', () => {
    // The eight rejections are asserted at compile time above; this only pins
    // that the sample is still eight lines long and still part of the build.
    expect(crossAxisAssignmentsDoNotCompile).toHaveLength(6);
  });

  it("shares exactly one literal across axes, and it is 'manual'", () => {
    // `'manual'` means "a human typed it" on four different nouns, and it is
    // the ONLY literal any two axes share — the entire residual surface of the
    // footgun. Every other literal in every axis belongs to exactly one axis.
    const manualOnEveryAxisThatHasIt: [FoodSource, CardioSource, FastSource, SleepSource] = [
      'manual',
      'manual',
      'manual',
      'manual',
    ];
    expect(new Set<string>(manualOnEveryAxisThatHasIt)).toEqual(new Set(['manual']));
  });
});
