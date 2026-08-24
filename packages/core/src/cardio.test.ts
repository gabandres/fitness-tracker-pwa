import { describe, expect, it } from 'vitest';
import {
  CARDIO_DISTANCE_MAX_M,
  CARDIO_DURATION_MAX_SEC,
  CARDIO_KCAL_MAX,
  CARDIO_MODALITIES,
  CARDIO_RATE_STYLE,
  HR_MAX,
  HR_MIN,
  RPE_MAX,
  RPE_MIN,
  clampCardioDurationSec,
  clampCardioKcal,
  clampDistanceM,
  clampHr,
  clampRpe,
  isLoggedCardioBlock,
} from './cardio';

describe('clampRpe', () => {
  it('accepts the whole 1-10 scale', () => {
    for (let n = RPE_MIN; n <= RPE_MAX; n++) expect(clampRpe(n)).toBe(n);
  });

  it('clamps above the ceiling, because "as hard as I could" is unambiguous', () => {
    expect(clampRpe(11)).toBe(RPE_MAX);
    expect(clampRpe(99)).toBe(RPE_MAX);
  });

  it('rejects below the floor rather than clamping up — RPE 0 is not a thing', () => {
    expect(clampRpe(0)).toBeUndefined();
    expect(clampRpe(-3)).toBeUndefined();
  });

  it('rejects fractional input instead of guessing which whole number was meant', () => {
    expect(clampRpe(7.5)).toBeUndefined();
  });

  // The bug this guard exists for: Number('') and Number(null) are both 0, so
  // without an emptiness check BEFORE coercion, clearing the field would store
  // the floor-adjacent value instead of unsetting it. `clampRir` documents the
  // same trap, where 0 was a *legitimate* value and the stakes were higher.
  it('treats empty and nullish as unset, not as zero', () => {
    expect(clampRpe('')).toBeUndefined();
    expect(clampRpe(null)).toBeUndefined();
    expect(clampRpe(undefined)).toBeUndefined();
  });

  it('parses numeric strings, which is what a text input hands over', () => {
    expect(clampRpe('8')).toBe(8);
  });

  it('rejects junk', () => {
    expect(clampRpe('hard')).toBeUndefined();
    expect(clampRpe(NaN)).toBeUndefined();
    expect(clampRpe(Infinity)).toBeUndefined();
    expect(clampRpe({})).toBeUndefined();
  });
});

// The measured fields DROP out-of-range values rather than clamping them, and
// that difference from clampRpe is deliberate: pinning 4,000 bpm to 250 would
// launder a broken sensor into a number that charts smoothly and looks real.
describe('measured fields reject rather than clamp', () => {
  it('clampHr keeps a plausible band and drops the rest', () => {
    expect(clampHr(148)).toBe(148);
    expect(clampHr(HR_MIN)).toBe(HR_MIN);
    expect(clampHr(HR_MAX)).toBe(HR_MAX);
    expect(clampHr(HR_MIN - 1)).toBeUndefined();
    expect(clampHr(HR_MAX + 1)).toBeUndefined();
    expect(clampHr(4000)).toBeUndefined();
    expect(clampHr(0)).toBeUndefined();
  });

  it('clampHr rounds to whole beats', () => {
    expect(clampHr(147.6)).toBe(148);
  });

  it('clampCardioDurationSec allows zero — a prescribed block not yet performed', () => {
    expect(clampCardioDurationSec(0)).toBe(0);
    expect(clampCardioDurationSec(1930)).toBe(1930);
    expect(clampCardioDurationSec(CARDIO_DURATION_MAX_SEC)).toBe(CARDIO_DURATION_MAX_SEC);
    expect(clampCardioDurationSec(CARDIO_DURATION_MAX_SEC + 1)).toBeUndefined();
    expect(clampCardioDurationSec(-1)).toBeUndefined();
  });

  it('clampDistanceM keeps one decimal and admits a 24-hour ride', () => {
    expect(clampDistanceM(8046.72)).toBe(8046.7);
    expect(clampDistanceM(1_026_000)).toBe(1_026_000);
    expect(clampDistanceM(CARDIO_DISTANCE_MAX_M + 1)).toBeUndefined();
    expect(clampDistanceM(-5)).toBeUndefined();
  });

  it('clampCardioKcal bounds one effort at half a day', () => {
    expect(clampCardioKcal(612.4)).toBe(612);
    expect(clampCardioKcal(CARDIO_KCAL_MAX)).toBe(CARDIO_KCAL_MAX);
    expect(clampCardioKcal(CARDIO_KCAL_MAX + 1)).toBeUndefined();
  });

  it('treats empty and nullish as unset across every measured field', () => {
    for (const fn of [clampCardioDurationSec, clampDistanceM, clampHr, clampCardioKcal]) {
      expect(fn('')).toBeUndefined();
      expect(fn(null)).toBeUndefined();
      expect(fn(undefined)).toBeUndefined();
    }
  });
});

describe('isLoggedCardioBlock', () => {
  it('is true only for a block with real elapsed time', () => {
    expect(isLoggedCardioBlock({ durationSec: 1 })).toBe(true);
    expect(isLoggedCardioBlock({ durationSec: 1930 })).toBe(true);
  });

  // A template's prescription is snapshotted with durationSec 0 and the target
  // in targetDurationSec. Counting it as logged would put work in a user's
  // history that they never did — the same footgun ADR-0007 paid for once with
  // targetReps.
  it('is false for an untouched scaffold block', () => {
    expect(isLoggedCardioBlock({ durationSec: 0 })).toBe(false);
  });

  it('is false for corrupt duration rather than throwing', () => {
    expect(isLoggedCardioBlock({ durationSec: NaN })).toBe(false);
    expect(isLoggedCardioBlock({ durationSec: -60 })).toBe(false);
  });
});

describe('the modality set', () => {
  it('lists every modality exactly once, so a picker cannot omit or repeat one', () => {
    const keys = Object.keys(CARDIO_RATE_STYLE).sort();
    expect([...CARDIO_MODALITIES].sort()).toEqual(keys);
    expect(new Set(CARDIO_MODALITIES).size).toBe(CARDIO_MODALITIES.length);
  });

  it('puts `other` last, since it is the fallback rather than a choice', () => {
    expect(CARDIO_MODALITIES[CARDIO_MODALITIES.length - 1]).toBe('other');
  });

  it('quotes a ride as speed and a run as pace', () => {
    expect(CARDIO_RATE_STYLE.ride).toBe('speed');
    expect(CARDIO_RATE_STYLE.run).toBe('pace');
  });
});
