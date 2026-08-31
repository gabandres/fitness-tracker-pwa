// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';
import { setPersistedTab, usePersistedTab } from '@/hooks/usePersistedTab';
import { HABIT_TABS, TRENDS_HABIT_TAB_KEY } from '@/lib/habit-identity';

/**
 * The Today → Trends habit shortcut (in-app feedback, 2026-08-30): each habit
 * row carries a dedicated identity-coloured chip that lands on the Trends
 * Habits strip with that habit's face pre-selected.
 *
 * Two contracts pinned here, because each can rot invisibly:
 *
 * 1. **The chip writes the strip's persisted face BEFORE navigating, and
 *    navigates with `replace`.** The face is AsyncStorage under the key the
 *    strip reads (`trends.tab.habits`) — write a different key, or the wrong
 *    face, and the shortcut still "works" while landing on whatever was
 *    stored. `replace` rather than `push` is the standing tab-switch rule
 *    (the Trends stub rows set it): a pushed tab route stacks a second screen
 *    over the tab bar.
 *
 * 2. **The rows' existing edit/log controls keep their own handlers.** The
 *    chip is a NEW touchable inserted beside three pre-existing ones; the
 *    regression this guards against is a re-wrapped row where tapping the
 *    fasting value navigates instead of opening the editor.
 *
 * Harness notes: the mocked AsyncStorage persists across tests in this file,
 * so assertions use `toHaveBeenCalledWith` after a per-test clear rather than
 * counting; and under React 19 a press's state update is not committed when
 * `fireEvent.press` returns, so anything state-driven asserts inside
 * `waitFor`.
 */
function setup(over: Partial<Parameters<typeof DailyMetrics>[0]> = {}) {
  const onAddWater = jest.fn();
  const onSetSleep = jest.fn();
  const onStartFast = jest.fn();
  const onBreakFast = jest.fn();
  const onEditFast = jest.fn();
  const view = render(
    <DailyMetrics
      water={16}
      sleep={7}
      activity={undefined}
      fastStartedAt={null}
      onAddWater={onAddWater}
      onSetSleep={onSetSleep}
      onStartFast={onStartFast}
      onBreakFast={onBreakFast}
      onEditFast={onEditFast}
      {...over}
    />,
  );
  return { onAddWater, onSetSleep, onStartFast, onBreakFast, onEditFast, view };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each([
  ['sleep', 'metric-trends-sleep'],
  ['fasting', 'metric-trends-fasting'],
  ['water', 'metric-trends-water'],
] as const)('the %s shortcut', (face, testID) => {
  it(`persists the ${face} face and switches tabs via replace`, async () => {
    const { view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId(testID));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/trends'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(TRENDS_HABIT_TAB_KEY, face);
    // The standing tab-switch rule: never push a tab route.
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('the rows keep their edit and log controls', () => {
  it('fasting: the value still opens the editor, the button still starts a fast', async () => {
    const { onEditFast, onStartFast, view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('fast-open'));
    await waitFor(() => expect(onEditFast).toHaveBeenCalledTimes(1));

    await fireEvent.press(getByTestId('fast-toggle'));
    await waitFor(() => expect(onStartFast).toHaveBeenCalledTimes(1));

    // Neither edit affordance navigates — that is the shortcut's job alone.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('water: the pills still add, the value still opens the exact-amount sheet', async () => {
    const { onAddWater, view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('water-plus-8'));
    await waitFor(() => expect(onAddWater).toHaveBeenCalledWith(24)); // 16 + 8

    await fireEvent.press(getByTestId('water-open'));
    await waitFor(() => expect(getByTestId('water-input')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('sleep: the Edit button still opens the sleep sheet', async () => {
    const { view } = setup();
    const { getByTestId } = await view;

    await fireEvent.press(getByTestId('sleep-open'));
    await waitFor(() => expect(getByTestId('sleep-input')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

/** Stand-in for the Trends Habits strip: the same hook, the same key, the same
 *  valid list — mounted, exactly as expo-router keeps a visited Trends. */
function MountedStrip() {
  const [tab] = usePersistedTab(TRENDS_HABIT_TAB_KEY, HABIT_TABS, 'sleep');
  return <Text testID="mounted-strip-face">{tab}</Text>;
}

describe('a LIVE Trends instance follows the shortcut', () => {
  it('switches a mounted strip from water to sleep when the sleep shortcut fires', async () => {
    // The exact sequence the LG VS988 failed on (2026-08-30): Trends already
    // visited and left on the Water face, then a shortcut fired from Today.
    // Shipped with only the memo + AsyncStorage write, the mounted instance
    // never re-read either, so it stayed on water while navigation succeeded
    // -- which every fresh-render test read as a pass.
    setPersistedTab(TRENDS_HABIT_TAB_KEY, 'water');

    const view = render(
      <>
        <MountedStrip />
        <DailyMetrics
          water={16}
          sleep={7}
          activity={undefined}
          fastStartedAt={null}
          onAddWater={() => {}}
          onSetSleep={() => {}}
          onStartFast={() => {}}
          onBreakFast={() => {}}
        />
      </>,
    );
    const { getByTestId } = await view;
    expect(getByTestId('mounted-strip-face').props.children).toBe('water');

    await fireEvent.press(getByTestId('metric-trends-sleep'));

    // The mounted strip itself switches -- not merely the stored value.
    await waitFor(() => expect(getByTestId('mounted-strip-face').props.children).toBe('sleep'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(TRENDS_HABIT_TAB_KEY, 'sleep');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/trends'));
  });

  it('a mounted strip re-validates an external write instead of trusting it', async () => {
    const view = render(<MountedStrip />);
    const { getByTestId } = await view;

    setPersistedTab(TRENDS_HABIT_TAB_KEY, 'sleep');
    await waitFor(() => expect(getByTestId('mounted-strip-face').props.children).toBe('sleep'));

    // A value outside the panel's valid list must not select anything.
    setPersistedTab(TRENDS_HABIT_TAB_KEY, 'someRemovedTab');
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(TRENDS_HABIT_TAB_KEY, 'someRemovedTab'));
    expect(getByTestId('mounted-strip-face').props.children).toBe('sleep');
  });
});
