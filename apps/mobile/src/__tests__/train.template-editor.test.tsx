import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * Template editor — the round-trip invariant.
 *
 * The editor writes `exercises` as a FULL overwrite (toTemplatePatch), so
 * anything the editor cannot represent is deleted by the next save. It used
 * to model an exercise's sets as a plain count, which meant opening a
 * cluster template written on the web and hitting Save silently flattened
 * every activation/mini cluster into N `working` sets and dropped `cues` and
 * `progression` outright. Saving with no edits must be a no-op on the doc.
 */

const mockSaveTemplate = jest.fn().mockResolvedValue(undefined);
const mockEditCatalogExercise = jest.fn().mockResolvedValue(undefined);

/** The engine's one logged move on exercise 2 — it must survive any save. */
const ENGINE_MOVE = {
  at: '2026-09-30T12:00:00.000Z', from: 35, to: 40, by: 'engine' as const,
  reason: 'Both clusters reached 12; add load.',
};

const mockTemplate: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  notes: 'Chest, shoulders, triceps.',
  restMiniSec: 90,
  restClusterSec: 120,
  seedKey: 'push-day',
  exercises: [
    {
      exerciseId: 'e1',
      name: 'DB Flat Press',
      logStyle: 'weight-reps',
      targetLoad: 25,
      cues: ['Elbows 45°', 'Full stretch'],
      progression: { targetReps: 12, holdSessions: 2, incrementLb: 2.5 },
      restMiniSec: 45,
      plannedSets: [
        { kind: 'activation', group: 1 },
        { kind: 'mini', group: 1 },
        { kind: 'mini', group: 1 },
      ],
    },
    // A second exercise exists so reordering has something to reorder. Every
    // other test indexes exercise 0, which this leaves untouched.
    // Exercise 2 also carries what the editor shows nothing of, and so must
    // carry through untouched: a load log and labelled clusters (a
    // single-arm lift, L then R).
    {
      exerciseId: 'e2',
      name: 'Incline DB Press',
      logStyle: 'weight-reps',
      targetLoad: 40,
      loadLog: [ENGINE_MOVE],
      plannedSets: [
        { kind: 'activation', group: 1, label: 'L' },
        { kind: 'mini', group: 1, label: 'L' },
        { kind: 'activation', group: 2, label: 'R' },
        { kind: 'mini', group: 2, label: 'R' },
      ],
    },
  ],
  createdAt: new Date('2026-07-05T02:51:12Z'),
  updatedAt: new Date('2026-08-06T16:08:19Z'),
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
    // e1 is in the catalog, so its card offers lift settings; e2 is not.
    catalog: [{
      id: 'e1', name: 'DB Flat Press', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps',
      createdAt: new Date('2026-07-01T00:00:00Z'),
    }],
    templates: [mockTemplate],
    editCatalogExercise: mockEditCatalogExercise,
    recentSessions: [],
    active: null,
    editingExisting: false,
    saveTemplate: mockSaveTemplate,
    deleteTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    addCatalogExercise: jest.fn(),
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    reopenSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));

// The screen's chrome reaches Firebase through auth; the editor under test
// does not. Stub the seam rather than boot the SDK.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));

jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';

beforeEach(() => {
  mockSaveTemplate.mockClear().mockResolvedValue(undefined);
  mockEditCatalogExercise.mockClear().mockResolvedValue(undefined);
});

it('round-trips clusters, cues and progression when saved unedited', async () => {
  const { getByTestId } = await render(<TrainScreen />);

  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));

  const [draft, id] = mockSaveTemplate.mock.calls[0];
  expect(id).toBe('t1');
  expect(draft.restMiniSec).toBe(90);
  expect(draft.restClusterSec).toBe(120);
  expect(draft.seedKey).toBe('push-day');
  expect(draft.exercises[0].cues).toEqual(['Elbows 45°', 'Full stretch']);
  expect(draft.exercises[0].progression).toEqual({
    targetReps: 12,
    holdSessions: 2,
    incrementLb: 2.5,
  });
  expect(draft.exercises[0].plannedSets).toEqual([
    { kind: 'activation', group: 1 },
    { kind: 'mini', group: 1 },
    { kind: 'mini', group: 1 },
  ]);
  // The per-exercise rest override is the newest field the editor must carry.
  expect(draft.exercises[0].restMiniSec).toBe(45);
  expect(draft.exercises[1].restMiniSec).toBeUndefined();
});

it('renumbers clusters when one is appended', async () => {
  const { getByTestId } = await render(<TrainScreen />);

  await fireEvent.press(getByTestId('edit-template-t1'));
  // Exercise cards open collapsed — one at a time — so the set controls are
  // behind the card's own toggle now.
  await fireEvent.press(getByTestId('template-ex-toggle-0'));
  await fireEvent.press(getByTestId('template-add-cluster-0'));
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));

  // Group numbers are derived from the activation/mini ordering, never typed.
  expect(mockSaveTemplate.mock.calls[0][0].exercises[0].plannedSets).toEqual([
    { kind: 'activation', group: 1 },
    { kind: 'mini', group: 1 },
    { kind: 'mini', group: 1 },
    { kind: 'activation', group: 2 },
    { kind: 'mini', group: 2 },
    { kind: 'mini', group: 2 },
  ]);
});

/**
 * Readability behaviour (2026-08-18). The card used to render every control
 * for every exercise at once; a six-exercise template was six full forms in
 * one scroll. Cards now open collapsed behind a one-line summary, and the
 * optional half (cues, progression, the default load) sits behind "More
 * options" — so these testIDs being absent until opened IS the feature.
 */
it('opens exercise cards collapsed, showing a summary instead of the form', async () => {
  const { getByTestId, queryByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));

  expect(queryByTestId('template-add-set-0')).toBeNull();
  expect(queryByTestId('template-set-weight-0-0')).toBeNull();
  // The optional half is a further level down, not merely off-screen.
  expect(queryByTestId('template-cues-0')).toBeNull();
  expect(queryByTestId('template-progression-0')).toBeNull();

  await fireEvent.press(getByTestId('template-ex-toggle-0'));
  expect(getByTestId('template-add-set-0')).toBeTruthy();
  expect(getByTestId('template-set-weight-0-0')).toBeTruthy();

  // Still one level down, even with the card open.
  expect(queryByTestId('template-cues-0')).toBeNull();
  await fireEvent.press(getByTestId('template-more-0'));
  expect(getByTestId('template-cues-0')).toBeTruthy();
  expect(getByTestId('template-progression-0')).toBeTruthy();
});

it('round-trips per-set targets typed into the table', async () => {
  const { getByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('template-ex-toggle-0'));

  await fireEvent.changeText(getByTestId('template-set-weight-0-0'), '135');
  await fireEvent.changeText(getByTestId('template-set-reps-0-0'), '8');
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
  const sets = mockSaveTemplate.mock.calls[0][0].exercises[0].plannedSets;
  expect(sets[0]).toMatchObject({ kind: 'activation', group: 1, weight: 135, reps: 8 });
  // The rows left alone prescribe nothing rather than inheriting row 1.
  expect(sets[1].weight).toBeUndefined();
  expect(sets[1].reps).toBeUndefined();
});

/**
 * The collapsed card's summary is the whole readability argument — it is what
 * the old card made you expand it to learn. It is also easy to get subtly
 * wrong in a way no type checks: the first version compared a deduped Set's
 * `size` to the set COUNT, which is 1 for any uniform run, so the numbers
 * never appeared for more than one set and every card read "3 sets".
 */
it('summarises a uniformly prescribed exercise with its numbers', async () => {
  const { getByTestId, getByText } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('template-ex-toggle-0'));

  for (const i of [0, 1, 2]) {
    await fireEvent.changeText(getByTestId(`template-set-weight-0-${i}`), '20');
    await fireEvent.changeText(getByTestId(`template-set-reps-0-${i}`), '8');
  }
  await fireEvent.press(getByTestId('template-ex-toggle-0'));

  expect(getByText('3 × 8 · 20 lb')).toBeTruthy();
});

it('falls back to a set count when the sets do not agree', async () => {
  const { getByTestId, getByText } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('template-ex-toggle-0'));

  // Only the first row prescribes anything — "3 × 8" would be a lie about the
  // other two, so the summary must not claim it.
  await fireEvent.changeText(getByTestId('template-set-reps-0-0'), '8');
  await fireEvent.press(getByTestId('template-ex-toggle-0'));

  // The template's own targetLoad (25) still stands in as the exercise default.
  expect(getByText('3 sets · 25 lb')).toBeTruthy();
});

/**
 * Reorder. The ▲▼ pair was replaced by a drag handle, and a drag is invisible
 * to VoiceOver — so the handle carries move-up / move-down accessibility
 * ACTIONS running the same reorder the chevrons ran. That fallback is the part
 * a unit test can reach: RNTL runs no gesture, so the drag itself is proven on
 * device instead.
 */
it("reorders exercises through the drag handle's accessibility actions", async () => {
  const { getByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));

  await fireEvent(getByTestId('template-drag-1'), 'accessibilityAction', {
    nativeEvent: { actionName: 'moveUp' },
  });
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
  const names = mockSaveTemplate.mock.calls[0][0].exercises.map((e: { name: string }) => e.name);
  expect(names).toEqual(['Incline DB Press', 'DB Flat Press']);
});

/**
 * The progression engine's template state (2026-10-07). `loadLog` and cluster
 * `label`s are fields the editor's draft never modelled, and the save is a
 * full overwrite of `exercises` — so before this, the first edit of a
 * template erased its load history and its L/R names.
 */
describe('load log, cluster labels and lift settings', () => {
  it('carries the load log and cluster labels through an unedited save', async () => {
    const { getByTestId } = await render(<TrainScreen />);
    await fireEvent.press(getByTestId('edit-template-t1'));
    await fireEvent.press(getByTestId('save-template'));

    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
    const [e1, e2] = mockSaveTemplate.mock.calls[0][0].exercises;
    // Nothing was edited, so nothing is logged — not even a "move" to the
    // same load — and the existing entry is carried verbatim.
    expect(e2.loadLog).toEqual([ENGINE_MOVE]);
    expect(e2.targetLoad).toBe(40);
    expect(e1.loadLog).toBeUndefined();
    expect(e2.plannedSets.map((p: { label?: string }) => p.label)).toEqual(['L', 'L', 'R', 'R']);
  });

  it("logs a load changed by hand as the lifter's move", async () => {
    const { getByTestId } = await render(<TrainScreen />);
    await fireEvent.press(getByTestId('edit-template-t1'));
    await fireEvent.press(getByTestId('template-ex-toggle-1'));
    await fireEvent.press(getByTestId('template-more-1'));
    await fireEvent.changeText(getByTestId('template-load-1'), '45');
    await fireEvent.press(getByTestId('save-template'));

    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
    const e2 = mockSaveTemplate.mock.calls[0][0].exercises[1];
    expect(e2.targetLoad).toBe(45);
    expect(e2.loadLog).toHaveLength(2);
    expect(e2.loadLog[0]).toEqual(ENGINE_MOVE);
    expect(e2.loadLog[1]).toMatchObject({
      from: 40, to: 45, by: 'user', reason: 'Edited by hand in the template editor',
    });
    expect(Number.isNaN(Date.parse(e2.loadLog[1].at))).toBe(false);
    // The other row's load did not move, so it gains no log at all.
    expect(mockSaveTemplate.mock.calls[0][0].exercises[0].loadLog).toBeUndefined();
  });

  it('names a cluster on every set of its group', async () => {
    const { getByTestId, queryByTestId } = await render(<TrainScreen />);
    await fireEvent.press(getByTestId('edit-template-t1'));
    await fireEvent.press(getByTestId('template-ex-toggle-0'));
    // One field per cluster, under its first row.
    expect(getByTestId('template-cluster-label-0-1')).toBeTruthy();
    expect(queryByTestId('template-cluster-label-0-2')).toBeNull();

    await fireEvent.changeText(getByTestId('template-cluster-label-0-1'), 'L');
    await fireEvent.press(getByTestId('save-template'));
    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
    expect(mockSaveTemplate.mock.calls[0][0].exercises[0].plannedSets).toEqual([
      { kind: 'activation', group: 1, label: 'L' },
      { kind: 'mini', group: 1, label: 'L' },
      { kind: 'mini', group: 1, label: 'L' },
    ]);
  });

  it('clears a label back off every set of the group', async () => {
    const { getByTestId } = await render(<TrainScreen />);
    await fireEvent.press(getByTestId('edit-template-t1'));
    await fireEvent.press(getByTestId('template-ex-toggle-1'));
    await fireEvent.changeText(getByTestId('template-cluster-label-1-2'), '');
    await fireEvent.press(getByTestId('save-template'));

    await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
    const sets = mockSaveTemplate.mock.calls[0][0].exercises[1].plannedSets;
    expect(sets.map((p: { label?: string }) => p.label)).toEqual(['L', 'L', undefined, undefined]);
    expect(sets[2]).not.toHaveProperty('label');
  });

  it("opens the catalog lift's settings from its card and saves to the catalog", async () => {
    const { getByTestId, queryByTestId } = await render(<TrainScreen />);
    await fireEvent.press(getByTestId('edit-template-t1'));
    await fireEvent.press(getByTestId('template-ex-toggle-0'));
    await fireEvent.press(getByTestId('template-lift-settings-0'));
    await fireEvent.press(getByTestId('lift-category-isolation'));
    await fireEvent.press(getByTestId('lift-save'));

    await waitFor(() => expect(mockEditCatalogExercise).toHaveBeenCalledWith('e1', { category: 'isolation' }));
    // The template itself was not saved by it.
    expect(mockSaveTemplate).not.toHaveBeenCalled();

    // A lift that is not in the catalog has no settings to open.
    await fireEvent.press(getByTestId('template-ex-toggle-1'));
    expect(queryByTestId('template-lift-settings-1')).toBeNull();
  });
});
