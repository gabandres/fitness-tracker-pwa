import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { Exercise, WorkoutSession } from '@/lib/workout';

/**
 * Train UX pass, 2026-10-11 — the home, read-only sheets and progression
 * surfaces (fix agent D). What is pinned here:
 *
 * - session detail lists the warm-up / drop sets its set count includes (H3),
 *   and every read-only sheet has a visible Done (H7);
 * - Lift settings: visible Cancel, unsaved edits asked about before they are
 *   thrown away (X5), the real cluster credit under the tags (X1), a tap way
 *   to change the primary muscle (X10), honest equipment (X7), "auto"
 *   placeholders (X9);
 * - exercise detail: delete through the named confirm sheet (X11), edits
 *   guarded the same way (X5);
 * - the glossary reads each term as one stop and defines myo-rep clusters (H12).
 */

const mockConfirm = jest.fn();

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn() }));

import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';
import { ExerciseDetailSheet } from '@/components/train/ExerciseDetailSheet';
import { SessionDetailSheet } from '@/components/train/SessionDetailSheet';
import { TrainGlossary } from '@/components/TrainGlossary';

const at = new Date('2026-10-10T18:00:00Z');

const lift = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'x1',
  name: 'Seated Cable Row',
  muscles: ['back'],
  defaultCues: [],
  logStyle: 'weight-reps',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

beforeEach(() => mockConfirm.mockReset());

describe('session detail', () => {
  const session = {
    id: 's1', status: 'completed', templateName: 'Upper A', date: at, createdAt: at, updatedAt: at,
    exercises: [{
      exerciseId: 'b', name: 'Bench Press', logStyle: 'weight-reps', cues: [],
      sets: [
        { kind: 'warmup', weight: 95, reps: 8 },
        { kind: 'working', weight: 135, reps: 8 },
        { kind: 'working', weight: 135, reps: 7 },
        { kind: 'drop', weight: 115, reps: 6 },
      ],
    }],
  } as unknown as WorkoutSession;

  it('lists the warm-up and drop sets the "4 sets" tile counts, and Done closes it (H3, H7)', async () => {
    const onClose = jest.fn();
    const ui = await render(
      <SessionDetailSheet visible session={session} history={[session]} onClose={onClose} onEdit={jest.fn()} onShare={jest.fn()} onDelete={jest.fn()} />,
    );
    expect(ui.getByText('135×8   135×7')).toBeTruthy();
    expect(ui.getByTestId('detail-other-sets-0')).toHaveTextContent('Warm-up 95×8 · Drop 115×6');
    await fireEvent.press(ui.getByTestId('session-detail-done'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('lift settings', () => {
  function sheet(exercise: Exercise) {
    const onClose = jest.fn();
    const onSave = jest.fn().mockResolvedValue(undefined);
    return { ui: render(<LiftSettingsSheet visible exercise={exercise} onClose={onClose} onSave={onSave} />), onClose, onSave };
  }

  it('Cancel with nothing changed just closes', async () => {
    const { ui, onClose } = sheet(lift());
    await fireEvent.press((await ui).getByTestId('lift-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('Cancel over an unsaved change asks first, naming the lift (X5)', async () => {
    const { ui, onClose } = sheet(lift());
    const r = await ui;
    await fireEvent.press(r.getByTestId('lift-effort-rir1'));
    await fireEvent.press(r.getByTestId('lift-cancel'));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard changes to Seated Cable Row?', destructive: true }));
    mockConfirm.mock.calls[0][0].onConfirm();
    expect(onClose).toHaveBeenCalled();
  });

  it('says what the cluster count really credits, and where it came from (X1)', async () => {
    const r = await sheet(lift({ name: 'Romanian Deadlift', muscles: ['glutes'], setStructure: 'myoreps' })).ui;
    // The TAGS win (S23-12, owner 2026-10-12, ADR-0046): a Romanian deadlift
    // tagged Glutes counts glutes only — the name table no longer overrides
    // the tag, so no hamstrings. (It said "Hamstrings 1 · Glutes ½" until then.)
    expect(r.getByTestId('lift-muscle-credit')).toHaveTextContent('This week by muscle counts it as: Glutes 1', { exact: false });
    expect(r.getByTestId('lift-muscle-credit')).not.toHaveTextContent(/Hamstrings/);
    // The tags decided, so the line no longer says it came from the name.
    expect(r.getByTestId('lift-muscle-credit')).not.toHaveTextContent(/from the exercise name/);
    expect(r.getByText('The first one you tap is the primary muscle; superset pairing uses it. Long-press a tag to make it primary.')).toBeTruthy();
  });

  it('an UNTAGGED lift is credited from its name, and the line says so (S23-12)', async () => {
    const r = await sheet(lift({ name: 'Romanian Deadlift', muscles: [], setStructure: 'myoreps' })).ui;
    expect(r.getByTestId('lift-muscle-credit')).toHaveTextContent(/Hamstrings 1/);
    expect(r.getByTestId('lift-muscle-credit')).toHaveTextContent(/from the exercise name/);
  });

  it('a lift with no cluster planned gets no cluster-credit line, and the hint does not name the metric (J-N1)', async () => {
    const r = await sheet(lift({ name: 'Bench Press', muscles: ['chest'] })).ui;
    expect(r.queryByTestId('lift-muscle-credit')).toBeNull();
    expect(r.queryByText(/This week by muscle/)).toBeNull();
  });

  it('the template row decides it: an activation set in the plan shows the line (J-N1)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const r = await render(
      <LiftSettingsSheet visible exercise={lift({ name: 'Bench Press', muscles: ['chest'] })} templateRow={{ name: 'Bench Press', plannedSets: [{ kind: 'activation' }, { kind: 'mini' }] }} onClose={jest.fn()} onSave={onSave} />,
    );
    expect(r.getByTestId('lift-muscle-credit')).toBeTruthy();
  });

  it('titles the sheet with the lift, "Lift settings" under it; one Cancel, Save in the header and the foot (H-N15, J-N9)', async () => {
    const r = await sheet(lift()).ui;
    expect(r.getByRole('header')).toHaveTextContent('Seated Cable Row');
    expect(r.getByTestId('lift-subtitle')).toHaveTextContent('Lift settings');
    expect(r.getAllByText('Cancel')).toHaveLength(1);
    expect(r.getByTestId('lift-save-header')).toBeTruthy();
    expect(r.getByTestId('lift-save')).toBeTruthy();
    // The sheet is not the editor's page: no scope hint.
    expect(r.queryByTestId('lift-scope-hint')).toBeNull();
  });

  it('names a finer muscle by the chip it sits under — "Shoulders (front)", never "Front delt" (QA v2 item 6)', async () => {
    // Tagged with all three: since S23-12 an untagged muscle is not credited.
    const r = await sheet(lift({ name: 'Bench Press', muscles: ['chest', 'triceps', 'shoulders'], setStructure: 'myoreps' })).ui;
    expect(r.getByTestId('lift-muscle-credit')).toHaveTextContent('counts it as: Chest 1 · Triceps ½ · Shoulders (front) ½', { exact: false });
    expect(r.getByTestId('lift-muscle-credit')).not.toHaveTextContent(/delt/i);
  });

  it('a tag with no name match credits the tags, primary first', async () => {
    const r = await sheet(lift({ name: 'Mystery Move', muscles: ['chest', 'triceps'], setStructure: 'cluster' })).ui;
    expect(r.getByTestId('lift-muscle-credit')).toHaveTextContent('counts it as: Chest 1 · Triceps ½', { exact: false });
    expect(r.getByTestId('lift-muscle-credit')).not.toHaveTextContent(/from the exercise name/);
  });

  it('changes the primary muscle with a visible tap, not only a long-press (X10)', async () => {
    const { ui, onSave } = sheet(lift({ name: 'Mystery Move', muscles: ['chest', 'triceps'] }));
    const r = await ui;
    expect(r.getByTestId('lift-muscle-primary-next')).toHaveTextContent('Primary: Chest · Change');
    // Change opens the tagged muscles as a choice — it does not rotate (H-N14).
    expect(r.queryByTestId('lift-muscle-primary-triceps')).toBeNull();
    await fireEvent.press(r.getByTestId('lift-muscle-primary-next'));
    expect(r.getByTestId('lift-muscle-primary-next')).toHaveTextContent('Primary: Chest · Change');
    expect(r.getByTestId('lift-muscle-primary-chest').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(r.getByTestId('lift-muscle-primary-triceps'));
    expect(r.getByTestId('lift-muscle-primary-next')).toHaveTextContent('Primary: Triceps · Change');
    expect(r.queryByTestId('lift-muscle-primary-triceps')).toBeNull();
    await fireEvent.press(r.getByTestId('lift-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ muscles: ['triceps', 'chest'] }));
  });

  it('says when the name named no equipment, instead of "Equipment: other" (X7)', async () => {
    const r = await sheet(lift({ name: 'Mystery Move' })).ui;
    expect(r.getByTestId('lift-effective-equipment')).toHaveTextContent(/^Equipment: not recognised from the name — steps default to /);
    // …and no "Step: 5 lb" under it saying the same again (H-N15).
    expect(r.queryByTestId('lift-effective-steps')).toBeNull();
    const cable = await sheet(lift()).ui;
    expect(cable.getAllByTestId('lift-effective-equipment').at(-1)).toHaveTextContent(/ — from the name$/);
  });

  it('the rep-range fields say "auto", not a number that reads as typed (X9)', async () => {
    const r = await sheet(lift()).ui;
    expect(r.getByTestId('lift-range-min').props.placeholder).toBe('auto');
    expect(r.getByTestId('lift-range-max').props.placeholder).toBe('auto');
  });
});

describe('exercise detail', () => {
  const train = {
    recentSessions: [], catalog: [lift()], templates: [],
    editCatalogExercise: jest.fn().mockResolvedValue(undefined),
    deleteCatalogExercise: jest.fn().mockResolvedValue(undefined),
    mergeCatalogExercises: jest.fn().mockResolvedValue(undefined),
  };

  it('deletes through a named confirm that says what goes (X11)', async () => {
    const ui = await render(<ExerciseDetailSheet visible exercise={lift()} train={train} onClose={jest.fn()} />);
    await fireEvent.press(ui.getByTestId('exercise-delete'));
    expect(train.deleteCatalogExercise).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delete Seated Cable Row?',
      body: 'Its lift settings and muscle tags are deleted. Past workouts keep the name.',
      destructive: true,
    }));
    mockConfirm.mock.calls[0][0].onConfirm();
    await waitFor(() => expect(train.deleteCatalogExercise).toHaveBeenCalledWith('x1'));
  });

  it('hides the cluster credit on a straight-set lift (J-N1)', async () => {
    const ui = await render(<ExerciseDetailSheet visible exercise={lift()} train={train} onClose={jest.fn()} />);
    await fireEvent.press(ui.getByTestId('exercise-edit'));
    expect(ui.queryByTestId('exercise-muscle-credit')).toBeNull();
    expect(ui.getAllByText('Save')).toHaveLength(1);
  });

  it('shows the cluster credit while editing tags, and Done closes the view (X1, H7)', async () => {
    const onClose = jest.fn();
    // Tagged Back, Shoulders, Biceps: the row table refines Shoulders to the
    // rear delt (S23-12 — only tagged muscles count).
    const ui = await render(<ExerciseDetailSheet visible exercise={lift({ setStructure: 'myoreps', muscles: ['back', 'shoulders', 'biceps'] })} train={train} onClose={onClose} />);
    await fireEvent.press(ui.getByTestId('exercise-edit'));
    expect(ui.getByTestId('exercise-muscle-credit')).toHaveTextContent('counts it as: Back 1 · Shoulders (rear) ½ · Biceps ½', { exact: false });
    await fireEvent.press(ui.getByTestId('exercise-cancel-header'));
    await fireEvent.press(ui.getByTestId('exercise-done'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('glossary', () => {
  it('reads a term as one stop, defines myo-rep clusters, and has a Done (H12, H7)', async () => {
    const onClose = jest.fn();
    const ui = await render(<TrainGlossary visible onClose={onClose} />);
    expect(ui.getByLabelText(/^Myo-rep cluster\. One hard set close to failure/)).toBeTruthy();
    expect(ui.getByLabelText(/^Rep range\. /)).toBeTruthy();
    expect(ui.getByTestId('train-glossary-title')).toHaveTextContent('Training terms');
    await fireEvent.press(ui.getByTestId('train-glossary-title-done'));
    expect(onClose).toHaveBeenCalled();
  });
});
