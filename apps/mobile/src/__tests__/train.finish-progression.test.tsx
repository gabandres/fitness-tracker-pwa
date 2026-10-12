/**
 * The finish sheet's "Next session" calls, and the one rule about them that
 * matters most: a template's load NEVER moves without the lifter's say-so.
 *
 * With "Auto-apply progression" off (the default — absent is off), Complete
 * asks once when any lift's box is ticked (train-ux F2) — "Update and
 * complete" writes the ticked moves AFTER the workout is recorded, "Complete
 * only" leaves the template untouched. With it on, Complete applies every
 * proposed move as the engine's, and there is nothing to answer. Either way the write goes
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
  it('Complete asks once; "Complete only" leaves the template untouched', async () => {
    const train = makeTrain(undefined);
    const ui = await open(train);
    expect(ui.queryByTestId('finish-auto-apply')).toBeNull();
    // No separate Apply button any more (train-ux F2): Complete asks.
    expect(ui.queryByTestId('finish-apply')).toBeNull();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(ui.getByText('Update Push A?')).toBeTruthy());
    expect(ui.getByText('Press: 100 lb → 105 lb')).toBeTruthy();
    // Nothing is recorded while the question is open.
    expect(train.finishWorkout).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByTestId('confirm-secondary'));
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalledTimes(1));
    expect(train.saveTemplate).not.toHaveBeenCalled();
  });

  it('"Update and complete" records the workout FIRST, then writes the template whole with the engine entry', async () => {
    const order: string[] = [];
    const train = makeTrain(false);
    train.finishWorkout.mockImplementation(async () => { order.push('finish'); return true; });
    train.saveTemplate.mockImplementation(async () => { order.push('save'); });
    const ui = await open(train);
    expect(train.saveTemplate).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('confirm-go')));
    await waitFor(() => expect(train.saveTemplate).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['finish', 'save']);
    const [draft, id] = train.saveTemplate.mock.calls[0] as unknown as [WorkoutTemplate, string];
    expect(id).toBe('t1');
    expect((draft as { id?: string }).id).toBeUndefined();
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
  });

  it('a failed finish writes nothing, even after "Update and complete"', async () => {
    const train = makeTrain(false);
    train.finishWorkout.mockResolvedValue(false);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('confirm-go')));
    await waitFor(() => expect(ui.getByTestId('finish-save-error')).toBeTruthy());
    expect(train.saveTemplate).not.toHaveBeenCalled();
  });

  it('a lift switched off is not offered — with nothing ticked, Complete does not ask', async () => {
    const train = makeTrain(false);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-toggle-press'));
    expect(ui.getByTestId('finish-toggle-press').props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.finishWorkout).toHaveBeenCalledTimes(1));
    expect(ui.queryByText('Update Push A?')).toBeNull();
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

describe('Program v2: the one automatic switch runs AFTER the progression write, with its loads', () => {
  it('auto-apply on: the template write lands first, then the switch gets the applied rows and this session', async () => {
    const order: string[] = [];
    let release!: () => void;
    const train = {
      ...makeTrain(true),
      saveTemplate: jest.fn(() => new Promise<void>((r) => { release = () => { order.push('save'); r(); }; })),
      maybeAutoSwitchProgram: jest.fn(async () => { order.push('switch'); return true; }),
    };
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(train.saveTemplate).toHaveBeenCalledTimes(1));
    // The switch waits for the write.
    expect(train.maybeAutoSwitchProgram).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(train.maybeAutoSwitchProgram).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['save', 'switch']);
    const [s, live] = train.maybeAutoSwitchProgram.mock.calls[0] as unknown as [WorkoutSession, WorkoutTemplate];
    expect(s.id).toBe('live');
    expect(live.exercises[0].targetLoad).toBe(105);
  });

  it('auto-apply off, "Complete only": the switch is asked with the template as it stands', async () => {
    const train = { ...makeTrain(false), maybeAutoSwitchProgram: jest.fn().mockResolvedValue(false) };
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('confirm-secondary')));
    await waitFor(() => expect(train.maybeAutoSwitchProgram).toHaveBeenCalledTimes(1));
    expect(train.saveTemplate).not.toHaveBeenCalled();
    expect((train.maybeAutoSwitchProgram.mock.calls[0] as unknown as [WorkoutSession, WorkoutTemplate])[1].exercises[0].targetLoad).toBe(100);
  });
});
