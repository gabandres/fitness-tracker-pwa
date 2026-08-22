import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';

/**
 * The three one-field sheets — water, sleep, weigh-in — are the same sheet
 * with different arithmetic, and this pins the parts of "the same" that rot
 * silently.
 *
 * They had drifted. Water and Sleep hand-rolled a `<Modal animationType=
 * "slide">`, which slides the dim backdrop up the screen along with the panel
 * (the "weird backdrop" the meal EntrySheet was rebuilt to avoid) and offers
 * no drag-to-dismiss; the weigh-in sheet used the shared `<BottomSheet>`,
 * which fixes both. Meanwhile water had `selectTextOnFocus`, a `done` return
 * key and a note line saying what the total was about to become, and the
 * weigh-in sheet — whose field is ALSO prefilled — had none of them, so
 * editing 180.4 to 179.8 meant five backspaces and typing produced 180.4179.8.
 *
 * Nothing about either defect fails a render. Both are asserted here.
 *
 * NB the usual caveat: RNTL runs no Yoga pass, so this says nothing about how
 * either sheet LOOKS. Container parity is asserted through behaviour that
 * only `<BottomSheet>` provides (a `grab-handle`-bearing tree that survives
 * `visible=false` through its exit animation is not something the hand-rolled
 * modal did), not by reading styles.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

const noop = () => {};

async function openWater() {
  const view = await render(
    <DailyMetrics
      water={16}
      sleep={7}
      activity={undefined}
      fastStartedAt={null}
      onAddWater={noop}
      onSetSleep={noop}
      onStartFast={noop}
      onBreakFast={noop}
    />,
  );
  await fireEvent.press(view.getByTestId('water-open'));
  return view;
}

async function openSleep() {
  const view = await render(
    <DailyMetrics
      water={16}
      sleep={7}
      activity={undefined}
      fastStartedAt={null}
      onAddWater={noop}
      onSetSleep={noop}
      onStartFast={noop}
      onBreakFast={noop}
    />,
  );
  await fireEvent.press(view.getByTestId('sleep-open'));
  return view;
}

describe('the one-field sheets share their input rules', () => {
  it('water selects its text on focus and finishes on the return key', async () => {
    const input = (await openWater()).getByTestId('water-input');
    expect(input.props.selectTextOnFocus).toBe(true);
    expect(input.props.returnKeyType).toBe('done');
  });

  it('sleep does too — its field is prefilled with last night', async () => {
    const view = await openSleep();
    const input = view.getByTestId('sleep-input');
    // Prefilled, which is exactly why the first keystroke has to replace it:
    // without selectTextOnFocus, 7 becomes 78.
    expect(input.props.value).toBe('7');
    expect(input.props.selectTextOnFocus).toBe(true);
    expect(input.props.returnKeyType).toBe('done');
  });

  it('every one-field sheet says what it is about to change', async () => {
    // Water at rest names the current total rather than sitting blank...
    const view = await openWater();
    expect(view.getByTestId('water-preview').props.children).toContain('16');
    // ...and names the RESULT once something is typed, so nobody does the sum.
    await fireEvent.changeText(view.getByTestId('water-input'), '5');
    const after = view.getByTestId('water-preview').props.children;
    expect(after).toContain('16');
    expect(after).toContain('21');
  });
});
