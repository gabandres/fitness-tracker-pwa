import { describe, expect, it } from 'vitest';
import {
  CLUSTER_WEEK_MAX,
  CLUSTER_WEEK_MIN,
  clustersInExercise,
  volumeStatus,
  weeklyClusterAudit,
} from './weekly-cluster-audit';
import type { WorkoutSession } from './workout';

const NOW = new Date('2026-09-15T20:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

const session = (daysAgo: number, exercises: WorkoutSession['exercises'], status: WorkoutSession['status'] = 'completed'): WorkoutSession => ({
  status,
  date: new Date(NOW - daysAgo * DAY),
  exercises,
  createdAt: new Date(NOW),
  updatedAt: new Date(NOW),
});

const twoClusters = (exerciseId: string, name = exerciseId): WorkoutSession['exercises'][number] => ({
  exerciseId, name, cues: [],
  sets: [
    { kind: 'activation', group: 1, reps: 11, weight: 20 }, { kind: 'mini', group: 1, reps: 5 },
    { kind: 'activation', group: 2, reps: 10, weight: 20 }, { kind: 'mini', group: 2, reps: 4 },
  ],
});
const oneCluster = (exerciseId: string): WorkoutSession['exercises'][number] => ({
  exerciseId, name: exerciseId, cues: [],
  sets: [{ kind: 'activation', group: 1, reps: 11, weight: 20 }, { kind: 'mini', group: 1, reps: 5 }],
});

const catalog = [
  { id: 'squat', muscles: ['quads', 'glutes'] as const },
  { id: 'legext', muscles: ['quads'] as const },
  { id: 'rdl', muscles: ['hamstrings', 'glutes'] as const },
  { id: 'calf', muscles: ['calves'] as const },
  { id: 'flat', muscles: [] as const },
];

describe('weekly cluster audit — clusters, never sets', () => {
  it('counts one per cluster toward the primary muscle and compares to 2-6', () => {
    const audit = weeklyClusterAudit(
      [session(1, [twoClusters('squat'), oneCluster('legext'), oneCluster('rdl'), oneCluster('calf')])],
      catalog,
      NOW,
    );
    // quads: squat 2 + leg ext 1 = 3 (in range); hams 1, calves 1 (below).
    expect(audit.muscles).toEqual([
      { muscle: 'quads', clusters: 3, status: 'in-range' },
      { muscle: 'calves', clusters: 1, status: 'below' },
      { muscle: 'hamstrings', clusters: 1, status: 'below' },
    ]);
    expect(audit.clusters).toBe(5);
    expect(audit.straightSets).toBe(0);
    expect(audit.unattributed).toEqual([]);
  });

  it('does NOT inflate a cluster into three sets: a 2-cluster lift is 2, not 6', () => {
    const audit = weeklyClusterAudit([session(2, [twoClusters('squat')])], catalog, NOW);
    expect(audit.muscles[0]).toEqual({ muscle: 'quads', clusters: 2, status: 'in-range' });
  });

  it('above six flags recovery; the thresholds are the rest-pause range', () => {
    expect(CLUSTER_WEEK_MIN).toBe(2);
    expect(CLUSTER_WEEK_MAX).toBe(6);
    expect(volumeStatus(1)).toBe('below');
    expect(volumeStatus(2)).toBe('in-range');
    expect(volumeStatus(6)).toBe('in-range');
    expect(volumeStatus(7)).toBe('above');
  });

  it('an exercise with no muscle group is named, not dropped, and straight sets are reported apart', () => {
    const plank: WorkoutSession['exercises'][number] = {
      exerciseId: 'plank', name: 'Plank', cues: [], logStyle: 'time', sets: [{ kind: 'working', durationSec: 92 }],
    };
    const straight: WorkoutSession['exercises'][number] = {
      exerciseId: 'row', name: 'Row', cues: [], sets: [{ kind: 'working', reps: 8, weight: 100 }, { kind: 'working', reps: 8, weight: 100 }],
    };
    const audit = weeklyClusterAudit([session(3, [oneCluster('flat'), plank, straight])], catalog, NOW);
    expect(audit.unattributed).toEqual(['flat']);
    expect(audit.muscles).toEqual([]);
    expect(audit.straightSets).toBe(2);
    expect(audit.clusters).toBe(1);
  });

  it('only completed sessions inside seven days count', () => {
    const audit = weeklyClusterAudit(
      [session(8, [twoClusters('squat')]), session(1, [oneCluster('squat')], 'active')],
      catalog,
      NOW,
    );
    expect(audit.clusters).toBe(0);
  });

  it('an ungrouped activation is one cluster; an unperformed activation is none', () => {
    expect(clustersInExercise([{ kind: 'activation', reps: 10 }, { kind: 'mini', reps: 4 }])).toBe(1);
    expect(clustersInExercise([{ kind: 'activation', group: 1 }, { kind: 'activation', group: 2, reps: 9 }])).toBe(1);
  });
});
