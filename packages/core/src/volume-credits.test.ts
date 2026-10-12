/**
 * `volume-credits.ts` — the credit rule (S23-12: tags win) and the two weekly
 * counts the volume sheet switches between (S23-13: hard sets | clusters).
 * ADR-0046.
 */
import { describe, expect, it } from 'vitest';
import {
  creditsFor,
  defaultVolumeView,
  hardSetCount,
  hardSetsBetween,
  plannedHardSets,
  plannedVolume,
  primaryMuscleOf,
  volumeBetween,
  weeklyHardSets,
  weeklyVolume,
  type VolumeCredit,
} from './volume-credits';
import type { MuscleGroup, WorkoutSession, WorkoutSet } from './workout';

const asMap = (cs: VolumeCredit[]) => Object.fromEntries(cs.map((c) => [c.muscle, c.weight]));

// ─── S23-12 · tags win ──────────────────────────────────────────

describe('creditsFor — untagged lifts keep the name table', () => {
  it.each<[string, Record<string, number>]>([
    ['Bench Press', { chest: 1, triceps: 0.5, frontDelt: 0.5 }],
    ['DB Lateral Raise', { sideDelt: 1 }],
    ['Rear delt DB flye', { rearDelt: 1 }],
    ['Romanian deadlift', { hamstrings: 1, glutes: 0.5 }],
    ['Seated Machine Row', { back: 1, rearDelt: 0.5, biceps: 0.5 }],
    ['Landmine press', { chest: 1, triceps: 0.5, frontDelt: 0.5 }],
  ])('%s', (name, expected) => {
    expect(asMap(creditsFor(name))).toEqual(expected);
    expect(asMap(creditsFor(name, []))).toEqual(expected);
  });

  it('nothing in the table and no tags → no credit (reported as unattributed)', () => {
    expect(creditsFor('Mystery Move')).toEqual([]);
  });
});

describe('creditsFor — tagged lifts count ONLY the tagged muscles (S23-12)', () => {
  // [name, tags, expected credits] — the table is the spec; ADR-0046.
  const cases: [string, MuscleGroup[], Record<string, number>][] = [
    // The bug that made the owner rule: a press tagged Shoulders credited chest.
    ['Landmine press', ['shoulders'], { frontDelt: 1 }],
    ['Landmine press', ['shoulders', 'triceps'], { frontDelt: 1, triceps: 0.5 }],
    // The table refines a Shoulders tag to the head it names…
    ['DB Lateral Raise', ['shoulders'], { sideDelt: 1 }],
    ['Rear delt DB flye', ['shoulders'], { rearDelt: 1 }],
    ['Face pull', ['shoulders'], { rearDelt: 1 }],
    // …and keeps its second head in the PRIMARY region only.
    ['Seated DB Shoulder Press', ['shoulders', 'triceps'], { frontDelt: 1, sideDelt: 0.5, triceps: 0.5 }],
    // A secondary Shoulders tag is ½ in total: its lead head only.
    ['Overhead press', ['triceps', 'shoulders'], { triceps: 1, frontDelt: 0.5 }],
    // A tag the table does not name still counts (½ when not first).
    ['Rear delt DB flye', ['shoulders', 'back'], { rearDelt: 1, back: 0.5 }],
    // Table muscles nobody tagged are dropped.
    ['DB Flat Press', ['chest', 'triceps'], { chest: 1, triceps: 0.5 }],
    ['Incline Dumbbell Press', ['chest', 'shoulders'], { chest: 1, frontDelt: 0.5 }],
    ['Bench Press', ['chest'], { chest: 1 }],
    ['Seated Machine Row', ['back', 'biceps'], { back: 1, biceps: 0.5 }],
    ['Romanian deadlift', ['hamstrings'], { hamstrings: 1 }],
    // The FIRST tag is the primary the chips call "Primary" — even against the table.
    ['Bench Press', ['triceps', 'chest'], { triceps: 1, chest: 0.5 }],
    ['Face pull', ['back', 'shoulders'], { back: 1, rearDelt: 0.5 }],
    ['Romanian deadlift', ['glutes', 'hamstrings'], { glutes: 1, hamstrings: 0.5 }],
    // Core ↔ abs: the table agrees only when it names abs.
    ['Hanging Knee Raise', ['core'], { abs: 1 }],
    ['Weighted crunch', ['chest'], { chest: 1 }],
    // No table hit: the tags, first 1, the rest ½ (FROM_GROUP, as before).
    ['Hip thrust', ['glutes', 'hamstrings'], { glutes: 1, hamstrings: 0.5 }],
    ['Mystery Move', ['shoulders'], { frontDelt: 1 }],
    // Forearms has no volume muscle: it credits nothing, and the table cannot fill in.
    ['DB hammer curl', ['biceps', 'forearms'], { biceps: 1 }],
    ['Wrist curl', ['forearms'], {}],
    ['DB hammer curl', ['forearms', 'biceps'], { biceps: 1 }],
    // Duplicate tags count once.
    ['Bench Press', ['chest', 'chest', 'triceps'], { chest: 1, triceps: 0.5 }],
  ];
  it.each(cases)('%s tagged %j', (name, tags, expected) => {
    const out = creditsFor(name, tags);
    expect(asMap(out)).toEqual(expected);
    // Never two primaries.
    expect(out.filter((c) => c.weight === 1).length).toBeLessThanOrEqual(1);
  });

  it('Landmine press tagged Shoulders never credits chest', () => {
    expect(creditsFor('Landmine press', ['shoulders']).map((c) => c.muscle)).not.toContain('chest');
  });

  it('the result only holds muscles that map from a tag', () => {
    const region: Record<string, MuscleGroup> = {
      chest: 'chest', back: 'back', biceps: 'biceps', triceps: 'triceps', quads: 'quads', hamstrings: 'hamstrings',
      glutes: 'glutes', calves: 'calves', abs: 'core', frontDelt: 'shoulders', sideDelt: 'shoulders', rearDelt: 'shoulders',
    };
    const names = ['Bench Press', 'Seated Machine Row', 'Smith squat', 'Overhead press', 'Romanian deadlift', 'Leg Curls', 'Cable crunch'];
    const tagSets: MuscleGroup[][] = [['chest'], ['back'], ['shoulders', 'triceps'], ['quads', 'glutes'], ['core'], ['calves', 'forearms']];
    for (const n of names) for (const tags of tagSets) {
      for (const c of creditsFor(n, tags)) expect(tags).toContain(region[c.muscle]);
    }
  });
});

describe('primaryMuscleOf — the Program v2 rest rule\'s "same muscle"', () => {
  it('is the first tag, refined by the table where it agrees', () => {
    expect(primaryMuscleOf('DB Lateral Raise', ['shoulders'])).toBe('sideDelt');
    expect(primaryMuscleOf('Rear delt DB flye', ['shoulders', 'back'])).toBe('rearDelt');
    expect(primaryMuscleOf('Seated DB Shoulder Press', ['shoulders', 'triceps'])).toBe('frontDelt');
    expect(primaryMuscleOf('Landmine press', ['shoulders'])).toBe('frontDelt');
  });
  it('a lateral raise and a shoulder press are DIFFERENT muscles (switch rest), two rows are the same', () => {
    expect(primaryMuscleOf('DB Lateral Raise', ['shoulders'])).not.toBe(primaryMuscleOf('Seated DB Shoulder Press', ['shoulders', 'triceps']));
    expect(primaryMuscleOf('Neutral-grip pull-up', ['back', 'biceps'])).toBe(primaryMuscleOf('Wide-grip lat pulldown', ['back', 'biceps']));
  });
  it('untagged → the table; nothing → undefined', () => {
    expect(primaryMuscleOf('Leg Curls')).toBe('hamstrings');
    expect(primaryMuscleOf('Mystery Move')).toBeUndefined();
    expect(primaryMuscleOf('Wrist curl', ['forearms'])).toBeUndefined();
  });
});

// ─── S23-13 · hard sets ─────────────────────────────────────────

const NOW = new Date('2026-10-12T20:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const session = (daysAgo: number, exercises: WorkoutSession['exercises'], status: WorkoutSession['status'] = 'completed', id?: string): WorkoutSession => ({
  ...(id ? { id } : {}),
  status, date: new Date(NOW - daysAgo * DAY), createdAt: new Date(NOW), updatedAt: new Date(NOW), exercises,
});
const ex = (exerciseId: string, name: string, sets: WorkoutSet[], logStyle?: 'time'): WorkoutSession['exercises'][number] =>
  ({ exerciseId, name, cues: [], sets, ...(logStyle ? { logStyle } : {}) });
const working = (n: number, extra: Partial<WorkoutSet> = {}): WorkoutSet[] =>
  Array.from({ length: n }, () => ({ kind: 'working' as const, weight: 100, reps: 8, ...extra }));
const cluster = (g: number): WorkoutSet[] => [
  { kind: 'activation', group: g, weight: 20, reps: 12 },
  { kind: 'mini', group: g, weight: 20, reps: 4 },
  { kind: 'mini', group: g, weight: 20, reps: 3 },
];

describe('hardSetCount — what counts as one hard set', () => {
  it('a performed working set counts; warm-ups, drops, mobility and unperformed sets do not', () => {
    expect(hardSetCount([
      { kind: 'warmup', weight: 45, reps: 10 },
      ...working(3),
      { kind: 'drop', weight: 70, reps: 6 },
      { kind: 'mobility', reps: 10 },
      { kind: 'working', weight: 100, targetReps: 8 }, // planned, never ticked
    ])).toBe(3);
  });
  it('myo-rep clusters are NOT sets — not the activation, not the minis (they belong to the Clusters view)', () => {
    expect(hardSetCount([...cluster(1), ...cluster(2)])).toBe(0);
    expect(hardSetCount([...working(2), ...cluster(1)])).toBe(2);
    expect(hardSetCount([{ kind: 'activation', group: 1, reps: 8 }, { kind: 'continuation', group: 1, reps: 3 }])).toBe(0);
  });
  it('a timed lift counts by its logged duration', () => {
    expect(hardSetCount([{ kind: 'working', durationSec: 45 }, { kind: 'working', targetDurationSec: 45 }], 'time')).toBe(1);
  });
  it('a single-leg lift: an L set and an R set are ONE set for the muscle (the cluster rule)', () => {
    expect(hardSetCount([...working(3, { label: 'L' }), ...working(3, { label: 'R' })])).toBe(3);
    expect(hardSetCount([...working(3, { label: 'L' }), ...working(2, { label: 'R' })])).toBe(3);
  });
  it('a template counts every planned working set (performedOnly off)', () => {
    expect(hardSetCount([{ kind: 'warmup' }, { kind: 'working' }, { kind: 'working' }], undefined, false)).toBe(2);
  });
});

describe('weeklyHardSets — same window and credit weights as weeklyVolume', () => {
  const catalog = [
    { id: 'bench', muscles: ['chest', 'triceps'] as MuscleGroup[] },
    { id: 'lat', muscles: ['shoulders'] as MuscleGroup[] },
  ];
  const sessions = [
    session(1, [ex('bench', 'Bench Press', [{ kind: 'warmup', weight: 45, reps: 10 }, ...working(4)])], 'completed', 's1'),
    session(2, [ex('lat', 'DB Lateral Raise', [...working(2), ...cluster(1)])], 'completed', 's2'),
    session(3, [ex('bench', 'Bench Press', working(9))], 'active'), // not finished
    session(9, [ex('bench', 'Bench Press', working(9))]), // outside the window
  ];

  it('credits 1.0 to the primary and 0.5 to each secondary, per hard set', () => {
    const r = weeklyHardSets(sessions, catalog, NOW);
    const row = (m: string) => r.week.find((x) => x.muscle === m)!;
    expect(row('chest')).toMatchObject({ direct: 4, fractional: 4 });
    expect(row('triceps')).toMatchObject({ direct: 0, fractional: 2 });
    expect(row('sideDelt')).toMatchObject({ direct: 2, fractional: 2 });
    expect(row('quads')).toMatchObject({ direct: 0, fractional: 0 });
    expect(r.total).toBe(6);
  });

  it('never mixes in the clusters: the same week reads 1 side-delt cluster in the other view', () => {
    const v = weeklyVolume(sessions, catalog, NOW);
    expect(v.week.find((x) => x.muscle === 'sideDelt')).toMatchObject({ direct: 1, fractional: 1 });
    expect(v.total).toBe(1);
  });

  it('flags a muscle past the per-session plateau, per session', () => {
    const r = weeklyHardSets([session(1, [ex('bench', 'Bench Press', working(12))], 'completed', 'big')], catalog, NOW);
    expect(r.perSession[0]).toMatchObject({ sessionId: 'big', overPlateau: ['chest'] });
  });

  it('a lift with nothing to credit is unattributed', () => {
    const r = weeklyHardSets([session(1, [ex('x', 'Mystery Move', working(3))])], [], NOW);
    expect(r.unattributed).toEqual(['Mystery Move']);
    expect(r.total).toBe(3);
  });

  it('hardSetsBetween honours the same [from, to] window as volumeBetween', () => {
    const from = NOW - 2.5 * DAY;
    expect(hardSetsBetween(sessions, catalog, from, NOW).total).toBe(6);
    expect(hardSetsBetween(sessions, catalog, NOW - 1.5 * DAY, NOW).total).toBe(4);
    expect(volumeBetween(sessions, catalog, NOW - 1.5 * DAY, NOW).total).toBe(0);
  });
});

describe('plannedHardSets — the templates, once a week', () => {
  it('counts planned working sets, not warm-ups or clusters', () => {
    const tpl = {
      exercises: [
        { exerciseId: 'bench', name: 'Bench Press', plannedSets: [{ kind: 'warmup' as const }, { kind: 'working' as const }, { kind: 'working' as const }, { kind: 'working' as const }] },
        { exerciseId: 'lat', name: 'DB Lateral Raise', plannedSets: [{ kind: 'activation' as const, group: 1 }, { kind: 'mini' as const, group: 1 }] },
      ],
    } as unknown as Parameters<typeof plannedHardSets>[0][number];
    const rows = Object.fromEntries(plannedHardSets([tpl], [{ id: 'bench', muscles: ['chest'] }]).map((m) => [m.muscle, m.fractional]));
    expect(rows.chest).toBe(3);
    expect(rows.sideDelt).toBe(0);
    const clusters = Object.fromEntries(plannedVolume([tpl], []).map((m) => [m.muscle, m.fractional]));
    expect(clusters.sideDelt).toBe(1);
    expect(clusters.chest).toBe(0);
  });
});

describe('defaultVolumeView — auto default for the Sets | Clusters switch', () => {
  it('Clusters when the window has performed clusters, else Sets', () => {
    expect(defaultVolumeView({ clusters: 2, sets: 10, plannedClusters: 0, plannedSets: 0 })).toBe('clusters');
    expect(defaultVolumeView({ clusters: 0, sets: 10, plannedClusters: 8, plannedSets: 0 })).toBe('sets');
  });
  it('nothing logged at all: the plan decides — clusters only when it plans clusters and no sets', () => {
    expect(defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 6, plannedSets: 0 })).toBe('clusters');
    expect(defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 6, plannedSets: 4 })).toBe('sets');
    expect(defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 0, plannedSets: 0 })).toBe('sets');
  });
});
