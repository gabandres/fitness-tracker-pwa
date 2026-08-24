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
});
