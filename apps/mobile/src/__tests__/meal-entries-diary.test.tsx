let mockLocale: string | undefined;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockLocale ? { preferredLocale: mockLocale } : null }),
}));

import type { DailyLog } from '@macrolog/core';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { MealEntries } from '@/components/MealEntries';

/**
 * MealEntries as a DIARY (UX_AUDIT Today review U3, A3, #3, P9): the four meal
 * headers are always there with their own "+ Add", each header is one spoken
 * node, slot names are sentence-cased per locale, and the swipe actions say
 * what they do in words.
 */
const lunch: DailyLog = {
  id: 'l1',
  date: new Date(2026, 9, 4, 12, 30),
  calories: 450,
  mealLabel: 'Chicken bowl',
  mealType: 'lunch',
} as DailyLog;

afterEach(() => {
  mockLocale = undefined;
});

describe('MealEntries diary', () => {
  it('shows all four meals with an Add each, empty ones included, and adds into the tapped slot', async () => {
    const onAddToSlot = jest.fn();
    const view = await render(<MealEntries logs={[]} onPress={() => {}} onAddToSlot={onAddToSlot} />);
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack']) expect(view.getByTestId(`slot-add-${slot}`)).toBeTruthy();
    expect(view.queryByTestId('slot-add-other')).toBeNull();
    await fireEvent.press(view.getByTestId('slot-add-dinner'));
    expect(onAddToSlot).toHaveBeenCalledWith('dinner');
    expect(view.getByTestId('slot-add-dinner').props.accessibilityLabel).toBe('Add to dinner');
  });

  it('reads each header as ONE heading — "Lunch, 450 kcal" — and an empty one as such', async () => {
    const view = await render(<MealEntries logs={[lunch]} onPress={() => {}} onAddToSlot={() => {}} />);
    expect(view.getByLabelText('Lunch, 450 kcal')).toBeTruthy();
    expect(view.getByLabelText('Breakfast, nothing logged')).toBeTruthy();
  });

  it('keeps the plain read-only grouping without an add affordance', async () => {
    const view = await render(<MealEntries logs={[lunch]} onPress={() => {}} />);
    expect(view.queryByTestId('slot-add-lunch')).toBeNull();
    expect(view.queryByLabelText('Breakfast, nothing logged')).toBeNull();
  });

  it('sentence-cases pt-BR slot names: "Café da manhã", never "Café Da Manhã"', async () => {
    mockLocale = 'pt-BR';
    const view = await render(<MealEntries logs={[]} onPress={() => {}} onAddToSlot={() => {}} />);
    expect(view.getByText('Café da manhã')).toBeTruthy();
    expect(view.queryByText('Café Da Manhã')).toBeNull();
  });

  it('labels the swipe actions in words — Delete, and Quick add for a named row', async () => {
    const view = await render(
      <MealEntries logs={[lunch]} onPress={() => {}} onDelete={() => {}} onSavePreset={() => {}} />,
    );
    expect(view.getByTestId('entry-swipe-delete-l1').props.accessibilityLabel).toBe('Delete');
    expect(view.getByTestId('entry-swipe-preset-l1').props.accessibilityLabel).toBe('Save to Quick add');
  });
});
