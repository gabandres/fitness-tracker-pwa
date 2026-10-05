import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { LOG_LABEL_MAX, type CustomFood, type DailyLog, type MealPreset } from '@macrolog/core';

/**
 * The add-meal review (S20), pinned where a regression would be silent:
 *
 * - B1: the rules' ceilings are said on the form before Save is possible — the
 *   name field stops at 100, a long pick lands capped, kcal ≥ 20000 and a
 *   macro ≥ 1000 block Save with a line saying why.
 * - U7: 0 kcal saves once the entry is named.
 * - B5: an English `1,250` is 1250 kcal.
 * - U3 / U4: ⊕ on a search hit and a typed "350 40p" each log in one tap.
 * - B6, B7, C2, U8 and the per-slot add row's preselected slot.
 */

// iOS presents this sheet natively, through a route this test does not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());

const mockSearchFoods = jest.fn();
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
let mockLocale: string | undefined;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockLocale ? { preferredLocale: mockLocale } : null }),
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
let mockScanner: { onPick: (est: unknown) => void; onSearchByName?: () => void } | null = null;
jest.mock('@/components/BarcodeScanner', () => ({
  BarcodeScanner: (p: { onPick: (est: unknown) => void; onSearchByName?: () => void }) => {
    mockScanner = p;
    return null;
  },
}));
const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
  ToastSheetHost: () => null,
}));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) }));

import { EntrySheet } from '@/components/EntrySheet';

const bananaHit = {
  source: 'usda',
  id: 'b1',
  description: 'Banana, raw',
  dataType: 'sr_legacy',
  servings: [
    { label: '1 medium (118 g)', grams: 118, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, kind: 'portion' },
    { label: '100 g', grams: 100, kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, kind: 'per100g' },
  ],
};

beforeEach(() => {
  mockLocale = undefined;
  mockScanner = null;
  mockSearchFoods.mockReset().mockResolvedValue([]);
  mockShowToast.mockReset();
  mockConfirm.mockReset();
});

async function openForm(onSave = jest.fn().mockResolvedValue(undefined)) {
  const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('open-manual'));
  return { screen, onSave };
}

const saveState = (screen: Awaited<ReturnType<typeof openForm>>['screen']) =>
  screen.getByTestId('entry-save').props.accessibilityState;

describe('B1 — the rules’ bounds, on the form', () => {
  it('caps the name field at the rules’ 100 characters', async () => {
    const { screen } = await openForm();
    expect(screen.getByTestId('entry-label').props.maxLength).toBe(LOG_LABEL_MAX);
  });

  it('lands a 150-character food name capped, and saves it capped', async () => {
    const long = `Restaurant platter ${'with extra sides '.repeat(8)}`.trim();
    expect(long.length).toBeGreaterThan(LOG_LABEL_MAX);
    mockSearchFoods.mockResolvedValue([{ ...bananaHit, description: long, servings: [bananaHit.servings[0]] }]);
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'platter');
    await fireEvent.press(await waitFor(() => screen.getByText(long)));

    const label = screen.getByTestId('entry-label').props.value as string;
    expect(Array.from(label).length).toBe(LOG_LABEL_MAX);
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(Array.from(onSave.mock.calls[0][0].mealLabel as string).length).toBeLessThanOrEqual(LOG_LABEL_MAX);
  });

  it('blocks 20000 kcal with a line saying why, and allows 19999', async () => {
    const { screen, onSave } = await openForm();
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '20000');
    expect(screen.getByTestId('entry-kcal-error')).toBeTruthy();
    expect(saveState(screen)).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByTestId('entry-save').props.accessibilityHint).toBe('Fix the number marked in red to add.');
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onSave).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('entry-calories'), '19999');
    expect(screen.queryByTestId('entry-kcal-error')).toBeNull();
    expect(saveState(screen)).toEqual(expect.objectContaining({ disabled: false }));
  });

  it('blocks a macro of 1000 g and names which one', async () => {
    const { screen } = await openForm();
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '400');
    await fireEvent.changeText(screen.getByTestId('entry-carbs'), '1000');
    expect(screen.getByTestId('entry-macro-error').props.children).toMatch(/Carbs can be up to 999 g/);
    expect(saveState(screen)).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.changeText(screen.getByTestId('entry-carbs'), '999');
    expect(screen.queryByTestId('entry-macro-error')).toBeNull();
  });

  it('says why Save is off when calories are empty', async () => {
    const { screen } = await openForm();
    expect(screen.getByTestId('entry-save').props.accessibilityHint).toBe('Enter calories to add.');
  });
});

describe('U7 — zero calories', () => {
  it('saves 0 kcal once the entry is named, and says so until it is', async () => {
    const { screen, onSave } = await openForm();
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '0');
    expect(saveState(screen)).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByTestId('entry-save-hint').props.children).toBe('Give it a name to log 0 kcal.');

    await fireEvent.changeText(screen.getByTestId('entry-label'), 'Black coffee');
    expect(screen.queryByTestId('entry-save-hint')).toBeNull();
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ calories: 0, mealLabel: 'Black coffee' });
  });
});

describe('B5 — numbers in the user’s locale', () => {
  it('saves an English 1,250 as 1250, not 1.25', async () => {
    const { screen, onSave } = await openForm();
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '1,250');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].calories).toBe(1250);
  });

  it('prefills a pt-BR form with comma decimals, and sentence-cases the slots', async () => {
    mockLocale = 'pt-BR';
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('portion-0'));
    await fireEvent.changeText(screen.getByTestId('entry-grams'), '236');
    expect(screen.getByTestId('entry-protein').props.value).toBe('2,6');
    expect(screen.getByText('Café da manhã')).toBeTruthy();
  });
});

describe('U4 — a typed calorie count', () => {
  it('offers "Log 350 kcal" for "350 40p" and logs it in one tap', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={onClose} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), '350 40p');

    const row = await waitFor(() => screen.getByTestId('search-quick-add'));
    expect(screen.getByText('Log 350 kcal')).toBeTruthy();
    // Spoken as a word: "kcal" is read letter by letter (A5).
    expect(row.props.accessibilityLabel).toBe('Log 350 calories, 40 g protein');
    await fireEvent.press(row);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 350, protein: 40 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('logs it from the keyboard’s Return too', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), '350');
    await fireEvent(screen.getByTestId('food-search-input'), 'submitEditing');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 350 }));
  });

  it('is not offered for a food name', async () => {
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    expect(screen.queryByTestId('search-quick-add')).toBeNull();
  });
});

describe('U3 — ⊕ on a search hit', () => {
  it('logs the default portion without the picker or the form', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    const add = await waitFor(() => screen.getByTestId('search-hit-add-usda-b1'));
    expect(add.props.accessibilityLabel).toMatch(/^Log Banana, raw, 1 medium \(118 g\), 105 calories/);

    await fireEvent.press(add);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 105, protein: 1, carbs: 27, mealLabel: 'Banana, raw' }),
    );
    expect(screen.queryByTestId('portion-0')).toBeNull();
  });
});

describe('the slot a per-slot add row opened the sheet for', () => {
  it('preselects it on the form and files a one-tap log into it', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const prefill = { mealType: 'lunch' } as unknown as Parameters<typeof EntrySheet>[0]['initialPrefill'];
    const screen = await render(
      <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} initialPrefill={prefill} />,
    );
    // No numbers in the prefill: the search, not the form.
    await fireEvent.changeText(screen.getByTestId('food-search-input'), '200');
    await fireEvent.press(await waitFor(() => screen.getByTestId('search-quick-add')));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 200, mealType: 'lunch' }));
  });

  it('opens the form on that slot, checked', async () => {
    const prefill = { mealType: 'dinner' } as unknown as Parameters<typeof EntrySheet>[0]['initialPrefill'];
    const screen = await render(
      <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} initialPrefill={prefill} />,
    );
    await fireEvent.press(screen.getByTestId('open-manual'));
    // A radio group to a screen reader (A2), with the slot checked.
    expect(screen.getByTestId('meal-type-dinner').props.accessibilityRole).toBe('radio');
    expect(screen.getByTestId('meal-type-dinner').props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe('B6 — Manage, per section', () => {
  const preset: MealPreset = { id: 'p1', name: 'Oats', calories: 300, protein: 10 };
  const recentLog: DailyLog = { id: 'r1', calories: 120, mealLabel: 'Yogurt', date: new Date('2026-10-01') };

  it('puts only its own section into remove mode, and names it', async () => {
    const screen = await render(
      <EntrySheet
        visible
        editing={null}
        onSave={jest.fn()}
        onClose={jest.fn()}
        presets={[preset]}
        recentEntries={[recentLog]}
        onDeletePreset={jest.fn()}
        onHideRecent={jest.fn()}
      />,
    );
    expect(screen.getByTestId('manage-quick-add').props.accessibilityLabel).toBe('Manage Quick add');
    expect(screen.getByTestId('manage-recents').props.accessibilityLabel).toBe('Manage recents');

    await fireEvent.press(screen.getByTestId('manage-quick-add'));
    expect(screen.getByTestId('preset-p1').props.accessibilityLabel).toBe('Remove: Oats');
    expect(screen.getByTestId('recent-r1').props.accessibilityLabel).not.toMatch(/^Remove/);
  });
});

describe('B7 — a one-tap log that fails', () => {
  it('says so with a Retry that tries again', async () => {
    const onSave = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const preset: MealPreset = { id: 'p1', name: 'Oats', calories: 300 };
    const screen = await render(
      <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} presets={[preset]} />,
    );
    await fireEvent.press(screen.getByTestId('preset-p1'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [message, opts] = mockShowToast.mock.calls[0] as [string, { action: { label: string; onPress: () => void } }];
    expect(message).toBe("Couldn't log Oats.");
    expect(opts.action.label).toBe('Retry');

    await act(async () => opts.action.onPress());
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});

describe('C2 — the discard confirm', () => {
  it('names what is lost and keeps the work behind "Keep editing"', async () => {
    const { screen } = await openForm();
    expect(screen.getByText('Write it in', { exact: true })).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('entry-label'), 'Arroz con habichuelas');
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '450');
    await fireEvent.press(screen.getByTestId('custom-back'));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Discard this entry?',
        body: "“Arroz con habichuelas” and the numbers you typed won't be saved.",
        confirmText: 'Discard',
        cancelText: 'Keep editing',
      }),
    );
  });
});

describe('U8 — barcode', () => {
  const saved: CustomFood = {
    id: '0123456789012',
    name: 'Protein bar',
    servingSize: 1,
    servingUnit: 'serving',
    calories: 210,
    protein: 20,
    barcode: '0123456789012',
    source: 'barcode',
    createdAt: new Date('2026-09-01'),
  };

  it('logs a code already in My Foods straight away (+ → barcode → done)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const screen = await render(
      <EntrySheet visible editing={null} onSave={onSave} onClose={onClose} customFoods={[saved]} />,
    );
    await fireEvent.press(screen.getByTestId('search-scan-barcode'));
    await act(async () =>
      mockScanner!.onPick({
        calories: 210,
        protein: 20,
        mealLabel: 'Protein bar',
        serving: { source: 'barcode', barcode: '0123456789012' },
      }),
    );
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 210, protein: 20, mealLabel: 'Protein bar' }));
    // Logged at once; on iOS the sheet's close waits for the scanner's Modal
    // to slide away (SCANNER_EXIT_MS), so the two do not dismiss in one tick.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByTestId('entry-calories')).toBeNull();
  });

  it('wires "Search by name" back to the search field', async () => {
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('search-scan-barcode'));
    expect(mockScanner?.onSearchByName).toBeInstanceOf(Function);
    await act(async () => mockScanner!.onSearchByName!());
    expect(screen.getByTestId('food-search-input')).toBeTruthy();
  });
});
