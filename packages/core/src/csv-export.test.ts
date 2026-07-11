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
