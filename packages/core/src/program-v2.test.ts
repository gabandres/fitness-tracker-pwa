/**
 * Program v2 (2026-10-11) — the spec's tests 1–9, against the owner's real
 * templates (`owner-templates-2026-10-11.ts`, read from Firestore) and the
 * layouts the data script writes (`owner-program-v2.ts`). Test 10 (export) is
 * in `csv-export.test.ts`; the live timer and the auto-switch on the device
 * are in the mobile suite.
 */
import { describe, expect, it } from 'vitest';
import { buildDraftBody, planActivation, planSwaps, sessionCall, type TemplateDraftDoc } from './superset-context';
import { PROGRAM_V2_REASON, programAutoActivation, programVersion, templateVersionFor } from './program';
import { plannedVolume, clusterCount, primaryMuscleOf } from './volume-credits';
import { readableHistory, sidesOf } from './side-tracks';
import { roundRestWithFloor, supersetTags, CLUSTER_ESTIMATE_SEC } from './superset';
import { exerciseSupersetReport } from './superset-report';
import { zone2Check } from './cardio';
import { sleepWeekAverage } from './sleep-intake';
import { finishProgression, sideRecKey } from './progression-apply';
import { recommend, recommendOptionsFor } from './progression-engine';
import { estimateTemplateDuration } from './session-duration';
import type { SessionExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';
import { OWNER_CATALOG, OWNER_TEMPLATES } from './__fixtures__/owner-templates-2026-10-11';
import { PROGRAM_V2_LAYOUTS } from './__fixtures__/owner-program-v2';

const NOW = new Date('2026-10-12T15:00:00Z');
const musclesOf = (id: string) => OWNER_CATALOG[id]?.muscles;
const catalog = (id: string) => OWNER_CATALOG[id];
const idOf = (name: string) => Object.entries(OWNER_CATALOG).find(([, c]) => c.name === name)![0];
const primaryOf = (row: { name: string; exerciseId: string }) => primaryMuscleOf(row.name, musclesOf(row.exerciseId));
const v1 = (name: string) => OWNER_TEMPLATES.find((t) => t.name === name)!;
const built = PROGRAM_V2_LAYOUTS.map((l) => ({ layout: l, ...buildDraftBody(OWNER_TEMPLATES, l, primaryOf) }));
const v2 = (name: string) => built.find((b) => b.layout.draftOf === name)!;

const cluster = (g: number, w: number, act: number, m1 = 4, m2 = 3, label?: string): WorkoutSet[] => [
  { kind: 'activation', group: g, weight: w, reps: act, rir: 0, ...(label ? { label } : {}) },
  { kind: 'mini', group: g, weight: w, reps: m1, rir: 0 },
  { kind: 'mini', group: g, weight: w, reps: m2, rir: 0 },
];
const session = (day: string, templateId: string, exercises: SessionExercise[], status: WorkoutSession['status'] = 'completed'): WorkoutSession => ({
  status, templateId, date: new Date(`${day}T18:00:00Z`), createdAt: new Date(`${day}T18:00:00Z`), updatedAt: new Date(`${day}T18:00:00Z`), exercises,
});
const sx = (name: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise =>
  ({ exerciseId: idOf(name), name, cues: [], logStyle: 'weight-reps', sets, ...extra });

// ─── Test 1 ─────────────────────────────────────────────────────
describe('1 · v1 runs the next Push; v2 switches on for all three, once, after it — and the toggle overrides', () => {
  const push = v1('Push Day').id!;
  const pull = v1('Pull Day').id!;
  const armedAt = '2026-10-12T10:00:00Z';
  const drafts = (over: Partial<TemplateDraftDoc> = {}) => built.map((b, i) => ({
    draftOf: b.draftOf, status: 'draft' as const, program: 'v2' as const,
    ...(i === 0 ? { autoActivate: { afterTemplateId: push, after: armedAt } } : {}),
    ...over,
  }));

  it('before the Push session, every template runs as v1', () => {
    expect(programVersion(drafts())).toBe('v1');
    expect(templateVersionFor(push, drafts())).toBe('v1');
    expect(templateVersionFor(pull, drafts())).toBe('v1');
    expect(templateVersionFor('some-other-template', drafts())).toBeUndefined();
  });

  it('a completed Push after arming switches ALL THREE on', () => {
    const on = programAutoActivation(drafts(), session('2026-10-13', push, []));
    expect(on.map((d) => d.draftOf).sort()).toEqual(built.map((b) => b.draftOf).sort());
  });

  it('not for Pull, not for an unfinished Push, not for a Push started before arming', () => {
    expect(programAutoActivation(drafts(), session('2026-10-13', pull, []))).toEqual([]);
    expect(programAutoActivation(drafts(), session('2026-10-13', push, [], 'active'))).toEqual([]);
    expect(programAutoActivation(drafts(), { status: 'completed', templateId: push, date: new Date('2026-10-12T09:00:00Z') })).toEqual([]);
  });

  it('exactly once: never after it ran (even switched back by hand), never while v2 is on', () => {
    expect(programAutoActivation(drafts({ autoActivatedAt: '2026-10-13T19:00:00Z' }), session('2026-10-16', push, []))).toEqual([]);
    expect(programAutoActivation(drafts({ status: 'active' }), session('2026-10-16', push, []))).toEqual([]);
  });

  it('the manual toggle disarms it: with no autoActivate, a Push switches nothing', () => {
    const toggled = drafts().map(({ autoActivate: _a, ...d }) => d);
    expect(programAutoActivation(toggled, session('2026-10-13', push, []))).toEqual([]);
  });

  it('the switch is logged on each template with the reason', () => {
    const plans = planSwaps(built.map((b) => ({
      mode: 'activate' as const,
      draft: { draftOf: b.draftOf, template: b.body, program: 'v2' as const, reason: PROGRAM_V2_REASON, keepBaselines: b.keepBaselines },
    })), { live: OWNER_TEMPLATES, catalog, sessions: [], now: NOW });
    for (const p of plans) expect(p.body.notes?.split('\n').at(-1)).toBe(`2026-10-12: ${PROGRAM_V2_REASON}`);
    expect(templateVersionFor(push, drafts({ status: 'active' }))).toBe('v2');
  });
});

// ─── Test 2 ─────────────────────────────────────────────────────
describe('2 · Push v2 order and blocks match the spec; Pull and Leg have no superset; Leg has no crunch or calf', () => {
  it('Push v2: order, blocks, clusters', () => {
    const rows = v2('Push Day').body.exercises;
    const clusters = (r: (typeof rows)[number]) => {
      const labels = r.plannedSets.filter((p) => p.kind === 'activation').map((p) => p.label);
      return labels.every(Boolean) ? labels.join('+') : String(labels.length);
    };
    const tags = supersetTags(rows);
    expect(rows.map((r, i) => `${tags[i] ?? '—'} ${r.name} ×${clusters(r)}`)).toEqual([
      'A1 DB Flat Press ×2',
      'A2 Weighted Floor Crunch ×2',
      'B1 Incline Dumbbell Press ×2',
      'B2 Single-leg DB calf raise ×L+R',
      '— Seated DB Shoulder Press ×1',
      '— Deficit Push-up ×1',
      'C1 Overhead DB Extension ×1',
      'C2 DB Lateral Raise ×2',
      '— Skull Crusher ×1',
    ]);
    expect(v2('Push Day').body.cardioBlocks).toEqual([{ modality: 'walk', label: 'Zone 2', targetDurationSec: 1200, targetHrMin: 120, targetHrMax: 130 }]);
  });

  it('Push v2 timers: 30 s transitions and rounds, 60 s after each block, 60 s between the lateral\'s clusters, A1/B1 ≥ 90 s', () => {
    const rows = v2('Push Day').body.exercises;
    const by = (name: string) => rows.find((r) => r.name === name)!;
    expect(by('DB Flat Press')).toMatchObject({ transitionRestSec: 30, roundRestSec: 30, minClusterRestSec: 90 });
    expect(by('Incline Dumbbell Press')).toMatchObject({ transitionRestSec: 30, roundRestSec: 30, minClusterRestSec: 90 });
    expect(by('Weighted Floor Crunch').restAfterSec).toBe(60);
    expect(by('Single-leg DB calf raise').restAfterSec).toBe(60);
    expect(by('DB Lateral Raise')).toMatchObject({ restAfterSec: 60, restClusterSec: 60 });
    expect(by('Single-leg DB calf raise').cues).toContain('1–2 s pause at the bottom stretch.');
    // …added once, never beside a live cue that already says it.
    const live = { ...v1('Leg Day'), exercises: v1('Leg Day').exercises.map((e) => (e.name === 'Single-leg DB calf raise' ? { ...e, cues: ['full stretch + 1–2 s pause'] } : e)) };
    const again = buildDraftBody([v1('Push Day'), v1('Pull Day'), live], PROGRAM_V2_LAYOUTS[0], primaryOf).body.exercises.find((r) => r.name === 'Single-leg DB calf raise')!;
    expect(again.cues).toEqual(['full stretch + 1–2 s pause']);
  });

  it('Pull v2 and Leg v2: straight sets; Leg without the crunch and the calf raise; same order as v1 otherwise', () => {
    for (const name of ['Pull Day', 'Leg Day']) {
      expect(v2(name).body.exercises.every((r) => r.supersetGroup == null)).toBe(true);
    }
    expect(v2('Pull Day').body.exercises.map((r) => r.name)).toEqual(v1('Pull Day').exercises.map((r) => r.name));
    const leg = v2('Leg Day').body.exercises.map((r) => r.name);
    expect(leg).toEqual(['Smith squat', 'DB Romanian deadlift', 'Leg Extensions', 'Leg Curls', 'Hanging Knee Raise']);
    expect(leg).not.toContain('Weighted Floor Crunch');
    expect(leg).not.toContain('Single-leg DB calf raise');
  });

  it('straight rests are computed: 105 (90–120) into the same primary muscle, 60 on a switch', () => {
    const rest = (name: string) => v2(name).body.exercises.map((r) => `${r.name}: ${r.restAfterSec}${r.restAfterMaxSec ? `-${r.restAfterMaxSec}` : ''}${r.restClusterSec ? ` (c ${r.restClusterSec})` : ''}`);
    expect(rest('Pull Day')).toEqual([
      'Seated Machine Row: 105-120 (c 105)',
      'Neutral-grip pull-up: 105-120',
      'Wide-grip lat pulldown: 105-120',
      'Chest-supported DB row: 60',
      'Rear delt DB flye: 60',
      'Incline DB Curl 45°: 105-120',
      'DB hammer curl: 60',
    ]);
    expect(rest('Leg Day')).toEqual([
      'Smith squat: 60 (c 105)',
      'DB Romanian deadlift: 60',
      'Leg Extensions: 60',
      'Leg Curls: 60',
      'Hanging Knee Raise: 60',
    ]);
  });

  it('Pull v2 carries no drop set on either curl (the 10/10 cleanup removed them)', () => {
    const curls = v2('Pull Day').body.exercises.filter((r) => /curl/i.test(r.name));
    expect(curls).toHaveLength(2);
    expect(curls.every((r) => r.plannedSets.every((p) => p.kind !== 'drop'))).toBe(true);
  });
});

// ─── Test 3 ─────────────────────────────────────────────────────
describe('3 · weekly direct clusters, v1 vs v2: identical for every muscle except side delt (+1)', () => {
  it('per muscle', () => {
    const cat = Object.entries(OWNER_CATALOG).map(([id, c]) => ({ id, muscles: c.muscles }));
    const before = Object.fromEntries(plannedVolume(OWNER_TEMPLATES, cat).map((m) => [m.muscle, m.direct]));
    const after = Object.fromEntries(plannedVolume(built.map((b) => b.body), cat).map((m) => [m.muscle, m.direct]));
    const diff = Object.fromEntries(Object.keys(before).map((m) => [m, after[m] - before[m]]).filter(([, d]) => d !== 0));
    expect(diff).toEqual({ sideDelt: 1 });
  });
});

// ─── Test 4 ─────────────────────────────────────────────────────
describe('4 · lateral raise: the drop set only on cluster 2; progression reads only cluster 1 against its history', () => {
  const row = v2('Push Day').body.exercises.find((r) => r.name === 'DB Lateral Raise')!;

  it('the plan: two clusters, the drop after the LAST cluster and numbered as it, the change marked', () => {
    // Cluster 2 is a copy of cluster 1 (activation + the same minis).
    const shape = (g: number) => row.plannedSets.filter((p) => p.group === g && p.kind !== 'drop').map((p) => p.kind).join(',');
    expect(shape(2)).toBe(shape(1));
    const drops = row.plannedSets.filter((p) => p.kind === 'drop');
    expect(drops).toHaveLength(1);
    expect(drops[0].group).toBe(2);
    expect(row.plannedSets.at(-1)?.kind).toBe('drop');
    expect(row.plannedSets.filter((p) => p.kind === 'activation').map((p) => p.group)).toEqual([1, 2]);
    expect(row.clusterCountChange).toEqual({ from: 1, to: 2, since: '' });
  });

  it('the switch dates the change; the lateral gets no context baseline (its history stays readable)', () => {
    const p = planActivation({ draftOf: v2('Push Day').draftOf, template: v2('Push Day').body, program: 'v2', reason: PROGRAM_V2_REASON }, { live: OWNER_TEMPLATES, catalog, sessions: [], now: NOW });
    const lat = p.body.exercises.find((r) => r.name === 'DB Lateral Raise')!;
    expect(lat.clusterCountChange).toEqual({ from: 1, to: 2, since: '2026-10-12' });
    expect(lat.baseline).toBeUndefined();
  });

  it('a weak second cluster and the drop reps change nothing: the call equals the one read from cluster 1 alone', () => {
    const lat = { ...row, clusterCountChange: { from: 1, to: 2, since: '2026-10-12' } };
    const before = [
      session('2026-10-02', 'push', [sx('DB Lateral Raise', [...cluster(1, 15, 14), { kind: 'drop', weight: 10, reps: 9 }])]),
      session('2026-10-09', 'push', [sx('DB Lateral Raise', [...cluster(1, 15, 15), { kind: 'drop', weight: 10, reps: 8 }])]),
    ];
    const withC2 = [session('2026-10-13', 'push', [sx('DB Lateral Raise', [...cluster(1, 15, 16), ...cluster(2, 15, 9, 3, 2), { kind: 'drop', weight: 10, reps: 6 }])]), ...before];
    const c1Only = [session('2026-10-13', 'push', [sx('DB Lateral Raise', cluster(1, 15, 16))]), ...before];
    const a = sessionCall(lat, withC2, catalog(idOf('DB Lateral Raise')));
    const b = sessionCall(lat, c1Only, catalog(idOf('DB Lateral Raise')));
    expect(a.rec).toEqual(b.rec);
    expect(readableHistory(withC2.map((s) => s.exercises[0]), lat)[0].sets.every((x) => x.group === 1 && x.kind !== 'drop')).toBe(true);
  });
});

// ─── Test 5 ─────────────────────────────────────────────────────
describe('5 · calves: L and R are separate progression tracks, and one cluster in the volume report', () => {
  const row = v2('Push Day').body.exercises.find((r) => r.name === 'Single-leg DB calf raise')!;
  const cat = catalog(row.exerciseId);
  const calf = (day: string, l: number, r: number) =>
    session(day, 'push', [sx(row.name, [...cluster(1, 25, l, 5, 4, 'L'), ...cluster(2, 25, r, 3, 2, 'R')])]);
  const history = [calf('2026-10-13', 22, 9), calf('2026-10-06', 21, 10), calf('2026-09-29', 20, 9)];

  it('the plan names both sides', () => {
    expect(sidesOf(row)).toEqual(['L', 'R']);
  });

  it('each side is called from its own history — exactly as if it were its own lift', () => {
    const call = sessionCall(row, history, cat);
    const opts = recommendOptionsFor(row, cat);
    const own = (label: 'L' | 'R') => recommend(history.map((s) => {
      const e = s.exercises[0];
      const g = label === 'L' ? 1 : 2;
      return { ...e, sets: e.sets.filter((x) => x.group === g).map((x) => ({ ...x, group: 1 })) };
    }), opts);
    expect(call.sides?.L?.rec).toEqual(own('L'));
    expect(call.sides?.R?.rec).toEqual(own('R'));
    expect(call.sides?.L?.rec.action).not.toBe(call.sides?.R?.rec.action);
  });

  it('applying the calls moves each side\'s own load and logs it by side', () => {
    const call = sessionCall(row, history, cat);
    const recs = new Map([[sideRecKey(row.exerciseId, 'L'), call.sides!.L!.rec], [sideRecKey(row.exerciseId, 'R'), call.sides!.R!.rec]]);
    const { proposed, applied } = finishProgression({ rows: [row], recs, autoApply: true, at: NOW, reasonFor: () => 'test' });
    const moved = proposed.map((p) => p.side);
    expect(moved.length).toBeGreaterThan(0);
    for (const p of proposed) expect(applied![0].sideLoads?.[p.side!]).toBe(p.to);
    expect(applied![0].loadLog?.slice(-proposed.length).map((c) => c.side)).toEqual(moved);
    expect(applied![0].targetLoad).toBe(row.targetLoad);
  });

  it('an L cluster and an R cluster are ONE calf cluster for volume', () => {
    expect(clusterCount(history[0].exercises[0].sets)).toBe(1);
    expect(clusterCount(row.plannedSets, false)).toBe(1);
  });
});

// ─── Test 6 ─────────────────────────────────────────────────────
describe('6 · the superset timer holds A1 to 90 s between its own clusters', () => {
  it('A2 plus the transition took 50 s: the 30 s round rest grows to 40 s', () => {
    expect(roundRestWithFloor(30, 90, 30 + 20)).toBe(40);
  });
  it('A2 took a normal cluster (estimated): 130 s already passed, no delay', () => {
    expect(roundRestWithFloor(30, 90, 30 + CLUSTER_ESTIMATE_SEC)).toBe(30);
  });
  it('no minimum on the row: the round rest as set', () => {
    expect(roundRestWithFloor(30, undefined, 5)).toBe(30);
  });
});

// ─── Test 7 ─────────────────────────────────────────────────────
describe('7 · the guardrail fires only after 2 CONSECUTIVE superset sessions ≥ 2 reps down at the same load', () => {
  const flat = (day: string, reps: number, paired: boolean) => session(day, 'push', [
    sx('DB Flat Press', cluster(1, 25, reps), paired ? { supersetGroup: 'A', pairPosition: 1 } : {}),
  ]);
  const straight = [flat('2026-09-20', 12, false), flat('2026-09-27', 12, false), flat('2026-10-04', 12, false)];
  const id = idOf('DB Flat Press');

  it('down, fine, down → no flag (the run was broken)', () => {
    const r = exerciseSupersetReport([...straight, flat('2026-10-13', 9, true), flat('2026-10-16', 12, true), flat('2026-10-20', 9, true)], id)!;
    expect(r.flag).toBe(false);
  });
  it('down, down → flag', () => {
    const r = exerciseSupersetReport([...straight, flat('2026-10-16', 10, true), flat('2026-10-20', 9, true)], id)!;
    expect(r.flag).toBe(true);
  });
  it('one down → no flag', () => {
    expect(exerciseSupersetReport([...straight, flat('2026-10-20', 9, true)], id)!.flag).toBe(false);
  });
  it('down by 1 twice → no flag', () => {
    expect(exerciseSupersetReport([...straight, flat('2026-10-16', 11, true), flat('2026-10-20', 11, true)], id)!.flag).toBe(false);
  });
});

// ─── Test 8 ─────────────────────────────────────────────────────
describe('8 · Zone 2: HR band and RPE', () => {
  const z2 = { label: 'Zone 2', targetHrMin: 120, targetHrMax: 130 };
  it('avgHR 135 → outside the band; 125 → in band; 119 → outside', () => {
    expect(zone2Check({ ...z2, avgHr: 135 }).inBand).toBe(false);
    expect(zone2Check({ ...z2, avgHr: 125 }).inBand).toBe(true);
    expect(zone2Check({ ...z2, avgHr: 119 }).inBand).toBe(false);
  });
  it('a block labelled Zone 2 with no prescription is held to 120–130', () => {
    expect(zone2Check({ label: 'Zone 2', avgHr: 135 }).inBand).toBe(false);
  });
  it('RPE blank stays blank and is not flagged; RPE 8 → too high; 6 → fine', () => {
    expect(zone2Check({ ...z2 })).toEqual({ rpeTooHigh: false });
    expect(zone2Check({ ...z2, rpe: 8 }).rpeTooHigh).toBe(true);
    expect(zone2Check({ ...z2, rpe: 6 }).rpeTooHigh).toBe(false);
  });
});

// ─── Test 9 ─────────────────────────────────────────────────────
describe('9 · sleep: the 7-day average', () => {
  it('6.5 h → flagged', () => {
    const days = { '2026-10-06': 6.5, '2026-10-07': 6.5, '2026-10-08': 6.5, '2026-10-09': 6.5, '2026-10-10': 6.5, '2026-10-11': 6.5, '2026-10-12': 6.5 };
    expect(sleepWeekAverage(days, '2026-10-12')).toEqual({ average: 6.5, nights: 7, flag: true });
  });
  it('a missing night stays blank and is left out of the average (never a zero, never yesterday\'s)', () => {
    const days = { '2026-10-06': 8, '2026-10-07': 7, '2026-10-09': 7.5, '2026-10-12': 7.5 };
    expect(sleepWeekAverage(days, '2026-10-12')).toEqual({ average: 7.5, nights: 4, flag: false });
  });
  it('a night 8 days back is outside the window', () => {
    expect(sleepWeekAverage({ '2026-10-04': 4 }, '2026-10-12')).toEqual({ nights: 0, flag: false });
  });
});

// ─── Duration (section 4) ───────────────────────────────────────
describe('session duration estimate, v1 vs v2', () => {
  const est = (t: Pick<WorkoutTemplate, 'exercises' | 'restMiniSec' | 'restClusterSec' | 'cardioBlocks'>) => estimateTemplateDuration(t, musclesOf).minutes;
  // Computed, not forced to the spec's guess. Push takes on the crunch and
  // the calf raise from Leg plus the second lateral cluster (+5 clusters),
  // which the supersets' shorter rests do not fully pay for; Leg loses those
  // four clusters; the week is shorter overall.
  it('Push +4 (it gains 5 clusters), Pull +1, Leg −11, week −6 min', () => {
    const pair = (name: string) => [est(v1(name)), est(v2(name).body)];
    expect([pair('Push Day'), pair('Pull Day'), pair('Leg Day')]).toEqual([[45, 49], [42, 43], [47, 36]]);
    const week = (i: 0 | 1) => [pair('Push Day'), pair('Pull Day'), pair('Leg Day')].reduce((t, p) => t + p[i], 0);
    expect(week(1) - week(0)).toBe(-6);
  });
});
