import { describe, it, expect } from 'vitest';
import { buildCsv } from './csv-export';
import { rotationVolume } from './volume-credits';
import { rotationTemplates } from './rotation-templates';
import type { DailyLog, Measurement } from './types';
import type { MuscleGroup, WorkoutSession } from './workout';

function emptyData() {
  return {
    logs: [] as DailyLog[],
    measurements: [] as Measurement[],
    dailyWeights: {} as Record<string, number>,
    dailyWater: {} as Record<string, number>,
    dailySleep: {} as Record<string, number>,
    workoutSessions: [] as WorkoutSession[],
  };
}

describe('buildCsv', () => {
  it('header includes every dataset column incl. neck + lift/cardio flags', () => {
    const header = buildCsv(emptyData()).split('\r\n')[0];
    for (const col of ['neck', 'liftCompleted', 'cardioCompleted', 'waterFlOz', 'setRir']) {
      expect(header.split(',')).toContain(col);
    }
  });

  it('emits neck on a measurement row', () => {
    const csv = buildCsv({
      ...emptyData(),
      measurements: [{ date: new Date('2026-06-30T12:00:00Z'), waist: 34, neck: 15.5 }],
    });
    const neckIdx = csv.split('\r\n')[0].split(',').indexOf('neck');
    const measRow = csv.split('\r\n').find((r) => r.startsWith('measurement'));
    expect(measRow).toBeDefined();
    expect(measRow!.split(',')[neckIdx]).toBe('15.5');
  });

  it('emits a measured body fat and its method (a DXA-only row is not blank)', () => {
    const csv = buildCsv({
      ...emptyData(),
      measurements: [{ date: new Date('2026-06-30T12:00:00Z'), bodyFatPct: 17.2, bodyFatMethod: 'dxa' }],
    });
    const header = csv.split('\r\n')[0].split(',');
    const measRow = csv.split('\r\n').find((r) => r.startsWith('measurement'))!.split(',');
    expect(measRow[header.indexOf('bodyFatPct')]).toBe('17.2');
    expect(measRow[header.indexOf('bodyFatMethod')]).toBe('dxa');
  });

  it('emits liftCompleted/cardioCompleted on a meal row', () => {
    const log: DailyLog = {
      calories: 500,
      date: new Date('2026-06-30T12:00:00Z'),
      liftCompleted: true,
      cardioCompleted: true,
    };
    const csv = buildCsv({ ...emptyData(), logs: [log] });
    const cols = csv.split('\r\n')[0].split(',');
    const mealRow = csv.split('\r\n').find((r) => r.startsWith('meal'))!.split(',');
    expect(mealRow[cols.indexOf('liftCompleted')]).toBe('true');
    expect(mealRow[cols.indexOf('cardioCompleted')]).toBe('true');
  });

  it('a finished workout\'s 0-kcal marker exports as workout_marker, not as a meal (2026-10-13)', () => {
    const at = new Date('2026-10-13T11:44:11.899Z');
    const csv = buildCsv({
      ...emptyData(),
      logs: [
        { calories: 0, date: at, exerciseCompleted: true },
        { calories: 325, date: new Date('2026-10-13T00:23:15Z'), mealLabel: 'Casein Full', mealType: 'dinner' },
      ] as DailyLog[],
    });
    const cols = csv.split('\r\n')[0].split(',');
    const rows = csv.split('\r\n').slice(1).map((r) => r.split(',')).filter((r) => r[0] === 'meal' || r[0] === 'workout_marker');
    expect(rows.map((r) => [r[0], r[cols.indexOf('calories')], r[cols.indexOf('exerciseCompleted')]])).toEqual([
      ['meal', '325', ''],
      ['workout_marker', '0', 'true'],
    ]);
  });

  it("emits a meal's note in the notes column, and same-minute meals in logged order", () => {
    const at = new Date('2026-10-03T12:15:00Z');
    const logs: DailyLog[] = [
      { id: 'zz', calories: 225, date: at, mealLabel: 'Eggs', note: 'Weighed', createdAt: new Date('2026-10-04T01:00:00Z') },
      { id: 'aa', calories: 65, date: at, mealLabel: 'Fruit', createdAt: new Date('2026-10-04T01:02:00Z') },
    ];
    const csv = buildCsv({ ...emptyData(), logs: [logs[1], logs[0]] });
    const cols = csv.split('\r\n')[0].split(',');
    const meals = csv.split('\r\n').filter((r) => r.startsWith('meal')).map((r) => r.split(','));
    expect(meals.map((m) => m[cols.indexOf('mealLabel')])).toEqual(['Eggs', 'Fruit']);
    expect(meals[0][cols.indexOf('notes')]).toBe('Weighed');
    expect(meals[1][cols.indexOf('notes')]).toBe('');
  });

  it('emits a workout summary row + one workout_set row per logged set', () => {
    const session: WorkoutSession = {
      status: 'completed',
      date: new Date('2026-06-30T12:00:00Z'),
      templateName: 'Push Day',
      bodyweight: 180,
      createdAt: new Date('2026-06-30T12:00:00Z'),
      updatedAt: new Date('2026-06-30T12:00:00Z'),
      exercises: [
        {
          exerciseId: 'x1',
          name: 'Bench',
          cues: [],
          logStyle: 'weight-reps',
          sets: [
            { kind: 'working', weight: 185, reps: 5, rir: 2 },
            { kind: 'working' }, // scaffold, no reps → dropped
          ],
        },
      ],
    };
    const rows = buildCsv({ ...emptyData(), workoutSessions: [session] }).split('\r\n');
    expect(rows.filter((r) => r.startsWith('workout,')).length).toBe(1);
    expect(rows.filter((r) => r.startsWith('workout_set,')).length).toBe(1);
  });

  it('exports a timed hold in its own column, never as reps', () => {
    const session: WorkoutSession = {
      status: 'completed',
      date: new Date('2026-09-15T12:02:21Z'),
      templateName: 'Leg Day',
      createdAt: new Date('2026-09-15T12:02:21Z'),
      updatedAt: new Date('2026-09-15T12:02:21Z'),
      exercises: [
        {
          exerciseId: 'plank',
          name: 'Plank',
          cues: [],
          logStyle: 'time',
          sets: [{ kind: 'working', durationSec: 92, targetDurationSec: 90 }],
        },
      ],
    };
    const rows = buildCsv({ ...emptyData(), workoutSessions: [session] }).split('\r\n');
    const header = rows[0].split(',');
    const set = rows.find((r) => r.startsWith('workout_set,'))!.split(',');
    expect(set).toBeDefined();
    expect(set[header.indexOf('setDurationSec')]).toBe('92');
    expect(set[header.indexOf('setReps')]).toBe('');
  });
});

// ─── Cardio rows (ADR-0025) ─────────────────────────────────────

describe('cardio in the CSV export', () => {
  const day = new Date('2026-08-24T12:00:00');
  const session = (cardio: unknown[], exercises: unknown[] = []) => ({
    logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
    workoutSessions: [{
      status: 'completed', date: day, createdAt: day, updatedAt: day,
      templateName: 'Push Day', exercises, cardio,
    }],
  } as never);

  it('emits one cardio row per logged block, with its own start time', () => {
    const csv = buildCsv(session([
      {
        modality: 'run', durationSec: 1930, distanceM: 8046.7, avgHr: 148,
        kcal: 612, rpe: 7, source: 'health', provider: 'oura',
        sourceId: 'oura-1', startedAt: new Date('2026-08-24T06:15:00'),
        notes: 'legs felt heavy',
      },
    ]));
    const line = csv.split('\r\n').find((l) => l.startsWith('cardio,'));
    expect(line).toBeDefined();
    for (const v of ['run', '1930', '8046.7', '148', '612', '7', 'health', 'oura']) {
      expect(line).toContain(v);
    }
    // The BLOCK's start, not the session's — a run imported at 9pm may have
    // happened at 6am. Compared as an ISO instant rather than the local literal:
    // `toISOString()` renders UTC, so the wall-clock string is not in the row.
    const blockStart = new Date('2026-08-24T06:15:00').toISOString();
    expect(line).toContain(blockStart);
    expect(line).not.toContain(day.toISOString());
    expect(line).toContain('legs felt heavy');
  });

  // The same gate the roll-ups use. A template's prescription that was never
  // performed must not appear in an export as work the user did.
  it('drops an unperformed prescription', () => {
    const csv = buildCsv(session([
      { modality: 'ride', durationSec: 0, targetDurationSec: 1800, source: 'manual' },
    ]));
    expect(csv.split('\r\n').some((l) => l.startsWith('cardio,'))).toBe(false);
  });

  // A run with no lifting is still a session, and the export should say so
  // rather than making it look like a day that never happened.
  it('still emits the workout summary row for a cardio-only session', () => {
    const csv = buildCsv(session([{ modality: 'run', durationSec: 1200, source: 'manual' }]));
    const lines = csv.split('\r\n');
    expect(lines.some((l) => l.startsWith('workout,'))).toBe(true);
    expect(lines.some((l) => l.startsWith('cardio,'))).toBe(true);
    expect(lines.some((l) => l.startsWith('workout_set,'))).toBe(false);
  });

  it('leaves a session with no cardio field untouched', () => {
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
      workoutSessions: [{
        status: 'completed', date: day, createdAt: day, updatedAt: day,
        exercises: [{ exerciseId: 'b', name: 'Bench', cues: [], sets: [{ kind: 'working', weight: 135, reps: 8 }] }],
      }],
    } as never);
    expect(csv.split('\r\n').some((l) => l.startsWith('cardio,'))).toBe(false);
    expect(csv.split('\r\n').some((l) => l.startsWith('workout_set,'))).toBe(true);
  });
  // ── fasting (ADR-0032, #97) ──
  //
  // The sentence in the original request that started ADR-0032 was "we are
  // tracking fasting but we don't know how much each day in the history panel
  // — only in the export". Half of that was wrong, and the wrong half was the
  // important one: the export did not have it either. These cases are that
  // sentence becoming true.
  describe('fasting rows', () => {
    const empty = { logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {} };
    // 8pm Monday -> 12pm Tuesday, local. Crosses midnight, which is the normal
    // case for a fast rather than the edge one.
    const started = new Date(2026, 7, 24, 20, 0, 0, 0);
    const ended = new Date(2026, 7, 25, 12, 0, 0, 0);

    const CRLF = '\r\n';
    const fastRows = (csv: string) =>
      csv.split('\r\n').filter((l) => l.startsWith('fast,'));

    /** Column order is the file's contract, so read cells BY NAME off the real
     *  header rather than by index - an index would silently follow a column
     *  being inserted upstream and assert nothing. */
    const csvHeader = buildCsv(empty as never).split(CRLF)[0].split(',');
    const cell = (line: string, name: string) => line.split(',')[csvHeader.indexOf(name)];

    it('emits nothing when the user has never fasted', () => {
      expect(fastRows(buildCsv({ ...empty, fasts: [] } as never))).toEqual([]);
      expect(fastRows(buildCsv(empty as never))).toEqual([]);
    });

    it('attributes the row to the day the fast ENDED', () => {
      // Not the day it started. A reader who prefers start-day attribution
      // (Zero, BodyFast) can still recover it — the row carries both instants.
      const csv = buildCsv({ ...empty, fasts: [{ startedAt: started, endedAt: ended }] } as never);
      const [line] = fastRows(csv);
      expect(cell(line, 'date')).toBe('2026-08-25');
    });

    it('carries the whole interval, not just the derived hours', () => {
      const csv = buildCsv({ ...empty, fasts: [{ startedAt: started, endedAt: ended }] } as never);
      const [line] = fastRows(csv);
      expect(cell(line, 'timestamp')).toBe(started.toISOString());
      expect(cell(line, 'fastEndedAt')).toBe(ended.toISOString());
      expect(cell(line, 'fastHours')).toBe('16');
    });

    it('rounds the hours to two decimals rather than dumping a raw float', () => {
      const odd = new Date(started.getTime() + 59 * 60 * 1000 + 59 * 1000);
      const csv = buildCsv({ ...empty, fasts: [{ startedAt: started, endedAt: odd }] } as never);
      expect(cell(fastRows(csv)[0], 'fastHours')).toBe('1');
      const odder = new Date(started.getTime() + 100 * 60 * 1000);
      const csv2 = buildCsv({ ...empty, fasts: [{ startedAt: started, endedAt: odder }] } as never);
      expect(cell(fastRows(csv2)[0], 'fastHours')).toBe('1.67');
    });

    it('records provenance — measured by the timer, or asserted by hand', () => {
      const csv = buildCsv({
        ...empty,
        fasts: [
          { startedAt: started, endedAt: ended, source: 'timer' },
          { startedAt: new Date(2026, 7, 26, 8), endedAt: new Date(2026, 7, 26, 20), source: 'manual' },
        ],
      } as never);
      const rows = fastRows(csv);
      expect(cell(rows[0], 'notes')).toBe('timer');
      expect(cell(rows[1], 'notes')).toBe('manual');
    });

    it('sorts by end instant, so the file reads in History order', () => {
      const csv = buildCsv({
        ...empty,
        fasts: [
          { startedAt: new Date(2026, 7, 26, 8), endedAt: new Date(2026, 7, 26, 20) },
          { startedAt: started, endedAt: ended },
        ],
      } as never);
      expect(fastRows(csv).map((l) => cell(l, 'date'))).toEqual(['2026-08-25', '2026-08-26']);
    });

    it('fills no column belonging to another row type', () => {
      // The long format's contract: a row fills only its own columns, so a
      // reader filtering by type gets a clean table back.
      const csv = buildCsv({ ...empty, fasts: [{ startedAt: started, endedAt: ended }] } as never);
      const [line] = fastRows(csv);
      for (const col of ['calories', 'protein', 'weight', 'sleepHours', 'cardioKcal']) {
        expect(cell(line, col)).toBe('');
      }
    });
  });
});

// ─── 2026-10-08: template + target rows ────────────────────────────────
import type { DailyTargetRecord } from './target-history';
import type { WorkoutTemplate } from './workout';

/** The header as it stood before 2026-10-08 — what an older reader expects. */
const OLD_COLS = [
  'type', 'date', 'timestamp', 'calories', 'protein', 'carbs', 'fat', 'weight',
  'exerciseCompleted', 'liftCompleted', 'cardioCompleted', 'mealLabel', 'mealType', 'waterFlOz',
  'waist', 'chest', 'bicep', 'hip', 'neck', 'template', 'exercise', 'setKind', 'setGroup',
  'setWeight', 'setReps', 'setDurationSec', 'setRir', 'durationMin', 'sleepHours', 'modality',
  'cardioLabel', 'cardioDurationSec', 'cardioDistanceM', 'cardioAvgHr', 'cardioMaxHr', 'cardioKcal',
  'cardioRpe', 'cardioSource', 'cardioProvider', 'cardioStartedAt', 'notes', 'fastEndedAt',
  'fastHours', 'bodyFatPct', 'bodyFatMethod',
];
const KNOWN_OLD_TYPES = new Set(['meal', 'weight', 'water', 'sleep', 'measurement', 'workout', 'workout_set', 'cardio', 'fast']);

/** A minimal RFC-4180 line splitter (quoted fields, doubled quotes). */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** An OLD-format reader: positional, over the pre-2026-10-08 columns only,
 *  skipping row types it does not know — how a reader written before this
 *  change consumes the file. */
function oldParse(csv: string): Record<string, string>[] {
  const [, ...lines] = csv.split('\r\n');
  return lines.map(splitLine).filter((f) => KNOWN_OLD_TYPES.has(f[0]))
    .map((f) => Object.fromEntries(OLD_COLS.map((c, i) => [c, f[i] ?? ''])));
}

const at = new Date('2026-10-09T04:00:00Z');
const records: DailyTargetRecord[] = [
  { date: '2026-10-08', kcalTarget: 1850, kcalSource: 'auto', proteinTarget: 130, proteinSource: 'auto',
    maintenanceEstimate: 2030, maintenanceSource: 'measured', recordedBy: 'prompt', recordedAt: at, updatedAt: at },
  { date: '2026-10-09', kcalTarget: 1850, kcalSource: 'auto', proteinTarget: 140, proteinSource: 'user',
    maintenanceEstimate: 2023, maintenanceSource: 'measured', recordedBy: 'prompt', recordedAt: at, updatedAt: at,
    change: { protein: { from: 130, to: 140, fromSource: 'auto', toSource: 'user' }, reasons: [{ kind: 'user-set', field: 'protein' }] } },
];
const legDay: WorkoutTemplate = {
  name: 'Leg Day', restMiniSec: 10, restClusterSec: 150, createdAt: at, updatedAt: at,
  exercises: [
    { exerciseId: 'smith', name: 'Smith squat', targetLoad: 30, restAfterSec: 60,
      plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'activation', group: 2 }, { kind: 'mini', group: 2 }],
      lastModifiedAt: '2026-10-09T04:00:00.000Z', lastModifiedBy: 'prompt' },
    { exerciseId: 'calf', name: 'Single-leg DB calf raise', targetLoad: 25, restAfterSec: 60,
      plannedSets: [{ kind: 'activation', group: 1, label: 'L' }, { kind: 'mini', group: 1, label: 'L' },
        { kind: 'activation', group: 2, label: 'R' }, { kind: 'mini', group: 2, label: 'R' }],
      loadLog: [{ at: '2026-10-02T18:00:00.000Z', from: 40, to: 25, by: 'user', reason: 'x' }] },
    { exerciseId: 'crunch', name: 'Weighted Floor Crunch', targetLoad: 30, restAfterSec: 90, restAfterMaxSec: 120,
      plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }] },
  ],
  cardioBlocks: [{ modality: 'walk', label: 'Zone 2', targetDurationSec: 1200 }],
};

describe('buildCsv — template and target rows (2026-10-08)', () => {
  const data = {
    ...emptyData(),
    logs: [{ calories: 500, date: new Date(2026, 9, 1, 12) }] as DailyLog[],
    dailyWeights: { '2026-10-07': 153.8, '2026-10-08': 153.6 },
    templates: [legDay],
    effortStandards: { smith: 'rir1' as const },
    targetRecords: records,
  };
  const csv = buildCsv(data);
  const header = csv.split('\r\n')[0].split(',');
  const rows = csv.split('\r\n').slice(1).map(splitLine).map((f) => Object.fromEntries(header.map((c, i) => [c, f[i] ?? ''])));

  it('includes both new row types', () => {
    expect(rows.some((r) => r.type === 'template')).toBe(true);
    expect(rows.some((r) => r.type === 'target')).toBe(true);
  });

  it('every old column keeps its name and position; the new ones are appended', () => {
    expect(header.slice(0, OLD_COLS.length)).toEqual(OLD_COLS);
  });

  it('an old-format parser still reads the file — same rows, same values, new types skipped', () => {
    const before = buildCsv({ ...emptyData(), logs: data.logs, dailyWeights: data.dailyWeights });
    expect(oldParse(csv)).toEqual(oldParse(before));
    expect(oldParse(csv).map((r) => r.type)).toEqual(['meal', 'weight', 'weight']);
  });

  it('template rows: position, load, clusters, labels, rests, effort, provenance; cardio as one row', () => {
    const t = rows.filter((r) => r.type === 'template');
    expect(t.map((r) => [r.position, r.exercise, r.load, r.clusters, r.clusterLabels, r.miniRestSec, r.restBetweenSec, r.effortStandard]))
      .toEqual([
        ['1', 'Smith squat', '30', '2', '', '10', '60', 'rir1'],
        ['2', 'Single-leg DB calf raise', '25', '2', 'L,R', '10', '60', 'failure'],
        ['3', 'Weighted Floor Crunch', '30', '1', '', '10', '90-120', 'failure'],
        ['4', 'Zone 2', '', '', '', '', '', ''],
      ]);
    expect(t[3].durationMin).toBe('20');
    expect([t[0].lastModifiedAt, t[0].lastModifiedBy]).toEqual(['2026-10-09T04:00:00.000Z', 'prompt']);
    // No row stamp → the newest load move; neither → blank.
    expect([t[1].lastModifiedAt, t[1].lastModifiedBy]).toEqual(['2026-10-02T18:00:00.000Z', 'user']);
    expect([t[2].lastModifiedAt, t[2].lastModifiedBy]).toEqual(['', '']);
  });

  it('target rows: 10/8 = 130 (auto), 10/9 = 140 (user) with the reason; earlier days blank, never reconstructed', () => {
    const t = Object.fromEntries(rows.filter((r) => r.type === 'target').map((r) => [r.date, r]));
    expect(Object.keys(t)).toEqual(['2026-10-01', '2026-10-07', '2026-10-08', '2026-10-09']);
    expect([t['2026-10-08'].proteinTarget, t['2026-10-08'].proteinTargetSource, t['2026-10-08'].kcalTarget]).toEqual(['130', 'auto', '1850']);
    expect(t['2026-10-08'].targetChangeReason).toBe('');
    expect([t['2026-10-09'].proteinTarget, t['2026-10-09'].proteinTargetSource]).toEqual(['140', 'user']);
    expect(t['2026-10-09'].targetChangeReason).toBe('protein 130 g (auto) -> 140 g (user): user set the protein target');
    for (const d of ['2026-10-01', '2026-10-07']) {
      expect([t[d].kcalTarget, t[d].proteinTarget, t[d].kcalTargetSource, t[d].maintenanceEstimate]).toEqual(['', '', '', '']);
    }
  });

  it('no templates and no records → no new rows at all for a file with no dated data', () => {
    expect(buildCsv(emptyData()).split('\r\n')).toHaveLength(1);
  });
});

// ─── 2026-10-11: superset columns ─────────────────────────────────────
import { parseImportCsv } from './import-csv';

/** The header as it stood before supersets — every 2026-10-08 column included. */
const PRE_SUPERSET_COLS = [
  ...OLD_COLS,
  'position', 'load', 'clusters', 'clusterLabels', 'miniRestSec', 'restBetweenSec',
  'effortStandard', 'lastModifiedAt', 'lastModifiedBy',
  'kcalTarget', 'kcalTargetSource', 'proteinTarget', 'proteinTargetSource',
  'maintenanceEstimate', 'compositionAdjustedMaintenance', 'targetChangeReason',
];
/** A reader written against the 2026-10-08 file: positional, every row type it knew. */
function preSupersetParse(csv: string): Record<string, string>[] {
  const [, ...lines] = csv.split('\r\n');
  return lines.map(splitLine).map((f) => Object.fromEntries(PRE_SUPERSET_COLS.map((c, i) => [c, f[i] ?? ''])));
}

describe('buildCsv — superset columns (2026-10-11)', () => {
  const myo = (w: number, act: number) => [
    { kind: 'activation' as const, group: 1, weight: w, reps: act, rir: 0 },
    { kind: 'mini' as const, group: 1, weight: w, reps: 4, rir: 0 },
    { kind: 'mini' as const, group: 1, weight: w, reps: 3, rir: 0 },
  ];
  const session = (paired: boolean): WorkoutSession => ({
    status: 'completed', templateName: 'Leg Day', date: at, createdAt: at, updatedAt: at, durationMin: 52,
    exercises: [
      { exerciseId: 'ext', name: 'Leg Extensions', cues: [], logStyle: 'weight-reps', sets: myo(90, 10),
        ...(paired ? { supersetGroup: 'A', pairPosition: 1 as const, transitionRestSec: 30, roundRestSec: 30 } : {}) },
      { exerciseId: 'curl', name: 'Leg Curls', cues: [], logStyle: 'weight-reps', sets: myo(90, 11),
        ...(paired ? { supersetGroup: 'A', pairPosition: 2 as const, transitionRestSec: 30, roundRestSec: 30 } : {}) },
    ],
  });
  const pairedTemplate: WorkoutTemplate = {
    ...legDay,
    exercises: [
      { ...legDay.exercises[0] },
      { ...legDay.exercises[1], supersetGroup: 'A', pairPosition: 1, transitionRestSec: 40, roundRestSec: 45 },
      { ...legDay.exercises[2], supersetGroup: 'A', pairPosition: 2 },
    ],
  };
  const data = (paired: boolean) => ({
    ...emptyData(),
    logs: [{ calories: 500, protein: 40, date: new Date(2026, 9, 1, 12) }] as DailyLog[],
    workoutSessions: [session(paired)],
    templates: [paired ? pairedTemplate : legDay],
  });
  const read = (csv: string) => {
    const header = csv.split('\r\n')[0].split(',');
    return csv.split('\r\n').slice(1).map(splitLine).map((f) => Object.fromEntries(header.map((c, i) => [c, f[i] ?? ''])));
  };
  const paired = buildCsv(data(true));
  const straight = buildCsv(data(false));

  it('appends the four columns after every existing one', () => {
    const header = paired.split('\r\n')[0].split(',');
    expect(header.slice(0, PRE_SUPERSET_COLS.length)).toEqual(PRE_SUPERSET_COLS);
    expect(header.slice(PRE_SUPERSET_COLS.length, PRE_SUPERSET_COLS.length + 4)).toEqual(['supersetGroup', 'pairPosition', 'transitionRestSec', 'roundRestSec']);
  });

  it('myo-reps logged inside a pair export the same set rows as straight sets, plus group and position', () => {
    const sets = (csv: string) => read(csv).filter((r) => r.type === 'workout_set');
    const strip = (r: Record<string, string>) => {
      const { supersetGroup: _g, pairPosition: _p, supersetBlock: _b, supersetOrder: _o, transitionSec: _t, ...rest } = r;
      return rest;
    };
    expect(sets(paired).map(strip)).toEqual(sets(straight).map(strip));
    expect(sets(paired).map((r) => `${r.exercise} ${r.setKind} ${r.supersetGroup}${r.pairPosition}`)).toEqual([
      'Leg Extensions activation A1', 'Leg Extensions mini A1', 'Leg Extensions mini A1',
      'Leg Curls activation A2', 'Leg Curls mini A2', 'Leg Curls mini A2',
    ]);
    expect(sets(straight).every((r) => r.supersetGroup === '' && r.pairPosition === '')).toBe(true);
  });

  it('template rows carry the group, position and the group\'s rests on every member; workout rows keep durationMin', () => {
    const t = read(paired).filter((r) => r.type === 'template' && r.exercise !== 'Zone 2');
    expect(t.map((r) => [r.exercise, r.supersetGroup, r.pairPosition, r.transitionRestSec, r.roundRestSec])).toEqual([
      ['Smith squat', '', '', '', ''],
      ['Single-leg DB calf raise', 'A', '1', '40', '45'],
      ['Weighted Floor Crunch', 'A', '2', '40', '45'],
    ]);
    expect(read(paired).find((r) => r.type === 'workout')!.durationMin).toBe('52');
  });

  it('a reader written before supersets reads the same values from the new file', () => {
    // The straight file and the paired file differ ONLY in the new columns:
    // every pre-superset column of every row is identical.
    expect(preSupersetParse(paired)).toEqual(preSupersetParse(straight));
    expect(oldParse(paired)).toEqual(oldParse(straight));
  });

  it('the import parser still reads the export\'s meal rows', () => {
    const r = parseImportCsv(paired);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.entries.map((e) => e.calories)).toEqual([500]);
  });
});

// ─── Program v2 (2026-10-11): appended columns + weeklyVolume rows ─────
import { HISTORICAL } from './__fixtures__/csv-historical';
import { HISTORICAL_GOLDEN_CSV } from './__fixtures__/csv-historical.golden';

describe('buildCsv — Program v2 columns (test 10)', () => {
  const NEW = [
    'templateVersion', 'supersetBlock', 'supersetOrder', 'side', 'transitionSec',
    'avgHR', 'zone2InBand', 'bedtime', 'wakeTime',
    'weekStart', 'muscle', 'directClusters', 'fractionalClusters',
    // 2026-10-15, owner bug D: the two rests, split.
    'restBetweenClustersSec', 'restToNextSec',
    // 2026-10-20: the evening hunger rating ('hunger' rows).
    'eveningHunger',
    // 2026-10-20 (item 8): which window a volume row covers, and the
    // sessions a 'rotationVolume' row counts.
    'volumeWindow', 'rotationSessions',
  ];
  const csv = buildCsv(HISTORICAL);
  const lines = csv.split('\r\n');
  const golden = HISTORICAL_GOLDEN_CSV.split('\r\n');
  const header = lines[0].split(',');
  const read = (text: string) => {
    const [h, ...rest] = text.split('\r\n');
    const cols = h.split(',');
    return rest.map(splitLine).map((f) => Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ''])));
  };

  it('appends the new columns after every existing one, in order', () => {
    const before = golden[0].split(',');
    expect(header.slice(0, before.length)).toEqual(before);
    expect(header.slice(before.length)).toEqual(NEW);
  });

  it('historical rows are byte-for-byte unchanged in every existing column (the pre-v2 exporter\'s own output)', () => {
    const old = lines.filter((l) => !l.startsWith('weeklyVolume,') && !l.startsWith('rotationVolume,'));
    expect(old).toHaveLength(golden.length);
    old.slice(1).forEach((line, i) => {
      expect(line.startsWith(`${golden[i + 1]},`)).toBe(true);
    });
  });

  it('fills the new columns from what was stored, and leaves templateVersion / bedtime blank where nothing says it', () => {
    const rows = read(csv);
    const calfR = rows.find((r) => r.type === 'workout_set' && r.exercise === 'Single-leg DB calf raise' && r.setGroup === '2' && r.setKind === 'mini');
    expect(calfR).toMatchObject({ side: 'R', supersetBlock: '', templateVersion: '' });
    const flat = rows.find((r) => r.type === 'workout_set' && r.exercise === 'DB Flat Press');
    expect(flat).toMatchObject({ supersetBlock: 'A', supersetOrder: '1', transitionSec: '30', side: '' });
    const cardio = rows.filter((r) => r.type === 'cardio').map((r) => [r.avgHR, r.zone2InBand]);
    expect(cardio).toEqual([['128', 'true'], ['141', 'false']]);
    expect(rows.filter((r) => r.type === 'sleep').every((r) => r.bedtime === '' && r.wakeTime === '')).toBe(true);
  });

  it('a stored version, bedtime and wake time are exported', () => {
    const v2 = buildCsv({
      ...HISTORICAL,
      workoutSessions: HISTORICAL.workoutSessions.map((s) => ({ ...s, templateVersion: 'v2' as const })),
      dailySleepTimes: { '2026-10-07': { bedtime: '23:40', wakeTime: '06:10' } },
      templateVersions: { 't-push': 'v2' },
    });
    const rows = read(v2);
    expect(rows.find((r) => r.type === 'sleep' && r.date === '2026-10-07')).toMatchObject({ sleepHours: '6.5', bedtime: '23:40', wakeTime: '06:10' });
    expect(rows.filter((r) => r.type === 'workout').map((r) => r.templateVersion)).toEqual(['v2', 'v2']);
    expect(rows.filter((r) => r.type === 'template').every((r) => r.templateVersion === 'v2')).toBe(true);
  });

  it('weeklyVolume rows: one per week per credited muscle, an L+R calf pair counted once', () => {
    const rows = read(csv).filter((r) => r.type === 'weeklyVolume');
    const byMuscle = Object.fromEntries(rows.map((r) => [`${r.weekStart} ${r.muscle}`, [r.directClusters, r.fractionalClusters]]));
    // Week of Mon 2026-10-05: Smith ×2, calf L+R (=1), flat ×2, crunch ×1, lateral ×1.
    expect(byMuscle['2026-10-05 quads']).toEqual(['2', '2']);
    expect(byMuscle['2026-10-05 glutes']).toEqual(['0', '1']);
    expect(byMuscle['2026-10-05 calves']).toEqual(['1', '1']);
    expect(byMuscle['2026-10-05 chest']).toEqual(['2', '2']);
    expect(byMuscle['2026-10-05 triceps']).toEqual(['0', '1']);
    expect(byMuscle['2026-10-05 sideDelt']).toEqual(['1', '1']);
    expect(byMuscle['2026-10-05 abs']).toEqual(['1', '1']);
    expect(rows.every((r) => r.date === r.weekStart)).toBe(true);
    // Self-describing since 2026-10-20: these are calendar weeks, not the
    // in-app rotation.
    expect(rows.every((r) => r.volumeWindow === 'calendar week' && r.rotationSessions === '')).toBe(true);
  });
});

/** Item 8 (owner, 2026-10-20): the export's `weeklyVolume` rows group by
 *  calendar week, so the week of 10/19 held only Leg + Pull while Train's
 *  sheet shows the latest rotation. `rotationVolume` rows are the sheet's
 *  number: the same `rotationVolume` call, over the same templates. */
describe('buildCsv — rotationVolume rows (the in-app rotation)', () => {
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const myo = (w: number, act: number) => [
    { kind: 'activation' as const, group: 1, weight: w, reps: act, rir: 0, done: true },
    { kind: 'mini' as const, group: 1, weight: w, reps: 4, rir: 0, done: true },
  ];
  const ex = (exerciseId: string, name: string, clusters = 1) => ({
    exerciseId, name, cues: [], logStyle: 'weight-reps' as const,
    sets: Array.from({ length: clusters }, (_, i) => myo(20, 12).map((x) => ({ ...x, group: i + 1 }))).flat(),
  });
  const sess = (id: string, templateId: string, templateName: string, day: string, exercises: ReturnType<typeof ex>[]) => ({
    id, status: 'completed' as const, templateId, templateName, date: at(day), createdAt: at(day), updatedAt: at(day), exercises,
  });
  const sessions = [
    sess('push1', 't-push', 'Push Day', '2026-10-09', [ex('flat', 'DB Flat Press', 1)]),
    sess('push2', 't-push', 'Push Day', '2026-10-15', [ex('flat', 'DB Flat Press', 2)]),
    sess('pull', 't-pull', 'Pull Day', '2026-10-20', [ex('row', 'Seated Machine Row', 2)]),
    sess('leg', 't-leg', 'Leg Day', '2026-10-19', [ex('smith', 'Smith squat', 2)]),
    // Not a rotation template (an imported walk): never counted.
    { ...sess('walk', '', '', '2026-10-16', []), templateId: undefined, templateName: undefined },
  ] as WorkoutSession[];
  const catalogMuscles = [
    { id: 'flat', muscles: ['chest', 'triceps'] },
    { id: 'row', muscles: ['back', 'biceps'] },
    { id: 'smith', muscles: ['quads', 'glutes'] },
  ] as { id: string; muscles: MuscleGroup[] }[];
  const ids = ['t-push', 't-pull', 't-leg'];
  const csv = buildCsv({ ...emptyData(), workoutSessions: sessions, catalogMuscles, rotationTemplateIds: ids });
  const [h, ...rest] = csv.split('\r\n');
  const cols = h.split(',');
  const rows = rest.map((l) => l.split(',')).map((f) => Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ''])));
  const rot = rows.filter((r) => r.type === 'rotationVolume');

  it('matches the in-app sheet\'s rotationVolume, muscle by muscle', () => {
    const app = rotationVolume(sessions, catalogMuscles, ids).week.filter((m) => m.fractional > 0);
    expect(rot.map((r) => [r.muscle, Number(r.directClusters), Number(r.fractionalClusters)]))
      .toEqual(app.map((m) => [m.muscle, m.direct, m.fractional]));
    expect(rot.length).toBeGreaterThan(0);
  });

  it('is keyed by the latest session of each template — Push 10/15, not 10/09', () => {
    expect(new Set(rot.map((r) => r.rotationSessions))).toEqual(new Set(['Push Day 2026-10-15; Leg Day 2026-10-19; Pull Day 2026-10-20']));
    expect(rot.every((r) => r.date === '2026-10-20' && r.volumeWindow === 'latest rotation' && r.weekStart === '')).toBe(true);
    // Push 10/15 carried two chest clusters; the 10/09 single cluster is not in it.
    expect(rot.find((r) => r.muscle === 'chest')?.directClusters).toBe('2');
  });

  it('the calendar-week rows stay, labelled: the week of 10/19 holds only Leg + Pull', () => {
    const week = rows.filter((r) => r.type === 'weeklyVolume' && r.weekStart === '2026-10-19');
    expect(week.map((r) => r.muscle).sort()).toEqual(['back', 'biceps', 'glutes', 'quads']);
    expect(week.every((r) => r.volumeWindow === 'calendar week')).toBe(true);
  });

  it('without rotationTemplateIds, the rotation is every exported template; none → no rows', () => {
    const tpl = (id: string) => ({ id, name: id, exercises: [], restMiniSec: 10, restClusterSec: 90, createdAt: at('2026-10-01'), updatedAt: at('2026-10-01') });
    const viaTemplates = buildCsv({ ...emptyData(), workoutSessions: sessions, catalogMuscles, templates: ids.map(tpl) });
    expect(viaTemplates.split('\r\n').filter((l) => l.startsWith('rotationVolume,'))).toHaveLength(rot.length);
    const none = buildCsv({ ...emptyData(), workoutSessions: sessions, catalogMuscles });
    expect(none.split('\r\n').some((l) => l.startsWith('rotationVolume,'))).toBe(false);
  });
});

describe('rotationTemplates (moved to core, 2026-10-20)', () => {
  const at = (d: string) => new Date(`${d}T12:00:00Z`);
  const tpls = [{ id: 'push' }, { id: 'pull' }, { id: 'upper' }];
  const done = (templateId: string, d: string) => ({ status: 'completed' as const, templateId, date: at(d) });
  it('a Program v2 names its templates; else only those used in the last 28 days; else all', () => {
    const now = at('2026-10-20').getTime();
    expect(rotationTemplates(tpls, new Set(['pull']), [], now).map((t) => t.id)).toEqual(['pull']);
    expect(rotationTemplates(tpls, new Set(), [done('push', '2026-10-15'), done('upper', '2026-05-01')], now).map((t) => t.id)).toEqual(['push']);
    expect(rotationTemplates(tpls, new Set(), [done('upper', '2026-05-01')], now).map((t) => t.id)).toEqual(['push', 'pull', 'upper']);
  });
});

/** Owner bug D (2026-10-15): the export carried one rest, `restBetweenSec`,
 *  which never read a row's own cluster rest — Smith squat's 105 s between
 *  its clusters was invisible in the file. */
describe('buildCsv — the two rests, split', () => {
  const csv = buildCsv({
    logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
    templates: [{
      id: 't1', name: 'Leg Day', restClusterSec: 90, restMiniSec: 10,
      exercises: [
        { exerciseId: 'a', name: 'Smith squat', restClusterSec: 105, restAfterSec: 60, plannedSets: [] },
        { exerciseId: 'b', name: 'Pull-up', restAfterSec: 105, restAfterMaxSec: 120, plannedSets: [] },
        { exerciseId: 'c', name: 'Leg Curls', plannedSets: [] },
      ],
    }],
  } as never);
  const [head, ...lines] = csv.split('\r\n');
  const cols = head.split(',');
  const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
  const of = (name: string) => rows.find((r) => r.type === 'template' && r.exercise === name)!;

  it("a row's own cluster rest, else the template's", () => {
    expect(of('Smith squat').restBetweenClustersSec).toBe('105');
    expect(of('Leg Curls').restBetweenClustersSec).toBe('90');
  });

  it('rest to the next exercise: the row value (with its range), else the cluster rest', () => {
    expect(of('Smith squat').restToNextSec).toBe('60');
    expect(of('Pull-up').restToNextSec).toBe('105-120');
    expect(of('Leg Curls').restToNextSec).toBe('90');
  });
});

// Push v2's Superset C as three members (2026-10-15): Skull Crusher joins as C3.
describe('buildCsv — a three-member superset (Push v2 Superset C, 2026-10-15)', () => {
  const at = new Date('2026-10-15T11:29:53Z');
  const myo = (w: number, act: number, group = 1) => [
    { kind: 'activation' as const, group, weight: w, reps: act, rir: 0 },
    { kind: 'mini' as const, group, weight: w, reps: 4, rir: 0 },
    { kind: 'mini' as const, group, weight: w, reps: 3, rir: 0 },
  ];
  const tag = (pos: 1 | 2 | 3) => ({ supersetGroup: 'C', pairPosition: pos, transitionRestSec: 30, roundRestSec: 30 });
  const session: WorkoutSession = {
    status: 'completed', templateName: 'Push Day', templateVersion: 'v2', date: at, createdAt: at, updatedAt: at,
    exercises: [
      { exerciseId: 'ohe', name: 'Overhead DB Extension', cues: [], logStyle: 'weight-reps', sets: myo(30, 15), ...tag(1) },
      { exerciseId: 'lat', name: 'DB Lateral Raise', cues: [], logStyle: 'weight-reps', ...tag(2),
        sets: [...myo(15, 14), ...myo(15, 10, 2), { kind: 'drop' as const, group: 2, weight: 10, reps: 7 }] },
      { exerciseId: 'skull', name: 'Skull Crusher', cues: [], logStyle: 'weight-reps', sets: myo(15, 10), ...tag(3) },
    ],
  };
  const planned = (n: number) => Array.from({ length: n }, () => [{ kind: 'activation' as const }, { kind: 'mini' as const }, { kind: 'mini' as const }]).flat();
  const template: WorkoutTemplate = {
    name: 'Push Day', restMiniSec: 10, restClusterSec: 90, createdAt: at, updatedAt: at,
    exercises: [
      { exerciseId: 'ohe', name: 'Overhead DB Extension', plannedSets: planned(1), supersetGroup: 'C', pairPosition: 1, transitionRestSec: 30, roundRestSec: 30 },
      { exerciseId: 'lat', name: 'DB Lateral Raise', plannedSets: [...planned(2), { kind: 'drop' }], restClusterSec: 60, supersetGroup: 'C', pairPosition: 2 },
      { exerciseId: 'skull', name: 'Skull Crusher', plannedSets: planned(1), supersetGroup: 'C', pairPosition: 3,
        baseline: { since: '2026-10-15', reason: 'context changed: position 2026-10-15' } },
    ],
  };
  const csv = buildCsv({ ...emptyData(), workoutSessions: [session], templates: [template] });
  const [h, ...lines] = csv.split('\r\n');
  const cols = h.split(',');
  const rows = lines.map(splitLine).map((f) => Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ''])));
  const pick = (r: Record<string, string>) => [r.exercise, r.supersetGroup, r.pairPosition, r.supersetBlock, r.supersetOrder, r.transitionSec, r.roundRestSec];

  it('every set of every member carries its block and order — Skull Crusher is C / 3', () => {
    const sets = rows.filter((r) => r.type === 'workout_set');
    expect(sets).toHaveLength(3 + 7 + 3);
    const skull = sets.filter((r) => r.exercise === 'Skull Crusher');
    // A set row carries the switch rest (`transitionSec`); the round rest is a
    // template column only.
    expect(skull.map(pick)).toEqual(Array(3).fill(['Skull Crusher', 'C', '3', 'C', '3', '30', '']));
    expect(sets.filter((r) => r.exercise === 'DB Lateral Raise').every((r) => r.supersetBlock === 'C' && r.supersetOrder === '2')).toBe(true);
    expect(sets.find((r) => r.exercise === 'Overhead DB Extension')).toMatchObject({ supersetBlock: 'C', supersetOrder: '1' });
  });

  it('the template rows give C1 / C2 / C3 with the group\'s rests, and the Skull Crusher baseline in notes', () => {
    const tpl = rows.filter((r) => r.type === 'template');
    expect(tpl.map(pick)).toEqual([
      ['Overhead DB Extension', 'C', '1', 'C', '1', '30', '30'],
      ['DB Lateral Raise', 'C', '2', 'C', '2', '30', '30'],
      ['Skull Crusher', 'C', '3', 'C', '3', '30', '30'],
    ]);
    expect(tpl[2].notes).toBe('baseline since 2026-10-15: context changed: position 2026-10-15');
    expect(tpl[1].notes).toBe('+ drop set');
  });
});
