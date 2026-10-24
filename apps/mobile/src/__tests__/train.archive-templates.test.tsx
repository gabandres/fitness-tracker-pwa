import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Archive a template (S-v2 training, 2026-10-24). An archived template leaves
 * Start's list and "Next up" for a collapsed "Archived (n)" section with one
 * action, Unarchive; it is never deleted, so its sessions keep their names.
 * The ledger half writes `archivedAt` as a server timestamp and removes it
 * with `deleteField()` — `firestore.rules` `isValidWorkoutTemplate` allows a
 * timestamp or nothing.
 */

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const mockTrain = {
  loading: false,
  activePending: false,
  error: null as Error | null,
  errorKind: null as 'save' | 'load' | null,
  clearError: jest.fn(),
  catalog: [{ id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: daysAgo(90) }],
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
  archiveTemplate: jest.fn().mockResolvedValue(undefined),
  unarchiveTemplate: jest.fn().mockResolvedValue(undefined),
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
jest.mock('@/components/ContextMenu', () => ({
  CONTEXT_MENUS: false,
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));

import TrainScreen from '@/app/(app)/train';

const tpl = (id: string, name: string, archivedAt?: Date): WorkoutTemplate =>
  ({
    id,
    name,
    exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] }],
    ...(archivedAt ? { archivedAt } : {}),
    createdAt: daysAgo(90),
    updatedAt: daysAgo(90),
  }) as unknown as WorkoutTemplate;

beforeEach(() => {
  jest.clearAllMocks();
  mockTrain.templates = [];
  mockTrain.recentSessions = [];
});

describe('archived templates on Start', () => {
  it('leave the main list and Next up for a collapsed "Archived (n)" section', async () => {
    mockTrain.templates = [tpl('push', 'Push A'), tpl('old', 'Old Split', daysAgo(3))];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('template-push')).toBeTruthy();
    expect(ui.queryByTestId('template-old')).toBeNull();
    // "Old Split" was never performed, which would win Next up outright.
    expect(ui.queryByText('Old Split')).toBeNull();
    expect(ui.getByTestId('archived-templates-toggle')).toHaveTextContent(/Archived \(.?1.?\)/);
    expect(ui.queryByTestId('archived-template-old')).toBeNull();
    await fireEvent.press(ui.getByTestId('archived-templates-toggle'));
    expect(ui.getByTestId('archived-template-old')).toHaveTextContent(/Old Split/);
  });

  it('Unarchive brings one back', async () => {
    mockTrain.templates = [tpl('push', 'Push A'), tpl('old', 'Old Split', daysAgo(3))];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('archived-templates-toggle'));
    await fireEvent.press(ui.getByTestId('unarchive-template-old'));
    expect(mockTrain.unarchiveTemplate).toHaveBeenCalledWith('old');
  });

  it('no section at all when nothing is archived', async () => {
    mockTrain.templates = [tpl('push', 'Push A')];
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('archived-templates')).toBeNull();
  });

  it("the card's menu offers Archive, and it archives — never deletes", async () => {
    mockTrain.templates = [tpl('push', 'Push A'), tpl('pull', 'Pull A')];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('template-menu-pull'));
    await fireEvent.press(ui.getByTestId('template-menu-pull-archive'));
    await waitFor(() => expect(mockTrain.archiveTemplate).toHaveBeenCalledWith('pull'));
    expect(mockTrain.deleteTemplate).not.toHaveBeenCalled();
  });
});
