/**
 * Audit 2026-10-15 #24: `useIntentInbox` TOOK the inbox (a destructive native
 * read) and then dropped what it took when the effect had been torn down in
 * the meantime — a Siri "Log weight" spoken while Today re-gated on `ready`
 * vanished. And `draining` lived in a ref that outlived the effect, so a
 * drain abandoned mid-flight left it latched and the next effect's triggers
 * all returned early.
 */
const mockTake = jest.fn();
jest.mock('../../modules/intent-inbox', () => ({
  takeIntentInbox: (...a: unknown[]) => mockTake(...a),
  subscribeIntentInbox: () => () => {},
}));
jest.mock('@/lib/fast-activity', () => ({
  ...jest.requireActual('@/lib/fast-activity'),
  markFastEnding: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useIntentInbox, type IntentInboxHandlers } from '@/hooks/useIntentInbox';

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

function handlers(over: Partial<IntentInboxHandlers> = {}): IntentInboxHandlers {
  return {
    ready: true,
    fastStartedAt: null,
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

it('applies what a torn-down drain took once the inbox is ready again', async () => {
  let release: (v: unknown) => void = () => {};
  mockTake.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  const h = handlers();
  const { rerender } = await renderHook((p: IntentInboxHandlers) => useIntentInbox(p), { initialProps: h });
  await flush();
  // Today re-gates (profile reload) while the native take is in flight.
  await rerender({ ...h, ready: false });
  release([{ kind: 'weight', atMs: Date.now(), value: 80 }]);
  await flush();
  expect(h.onLogWeight).not.toHaveBeenCalled();

  await rerender({ ...h, ready: true });
  await flush();
  expect(h.onLogWeight).toHaveBeenCalledWith(80);
});

it('applies a late take that lands while the NEW effect is mid-drain', async () => {
  let releaseOld: (v: unknown) => void = () => {};
  let releaseNew: (v: unknown) => void = () => {};
  mockTake
    .mockImplementationOnce(() => new Promise((r) => { releaseOld = r; }))
    .mockImplementationOnce(() => new Promise((r) => { releaseNew = r; }));
  const h = handlers();
  const { rerender } = await renderHook((p: IntentInboxHandlers) => useIntentInbox(p), { initialProps: h });
  await flush();
  await rerender({ ...h, ready: false });
  // Ready again: the new effect's drain is now awaiting its own take...
  await rerender({ ...h, ready: true });
  await flush();
  // ...when the old, torn-down take finally answers.
  releaseOld([{ kind: 'weight', atMs: Date.now(), value: 81 }]);
  await flush();
  releaseNew([]);
  await flush();
  expect(h.onLogWeight).toHaveBeenCalledWith(81);
});
