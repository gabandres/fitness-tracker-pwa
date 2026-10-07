/**
 * The finish sheet's "Next session" calls, and the one rule about them that
 * matters most: a template's load NEVER moves without the lifter's say-so.
 *
 * With "Auto-apply progression" off (the default — absent is off), finishing
 * leaves the template untouched; only the Apply tap writes it, and only the
 * lifts left switched on. With it on, Complete applies every proposed move as
 * the engine's, and there is no button to tap. Either way the write goes
 * through the hook's `saveTemplate` with the template's `exercises` whole —
 * `loadLog` included, carrying the sentence the lifter read.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));

import { TrainFinishSheet } from '@/components/train/FinishSheet';

const day = (n: number) => new Date(2026, 9, n);
const cluster = (w: number, act: number, group: number) => [
  { kind: 'activation' as const, group, weight: w, reps: act, rir: 0, done: true },
  { kind: 'mini' as const, group, weight: w, reps: 3, rir: 0, done: true },
  { kind: 'mini' as const, group, weight: w, reps: 2, rir: 0, done: true },
];

const template: WorkoutTemplate = {
  id: 't1',
  name: 'Push A',
  exercises: [
    {
      exerciseId: 'press',
      name: 'Press',
      targetLoad: 100,
      plannedSets: [
        { kind: 'activation', group: 1, weight: 100 },
        { kind: 'mini', group: 1 },
        { kind: 'mini', group: 1 },
      ],
    },
    {
      exerciseId: 'row',
      name: 'Row',
      targetLoad: 80,
      plannedSets: [
        { kind: 'activation', group: 1 },
        { kind: 'mini', group: 1 },
        { kind: 'mini', group: 1 },
      ],
    },
  ],
  createdAt: day(1),
  updatedAt: day(1),
};

// Press: every cluster at 12 → INCREASE to 105. Row: 10 reps → HOLD at 80,
// which is the template's load already, so there is nothing to move.
const session = {
  id: 'live',
  status: 'active',
  date: day(7),
  templateId: 't1',
  templateName: 'Push A',
  exercises: [
    { exerciseId: 'press', name: 'Press', logStyle: 'weight-reps', cues: [], targetLoad: 100, sets: cluster(100, 12, 1) },
    { exerciseId: 'row', name: 'Row', logStyle: 'weight-reps', cues: [], targetLoad: 80, sets: cluster(80, 10, 1) },
  ],
} as unknown as WorkoutSession;

const catalog = [
  { id: 'press', name: 'Press', category: 'compound', muscles: ['chest'], defaultCues: [], createdAt: day(1) },
  { id: 'row', name: 'Row', category: 'compound', muscles: ['back'], defaultCues: [], createdAt: day(1) },
] as never;

function makeTrain(autoApplyProgression?: boolean) {
  return {
    active: session,
    editingExisting: false,
    templates: [template],
    recentSessions: [] as WorkoutSession[],
    catalog,
    trainingPhase: 'cut' as const,
    autoApplyProgression,
    finishWorkout: jest.fn().mockResolvedValue(true),
    saveTemplate: jest.fn().mockResolvedValue(undefined),
  };
}

async function open(train: ReturnType<typeof makeTrain>) {
  const ui = await render(<TrainFinishSheet train={train} visible onClose={() => {}} />);
  await waitFor(() => expect(ui.getByTestId('finish-confirm')).toBeTruthy());
  return ui;
}

describe('finish sheet — the engine calls, read with this session as the newest', () => {
  it('lists each lift with its call, new load, expectation and reason', async () => {
    const ui = await open(makeTrain());
    expect(ui.getByTestId('finish-call-press-headline').props.children).toBe('105 lb · INCREASE');
    expect(ui.getByText('Expected: about 10 reps at the new load — an estimate, not a guarantee.')).toBeTruthy();
    expect(ui.getByText('Every cluster at the top of the range (12; lowest 12). Next step 105 lb, +5%.')).toBeTruthy();
    expect(ui.getByTestId('finish-change-press').props.children).toBe('Template 100 lb → 105 lb');
    expect(ui.getByTestId('finish-call-row-headline').props.children).toBe('80 lb · HOLD');
    expect(ui.getByText('Target: ≥ 11 reps')).toBeTruthy();
    // A hold at the template's own load moves nothing: no toggle for it.
    expect(ui.queryByTestId('finish-toggle-row')).toBeNull();
    expect(ui.getByTestId('finish-toggle-press')).toBeTruthy();
  });
});

describe('auto-apply OFF (the default): the template moves only on the tap', () => {
  it('finishing leaves the template untouched', async () => {
    const train = makeTrain(undefined);
    const ui = await open(train);
    expect(ui.queryByTestId('finish-auto-apply')).toBeNull();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalledTimes(1));
    expect(train.saveTemplate).not.toHaveBeenCalled();
  });

  it('Apply writes the template whole, with the engine entry on the load log', async () => {
    const train = makeTrain(false);
    const ui = await open(train);
    expect(train.saveTemplate).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByTestId('finish-apply'));
    await waitFor(() => expect(train.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft, id] = train.saveTemplate.mock.calls[0];
    expect(id).toBe('t1');
    expect(draft.id).toBeUndefined();
    expect(draft.name).toBe('Push A');
    expect(draft.exercises).toHaveLength(2);
    const press = draft.exercises[0];
    expect(press.targetLoad).toBe(105);
    // The planned activation carried the old load explicitly; it moves too.
    expect(press.plannedSets[0].weight).toBe(105);
    expect(press.loadLog).toEqual([
      expect.objectContaining({
        from: 100,
        to: 105,
        by: 'engine',
        reason: 'Every cluster at the top of the range (12; lowest 12). Next step 105 lb, +5%.',
      }),
    ]);
    // The row that did not move is written back as it was.
    expect(draft.exercises[1]).toEqual(template.exercises[1]);
    await waitFor(() => expect(ui.getByTestId('finish-applied')).toBeTruthy());
  });

  it('a lift switched off is not applied', async () => {
    const train = makeTrain(false);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-toggle-press'));
    expect(ui.getByTestId('finish-apply').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(ui.getByTestId('finish-apply'));
    expect(train.saveTemplate).not.toHaveBeenCalled();
  });
});

describe('auto-apply ON: Complete applies every proposed move as the engine', () => {
  it('says so, offers no button, and writes the template on finish', async () => {
    const train = makeTrain(true);
    const ui = await open(train);
    expect(ui.getByTestId('finish-auto-apply')).toBeTruthy();
    expect(ui.queryByTestId('finish-apply')).toBeNull();
    expect(train.saveTemplate).not.toHaveBeenCalled();

    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.saveTemplate).toHaveBeenCalledTimes(1));
    expect(train.finishWorkout).toHaveBeenCalledTimes(1);
    const [draft, id] = train.saveTemplate.mock.calls[0];
    expect(id).toBe('t1');
    expect(draft.exercises[0].targetLoad).toBe(105);
    expect(draft.exercises[0].loadLog).toEqual([expect.objectContaining({ from: 100, to: 105, by: 'engine' })]);
  });

  it('a failed finish applies nothing', async () => {
    const train = makeTrain(true);
    train.finishWorkout.mockResolvedValue(false);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(ui.getByTestId('finish-save-error')).toBeTruthy());
    expect(train.saveTemplate).not.toHaveBeenCalled();
  });
});
