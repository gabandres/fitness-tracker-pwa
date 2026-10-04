import { act, renderHook } from '@testing-library/react-native';

/**
 * `composition_view` (ADR-0043) is the signal that decides whether the flag
 * widens, so it must count views, not renders: once per focus, only once the
 * line is on screen, and not twice when `shown` flaps inside one focus.
 */
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

// A controllable focus: `focus()` runs the effect, `blur()` its cleanup.
let mockFocusEffect: (() => void | (() => void)) | null = null;
let mockCleanup: void | (() => void);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        mockFocusEffect = cb;
      }, [cb]);
    },
  };
});
const focus = () => act(() => void (mockCleanup = mockFocusEffect?.()));
const blur = () => act(() => void (typeof mockCleanup === 'function' && mockCleanup()));

import { useCountViewPerFocus } from '@/hooks/useCountViewPerFocus';

beforeEach(() => {
  mockTrack.mockClear();
  mockFocusEffect = null;
  mockCleanup = undefined;
});

it('counts nothing while not shown (loading), then once when it appears', async () => {
  const { rerender } = await renderHook(({ shown }: { shown: boolean }) => useCountViewPerFocus('composition_view', shown), {
    initialProps: { shown: false },
  });
  await focus();
  expect(mockTrack).not.toHaveBeenCalled();
  await rerender({ shown: true });
  expect(mockTrack).toHaveBeenCalledTimes(1);
  expect(mockTrack).toHaveBeenCalledWith('composition_view');
});

it('a flap inside one focus does not count twice; a new focus does', async () => {
  const { rerender } = await renderHook(({ shown }: { shown: boolean }) => useCountViewPerFocus('composition_view', shown), {
    initialProps: { shown: true },
  });
  await focus();
  await rerender({ shown: false });
  await rerender({ shown: true });
  expect(mockTrack).toHaveBeenCalledTimes(1);
  await blur();
  await focus();
  expect(mockTrack).toHaveBeenCalledTimes(2);
});

it('shown while blurred counts nothing', async () => {
  const { rerender } = await renderHook(({ shown }: { shown: boolean }) => useCountViewPerFocus('composition_view', shown), {
    initialProps: { shown: false },
  });
  await rerender({ shown: true });
  expect(mockTrack).not.toHaveBeenCalled();
});
