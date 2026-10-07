/**
 * The engine on the live card (2026-10-07): the note shows load, "Target:
 * ≥ N reps" and one line of reason; its Accept is offered when the call's
 * load differs from what the sets were seeded with; set rows read a
 * cluster's label ("La", "Ra") where it has one; and the extras the engine
 * reads beyond the log (volume, stall facts) reach it without breaking the
 * per-exercise memo.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { Recommendation } from '@macrolog/core';
import type { SessionExercise, WorkoutSession } from '@/lib/workout';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { RecommendationNote } from '@/components/train/RecommendationNote';
import { ExerciseCard } from '@/components/train/ExerciseCard';
import { recentSleepHours, recommendationFor } from '@/components/train/train-summary';

const hold25: Recommendation = {
  action: 'repeat-invalid', load: 25, currentLoad: 25, last: [], assisted: false, approximate: false, warnings: [],
  reason: { kind: 'invalid', reason: 'first-mini-too-many', firstMini: 9 },
};

describe('RecommendationNote — Accept', () => {
  it('offers the load when it differs from the seeded one (10/6: "Repeat 25" over sets at 30)', async () => {
    const onAccept = jest.fn();
    const ui = await render(<RecommendationNote rec={hold25} seededLoad={30} onAccept={onAccept} testID="rec" />);
    await fireEvent.press(ui.getByTestId('rec-accept'));
    expect(onAccept).toHaveBeenCalledWith(25);
  });

  it('a hold at the seeded load is a sentence, not a chip', async () => {
    const ui = await render(<RecommendationNote rec={hold25} seededLoad={25} onAccept={jest.fn()} testID="rec" />);
    expect(ui.queryByTestId('rec-accept')).toBeNull();
  });

  it('shows the target and the one-line reason', async () => {
    const rec: Recommendation = {
      action: 'hold', load: 100, currentLoad: 100, last: [], assisted: false, approximate: false, warnings: [],
      targetReps: 11, reason: { kind: 'below-max', reps: 10, max: 12, clusters: 1 },
    };
    const ui = await render(<RecommendationNote rec={rec} testID="rec" />);
    expect(ui.getByText('100 lb · HOLD')).toBeTruthy();
    expect(ui.getByTestId('rec-target').props.children).toBe('Target: ≥ 11 reps');
    expect(ui.getByTestId('rec-reason').props.children).toBe(
      '10 reps — under the top of the range (12). Same load, one more rep.',
    );
  });
});

describe('set rows read the cluster label', () => {
  it('"La, Lb, Ra, Rb" for a single-leg lift labelled L / R', async () => {
    const noop = () => {};
    const ex = {
      exerciseId: 'e1',
      name: 'Split Squat',
      logStyle: 'weight-reps',
      cues: [],
      sets: [
        { kind: 'activation', group: 1, label: 'L' },
        { kind: 'mini', group: 1, label: 'L' },
        { kind: 'activation', group: 2, label: 'R' },
        { kind: 'mini', group: 2, label: 'R' },
        { kind: 'working' },
      ],
    } as SessionExercise;
    const ui = await render(
      <ExerciseCard
        exercise={ex}
        exerciseIndex={0}
        collapsed={false}
        recentSessions={[]}
        catalog={[]}
        templateRow={undefined}
        platesOpen={false}
        largeText={false}
        dispatch={jest.fn().mockResolvedValue(undefined)}
        commitActive={jest.fn().mockResolvedValue(undefined)}
        chain={{ register: noop, next: noop, prev: noop } as never}
        onToggle={noop}
        onOpenMenu={noop}
        onOpenSetSheet={noop}
        onOpenLift={noop}
        onSetDone={noop}
        onRemoveSet={noop}
      />,
    );
    const labels = [0, 1, 2, 3, 4].map((i) => ui.getByTestId(`set-kind-0-${i}`).props.accessibilityLabel as string);
    expect(labels[0]).toMatch(/\bLa\b/);
    expect(labels[1]).toMatch(/\bLb\b/);
    expect(labels[2]).toMatch(/\bRa\b/);
    expect(labels[3]).toMatch(/\bRb\b/);
    // The number is consumed either way: the straight set after them is 3.
    expect(labels[4]).toMatch(/\b3\b/);
    expect(ui.getByText('La')).toBeTruthy();
  });
});

describe('the engine extras', () => {
  const s = (sleepHours?: number, status: WorkoutSession['status'] = 'completed') =>
    ({ status, date: new Date(), exercises: [], ...(sleepHours != null ? { sleepHours } : {}) }) as unknown as WorkoutSession;

  it('sleep is the average of the last three completed sessions that logged it', () => {
    expect(recentSleepHours([s(6), s(), s(7, 'active'), s(8), s(7), s(4)])).toBe(7);
    expect(recentSleepHours([s(), s()])).toBeUndefined();
  });

  it('recommendationFor reuses its answer for equal extras and recomputes for different ones', () => {
    const ex = { exerciseId: 'e1', name: 'X', cues: [], sets: [] } as unknown as SessionExercise;
    const data = { recentSessions: [] as WorkoutSession[], catalog: [] };
    const a = recommendationFor(data, 'e1', undefined, ex, { volumeAllowsCluster: true, stallContext: { sleepHours: 6 } });
    // A fresh extras object with the same values is the same question.
    expect(recommendationFor(data, 'e1', undefined, ex, { volumeAllowsCluster: true, stallContext: { sleepHours: 6 } })).toBe(a);
    expect(recommendationFor(data, 'e1', undefined, ex, { volumeAllowsCluster: false })).not.toBe(a);
  });
});
