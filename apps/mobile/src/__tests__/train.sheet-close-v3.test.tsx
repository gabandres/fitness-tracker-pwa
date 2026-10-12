import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { SheetHeader } from '@/components/SheetHeader';
import { CardioPickerSheet } from '@/components/train/CardioPickerSheet';
import { ReorderExercisesSheet } from '@/components/train/ReorderExercisesSheet';
import { SetRowSheet } from '@/components/train/SetRowSheet';
import type { SessionExercise, WorkoutSet } from '@/lib/workout';

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

/**
 * v3 QA item 6: four sheets had no visible way out but the grabber — Reorder
 * exercises, the set sheet, the cardio picker (and Add exercise, covered in
 * `train.rescore3`). Each now has a header button that closes it. And the
 * header no longer indents a title with no leading button (the weekly-volume
 * title hung under an empty 44pt slot).
 */

it('the set sheet has a Done that closes it', async () => {
  const onClose = jest.fn();
  const ui = await render(
    <SetRowSheet visible set={{ kind: 'working' } as WorkoutSet} label="1" onClose={onClose} onKind={jest.fn()} onRir={jest.fn()} onRemove={jest.fn()} />,
  );
  expect(ui.getByTestId('set-sheet-done')).toHaveTextContent('Done');
  await fireEvent.press(ui.getByTestId('set-sheet-done'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('the cardio picker has a Cancel that closes it without picking', async () => {
  const onClose = jest.fn();
  const onPick = jest.fn();
  const ui = await render(<CardioPickerSheet visible onClose={onClose} onPick={onPick} />);
  await fireEvent.press(ui.getByTestId('cardio-picker-cancel'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onPick).not.toHaveBeenCalled();
});

it('Reorder exercises has a Done that closes it', async () => {
  const onClose = jest.fn();
  const exercises = [
    { exerciseId: 'a', name: 'Bench', sets: [] },
    { exerciseId: 'b', name: 'Row', sets: [] },
  ] as unknown as SessionExercise[];
  const ui = await render(<ReorderExercisesSheet visible exercises={exercises} onMove={jest.fn()} onClose={onClose} />);
  await fireEvent.press(ui.getByTestId('reorder-done'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('a header with no leading button starts with its title — no empty slot before it', async () => {
  // Default text size (the jest window reports fontScale 2, the stacked form).
  const rn = jest.requireActual<typeof import('react-native')>('react-native');
  jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  const ui = await render(<SheetHeader testID="hdr" title="Myo-rep clusters by muscle" trailing={{ label: 'Done', onPress: jest.fn() }} />);
  const row = ui.getByTestId('hdr');
  // Title, then the trailing slot: two children, the title first.
  expect(row.children).toHaveLength(2);
  expect(row.children[0]).toHaveTextContent('Myo-rep clusters by muscle');
  jest.restoreAllMocks();
});
