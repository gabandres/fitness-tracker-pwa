/**
 * The flat-reps warning (S-v2 training, 2026-10-24): a straight lift logged
 * with the same reps on every set and no RIR, two sessions running, gets
 * "Same reps on every set, no RIR, 2 sessions running — are these sets close
 * to RIR 2?" at the top of its card, with the lift's own target. The rule is
 * core's (`flatRepsWarning`).
 */
import React from 'react';
import { renderWithProviders as render } from '@/test-utils';
import type { ExerciseCardProps } from '@/components/train/ExerciseCard';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSession } from '@/lib/workout';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { ExerciseCard } from '@/components/train/ExerciseCard';

const row = {
  exerciseId: 'lat',
  name: 'Lat Pulldown',
  setStructure: 'straight',
  plannedSets: [1, 2, 3].map(() => ({ kind: 'working', reps: 10, repsMax: 12 })),
  progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 },
} as unknown as TemplateExercise;
const catalog = (effortStandard = 'rir2') =>
  [{ id: 'lat', name: 'Lat Pulldown', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', effortStandard, createdAt: new Date(0) }] as unknown as Exercise[];

const done = (daysAgo: number, reps: number[], rir?: number): WorkoutSession =>
  ({
    id: `s${daysAgo}`, status: 'completed', date: new Date(Date.now() - daysAgo * 86_400_000), createdAt: new Date(), updatedAt: new Date(),
    exercises: [{
      exerciseId: 'lat', name: 'Lat Pulldown', logStyle: 'weight-reps', cues: [],
      sets: reps.map((r) => ({ kind: 'working', weight: 60, reps: r, done: true, ...(rir != null ? { rir } : {}) })),
    }],
  }) as unknown as WorkoutSession;

const live = (rir?: number): SessionExercise =>
  ({
    exerciseId: 'lat', name: 'Lat Pulldown', logStyle: 'weight-reps', cues: [],
    sets: [{ kind: 'working', weight: 60, ...(rir != null ? { reps: 12, rir, done: true } : {}) }, { kind: 'working', weight: 60 }],
  }) as SessionExercise;

function mount(recentSessions: WorkoutSession[], props: Partial<ExerciseCardProps> = {}, cat = catalog()) {
  const noop = () => {};
  return render(
    <ExerciseCard
      exercise={live()}
      exerciseIndex={0}
      collapsed={false}
      recentSessions={recentSessions}
      catalog={cat}
      templateRow={row}
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
      {...props}
    />,
  );
}

it('shows at the top of the card with the lift’s own target RIR', async () => {
  const ui = await mount([done(2, [12, 12, 12]), done(5, [12, 12, 12])]);
  expect(ui.getByTestId('flat-reps-0')).toHaveTextContent(
    'Same reps on every set, no RIR, 2 sessions running — are these sets close to RIR 2?',
    { exact: false },
  );
  const rir1 = await mount([done(2, [10, 10]), done(5, [12, 12])], {}, catalog('rir1'));
  expect(rir1.getByTestId('flat-reps-0')).toHaveTextContent(/close to RIR 1\?/);
});

it('silent when the reps vary, when an RIR was logged, or with one session', async () => {
  expect((await mount([done(2, [12, 11, 10]), done(5, [12, 12, 12])])).queryByTestId('flat-reps-0')).toBeNull();
  expect((await mount([done(2, [12, 12, 12], 2), done(5, [12, 12, 12])])).queryByTestId('flat-reps-0')).toBeNull();
  expect((await mount([done(2, [12, 12, 12])])).queryByTestId('flat-reps-0')).toBeNull();
});

it('gone once today’s sets carry an RIR, and never in a deload', async () => {
  const sessions = [done(2, [12, 12, 12]), done(5, [12, 12, 12])];
  expect((await mount(sessions, { exercise: live(2) })).queryByTestId('flat-reps-0')).toBeNull();
  expect((await mount(sessions, { deload: true })).queryByTestId('flat-reps-0')).toBeNull();
});
