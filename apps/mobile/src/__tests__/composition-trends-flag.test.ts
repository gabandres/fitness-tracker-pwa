import { renderHook } from '@testing-library/react-native';
import type { Measurement } from '@macrolog/core';

/**
 * The gate (ADR-0043): for anyone without the admin claim the hook must open
 * NO measurements listener and compute nothing — Trends is then exactly what
 * it was. With the claim it subscribes and computes.
 */
let mockIsAdmin = false;
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, isAdmin: mockIsAdmin }) }));
const mockSubscribe = jest.fn();
jest.mock('@/lib/ledger', () => ({ subscribeMeasurementsSince: (...a: unknown[]) => mockSubscribe(...a) }));
// Open every channel immediately — the focus gating is useLedgerFeed's own,
// tested where it lives.
jest.mock('@/hooks/useLedgerFeed', () => {
  const React = jest.requireActual('react');
  return {
    feedChannel: (spec: unknown) => spec,
    useLedgerFeed: (opts: { channels: () => { open: (d: (v: unknown) => void, f: () => void) => void; apply: (v: unknown) => void }[]; deps: unknown[] }) => {
      React.useEffect(() => {
        for (const c of opts.channels()) c.open((v) => c.apply(v), () => undefined);
      }, opts.deps);
      return { loaded: true, error: null };
    },
  };
});

import { useCompositionTrends } from '@/hooks/useCompositionTrends';

const tapes: Measurement[] = [
  { date: new Date(2026, 8, 28, 9), waist: 32, neck: 14.5 },
  { date: new Date(2026, 8, 14, 9), waist: 32.25, neck: 14.5 },
  { date: new Date(2026, 7, 30, 9), waist: 32.25, neck: 14.5 },
];

beforeEach(() => {
  mockSubscribe.mockReset();
  mockSubscribe.mockImplementation((_uid: string, _since: Date, cb: (m: Measurement[]) => void) => {
    cb(tapes);
    return () => undefined;
  });
});

it('flag OFF (no admin claim): no listener, nothing computed', async () => {
  mockIsAdmin = false;
  const { result } = await renderHook(() => useCompositionTrends([], {}, null));
  expect(mockSubscribe).not.toHaveBeenCalled();
  expect(result.current).toEqual({ enabled: false, composition: null, recomp: null, lastTapeAt: null, female: false });
});

it('flag ON (admin): subscribes to measurements and computes both', async () => {
  mockIsAdmin = true;
  const profile = { sex: 'male', heightIn: 68 } as never;
  const { result } = await renderHook(() => useCompositionTrends([], {}, profile));
  // Bounded by TIME, not rows: every row the 182-day DXA lookback can use.
  expect(mockSubscribe).toHaveBeenCalledWith('u1', expect.any(Date), expect.any(Function), expect.any(Function));
  const since = mockSubscribe.mock.calls[0][1] as Date;
  const daysBack = (Date.now() - since.getTime()) / 86_400_000;
  expect(daysBack).toBeGreaterThanOrEqual(182);
  expect(daysBack).toBeLessThan(185);
  expect(result.current.enabled).toBe(true);
  expect(result.current.composition).not.toBeNull();
  expect(result.current.recomp).not.toBeNull();
  expect(result.current.lastTapeAt).toEqual(new Date(2026, 8, 28, 9));
  expect(result.current.female).toBe(false);
});

it('a female profile is passed through for the hip copy', async () => {
  mockIsAdmin = true;
  const { result } = await renderHook(() => useCompositionTrends([], {}, { sex: 'female', heightIn: 65 } as never));
  expect(result.current.female).toBe(true);
});
