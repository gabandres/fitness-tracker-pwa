/**
 * `useIntentInbox` — Today applying what the Lock Screen and Siri left behind.
 *
 * Pinned: nothing is taken before the profile has loaded (a Lock Screen End
 * judged against "no fast yet" would be dropped for good); each action reaches
 * the ordinary handler a tap would; and the foreground and the doorbell both
 * drain again.
 */

const mockTake = jest.fn();
let mockDoorbell: (() => void) | null = null;
jest.mock('../../modules/intent-inbox', () => ({
  takeIntentInbox: (...a: unknown[]) => mockTake(...a),
  subscribeIntentInbox: (cb: () => void) => {
    mockDoorbell = cb;
    return () => {
      mockDoorbell = null;
    };
  },
}));
jest.mock('@/lib/fast-activity', () => ({
  ...jest.requireActual('@/lib/fast-activity'),
  markFastEnding: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useIntentInbox, type IntentInboxHandlers } from '@/hooks/useIntentInbox';
import { markFastEnding } from '@/lib/fast-activity';

const START = new Date(Date.now() - 3 * 3600_000);
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

function handlers(over: Partial<IntentInboxHandlers> = {}): IntentInboxHandlers {
  return {
    ready: true,
    fastStartedAt: START,
    onEndFast: jest.fn(async () => {}),
    onStartFast: jest.fn(),
    onShowFast: jest.fn(),
    onLogWeight: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTake.mockResolvedValue([]);
});

it('takes nothing until the profile is ready', async () => {
  const h = handlers({ ready: false });
  const { rerender } = await renderHook((p: IntentInboxHandlers) => useIntentInbox(p), { initialProps: h });
  await flush();
  expect(mockTake).not.toHaveBeenCalled();
  await rerender({ ...h, ready: true });
  await flush();
  expect(mockTake).toHaveBeenCalledWith(['fastEnd', 'fastStart', 'fastStop', 'weight']);
});

it('a Lock Screen End runs the ordinary end path, at the instant tapped, guarded against re-arming', async () => {
  const tapped = Date.now() - 30_000;
  mockTake.mockResolvedValueOnce([{ kind: 'fastEnd', atMs: tapped, startedAtMs: START.getTime(), endedAtMs: tapped }]);
  const h = handlers();
  await renderHook(() => useIntentInbox(h));
  await flush();
  expect(h.onEndFast).toHaveBeenCalledWith(new Date(tapped));
  expect(markFastEnding).toHaveBeenNthCalledWith(1, START.getTime());
  expect(markFastEnding).toHaveBeenLastCalledWith(null);
});

it('Siri "Log weight" opens the sheet with the number; "Start fast" with one running shows it', async () => {
  mockTake.mockResolvedValueOnce([
    { kind: 'weight', atMs: Date.now(), value: 82.5 },
    { kind: 'fastStart', atMs: Date.now() },
  ]);
  const h = handlers();
  await renderHook(() => useIntentInbox(h));
  await flush();
  expect(h.onLogWeight).toHaveBeenCalledWith(82.5);
  expect(h.onShowFast).toHaveBeenCalled();
  expect(h.onStartFast).not.toHaveBeenCalled();
});

it('drains again when the inbox rings', async () => {
  const h = handlers({ fastStartedAt: null });
  await renderHook(() => useIntentInbox(h));
  await flush();
  mockTake.mockResolvedValueOnce([{ kind: 'fastStart', atMs: Date.now() }]);
  await act(async () => mockDoorbell?.());
  await flush();
  expect(h.onStartFast).toHaveBeenCalledTimes(1);
});
