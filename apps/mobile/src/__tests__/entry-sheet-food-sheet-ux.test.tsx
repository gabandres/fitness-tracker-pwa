import React from 'react';
import { Keyboard } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { CustomFood, DailyLog } from '@macrolog/core';

/**
 * The add-meal sheet's 2026-10-04 UX pass, pinned where a regression would be
 * silent: a saved food findable by typing, the search surviving a trip to the
 * review form, the scale row, library-save feedback, an inline save error, and
 * a stray dismissal no longer throwing typed input away.
 */

const mockSearchFoods = jest.fn();
// iOS presents this sheet natively, through a route this test does not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (...a: unknown[]) => mockNavigate(...a) } }));
// The scanner hands its props to the test, so a "scan" is a call to onPick.
let mockScanner: { visible: boolean; onPick: (est: unknown) => void } | null = null;
jest.mock('@/components/BarcodeScanner', () => ({
  BarcodeScanner: (p: { visible: boolean; onPick: (est: unknown) => void }) => {
    mockScanner = p;
    return null;
  },
}));
// The deferred focus is a 300 ms timer on a native ref; what matters here is
// WHEN the sheet asks for it, so the hook records its argument.
const mockDeferredFocus = jest.fn();
jest.mock('@/lib/use-deferred-focus', () => ({
  useDeferredFocus: (on: boolean) => {
    mockDeferredFocus(on);
    return jest.requireActual<typeof React>('react').useRef(null);
  },
}));

const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
  // BottomSheet draws toasts inside its Modal through this.
  ToastSheetHost: () => null,
}));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) }));

import { EntrySheet } from '@/components/EntrySheet';

const shake: CustomFood = {
  id: 'f1',
  name: 'Batido de proteína',
  servingSize: 1,
  servingUnit: 'serving',
  calories: 160,
  protein: 30,
  source: 'manual',
  createdAt: new Date('2026-09-01'),
};

const bananaHit = {
  source: 'usda',
  id: 'b1',
  description: 'Banana, raw',
  dataType: 'sr_legacy',
  servings: [
    {
      label: '1 medium (118 g)',
      grams: 118,
      kcal: 105,
      protein: 1.3,
      carbs: 27,
      fat: 0.4,
      kind: 'portion',
    },
    // A second portion, so the pick goes through the picker (a one-portion
    // food skips it — see the round 3 tests).
    { label: '100 g', grams: 100, kcal: 89, protein: 1.1, carbs: 23, fat: 0.3, kind: 'per100g' },
  ],
};

function recent(i: number): DailyLog {
  return {
    id: `r${i}`,
    calories: 100 + i,
    protein: 5,
    mealLabel: `Recent ${i}`,
    date: new Date('2026-10-01'),
  };
}

beforeEach(() => {
  mockScanner = null;
  mockDeferredFocus.mockReset();
  mockSearchFoods.mockReset().mockResolvedValue([]);
  mockShowToast.mockReset();
  mockConfirm.mockReset();
  mockNavigate.mockReset();
});

it('finds a saved food by typing, accent-blind, and logs it in one tap', async () => {
  const onSave = jest.fn();
  const screen = await render(
    <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} customFoods={[shake]} />,
  );

  await fireEvent.changeText(screen.getByTestId('food-search-input'), 'proteina');
  await fireEvent.press(screen.getByTestId('search-lib-customfood-f1'));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ calories: 160, protein: 30, mealLabel: shake.name }),
  );
});

it('keeps rows for My Foods however many recents there are', async () => {
  const recents = Array.from({ length: 15 }, (_, i) => recent(i));
  const screen = await render(
    <EntrySheet
      visible
      editing={null}
      onSave={jest.fn()}
      onClose={jest.fn()}
      recentEntries={recents}
      customFoods={[shake]}
    />,
  );
  expect(screen.getByTestId('customfood-f1')).toBeTruthy();
  // ...and recents still lead: the cap minus the reserved My Foods rows.
  expect(screen.getByTestId('recent-r10')).toBeTruthy();
  expect(screen.queryByTestId('recent-r11')).toBeNull();
});

it('returns from the review form to the same search, not an empty box', async () => {
  mockSearchFoods.mockResolvedValue([bananaHit]);
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />,
  );

  await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
  await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
  await fireEvent.press(screen.getByTestId('portion-0'));
  expect(screen.getByTestId('entry-calories').props.value).toBe('105');

  await fireEvent.press(screen.getByTestId('custom-back'));
  expect(screen.getByTestId('food-search-input').props.value).toBe('banana');
  expect(screen.getByText('Banana, raw')).toBeTruthy();
});

it('types a quantity in the portion step instead of only stepping by halves', async () => {
  mockSearchFoods.mockResolvedValue([bananaHit]);
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />,
  );

  await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
  await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
  await fireEvent.press(screen.getByTestId('food-qty-value'));
  await fireEvent.changeText(screen.getByTestId('food-qty-input'), '0,25');
  await fireEvent(screen.getByTestId('food-qty-input'), 'blur');
  await fireEvent.press(screen.getByTestId('portion-0'));

  expect(screen.getByTestId('entry-calories').props.value).toBe('26');
});

it('scales every macro in the form in place', async () => {
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />,
  );
  await fireEvent.press(screen.getByTestId('open-manual'));
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '250');
  await fireEvent.changeText(screen.getByTestId('entry-protein'), '21');
  await fireEvent.changeText(screen.getByTestId('entry-fat'), '3');

  await fireEvent.press(screen.getByTestId('entry-scale-0.5'));

  expect(screen.getByTestId('entry-calories').props.value).toBe('125');
  expect(screen.getByTestId('entry-protein').props.value).toBe('11');
  expect(screen.getByTestId('entry-fat').props.value).toBe('1.5');
});

it('confirms a My Foods save once, and a second tap does not write a duplicate', async () => {
  const onSaveCustomFood = jest.fn().mockResolvedValue(undefined);
  const screen = await render(
    <EntrySheet
      visible
      editing={null}
      onSave={jest.fn()}
      onClose={jest.fn()}
      onSaveCustomFood={onSaveCustomFood}
    />,
  );
  await fireEvent.press(screen.getByTestId('open-manual'));
  await fireEvent.changeText(screen.getByTestId('entry-label'), 'Overnight oats');
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '320');

  await fireEvent.press(screen.getByTestId('save-customfood'));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Saved to My Foods'));
  await fireEvent.press(screen.getByTestId('save-customfood'));

  expect(onSaveCustomFood).toHaveBeenCalledTimes(1);
});

it('says so in a toast with Retry when a save fails, not just with a haptic', async () => {
  const onSave = jest.fn().mockRejectedValue(new Error('boom'));
  const onClose = jest.fn();
  const screen = await render(
    <EntrySheet visible editing={null} onSave={onSave} onClose={onClose} />,
  );
  await fireEvent.press(screen.getByTestId('open-manual'));
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');

  await fireEvent.press(screen.getByTestId('entry-save'));

  // The sheet closes at dispatch (perf, 2026-10-08), so the failure is said
  // by a toast carrying Retry rather than inline on a form that is gone.
  expect(onClose).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: expect.anything() })),
  );
});

it('asks before a backdrop tap discards typed input, and closes outright when there is none', async () => {
  const onClose = jest.fn();
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={onClose} />,
  );

  await fireEvent.press(screen.getByTestId('entry-backdrop'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockConfirm).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('open-manual'));
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');
  await fireEvent.press(screen.getByTestId('entry-backdrop'));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(mockConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Discard this entry?' }),
  );
  await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
  expect(onClose).toHaveBeenCalledTimes(2);
});

// ── Round 2 (2026-10-04) ──

describe('barcode from the search field', () => {
  it('logs a single-basis product in 3 taps: + → barcode icon → (scan) → Add', async () => {
    const onSave = jest.fn();
    // Tap 1, "+", is the screen opening this sheet.
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);

    await fireEvent.press(screen.getByTestId('search-scan-barcode')); // tap 2
    expect(mockScanner?.visible).toBe(true);
    await act(async () =>
      mockScanner!.onPick({
        calories: 210,
        protein: 4,
        carbs: 26,
        fat: 10,
        mealLabel: 'Granola bar',
        serving: { source: 'barcode', barcode: '0123456789012' },
      }),
    );

    // No portion step to tap through: one serving was the only choice.
    expect(screen.queryByTestId('portion-0')).toBeNull();
    expect(screen.getByTestId('entry-calories').props.value).toBe('210');
    await fireEvent.press(screen.getByTestId('entry-save')); // tap 3
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 210, protein: 4, mealLabel: 'Granola bar' }));
  });

  it('lands a two-basis product (serving + per 100 g) on the form at one serving, grams one edit away', async () => {
    const onSave = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('search-scan-barcode')); // tap 2
    await act(async () =>
      mockScanner!.onPick({
        calories: 200,
        protein: 10,
        carbs: 24,
        fat: 9,
        mealLabel: 'Chips',
        serving: { grams: 40, source: 'barcode', barcode: '1' },
      }),
    );
    // No picker: the form, at one 40 g serving, with the grams field and Scale.
    expect(screen.queryByTestId('portion-0')).toBeNull();
    expect(screen.getByTestId('entry-calories').props.value).toBe('200');
    expect(screen.getByTestId('entry-grams').props.value).toBe('40');
    expect(screen.getByTestId('entry-scale-2')).toBeTruthy();

    // The per-100 g basis is one edit away, rescaled from the label.
    await fireEvent.changeText(screen.getByTestId('entry-grams'), '100');
    expect(screen.getByTestId('entry-calories').props.value).toBe('500');
    expect(screen.getByTestId('entry-protein').props.value).toBe('25');

    await fireEvent.press(screen.getByTestId('entry-save')); // tap 3
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 500, mealLabel: 'Chips' }));
  });

  it('hides the in-field icon once text is typed (the miss row still offers a scan)', async () => {
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'zzzz');
    expect(screen.queryByTestId('search-scan-barcode')).toBeNull();
    expect(await waitFor(() => screen.getByTestId('scan-from-miss'))).toBeTruthy();
  });
});

describe('edit in grams', () => {
  async function pickBanana() {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('portion-0'));
    return screen;
  }

  it('rescales every macro from the picked basis as grams are typed', async () => {
    const screen = await pickBanana();
    expect(screen.getByTestId('entry-grams').props.value).toBe('118');

    await fireEvent.changeText(screen.getByTestId('entry-grams'), '236');

    expect(screen.getByTestId('entry-calories').props.value).toBe('210');
    // From the UNROUNDED basis (1.3 g), not the form's rounded "1".
    expect(screen.getByTestId('entry-protein').props.value).toBe('2.6');
    expect(screen.getByTestId('entry-carbs').props.value).toBe('54');
    expect(screen.getByTestId('entry-fat').props.value).toBe('0.8');
  });

  it('does not compound: keystrokes through small weights land where one entry would', async () => {
    const screen = await pickBanana();
    const grams = () => screen.getByTestId('entry-grams');
    for (const text of ['1', '15', '150', '15', '1', '']) await fireEvent.changeText(grams(), text);
    await fireEvent.changeText(grams(), '236');
    expect(screen.getByTestId('entry-calories').props.value).toBe('210');
    expect(screen.getByTestId('entry-protein').props.value).toBe('2.6');
  });

  it('follows a Scale tap, and steps aside once kcal is edited by hand', async () => {
    const screen = await pickBanana();
    await fireEvent.press(screen.getByTestId('entry-scale-2'));
    expect(screen.getByTestId('entry-grams').props.value).toBe('236');

    await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');
    expect(screen.queryByTestId('entry-grams')).toBeNull();
  });

  it('offers grams for a per-100 g barcode product that skipped the picker', async () => {
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('search-scan-barcode'));
    await act(async () =>
      mockScanner!.onPick({
        calories: 380,
        protein: 12,
        mealLabel: 'Oats',
        serving: { grams: 100, source: 'barcode', barcode: '2' },
      }),
    );
    await fireEvent.changeText(screen.getByTestId('entry-grams'), '40');
    expect(screen.getByTestId('entry-calories').props.value).toBe('152');
    expect(screen.getByTestId('entry-protein').props.value).toBe('4.8');
  });
});

describe('the gram weight on the logged row (2026-10-07)', () => {
  it('saves the weight a pick was logged at, and none once kcal is hand-edited', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const onSave = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('portion-0'));
    await fireEvent.changeText(screen.getByTestId('entry-grams'), '236');
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ calories: 210, grams: 236 }));
  });

  it('drops the weight when the numbers stop describing it', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const onSave = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('portion-0'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onSave.mock.calls.at(-1)[0].grams).toBeUndefined();
  });

  it('opens a weighed row with its grams field, and re-weighs it from its own numbers', async () => {
    const onSave = jest.fn();
    const row = {
      id: 'w1',
      calories: 300,
      protein: 20,
      carbs: 40,
      fat: 6,
      grams: 150,
      mealLabel: 'Rice and chicken',
      date: new Date('2026-10-07T12:00:00'),
    } as DailyLog;
    const screen = await render(<EntrySheet visible editing={row} onSave={onSave} onClose={jest.fn()} />);
    expect(screen.getByTestId('entry-grams').props.value).toBe('150');
    await fireEvent.changeText(screen.getByTestId('entry-grams'), '180');
    expect(screen.getByTestId('entry-calories').props.value).toBe('360');
    expect(screen.getByTestId('entry-protein').props.value).toBe('24');
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ calories: 360, protein: 24, carbs: 48, grams: 180 }));
  });

  it('opens an unweighed row without a grams field', async () => {
    const row = { id: 'w2', calories: 300, mealLabel: 'Typed', date: new Date('2026-10-07T12:00:00') } as DailyLog;
    const screen = await render(<EntrySheet visible editing={row} onSave={jest.fn()} onClose={jest.fn()} />);
    expect(screen.queryByTestId('entry-grams')).toBeNull();
  });
});

describe('quick add focus', () => {
  it('focuses the search on open, Calories on a blank form, and neither on a reviewed pick', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    // U2: the browse view's search asks for the keyboard (deferred, like Calories).
    expect(mockDeferredFocus).toHaveBeenLastCalledWith(true);

    await fireEvent.press(screen.getByTestId('open-manual'));
    expect(mockDeferredFocus).toHaveBeenLastCalledWith(true);

    await fireEvent.press(screen.getByTestId('custom-back'));
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('portion-0'));
    expect(mockDeferredFocus).toHaveBeenLastCalledWith(false);
  });

  it('never asks for focus when editing', async () => {
    await render(
      <EntrySheet
        visible
        editing={{ id: 'e1', calories: 300, date: new Date('2026-10-01T12:00:00') } as DailyLog}
        onSave={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    expect(mockDeferredFocus).not.toHaveBeenCalledWith(true);
  });
});

describe('custom form back chevron', () => {
  it('asks before dropping typed values, and goes straight back when untouched', async () => {
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.press(screen.getByTestId('custom-back'));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('food-search-input')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '450');
    await fireEvent.press(screen.getByTestId('custom-back'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this entry?' }));
    // Still on the form until the user confirms.
    expect(screen.getByTestId('entry-calories').props.value).toBe('450');
    await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
    expect(screen.getByTestId('food-search-input')).toBeTruthy();
  });
});

describe('stale results while a chain query is in flight', () => {
  const garden = { ...bananaHit, id: 'og1', description: 'Olive Garden Breadstick' };

  it('dims and disables the previous query’s hits and shows a slim progress line', async () => {
    mockSearchFoods.mockResolvedValueOnce([garden]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'olive garden');
    await waitFor(() => screen.getByText('Olive Garden Breadstick'));
    expect(screen.queryByTestId('food-search-pending')).toBeNull();

    let resolve: (v: unknown[]) => void = () => {};
    mockSearchFoods.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'olive garden pasta');

    expect(screen.getByTestId('food-search-pending')).toBeTruthy();
    const row = screen.getByTestId('search-hit-usda-og1');
    expect(row.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(row);
    expect(screen.queryByTestId('portion-0')).toBeNull();

    await waitFor(() => expect(mockSearchFoods).toHaveBeenCalledWith('olive garden pasta'));
    await act(async () => resolve([{ ...garden, id: 'og2', description: 'Olive Garden Pasta' }]));
    expect(screen.queryByTestId('food-search-pending')).toBeNull();
    expect(screen.getByTestId('search-hit-usda-og2').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });

  it('leaves a local query’s rows live (no flicker on every keystroke)', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await waitFor(() => screen.getByText('Banana, raw'));
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana r');
    expect(screen.queryByTestId('food-search-pending')).toBeNull();
    expect(screen.getByTestId('search-hit-usda-b1').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
  });
});

// ── Round 3 (2026-10-04) ──

describe('photo scan from the search field', () => {
  it('opens the same scan door as More ways, and only while the box is empty', async () => {
    const onClose = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={onClose} />);
    const cam = screen.getByTestId('search-scan-meal');
    expect(cam.props.accessibilityLabel).toBe('Scan meal');

    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'ab');
    expect(screen.queryByTestId('search-scan-meal')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('food-search-input'), '');

    await fireEvent.press(screen.getByTestId('search-scan-meal'));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/scan');
  });

  it('is not offered on a past day (the scan screen logs to today)', async () => {
    const screen = await render(
      <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} dateKey="2026-10-01" />,
    );
    expect(screen.queryByTestId('search-scan-meal')).toBeNull();
    expect(screen.getByTestId('search-scan-barcode')).toBeTruthy();
  });
});

describe('iOS keyboard bar on the number pads', () => {
  it('gives each macro field its own ‹ › Done bar, and grams/Scale a localized Done', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('portion-0'));
    await fireEvent.press(screen.getByTestId('entry-scale-other'));

    // One bar PER input: on Fabric an accessory links to the first input with
    // its id and no other, so a shared id leaves three fields bare.
    const ids = ['calories', 'protein', 'carbs', 'fat'].map(
      (f) => screen.getByTestId(`entry-${f}`).props.inputAccessoryViewID,
    );
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(screen.getByTestId(`${id}-done`)).toBeTruthy();

    // Grams and the typed factor keep RN's own toolbar, with its button in the
    // user's language (it was hardcoded English).
    for (const f of ['entry-grams', 'entry-scale-input']) {
      expect(screen.getByTestId(f).props.inputAccessoryViewID).toBeUndefined();
      expect(screen.getByTestId(f).props.inputAccessoryViewButtonLabel).toBe('Done');
    }
    // The name field has a Return key of its own.
    expect(screen.getByTestId('entry-label').props.inputAccessoryViewID).toBeUndefined();
  });

  it('runs ‹ from kcal up to Name, greys › at fat, and Done dismisses without saving', async () => {
    const onSave = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('open-manual'));
    const bar = (f: string) => screen.getByTestId(`entry-${f}`).props.inputAccessoryViewID as string;
    const state = (id: string) => screen.getByTestId(id).props.accessibilityState;

    // A7: Name sits above Calories, so ‹ there is live, not greyed out.
    expect(state(`${bar('calories')}-prev`)).toEqual(expect.objectContaining({ disabled: false }));
    expect(state(`${bar('calories')}-next`)).toEqual(expect.objectContaining({ disabled: false }));
    expect(screen.getByTestId(`${bar('calories')}-next`).props.accessibilityLabel).toBe('Next field');
    expect(state(`${bar('fat')}-next`)).toEqual(expect.objectContaining({ disabled: true }));
    expect(state(`${bar('fat')}-prev`)).toEqual(expect.objectContaining({ disabled: false }));

    await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await fireEvent.press(screen.getByTestId(`${bar('calories')}-done`));
    expect(dismiss).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('typed values still open when Add is tapped', () => {
  it('applies a typed Scale factor live, so Add saves what the form shows', async () => {
    const onSave = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '200');
    await fireEvent.changeText(screen.getByTestId('entry-protein'), '10');
    await fireEvent.press(screen.getByTestId('entry-scale-other'));
    for (const text of ['1', '1.', '1.5']) await fireEvent.changeText(screen.getByTestId('entry-scale-input'), text);
    expect(screen.getByTestId('entry-calories').props.value).toBe('300');

    // No blur: Add is tapped with the field still open.
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ calories: 300, protein: 15 }));
  });

  it('puts the numbers back when the typed factor is not one', async () => {
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '200');
    await fireEvent.press(screen.getByTestId('entry-scale-other'));
    await fireEvent.changeText(screen.getByTestId('entry-scale-input'), '2');
    expect(screen.getByTestId('entry-calories').props.value).toBe('400');
    await fireEvent.changeText(screen.getByTestId('entry-scale-input'), '200');
    await fireEvent(screen.getByTestId('entry-scale-input'), 'blur');
    expect(screen.getByTestId('entry-calories').props.value).toBe('200');
  });

  it('saves at a typed time whose field is still open', async () => {
    const onSave = jest.fn();
    const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '225');
    await fireEvent.press(screen.getByTestId('entry-time-tap'));
    await fireEvent.changeText(screen.getByTestId('entry-time-input'), '0:00'); // never in the future
    await fireEvent.press(screen.getByTestId('entry-save'));
    const ts = onSave.mock.calls[0][0].timestamp as Date;
    expect([ts.getHours(), ts.getMinutes()]).toEqual([0, 0]);
  });

  it('picks a portion at a quantity still being typed', async () => {
    mockSearchFoods.mockResolvedValue([bananaHit]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    await fireEvent.press(screen.getByTestId('food-qty-value'));
    await fireEvent.changeText(screen.getByTestId('food-qty-input'), '2');
    await fireEvent.press(screen.getByTestId('portion-0'));
    expect(screen.getByTestId('entry-calories').props.value).toBe('210');
  });
});

describe('a one-portion search hit', () => {
  it('skips the picker and lands on the form with grams', async () => {
    mockSearchFoods.mockResolvedValue([{ ...bananaHit, servings: [bananaHit.servings[0]] }]);
    const screen = await render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('food-search-input'), 'banana');
    await fireEvent.press(await waitFor(() => screen.getByText('Banana, raw')));
    expect(screen.queryByTestId('portion-0')).toBeNull();
    expect(screen.getByTestId('entry-calories').props.value).toBe('105');
    expect(screen.getByTestId('entry-grams').props.value).toBe('118');
  });
});
