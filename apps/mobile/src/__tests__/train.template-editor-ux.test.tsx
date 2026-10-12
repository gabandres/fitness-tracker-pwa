import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * Template editor — the train-ux review's fixes (2026-10-11, T2/T5/T8/T13/T18).
 *
 * Removals come back with one tap (rubric R42/R44: a whole card's sets, cues
 * and progression used to go with one unconfirmed tap). Labels name the
 * object. The inherited load shows where the number goes. The adder picks
 * several at once and browses on focus.
 */

const mockShowToast = jest.fn();
const mockAnnounce = jest.fn();
const mockSaveTemplate = jest.fn().mockResolvedValue(undefined);
const mockAddLibraryExercise = jest.fn();

const mockTemplate: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  cardioBlocks: [{ modality: 'run', targetDurationSec: 600 }],
  exercises: [
    {
      exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', targetLoad: 170,
      plannedSets: [{ kind: 'working', reps: 8 }, { kind: 'working', reps: 8 }],
    },
    { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] },
  ],
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});
jest.mock('@/components/Toast', () => ({
  ...jest.requireActual('@/components/Toast'),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  announce: (...a: unknown[]) => mockAnnounce(...a),
  isScreenReaderOn: () => false,
}));
jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [
      { id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date('2026-07-01T00:00:00Z') },
      { id: 'e2', name: 'Row', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date('2026-07-01T00:00:00Z') },
      { id: 'e3', name: 'Curl', muscles: ['biceps'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date('2026-07-01T00:00:00Z') },
    ],
    templates: [mockTemplate],
    drafts: [],
    pendingLoadTestFor: () => null,
    editCatalogExercise: jest.fn(),
    recentSessions: [],
    active: null,
    editingExisting: false,
    saveTemplate: mockSaveTemplate,
    deleteTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    addCatalogExercise: jest.fn().mockResolvedValue('new-id'),
    addLibraryExercise: mockAddLibraryExercise,
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    reopenSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({
  tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn(), selection: jest.fn(),
}));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';

beforeEach(() => {
  mockShowToast.mockClear();
  mockAnnounce.mockClear();
  mockSaveTemplate.mockClear().mockResolvedValue(undefined);
  mockAddLibraryExercise.mockReset().mockResolvedValue({ id: 'lib-id', name: 'Barbell Bench Press', logStyle: 'weight-reps' });
});

async function openEditor() {
  const ui = await render(<TrainScreen />);
  await fireEvent.press(ui.getByTestId('edit-template-t1'));
  await waitFor(() => expect(ui.getByTestId('template-ex-toggle-0')).toBeTruthy());
  return ui;
}

/** The toast's Undo, run. */
function undoLastToast() {
  const opts = mockShowToast.mock.calls.at(-1)?.[1];
  expect(opts.action.label).toBe('Undo');
  opts.action.onPress();
}

async function savedDraft(ui: Awaited<ReturnType<typeof openEditor>>) {
  await fireEvent.press(ui.getByTestId('save-template'));
  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
  return mockSaveTemplate.mock.calls.at(-1)![0];
}

describe('removals come back (T5)', () => {
  it('removing an exercise names it and offers Undo, which restores it', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-more-0'));
    // The label names the object (T13).
    expect(ui.getByTestId('template-remove-0').props.accessibilityLabel).toBe('Remove exercise, Bench');
    await fireEvent.press(ui.getByTestId('template-remove-0'));
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toBe('Removed Bench');
    await waitFor(() => expect(ui.queryByTestId('template-ex-toggle-1')).toBeNull());
    expect(ui.getByTestId('template-ex-toggle-0').props.accessibilityLabel).toMatch(/^Row/);
    undoLastToast();
    await waitFor(() => expect(ui.getByTestId('template-ex-toggle-1')).toBeTruthy());
    const draft = await savedDraft(ui);
    expect(draft.exercises.map((e: { name: string }) => e.name)).toEqual(['Bench', 'Row']);
  });

  it('removing a set says which, and Undo puts it back', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    expect(ui.getByTestId('template-set-remove-0-1').props.accessibilityLabel).toBe('Remove set 2');
    await fireEvent.press(ui.getByTestId('template-set-remove-0-1'));
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toBe('Removed set 2');
    await waitFor(() => expect(ui.queryByTestId('template-set-reps-0-1')).toBeNull());
    undoLastToast();
    await waitFor(() => expect(ui.getByTestId('template-set-reps-0-1')).toBeTruthy());
  });

  it('removing a cardio block names it and offers Undo', async () => {
    const ui = await openEditor();
    // Template options are open by default: this template has cardio.
    expect(ui.getByTestId('template-cardio-remove-0').props.accessibilityLabel).toBe('Remove, Run');
    await fireEvent.press(ui.getByTestId('template-cardio-remove-0'));
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toBe('Removed Run');
    await waitFor(() => expect(ui.queryByTestId('template-cardio-remove-0')).toBeNull());
    undoLastToast();
    await waitFor(() => expect(ui.getByTestId('template-cardio-remove-0')).toBeTruthy());
  });
});

describe('Undo puts back only what it removed (fix R)', () => {
  it('an edit made while the toast is up survives Undo of an exercise removal', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-more-0'));
    await fireEvent.press(ui.getByTestId('template-remove-0'));
    await waitFor(() => expect(ui.queryByTestId('template-ex-toggle-1')).toBeNull());
    const undo = mockShowToast.mock.calls.at(-1)?.[1];
    expect(undo.testID).toBe('template-undo-toast');
    // Row is now card 0: give it a rep target during the toast window.
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.changeText(await waitFor(() => ui.getByTestId('template-set-reps-0-0')), '12');
    await act(async () => {
      undo.action.onPress();
    });
    await waitFor(() => expect(ui.getByTestId('template-ex-toggle-1')).toBeTruthy());
    const draft = await savedDraft(ui);
    expect(draft.exercises.map((e: { name: string }) => e.name)).toEqual(['Bench', 'Row']);
    expect(draft.exercises[1].plannedSets[0].reps).toBe(12);
  });

  it('an edit to another set survives Undo of a set removal', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-set-remove-0-1'));
    await waitFor(() => expect(ui.queryByTestId('template-set-reps-0-1')).toBeNull());
    const undo = mockShowToast.mock.calls.at(-1)?.[1];
    await fireEvent.changeText(ui.getByTestId('template-set-reps-0-0'), '5');
    await act(async () => {
      undo.action.onPress();
    });
    await waitFor(() => expect(ui.getByTestId('template-set-reps-0-1')).toBeTruthy());
    const draft = await savedDraft(ui);
    expect(draft.exercises[0].plannedSets.map((p: { reps?: number }) => p.reps)).toEqual([5, 8]);
  });

  it('an Undo still on screen after the editor closed does nothing to the next draft', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-more-0'));
    await fireEvent.press(ui.getByTestId('template-remove-0'));
    const staleUndo = mockShowToast.mock.calls.findLast((c) => c[0] === 'Removed Bench')?.[1];
    // Save closes the editor; open it again — a new editing session.
    await savedDraft(ui);
    await waitFor(() => expect(ui.queryByTestId('save-template')).toBeNull());
    await fireEvent.press(ui.getByTestId('edit-template-t1'));
    await waitFor(() => expect(ui.getByTestId('template-ex-toggle-1')).toBeTruthy());
    await act(async () => {
      staleUndo.action.onPress();
    });
    expect(ui.queryByTestId('template-ex-toggle-2')).toBeNull();
    mockSaveTemplate.mockClear();
    const draft = await savedDraft(ui);
    // Not a second Bench written into this draft.
    expect(draft.exercises.map((e: { name: string }) => e.name)).toEqual(['Bench', 'Row']);
  });
});

describe('the set table', () => {
  it('shows the inherited load where the number goes (T8) and uses the number pad for reps (T22)', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    const weight = ui.getByTestId('template-set-weight-0-0');
    expect(weight.props.value).toBe('');
    expect(weight.props.placeholder).toBe('170');
    expect(ui.getByTestId('template-set-reps-0-0').props.keyboardType).toBe('number-pad');
    // Weight keeps the decimal pad.
    expect(weight.props.keyboardType).toBe('numeric');
  });

  it('a saved template opens with its structure folded to one line (T6)', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    expect(ui.getByTestId('template-structure-compact-0')).toBeTruthy();
    expect(ui.queryByTestId('template-structure-0-straight')).toBeNull();
    expect(ui.getByText('Set structure: Auto')).toBeTruthy();
  });
});

describe('the header (T2)', () => {
  it('Save is in the header, and Delete is alone at the end, named', async () => {
    const ui = await openEditor();
    expect(ui.getByTestId('template-cancel')).toBeTruthy();
    expect(ui.getByTestId('delete-template').props.accessibilityLabel).toBe('Delete, Push Day');
    const draft = await savedDraft(ui);
    expect(draft.name).toBe('Push Day');
  });
});

describe('the adder (T18)', () => {
  it('browses the catalog on focus with nothing typed', async () => {
    const ui = await openEditor();
    expect(ui.queryByTestId('template-match-mine-0')).toBeNull();
    await fireEvent(ui.getByTestId('template-add-exercise'), 'focus');
    await waitFor(() => expect(ui.getByTestId('template-match-mine-0')).toBeTruthy());
  });

  it('picks several and adds them in the order ticked, library rows minted first', async () => {
    const ui = await openEditor();
    await fireEvent.changeText(ui.getByTestId('template-add-exercise'), 'Curl');
    await fireEvent.press(ui.getByTestId('template-match-mine-0-pick'));
    await fireEvent.changeText(ui.getByTestId('template-add-exercise'), 'Bench');
    await fireEvent.press(ui.getByTestId('template-match-lib-0-pick'));
    expect(ui.getByText('Add (2)')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('template-add-picked'));
    await waitFor(() => expect(mockAddLibraryExercise).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(ui.getByTestId('template-ex-toggle-3')).toBeTruthy());
    const draft = await savedDraft(ui);
    expect(draft.exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual(['e1', 'e2', 'e3', 'lib-id']);
  });

  it('a pick closes the keyboard, clears the query and folds the list, so the new card is not hidden (QA v2 item 4)', async () => {
    const rn = jest.requireActual('react-native');
    const dismiss = jest.spyOn(rn.Keyboard, 'dismiss');
    try {
      const ui = await openEditor();
      await fireEvent(ui.getByTestId('template-add-exercise'), 'focus');
      await fireEvent.changeText(ui.getByTestId('template-add-exercise'), 'Curl');
      await fireEvent.press(ui.getByTestId('template-match-mine-0'));
      expect(dismiss).toHaveBeenCalled();
      expect(ui.getByTestId('template-add-exercise').props.value).toBe('');
      expect(ui.queryByTestId('template-match-mine-0')).toBeNull();
      expect(ui.getByTestId('template-ex-toggle-2')).toBeTruthy();
    } finally {
      dismiss.mockRestore();
    }
  });

  it('"Add (n)" in multi-pick mode dismisses the same way; a tick alone does not', async () => {
    const rn = jest.requireActual('react-native');
    const dismiss = jest.spyOn(rn.Keyboard, 'dismiss');
    try {
      const ui = await openEditor();
      await fireEvent.changeText(ui.getByTestId('template-add-exercise'), 'Curl');
      await fireEvent.press(ui.getByTestId('template-match-mine-0-pick'));
      expect(dismiss).not.toHaveBeenCalled();
      await fireEvent.press(ui.getByTestId('template-add-picked'));
      await waitFor(() => expect(dismiss).toHaveBeenCalled());
      expect(ui.queryByTestId('template-match-mine-0')).toBeNull();
    } finally {
      dismiss.mockRestore();
    }
  });

  it('a single add is announced with its set count (T13)', async () => {
    const ui = await openEditor();
    await fireEvent.changeText(ui.getByTestId('template-add-exercise'), 'Curl');
    await fireEvent.press(ui.getByTestId('template-match-mine-0'));
    expect(mockAnnounce).toHaveBeenCalledWith('Curl added, 3 sets');
  });
});

describe('the starter sheet (H9/J4/T19)', () => {
  // Imported here so the screen-level mocks above stay in force.
  const { StarterTemplatesSheet } = jest.requireActual('@/components/train/StarterTemplatesSheet');
  const { STARTER_TEMPLATES } = jest.requireActual('@macrolog/core');

  it('leads with a plain split, tags the cluster one, and confirms the add with an Edit action', async () => {
    const clone = jest.fn().mockResolvedValue(undefined);
    const onEdit = jest.fn();
    const onClose = jest.fn();
    const cluster = STARTER_TEMPLATES.find((s: { key: string }) => s.key === 'chest-tri-sh-cluster');
    const templates: WorkoutTemplate[] = [];
    const ui = await render(
      <StarterTemplatesSheet visible train={{ templates, cloneStarterTemplate: clone }} onClose={onClose} onEditTemplate={onEdit} />,
    );
    const rows = ui.getAllByTestId(/^starter-row-/);
    expect(rows[0].props.testID).not.toBe('starter-row-chest-tri-sh-cluster');
    expect(rows.at(-1)!.props.testID).toBe('starter-row-chest-tri-sh-cluster');
    expect(ui.getByTestId('starter-advanced-chest-tri-sh-cluster')).toBeTruthy();
    expect(ui.getByTestId('starters-done')).toBeTruthy();
    // "+n" is its own Text beside the truncating names, so it is never cut off.
    const big = STARTER_TEMPLATES.find((x: { exercises: unknown[] }) => x.exercises.length > 3);
    expect(ui.getByTestId(`starter-more-${big.key}`)).toHaveTextContent(`+${big.exercises.length - 3}`);

    await fireEvent.press(ui.getByTestId(`use-starter-${cluster.key}`));
    await waitFor(() => expect(clone).toHaveBeenCalledWith(cluster));
    expect(onClose).toHaveBeenCalled();
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toMatch(/^Added .* to your templates$/);
    expect(mockAnnounce).toHaveBeenCalledWith(mockShowToast.mock.calls.at(-1)?.[0]);
    expect(mockShowToast.mock.calls.at(-1)?.[1].action.label).toBe('Edit');
  });
});

describe('final round (train-ux E-N3/N5/N6/N8/N10/N12)', () => {
  it('a failed save is said under the header, felt and spoken (E-N3)', async () => {
    const haptics = jest.requireMock('@/lib/haptics') as { warning: jest.Mock };
    haptics.warning.mockClear();
    mockSaveTemplate.mockRejectedValueOnce(new Error('denied'));
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('save-template'));
    const msg = "Couldn't save the template. Check your connection and try again.";
    await waitFor(() => expect(ui.getByTestId('template-save-error')).toHaveTextContent(msg));
    expect(haptics.warning).toHaveBeenCalled();
    expect(mockAnnounce).toHaveBeenCalledWith(msg);
  });

  it('browsing marks the lifts already in the template, and keeps them pickable (E-N5)', async () => {
    const ui = await openEditor();
    await fireEvent(ui.getByTestId('template-add-exercise'), 'focus');
    await waitFor(() => expect(ui.getByTestId('template-match-mine-0')).toBeTruthy());
    // Bench and Row are on cards; Curl is not.
    expect(ui.getByTestId('template-match-mine-0-in')).toHaveTextContent('In template');
    expect(ui.getByTestId('template-match-mine-1-in')).toBeTruthy();
    expect(ui.queryByTestId('template-match-mine-2-in')).toBeNull();
  });

  it('an unticked pick box draws no check mark (E-N12)', async () => {
    const ui = await openEditor();
    await fireEvent(ui.getByTestId('template-add-exercise'), 'focus');
    /** What the box (the tick's only child) draws inside it. */
    const marks = () => {
      const tick = ui.getByTestId('template-match-mine-2-pick') as unknown as { children: { children: unknown[] }[] };
      return tick.children[0].children.length;
    };
    await waitFor(() => expect(ui.getByTestId('template-match-mine-2-pick')).toBeTruthy());
    expect(marks()).toBe(0);
    await fireEvent.press(ui.getByTestId('template-match-mine-2-pick'));
    expect(marks()).toBe(1);
  });

  it("a declared card's kind picker leads with its own kinds and marks the rest (E-N6)", async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-structure-compact-0'));
    // The rows carry typed reps, so this declares without rescaffolding.
    await fireEvent.press(ui.getByTestId('template-structure-0-straight'));
    await fireEvent.press(ui.getByTestId('template-set-kind-0-0'));
    expect(ui.queryByTestId('template-set-kind-off-0-0-working')).toBeNull();
    expect(ui.getByTestId('template-set-kind-off-0-0-continuation')).toHaveTextContent('Not part of straight sets');
    // Still pickable.
    expect(ui.getByTestId('template-set-kind-0-0-continuation')).toBeTruthy();
  });

  it('blank rests show the rest the session will use (E-N8)', async () => {
    const ui = await openEditor();
    // Push Day prescribes cardio, so its options are open already.
    expect(ui.getByTestId('template-rest-mini').props.placeholder).toBe('60');
    expect(ui.getByTestId('template-rest-cluster').props.placeholder).toBe('120');
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-more-0'));
    expect(ui.getByTestId('template-rest-mini-0').props.placeholder).toBe('60');
  });

  it('Remove is two taps — open the card, Remove — and a screen reader reaches it from the handle (E-N10)', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    // No "More options" first.
    await fireEvent.press(ui.getByTestId('template-remove-0'));
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toBe('Removed Bench');
    await waitFor(() => expect(ui.queryByTestId('template-ex-toggle-1')).toBeNull());
    undoLastToast();
    await waitFor(() => expect(ui.getByTestId('template-ex-toggle-1')).toBeTruthy());
    await fireEvent(ui.getByTestId('template-drag-1'), 'accessibilityAction', { nativeEvent: { actionName: 'remove' } });
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toBe('Removed Row');
  });
});

describe('round 2 (train-ux S23-1/F1, S23-5/F8, S23-6/F10, F11)', () => {
  it('every card has visible move up / move down, named, disabled at the ends, and a move is said (S23-1, R24)', async () => {
    const ui = await openEditor();
    const up0 = ui.getByTestId('template-move-up-0');
    const down0 = ui.getByTestId('template-move-down-0');
    expect(up0.props.accessibilityLabel).toBe('Move Bench up');
    expect(down0.props.accessibilityLabel).toBe('Move Bench down');
    expect(up0).toBeDisabled();
    expect(down0).not.toBeDisabled();
    expect(ui.getByTestId('template-move-down-1')).toBeDisabled();
    await fireEvent.press(down0);
    await waitFor(() => expect(ui.getByTestId('template-ex-toggle-0').props.accessibilityLabel).toMatch(/^Row/));
    expect(mockAnnounce).toHaveBeenCalledWith('Bench moved to 2 of 2');
    // The drag handle and its accessibility actions stay.
    expect(ui.getByTestId('template-drag-0')).toBeTruthy();
    const draft = await savedDraft(ui);
    expect(draft.exercises.map((e: { name: string }) => e.name)).toEqual(['Row', 'Bench']);
  });

  it('a straight-set lift offers no cluster or continuation rows (S23-5/F8)', async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    expect(ui.getByTestId('template-add-set-0')).toBeTruthy();
    expect(ui.queryByTestId('template-add-cluster-0')).toBeNull();
    expect(ui.queryByTestId('template-add-block-0')).toBeNull();
  });

  it("the lift's target weight is on the open card, not behind More options (S23-6/F10, R52)", async () => {
    const ui = await openEditor();
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    expect(ui.getByTestId('template-load-0').props.value).toBe('170');
    await fireEvent.changeText(ui.getByTestId('template-load-0'), '175');
    const draft = await savedDraft(ui);
    expect(draft.exercises[0].targetLoad).toBe(175);
  });

  it('on iOS, discarding changes asks with the system action sheet, not a sheet on the sheet (F2, R30/R31)', async () => {
    const { ActionSheetIOS } = jest.requireActual('react-native') as typeof import('react-native');
    const spy = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    const ui = await openEditor();
    await fireEvent.changeText(ui.getByTestId('template-name'), 'Push Day 2');
    await fireEvent.press(ui.getByTestId('template-cancel'));
    expect(spy).toHaveBeenCalledTimes(1);
    const [opts, onPick] = spy.mock.calls[0];
    expect(opts.title).toBe('Discard changes to Push Day?');
    expect(opts.destructiveButtonIndex).toBe(0);
    expect(ui.queryByTestId('confirm-go')).toBeNull();
    // Cancel (the last option) keeps editing.
    await act(async () => onPick(opts.options.length - 1));
    expect(ui.getByTestId('template-name').props.value).toBe('Push Day 2');
    // Discard (the first option) closes it.
    await fireEvent.press(ui.getByTestId('template-cancel'));
    const [again, pickAgain] = spy.mock.calls[1];
    expect(again.options[0]).toBe('Discard');
    await act(async () => pickAgain(0));
    spy.mockRestore();
  });

  it('the template rests read as one heading over two short labels (F11)', async () => {
    const ui = await openEditor();
    expect(ui.getByTestId('template-rest-heading')).toHaveTextContent('Rest, in seconds');
    expect(ui.getByText('Between sets')).toBeTruthy();
    expect(ui.getByText('Between exercises')).toBeTruthy();
    expect(ui.getByTestId('template-rest-cluster').props.accessibilityLabel).toBe('Rest between exercises, in seconds');
  });
});
