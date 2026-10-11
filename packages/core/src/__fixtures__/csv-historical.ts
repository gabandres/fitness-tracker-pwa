/**
 * A dataset shaped exactly as data was stored BEFORE Program v2 (2026-10-11):
 * no `templateVersion`, no bedtime/wake time, no HR band. `csv-historical.golden.ts`
 * is what the exporter at commit c2ba09bb (the last before Program v2) made of
 * it — generated from that commit's `csv-export.ts`, not written by hand — so
 * the export test can prove that every pre-existing column of every pre-existing
 * row is unchanged byte for byte.
 */
import type { DailyLog, Measurement } from '../types';
import type { WorkoutSession, WorkoutTemplate } from '../workout';

const at = (d: string, h = 18) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
const myo = (w: number, act: number, label?: string, group = 1) => [
  { kind: 'activation' as const, group, weight: w, reps: act, rir: 0, done: true, ...(label ? { label } : {}) },
  { kind: 'mini' as const, group, weight: w, reps: 4, done: true },
  { kind: 'mini' as const, group, weight: w, reps: 3, done: true },
];

const sessions: WorkoutSession[] = [
  {
    id: 's1', status: 'completed', templateId: 't-leg', templateName: 'Leg Day', date: at('2026-10-06'),
    createdAt: at('2026-10-06'), updatedAt: at('2026-10-06'), durationMin: 58, sleepHours: 7.1, bodyweight: 182.4,
    exercises: [
      { exerciseId: 'smith', name: 'Smith squat', cues: [], logStyle: 'weight-reps', sets: [...myo(30, 13), ...myo(30, 11, undefined, 2)] },
      { exerciseId: 'calf', name: 'Single-leg DB calf raise', cues: [], logStyle: 'weight-reps', sets: [...myo(25, 12, 'L', 1), ...myo(25, 11, 'R', 2)] },
    ],
    cardio: [{ modality: 'walk', label: 'Zone 2', durationSec: 1200, avgHr: 128, rpe: 5, source: 'manual' }],
  },
  {
    id: 's2', status: 'completed', templateId: 't-push', templateName: 'Push Day', date: at('2026-10-09'),
    createdAt: at('2026-10-09'), updatedAt: at('2026-10-09'), durationMin: 61,
    exercises: [
      { exerciseId: 'flat', name: 'DB Flat Press', cues: [], logStyle: 'weight-reps', sets: [...myo(25, 12), ...myo(25, 10, undefined, 2)],
        supersetGroup: 'A', pairPosition: 1, transitionRestSec: 30, roundRestSec: 30 },
      { exerciseId: 'crunch', name: 'Weighted Floor Crunch', cues: [], logStyle: 'weight-reps', sets: myo(30, 15),
        supersetGroup: 'A', pairPosition: 2, transitionRestSec: 30, roundRestSec: 30 },
      { exerciseId: 'lat', name: 'DB Lateral Raise', cues: [], logStyle: 'weight-reps',
        sets: [...myo(15, 14), { kind: 'drop' as const, weight: 10, reps: 8, done: true }] },
    ],
    cardio: [{ modality: 'run', label: 'Zone 2', durationSec: 1200, avgHr: 141, rpe: 8, source: 'manual' }],
  },
];

const templates: WorkoutTemplate[] = [{
  id: 't-push', name: 'Push Day', restMiniSec: 10, restClusterSec: 90, createdAt: at('2026-10-01'), updatedAt: at('2026-10-01'),
  exercises: [
    { exerciseId: 'flat', name: 'DB Flat Press', targetLoad: 25, restAfterSec: 90, restAfterMaxSec: 120,
      plannedSets: myo(25, 0).map(({ kind, group }) => ({ kind, group })),
      baseline: { since: '2026-10-09', reason: 'position changed 10/9' } },
    { exerciseId: 'lat', name: 'DB Lateral Raise', targetLoad: 15,
      plannedSets: [...myo(15, 0).map(({ kind, group }) => ({ kind, group })), { kind: 'drop', weight: 10 }] },
  ],
  cardioBlocks: [{ modality: 'walk', label: 'Zone 2', targetDurationSec: 1200 }],
}];

export const HISTORICAL = {
  logs: [{ calories: 520, protein: 42, date: at('2026-10-06', 12), mealLabel: 'Lunch' }] as DailyLog[],
  measurements: [{ date: at('2026-10-05', 8), waist: 34.5 }] as Measurement[],
  dailyWeights: { '2026-10-06': 182.4, '2026-10-07': 182.0 },
  dailyWater: { '2026-10-06': 64 },
  dailySleep: { '2026-10-06': 7.5, '2026-10-07': 6.5 },
  workoutSessions: sessions,
  templates,
};
