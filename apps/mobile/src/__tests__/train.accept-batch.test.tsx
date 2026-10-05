import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { SessionExercise } from '@/lib/workout';

/**
 * Accepting the engine's load writes the session ONCE (Train re-score bug 9).
 *
 * The accepted load lands on every working set with no weight yet. Each of
 * those used to be an immediate dispatch — one whole-session write per set for
 * a single tap. Now each patch is deferred and one commit follows.
 *
 * The engine's call itself is core's and tested there; here it is pinned to
 * "has a call" so the card shows the accept, and the note is reduced to the
 * one button under test.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/train/train-summary', () => ({
  ...jest.requireActual('@/components/train/train-summary'),
  recommendationFor: () => ({ action: 'add-load' }),
}));
jest.mock('@/components/train/RecommendationNote', () => {
  const { TouchableOpacity, Text } = require('react-native');
  return {
    RecommendationNote: ({ onAccept }: { onAccept?: (load: number) => void }) => (
      <TouchableOpacity testID="accept-load" onPress={() => onAccept?.(135)}>
        <Text>accept</Text>
      </TouchableOpacity>
    ),
  };
});

import { ExerciseCard } from '@/components/train/ExerciseCard';

const exercise: SessionExercise = {
  exerciseId: 'e1',
  name: 'Bench',
  logStyle: 'weight-reps',
  cues: [],
  sets: [
    { kind: 'warmup', weight: 45, reps: 10 },
    { kind: 'working' },
    { kind: 'working', weight: 125 },
    { kind: 'working' },
  ],
} as SessionExercise;

it('defers one patch per empty working set, then commits once', async () => {
  const dispatch = jest.fn().mockResolvedValue(undefined);
  const commitActive = jest.fn().mockResolvedValue(undefined);
  const noop = () => {};
  const ui = await render(
    <ExerciseCard
      exercise={exercise}
      exerciseIndex={0}
      collapsed={false}
      recentSessions={[]}
      catalog={[]}
      templateRow={undefined}
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
    />,
  );
  await fireEvent.press(ui.getByTestId('accept-load'));
  expect(dispatch).toHaveBeenCalledTimes(2);
  for (const [action, opts] of dispatch.mock.calls) {
    expect(action).toEqual(expect.objectContaining({ type: 'patchSet', patch: { weight: 135 } }));
    expect(opts).toEqual({ defer: true });
  }
  expect(dispatch.mock.calls.map(([a]) => a.setIndex)).toEqual([1, 3]);
  expect(commitActive).toHaveBeenCalledTimes(1);
});
