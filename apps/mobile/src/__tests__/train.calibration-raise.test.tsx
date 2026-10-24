import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSession } from '@/lib/workout';

/**
 * The mid-session calibration prompt (S-v2 training, 2026-10-24). On the
 * first session of a new straight row, set 1 three or more past the top of
 * the range offers the engine's next real step for the rest of today's sets:
 * "Set 1 was 15 — raise to 65 lb now?". Raise writes the un-ticked working
 * sets through the same deferred `patchSet` + one commit an accepted call
 * uses; "Not now" hides it. The rule itself is core's (`calibrationRaise`).
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { ExerciseCard } from '@/components/train/ExerciseCard';

const row = {
  exerciseId: 'lat',
  name: 'Lat Pulldown',
  setStructure: 'straight',
  plannedSets: [1, 2, 3].map(() => ({ kind: 'working', reps: 10, repsMax: 12 })),
  progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 },
} as unknown as TemplateExercise;
const catalog = [
  { id: 'lat', name: 'Lat Pulldown', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'rir2', createdAt: new Date(0) },
] as unknown as Exercise[];

const live = (firstReps: number, done = true): SessionExercise =>
  ({
    exerciseId: 'lat',
    name: 'Lat Pulldown',
    logStyle: 'weight-reps',
    cues: [],
    sets: [
      { kind: 'working', weight: 60, reps: firstReps, done },
      { kind: 'working', weight: 60 },
      { kind: 'working', weight: 60 },
    ],
  }) as SessionExercise;

function card(ex: SessionExercise, recentSessions: WorkoutSession[] = [], extra: { deload?: boolean } = {}) {
  const dispatch = jest.fn().mockResolvedValue(undefined);
  const commitActive = jest.fn().mockResolvedValue(undefined);
  const noop = () => {};
  const ui = render(
    <ExerciseCard
      exercise={ex}
      exerciseIndex={0}
      collapsed={false}
      recentSessions={recentSessions}
      catalog={catalog}
      templateRow={row}
      platesOpen={false}
      largeText={false}
      dispatch={dispatch}
      commitActive={commitActive}
      chain={{ register: noop, next: noop, prev: noop } as never}
      onToggle={noop}
      onOpenMenu={noop}
      onOpenSetSheet={noop}
      onOpenLift={noop}
      onSetDone={noop}
      onRemoveSet={noop}
      {...extra}
    />,
  );
  return { ui, dispatch, commitActive };
}

it('asks to raise, and Raise writes the remaining working sets once', async () => {
  const { ui, dispatch, commitActive } = card(live(15));
  const u = await ui;
  expect(u.getByTestId('calibration-raise-0')).toHaveTextContent(/Set 1 was 15 — raise to 65 lb now\?/);
  await fireEvent.press(u.getByTestId('calibration-raise-apply-0'));
  expect(dispatch.mock.calls.map(([a, o]) => [a.type, a.setIndex, a.patch, o])).toEqual([
    ['patchSet', 1, { weight: 65 }, { defer: true }],
    ['patchSet', 2, { weight: 65 }, { defer: true }],
  ]);
  expect(commitActive).toHaveBeenCalledTimes(1);
});

it('Not now hides it', async () => {
  const u = await card(live(15)).ui;
  await fireEvent.press(u.getByTestId('calibration-raise-dismiss-0'));
  expect(u.queryByTestId('calibration-raise-0')).toBeNull();
});

it('silent at top + 2, before the tick, in a deload, and once the engine has a read', async () => {
  expect((await card(live(14)).ui).queryByTestId('calibration-raise-0')).toBeNull();
  expect((await card(live(15, false)).ui).queryByTestId('calibration-raise-0')).toBeNull();
  expect((await card(live(15), [], { deload: true }).ui).queryByTestId('calibration-raise-0')).toBeNull();
  const prior = {
    id: 's0', status: 'completed', date: new Date(Date.now() - 3 * 86_400_000),
    createdAt: new Date(), updatedAt: new Date(),
    exercises: [{ exerciseId: 'lat', name: 'Lat Pulldown', cues: [], sets: [{ kind: 'working', weight: 60, reps: 12, done: true }] }],
  } as unknown as WorkoutSession;
  expect((await card(live(15), [prior]).ui).queryByTestId('calibration-raise-0')).toBeNull();
});
