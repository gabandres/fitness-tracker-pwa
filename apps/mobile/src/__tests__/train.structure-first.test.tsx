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

jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [],
    templates: [mockTemplate],
    recentSessions: [],
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
});

/** Open the editor on the fixture template and expand its one exercise. */
async function openCard() {
  const ui = await render(<TrainScreen />);
  await fireEvent.press(ui.getByTestId('edit-template-t1'));
  await waitFor(() => expect(ui.getByTestId('template-ex-toggle-0')).toBeTruthy());
  await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
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
    expect(ui.getAllByText(/not read yet/).length).toBeGreaterThan(0);
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

  it('an UNDECLARED template keeps all three — legacy data loses nothing', async () => {
    const ui = await openCard();
    expect(ui.getByTestId('template-add-set-0')).toBeTruthy();
    expect(ui.getByTestId('template-add-cluster-0')).toBeTruthy();
    expect(ui.getByTestId('template-add-block-0')).toBeTruthy();
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
