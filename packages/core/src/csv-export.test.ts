import { describe, it, expect } from 'vitest';
import { buildCsv } from './csv-export';
import type { DailyLog, Measurement } from './types';
import type { WorkoutSession } from './workout';

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
