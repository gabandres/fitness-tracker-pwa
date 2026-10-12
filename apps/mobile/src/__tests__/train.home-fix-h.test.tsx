import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Train home, final fix round (fix agent H, 2026-10-12) — the re-score's
 * `RESCORE-home-progression.md` N-findings this agent owns:
 *
 * - N1  the history row's menu preview names each lift again;
 * - N2  "Next weights" keeps the refusals ADR-0040 makes speak;
 * - N4/N5 the hero is one window, called "Last 7 days", and its top set is
 *       that window's, with the lift named;
 * - N6  the exercise library has a visible Done;
 * - N7  Next up and the template card wear the same tag;
 * - N8  a starter's content is in its row's label, not a button hint;
 * - N9  each "Next weights" toggle names its template;
 * - N10/N11 template cards and the title row at accessibility sizes.
 */

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const mockTrain = {
  loading: false,
  activePending: false,
  error: null as Error | null,
  errorKind: null as 'save' | 'load' | null,
  clearError: jest.fn(),
  catalog: [
    { id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: daysAgo(90) },
    { id: 'e2', name: 'Row', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', createdAt: daysAgo(90) },
  ],
  templates: [] as WorkoutTemplate[],
  drafts: [] as unknown[],
  pendingLoadTestFor: () => null,
  recentSessions: [] as WorkoutSession[],
  active: null as WorkoutSession | null,
  saving: false,
  editingExisting: false,
  startWorkout: jest.fn(),
  startFromTemplate: jest.fn(),
  startCardioWorkout: jest.fn(),
  saveTemplate: jest.fn(),
  cloneStarterTemplate: jest.fn(),
  deleteTemplate: jest.fn().mockResolvedValue(undefined),
  addLibraryExercise: jest.fn(),
  editCatalogExercise: jest.fn().mockResolvedValue(undefined),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  reopenSession: jest.fn(),
};

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
// Off iOS the menu renders its child alone; here the preview renders beside
// it, so what the long-press would show can be read.
jest.mock('@/components/ContextMenu', () => {
  const { View } = jest.requireActual('react-native');
  return {
    CONTEXT_MENUS: false,
    ContextMenu: ({ children, preview }: { children: React.ReactNode; preview?: React.ReactNode }) => (
      <>
        {children}
        {preview ? <View testID="ctx-preview">{preview}</View> : null}
      </>
    ),
  };
});
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));

import TrainScreen from '@/app/(app)/train';
import { ExerciseLibrarySheet } from '@/components/train/ExerciseLibrarySheet';
import { StarterTemplatesSheet } from '@/components/train/StarterTemplatesSheet';
import { recommendationFor } from '@/components/train/train-summary';

const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const straight = (n = 3) => Array.from({ length: n }, () => ({ kind: 'working' as const }));

const pushA = {
  id: 't1',
  name: 'Push A',
  exercises: [
    { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: straight() },
    { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', plannedSets: straight() },
  ],
  createdAt: daysAgo(90),
  updatedAt: daysAgo(90),
} as unknown as WorkoutTemplate;

function done(id: string, d: number, exercises: { id: string; name: string; weight: number; reps?: number }[], templateId?: string): WorkoutSession {
  return {
    id,
    status: 'completed',
    date: daysAgo(d),
    createdAt: daysAgo(d),
    updatedAt: daysAgo(d),
    templateId,
    templateName: templateId ? 'Push A' : undefined,
    exercises: exercises.map((e) => ({
      exerciseId: e.id,
      name: e.name,
      logStyle: 'weight-reps',
      cues: [],
      sets: [1, 2, 3].map(() => ({ kind: 'working', weight: e.weight, reps: e.reps ?? 8, done: true })),
    })),
  } as WorkoutSession;
}

let spy: jest.SpyInstance | null = null;
// The RN jest preset reports fontScale 2 unless told otherwise.
const atFontScale = (fontScale: number) => {
  spy = jest.spyOn(jest.requireActual('react-native'), 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTrain.templates = [];
  mockTrain.drafts = [];
  mockTrain.recentSessions = [];
});
afterEach(() => {
  spy?.mockRestore();
  spy = null;
});

describe('hero (N4, N5)', () => {
  it('names its window "Last 7 days" and its top set is that window’s, with the lift', async () => {
    mockTrain.recentSessions = [
      done('s1', 2, [{ id: 'sq', name: 'Back Squat', weight: 185, reps: 5 }]),
      done('s2', 40, [{ id: 'dl', name: 'Deadlift', weight: 315, reps: 3 }]),
    ];
    const ui = await render(<TrainScreen />);
    expect(ui.getByText('Last 7 days')).toBeTruthy();
    expect(ui.queryByText('This week')).toBeNull();
    expect(ui.getByTestId('hero-top-set')).toHaveTextContent('Top set · Back Squat  185 lb');
  });

  it('an empty week says so in the same words, with no top set', async () => {
    mockTrain.recentSessions = [done('s2', 40, [{ id: 'dl', name: 'Deadlift', weight: 315 }])];
    const ui = await render(<TrainScreen />);
    expect(ui.getByText('No workouts in the last 7 days — start one below.')).toBeTruthy();
    expect(ui.queryByTestId('hero-top-set')).toBeNull();
  });
});

describe('"Next weights" (N2, N9)', () => {
  it('lists a straight-set lift with its one-line reason instead of hiding it (ADR-0040)', async () => {
    mockTrain.templates = [pushA];
    mockTrain.recentSessions = [done('s1', 3, [{ id: 'e1', name: 'Bench', weight: 135 }, { id: 'e2', name: 'Row', weight: 115 }], 't1')];
    // Guard: the engine really does refuse this lift — the case the old
    // `action !== 'none'` filter dropped.
    expect(recommendationFor(mockTrain as never, 'e2', pushA.exercises[1]).action).toBe('none');
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('next-session-t1'));
    const list = await waitFor(() => ui.getByTestId('next-session-list-t1'));
    expect(within(list).getByText('Row')).toBeTruthy();
    expect(within(list).getByTestId('rec-t1-e2-reason').props.children).toBeTruthy();
  });

  it('names the template on each toggle', async () => {
    mockTrain.templates = [pushA, { ...pushA, id: 't2', name: 'Pull A' } as WorkoutTemplate];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('next-session-t1').props.accessibilityLabel).toBe('Next weights, Push A');
    expect(ui.getByTestId('next-session-t2').props.accessibilityLabel).toBe('Next weights, Pull A');
  });
});

describe('history preview (N1)', () => {
  it('lists each lift by name, not only its sets', async () => {
    mockTrain.recentSessions = [done('s1', 3, [{ id: 'e1', name: 'Bench', weight: 135 }, { id: 'e2', name: 'Row', weight: 115 }], 't1')];
    const ui = await render(<TrainScreen />);
    const preview = within(ui.getAllByTestId('ctx-preview').at(-1)!);
    const name = preview.getByTestId('session-preview-name-0');
    expect(name).toHaveTextContent('Bench');
    // `flex: 1` in this column sized the name to nothing.
    expect(flat(name.props.style).flex).toBe(0);
    expect(preview.getByTestId('session-preview-name-1')).toHaveTextContent('Row');
  });
});

describe('one tag per template (N7)', () => {
  const withPair = {
    ...pushA,
    exercises: pushA.exercises.map((e) => ({ ...e, supersetGroup: 1 })),
  } as unknown as WorkoutTemplate;

  it('a template built with supersets says so on Next up AND on its card', async () => {
    mockTrain.templates = [withPair];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('next-up-tag')).toHaveTextContent('Supersets');
    expect(ui.getByTestId('template-supersets-t1')).toHaveTextContent('Supersets');
  });

  it('a superset draft shows the same "since" text in both places', async () => {
    mockTrain.templates = [withPair];
    mockTrain.drafts = [{ id: 'd1', draftOf: 't1', status: 'active', activatedAt: '2026-10-11T12:00:00Z' }];
    const ui = await render(<TrainScreen />);
    const card = ui.getByTestId('template-supersets-t1');
    expect(card).toHaveTextContent(/^Supersets since Oct 1[01]$/);
    expect(ui.getByTestId('next-up-tag')).toHaveTextContent(String(card.props.children));
  });

  it('a plain template wears no tag in either place', async () => {
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('next-up-tag')).toBeNull();
    expect(ui.queryByTestId('template-supersets-t1')).toBeNull();
  });
});

describe('accessibility text sizes (N10, N11)', () => {
  it('normal size: names on one line beside Start, and the title row pinned', async () => {
    atFontScale(1);
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('template-names-t1').props.numberOfLines).toBe(1);
    expect(ui.queryByTestId('template-actions-row-t1')).toBeNull();
    expect(within(ui.getByTestId('train-start-scroll')).queryByTestId('train-glossary-open')).toBeNull();
    expect(ui.getByTestId('train-glossary-open')).toBeTruthy();
  });

  it('fontScale 2: names in full, Start on its own row, and the title row scrolls away', async () => {
    atFontScale(2);
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('template-names-t1').props.numberOfLines).toBeUndefined();
    expect(within(ui.getByTestId('template-actions-row-t1')).getByTestId('start-template-t1')).toBeTruthy();
    expect(within(ui.getByTestId('train-start-scroll')).getByTestId('train-glossary-open')).toBeTruthy();
    expect(ui.getAllByTestId('train-header')).toHaveLength(1);
  });
});

describe('read-only sheets (N6, N8)', () => {
  it('the exercise library has a visible Done that closes it', async () => {
    const onClose = jest.fn();
    const ui = await render(
      <ExerciseLibrarySheet visible catalog={mockTrain.catalog as never} onClose={onClose} onOpenExercise={jest.fn()} onAddSeed={jest.fn()} />,
    );
    expect(ui.getByRole('header', { name: 'Exercises' })).toBeTruthy();
    await fireEvent.press(ui.getByTestId('library-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('a starter row says what it is in its label; Add stays short', async () => {
    const ui = await render(<StarterTemplatesSheet visible train={mockTrain as never} onClose={jest.fn()} />);
    const info = ui.getByTestId('starter-info-push-day');
    expect(info.props.accessible).toBe(true);
    expect(info.props.accessibilityLabel).toMatch(/^Push Day, \d+ exercises, .+/);
    const add = ui.getByTestId('use-starter-push-day');
    expect(add.props.accessibilityLabel).toBe('Add Push Day');
    expect(add.props.accessibilityHint).toBeUndefined();
  });
});
