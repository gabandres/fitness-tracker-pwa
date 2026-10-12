import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * The template editor asks for the STRUCTURE first, and the structure
 * scaffolds the rows (ADR-0040 + `scaffoldKindsFor`).
 *
 * It used to ask underneath the sets table, after three buttons — `+ Add set`,
 * `+ Add cluster`, `+ Add block` — had already made the user hand-build a set
 * list that implies a structure, which is the decision and its consequence in
 * the wrong order. That is also why every card carried all three buttons: they
 * were the union of every structure's needs, shown to everyone, including
 * `+ Add cluster` under a straight-set lift it would contradict.
 *
 * The one rule that is not about tidiness: re-scaffolding is gated on the rows
 * being untouched. This repo does not silently overrule a person who typed a
 * number, and a template's numbers are the ones that cost real effort.
 */

const mockSaveTemplate = jest.fn().mockResolvedValue(undefined);
/** Logged sessions the editor seeds a new card from (T7). Per test. */
const mockRecent: unknown[] = [];

const mockTemplate: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  exercises: [
    {
      exerciseId: 'e1',
      name: 'Bench',
      logStyle: 'weight-reps',
      plannedSets: [{ kind: 'working' }, { kind: 'working' }, { kind: 'working' }],
    },
  ],
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

// Native sheets present through a root `sheet` route that does not exist
// under jest; the JS sheet renders its children in place, which is what this
// suite asserts against (Train sheets went native in the 2026-10-04 review).
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [],
    templates: [mockTemplate],
    drafts: [],
    pendingLoadTestFor: () => null,
    recentSessions: mockRecent,
    active: null,
    editingExisting: false,
    saveTemplate: mockSaveTemplate,
    deleteTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    addCatalogExercise: jest.fn().mockResolvedValue('new-id'),
    addLibraryExercise: jest.fn(),
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    reopenSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';

beforeEach(() => {
  mockSaveTemplate.mockClear().mockResolvedValue(undefined);
  mockRecent.length = 0;
});

/** Open the editor on the fixture template and expand its one exercise. */
async function openCard() {
  const ui = await render(<TrainScreen />);
  await fireEvent.press(ui.getByTestId('edit-template-t1'));
  await waitFor(() => expect(ui.getByTestId('template-ex-toggle-0')).toBeTruthy());
  await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
  // A saved card opens with its structure folded to one line (train-ux T6);
  // "Change" unfolds the picker, still above the sets.
  await waitFor(() => expect(ui.getByTestId('template-structure-compact-0')).toBeTruthy());
  await fireEvent.press(ui.getByTestId('template-structure-compact-0'));
  await waitFor(() => expect(ui.getByTestId('template-structure-0-straight')).toBeTruthy());
  return ui;
}

/** The plannedSets of the one exercise, from the save that just happened. */
function savedKinds(): string[] {
  expect(mockSaveTemplate).toHaveBeenCalled();
  const draft = mockSaveTemplate.mock.calls.at(-1)![0];
  return draft.exercises[0].plannedSets.map((p: { kind: string }) => p.kind);
}

describe('the structure picker', () => {
  it('leads with the structures the engine can read, and hides the two it cannot', async () => {
    const ui = await openCard();
    expect(ui.getByTestId('template-structure-0-straight')).toBeTruthy();
    expect(ui.getByTestId('template-structure-0-myoreps')).toBeTruthy();
    expect(ui.getByTestId('template-structure-0-hit')).toBeTruthy();
    // Declared-but-unread: kept, but not given equal billing on every card.
    expect(ui.queryByTestId('template-structure-0-drop')).toBeNull();
    expect(ui.queryByTestId('template-structure-0-superset')).toBeNull();
  });

  it('reveals the unread ones on request, still labelled unread', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-more-0'));
    await waitFor(() => expect(ui.getByTestId('template-structure-0-drop')).toBeTruthy());
    // In gym words, not engine words (E-N11).
    expect(ui.getAllByText(/weights not auto-adjusted yet/).length).toBeGreaterThan(0);
  });
});

describe('choosing a structure scaffolds the rows', () => {
  it('myo-reps produces activation + two minis', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-0-myoreps'));
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    expect(savedKinds()).toEqual(['activation', 'mini', 'mini']);
  });

  it('rest-pause produces activation + a prescribed continuation', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-0-rest-pause'));
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    expect(savedKinds()).toEqual(['activation', 'continuation']);
  });

  it('single-set-to-failure produces exactly one set', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-0-hit'));
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    expect(savedKinds()).toEqual(['working']);
  });

  it('KEEPS rows the user has typed into, and says so', async () => {
    const ui = await openCard();
    await fireEvent.changeText(ui.getByTestId('template-set-reps-0-0'), '8');
    await fireEvent.press(ui.getByTestId('template-structure-0-myoreps'));
    await waitFor(() => expect(ui.getByTestId('template-structure-kept-0')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    expect(savedKinds()).toEqual(['working', 'working', 'working']);
    const draft = mockSaveTemplate.mock.calls.at(-1)![0];
    // The declaration still lands — only the rows were spared.
    expect(draft.exercises[0].setStructure).toBe('myoreps');
    expect(draft.exercises[0].plannedSets[0].reps).toBe(8);
  });
});

describe('the add-set buttons follow the declaration', () => {
  it('a straight-set lift is offered neither cluster nor block', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-0-straight'));
    await waitFor(() => expect(ui.getByTestId('template-add-set-0')).toBeTruthy());
    expect(ui.queryByTestId('template-add-cluster-0')).toBeNull();
    expect(ui.queryByTestId('template-add-block-0')).toBeNull();
  });

  it('a myo-reps lift is offered the cluster, not the block', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-0-myoreps'));
    await waitFor(() => expect(ui.getByTestId('template-add-cluster-0')).toBeTruthy());
    expect(ui.queryByTestId('template-add-block-0')).toBeNull();
  });

  it('a rest-pause lift is offered the block, not the cluster', async () => {
    const ui = await openCard();
    await fireEvent.press(ui.getByTestId('template-structure-0-rest-pause'));
    await waitFor(() => expect(ui.getByTestId('template-add-block-0')).toBeTruthy());
    expect(ui.queryByTestId('template-add-cluster-0')).toBeNull();
  });

  it('an UNDECLARED straight-set card offers only "+ Add set" — the add-buttons its rows use, not all three (S23-5, ADR-0041 amended)', async () => {
    const ui = await openCard();
    expect(ui.getByTestId('template-add-set-0')).toBeTruthy();
    expect(ui.queryByTestId('template-add-cluster-0')).toBeNull();
    expect(ui.queryByTestId('template-add-block-0')).toBeNull();
    // Declaring the structure is the way to clusters, one tap away.
    await fireEvent.press(ui.getByTestId('template-structure-0-myoreps'));
    await waitFor(() => expect(ui.getByTestId('template-add-cluster-0')).toBeTruthy());
  });
});

describe('the template form itself', () => {
  it('asks only for a name up front — notes and rest are behind one row', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('new-template'));
    await waitFor(() => expect(ui.getByTestId('template-name')).toBeTruthy());
    // "Rest (mini)" and "Rest (cluster)" were fields 3 and 4 of an empty
    // form, asked of someone who may never program a cluster.
    expect(ui.queryByTestId('template-rest-mini')).toBeNull();
    expect(ui.queryByTestId('template-notes')).toBeNull();
    await fireEvent.press(ui.getByTestId('template-options'));
    await waitFor(() => expect(ui.getByTestId('template-rest-mini')).toBeTruthy());
  });
});

/** Open the editor and create a new lift by name (no library match, so the
 *  create row leads). It lands at index 1, open. */
async function addNewLift(name = 'Zqx Curl') {
  const ui = await render(<TrainScreen />);
  await fireEvent.press(ui.getByTestId('edit-template-t1'));
  await fireEvent.changeText(ui.getByTestId('template-add-exercise'), name);
  await fireEvent.press(ui.getByTestId('template-create-exercise'));
  await waitFor(() => expect(ui.getByTestId('template-ex-toggle-1')).toBeTruthy());
  return ui;
}

describe('a lift added in this session (train-ux T6, T7, T9)', () => {
  it('opens on the full picker — structure first — and offers only "+ Add set" until declared', async () => {
    const ui = await addNewLift();
    await waitFor(() => expect(ui.getByTestId('template-structure-1-straight')).toBeTruthy());
    expect(ui.queryByTestId('template-structure-compact-1')).toBeNull();
    // ADR-0041's all-three rule is for LEGACY undeclared templates only.
    expect(ui.getByTestId('template-add-set-1')).toBeTruthy();
    expect(ui.queryByTestId('template-add-cluster-1')).toBeNull();
    expect(ui.queryByTestId('template-add-block-1')).toBeNull();
  });

  it('folds the picker to one line once a structure is chosen; "Change" unfolds it', async () => {
    const ui = await addNewLift();
    await fireEvent.press(await waitFor(() => ui.getByTestId('template-structure-1-myoreps')));
    await waitFor(() => expect(ui.getByTestId('template-structure-compact-1')).toBeTruthy());
    expect(ui.queryByTestId('template-structure-1-straight')).toBeNull();
    expect(ui.getByText('Set structure: Myo-reps')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('template-structure-compact-1'));
    await waitFor(() => expect(ui.getByTestId('template-structure-1-straight')).toBeTruthy());
  });

  const curlHistory = () => mockRecent.push({
    id: 's1', date: new Date('2026-10-01T12:00:00Z'), status: 'completed',
    exercises: [{
      exerciseId: 'new-id', name: 'Zqx Curl', cues: [], logStyle: 'weight-reps',
      sets: [
        { kind: 'warmup', weight: 45, reps: 10, done: true },
        { kind: 'working', weight: 60, reps: 9, done: true },
        { kind: 'working', weight: 60, reps: 8, done: true },
      ],
    }],
  });

  it('shows last session as GHOST text by kind, and a ghosted row still rescaffolds', async () => {
    curlHistory();
    const ui = await addNewLift();
    // Ghosts, not values: the boxes are empty, the numbers are placeholders.
    // The warm-up's 45 × 10 does NOT show over working row 1: matched by kind.
    await waitFor(() => expect(ui.getByTestId('template-set-reps-1-0').props.placeholder).toBe('9'));
    expect(ui.getByTestId('template-set-reps-1-0').props.value).toBe('');
    expect(ui.getByTestId('template-set-reps-1-1').props.placeholder).toBe('8');
    // Row 3 has no same-kind ghost; it shows what the session will offer
    // there — last time's row 3, a working 8 (core `countToAccept`, E-N1).
    expect(ui.getByTestId('template-set-reps-1-2').props.placeholder).toBe('8');
    expect(ui.getByTestId('template-set-weight-1-0').props.value).toBe('');
    // The weight ghost is the lift's load (what the session pre-fills).
    expect(ui.getByTestId('template-set-weight-1-0').props.placeholder).toBe('60');
    // Ghost text is not a typed number: myo-reps still scaffolds, no note.
    await fireEvent.press(ui.getByTestId('template-structure-1-myoreps'));
    expect(ui.queryByTestId('template-structure-kept-1')).toBeNull();
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    const added = mockSaveTemplate.mock.calls.at(-1)![0].exercises[1];
    expect(added.plannedSets.map((p: { kind: string }) => p.kind)).toEqual(['activation', 'mini', 'mini']);
  });

  it('an UNTOUCHED new card saves the grey REPS it shows as targets, never a per-set weight — the load goes in targetLoad, which progression moves (S23-11, fix R)', async () => {
    curlHistory();
    const ui = await addNewLift();
    await waitFor(() => expect(ui.getByTestId('template-set-reps-1-0').props.placeholder).toBe('9'));
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    const added = mockSaveTemplate.mock.calls.at(-1)![0].exercises[1];
    expect(added.targetLoad).toBe(60);
    // What the three rows showed in grey: 9, 8, and last time's row 3 (8).
    expect(added.plannedSets.map((p: { reps?: number }) => p.reps)).toEqual([9, 8, 8]);
    for (const p of added.plannedSets) expect(p.weight).toBeUndefined();
    // The existing card is not restated by an unrelated save.
    const bench = mockSaveTemplate.mock.calls.at(-1)![0].exercises[0];
    for (const p of bench.plannedSets) expect(p.reps).toBeUndefined();
  });

  it('a new card with no history starts with no load and blank rows', async () => {
    const ui = await addNewLift();
    await waitFor(() => expect(ui.getByTestId('template-set-reps-1-0')).toBeTruthy());
    expect(ui.getByTestId('template-set-reps-1-0').props.placeholder).toBeUndefined();
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
    const added = mockSaveTemplate.mock.calls.at(-1)![0].exercises[1];
    expect(added.targetLoad).toBeUndefined();
  });

  it('a TYPED row over a ghosted one is kept through a structure change', async () => {
    mockRecent.push({
      id: 's1', date: new Date('2026-10-01T12:00:00Z'), status: 'completed',
      exercises: [{ exerciseId: 'new-id', name: 'Zqx Curl', cues: [], sets: [{ kind: 'working', weight: 60, reps: 9, done: true }] }],
    });
    const ui = await addNewLift();
    await fireEvent.changeText(await waitFor(() => ui.getByTestId('template-set-reps-1-0')), '12');
    await fireEvent.press(ui.getByTestId('template-structure-1-myoreps'));
    await waitFor(() => expect(ui.getByTestId('template-structure-kept-1')).toBeTruthy());
  });

  it('"+ Add set" copies the last working row, and "Copy set 1 to all sets" fills the blanks', async () => {
    const ui = await addNewLift();
    await fireEvent.changeText(await waitFor(() => ui.getByTestId('template-set-reps-1-0')), '10');
    await fireEvent.press(ui.getByTestId('template-copy-first-1'));
    expect(ui.getByTestId('template-set-reps-1-2').props.value).toBe('10');
    await fireEvent.press(ui.getByTestId('template-add-set-1'));
    expect(ui.getByTestId('template-set-reps-1-3').props.value).toBe('10');
    expect(ui.queryByTestId('template-copy-first-1')).toBeNull();
  });
});
