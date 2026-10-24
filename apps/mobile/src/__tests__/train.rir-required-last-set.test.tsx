/**
 * RIR REQUIRED on the last working set (S-v2 training, 2026-10-24).
 *
 * On a straight-set lift held to a target RIR (`rir1` / `rir2`), the last
 * working set's RIR is the one number the engine's read cannot do without — a
 * blank reads as 0 and the lift looks two reps worse than it was. So:
 * (a) ticking that set with no RIR opens the quick 0–5 picker (the set sheet
 *     in `rirOnly` mode — no kinds, no "No RIR", no Remove);
 * (b) Finish will not complete with it blank — no "Leave blank" for it; the
 *     sheet asks for it with 0–5 chips. Other blank RIRs keep the old,
 *     non-blocking question. The rule is core's (`rir-required.ts`).
 */
import React from 'react';
import { ActionSheetIOS } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { ExerciseCardProps } from '@/components/train/ExerciseCard';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));

import { ExerciseCard } from '@/components/train/ExerciseCard';
import { TrainFinishSheet } from '@/components/train/FinishSheet';
import { SetRowSheet } from '@/components/train/SetRowSheet';

const row = {
  exerciseId: 'lat',
  name: 'Lat Pulldown',
  setStructure: 'straight',
  plannedSets: [1, 2, 3].map(() => ({ kind: 'working', reps: 10, repsMax: 12 })),
  progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 },
} as unknown as TemplateExercise;
const catalogWith = (effortStandard: string) =>
  [{ id: 'lat', name: 'Lat Pulldown', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', effortStandard, createdAt: new Date(0) }] as unknown as Exercise[];

describe('(a) ticking the last working set with no RIR opens the quick picker', () => {
  const lift = (): SessionExercise =>
    ({
      exerciseId: 'lat', name: 'Lat Pulldown', logStyle: 'weight-reps', cues: [],
      sets: [
        { kind: 'working', weight: 60, reps: 12, done: true, rir: 2 },
        { kind: 'working', weight: 60, reps: 12, done: true, rir: 2 },
        { kind: 'working', weight: 60, reps: 11 },
      ],
    }) as SessionExercise;

  async function mount(props: Partial<ExerciseCardProps> = {}, catalog = catalogWith('rir2')) {
    const onOpenSetSheet = jest.fn();
    const noop = () => {};
    const ui = await render(
      <ExerciseCard
        exercise={lift()}
        exerciseIndex={0}
        collapsed={false}
        recentSessions={[]}
        catalog={catalog}
        templateRow={row}
        platesOpen={false}
        largeText={false}
        dispatch={jest.fn().mockResolvedValue(undefined)}
        commitActive={jest.fn().mockResolvedValue(undefined)}
        chain={{ register: noop, next: noop, prev: noop } as never}
        onToggle={noop}
        onOpenMenu={noop}
        onOpenSetSheet={onOpenSetSheet}
        onOpenLift={noop}
        onSetDone={noop}
        onRemoveSet={noop}
        {...props}
      />,
    );
    return { ui, onOpenSetSheet };
  }

  it('rir2 straight lift: the tick on set 3 asks for its RIR', async () => {
    const { ui, onOpenSetSheet } = await mount();
    await fireEvent.press(ui.getByTestId('set-done-0-2'));
    expect(onOpenSetSheet).toHaveBeenCalledWith(0, 2, { rirOnly: true });
    // …and the lift shows the RIR column, so the value has a cell.
    expect(ui.getByTestId('set-head-rir-0', { includeHiddenElements: true })).toBeTruthy();
  });

  it('not on a failure lift, and not in a deload', async () => {
    const failure = await mount({}, catalogWith('failure'));
    await fireEvent.press(failure.ui.getByTestId('set-done-0-2'));
    expect(failure.onOpenSetSheet).not.toHaveBeenCalled();
    const deload = await mount({ deload: true });
    await fireEvent.press(deload.ui.getByTestId('set-done-0-2'));
    expect(deload.onOpenSetSheet).not.toHaveBeenCalled();
  });

  it('the quick picker is the 0–5 scale only: no set kinds, no "No RIR", no Remove', async () => {
    const onRir = jest.fn();
    const ui = await render(
      <SetRowSheet
        visible
        set={{ kind: 'working', weight: 60, reps: 11, done: true }}
        label="3"
        rirOnly
        onClose={() => {}}
        onKind={() => {}}
        onRir={onRir}
        onRemove={() => {}}
      />,
    );
    expect(ui.getByText('Set 3 — RIR')).toBeTruthy();
    expect(ui.queryByTestId('set-sheet-kind-working')).toBeNull();
    expect(ui.queryByTestId('set-sheet-rir-none')).toBeNull();
    expect(ui.queryByTestId('set-sheet-remove')).toBeNull();
    for (const n of [0, 1, 2, 3, 4, 5]) expect(ui.getByTestId(`set-sheet-rir-${n}`)).toBeTruthy();
    await fireEvent.press(ui.getByTestId('set-sheet-rir-2'));
    expect(onRir).toHaveBeenCalledWith(2);
  });
});

describe('(b) Finish: the last set\'s RIR is required', () => {
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

  const template = { id: 'tpl', name: 'Pull', exercises: [row], createdAt: new Date(0), updatedAt: new Date(0) } as unknown as WorkoutTemplate;
  function makeTrain(lastRir: number | null, firstRir: number | null = 2, effort = 'rir2') {
    const session = {
      id: 'live', status: 'active', date: new Date(2026, 9, 24, 7), templateId: 'tpl', templateName: 'Pull',
      exercises: [{
        exerciseId: 'lat', name: 'Lat Pulldown', logStyle: 'weight-reps', cues: [],
        sets: [
          { kind: 'working', weight: 60, reps: 12, done: true, ...(firstRir != null ? { rir: firstRir } : {}) },
          { kind: 'working', weight: 60, reps: 12, done: true, rir: 2 },
          { kind: 'working', weight: 60, reps: 11, done: true, ...(lastRir != null ? { rir: lastRir } : {}) },
        ],
      }],
    } as unknown as WorkoutSession;
    return {
      active: session,
      editingExisting: false,
      templates: [template],
      recentSessions: [] as WorkoutSession[],
      catalog: catalogWith(effort),
      trainingPhase: 'cut' as const,
      finishWorkout: jest.fn().mockResolvedValue(true),
      dispatch: jest.fn().mockResolvedValue(undefined),
      commitActive: jest.fn().mockResolvedValue(undefined),
      saveTemplate: jest.fn().mockResolvedValue(undefined),
    };
  }
  async function open(train: ReturnType<typeof makeTrain>) {
    const ui = await render(<TrainFinishSheet train={train as never} visible onClose={() => {}} />);
    await waitFor(() => expect(ui.getByTestId('finish-confirm')).toBeTruthy());
    return ui;
  }

  it('blank last set: Complete refuses and says why — no "Leave blank" offered', async () => {
    const train = makeTrain(null);
    const ui = await open(train);
    expect(ui.getByTestId('finish-rir-required')).toHaveTextContent('Lat Pulldown', { exact: false });
    expect(ui.getByTestId('finish-rir-required')).toHaveTextContent('set 3, target RIR 2', { exact: false });
    // Not listed in the non-blocking section, where "Leave blank" lives.
    expect(ui.queryByTestId('finish-rir-missing')).toBeNull();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    expect(ui.getByTestId('finish-save-error')).toHaveTextContent("Pick the RIR of each lift's last set above to save.");
    expect(asked).toBeNull();
    expect(train.finishWorkout).not.toHaveBeenCalled();
  });

  it('a 0–5 chip writes that RIR onto the last set', async () => {
    const train = makeTrain(null);
    const ui = await open(train);
    await fireEvent.press(ui.getByTestId('finish-rir-required-0-1'));
    expect(train.dispatch).toHaveBeenCalledWith({ type: 'patchSet', exerciseIndex: 0, setIndex: 2, patch: { rir: 1 } }, { defer: true });
    expect(train.commitActive).toHaveBeenCalled();
  });

  it('other blank sets stay non-blocking: the old question, with Leave blank', async () => {
    const train = makeTrain(2, null);
    const ui = await open(train);
    expect(ui.queryByTestId('finish-rir-required')).toBeNull();
    expect(ui.getByTestId('finish-rir-missing')).toHaveTextContent('1 set without RIR', { exact: false });
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(asked).not.toBeNull());
    expect(asked!.title).toBe('1 set has no RIR');
    expect(asked!.options).toContain('Leave blank');
    expect(ui.queryByTestId('finish-save-error')).toBeNull();
  });

  it('a failure lift is never required', async () => {
    const train = makeTrain(null, 0, 'failure');
    const ui = await open(train);
    expect(ui.queryByTestId('finish-rir-required')).toBeNull();
  });
});
