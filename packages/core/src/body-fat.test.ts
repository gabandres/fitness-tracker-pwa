import { describe, expect, it } from 'vitest';
import { missingBodyFatInputs, navyBodyFat, latestNavyBodyFat } from './body-fat';

describe('navyBodyFat', () => {
  it('estimates for a male from waist/neck/height', () => {
    // 70in tall, 34in waist, 16in neck → 86.010·log10(18) − 70.041·log10(70)
    // + 36.76 ≈ 15.5%.
    const bf = navyBodyFat('male', 70, 34, 16)!;
    expect(bf).toBeCloseTo(15.5, 1);
  });

  it('estimates for a female using waist+hip-neck', () => {
    // 65in tall, 30in waist, 40in hip, 13in neck → ~28%.
    const bf = navyBodyFat('female', 65, 30, 13, 40)!;
    expect(bf).toBeGreaterThan(20);
    expect(bf).toBeLessThan(40);
  });

  it('returns null when a required input is missing or non-positive', () => {
    expect(navyBodyFat('male', 0, 34, 16)).toBeNull();
    expect(navyBodyFat('male', 70, 0, 16)).toBeNull();
    expect(navyBodyFat('male', 70, 34, 0)).toBeNull();
    expect(navyBodyFat('female', 65, 30, 13)).toBeNull(); // no hip
  });

  it('returns null when the log argument collapses (neck ≥ waist)', () => {
    expect(navyBodyFat('male', 70, 16, 16)).toBeNull();
    expect(navyBodyFat('male', 70, 15, 16)).toBeNull();
  });

  it('clamps implausible results into [2, 60]', () => {
    const low = navyBodyFat('male', 70, 17, 16)!;
    expect(low).toBeGreaterThanOrEqual(2);
    expect(low).toBeLessThanOrEqual(60);
  });

  it('rounds to one decimal', () => {
    const bf = navyBodyFat('male', 70, 34, 16)!;
    expect(Number.isInteger(bf * 10)).toBe(true);
  });
});

describe('latestNavyBodyFat', () => {
  const expected = navyBodyFat('male', 70, 34, 16);

  it('uses the most recent measurement that HAS waist+neck, skipping partials', () => {
    // newest-first: a bicep-only entry, then the full one.
    const measurements = [
      { bicep: 15 } as { waist?: number; neck?: number; hip?: number },
      { waist: 34, neck: 16 },
    ];
    expect(latestNavyBodyFat(measurements, 'male', 70)).toBe(expected);
  });

  it('prefers the newest qualifying measurement', () => {
    const measurements = [
      { waist: 34, neck: 16 }, // newest → this one
      { waist: 40, neck: 16 },
    ];
    expect(latestNavyBodyFat(measurements, 'male', 70)).toBe(expected);
  });

  it('returns null when profile inputs are missing', () => {
    expect(latestNavyBodyFat([{ waist: 34, neck: 16 }], null, 70)).toBeNull();
    expect(latestNavyBodyFat([{ waist: 34, neck: 16 }], 'male', null)).toBeNull();
  });

  it('returns null when no measurement carries waist+neck', () => {
    expect(latestNavyBodyFat([{ hip: 40 }], 'male', 70)).toBeNull();
    expect(latestNavyBodyFat([], 'male', 70)).toBeNull();
  });

  it('skips a waist+neck entry that yields no valid result (neck ≥ waist)', () => {
    const measurements = [{ waist: 16, neck: 20 }, { waist: 34, neck: 16 }];
    expect(latestNavyBodyFat(measurements, 'male', 70)).toBe(expected);
  });
});

// ── missingBodyFatInputs (2026-08-12) ─────────────────────────────
// The UI could not tell a user what to do: both apps showed
// "Add a waist + neck measurement" for every failure, which is wrong for
// women — the formula also needs hip, so she could do exactly as instructed
// and be shown the same instruction again.

describe('missingBodyFatInputs', () => {
  it('asks a woman for hip as well, and keeps asking until it is there', () => {
    expect(missingBodyFatInputs([], 'female')).toEqual(['waist', 'neck', 'hip']);
    // She adds precisely what the old message told her to.
    expect(missingBodyFatInputs([{ waist: 30, neck: 13 }], 'female')).toEqual(['hip']);
    expect(missingBodyFatInputs([{ waist: 30, neck: 13, hip: 38 }], 'female')).toEqual([]);
  });

  it('does not ask a man for hip', () => {
    expect(missingBodyFatInputs([], 'male')).toEqual(['waist', 'neck']);
    expect(missingBodyFatInputs([{ waist: 34, neck: 15 }], 'male')).toEqual([]);
  });

  it('reads the newest row carrying any tape input, ignoring later partials', () => {
    // A bicep-only row logged afterwards must not reset the ask, matching
    // latestNavyBodyFat's tolerance.
    const rows = [{ bicep: 14 } as never, { waist: 34, neck: 15 }];
    expect(missingBodyFatInputs(rows, 'male')).toEqual([]);
  });

  it('reports every field when the sex is unknown, rather than guessing', () => {
    expect(missingBodyFatInputs([], null)).toEqual(['waist', 'neck']);
  });
});
