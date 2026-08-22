import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';

/**
 * Water entry — the custom amount a user asked for.
 *
 * *"solo se pueden anotar las opciones q estan puestas ahy no hay un opcion
 * customizada cmo poner 5oz"* (in-app feedback, 2026-08-22). The +8/+16/+24
 * pills cover the common glass and nothing else.
 *
 * What is pinned here is the arithmetic, because it is the half that can rot
 * without looking wrong: `onAddWater` takes an ABSOLUTE total, so Add has to
 * send `current + n` while Set total sends `n`. Getting those the wrong way
 * round produces a plausible number every time — 5 oz added to 16 reading as
 * 5 — and nothing on screen would say so.
 */
const noop = () => {};

// `I18nProvider` reads the locale off the profile, which drags in Firebase Auth
// and its ESM-only `@firebase/util` shim. The dictionary stays real.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

function setup(over: Partial<Parameters<typeof DailyMetrics>[0]> = {}) {
  const onAddWater = jest.fn();
  const view = render(
    <DailyMetrics
      water={16}
      sleep={null}
      activity={undefined}
      fastStartedAt={null}
      onAddWater={onAddWater}
      onSetSleep={noop}
      onStartFast={noop}
      onBreakFast={noop}
      {...over}
    />,
  );
  return { onAddWater, view };
}

describe('Water entry', () => {
  it('adds a custom amount to the running total', async () => {
    const { onAddWater, view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('water-open'));
    await fireEvent.changeText(getByTestId('water-input'), '5');
    await act(async () => {
      await fireEvent.press(getByTestId('water-save'));
    });

    // 16 + 5, not 5 — the exact confusion this test exists for.
    expect(onAddWater).toHaveBeenCalledWith(21);
  });

  it('replaces the total in Set total mode', async () => {
    const { onAddWater, view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('water-open'));
    await fireEvent.press(getByTestId('water-mode-toggle'));
    await fireEvent.changeText(getByTestId('water-input'), '5');
    await act(async () => {
      await fireEvent.press(getByTestId('water-save'));
    });

    expect(onAddWater).toHaveBeenCalledWith(5);
  });

  it('opens in Add with an empty field, every time', async () => {
    // Carrying the last mode over would make the common action depend on what
    // was done previously, which is the sort of state a user cannot see.
    const { view } = setup();
    const { getByTestId, getByText } = await view;

    await fireEvent.press(getByTestId('water-open'));
    expect(getByTestId('water-input').props.value).toBe('');
    // The way out to Set total is offered, which means Add is the mode.
    expect(getByText("Set today's total instead")).toBeTruthy();
  });

  it('seeds Set total from the current value so a correction is one keystroke', async () => {
    const { view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('water-open'));
    await fireEvent.press(getByTestId('water-mode-toggle'));
    expect(getByTestId('water-input').props.value).toBe('16');
  });

  it('offers no in-sheet quick amounts — the row already has them', async () => {
    // The first build of this sheet duplicated the +8/+16/+24 pills that sit
    // two inches above it, which is how a one-field sheet becomes a form and
    // how Save ended up under the keyboard on a 360dp screen.
    const { view } = setup();
    const { getByTestId, queryByTestId } = await view;

    await fireEvent.press(getByTestId('water-open'));
    expect(queryByTestId('water-quick-12')).toBeNull();
  });

  it('refuses a total past the storable daily maximum', async () => {
    const { onAddWater, view } = setup({ water: 600 });
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('water-open'));
    await fireEvent.changeText(getByTestId('water-input'), '200');
    await act(async () => {
      await fireEvent.press(getByTestId('water-save'));
    });

    // 800 is past WATER_MAX_FLOZ (676) and the rules would reject the write —
    // better to say so than to let it fail silently at Firestore.
    expect(onAddWater).not.toHaveBeenCalled();
  });

  it('leaves the quick pills on the row working', async () => {
    const { onAddWater, view } = setup();
    const { getByTestId } = await view;
    await fireEvent.press(getByTestId('water-plus-8'));
    expect(onAddWater).toHaveBeenCalledWith(24);
  });
});
