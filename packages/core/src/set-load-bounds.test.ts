import { describe, expect, it } from 'vitest';
import { type DocCodec, toSessionDoc, toSessionPatch } from './firestore-writers';
import {
  ADDED_LOAD_ABS_MAX_LB,
  SET_LOAD_ABS_MAX_LB,
  SET_LOAD_MAX_LB,
  clampSetLoad,
  isStorableSetLoad,
  sanitizeSessionExercises,
} from './set-load-bounds';
import type { SessionExercise } from './workout';

/**
 * #85 — a live account stored `weight: 1275` on a set of BODYWEIGHT glute
 * bridges. `firestore.rules` cannot iterate a list, so it never validates a
 * set at all and there is no server-side fallback for this class.
 */

/** Mirrors the stand-in in `firestore-writers.test.ts` — plain, comparable
 *  values so a test can assert on the emitted doc directly. */
const codec: DocCodec<{ ts: number }> = {
  timestamp: (d) => ({ ts: d.getTime() }),
  remove: () => '<delete>',
};

const NOW = new Date(2026, 7, 25, 9, 0);

function ex(sets: SessionExercise['sets'], logStyle?: SessionExercise['logStyle']): SessionExercise {
  return { exerciseId: 'e1', name: 'Glute Bridge', cues: [], sets, ...(logStyle ? { logStyle } : {}) };
}

describe('clampSetLoad', () => {
  it('accepts an ordinary load', () => {
    expect(clampSetLoad(135)).toBe(135);
    expect(clampSetLoad('47.5')).toBe(47.5);
  });

  it('keeps ZERO — an empty bar is a real load', () => {
    // The guard that matters: `Number('')` is also 0, so emptiness must be
    // checked before coercion or clearing the field would record a 0 lb set.
    expect(clampSetLoad(0)).toBe(0);
    expect(clampSetLoad('')).toBeUndefined();
    expect(clampSetLoad(null)).toBeUndefined();
    expect(clampSetLoad(undefined)).toBeUndefined();
  });

  it('rejects a typo rather than clamping it down', () => {
    // Unlike RIR, where "very easy" made a clamp the unambiguous intent,
    // nobody who typed 12750 meant the ceiling.
    expect(clampSetLoad(12750)).toBeUndefined();
    expect(clampSetLoad(SET_LOAD_MAX_LB + 1)).toBeUndefined();
    expect(clampSetLoad(SET_LOAD_MAX_LB)).toBe(SET_LOAD_MAX_LB);
  });

  it('rejects negatives and nonsense', () => {
    expect(clampSetLoad(-5)).toBeUndefined();
    expect(clampSetLoad('heavy')).toBeUndefined();
    expect(clampSetLoad(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampSetLoad(Number.NaN)).toBeUndefined();
  });
});

describe('isStorableSetLoad — the wider backstop', () => {
  it('is wider than the input ceiling, on purpose', () => {
    // Same split as ./weight-bounds: a genuine load near the soft ceiling must
    // still save down a path that did not go through the input.
    expect(SET_LOAD_ABS_MAX_LB).toBeGreaterThan(SET_LOAD_MAX_LB);
    expect(isStorableSetLoad(SET_LOAD_MAX_LB + 100)).toBe(true);
    expect(isStorableSetLoad(SET_LOAD_ABS_MAX_LB + 1)).toBe(false);
  });
});

describe('sanitizeSessionExercises', () => {
  it('drops a load no lift could produce', () => {
    const out = sanitizeSessionExercises([ex([{ kind: 'working', reps: 10, weight: 99999 }])]);
    expect(out[0].sets[0]).toEqual({ kind: 'working', reps: 10 });
  });

  it('drops the FIELD rather than zeroing it', () => {
    // 0 is a real load, so writing 0 would replace "corrupt" with "lifted
    // nothing" — data instead of absence.
    const out = sanitizeSessionExercises([ex([{ kind: 'working', reps: 10, weight: 99999 }])]);
    expect('weight' in out[0].sets[0]).toBe(false);
  });

  it('returns the SAME ARRAY when nothing needed fixing', () => {
    // Identity matters: a copy on every save rewrites the whole doc.
    const input = [ex([{ kind: 'working', reps: 10, weight: 135 }])];
    expect(sanitizeSessionExercises(input)).toBe(input);
  });

  it('does not copy exercises that were already clean', () => {
    const clean = ex([{ kind: 'working', reps: 8, weight: 100 }]);
    const dirty = ex([{ kind: 'working', reps: 8, weight: 99999 }]);
    const out = sanitizeSessionExercises([clean, dirty]);
    expect(out[0]).toBe(clean);
    expect(out[1]).not.toBe(dirty);
  });

  it('keeps a plausible ADDED load on a bodyweight exercise', () => {
    // The reported account's other glute-bridge sets carry 12 lb, which is a
    // held dumbbell. Stripping those would delete real work.
    const out = sanitizeSessionExercises([ex([{ kind: 'working', reps: 10, weight: 12 }], 'bodyweight')]);
    expect(out[0].sets[0].weight).toBe(12);
  });

  /**
   * The bound follows the movement. This is the pair that a single global
   * ceiling could not express, and the reason #85 needed two numbers.
   */
  describe('the reported defect: 1,275 lb', () => {
    const bad = [{ kind: 'working' as const, reps: 10, weight: 1275 }];

    it('is REJECTED on a bodyweight exercise — nobody hangs that off a belt', () => {
      const out = sanitizeSessionExercises([ex(bad, 'bodyweight')]);
      expect('weight' in out[0].sets[0]).toBe(false);
      expect(1275).toBeGreaterThan(ADDED_LOAD_ABS_MAX_LB);
    });

    it('is KEPT on a weight-reps exercise — that is a loaded leg press', () => {
      const out = sanitizeSessionExercises([ex(bad, 'weight-reps')]);
      expect(out[0].sets[0].weight).toBe(1275);
    });

    it('treats a missing logStyle as weight-reps, the documented default', () => {
      expect(sanitizeSessionExercises([ex(bad)])[0].sets[0].weight).toBe(1275);
    });
  });
});

describe('the write seam', () => {
  const dirty = [ex([{ kind: 'working', reps: 10, weight: 99999 }])];

  it('sanitizes through toSessionDoc', () => {
    const doc = toSessionDoc({ status: 'completed', date: NOW, exercises: dirty }, codec, NOW);
    expect(doc.exercises[0].sets[0]).toEqual({ kind: 'working', reps: 10 });
  });

  it('sanitizes through toSessionPatch — the live logger writes through this one', () => {
    const patch = toSessionPatch({ exercises: dirty }, codec, NOW);
    expect((patch['exercises'] as SessionExercise[])[0].sets[0]).toEqual({ kind: 'working', reps: 10 });
  });

  it('leaves a template alone — templates carry plannedSets, not sets', () => {
    // Guards the mistake made while wiring this: `exercises: draft.exercises`
    // appears in BOTH the template and session writers.
    const doc = toSessionDoc({ status: 'active', date: NOW }, codec, NOW);
    expect(doc.exercises).toEqual([]);
  });
});
