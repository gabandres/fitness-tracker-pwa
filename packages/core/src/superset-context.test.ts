import { describe, expect, it } from 'vitest';
import {
  applyContextBaselines,
  baselineSince,
  bodyOf,
  buildDraftBody,
  contextBaseline,
  contextChangeReason,
  contextChanges,
  planActivation,
  planRevert,
  planSwaps,
  rowPendingLoadTest,
  templateClustersByMuscle,
  weekOverlap,
} from './superset-context';
import { sessionDurationMin } from './train-view';
import { plannedRestSec, supersetLabel } from './superset';
import { recommend, resolveEngineConfig } from './progression-engine';
import { weeklyClusterAudit } from './weekly-cluster-audit';
import type { SessionExercise, TemplateExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';
import { OWNER_CATALOG, OWNER_SUPERSET_LAYOUTS, OWNER_TEMPLATES } from './__fixtures__/owner-templates-2026-10-11';

const NOW = new Date('2026-10-11T15:00:00Z');
const catalog = (id: string) => OWNER_CATALOG[id];
const musclesOf = (id: string) => OWNER_CATALOG[id]?.muscles;
const idOf = (name: string) => Object.entries(OWNER_CATALOG).find(([, c]) => c.name === name)![0];
const tpl = (name: string) => OWNER_TEMPLATES.find((t) => t.name === name)!;
const drafts = OWNER_SUPERSET_LAYOUTS.map((l) => ({ layout: l, ...buildDraftBody(OWNER_TEMPLATES, l) }));
const draftOf = (name: string) => drafts.find((d) => d.layout.draftOf === name)!;
const ctx = (live: WorkoutTemplate[] = OWNER_TEMPLATES, sessions: WorkoutSession[] = []) => ({ live, catalog, sessions, now: NOW });

/** One cluster at `w`: activation + two minis. */
const cluster = (g: number, w: number, act: number, m1: number, m2: number): WorkoutSet[] => [
  { kind: 'activation', group: g, weight: w, reps: act, rir: 0 },
  { kind: 'mini', group: g, weight: w, reps: m1, rir: 0 },
  { kind: 'mini', group: g, weight: w, reps: m2, rir: 0 },
];
const sx = (id: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise =>
  ({ exerciseId: id, name: OWNER_CATALOG[id]?.name ?? id, cues: [], logStyle: 'weight-reps', sets, ...extra });

describe('context changes', () => {
  it('names added-to-superset, moved-day and position for every row of the Push draft', () => {
    const d = draftOf('Push Day');
    const ch = contextChanges(OWNER_TEMPLATES, { id: d.draftOf, exercises: d.body.exercises });
    const byName = Object.fromEntries([...ch].map(([id, c]) => [OWNER_CATALOG[id].name, c.join('/')]));
    expect(byName).toEqual({
      'DB Flat Press': 'superset',
      'Weighted Floor Crunch': 'superset/day',
      'Incline Dumbbell Press': 'superset/position',
      'Single-leg DB calf raise': 'superset/day',
      'Seated DB Shoulder Press': 'position',
      'Deficit Push-up': 'position',
      'Overhead DB Extension': 'superset/position',
      'DB Lateral Raise': 'superset/position',
      'Skull Crusher': 'position',
    });
  });

  it('flags only the pair on the Pull draft — the rows around it keep their places', () => {
    const d = draftOf('Pull Day');
    const ch = contextChanges(OWNER_TEMPLATES, { id: d.draftOf, exercises: d.body.exercises });
    expect([...ch.keys()].map((id) => OWNER_CATALOG[id].name)).toEqual(['Rear delt DB flye', 'Incline DB Curl 45°']);
  });

  it('removed from a superset is a change; an untouched row is not', () => {
    const paired = draftOf('Leg Day').body.exercises;
    const live = [{ id: 'leg', exercises: paired }];
    const straight = paired.map(({ supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...r }) => r);
    const ch = contextChanges(live, { id: 'leg', exercises: straight });
    expect([...ch].map(([id, c]) => [OWNER_CATALOG[id].name, c])).toEqual([
      ['Leg Extensions', ['superset']],
      ['Leg Curls', ['superset']],
    ]);
  });

  it('reads as "context changed: superset/position"', () => {
    expect(contextChangeReason(['position', 'superset'])).toBe('context changed: superset/position');
  });
});

describe('the context baseline', () => {
  it('drops only at two or more reps under the range minimum, one step down', () => {
    // Leg Extensions: a stack with 70/80/90 entered; isolation range 8–15.
    const b = contextBaseline(['superset'], { since: '2026-10-11', load: 90, catalog: catalog(idOf('Leg Extensions')) });
    expect(b).toEqual({ since: '2026-10-11', reason: 'context changed: superset', dropBackTo: 80, dropBackBelowReps: 7 });
  });

  it('a bodyweight lift at 0 has nothing to drop: its first read just holds', () => {
    expect(contextBaseline(['position'], { since: '2026-10-11', load: 0, catalog: catalog(idOf('Hanging Knee Raise')) }))
      .toEqual({ since: '2026-10-11', reason: 'context changed: position' });
  });

  it('starts tomorrow when the lift was already logged today, so that session is not read as the baseline', () => {
    const id = idOf('Leg Curls');
    const today: Pick<WorkoutSession, 'status' | 'date' | 'exercises'> = { status: 'completed', date: new Date('2026-10-11T09:00:00'), exercises: [sx(id, cluster(1, 90, 10, 4, 3))] };
    expect(baselineSince(id, [today], new Date('2026-10-11T20:00:00'))).toBe('2026-10-12');
    expect(baselineSince(idOf('Leg Extensions'), [today], new Date('2026-10-11T20:00:00'))).toBe('2026-10-11');
  });
});

describe('context-changed reads are not failures (engine integration)', () => {
  // Leg Extensions moved 80 → 90 on 10/7. The first read at 90 is in a superset.
  const id = idOf('Leg Extensions');
  const cat = catalog(id);
  const opts = (baseline?: ReturnType<typeof contextBaseline>) => ({
    expectsCluster: true,
    structure: 'myoreps' as const,
    config: resolveEngineConfig(cat, null),
    availableLoads: cat.availableLoads,
    ...(baseline ? { baseline } : {}),
  });
  const before80 = sx(id, cluster(1, 80, 12, 4, 3));
  const marker = contextBaseline(['superset'], { since: '2026-10-11', load: 90, catalog: cat });

  it('without the marker, 5 reps at the new load is a failed increase: drop back', () => {
    const r = recommend([sx(id, cluster(1, 90, 5, 2, 2)), before80], opts());
    expect(r.action).toBe('drop-back');
  });

  it('with it, the same read (1 under the minimum) is the new baseline: hold, no drop', () => {
    // `engineHistory` cuts history at the marker, so only the superset read remains.
    const r = recommend([sx(id, cluster(1, 90, 7, 2, 2))], opts(marker));
    expect(r.action).toBe('hold');
    expect(r.reason).toMatchObject({ kind: 'baseline-set', reps: 7, note: 'context changed: superset' });
  });

  it('two or more under the minimum (6 vs 8) → drop one step, to 80', () => {
    const r = recommend([sx(id, cluster(1, 90, 6, 2, 2))], opts(marker));
    expect(r.action).toBe('drop-back');
    expect(r.load).toBe(80);
    expect(r.reason).toMatchObject({ kind: 'baseline-drop-back', below: 7, to: 80 });
  });

  it('the validity gate still runs first and is unchanged', () => {
    const r = recommend([sx(id, cluster(1, 90, 10, 9, 8))], opts(marker));
    expect(r.action).toBe('repeat-invalid');
  });

  it('applyContextBaselines stamps only changed rows, and keeps a same-day reason', () => {
    const rows: TemplateExercise[] = [
      { exerciseId: id, name: 'Leg Extensions', targetLoad: 90, plannedSets: [], baseline: { since: '2026-10-11', reason: 'position changed 10/11' } },
      { exerciseId: idOf('Smith squat'), name: 'Smith squat', targetLoad: 30, plannedSets: [] },
    ];
    const out = applyContextBaselines(rows, new Map([[id, ['superset' as const]]]), { since: () => '2026-10-11', catalog });
    expect(out[0].baseline?.reason).toBe('position changed 10/11; context changed: superset');
    expect(out[1]).toBe(rows[1]);
  });
});

describe('the weekly volume audit counts supersetted clusters the same', () => {
  it('a superset session and the same session straight give the same audit', () => {
    const a = idOf('Leg Extensions');
    const b = idOf('Leg Curls');
    const session = (paired: boolean): WorkoutSession => ({
      status: 'completed', date: NOW, createdAt: NOW, updatedAt: NOW,
      exercises: [
        sx(a, cluster(1, 90, 10, 4, 3), paired ? { supersetGroup: 'A', pairPosition: 1 } : {}),
        sx(b, cluster(1, 90, 10, 4, 3), paired ? { supersetGroup: 'A', pairPosition: 2 } : {}),
      ],
    });
    const cat = Object.entries(OWNER_CATALOG).map(([id, c]) => ({ id, muscles: c.muscles }));
    expect(weeklyClusterAudit([session(true)], cat, NOW.getTime() + 1)).toEqual(weeklyClusterAudit([session(false)], cat, NOW.getTime() + 1));
  });
});

describe('the owner\'s drafts', () => {
  it('lay out exactly as specified (labels, order, rests after a group)', () => {
    const show = (name: string) => draftOf(name).body.exercises.map((e) => `${supersetLabel(e) ?? '·'} ${e.name}`);
    expect(show('Push Day')).toEqual([
      'A1 DB Flat Press', 'A2 Weighted Floor Crunch', 'B1 Incline Dumbbell Press', 'B2 Single-leg DB calf raise',
      '· Seated DB Shoulder Press', '· Deficit Push-up', 'C1 Overhead DB Extension', 'C2 DB Lateral Raise', '· Skull Crusher',
    ]);
    expect(show('Pull Day')).toEqual([
      '· Seated Machine Row', '· Neutral-grip pull-up', '· Wide-grip lat pulldown', '· Chest-supported DB row',
      'A1 Rear delt DB flye', 'A2 Incline DB Curl 45°', '· DB hammer curl',
    ]);
    expect(show('Leg Day')).toEqual(['· Smith squat', '· DB Romanian deadlift', 'A1 Leg Extensions', 'A2 Leg Curls', '· Hanging Knee Raise']);
    const lateral = draftOf('Push Day').body.exercises.find((e) => e.name === 'DB Lateral Raise')!;
    expect(lateral.plannedSets.map((p) => p.kind)).toEqual(['activation', 'mini', 'mini', 'drop']);
    expect(lateral.plannedSets[3].weight).toBe(10);
    const calf = draftOf('Push Day').body.exercises.find((e) => e.name === 'Single-leg DB calf raise')!;
    expect(calf.plannedSets.filter((p) => p.kind === 'activation').map((p) => p.label)).toEqual(['L', 'R']);
  });

  it('copy the live loads and leave the live templates untouched', () => {
    const snapshot = JSON.stringify(OWNER_TEMPLATES);
    for (const d of drafts) {
      for (const row of d.body.exercises) {
        const live = OWNER_TEMPLATES.flatMap((t) => t.exercises).find((e) => e.exerciseId === row.exerciseId)!;
        expect(row.targetLoad).toBe(live.targetLoad);
      }
    }
    expect(JSON.stringify(OWNER_TEMPLATES)).toBe(snapshot);
  });

  it('prescribe IDENTICAL weekly clusters per muscle to the active templates', () => {
    const active = templateClustersByMuscle(OWNER_TEMPLATES, musclesOf);
    const draft = templateClustersByMuscle(drafts.map((d) => ({ id: d.draftOf, exercises: d.body.exercises })), musclesOf);
    expect(draft).toEqual(active);
    expect(active.unattributed).toEqual([]);
  });

  it('save rest time: the planned between-unit rest of each draft is lower than its active version', () => {
    const restFor = (t: Pick<WorkoutTemplate, 'restMiniSec' | 'restClusterSec' | 'exercises'>) => (i: number) => ({
      mini: t.exercises[i].restMiniSec ?? t.restMiniSec ?? 10,
      cluster: t.restClusterSec ?? 90,
      ...(t.exercises[i].restAfterSec != null ? { afterExercise: t.exercises[i].restAfterSec } : {}),
    });
    const flowRows = (t: Pick<WorkoutTemplate, 'exercises'>) => t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
    // Push and Leg exchange two lifts, so compare the week: all three together.
    const week = (ts: Pick<WorkoutTemplate, 'restMiniSec' | 'restClusterSec' | 'exercises'>[]) =>
      ts.reduce((sum, t) => sum + plannedRestSec(flowRows(t), restFor(t)), 0);
    const activeWeek = week(OWNER_TEMPLATES);
    const draftWeek = week(drafts.map((d) => d.body));
    expect(draftWeek).toBeLessThan(activeWeek);
  });
});

describe('activate and revert', () => {
  const push = draftOf('Push Day');

  it('activation writes the superset body into the live template, with baselines on every changed row', () => {
    const p = planActivation({ draftOf: push.draftOf, template: push.body }, ctx());
    expect(p.body.name).toBe('Push Day');
    expect(p.body.notes).toBe(tpl('Push Day').notes);
    const flat = p.body.exercises.find((e) => e.name === 'DB Flat Press')!;
    expect(flat.baseline).toEqual({ since: '2026-10-11', reason: 'context changed: superset', dropBackTo: 20, dropBackBelowReps: 5 });
    expect(flat.lastModifiedBy).toBe('user');
    // Activating Push alone leaves the two moved lifts on Leg Day too.
    expect(p.overlap.doubled.map((x) => x.name)).toEqual(['Weighted Floor Crunch', 'Single-leg DB calf raise']);
  });

  it('activation takes loads that moved since the draft was made', () => {
    const live = OWNER_TEMPLATES.map((t) => t.name !== 'Leg Day' ? t : {
      ...t,
      exercises: t.exercises.map((e) => e.name === 'Weighted Floor Crunch' ? { ...e, targetLoad: 35 } : e),
    });
    const p = planActivation({ draftOf: push.draftOf, template: push.body }, ctx(live));
    expect(p.body.exercises.find((e) => e.name === 'Weighted Floor Crunch')!.targetLoad).toBe(35);
  });

  it('activate → revert with nothing logged restores the straight-set template exactly', () => {
    const original = tpl('Push Day');
    const act = planActivation({ draftOf: push.draftOf, template: push.body }, ctx());
    const live = OWNER_TEMPLATES.map((t) => (t.id === push.draftOf ? { ...t, ...act.body } : t));
    const rev = planRevert({ draftOf: push.draftOf, previous: act.replaced, activatedAt: NOW.toISOString() }, ctx(live));
    expect(rev.body).toEqual(bodyOf(original));
  });

  it('a load gained during the superset weeks survives the revert (no data loss)', () => {
    const act = planActivation({ draftOf: push.draftOf, template: push.body }, ctx());
    const moved = act.body.exercises.map((e) => e.name !== 'DB Flat Press' ? e : {
      ...e, targetLoad: 30, loadLog: [...(e.loadLog ?? []), { at: '2026-10-18T12:00:00Z', from: 25, to: 30, by: 'engine' as const, reason: 'add load' }],
    });
    const live = OWNER_TEMPLATES.map((t) => (t.id === push.draftOf ? { ...t, ...act.body, exercises: moved } : t));
    const rev = planRevert({ draftOf: push.draftOf, previous: act.replaced, activatedAt: NOW.toISOString() }, ctx(live));
    const flat = rev.body.exercises.find((e) => e.name === 'DB Flat Press')!;
    expect(flat.targetLoad).toBe(30);
    expect(flat.loadLog?.at(-1)).toMatchObject({ from: 25, to: 30 });
    expect(rev.body.exercises.map((e) => e.name)).toEqual(tpl('Push Day').exercises.map((e) => e.name));
  });

  it('after a superset session, coming OUT of the superset is a context change too', () => {
    const act = planActivation({ draftOf: push.draftOf, template: push.body }, ctx());
    const live = OWNER_TEMPLATES.map((t) => (t.id === push.draftOf ? { ...t, ...act.body } : t));
    const flatId = idOf('DB Flat Press');
    const later = new Date('2026-10-16T11:00:00Z');
    const s: WorkoutSession = {
      status: 'completed', date: later, createdAt: later, updatedAt: later, templateId: push.draftOf,
      exercises: [sx(flatId, cluster(1, 25, 9, 3, 3), { supersetGroup: 'A', pairPosition: 1 })],
    };
    const rev = planRevert(
      { draftOf: push.draftOf, previous: act.replaced, activatedAt: NOW.toISOString() },
      { ...ctx(live, [s]), now: new Date('2026-10-17T08:00:00Z') },
    );
    expect(rev.body.exercises.find((e) => e.exerciseId === flatId)!.baseline)
      .toMatchObject({ since: '2026-10-17', reason: 'context changed: superset' });
  });
});

describe('the pending-load-test check reads the load the session will seed', () => {
  // Leg Extensions: the owner moved 80 → 90 on 10/7 after a 10/6 session at 80.
  const row = tpl('Leg Day').exercises.find((e) => e.name === 'Leg Extensions')!;
  const id = row.exerciseId;
  const at80: WorkoutSession = {
    status: 'completed', date: new Date('2026-10-06T12:16:00Z'), createdAt: NOW, updatedAt: NOW,
    exercises: [sx(id, cluster(1, 80, 12, 4, 3))],
  };
  it('is pending when the call (the lifter\'s 90) is above the last lifted 80', () => {
    expect(rowPendingLoadTest(row, [at80], catalog(id))).toEqual({ from: 80, to: 90 });
  });
  it('is not pending once a session has been lifted at 90', () => {
    const at90 = { ...at80, date: new Date('2026-10-13T12:00:00Z'), exercises: [sx(id, cluster(1, 90, 9, 3, 2))] };
    expect(rowPendingLoadTest(row, [at90, at80], catalog(id))).toBeNull();
  });
});

describe('session duration, start to finish', () => {
  it('whole minutes between start and the tap of Finish', () => {
    expect(sessionDurationMin(new Date('2026-10-07T11:39:00Z'), new Date('2026-10-07T12:38:30Z'))).toBe(60);
  });
  it('undefined for an interval no session has: zero, negative, or over a day', () => {
    expect(sessionDurationMin(NOW, NOW)).toBeUndefined();
    expect(sessionDurationMin(NOW, new Date(NOW.getTime() - 60_000))).toBeUndefined();
    expect(sessionDurationMin(NOW, new Date(NOW.getTime() + 25 * 3_600_000))).toBeUndefined();
  });
});

describe('switching Push and Leg — in either order, or together', () => {
  const push = draftOf('Push Day');
  const leg = draftOf('Leg Day');
  const crunchId = idOf('Weighted Floor Crunch');
  const crunchIn = (p: { body: { exercises: TemplateExercise[] } }) => p.body.exercises.find((e) => e.exerciseId === crunchId)!;
  const liveAfter = (live: WorkoutTemplate[], id: string, body: object) => live.map((t) => (t.id === id ? { ...t, ...body } : t));

  it('Leg first, then Push: the moved crunch still gets its baseline and the live load', () => {
    const legPlan = planActivation({ draftOf: leg.draftOf, template: leg.body }, ctx());
    const live = liveAfter(OWNER_TEMPLATES, leg.draftOf, legPlan.body);
    const retired = [{ id: leg.draftOf, ...legPlan.replaced }];
    const pushPlan = planActivation({ draftOf: push.draftOf, template: push.body }, { ...ctx(live), retired });
    expect(crunchIn(pushPlan).baseline?.reason).toBe('context changed: superset/day');
    expect(crunchIn(pushPlan).targetLoad).toBe(30);
  });

  it('together: one plan per draft, the same baselines, and no lift doubled or dropped in the final week', () => {
    const plans = planSwaps([
      { mode: 'activate', draft: { draftOf: push.draftOf, template: push.body } },
      { mode: 'activate', draft: { draftOf: leg.draftOf, template: leg.body } },
    ], ctx());
    expect(crunchIn(plans[0]).baseline?.reason).toBe('context changed: superset/day');
    expect(plans.every((p) => p.overlap.doubled.length === 0 && p.overlap.dropped.length === 0)).toBe(true);
  });

  it('together, the other way round, gives the same week', () => {
    const plans = planSwaps([
      { mode: 'activate', draft: { draftOf: leg.draftOf, template: leg.body } },
      { mode: 'activate', draft: { draftOf: push.draftOf, template: push.body } },
    ], ctx());
    expect(crunchIn(plans[1]).baseline?.reason).toBe('context changed: superset/day');
    expect(plans.every((p) => p.overlap.doubled.length === 0 && p.overlap.dropped.length === 0)).toBe(true);
  });

  it('switching both back restores both straight-set templates exactly', () => {
    const on = planSwaps([
      { mode: 'activate', draft: { draftOf: push.draftOf, template: push.body } },
      { mode: 'activate', draft: { draftOf: leg.draftOf, template: leg.body } },
    ], ctx());
    let live = liveAfter(OWNER_TEMPLATES, push.draftOf, on[0].body);
    live = liveAfter(live, leg.draftOf, on[1].body);
    const back = planSwaps([
      { mode: 'revert', draft: { draftOf: push.draftOf, previous: on[0].replaced, activatedAt: NOW.toISOString() } },
      { mode: 'revert', draft: { draftOf: leg.draftOf, previous: on[1].replaced, activatedAt: NOW.toISOString() } },
    ], ctx(live));
    expect(back[0].body).toEqual(bodyOf(tpl('Push Day')));
    expect(back[1].body).toEqual(bodyOf(tpl('Leg Day')));
  });
});

describe('week overlap reports only what the swap changes', () => {
  it('a lift already on two days before the swap is not "moved here"', () => {
    const shared = { exerciseId: 'bench', name: 'Bench Press', plannedSets: [] };
    const live = [
      { id: 'upper', name: 'Upper A', exercises: [shared] },
      { id: 'qa', name: 'QA Superset', exercises: [shared] },
    ];
    const next = { exercises: [{ ...shared, supersetGroup: 'A', pairPosition: 1 as const }] };
    expect(weekOverlap(live, 'upper', next)).toEqual({ doubled: [], dropped: [] });
  });
});
