import { describe, expect, it } from 'vitest';
import { parseOuraWorkouts } from './oura-workouts';
import captured from './__fixtures__/oura-workouts.captured.json';

/**
 * The parser, against a REAL Oura payload (#102).
 *
 * Every other Oura test in this repo is written against what the documentation
 * says the wire looks like. ADR-0026 flagged that as the weak point in the whole
 * integration — *"a hand-authored workout payload agrees with whatever the
 * mapper already believes, which is the one thing a fixture must not do"* — and
 * for two days the mapper had never met a real record.
 *
 * This is that record. Captured 2026-08-26 from the one ring on this project,
 * verbatim. The point of the file is that it can DISAGREE with us.
 *
 * **What it proved, and it was not what anyone expected.** The suspicion when
 * #102 was filed was that the parser was silently skipping both records — the
 * failure ADR-0026 predicted, where a non-zero `skipped` is the finding. It is
 * not. The parser reads both perfectly. They are declined one layer later, by
 * the modality filter, for the correct reason: they are not cardio. The bug was
 * that nothing said so.
 */

describe('parseOuraWorkouts against a captured payload', () => {
  const parsed = parseOuraWorkouts(captured as { data: unknown[] });

  it('reads every record — nothing is skipped', () => {
    // The assertion that overturned the original diagnosis. If this ever goes
    // non-zero on this fixture, the wire shape moved under us.
    expect(parsed.skipped).toBe(0);
    expect(parsed.workouts).toHaveLength(2);
  });

  it('stamps provider `oura` without needing a vendor string on the wire', () => {
    // There is no `com.ouraring.oura` anywhere in this payload, and there does
    // not need to be: the Cloud API has exactly one thing on the far end. That
    // constant belongs to the HEALTH-STORE transport, and conflating the two
    // cost this project a day of looking for a field that was never coming.
    for (const w of parsed.workouts) {
      expect(w.provider).toBe('oura');
      expect(w.source).toBe('oura');
      expect(w.fromUs).toBe(false);
    }
    // Asserted over the RECORDS, not a stringify of the file — the prose in
    // `_comment` mentions the constant by name to explain its absence.
    expect(JSON.stringify(captured.data)).not.toContain('com.ouraring');
  });

  it('reads camelCase activity values, which is what the wire actually sends', () => {
    expect(parsed.workouts.map((w) => w.activityType)).toEqual(['strengthTraining', 'other']);
  });

  it('keeps the interval and the calories Oura reported', () => {
    const [strength] = parsed.workouts;
    expect(new Date(strength.startMs).toISOString()).toBe('2026-08-24T11:48:00.000Z');
    expect(new Date(strength.endMs).toISOString()).toBe('2026-08-24T12:20:00.000Z');
    expect(strength.kcal).toBeCloseTo(111.07, 2);
  });

  it('trims a user-typed label rather than storing the trailing space', () => {
    expect(parsed.workouts[1].label).toBe('Trampolín');
  });

  it('tolerates a null distance — present-and-null, not absent', () => {
    // The shape a hand-written fixture would most likely have got wrong: it is
    // `"distance": null`, not a missing key.
    expect(captured.data.every((d) => 'distance' in (d as object))).toBe(true);
    for (const w of parsed.workouts) expect(w.distanceM).toBeUndefined();
  });

  it('does NOT read Oura\'s own `source` as our CardioSource', () => {
    // The wire says `confirmed` — who put the workout into OURA's system. That
    // is a different question from which transport delivered it to us, and
    // every record from this endpoint is `oura` whatever this says.
    expect(captured.data.map((d) => (d as { source: string }).source)).toEqual([
      'confirmed',
      'confirmed',
    ]);
    for (const w of parsed.workouts) expect(w.source).toBe('oura');
  });
});
