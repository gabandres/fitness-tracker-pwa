import { describe, expect, it } from 'vitest';
import {
  REP_FLAG_AT,
  recommend,
  resolveEngineConfig,
  rirBelowTarget,
  targetRirOf,
  type EngineCatalogFields,
} from './progression-engine';
import { clusterViewUnits, defaultVolumeView, plannedVolume, volumeBetween } from './volume-credits';
import { buildCsv } from './csv-export';
import type { PlannedSet, SessionExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';

/**
 * Program v2.2 (owner, 2026-10-22): `rir2`, the RDL's straight sets judged at
 * their target RIR, the ≥ 15 load flag, the RIR-compliance warning, straight
 * sets in a cluster program's volume, and the export's `rirTarget`.
 */

// ─── helpers ────────────────────────────────────────────────────

const working = (load: number, ...sets: [reps: number, rir?: number][]): SessionExercise => ({
  exerciseId: 'rdl', name: 'DB Romanian deadlift', cues: [],
  sets: sets.map(([reps, rir]) => ({ kind: 'working', weight: load, reps, ...(rir != null ? { rir } : {}) }) as WorkoutSet),
});

type Cl = [act: number, rir: number];
const clusters = (name: string, load: number, ...cs: Cl[]): SessionExercise => ({
  exerciseId: name, name, cues: [], logStyle: 'weight-reps',
  sets: cs.flatMap(([act, rir], i): WorkoutSet[] => [
    { kind: 'activation', group: i + 1, weight: load, reps: act, rir },
    { kind: 'mini', group: i + 1, weight: load, reps: 4, rir: 0 },
    { kind: 'mini', group: i + 1, weight: load, reps: 3, rir: 0 },
  ]),
});

const RDL_RULE = { targetReps: 12, holdSessions: 1, incrementLb: 5 };
/** The RDL as the app resolves it, on the 2.5-lb dumbbell grid. */
const rdlOpts = () => ({
  structure: 'straight' as const,
  progression: RDL_RULE,
  config: { ...resolveEngineConfig({ name: 'DB Romanian deadlift', effortStandard: 'rir2' }), loadGrid: 2.5 },
});
const myo = (name: string, catalog: EngineCatalogFields = {}, incrementLb = 5) => ({
  expectsCluster: true,
  structure: 'myoreps' as const,
  config: resolveEngineConfig({ name, ...catalog }, { name, progression: { incrementLb } }),
  progression: { incrementLb },
});

// ─── effort ─────────────────────────────────────────────────────

describe('rir2', () => {
  it('targets 2 reps in reserve; an unknown standard reads as failure', () => {
    expect(targetRirOf('rir2')).toBe(2);
    expect(targetRirOf('rir1')).toBe(1);
    expect(targetRirOf('failure')).toBe(0);
    expect(targetRirOf(undefined)).toBe(0);
  });

  it('flags the lowest RIR logged under the target, never under failure', () => {
    expect(rirBelowTarget([2, 1, 0], 'rir2')).toEqual({ logged: 0, target: 2 });
    expect(rirBelowTarget([2, 3], 'rir2')).toBeNull();
    expect(rirBelowTarget([0], 'rir1')).toEqual({ logged: 0, target: 1 });
    expect(rirBelowTarget([0, 0], 'failure')).toBeNull();
    expect(rirBelowTarget([undefined], 'rir1')).toBeNull();
  });
});

// ─── the RDL: straight sets, judged at RIR 2 ────────────────────

describe('the DB Romanian deadlift — 2 × 8-12 @ RIR 2, straight', () => {
  it('both sets 12 @ RIR 2 → the smallest step up (35 → 37.5 on the dumbbell grid)', () => {
    const rec = recommend([working(35, [12, 2], [12, 2])], rdlOpts());
    expect(rec).toMatchObject({ action: 'add-load', load: 37.5, currentLoad: 35 });
    expect(rec.warnings).toEqual([]);
  });

  it('one set short of 12 holds the load — both sets must earn it', () => {
    const rec = recommend([working(35, [12, 2], [11, 2])], rdlOpts());
    expect(rec.action).toBe('build-reps');
    expect(rec.load).toBe(35);
  });

  it('12 @ RIR 1 was taken closer to failure than allowed: not earned, and warned', () => {
    const rec = recommend([working(35, [12, 2], [12, 1])], rdlOpts());
    expect(rec.action).toBe('build-reps');
    expect(rec.warnings).toEqual(['below-target-rir']);
    expect(rec.rirBelowTarget).toEqual({ logged: 1, target: 2 });
  });

  it('12 @ RIR 3 (easier than the target) earns it', () => {
    expect(recommend([working(35, [12, 3], [12, 2])], rdlOpts()).action).toBe('add-load');
  });

  it('a failure-standard straight lift keeps the plain rep count — nothing changes for it', () => {
    const plain = recommend([working(135, [8, 3], [8, 3])], { structure: 'straight', progression: { targetReps: 10, holdSessions: 1, incrementLb: 5 } });
    expect(plain.action).toBe('build-reps');
    expect(plain.warnings).toEqual([]);
  });

  it('the ≥ 15 flag never runs on a straight lift: 15 @ RIR 2 is simply over 12', () => {
    const rec = recommend([working(35, [15, 2], [15, 2])], rdlOpts());
    expect(rec.reason.kind).toBe('straight-sets');
  });
});

// ─── the ≥ 15 load flag ─────────────────────────────────────────

describe(`≥ ${REP_FLAG_AT} reps at the target effort → the load goes up`, () => {
  it('lateral raise 15 × 15 @ RIR 0 on 5-lb dumbbells: Epley would build reps; the flag takes the step to 20', () => {
    const rec = recommend([clusters('DB Lateral Raise', 15, [15, 0])], myo('DB Lateral Raise', { dumbbellStepLb: 5 }));
    expect(rec).toMatchObject({ action: 'add-load', load: 20 });
    expect(rec.reason).toMatchObject({ kind: 'rep-flag', reps: 15, at: 15, nextLoad: 20 });
  });

  it('14 is not 15: the same lift builds reps, as before', () => {
    const rec = recommend([clusters('DB Lateral Raise', 15, [14, 0])], myo('DB Lateral Raise', { dumbbellStepLb: 5 }));
    expect(rec).toMatchObject({ action: 'hold', load: 15, reason: { kind: 'below-max', reps: 14, max: 15 } });
  });

  it('a normal increase keeps its own reason — the flag only overrides a call that kept the load', () => {
    const rec = recommend([clusters('DB Lateral Raise', 15, [15, 0])], myo('DB Lateral Raise'));
    expect(rec).toMatchObject({ action: 'add-load', load: 17.5, reason: { kind: 'increase' } });
  });

  it('is judged AT THE TARGET RIR: on a rir1 lift 15 @ RIR 1 flags, 14 @ RIR 1 does not', () => {
    const row = myo('Seated Machine Row', { effortStandard: 'rir1', availableLoads: [100, 110, 140] });
    const at = recommend([clusters('Seated Machine Row', 110, [15, 1])], row);
    expect(at).toMatchObject({ action: 'add-load', load: 140, reason: { kind: 'rep-flag', reps: 15 } });
    const under = recommend([clusters('Seated Machine Row', 110, [14, 1])], row);
    expect(under).toMatchObject({ action: 'build-reps', reason: { kind: 'step-too-big' } });
  });

  it('a split cluster is bound by its LOWER activation: 15 and 14 is not a flag', () => {
    const rec = recommend([clusters('Smith squat', 35, [16, 1], [14, 1])], myo('Smith squat', { effortStandard: 'rir1' }));
    expect(rec.reason.kind).not.toBe('rep-flag');
  });

  it('warns a rir1 lift logged at RIR 0 with both numbers', () => {
    const rec = recommend([clusters('Seated Machine Row', 110, [11, 0])], myo('Seated Machine Row', { effortStandard: 'rir1' }, 10));
    expect(rec.warnings).toContain('below-target-rir');
    expect(rec.rirBelowTarget).toEqual({ logged: 0, target: 1 });
  });
});

// ─── volume ─────────────────────────────────────────────────────

const act = (g: number): PlannedSet => ({ kind: 'activation', group: g });
const mini = (g: number): PlannedSet => ({ kind: 'mini', group: g });
const wk = (): PlannedSet => ({ kind: 'working', reps: 8, repsMax: 12 });

describe('straight sets in a cluster program count 1 : 1 (Program v2.2)', () => {
  it('a straight lift beside clusters counts its working sets; alone it counts none', () => {
    const rdl = [wk(), wk()];
    const curl = [act(1), mini(1), act(2), mini(2)];
    expect(clusterViewUnits(rdl, [rdl, curl], false)).toBe(2);
    expect(clusterViewUnits(rdl, [rdl], false)).toBe(0);
    expect(clusterViewUnits(curl, [rdl, curl], false)).toBe(2);
  });

  it('a logged mixed session puts the RDL into hamstrings (1.0) and glutes (0.5)', () => {
    const session: WorkoutSession = {
      id: 's', status: 'completed', date: new Date('2026-10-23T12:00:00Z'), exercises: [
        { ...working(35, [10, 2], [9, 2]), exerciseId: 'rdl' },
        { ...clusters('Leg Curls', 100, [12, 0], [10, 0]), exerciseId: 'curl' },
      ],
    } as WorkoutSession;
    const rep = volumeBetween([session], [{ id: 'rdl', muscles: ['hamstrings', 'glutes'] }, { id: 'curl', muscles: ['hamstrings'] }], 0, Infinity);
    const h = rep.week.find((m) => m.muscle === 'hamstrings')!;
    const g = rep.week.find((m) => m.muscle === 'glutes')!;
    expect(h).toMatchObject({ direct: 4, fractional: 4 });
    expect(g).toMatchObject({ direct: 0, fractional: 1 });
  });

  it('a straight-only program is untouched: no clusters, and its Sets face stays the default', () => {
    const tpl = { exercises: [{ exerciseId: 'b', name: 'Barbell Bench Press', plannedSets: [wk(), wk(), wk()] }] };
    expect(plannedVolume([tpl], []).every((m) => m.direct === 0 && m.fractional === 0)).toBe(true);
    expect(defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 0, plannedSets: 3 })).toBe('sets');
  });

  it('one RDL in a cluster program no longer flips the empty-window default to Sets', () => {
    expect(defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 26, plannedSets: 2 })).toBe('clusters');
    expect(defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 4, plannedSets: 0 })).toBe('clusters');
  });
});

// ─── export ─────────────────────────────────────────────────────

describe('export: rirTarget, the straight note, templateVersion', () => {
  const header = (csv: string) => csv.split(/\r?\n/)[0].split(',');
  const rowsOf = (csv: string, type: string) => {
    const [head, ...lines] = csv.split(/\r?\n/);
    const cols = head.split(',');
    return lines.filter((l) => l.startsWith(`${type},`)).map((l) => {
      const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
      return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
    });
  };
  const base = { logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {} };

  it('appends rirTarget after every earlier column, so no existing column moves', () => {
    const cols = header(buildCsv(base));
    // Last when it shipped; 2026-10-24's `dayFullyLogged` was appended after it.
    expect(cols.indexOf('rirTarget')).toBe(cols.indexOf('rotationSessions') + 1);
    expect(cols.slice(cols.indexOf('rirTarget') + 1)).toEqual(['dayFullyLogged']);
  });

  it('fills rirTarget on read sets only: activation and working, not minis', () => {
    const session = {
      id: 's', status: 'completed', date: new Date('2026-10-23T12:00:00Z'), templateName: 'Leg Day',
      exercises: [working(35, [10, 2], [9, 2]), { ...clusters('Smith squat', 35, [12, 1]), exerciseId: 'sq' }],
    } as unknown as WorkoutSession;
    const csv = buildCsv({ ...base, workoutSessions: [session], effortStandards: { rdl: 'rir2', sq: 'rir1' } });
    const sets = rowsOf(csv, 'workout_set');
    expect(sets.filter((r) => r.exercise === 'DB Romanian deadlift').map((r) => r.rirTarget)).toEqual(['2', '2']);
    const squat = sets.filter((r) => r.exercise === 'Smith squat');
    expect(squat.find((r) => r.setKind === 'activation')!.rirTarget).toBe('1');
    expect(squat.filter((r) => r.setKind === 'mini').every((r) => r.rirTarget === '')).toBe(true);
  });

  it('a template row says "straight 2 × 8-12" and carries the template\'s own version', () => {
    const tpl: WorkoutTemplate = {
      id: 'leg', name: 'Leg Day', templateVersion: 'v2.2', createdAt: new Date(), updatedAt: new Date(),
      exercises: [{ exerciseId: 'rdl', name: 'DB Romanian deadlift', targetLoad: 35, setStructure: 'straight', plannedSets: [wk(), wk()], restAfterSec: 120 }],
    };
    const [row] = rowsOf(buildCsv({ ...base, templates: [tpl], effortStandards: { rdl: 'rir2' } }), 'template');
    expect(row).toMatchObject({ exercise: 'DB Romanian deadlift', clusters: '', effortStandard: 'rir2', rirTarget: '2', templateVersion: 'v2.2' });
    expect(row.notes).toContain('straight 2 × 8-12');
  });
});
