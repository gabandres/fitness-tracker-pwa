import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * The Train UX overhaul, pinned at the screen.
 *
 * Four things this asserts, each one a behaviour the tab did not have:
 *
 * 1. **The home screen answers "what am I doing today."** The full-width
 *    primary used to be "Start workout", which starts an EMPTY session — the
 *    rarest path anyone takes, given the most prominent control on the tab.
 * 2. **PREVIOUS is on every set row.** Last session's numbers were one
 *    aggregate ghost line at the card head, which cannot answer "what do I put
 *    in row 3".
 * 3. **The tick accepts last session** when nothing is typed and the template
 *    prescribed nothing — the half of the one-tap path that was missing.
 * 4. **Deleting a logged workout asks.** It used to happen on a bare
 *    long-press, unconfirmed, on the one surface whose data cannot be
 *    recovered. `confirm()` no-ops when no host is mounted, so the assertion
 *    here is that the delete does NOT happen — which is the safety property.
 */

const mockStartFromTemplate = jest.fn().mockResolvedValue(undefined);
const mockStartWorkout = jest.fn().mockResolvedValue(undefined);
const mockDeleteSession = jest.fn().mockResolvedValue(undefined);
const mockDispatch = jest.fn().mockResolvedValue(undefined);
const mockEditCatalogExercise = jest.fn().mockResolvedValue(undefined);

const day = (n: number) => new Date(2026, 8, n);

const tpl = (id: string, name: string): WorkoutTemplate =>
  ({
    id,
    name,
    exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] }],
    createdAt: day(1),
    updatedAt: day(1),
  }) as WorkoutTemplate;

/** Two templates; "Pull A" is the one gone longest without being performed. */
const mockTemplates = [tpl('push', 'Push A'), tpl('pull', 'Pull A')];

const mockHistory: WorkoutSession[] = [
  {
    id: 's-push',
    date: day(14),
    status: 'completed',
    templateId: 'push',
    exercises: [
      {
        exerciseId: 'e1',
        name: 'Bench',
        logStyle: 'weight-reps',
        cues: [],
        sets: [
          { kind: 'working', weight: 135, reps: 8, done: true },
          { kind: 'working', weight: 135, reps: 6, done: true },
        ],
      },
    ],
  } as unknown as WorkoutSession,
  {
    id: 's-pull',
    date: day(9),
    status: 'completed',
    templateId: 'pull',
    exercises: [],
  } as unknown as WorkoutSession,
];

/** A live session on the same exercise, with two EMPTY rows to compare. */
const activeSession = {
  id: 'live',
  date: day(16),
  status: 'active',
  templateId: 'push',
  exercises: [
    {
      exerciseId: 'e1',
      name: 'Bench',
      logStyle: 'weight-reps',
      cues: [],
      sets: [{ kind: 'working', done: false }, { kind: 'working', done: false }],
    },
  ],
} as unknown as WorkoutSession;

let mockActive: WorkoutSession | null = null;

jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [
      { id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date() },
    ],
    templates: mockTemplates,
    recentSessions: mockHistory,
    active: mockActive,
    saving: false,
    editingExisting: false,
    startWorkout: mockStartWorkout,
    startFromTemplate: mockStartFromTemplate,
    startCardioWorkout: jest.fn(),
    saveTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
    addCatalogExercise: jest.fn(),
    addLibraryExercise: jest.fn(),
    addLibraryExerciseToActive: jest.fn(),
    editCatalogExercise: mockEditCatalogExercise,
    deleteCatalogExercise: jest.fn(),
    mergeCatalogExercises: jest.fn(),
    addExerciseToActive: jest.fn(),
    dispatch: mockDispatch,
    commitActive: jest.fn(),
    finishWorkout: jest.fn(),
    discardWorkout: jest.fn(),
    deleteSession: mockDeleteSession,
    reopenSession: jest.fn(),
    finishEdit: jest.fn(),
    cancelEdit: jest.fn(),
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
  mockActive = null;
  mockStartFromTemplate.mockClear();
  mockStartWorkout.mockClear();
  mockDeleteSession.mockClear();
  mockDispatch.mockClear();
  mockEditCatalogExercise.mockClear().mockResolvedValue(undefined);
});

describe('the home screen answers "what am I doing today"', () => {
  it('offers the least recently performed template, with when it was last done', async () => {
    const ui = await render(<TrainScreen />);
    // Pull A was 2026-09-09, Push A 2026-09-14 — Pull A is due.
    expect(ui.getByTestId('next-up')).toBeTruthy();
    expect(ui.getByTestId('next-up-start')).toBeTruthy();
    expect(ui.getAllByText(/Pull A/).length).toBeGreaterThan(0);
    // The BUTTON does not repeat it. It used to read "Start Pull A", saying the
    // same thing as the heading directly above and wrapping to two lines at
    // 360dp (measured on the OnePlus 8T, 2026-09-17). Asserted on the button
    // rather than by counting "Pull A" on screen, because the Templates list
    // below legitimately names it too.
    // The name is not lost — it moved to the button's accessibility label, so
    // someone who lands on the button without reading the heading still knows
    // which template they are starting.
    expect(ui.getByTestId('next-up-start')).not.toHaveTextContent(/Pull A/);
    expect(ui.getByTestId('next-up-start').props.accessibilityLabel).toMatch(/Pull A/);
  });

  it('starts that template from the primary button', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('next-up-start'));
    expect(mockStartFromTemplate).toHaveBeenCalledTimes(1);
    expect(mockStartFromTemplate.mock.calls[0][0].id).toBe('pull');
  });

  it('keeps the empty workout, demoted to a link', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('start-workout'));
    expect(mockStartWorkout).toHaveBeenCalledTimes(1);
  });

  // ADR-0041 put the catalog behind one row plus `ExerciseLibrarySheet`. That was
  // REVERTED on 2026-09-17: nothing inside the sheet's ScrollView was tappable on
  // iOS, so the catalog became unreachable. The list is inline again.
  //
  // Note what this file could NOT see: the version of this suite that drove the
  // sheet passed green, because RNTL presses a `TouchableOpacity` directly and
  // never runs a native hit-test. Only the Maestro sweep caught it - the same
  // blind spot that shipped the collapsed search field on 2026-08-08.
  it('lists the exercise catalog inline, each row opening its detail', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('exercise-e1')).toBeTruthy();
  });
});

describe('deleting a logged workout', () => {
  it('does not delete on a bare long-press', async () => {
    // `confirm()` fails CLOSED with no host mounted: an unconfirmed delete of
    // unrecoverable data is the thing being prevented.
    const ui = await render(<TrainScreen />);
    await fireEvent(ui.getByTestId('session-s-push'), 'longPress');
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });
});

describe('the PREVIOUS column', () => {
  it('shows last session per ROW, positionally', async () => {
    mockActive = activeSession;
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-prev-0-0')).toBeTruthy());
    expect(ui.getByTestId('set-prev-0-0')).toHaveTextContent('135×8');
    expect(ui.getByTestId('set-prev-0-1')).toHaveTextContent('135×6');
  });

  it('ticking an untyped set accepts last session’s reps AND load', async () => {
    mockActive = activeSession;
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-done-0-0')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('set-done-0-0'));

    const patches = mockDispatch.mock.calls
      .map((c) => c[0])
      .filter((a: { type: string }) => a.type === 'patchSet')
      .map((a: { patch: Record<string, unknown> }) => a.patch);
    expect(patches).toContainEqual({ reps: 8 });
    expect(patches).toContainEqual({ weight: 135 });
    expect(patches).toContainEqual({ done: true });
  });
});

describe('muscle attribution', () => {
  it('is editable, which is what makes the audit’s unattributed line fixable', async () => {
    // `muscles` was write-once and only by `cloneStarterTemplate`. Every other
    // creation path wrote `[]`, and no screen could set them afterwards — so
    // `weeklyClusterAudit` reported a gap the user could not close.
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-e1'));
    await waitFor(() => expect(ui.getByTestId('exercise-edit')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('exercise-edit'));
    await waitFor(() => expect(ui.getByTestId('edit-muscle-triceps')).toBeTruthy());
    // Fixture starts at ['chest']; add triceps, then save.
    await fireEvent.press(ui.getByTestId('edit-muscle-triceps'));
    await fireEvent.press(ui.getByTestId('save-exercise'));
    await waitFor(() => expect(mockEditCatalogExercise).toHaveBeenCalled());
    const [id, patch] = mockEditCatalogExercise.mock.calls.at(-1)!;
    expect(id).toBe('e1');
    expect(patch.muscles).toEqual(['chest', 'triceps']);
  });
});
