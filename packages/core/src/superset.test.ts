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
  pairSpacing,
  sameMuscleVerdict,
  SAME_MUSCLE_MIN_GAP_SEC,
  snapshotSupersets,
  supersetFlow,
  supersetLabel,
  supersetTags,
  supersetWarnings,
  canPairWithNext,
  reorderWithSupersets,
  moveBlockAware,
  moveInSession,
  canUndoMove,
  orderBlocks,
  undoMoveRows,
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

  it('a one-member round is still a round: the round rest into it (2 clusters ↔ 1)', () => {
    const rows = [
      row('flat', myo(2), { supersetGroup: 'A', pairPosition: 1 }),
      row('raise', myo(1), { supersetGroup: 'A', pairPosition: 2 }),
    ];
    expect(supersetFlow(rows).map((s) => `${s.label}:${s.unit + 1}`)).toEqual(['A1:1', 'A2:1', 'A1:2']);
    expect(restAfterSetInFlow(rows, 0, 2, restFor)).toMatchObject({ kind: 'transition', seconds: 30 });
    // A2 → A1 cluster 2 crosses a round boundary: the round rest, as configured
    // (owner's spec 2026-10-15; until then the lift's own 90 s cluster rest).
    expect(restAfterSetInFlow(rows, 1, 2, restFor)).toMatchObject({ kind: 'round', seconds: 30, round: { n: 2, total: 2 }, next: { exerciseIndex: 0, setIndex: 3, unit: 1 } });
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

describe('one-step moves treat a superset as one unit', () => {
  const rows = () => [
    row('y', myo(1)),
    row('a1', myo(1), { supersetGroup: 'B', pairPosition: 1 }),
    row('a2', myo(1), { supersetGroup: 'B', pairPosition: 2 }),
    row('x', myo(1)),
  ];
  const show = (rs: { exerciseId: string; supersetGroup?: string }[]) => rs.map((r) => `${r.exerciseId}${r.supersetGroup ?? ''}`);
  it('a straight row below the pair moves up OVER the whole pair', () => {
    const r = moveBlockAware(rows(), 3, -1);
    expect(show(r.rows)).toEqual(['y', 'x', 'a1B', 'a2B']);
    expect(r.newIndex).toBe(1);
  });
  it('moving a member moves the whole pair — it never dissolves it', () => {
    const r = moveBlockAware(rows(), 1, -1);
    expect(show(r.rows)).toEqual(['a1B', 'a2B', 'y', 'x']);
    expect(r.newIndex).toBe(0);
  });
  it('at either end nothing moves', () => {
    expect(moveBlockAware(rows(), 0, -1).newIndex).toBe(0);
    expect(show(moveBlockAware(rows(), 3, 1).rows)).toEqual(['y', 'a1B', 'a2B', 'x']);
  });
  it('a session drag keeps its letters and the rests on every member', () => {
    const r = reorderWithSupersets(
      [row('a', myo(1), { supersetGroup: 'B', pairPosition: 1, transitionRestSec: 30, roundRestSec: 45 }),
        row('b', myo(1), { supersetGroup: 'B', pairPosition: 2, transitionRestSec: 30, roundRestSec: 45 }), row('c', myo(1))],
      2, 0, { keepLetters: true, restsOnEveryMember: true },
    );
    expect(r.rows.map((x) => [x.exerciseId, x.supersetGroup, x.roundRestSec])).toEqual([['c', undefined, undefined], ['a', 'B', 45], ['b', 'B', 45]]);
  });
});

describe('a leftover round still says which round it is', () => {
  it('A1 alone in round 2 of 2', () => {
    const rows = [row('a', myo(2), { supersetGroup: 'A', pairPosition: 1 }), row('b', myo(1), { supersetGroup: 'A', pairPosition: 2 })];
    expect(restAfterSetInFlow(rows, 1, 2, restFor)).toMatchObject({ kind: 'round', round: { n: 2, total: 2 } });
  });

  // The 2026-10-11 capture: A1 RDL is ONE cluster (1a/1b/1c), A2 Back Squat is
  // three straight sets. A2's rounds 2 and 3 are leftovers of A2 itself.
  const straight = (n: number): { kind: K }[] => Array.from({ length: n }, () => ({ kind: 'working' as K }));
  const rdlSquat = [
    row('rdl', myo(1), { supersetGroup: 'A', pairPosition: 1 }),
    row('squat', straight(3), { supersetGroup: 'A', pairPosition: 2 }),
  ];

  it('a leftover unit of the SAME exercise says which round it is (1 cluster ↔ 3 straight sets)', () => {
    expect(supersetFlow(rdlSquat).map((s) => `${s.label}:${s.unit + 1}`)).toEqual(['A1:1', 'A2:1', 'A2:2', 'A2:3']);
    const done = (e: number, s: number) => e === 0 || (e === 1 && s === 0);
    expect(restAfterSetInFlow(rdlSquat, 1, 0, restFor, done)).toEqual({
      seconds: 90, kind: 'cluster', round: { n: 2, total: 3 }, next: { exerciseIndex: 1, setIndex: 1, unit: 1, label: 'A2' },
    });
    expect(restAfterSetInFlow(rdlSquat, 1, 1, restFor, (e, s) => e === 0 || s <= 1)).toMatchObject({ kind: 'cluster', round: { n: 3, total: 3 } });
  });

  it('a partner unit the lifter skipped comes first: A1 1a, then A2 set 1 → back to A1 1b on the switch rest', () => {
    const done = (e: number, s: number) => (e === 0 && s === 0) || (e === 1 && s === 0);
    expect(restAfterSetInFlow(rdlSquat, 1, 0, restFor, done)).toEqual({
      seconds: 30, kind: 'transition', next: { exerciseIndex: 0, setIndex: 1, unit: 0, label: 'A1' },
    });
  });

  it('without a logged-state reader nothing counts as skipped (the plan alone)', () => {
    expect(restAfterSetInFlow(rdlSquat, 1, 0, restFor)).toMatchObject({ kind: 'cluster', round: { n: 2, total: 3 }, next: { exerciseIndex: 1, setIndex: 1 } });
  });

  it('an UNTOUCHED partner unit behind is a choice (station taken): the flow carries on forward', () => {
    const done = (e: number, s: number) => e === 1 && s === 0;
    expect(restAfterSetInFlow(rdlSquat, 1, 0, restFor, done)).toMatchObject({ kind: 'cluster', round: { n: 2, total: 3 }, next: { exerciseIndex: 1, setIndex: 1 } });
  });

  it('this exercise twice in a row while the partner still has that round open → its cluster rest, no "partner done"', () => {
    // A2 cluster 1 was done first; A1 cluster 1 just ended. Round 2 has both
    // members open, so it is NOT a leftover: HEAD's own-cluster rest, and no
    // `round` (the bar would otherwise claim "its partner is done").
    const rows = [row('a', myo(3), { supersetGroup: 'A', pairPosition: 1 }), row('b', myo(3), { supersetGroup: 'A', pairPosition: 2 })];
    const done = (e: number, s: number) => s <= 2;
    expect(restAfterSetInFlow(rows, 0, 2, restFor, done)).toEqual({ seconds: 90, kind: 'cluster', next: { exerciseIndex: 0, setIndex: 3, unit: 1, label: 'A1' } });
  });

  it('a skipped partner unit of a LATER round is not pulled forward', () => {
    // A1 ×2 clusters ↔ A2 ×2 clusters; the lifter is on round 1 — A1's round-2
    // cluster is ahead in the flow, not behind, so it is the round rest as ever.
    const rows = [row('a', myo(2), { supersetGroup: 'A', pairPosition: 1 }), row('b', myo(2), { supersetGroup: 'A', pairPosition: 2 })];
    const done = (e: number, s: number) => s <= 2;
    expect(restAfterSetInFlow(rows, 1, 2, restFor, done)).toMatchObject({ kind: 'round', next: { exerciseIndex: 0, setIndex: 3 } });
  });
});

describe('a partner unit left open is offered once, never as a loop', () => {
  const straight = (n: number, lead: K[] = []): { kind: K }[] => [
    ...lead.map((kind) => ({ kind })),
    ...Array.from({ length: n }, () => ({ kind: 'working' as K })),
  ];

  it('(a) an unticked warm-up in A1 unit 0 never sends A2 back to it', () => {
    // A1 = [warm-up, 3 working], A2 = 3 working. The warm-up was skipped; every
    // working set of round 1 is ticked, so round 2 is a plain round rest.
    const rows = [row('a', straight(3, ['warmup']), { supersetGroup: 'A', pairPosition: 1 }), row('b', straight(3), { supersetGroup: 'A', pairPosition: 2 })];
    expect(supersetFlow(rows)[0].setIndices).toEqual([0, 1]);
    const r1 = (e: number, s: number) => (e === 0 ? s === 1 : s === 0);
    expect(restAfterSetInFlow(rows, 1, 0, restFor, r1)).toMatchObject({ kind: 'round', next: { exerciseIndex: 0, setIndex: 2 } });
    const r2 = (e: number, s: number) => (e === 0 ? s === 1 || s === 2 : s <= 1);
    expect(restAfterSetInFlow(rows, 1, 1, restFor, r2)).toMatchObject({ kind: 'round', next: { exerciseIndex: 0, setIndex: 3 } });
  });

  it('(a) a mobility hold rides in unit 0 the same way', () => {
    const rows = [row('a', straight(2, ['mobility']), { supersetGroup: 'A', pairPosition: 1 }), row('b', straight(2), { supersetGroup: 'A', pairPosition: 2 })];
    const done = (e: number, s: number) => (e === 0 ? s === 1 : s === 0);
    expect(restAfterSetInFlow(rows, 1, 0, restFor, done)).toMatchObject({ kind: 'round', next: { exerciseIndex: 0, setIndex: 2 } });
  });

  it('(a) a warm-up open BEFORE a working set left open: the offer resumes at the working set, not the warm-up', () => {
    const rows = [row('a', [{ kind: 'warmup' as K }, ...myo(1)], { supersetGroup: 'A', pairPosition: 1 }), row('b', straight(2), { supersetGroup: 'A', pairPosition: 2 })];
    const done = (e: number, s: number) => (e === 0 ? s === 1 : s === 0);
    expect(restAfterSetInFlow(rows, 1, 0, restFor, done)).toEqual({ seconds: 30, kind: 'transition', next: { exerciseIndex: 0, setIndex: 2, unit: 0, label: 'A1' } });
  });

  it('(b) a myo cluster stopped one mini early is offered in its own round only, not for the rest of the superset', () => {
    // A1 = 2 clusters, A2 = 3 straight sets. A1 cluster 1 stopped after 1 mini.
    const rows = [row('a', myo(2), { supersetGroup: 'A', pairPosition: 1 }), row('b', straight(3), { supersetGroup: 'A', pairPosition: 2 })];
    const early = (s: number) => s === 0 || s === 1;
    // Round 1, A2 set 1: the open mini of this round is offered once …
    expect(restAfterSetInFlow(rows, 1, 0, restFor, (e, s) => (e === 0 ? early(s) : s === 0))).toMatchObject({ kind: 'transition', next: { exerciseIndex: 0, setIndex: 2 } });
    // … the lifter declines and runs A1 cluster 2: round 2's A2 tick goes on, not back.
    const r2 = (e: number, s: number) => (e === 0 ? early(s) || s >= 3 : s <= 1);
    expect(restAfterSetInFlow(rows, 1, 1, restFor, r2)).toMatchObject({ kind: 'cluster', round: { n: 3, total: 3 }, next: { exerciseIndex: 1, setIndex: 2 } });
    // Round 2 A2 tick BEFORE A1 cluster 2: still a forward step (A1 round 2), never round 1's mini.
    const r2b = (e: number, s: number) => (e === 0 ? early(s) : s <= 1);
    expect(restAfterSetInFlow(rows, 1, 1, restFor, r2b)).toMatchObject({ next: { exerciseIndex: 1, setIndex: 2 } });
  });

  it('(b) a stopped-early cluster is not offered once that exercise has a later unit ticked', () => {
    // A1 = 2 clusters ↔ A2 = 2 clusters, A1 cluster 1 stopped early, the lifter
    // already ran A1 cluster 2, and now finishes A2 cluster 1 (same round as the
    // stopped cluster) — moved on, so forward to A2's round 2.
    const rows = [row('a', myo(2), { supersetGroup: 'A', pairPosition: 1 }), row('b', myo(2), { supersetGroup: 'A', pairPosition: 2 })];
    const done = (e: number, s: number) => (e === 0 ? s !== 2 : s <= 2);
    expect(restAfterSetInFlow(rows, 1, 2, restFor, done)).toMatchObject({ kind: 'cluster', next: { exerciseIndex: 1, setIndex: 3 } });
  });

  it('(c) A1 round-1 drop skipped, A2\'s last set ticked → the rest after the exercise, into exercise B', () => {
    const rows = [
      row('a', [{ kind: 'working' as K }, { kind: 'drop' as K }, { kind: 'working' as K }, { kind: 'working' as K }], { supersetGroup: 'A', pairPosition: 1 }),
      row('b', straight(3), { supersetGroup: 'A', pairPosition: 2 }),
      row('c', straight(2)),
    ];
    const done = (e: number, s: number) => (e === 0 ? s !== 1 : e === 1);
    expect(restAfterSetInFlow(rows, 1, 2, restFor, done)).toEqual({ seconds: 60, kind: 'after-exercise', next: { exerciseIndex: 2, setIndex: 0, unit: 0 } });
  });
});

describe('moveInSession — the live session move (▲ / ▼ and drag)', () => {
  type R = { exerciseId: string; name: string; supersetGroup?: string; pairPosition?: 1 | 2 | 3; transitionRestSec?: number; roundRestSec?: number };
  const s = (id: string): R => ({ exerciseId: id, name: id });
  const m = (id: string, g: string, p: 1 | 2): R => ({ exerciseId: id, name: id, supersetGroup: g, pairPosition: p, transitionRestSec: 30, roundRestSec: 45 });
  const rows = (): R[] => [s('press'), m('ext', 'A', 1), m('curl', 'A', 2), s('row')];
  const ids = (xs: readonly R[]) => xs.map((x) => x.exerciseId);

  it('a straight lift moved one step next to a pair hops the whole pair', () => {
    const r = moveInSession(rows(), 0, 1);
    expect(ids(r.rows)).toEqual(['ext', 'curl', 'press', 'row']);
    expect(r.newIndex).toBe(2);
    expect(r.changed).toBe(true);
    expect(r.left).toBeUndefined();
  });

  it('a member moved one step moves the block, never dissolves it', () => {
    const r = moveInSession(rows(), 2, 3);
    expect(ids(r.rows)).toEqual(['press', 'row', 'ext', 'curl']);
    expect(r.newIndex).toBe(3);
    expect(r.rows.filter((x) => x.supersetGroup === 'A')).toHaveLength(2);
  });

  it('a drag that takes a member out of its pair reports it, and the old order can be restored', () => {
    const before = rows();
    const r = moveInSession(before, 1, 3);
    expect(ids(r.rows)).toEqual(['press', 'curl', 'row', 'ext']);
    expect(r.left).toMatchObject({ group: 'A', row: { exerciseId: 'ext' } });
    expect(r.rows.every((x) => !x.supersetGroup)).toBe(true);
    expect(r.newIndex).toBe(3);
    expect(canUndoMove(before, r.rows)).toBe(true);
  });

  it('a straight lift dragged into the middle of a pair lands just after it', () => {
    const r = moveInSession([s('press'), m('ext', 'A', 1), m('curl', 'A', 2), s('row'), s('fly')], 4, 2);
    expect(ids(r.rows)).toEqual(['press', 'ext', 'curl', 'fly', 'row']);
    expect(r.rows[1]).toMatchObject({ supersetGroup: 'A', pairPosition: 1 });
    expect(r.rows[2]).toMatchObject({ supersetGroup: 'A', pairPosition: 2 });
    expect(r.newIndex).toBe(3);
  });

  it('a move at either end, or onto itself, changes nothing', () => {
    expect(moveInSession(rows(), 0, -1).changed).toBe(false);
    expect(moveInSession(rows(), 1, 0).changed).toBe(true);
    expect(moveInSession(rows(), 3, 3).changed).toBe(false);
    // The pair is already first: ▲ on A1 has nowhere to go.
    expect(moveInSession([m('ext', 'A', 1), m('curl', 'A', 2), s('row')], 1, 0).changed).toBe(false);
  });

  it('Undo applies only while the session holds the same lifts', () => {
    const before = rows();
    expect(canUndoMove(before, [...before].reverse())).toBe(true);
    expect(canUndoMove(before, [...before, s('fly')])).toBe(false);
    expect(canUndoMove(before, before.slice(1))).toBe(false);
  });
});

describe('orderBlocks — positions counted in units', () => {
  it('a superset is one place in the order; a stale lone letter is not a block', () => {
    const rows = [{}, { supersetGroup: 'A', pairPosition: 1 as const }, { supersetGroup: 'A', pairPosition: 2 as const }, { supersetGroup: 'B', pairPosition: 1 as const }];
    expect(orderBlocks(rows)).toEqual([[0], [1, 2], [3]]);
  });
});

describe('undoMoveRows — Undo a move, keep what was logged since', () => {
  type R = { exerciseId: string; supersetGroup?: string; pairPosition?: 1 | 2; transitionRestSec?: number; roundRestSec?: number; sets: { reps?: number }[] };
  const before: R[] = [
    { exerciseId: 'press', sets: [{}] },
    { exerciseId: 'ext', supersetGroup: 'A', pairPosition: 1, transitionRestSec: 30, roundRestSec: 45, sets: [{}] },
    { exerciseId: 'curl', supersetGroup: 'A', pairPosition: 2, sets: [{}] },
    { exerciseId: 'row', sets: [{}] },
  ];

  it('a set logged after the move survives the Undo, and the pair comes back', () => {
    // A drag takes A1 out of its pair, to the end.
    const moved = moveInSession(before, 1, 3).rows;
    expect(moved.map((r) => r.exerciseId)).toEqual(['press', 'curl', 'row', 'ext']);
    expect(moved.every((r) => !r.supersetGroup)).toBe(true);
    const logged = moved.map((r) => (r.exerciseId === 'curl' ? { ...r, sets: [{ reps: 10 }] } : r));
    const undone = undoMoveRows(before, logged);
    expect(undone.map((r) => r.exerciseId)).toEqual(['press', 'ext', 'curl', 'row']);
    expect(undone[2].sets).toEqual([{ reps: 10 }]);
    expect(undone[2].sets).toBe(logged.find((r) => r.exerciseId === 'curl')!.sets);
    expect(undone[1]).toMatchObject({ supersetGroup: 'A', pairPosition: 1, transitionRestSec: 30, roundRestSec: 45 });
    expect(undone[2]).toMatchObject({ supersetGroup: 'A', pairPosition: 2 });
  });

  it('a lift added since makes the Undo a no-op', () => {
    const now = [...before, { exerciseId: 'fly', sets: [] }];
    expect(undoMoveRows(before, now)).toEqual(now);
  });
});

describe('undoMoveRows — the same lift twice', () => {
  it('two copies of one lift get their own sets back, matched by the sets array', () => {
    const a = { exerciseId: 'curl', sets: [{ reps: 1 }] };
    const b = { exerciseId: 'curl', sets: [{ reps: 2 }] };
    const x = { exerciseId: 'row', sets: [] as { reps: number }[] };
    const undone = undoMoveRows([a, x, b], [b, x, a]);
    expect(undone.map((r) => r.sets)).toEqual([a.sets, x.sets, b.sets]);
    expect(undone[0].sets).toBe(a.sets);
  });
});

// Push v2's Superset C as the owner ran it on 2026-10-15: one Overhead DB
// Extension cluster, two lateral raise clusters (a drop on the last), one
// Skull Crusher cluster — OHE → LAT c1 → SKULL → LAT c2.
describe('the performed sequence with unequal clusters (Push v2 Superset C, 1/2/1)', () => {
  const C = [
    row('ohe', myo(1), { supersetGroup: 'C', pairPosition: 1, transitionRestSec: 30, roundRestSec: 30 }),
    row('lateral', myo(2, ['drop']), { supersetGroup: 'C', pairPosition: 2 }),
    row('skull', myo(1), { supersetGroup: 'C', pairPosition: 3 }),
  ];
  // The lateral raise rests 60 s between its own clusters (its row's restClusterSec).
  const restForC = (i: number): RestSeconds => (i === 1 ? { ...REST, cluster: 60 } : REST);

  it('round r is every member with a cluster r, in member order: R1 C1 → C2 c1 → C3, R2 C2 c2', () => {
    expect(supersetFlow(C).map((s) => `${s.label}:${s.unit + 1}`)).toEqual(['C1:1', 'C2:1', 'C3:1', 'C2:2']);
    expect(supersetTags(C)).toEqual(['C1', 'C2', 'C3']);
  });

  it('the drop rides with the last lateral cluster only', () => {
    const lat = supersetFlow(C).filter((s) => s.exerciseIndex === 1);
    expect(lat.map((s) => s.setIndices)).toEqual([[0, 1, 2], [3, 4, 5, 6]]);
    expect(lat.map((s) => s.setIndices.some((i) => C[1].sets[i].kind === 'drop'))).toEqual([false, true]);
  });

  it('switch between members, round rest between rounds — also into a one-member round', () => {
    expect(restAfterSetInFlow(C, 0, 2, restForC)).toEqual({ seconds: 30, kind: 'transition', next: { exerciseIndex: 1, setIndex: 0, unit: 0, label: 'C2' } });
    expect(restAfterSetInFlow(C, 1, 2, restForC)).toEqual({ seconds: 30, kind: 'transition', next: { exerciseIndex: 2, setIndex: 0, unit: 0, label: 'C3' } });
    expect(restAfterSetInFlow(C, 2, 2, restForC)).toEqual({ seconds: 30, kind: 'round', round: { n: 2, total: 2 }, next: { exerciseIndex: 1, setIndex: 3, unit: 1, label: 'C2' } });
    // Inside the last cluster: mini rest, then the drop; nothing after the group.
    expect(restAfterSetInFlow(C, 1, 5, restForC)).toMatchObject({ kind: 'intra', seconds: 10, next: { exerciseIndex: 1, setIndex: 6, unit: 1 } });
    expect(restAfterSetInFlow(C, 1, 6, restForC)).toMatchObject({ kind: 'after-exercise' });
  });

  it('the lifter\'s 10/15 order is the one the flow walks, tick by tick', () => {
    const done = new Set<string>();
    const order: string[] = [];
    let at: { exerciseIndex: number; setIndex: number } | undefined = { exerciseIndex: 0, setIndex: 0 };
    while (at) {
      done.add(`${at.exerciseIndex}:${at.setIndex}`);
      const name = C[at.exerciseIndex].exerciseId;
      if (order[order.length - 1] !== name) order.push(name);
      at = restAfterSetInFlow(C, at.exerciseIndex, at.setIndex, restForC, (e, i) => done.has(`${e}:${i}`)).next;
    }
    expect(order).toEqual(['ohe', 'lateral', 'skull', 'lateral']);
    expect(done.size).toBe(3 + 7 + 3);
  });

  it('snapshots C3 with the group\'s rests at start', () => {
    expect(snapshotSupersets(C)[2]).toEqual({ supersetGroup: 'C', pairPosition: 3, transitionRestSec: 30, roundRestSec: 30 });
  });
});

describe('guardrails — a same-muscle pair, judged on the performed sequence', () => {
  const muscles: Record<string, MuscleGroup[]> = { ohe: ['triceps'], lateral: ['shoulders'], skull: ['triceps'], ohe2: ['triceps'] };
  const C = (ohe: number, lat: number, skull: number, switchSec = 30) => [
    row('ohe', myo(ohe), { supersetGroup: 'C', pairPosition: 1, transitionRestSec: switchSec, roundRestSec: 30 }),
    row('lateral', myo(lat, ['drop']), { supersetGroup: 'C', pairPosition: 2 }),
    row('skull', myo(skull), { supersetGroup: 'C', pairPosition: 3 }),
  ];
  const judge = (rows: Parameters<typeof supersetWarnings>[0]) => supersetWarnings(rows, (id) => muscles[id] ?? [], undefined, restFor)[0].pairs;

  it('C1 and C3 with a lateral cluster between them: separated by ~130 s (switch + cluster + switch) → OK', () => {
    const pairs = judge(C(1, 2, 1));
    expect(pairs[1]).toEqual({ a: 0, b: 2, judgement: { kind: 'same-muscle', muscle: 'triceps' }, spacing: { adjacent: false, between: [1], gapSec: 30 + 70 + 30 } });
    expect(sameMuscleVerdict(pairs[1].spacing)).toBe('separated');
    // The non-shared pairs are back-to-back, which says nothing about them.
    expect(pairs[0].spacing).toEqual({ adjacent: true });
  });

  it('separated but under 90 s (5 s switches): too close', () => {
    const p = judge(C(1, 2, 1, 5))[1];
    expect(p.spacing).toEqual({ adjacent: false, between: [1], gapSec: 5 + 70 + 5 });
    expect(p.spacing!.adjacent === false && p.spacing!.gapSec < SAME_MUSCLE_MIN_GAP_SEC).toBe(true);
    expect(sameMuscleVerdict(p.spacing)).toBe('too-close');
  });

  it('adjacent within a round: consecutive', () => {
    const rows = [
      row('ohe', myo(1), { supersetGroup: 'C', pairPosition: 1 }),
      row('skull', myo(1), { supersetGroup: 'C', pairPosition: 2 }),
      row('lateral', myo(2), { supersetGroup: 'C', pairPosition: 3 }),
    ];
    expect(judge(rows)[0].spacing).toEqual({ adjacent: true });
    expect(sameMuscleVerdict(judge(rows)[0].spacing)).toBe('consecutive');
  });

  it('adjacency across a round boundary: an even tri-set runs C3 c1 → C1 c2', () => {
    expect(pairSpacing(C(2, 2, 2), 0, 2, restFor)).toEqual({ adjacent: true });
    expect(sameMuscleVerdict(judge(C(2, 2, 2))[1].spacing)).toBe('consecutive');
  });

  it('a pair is always back-to-back', () => {
    const rows = [row('ohe', myo(2), { supersetGroup: 'A', pairPosition: 1 }), row('ohe2', myo(2), { supersetGroup: 'A', pairPosition: 2 })];
    expect(sameMuscleVerdict(judge(rows)[0].spacing)).toBe('consecutive');
  });

  it('the gap counts the rests as configured on the rows', () => {
    // A 60 s switch: 60 + 70 + 60.
    expect(pairSpacing(C(1, 2, 1, 60), 0, 2, restFor)).toEqual({ adjacent: false, between: [1], gapSec: 190 });
  });

  it('without the members\' sets the order is unknown: no spacing, judged consecutive (the warning stays)', () => {
    const rows = C(1, 2, 1).map(({ sets: _s, ...r }) => r);
    expect(judge(rows).some((p) => 'spacing' in p)).toBe(false);
    expect(sameMuscleVerdict(undefined)).toBe('consecutive');
  });
});

describe('guardrails — consecutive into the next block', () => {
  const muscles: Record<string, MuscleGroup[]> = { pushdown: ['triceps'], ohe: ['triceps'], lateral: ['shoulders'], skull: ['triceps'], curl: ['biceps'] };
  const C = [
    row('ohe', myo(1), { supersetGroup: 'C', pairPosition: 1 }),
    row('lateral', myo(2), { supersetGroup: 'C', pairPosition: 2 }),
    row('skull', myo(1), { supersetGroup: 'C', pairPosition: 3 }),
  ];
  it('a straight triceps lift right before C1 (triceps) is consecutive with it', () => {
    const w = supersetWarnings([row('pushdown', myo(1)), ...C], (id) => muscles[id] ?? [])[0];
    expect(w.neighbours).toEqual([{ member: 1, neighbour: 0, muscle: 'triceps' }]);
  });
  it('after the group: the last cluster is C2 cluster 2 (shoulders), so a triceps lift after it is not consecutive with C3', () => {
    const w = supersetWarnings([...C, row('pushdown', myo(1))], (id) => muscles[id] ?? [])[0];
    expect(w.neighbours).toBeUndefined();
  });
  it('a different primary next door says nothing', () => {
    expect(supersetWarnings([row('curl', myo(1)), ...C], (id) => muscles[id] ?? [])[0].neighbours).toBeUndefined();
  });
});
