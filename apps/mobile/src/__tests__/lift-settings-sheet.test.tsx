import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { Exercise } from '@/lib/workout';

/**
 * Lift settings — the per-lift configuration the rewritten progression engine
 * reads (2026-10-07). What is pinned here:
 *
 * - every field shows its DEFAULT rather than a blank, and returning to it
 *   sends `null` (a field delete), never a stale override;
 * - only what changed is written — an untouched sheet writes nothing;
 * - the "What the engine uses" block is `resolveEngineConfig` over the draft;
 * - the equipment-specific fields appear only where they mean something.
 */

let mockProfile: { unitSystem?: string } | null = null;

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }) }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn() }));

import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';

const lift = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'x1',
  name: 'Seated Cable Row',
  muscles: ['back'],
  defaultCues: [],
  logStyle: 'weight-reps',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

function renderSheet(exercise: Exercise, onSave = jest.fn().mockResolvedValue(undefined)) {
  const onClose = jest.fn();
  const ui = render(<LiftSettingsSheet visible exercise={exercise} onClose={onClose} onSave={onSave} />);
  return { ui, onSave, onClose };
}

beforeEach(() => {
  mockProfile = null;
});

it('shows the inferred category and the category default range, and an untouched save writes nothing', async () => {
  const { ui, onSave, onClose } = renderSheet(lift());
  const r = await ui;
  expect(r.getByTestId('lift-category-auto')).toHaveTextContent('Auto (Compound)');
  expect(r.getByTestId('lift-range-hint')).toHaveTextContent(/^Category default: 6–12 reps\./);
  expect(r.getByTestId('lift-effective')).toHaveTextContent(/Compound — inferred from the name/);
  expect(r.getByTestId('lift-effective')).toHaveTextContent(/6–12 reps — category default/);

  await fireEvent.press(r.getByTestId('lift-save'));
  expect(onSave).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

it('sets a category and a rep range, and the effective block follows the draft', async () => {
  const { ui, onSave } = renderSheet(lift());
  const r = await ui;
  await fireEvent.press(r.getByTestId('lift-category-isolation'));
  expect(r.getByTestId('lift-range-hint')).toHaveTextContent(/^Category default: 8–15 reps\./);
  await fireEvent.changeText(r.getByTestId('lift-range-min'), '10');
  await fireEvent.changeText(r.getByTestId('lift-range-max'), '14');
  expect(r.getByTestId('lift-effective')).toHaveTextContent(/10–14 reps — your range/);

  await fireEvent.press(r.getByTestId('lift-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ category: 'isolation', repRange: { min: 10, max: 14 } }));
});

it('returns every overridden field to its default with null', async () => {
  const { ui, onSave } = renderSheet(lift({
    name: 'Smith squat',
    category: 'compound',
    repRange: { min: 5, max: 8 },
    availableLoads: [10, 20, 30],
    smithBarEffectiveLb: 15,
    microplates: true,
  }));
  const r = await ui;
  await fireEvent.press(r.getByTestId('lift-category-auto'));
  await fireEvent.press(r.getByTestId('lift-range-clear'));
  await fireEvent.changeText(r.getByTestId('lift-steps'), '');
  await fireEvent.changeText(r.getByTestId('lift-smith-bar'), '');
  await fireEvent(r.getByTestId('lift-microplates'), 'valueChange', false);
  await fireEvent.press(r.getByTestId('lift-save'));

  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    category: null,
    repRange: null,
    availableLoads: null,
    smithBarEffectiveLb: null,
    microplates: null,
  }));
});

it('refuses an inverted rep range and a load that is not a number', async () => {
  const { ui, onSave } = renderSheet(lift());
  const r = await ui;
  await fireEvent.changeText(r.getByTestId('lift-range-min'), '12');
  await fireEvent.changeText(r.getByTestId('lift-range-max'), '8');
  expect(r.getByTestId('lift-range-hint')).toHaveTextContent(/1 to 100/);
  expect(r.getByTestId('lift-save')).toBeDisabled();

  await fireEvent.changeText(r.getByTestId('lift-range-max'), '15');
  await fireEvent.changeText(r.getByTestId('lift-steps'), '10, abc');
  expect(r.getByTestId('lift-steps-error')).toHaveTextContent('Not a load: abc');
  expect(r.getByTestId('lift-save')).toBeDisabled();
  await fireEvent.press(r.getByTestId('lift-save'));
  expect(onSave).not.toHaveBeenCalled();
});

it('reads load steps comma or space separated, ascending, and says a stack has no default', async () => {
  const { ui, onSave } = renderSheet(lift());
  const r = await ui;
  // A cable row is a stack: no default step to assume.
  expect(r.getByTestId('lift-steps-hint')).toHaveTextContent(/A stack has no default — enter its steps/);
  expect(r.getByTestId('lift-effective-steps')).toHaveTextContent(/a guess until you enter this stack's steps/);

  await fireEvent.changeText(r.getByTestId('lift-steps'), '25 15, 20 15');
  expect(r.getByTestId('lift-effective-steps')).toHaveTextContent('Steps: 15, 20, 25 lb');
  await fireEvent.press(r.getByTestId('lift-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ availableLoads: [15, 20, 25] }));
});

it('gives dumbbells their 5 lb default step', async () => {
  const r = await renderSheet(lift({ name: 'DB Lateral Raise' })).ui;
  expect(r.getByTestId('lift-steps-hint')).toHaveTextContent(/Dumbbells default to 5 lb steps/);
});

it('does not ask for a bar weight on a lift that is not a Smith machine', async () => {
  const r = await renderSheet(lift()).ui;
  expect(r.queryByTestId('lift-smith-bar')).toBeNull();
  expect(r.queryByTestId('lift-effective-approximate')).toBeNull();
});

it('asks for the Smith bar on a Smith lift, and calls predictions approximate until it is entered', async () => {
  const { ui, onSave } = renderSheet(lift({ name: 'Smith squat' }));
  const r = await ui;
  expect(r.getByTestId('lift-effective-approximate')).toBeTruthy();
  await fireEvent.changeText(r.getByTestId('lift-smith-bar'), '15');
  expect(r.queryByTestId('lift-effective-approximate')).toBeNull();
  await fireEvent.press(r.getByTestId('lift-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ smithBarEffectiveLb: 15 }));
});

it('converts a metric bar weight to the stored pounds', async () => {
  mockProfile = { unitSystem: 'metric' };
  const { ui, onSave } = renderSheet(lift({ name: 'Smith squat' }));
  const r = await ui;
  await fireEvent.changeText(r.getByTestId('lift-smith-bar'), '10');
  await fireEvent.press(r.getByTestId('lift-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0].smithBarEffectiveLb).toBeCloseTo(22.05, 1);
});

it('does not offer added load on a loaded lift', async () => {
  const r = await renderSheet(lift()).ui;
  expect(r.queryByTestId('lift-loadable')).toBeNull();
});

it('offers added load on a bodyweight lift', async () => {
  const { ui, onSave } = renderSheet(lift({ name: 'Pull-up', logStyle: 'bodyweight' }));
  const r = await ui;
  expect(r.getByTestId('lift-category-auto')).toHaveTextContent('Auto (Bodyweight)');
  await fireEvent(r.getByTestId('lift-loadable'), 'valueChange', true);
  await fireEvent(r.getByTestId('lift-microplates'), 'valueChange', true);
  await fireEvent.press(r.getByTestId('lift-effort-rir1'));
  await fireEvent.press(r.getByTestId('lift-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ loadable: true, microplates: true, effortStandard: 'rir1' }));
});
