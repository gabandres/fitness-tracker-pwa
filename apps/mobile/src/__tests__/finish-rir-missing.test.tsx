/**
 * Blank RIRs at Finish (owner, 2026-10-15, item 4).
 *
 * The 10/13 fix read a blank RIR as 0 and put "RIR missing — enter it?" under
 * the row — per row, non-blocking, gone once saved. Whole lifts still saved
 * blank: Incline DB Curl 45° on 10/14 and Deficit Push-up on 10/15, all three
 * rows each, with every other lift complete. No path that ticks a set asks
 * for an RIR (in the app or the Lock Screen's "Done set"), and nothing at
 * Finish looked. These fail on that code: there was no list, no question, and
 * `finishWorkout` ran with the blanks in place.
 */
import React from 'react';
import { ActionSheetIOS } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession } from '@/lib/workout';

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));

import { TrainFinishSheet } from '@/components/train/FinishSheet';

type AskOpts = { title?: string; message?: string; options: string[] };
let asked: AskOpts | null = null;
let answer: (i: number) => void = () => {};
beforeEach(() => {
  asked = null;
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((o, cb) => {
    asked = o as AskOpts;
    answer = cb;
  });
});
afterEach(() => jest.restoreAllMocks());

const day = new Date(2026, 9, 14, 7, 22);
const sets = (rir: number | undefined) =>
  [16, 4, 4].map((reps, i) => ({ kind: i === 0 ? 'activation' : 'mini', group: 1, weight: 15, reps, done: true, ...(rir != null ? { rir } : {}) }));

/** The 10/14 Pull Day tail, as stored: the flye complete, the curl blank. */
function makeTrain(curlRir: number | undefined, catalog: object[] = [], flyeRir: number | null = 0) {
  const session = {
    id: 'live', status: 'active', date: day, templateName: 'Pull Day',
    exercises: [
      { exerciseId: 'flye', name: 'Rear delt DB flye', logStyle: 'weight-reps', cues: [], sets: sets(flyeRir ?? undefined) },
      { exerciseId: 'curl', name: 'Incline DB Curl 45°', logStyle: 'weight-reps', cues: [], sets: sets(curlRir) },
    ],
  } as unknown as WorkoutSession;
  return {
    active: session,
    editingExisting: false,
    templates: [],
    recentSessions: [] as WorkoutSession[],
    catalog: catalog as never,
    trainingPhase: 'cut' as const,
    finishWorkout: jest.fn().mockResolvedValue(true),
    dispatch: jest.fn().mockResolvedValue(undefined),
    commitActive: jest.fn().mockResolvedValue(undefined),
  };
}

async function open(train: ReturnType<typeof makeTrain>) {
  const ui = await render(<TrainFinishSheet train={train} visible onClose={() => {}} />);
  await waitFor(() => expect(ui.getByTestId('finish-confirm')).toBeTruthy());
  return ui;
}

const rirPatches = (train: ReturnType<typeof makeTrain>) =>
  train.dispatch.mock.calls.map(([a]) => a as { exerciseIndex: number; setIndex: number; patch: { rir?: number } })
    .filter((a) => a.patch.rir != null)
    .map((a) => [a.exerciseIndex, a.setIndex, a.patch.rir]);

describe('Finish with blank RIRs', () => {
  it('names the lift and how many sets, with a Set to 0 for a failure lift', async () => {
    const train = makeTrain(undefined);
    const ui = await open(train);
    expect(ui.getByTestId('finish-rir-missing')).toHaveTextContent('Incline DB Curl 45°', { exact: false });
    expect(ui.getByTestId('finish-rir-missing')).toHaveTextContent('3 sets without RIR', { exact: false });
    expect(ui.getByTestId('finish-rir-missing')).not.toHaveTextContent('Rear delt', { exact: false });
    expect(ui.getByTestId('finish-rir-zero-1')).toHaveTextContent('Set to 0');
    await fireEvent.press(ui.getByTestId('finish-rir-zero-1'));
    expect(rirPatches(train)).toEqual([[1, 0, 0], [1, 1, 0], [1, 2, 0]]);
  });

  it('Complete asks first; "Set to 0 and finish" writes the zeros BEFORE the workout is saved', async () => {
    const train = makeTrain(undefined);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(asked).not.toBeNull());
    expect(asked!.title).toBe('3 sets have no RIR');
    expect(train.finishWorkout).not.toHaveBeenCalled();
    answer(0);
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalled());
    expect(rirPatches(train)).toEqual([[1, 0, 0], [1, 1, 0], [1, 2, 0]]);
    expect(train.dispatch.mock.invocationCallOrder[0]).toBeLessThan(train.finishWorkout.mock.invocationCallOrder[0]);
  });

  // Program v2.1: the offer is the lift's TARGET RIR, not always 0 — on the
  // first set of each cluster; a mini-set stays 0 (Lift settings' rule).
  it('a RIR 1 lift is offered "Set to 1": its activation gets 1, its mini-sets 0', async () => {
    const train = makeTrain(undefined, [{ id: 'curl', name: 'Incline DB Curl 45°', muscles: ['biceps'], effortStandard: 'rir1' }]);
    const ui = await open(train);
    expect(ui.getByTestId('finish-rir-zero-1')).toHaveTextContent('Set to 1');
    await fireEvent.press(ui.getByTestId('finish-rir-zero-1'));
    expect(rirPatches(train)).toEqual([[1, 0, 1], [1, 1, 0], [1, 2, 0]]);
  });

  it('one target for every lift reads "Set to 1 and finish"', async () => {
    const train = makeTrain(undefined, [{ id: 'curl', name: 'Incline DB Curl 45°', muscles: ['biceps'], effortStandard: 'rir1' }]);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(asked).not.toBeNull());
    expect(asked!.options[0]).toBe('Set to 1 and finish');
  });

  it('mixed targets name each lift\'s and fill each with its own', async () => {
    const train = makeTrain(undefined, [{ id: 'curl', name: 'Incline DB Curl 45°', muscles: ['biceps'], effortStandard: 'rir1' }], null);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(asked).not.toBeNull());
    expect(asked!.options[0]).toBe('Set to targets and finish');
    expect(asked!.message).toContain('Rear delt DB flye · 3 → RIR 0');
    expect(asked!.message).toContain('Incline DB Curl 45° · 3 → RIR 1');
    answer(0);
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalled());
    expect(rirPatches(train)).toEqual([[0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 1], [1, 1, 0], [1, 2, 0]]);
  });

  it('"Leave blank" is a choice: it saves without writing any RIR', async () => {
    const train = makeTrain(undefined);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(asked).not.toBeNull());
    answer(1);
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalled());
    expect(rirPatches(train)).toEqual([]);
  });

  it('a session with every RIR in place shows nothing and asks nothing', async () => {
    const train = makeTrain(0);
    const ui = await open(train);
    expect(ui.queryByTestId('finish-rir-missing')).toBeNull();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalled());
    expect(asked).toBeNull();
  });
});

/** Zone 2 RPE is REQUIRED to save (owner, 2026-10-15): no default to offer,
 *  so Complete refuses until it is picked in the sheet. */
describe('Finish with a Zone 2 block and no RPE', () => {
  const withZone2 = (rpe?: number) => {
    const train = makeTrain(0);
    train.active = {
      ...train.active,
      cardio: [{ modality: 'run', label: 'Zone 2', durationSec: 1200, source: 'manual', ...(rpe != null ? { rpe } : {}) }],
    } as unknown as WorkoutSession;
    return train;
  };

  it('Complete does not save, and says why', async () => {
    const train = withZone2();
    const ui = await open(train);
    expect(ui.getByTestId('finish-zone2-rpe')).toHaveTextContent('Zone 2 effort is required', { exact: false });
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    expect(ui.getByTestId('finish-save-error')).toHaveTextContent('Pick the Zone 2 effort (RPE) above to save.');
    expect(train.finishWorkout).not.toHaveBeenCalled();
  });

  it('a chip writes that RPE onto the block', async () => {
    const train = withZone2();
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-rpe-0-3'));
    expect(train.dispatch).toHaveBeenCalledWith({ type: 'patchCardio', blockIndex: 0, patch: { rpe: 3 } }, { defer: true });
  });

  // Program v2.1: an average HR over the band is said at save, never blocking.
  it('avg HR over the band: "Above Zone 2 — slow down next time", and it still saves', async () => {
    const train = withZone2(3);
    train.active = { ...train.active, cardio: [{ ...train.active.cardio![0], avgHr: 136 }] } as unknown as WorkoutSession;
    const ui = await open(train);
    expect(ui.getByTestId('finish-above-zone2')).toHaveTextContent('Above Zone 2 — slow down next time', { exact: false });
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalled());
  });

  it('in band: no line', async () => {
    const train = withZone2(3);
    train.active = { ...train.active, cardio: [{ ...train.active.cardio![0], avgHr: 126 }] } as unknown as WorkoutSession;
    const ui = await open(train);
    expect(ui.queryByTestId('finish-above-zone2')).toBeNull();
  });

  it('with an RPE in place it saves as usual', async () => {
    const train = withZone2(4);
    const ui = await open(train);
    expect(ui.queryByTestId('finish-zone2-rpe')).toBeNull();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalled());
  });
});
