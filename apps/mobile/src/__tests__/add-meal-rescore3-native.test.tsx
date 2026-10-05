import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { DailyLog, LogEntry } from '@macrolog/core';

/**
 * The add-meal re-score, third pass — what a 1.2.5 binary draws natively
 * (`NativeDateField`, the system context menu), stubbed so the JS around it
 * can be pinned without a device:
 *
 * - gap 10: the entry date row uses the system date picker, keeping the time.
 * - gap 12: beside the native time picker the four ± steppers step aside.
 * - bug 3: a native time change plays ONE selection tick (the picker's own).
 * - gap 11: browse rows and Quick add chips lift a preview with all macros.
 */

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
const mockSelection = jest.fn();
jest.mock('@/lib/haptics', () => ({
  tap: jest.fn(),
  success: jest.fn(),
  warn: jest.fn(),
  warning: jest.fn(),
  selection: () => mockSelection(),
  tapThenOutcome: jest.fn(),
  removed: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

// The picker module present. Each stub field is a button that "picks" the
// value the test puts in `mockPick[testID]`.
const mockPick: Record<string, Date> = {};
jest.mock('@/components/NativeDatePicker', () => {
  const { TouchableOpacity } = require('react-native');
  return {
    hasNativeDateField: true,
    NativeDateField: ({ testID, onChange }: { testID: string; onChange: (d: Date) => void }) => (
      <TouchableOpacity testID={testID} onPress={() => onChange(mockPick[testID])} />
    ),
  };
});

// The system context menu present, drawing its preview in place with a
// button for the preview's tap.
jest.mock('@/components/ContextMenu', () => {
  const { TouchableOpacity, View } = require('react-native');
  return {
    CONTEXT_MENUS: true,
    ContextMenu: ({
      children,
      preview,
      previewSize,
      onPreviewPress,
      title,
    }: {
      children: React.ReactNode;
      preview?: React.ReactNode;
      previewSize?: { width: number; height: number };
      onPreviewPress?: () => void;
      title?: string;
    }) => (
      <View>
        {children}
        {preview ? (
          <View testID={`menu-preview-${title}`} accessibilityHint={JSON.stringify(previewSize)}>
            {preview}
            <TouchableOpacity testID={`menu-preview-tap-${title}`} onPress={onPreviewPress} />
          </View>
        ) : null}
      </View>
    ),
  };
});

import { EntrySheet } from '@/components/EntrySheet';

beforeEach(() => mockSelection.mockClear());

const lunch: DailyLog = {
  id: 'e1',
  date: new Date(2026, 9, 3, 13, 30, 0),
  calories: 520,
  mealLabel: 'Rice and beans',
  mealType: 'lunch',
};

async function openEdit() {
  const onSave = jest.fn<Promise<void>, [LogEntry]>().mockResolvedValue(undefined);
  const screen = await render(
    <EntrySheet visible editing={lunch} onSave={onSave} onClose={jest.fn()} unitSystem="us" />,
  );
  return { screen, onSave };
}

it('moves the entry to the picked day and keeps its time (gap 10)', async () => {
  const { screen, onSave } = await openEdit();
  // The picker's own instant carries its own time; only the day is used.
  mockPick['entry-date-native'] = new Date(2026, 9, 1, 0, 0, 0);
  await fireEvent.press(screen.getByTestId('entry-date-native'));
  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const at = onSave.mock.calls[0][0].timestamp!;
  expect([at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([9, 1, 13, 30]);
  // The ±1 steppers stay for the common yesterday.
  expect(screen.getByTestId('entry-date-prev')).toBeTruthy();
});

it('the native time picker stands alone, and a change from it ticks once (gap 12, bug 3)', async () => {
  const { screen, onSave } = await openEdit();
  expect(screen.queryByTestId('entry-time-minus-hour')).toBeNull();
  expect(screen.queryByTestId('entry-time-plus-min')).toBeNull();
  mockPick['entry-time-native'] = new Date(2026, 9, 3, 16, 15, 0);
  await fireEvent.press(screen.getByTestId('entry-time-native'));
  // The picker plays the tick (`NativeDateField`); the sheet adds none on iOS.
  expect(mockSelection).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('entry-save'));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const at = onSave.mock.calls[0][0].timestamp!;
  expect([at.getHours(), at.getMinutes()]).toEqual([16, 15]);
});

it('a browse row lifts a preview with every macro, and its tap reviews the food (gap 11)', async () => {
  const bowl: DailyLog = { id: 'r1', calories: 640, protein: 45, carbs: 68, fat: 18, mealLabel: 'Chicken bowl', date: new Date() };
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" recentEntries={[bowl]} />,
  );
  const preview = screen.getByTestId('menu-preview-Chicken bowl');
  // The test renderer reports a font scale of 2; the box grows with the text
  // only to its 1.3 cap (176 × 1.3), the same cap the preview's text carries.
  expect(JSON.parse(preview.props.accessibilityHint)).toEqual({ width: 320, height: 229 });
  expect(screen.getByText('68 g')).toBeTruthy();
  expect(screen.getByText('18 g')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('menu-preview-tap-Chicken bowl'));
  expect(screen.getByTestId('entry-label').props.value).toBe('Chicken bowl');
});

it('a Quick add chip lifts one too, captioned as Quick add', async () => {
  const screen = await render(
    <EntrySheet
      visible
      editing={null}
      onSave={jest.fn()}
      onClose={jest.fn()}
      unitSystem="us"
      presets={[{ id: 'p1', name: 'Protein shake', calories: 160, protein: 30, carbs: 4, fat: 2 }]}
    />,
  );
  expect(screen.getByTestId('menu-preview-Protein shake')).toBeTruthy();
  expect(screen.getAllByText('Quick add').length).toBeGreaterThan(1);
  expect(screen.getByText('4 g')).toBeTruthy();
});
