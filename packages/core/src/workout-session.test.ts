import { describe, expect, it } from 'vitest';
import { type SessionAction, applySessionAction, newCluster, newWorkoutSet } from './workout-session';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';

/**
 * The in-progress workout's edit rules, as data.
 *
 * Until 2026-08-21 these lived inline in `apps/mobile/src/hooks/useTrain.ts` as
 * eight callbacks, so the Train tab's hardest logic — cluster grouping and
 * set-kind transitions — could only be exercised through a React renderer and
 * in practice was not exercised at all. Which actions renormalize cluster
 * groups and which deliberately do not is the part that was carried in prose.
 */

function ex(name: string, sets: WorkoutSet[]): SessionExercise {
  return { exerciseId: `id-${name}`, name, cues: [], logStyle: 'weight-reps', sets };
}

function session(exercises: SessionExercise[]): WorkoutSession {
  return {
    id: 's1',
    status: 'active',
    date: new Date('2026-08-21T10:00:00Z'),
    exercises,
    createdAt: new Date('2026-08-21T10:00:00Z'),
    updatedAt: new Date('2026-08-21T10:00:00Z'),
  };
}

const working = (): WorkoutSet => ({ kind: 'working', done: false });

describe('applySessionAction — purity', () => {
  it('never mutates the session it is given', () => {
    const s = session([ex('Bench', [working()])]);
    const before = JSON.stringify(s);
    applySessionAction(s, { type: 'addSet', exerciseIndex: 0 });
    applySessionAction(s, { type: 'removeSet', exerciseIndex: 0, setIndex: 0 });
    applySessionAction(s, { type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { reps: 5 } });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('returns the SAME reference when an index is out of range', () => {
    const s = session([ex('Bench', [working()])]);
    const cases: SessionAction[] = [
      { type: 'removeExercise', exerciseIndex: 7 },
      { type: 'removeExercise', exerciseIndex: -1 },
      { type: 'addSet', exerciseIndex: 7 },
      { type: 'addCluster', exerciseIndex: 7 },
      { type: 'patchSet', exerciseIndex: 7, setIndex: 0, patch: { reps: 5 } },
      { type: 'setSetKind', exerciseIndex: 7, setIndex: 0, kind: 'warmup' },
      { type: 'removeSet', exerciseIndex: 7, setIndex: 0 },
    ];
    for (const action of cases) {
      expect(applySessionAction(s, action)).toBe(s);
    }
  });

  it('a set index out of range leaves the sets alone', () => {
    const s = session([ex('Bench', [working()])]);
    const next = applySessionAction(s, {
      type: 'patchSet',
      exerciseIndex: 0,
      setIndex: 9,
      patch: { reps: 5 },
    });
    expect(next.exercises[0].sets).toEqual([working()]);
  });
});

describe('applySessionAction — exercises', () => {
  it('appends an exercise', () => {
    const s = session([ex('Bench', [working()])]);
    const next = applySessionAction(s, { type: 'addExercise', exercise: ex('Row', [working()]) });
    expect(next.exercises.map((e) => e.name)).toEqual(['Bench', 'Row']);
  });

  it('removes an exercise by index', () => {
    const s = session([ex('Bench', []), ex('Row', []), ex('Curl', [])]);
    const next = applySessionAction(s, { type: 'removeExercise', exerciseIndex: 1 });
    expect(next.exercises.map((e) => e.name)).toEqual(['Bench', 'Curl']);
  });

  it('edits only the addressed exercise', () => {
    const s = session([ex('Bench', [working()]), ex('Row', [working()])]);
    const next = applySessionAction(s, { type: 'addSet', exerciseIndex: 1 });
    expect(next.exercises[0].sets).toHaveLength(1);
    expect(next.exercises[1].sets).toHaveLength(2);
    // Untouched exercises keep their identity, so a memoized row does not
    // re-render because a sibling changed.
    expect(next.exercises[0]).toBe(s.exercises[0]);
  });
});

describe('applySessionAction — sets', () => {
  it('addSet appends one empty working set', () => {
    const s = session([ex('Bench', [working()])]);
    const next = applySessionAction(s, { type: 'addSet', exerciseIndex: 0 });
    expect(next.exercises[0].sets).toEqual([working(), newWorkoutSet()]);
  });

  it('patchSet merges fields into one set and leaves siblings alone', () => {
    const s = session([ex('Bench', [working(), working()])]);
    const next = applySessionAction(s, {
      type: 'patchSet',
      exerciseIndex: 0,
      setIndex: 1,
      patch: { reps: 8, weight: 135 },
    });
    expect(next.exercises[0].sets[0]).toEqual(working());
    expect(next.exercises[0].sets[1]).toEqual({ kind: 'working', done: false, reps: 8, weight: 135 });
  });

  it('removeSet drops the addressed set', () => {
    const s = session([ex('Bench', [{ kind: 'warmup' }, { kind: 'working' }, { kind: 'working' }])]);
    const next = applySessionAction(s, { type: 'removeSet', exerciseIndex: 0, setIndex: 0 });
    expect(next.exercises[0].sets.map((x) => x.kind)).toEqual(['working', 'working']);
  });
});

describe('applySessionAction — cluster grouping', () => {
  it('addCluster appends activation + two minis as one numbered group', () => {
    const s = session([ex('Bench', [working()])]);
    const next = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    const sets = next.exercises[0].sets;
    expect(sets.map((x) => x.kind)).toEqual(['working', 'activation', 'mini', 'mini']);
    // The three cluster rows share one group number; the plain working set has
    // none.
    expect(sets[0].group).toBeUndefined();
    expect(sets[1].group).toBe(1);
    expect(sets[2].group).toBe(1);
    expect(sets[3].group).toBe(1);
  });

  it('a second cluster gets its own group number', () => {
    let s = session([ex('Bench', [])]);
    s = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    s = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    expect(s.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('setSetKind FORMS a cluster — that is why it is not a patchSet', () => {
    const s = session([ex('Bench', [working(), { kind: 'mini' }, { kind: 'mini' }])]);
    const next = applySessionAction(s, {
      type: 'setSetKind',
      exerciseIndex: 0,
      setIndex: 0,
      kind: 'activation',
    });
    expect(next.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 1]);
  });

  it('setSetKind demotes the activation, and the orphaned minis regroup', () => {
    let s = session([ex('Bench', [])]);
    s = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    expect(s.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 1]);

    const next = applySessionAction(s, {
      type: 'setSetKind',
      exerciseIndex: 0,
      setIndex: 0,
      kind: 'working',
    });
    // The working set is ungrouped, but the minis do NOT become ungrouped with
    // it: an orphan mini opens its own cluster rather than colliding with set 1
    // (see normalizeClusterGroups). So demoting an activation splits the row
    // off the cluster; it does not dissolve the cluster.
    expect(next.exercises[0].sets.map((x) => x.group)).toEqual([undefined, 1, 1]);
  });

  it('removeSet renumbers the groups that survive', () => {
    let s = session([ex('Bench', [])]);
    s = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    s = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    expect(s.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 1, 2, 2, 2]);

    // Drop the FIRST cluster's activation. Its two minis are orphaned, and an
    // orphan mini opens its OWN cluster — so they keep group 1 between them and
    // the surviving real cluster renumbers to 2. The numbers stay sequential,
    // which is the invariant; they are not stable identifiers.
    const next = applySessionAction(s, { type: 'removeSet', exerciseIndex: 0, setIndex: 0 });
    expect(next.exercises[0].sets.map((x) => x.kind)).toEqual([
      'mini',
      'mini',
      'activation',
      'mini',
      'mini',
    ]);
    expect(next.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 2, 2, 2]);
  });

  it('addSet and patchSet deliberately do NOT renumber', () => {
    let s = session([ex('Bench', [])]);
    s = applySessionAction(s, { type: 'addCluster', exerciseIndex: 0 });
    // A working set appended after a cluster is a plain row, not a fourth
    // cluster member.
    const added = applySessionAction(s, { type: 'addSet', exerciseIndex: 0 });
    expect(added.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 1, undefined]);

    const patched = applySessionAction(s, {
      type: 'patchSet',
      exerciseIndex: 0,
      setIndex: 1,
      patch: { reps: 3 },
    });
    expect(patched.exercises[0].sets.map((x) => x.group)).toEqual([1, 1, 1]);
  });
});

describe('newCluster', () => {
  it('is one activation followed by two minis — the shape the grouper reads', () => {
    expect(newCluster().map((s) => s.kind)).toEqual(['activation', 'mini', 'mini']);
  });
});

// ─── Cardio actions (ADR-0025) ──────────────────────────────────

describe('cardio actions', () => {
  const base = (): WorkoutSession => ({
    status: 'active',
    date: new Date('2026-08-24T12:00:00'),
    exercises: [
      { exerciseId: 'bench', name: 'Bench', cues: [], sets: [{ kind: 'working', weight: 135, reps: 8 }] },
    ],
    createdAt: new Date('2026-08-24T12:00:00'),
    updatedAt: new Date('2026-08-24T12:00:00'),
  });

  it('adds a block to a session that has no cardio field yet', () => {
    const next = applySessionAction(base(), { type: 'addCardio', modality: 'run' });
    expect(next.cardio).toEqual([{ modality: 'run', durationSec: 0, source: 'manual' }]);
  });

  // The prescription footgun ADR-0007 already paid for once, in its cardio
  // form: a freshly added block must not count as work the user did.
  it('adds it with a zero duration, so it is not yet logged work', () => {
    const next = applySessionAction(base(), { type: 'addCardio', modality: 'ride' });
    expect(next.cardio?.[0].durationSec).toBe(0);
  });

  it('patches a block by index', () => {
    const one = applySessionAction(base(), { type: 'addCardio', modality: 'run' });
    const two = applySessionAction(one, {
      type: 'patchCardio',
      blockIndex: 0,
      patch: { durationSec: 1930, distanceM: 8046 },
    });
    expect(two.cardio?.[0]).toMatchObject({ durationSec: 1930, distanceM: 8046, modality: 'run' });
  });

  it('removes a block by index', () => {
    let s = applySessionAction(base(), { type: 'addCardio', modality: 'run' });
    s = applySessionAction(s, { type: 'addCardio', modality: 'ride' });
    const next = applySessionAction(s, { type: 'removeCardio', blockIndex: 0 });
    expect(next.cardio?.map((b) => b.modality)).toEqual(['ride']);
  });

  // Same contract the set actions already have: an out-of-range index is a
  // no-op returning the SAME reference, so a caller can skip the write.
  it('returns the same reference for an out-of-range index', () => {
    const s = base();
    expect(applySessionAction(s, { type: 'patchCardio', blockIndex: 3, patch: {} })).toBe(s);
    expect(applySessionAction(s, { type: 'removeCardio', blockIndex: 0 })).toBe(s);
  });

  // The independence property, asserted where the edits actually happen.
  it('never touches the exercises array', () => {
    const s = base();
    const next = applySessionAction(s, { type: 'addCardio', modality: 'run' });
    expect(next.exercises).toBe(s.exercises);
  });
});
