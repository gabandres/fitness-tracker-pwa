const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...a: unknown[]) => mockGetItem(...(a as [])),
    setItem: (...a: unknown[]) => mockSetItem(...(a as [])),
  },
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePersistedTab } from '@/hooks/usePersistedTab';

/**
 * Remembering which panel face you were last on (ADR-0034 decision 4).
 *
 * **This is a cache, not a setting**, and the tests are shaped around the
 * consequences of that: a read that fails is not an error, a stored value is
 * not trusted, and nothing here touches the profile — so none of ADR-0034's
 * option C costs apply. If a future change makes this sync across devices, it
 * has become option C and should be priced as option C.
 *
 * Each test uses a unique key, because the hook keeps a module-level memo to
 * stop Trends repainting the default face every time the user navigates back to
 * it. Sharing a key across tests would let one leak into the next.
 */

const TABS = ['week', 'budget'] as const;
let n = 0;
const freshKey = () => `trends.tab.test.${n++}`;

beforeEach(() => {
  mockGetItem.mockReset().mockResolvedValue(null);
  mockSetItem.mockReset().mockResolvedValue(undefined);
});

describe('usePersistedTab', () => {
  it('starts on the fallback when nothing is stored', async () => {
    const { result } = await renderHook(() => usePersistedTab(freshKey(), TABS, 'week'));
    expect(result.current[0]).toBe('week');
  });

  it('restores a stored tab', async () => {
    mockGetItem.mockResolvedValue('budget');
    const { result } = await renderHook(() => usePersistedTab(freshKey(), TABS, 'week'));
    await waitFor(() => expect(result.current[0]).toBe('budget'));
  });

  it('writes the choice through on select', async () => {
    const key = freshKey();
    const { result } = await renderHook(() => usePersistedTab(key, TABS, 'week'));
    await act(async () => result.current[1]('budget'));
    expect(result.current[0]).toBe('budget');
    expect(mockSetItem).toHaveBeenCalledWith(key, 'budget');
  });

  it('IGNORES a stored value that is no longer a tab', async () => {
    // The miniature version of the migration rule ADR-0034 attached to option
    // C. A renamed or removed face must fall back, not select something that
    // does not exist and render an empty panel.
    mockGetItem.mockResolvedValue('someRemovedTab');
    const { result } = await renderHook(() => usePersistedTab(freshKey(), TABS, 'week'));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalled());
    expect(result.current[0]).toBe('week');
  });

  it('falls back silently when the cache cannot be read', async () => {
    // A cache that fails is not an error worth surfacing — the user gets the
    // default face, which is a correct screen. Anything louder would be a
    // dialog about a tab.
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));
    const { result } = await renderHook(() => usePersistedTab(freshKey(), TABS, 'week'));
    await waitFor(() => expect(mockGetItem).toHaveBeenCalled());
    expect(result.current[0]).toBe('week');
  });

  it('does not reject when the WRITE fails', async () => {
    // The tab has already changed on screen; a failed write costs the next
    // launch one tap and must not interrupt anything.
    mockSetItem.mockRejectedValue(new Error('disk full'));
    const { result } = await renderHook(() => usePersistedTab(freshKey(), TABS, 'week'));
    await act(async () => result.current[1]('budget'));
    expect(result.current[0]).toBe('budget');
  });

  it('reads storage once per key, then serves the memo', async () => {
    // Trends unmounts on every tab change, so without the memo each return
    // would repaint the default face and flip a frame later.
    const key = freshKey();
    mockGetItem.mockResolvedValue('budget');
    const first = await renderHook(() => usePersistedTab(key, TABS, 'week'));
    await waitFor(() => expect(first.result.current[0]).toBe('budget'));
    first.unmount();

    const second = await renderHook(() => usePersistedTab(key, TABS, 'week'));
    // Correct on the FIRST render, with no flash through the fallback.
    expect(second.result.current[0]).toBe('budget');
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });
});
