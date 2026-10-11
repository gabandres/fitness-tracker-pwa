import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUND_REST_SEC,
  DEFAULT_TRANSITION_REST_SEC,
  classifyPair,
  exerciseUnits,
  groupRest,
  normalizeSupersets,
  pairWithNext,
  pendingLoadTest,
  restAfterSetInFlow,
  snapshotSupersets,
  supersetFlow,
  supersetLabel,
  supersetTags,
  supersetWarnings,
  canPairWithNext,
  reorderWithSupersets,
  unpair,
  type SupersetFields,
} from './superset';
import type { RestSeconds } from './rest-after-set';
import type { MuscleGroup, SetKind } from './workout';

type K = SetKind;
const myo = (clusters: number, extra: K[] = []): { kind: K }[] => [
  ...Array.from({ length: clusters }, () => [{ kind: 'activation' as K }, { kind: 'mini' as K }, { kind: 'mini' as K }]).flat(),
  ...extra.map((kind) => ({ kind })),
];
const row = (id: string, sets: { kind: K }[], s: SupersetFields = {}) => ({ exerciseId: id, name: id, sets, ...s });

// Template rests: 10 s between minis, 90 s between clusters, 60 s after.
const REST: RestSeconds = { mini: 10, cluster: 90, afterExercise: 60 };
const restFor = () => REST;

describe('superset grouping', () => {
  it('labels a member "A1" and a straight row nothing', () => {
    expect(supersetLabel({ supersetGroup: 'A', pairPosition: 2 })).toBe('A2');
    expect(supersetLabel({})).toBeUndefined();
  });

  it('normalizes: gathers members together, re-letters A/B, puts rests on the leader, ungroups a lone member', () => {
    const rows = [
      row('press', myo(2), { supersetGroup: 'C', pairPosition: 1 }),
      row('lone', myo(1), { supersetGroup: 'Q', pairPosition: 1 }),
      row('raise', myo(1)),
      row('crunch', myo(2), { supersetGroup: 'C', pairPosition: 2, transitionRestSec: 40 }),
    ];
    const out = normalizeSupersets(rows);
    expect(out.map((r) => [r.exerciseId, supersetLabel(r) ?? '-'])).toEqual([
      ['press', 'A1'], ['crunch', 'A2'], ['lone', '-'], ['raise', '-'],
    ]);
    expect(out[0]).toMatchObject({ transitionRestSec: 40, roundRestSec: DEFAULT_ROUND_REST_SEC });
    expect(out[1].transitionRestSec).toBeUndefined();
    expect(out[2].supersetGroup).toBeUndefined();
  });

  it('pairWithNext makes a pair, then a tri-set; unpair dissolves a pair whose partner is left alone', () => {
    const rows = [row('a', myo(1)), row('b', myo(1)), row('c', myo(1))];
    const pair = pairWithNext(rows, 0);
    expect(pair.map((r) => supersetLabel(r) ?? '-')).toEqual(['A1', 'A2', '-']);
    const tri = pairWithNext(pair, 1);
    expect(tri.map((r) => supersetLabel(r) ?? '-')).toEqual(['A1', 'A2', 'A3']);
    expect(unpair(pair, 1).map((r) => supersetLabel(r) ?? '-')).toEqual(['-', '-', '-']);
  });

  it('group rests default to 30 s, and the leader\'s value wins', () => {
    const rows = [row('a', myo(1), { supersetGroup: 'A', pairPosition: 1, roundRestSec: 45 }), row('b', myo(1), { supersetGroup: 'A', pairPosition: 2 })];
    expect(groupRest(rows, 'A')).toEqual({ transitionRestSec: DEFAULT_TRANSITION_REST_SEC, roundRestSec: 45 });
  });

  it('snapshots group, position and both rests onto every member for the session', () => {
    const rows = [row('a', myo(1), { supersetGroup: 'A', pairPosition: 1, transitionRestSec: 35, roundRestSec: 40 }), row('b', myo(1), { supersetGroup: 'A', pairPosition: 2 }), row('c', myo(1))];
    expect(snapshotSupersets(rows)).toEqual([
      { supersetGroup: 'A', pairPosition: 1, transitionRestSec: 35, roundRestSec: 40 },
      { supersetGroup: 'A', pairPosition: 2, transitionRestSec: 35, roundRestSec: 40 },
      {},
    ]);
  });
});

describe('exercise units — what a superset alternates', () => {
  it('a cluster is one unit; a trailing drop set rides with the cluster before it', () => {
    expect(exerciseUnits(myo(2))).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(exerciseUnits(myo(1, ['drop']))).toEqual([[0, 1, 2, 3]]);
  });
  it('each straight set is a unit, and a warm-up goes with the unit after it', () => {
    expect(exerciseUnits([{ kind: 'warmup' }, { kind: 'working' }, { kind: 'working' }])).toEqual([[0, 1], [2]]);
  });
});

describe('the alternating flow and its timers', () => {
  // A1 DB Flat Press ×2 clusters ↔ A2 Weighted Floor Crunch ×2 clusters.
  const pushA = [
    row('flat', myo(2), { supersetGroup: 'A', pairPosition: 1 }),
    row('crunch', myo(2), { supersetGroup: 'A', pairPosition: 2 }),
    row('shoulder', myo(1)),
  ];

  it('alternates A1 → A2 → A1 → A2, then moves on', () => {
    expect(supersetFlow(pushA).map((s) => `${s.label ?? s.exerciseIndex}:${s.unit + 1}`))
      .toEqual(['A1:1', 'A2:1', 'A1:2', 'A2:2', '2:1']);
  });

  it('runs the transition timer A1 → A2, the round timer A2 → A1, and the after-exercise rest at the end', () => {
    // Last mini of A1 cluster 1 is set 2; of A2 cluster 1 also 2; cluster 2 ends at 5.
    expect(restAfterSetInFlow(pushA, 0, 2, restFor)).toMatchObject({ kind: 'transition', seconds: 30, next: { exerciseIndex: 1, setIndex: 0, label: 'A2' } });
    expect(restAfterSetInFlow(pushA, 1, 2, restFor)).toMatchObject({ kind: 'round', seconds: 30, next: { exerciseIndex: 0, setIndex: 3, label: 'A1' } });
    expect(restAfterSetInFlow(pushA, 0, 5, restFor)).toMatchObject({ kind: 'transition', next: { exerciseIndex: 1, setIndex: 3 } });
    expect(restAfterSetInFlow(pushA, 1, 5, restFor)).toMatchObject({ kind: 'after-exercise', seconds: 60, next: { exerciseIndex: 2, setIndex: 0 } });
  });

  it('keeps the mini-set rest inside a cluster unchanged (myo-reps inside a pair)', () => {
    expect(restAfterSetInFlow(pushA, 0, 0, restFor)).toMatchObject({ kind: 'intra', seconds: 10, next: { exerciseIndex: 0, setIndex: 1 } });
    expect(restAfterSetInFlow(pushA, 1, 4, restFor)).toMatchObject({ kind: 'intra', seconds: 10 });
  });

  it('uses the group\'s own rests when set', () => {
    const rows = [
      row('a', myo(2), { supersetGroup: 'A', pairPosition: 1, transitionRestSec: 40, roundRestSec: 45 }),
      row('b', myo(2), { supersetGroup: 'A', pairPosition: 2 }),
    ];
    expect(restAfterSetInFlow(rows, 0, 2, restFor).seconds).toBe(40);
    expect(restAfterSetInFlow(rows, 1, 2, restFor).seconds).toBe(45);
  });

  it('a leftover cluster runs on its own with the exercise\'s normal rest (2 clusters ↔ 1)', () => {
    const rows = [
      row('flat', myo(2), { supersetGroup: 'A', pairPosition: 1 }),
      row('raise', myo(1), { supersetGroup: 'A', pairPosition: 2 }),
    ];
    expect(supersetFlow(rows).map((s) => `${s.label}:${s.unit + 1}`)).toEqual(['A1:1', 'A2:1', 'A1:2']);
    expect(restAfterSetInFlow(rows, 0, 2, restFor)).toMatchObject({ kind: 'transition', seconds: 30 });
    // A2 → the leftover A1 cluster: NOT the round rest, the exercise's cluster rest.
    expect(restAfterSetInFlow(rows, 1, 2, restFor)).toMatchObject({ kind: 'cluster', seconds: 90, next: { exerciseIndex: 0, setIndex: 3 } });
    expect(restAfterSetInFlow(rows, 0, 5, restFor)).toMatchObject({ kind: 'after-exercise', seconds: 60 });
  });

  it('a drop set after the last cluster keeps its 10 s rest inside the unit (C2 lateral raise)', () => {
    const rows = [
      row('ohext', myo(1), { supersetGroup: 'C', pairPosition: 1 }),
      row('lateral', myo(1, ['drop']), { supersetGroup: 'C', pairPosition: 2 }),
    ];
    expect(restAfterSetInFlow(rows, 1, 2, restFor)).toMatchObject({ kind: 'intra', seconds: 10 });
    expect(restAfterSetInFlow(rows, 1, 3, restFor)).toMatchObject({ kind: 'after-exercise' });
  });

  it('straight exercises are unchanged: cluster rest between clusters, after-exercise rest at the end', () => {
    const rows = [row('squat', myo(2)), row('rdl', myo(1))];
    expect(restAfterSetInFlow(rows, 0, 2, restFor)).toMatchObject({ kind: 'cluster', seconds: 90 });
    expect(restAfterSetInFlow(rows, 0, 5, restFor)).toMatchObject({ kind: 'after-exercise', seconds: 60, next: { exerciseIndex: 1 } });
  });
});

describe('guardrails — pair type', () => {
  it('two lifts with the same PRIMARY muscle are a same-muscle superset', () => {
    expect(classifyPair(['chest', 'triceps'], ['chest', 'shoulders'])).toEqual({ kind: 'same-muscle', muscle: 'chest' });
  });
  it('quads ↔ hamstrings is agonist–antagonist', () => {
    expect(classifyPair(['quads'], ['hamstrings']).kind).toBe('agonist-antagonist');
  });
  it('chest ↔ core is non-competing', () => {
    expect(classifyPair(['chest', 'triceps'], ['core']).kind).toBe('non-competing');
  });
  it('a press beside a triceps extension shares the triceps: overlapping, not "non-competing"', () => {
    expect(classifyPair(['chest', 'triceps'], ['triceps'])).toEqual({ kind: 'overlapping', muscle: 'triceps' });
  });
  it('an untagged lift is unknown', () => {
    expect(classifyPair([], ['core']).kind).toBe('unknown');
  });

  it('supersetWarnings judges every pair and names pending load tests', () => {
    const muscles: Record<string, MuscleGroup[]> = { ext: ['quads'], curl: ['hamstrings'], a: ['chest'], b: ['chest'] };
    const rows = [
      { exerciseId: 'ext', supersetGroup: 'A', pairPosition: 1 as const },
      { exerciseId: 'curl', supersetGroup: 'A', pairPosition: 2 as const },
      { exerciseId: 'a', supersetGroup: 'B', pairPosition: 1 as const },
      { exerciseId: 'b', supersetGroup: 'B', pairPosition: 2 as const },
    ];
    const w = supersetWarnings(rows, (id) => muscles[id] ?? [], (id) => id === 'curl');
    expect(w).toEqual([
      { group: 'A', pairs: [{ a: 0, b: 1, judgement: { kind: 'agonist-antagonist' } }], pendingLoadTests: [1] },
      { group: 'B', pairs: [{ a: 2, b: 3, judgement: { kind: 'same-muscle', muscle: 'chest' } }], pendingLoadTests: [] },
    ]);
  });
});

describe('guardrails — a pending load test', () => {
  const at = (w: number) => ({ sets: [{ kind: 'activation' as K, weight: w, reps: 12 }, { kind: 'mini' as K, weight: w, reps: 4 }] });
  it('is pending when the planned load is above the last lifted load (Leg Extensions 80 → 90)', () => {
    expect(pendingLoadTest(90, [at(80)])).toEqual({ from: 80, to: 90 });
  });
  it('is not pending at the same load, or with no history', () => {
    expect(pendingLoadTest(80, [at(80)])).toBeNull();
    expect(pendingLoadTest(80, [])).toBeNull();
  });
  it('on an assisted lift, LESS assistance is the new load', () => {
    expect(pendingLoadTest(30, [at(40)], true)).toEqual({ from: 40, to: 30 });
    expect(pendingLoadTest(50, [at(40)], true)).toBeNull();
  });
  it('skips sessions where the lift has no loaded set to read', () => {
    expect(pendingLoadTest(90, [{ sets: [{ kind: 'activation' as K, reps: 10 }] }, at(80)])).toEqual({ from: 80, to: 90 });
  });
});

describe('the flow follows what is logged, not only the plan', () => {
  const rows = [
    row('ext', myo(2), { supersetGroup: 'A', pairPosition: 1 }),
    row('curl', myo(2), { supersetGroup: 'A', pairPosition: 2 }),
    row('knee', myo(1)),
  ];
  it('A2 already done (A1 station was taken): after A1 cluster 1 → A1\'s own cluster rest, staying on A1', () => {
    const done = (e: number) => e === 1;
    expect(restAfterSetInFlow(rows, 0, 2, restFor, done)).toMatchObject({ kind: 'cluster', seconds: 90, next: { exerciseIndex: 0, setIndex: 3 } });
  });
  it('after the group\'s last open unit → the rest after the exercise, into the next lift', () => {
    const done = (e: number, s: number) => e === 1 || (e === 0 && s < 3);
    expect(restAfterSetInFlow(rows, 0, 5, restFor, done)).toMatchObject({ kind: 'after-exercise', next: { exerciseIndex: 2 } });
  });
  it('a round rest says which round comes next, of how many', () => {
    expect(restAfterSetInFlow(rows, 1, 2, restFor)).toMatchObject({ kind: 'round', round: { n: 2, total: 2 } });
  });
});

describe('tags come from the real groups', () => {
  it('a lone member (partner removed) is untagged; a tri-set missing its middle renumbers', () => {
    expect(supersetTags([{ supersetGroup: 'A', pairPosition: 1 }, {}])).toEqual([undefined, undefined]);
    expect(supersetTags([
      { supersetGroup: 'A', pairPosition: 1 }, { supersetGroup: 'A', pairPosition: 3 }, {},
    ])).toEqual(['A1', 'A2', undefined]);
  });
});

describe('pairing never steals a row from another pair', () => {
  it('"Superset with next" leaves a next row that is already paired alone', () => {
    const rows = [row('a', myo(1)), row('b', myo(1), { supersetGroup: 'B', pairPosition: 1 }), row('c', myo(1), { supersetGroup: 'B', pairPosition: 2 })];
    expect(canPairWithNext(rows, 0)).toBe(false);
    expect(pairWithNext(rows, 0).map((r) => supersetLabel(r) ?? '-')).toEqual(['-', 'B1', 'B2']);
  });
  it('the last member of a pair can add the next straight row as a third', () => {
    const rows = [row('a', myo(1), { supersetGroup: 'A', pairPosition: 1 }), row('b', myo(1), { supersetGroup: 'A', pairPosition: 2 }), row('c', myo(1))];
    expect(canPairWithNext(rows, 1)).toBe(true);
    expect(pairWithNext(rows, 1).map((r) => supersetLabel(r))).toEqual(['A1', 'A2', 'A3']);
  });
});

describe('dragging keeps supersets honest', () => {
  const base = () => [
    row('a', myo(1), { supersetGroup: 'A', pairPosition: 1 }),
    row('b', myo(1), { supersetGroup: 'A', pairPosition: 2 }),
    row('c', myo(1)),
    row('d', myo(1)),
  ];
  it('a member dragged away from its partner leaves the superset, and says so', () => {
    const r = reorderWithSupersets(base(), 1, 3);
    expect(r.rows.map((x) => `${x.exerciseId}:${supersetLabel(x) ?? '-'}`)).toEqual(['a:-', 'c:-', 'd:-', 'b:-']);
    expect(r.left?.group).toBe('A');
  });
  it('a straight row dropped between A1 and A2 is moved out, after the block', () => {
    const r = reorderWithSupersets(base(), 3, 1);
    expect(r.rows.map((x) => `${x.exerciseId}:${supersetLabel(x) ?? '-'}`)).toEqual(['a:A1', 'b:A2', 'd:-', 'c:-']);
    expect(r.left).toBeUndefined();
  });
  it('moving the whole pair (dragging A1 next to A2) keeps it', () => {
    const r = reorderWithSupersets(base(), 0, 1);
    expect(r.rows.map((x) => `${x.exerciseId}:${supersetLabel(x) ?? '-'}`)).toEqual(['b:A1', 'a:A2', 'c:-', 'd:-']);
  });
});
