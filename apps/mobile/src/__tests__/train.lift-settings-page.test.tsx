import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * Train-ux wave 2 (2026-10-11).
 *
 * X6/T26/J7: Lift settings opened from the template editor is a PAGE of the
 * editor's sheet, not a second sheet stacked over it. Back ("‹ {template}")
 * returns to the draft as left; unsaved settings ask first, on Back, on the
 * foot's Cancel and on Android back (`backSteps`); a swipe with unsaved
 * settings cannot take them with it.
 *
 * H9/T19 + J4: the starter toast's Edit opens the clone in the editor, and the
 * empty Next-up card offers "Build your own" beside the starters.
 */

const mockConfirm = jest.fn();
const mockShowToast = jest.fn();
const mockEditCatalogExercise = jest.fn();
const mockClone = jest.fn();
/** Every props object the editor's (and every other) sheet was rendered with. */
const mockSheetProps: Record<string, unknown>[] = [];

const pushDay: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  exercises: [
    { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working', reps: 8 }] },
  ],
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

const mockState: { templates: WorkoutTemplate[] } = { templates: [pushDay] };

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: Record<string, unknown>) => {
      mockSheetProps.push(p);
      return actual.BottomSheet({ ...p, native: false });
    },
  };
});
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o) }));
jest.mock('@/components/Toast', () => ({
  ...jest.requireActual('@/components/Toast'),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [
      { id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date('2026-07-01T00:00:00Z') },
    ],
    templates: mockState.templates,
    drafts: [],
    pendingLoadTestFor: () => null,
    editCatalogExercise: mockEditCatalogExercise,
    recentSessions: [],
    active: null,
    editingExisting: false,
    saveTemplate: jest.fn().mockResolvedValue(undefined),
    deleteTemplate: jest.fn(),
    cloneStarterTemplate: mockClone,
    addCatalogExercise: jest.fn(),
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
  mockConfirm.mockClear();
  mockShowToast.mockClear();
  mockEditCatalogExercise.mockReset().mockResolvedValue(undefined);
  mockClone.mockReset().mockResolvedValue(undefined);
  mockSheetProps.length = 0;
  mockState.templates = [pushDay];
});

/** The last render of the editor's sheet — the one with the editor's backdrop. */
const editorSheet = () => [...mockSheetProps].reverse().find((p) => p.backdropTestID === 'template-backdrop')!;

/** Android back, as both sheets deliver it: the native route and the JS
 *  sheet's Modal each call the owner's `onRequestClose('back')`. */
const backPress = () => (editorSheet().onRequestClose as (via: string) => boolean)('back');

async function openLiftPage() {
  const ui = await render(<TrainScreen />);
  await fireEvent.press(ui.getByTestId('edit-template-t1'));
  await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
  await fireEvent.press(ui.getByTestId('template-lift-settings-0'));
  await waitFor(() => expect(ui.getByTestId('lift-back')).toBeTruthy());
  return ui;
}

describe('Lift settings is a page of the template editor (X6/T26/J7)', () => {
  it('replaces the editor content under a Back row named after the template', async () => {
    const ui = await openLiftPage();
    // The editor's fields are gone, the form is in their place, in ONE sheet.
    expect(ui.queryByTestId('template-name')).toBeNull();
    expect(ui.getByTestId('lift-category-isolation')).toBeTruthy();
    expect(ui.getByTestId('lift-back').props.accessibilityLabel).toBe('Back to Push Day');
    expect(ui.getByText('Lift settings')).toBeTruthy();
    // The template's own Save is not offered from inside the page.
    expect(ui.queryByTestId('save-template')).toBeNull();
    expect(ui.queryByTestId('template-cancel')).toBeNull();
    // Android back steps out of the page first.
    expect(editorSheet().backSteps).toBe(true);
  });

  it('Back returns to the draft exactly as left', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-t1'));
    await fireEvent.changeText(ui.getByTestId('template-name'), 'Push Day B');
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    await fireEvent.press(ui.getByTestId('template-lift-settings-0'));
    // The Back row reads the draft's name, not the saved one.
    expect(ui.getByTestId('lift-back').props.accessibilityLabel).toBe('Back to Push Day B');
    await fireEvent.press(ui.getByTestId('lift-back'));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(ui.getByTestId('template-name').props.value).toBe('Push Day B');
    // The card the lifter opened it from is still open.
    expect(ui.getByTestId('template-lift-settings-0')).toBeTruthy();
    expect(editorSheet().backSteps).toBe(false);
  });

  it('unsaved settings ask before Back discards them, and stay on the page until confirmed', async () => {
    const ui = await openLiftPage();
    await fireEvent.press(ui.getByTestId('lift-category-isolation'));
    // A swipe could not take them silently: the editor's sheet is guarded.
    expect(editorSheet().guarded).toBe(true);
    await fireEvent.press(ui.getByTestId('lift-back'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard changes to Bench?', destructive: true }));
    expect(ui.getByTestId('lift-back')).toBeTruthy();
    await act(async () => (mockConfirm.mock.calls.at(-1)![0] as { onConfirm: () => void }).onConfirm());
    await waitFor(() => expect(ui.getByTestId('template-name')).toBeTruthy());
    expect(mockEditCatalogExercise).not.toHaveBeenCalled();
  });

  it('Android back with unsaved settings asks about the settings, not the template', async () => {
    const ui = await openLiftPage();
    await fireEvent.press(ui.getByTestId('lift-category-isolation'));
    await act(async () => backPress());
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0][0].title).toBe('Discard changes to Bench?');
    expect(ui.getByTestId('lift-back')).toBeTruthy();
  });

  it('Android back on a clean page steps back to the editor instead of closing it', async () => {
    const ui = await openLiftPage();
    await act(async () => backPress());
    expect(mockConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(ui.getByTestId('template-name')).toBeTruthy());
  });

  it('one way out and one Save: Back and the header Save, no foot; it says the Save writes the lift now (E-N4, H-N15)', async () => {
    const ui = await openLiftPage();
    expect(ui.queryByTestId('lift-save')).toBeNull();
    expect(ui.queryByText('Cancel')).toBeNull();
    expect(ui.getAllByText('Save')).toHaveLength(1);
    // The header names the lift; "Lift settings" is the line under it.
    expect(ui.getByRole('header', { name: 'Bench' })).toBeTruthy();
    expect(ui.getByTestId('lift-subtitle')).toHaveTextContent('Lift settings');
    expect(ui.getByTestId('lift-scope-hint')).toHaveTextContent('Saved to Bench itself — applies in every template and right away.');
  });

  it("the page header's Save writes the catalog lift and returns to the editor", async () => {
    const ui = await openLiftPage();
    await fireEvent.press(ui.getByTestId('lift-category-isolation'));
    await fireEvent.press(ui.getByTestId('lift-save-header'));
    await waitFor(() => expect(mockEditCatalogExercise).toHaveBeenCalledWith('e1', { category: 'isolation' }));
    await waitFor(() => expect(ui.getByTestId('template-name')).toBeTruthy());
    expect(ui.getByTestId('save-template')).toBeTruthy();
  });
});

describe('the first-run ways in (H9/T19, J4)', () => {
  it('"Build your own" on the empty Next-up card opens a new template', async () => {
    mockState.templates = [];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('next-up-build-own'));
    await waitFor(() => expect(ui.getByTestId('template-name')).toBeTruthy());
    expect(ui.getByTestId('template-name').props.value).toBe('');
    expect(ui.getByText('New template')).toBeTruthy();
  });

  it("the starter toast's Edit opens the clone in the editor", async () => {
    mockState.templates = [];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('next-up-starters'));
    const button = ui.getAllByTestId(/^use-starter-/)[0];
    const key = String(button.props.testID).replace(/^use-starter-/, '');
    await fireEvent.press(button);
    await waitFor(() => expect(mockClone).toHaveBeenCalled());
    // The clone lands through the templates listener.
    mockState.templates = [{ ...pushDay, id: 'clone-1', name: 'Full Body', seedKey: key }];
    await ui.rerender(<TrainScreen />);
    const opts = mockShowToast.mock.calls.at(-1)![1] as { action: { label: string; onPress: () => void } };
    expect(opts.action.label).toBe('Edit');
    await act(async () => opts.action.onPress());
    await waitFor(() => expect(ui.getByTestId('template-name').props.value).toBe('Full Body'));
  });
});
