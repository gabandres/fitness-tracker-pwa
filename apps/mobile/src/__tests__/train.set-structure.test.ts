/**
 * ADR-0040 — the structure picker's copy, and the promise that a structure
 * with no engine reader is NAMED rather than silently ignored.
 *
 * The regression this guards: before ADR-0040 the `straight-sets` reason
 * rendered as the empty string, so a lift programmed as straight sets showed
 * nothing at all and the user could not tell a working engine from a broken
 * one. An empty reason line is the failure mode, so every branch here asserts
 * non-empty copy.
 */
import { recommendationText } from '@/components/train/recommendation-text';
import { SET_STRUCTURES } from '@/components/train/train-shared';
import { en } from '@/i18n/en';
import { READABLE_STRUCTURES, type Recommendation } from '@macrolog/core';

const t = ((key: string, vars?: Record<string, unknown>) => {
  const raw = (en as Record<string, string>)[key];
  if (raw == null) throw new Error(`missing i18n key: ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_m, k) => String(vars?.[k] ?? ''));
}) as never;

const base: Recommendation = {
  action: 'none', last: [], assisted: false, band: null,
  calibration: { validSessions: 0, needed: 3, band: null, source: null },
  warnings: [], reason: { kind: 'no-history' },
};

const lines = (reason: Recommendation['reason'], extra: Partial<Recommendation> = {}) => {
  const out = recommendationText({ ...base, ...extra, reason }, 'us', t);
  // A null here IS the bug this file guards: the note never mounts and the
  // refusal is invisible. Fail loudly rather than pass on optional chaining.
  if (out == null) throw new Error(`recommendationText returned null for ${reason.kind}`);
  return out;
};

describe('ADR-0040 recommendation copy', () => {
  it('names the structure when the engine has no reader for it', () => {
    for (const structure of ['drop', 'superset'] as const) {
      const { reason } = lines({ kind: 'unsupported-structure', structure });
      expect(reason).not.toBe('');
      // The user picked this structure; the copy must say which one it is.
      const label = (en as Record<string, string>)[
        SET_STRUCTURES.find((s) => s.value === structure)!.labelKey
      ];
      expect(reason).toContain(label);
    }
  });

  it('reports a straight-sets read instead of the old empty string', () => {
    const building = lines({
      kind: 'straight-sets', reps: 6, targetReps: 8, sessionsAtTarget: 0, holdSessions: 2,
    });
    expect(building.reason).not.toBe('');
    expect(building.reason).toContain('6');
    expect(building.reason).toContain('8');

    const hit = lines({
      kind: 'straight-sets', reps: 8, targetReps: 8, sessionsAtTarget: 2, holdSessions: 2,
    });
    expect(hit.reason).not.toBe('');
    expect(hit.reason).toContain('8');
  });

  it('reports a rest-pause read as a TOTAL, in both states', () => {
    const building = lines({
      kind: 'rest-pause', total: 16, targetReps: 20, sessionsAtTarget: 0, holdSessions: 2,
    });
    expect(building.reason).not.toBe('');
    expect(building.reason).toContain('16');
    expect(building.reason).toContain('20');

    const hit = lines({
      kind: 'rest-pause', total: 20, targetReps: 20, sessionsAtTarget: 2, holdSessions: 2,
    });
    expect(hit.reason).not.toBe('');
    expect(hit.reason).toContain('20');
  });

  it('reports a cluster read as COMPLETION, in both states', () => {
    const building = lines({
      kind: 'cluster-sets', completed: 2, blocks: 3, sessionsAtTarget: 0, holdSessions: 2,
    });
    expect(building.reason).not.toBe('');
    expect(building.reason).toContain('2');
    expect(building.reason).toContain('3');

    const hit = lines({
      kind: 'cluster-sets', completed: 3, blocks: 3, sessionsAtTarget: 2, holdSessions: 2,
    });
    expect(hit.reason).not.toBe('');
    expect(hit.reason).toContain('3');
  });

  it('reports a HIT read as the ONE set, in both states', () => {
    const building = lines({
      kind: 'hit', reps: 6, targetReps: 8, sessionsAtTarget: 0, holdSessions: 2,
    });
    expect(building.reason).not.toBe('');
    expect(building.reason).toContain('6');
    expect(building.reason).toContain('8');

    const held = lines({
      kind: 'hit', reps: 9, targetReps: 8, sessionsAtTarget: 2, holdSessions: 2,
    });
    expect(held.reason).not.toBe('');
    expect(held.reason).toContain('9');
  });

  it('has copy for every non-myo-reps reason', () => {
    expect(lines({ kind: 'no-rule' }).reason).not.toBe('');
    expect(lines({ kind: 'nothing-to-read' }).reason).not.toBe('');
    expect(lines({ kind: 'rest-pause', total: 1, targetReps: 2, sessionsAtTarget: 0, holdSessions: 1 }).reason).not.toBe('');
    expect(lines({ kind: 'cluster-sets', completed: 0, blocks: 1, sessionsAtTarget: 0, holdSessions: 1 }).reason).not.toBe('');
    expect(lines({ kind: 'straight-sets', sessionsAtTarget: 0, holdSessions: 2 }).reason).not.toBe('');
    expect(lines({ kind: 'hit', reps: 1, targetReps: 2, sessionsAtTarget: 0, holdSessions: 1 }).reason).not.toBe('');
  });

  it('never shows the myo-reps calibration count off the myo-reps path', () => {
    // The derived band is an ADR-0039 concept. Counting sessions toward a band
    // a straight-sets lift will never use is noise at best.
    expect(lines({ kind: 'straight-sets', sessionsAtTarget: 1, holdSessions: 2, targetReps: 8 }).calibration).toBeNull();
    expect(lines({ kind: 'no-rule' }).calibration).toBeNull();
    expect(lines({ kind: 'nothing-to-read' }).calibration).toBeNull();
    expect(lines({ kind: 'unsupported-structure', structure: 'drop' }).calibration).toBeNull();
    expect(lines({ kind: 'hit', reps: 8, targetReps: 8, sessionsAtTarget: 1, holdSessions: 2 }).calibration).toBeNull();
    expect(lines({ kind: 'rest-pause', total: 1, targetReps: 2, sessionsAtTarget: 0, holdSessions: 1 }).calibration).toBeNull();
    expect(lines({ kind: 'cluster-sets', completed: 0, blocks: 1, sessionsAtTarget: 0, holdSessions: 1 }).calibration).toBeNull();
  });
});

describe('SET_STRUCTURES picker list', () => {
  it('offers Auto first, then the two readable structures', () => {
    expect(SET_STRUCTURES[0].value).toBeUndefined();
    expect(SET_STRUCTURES.slice(1, 3).map((s) => s.value)).toEqual(['straight', 'myoreps']);
  });

  it('agrees with core about which structures the engine reads', () => {
    // Pinned against core's own list, not a hand-written copy: the picker
    // labelling a structure readable when the engine refuses it is the exact
    // lie ADR-0040 exists to prevent, and a duplicated literal here would let
    // the two drift silently.
    const readable = SET_STRUCTURES.filter((s) => s.readable && s.value != null).map((s) => s.value);
    expect([...readable].sort()).toEqual([...READABLE_STRUCTURES].sort());
  });

  it('has a label in en for every option', () => {
    for (const s of SET_STRUCTURES) {
      expect((en as Record<string, string>)[s.labelKey]).toBeTruthy();
    }
  });
});
