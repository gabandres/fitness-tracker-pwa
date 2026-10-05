import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useFocusEffectThroughSheets } from '@/hooks/useFocusEffectThroughSheets';
import {
  __resetSheetPortal,
  clearSheetActive,
  markSheetActive,
} from '@/lib/sheet-portal';

/**
 * The S20 regression this guards: a native sheet is a route, so opening it
 * blurred Today and every focus-gated listener detached and re-read from the
 * server. The jest `useFocusEffect` mock is a plain effect, so a "blur" here is
 * an unmount-free cleanup triggered by changing the callback while a sheet is
 * marked — exercised directly through the hook's contract below.
 */
let focusCleanup: (() => void) | null = null;
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    // Manual focus: run the callback now, hand its cleanup to the test.
    useFocusEffect: (cb: () => void | (() => void)) => {
      const React = require('react');
      React.useEffect(() => {
        const c = cb();
        focusCleanup = typeof c === 'function' ? c : null;
      }, [cb]);
    },
  };
});

function Probe({ effect }: { effect: () => () => void }) {
  useFocusEffectThroughSheets(effect);
  return <Text>probe</Text>;
}

beforeEach(() => {
  __resetSheetPortal();
  focusCleanup = null;
});

it('a blur while a sheet is presented keeps the subscription until the sheet is gone', async () => {
  const stop = jest.fn();
  const start = jest.fn(() => stop);
  await render(<Probe effect={start} />);
  expect(start).toHaveBeenCalledTimes(1);

  markSheetActive('s1');
  await act(() => focusCleanup?.()); // the sheet route lands; the screen blurs
  expect(stop).not.toHaveBeenCalled();

  await act(() => clearSheetActive('s1'));
  expect(stop).toHaveBeenCalledTimes(1);
});

it('a blur with no sheet up releases at once', async () => {
  const stop = jest.fn();
  const start = jest.fn(() => stop);
  await render(<Probe effect={start} />);
  await act(() => focusCleanup?.());
  expect(stop).toHaveBeenCalledTimes(1);
});

it('unmounting releases a subscription held through a sheet', async () => {
  const stop = jest.fn();
  const start = jest.fn(() => stop);
  const view = await render(<Probe effect={start} />);
  markSheetActive('s1');
  await act(() => focusCleanup?.());
  await view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
