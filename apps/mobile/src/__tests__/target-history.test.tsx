import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';
import { renderWithProviders as render } from '@/test-utils';
import { type DailyTargetRecord, type Profile, dailyTargets } from '@macrolog/core';

/**
 * The per-day target record from Today (owner, 2026-10-08): an automatic
 * change is recorded with its reason and announced; a user's own target is
 * recorded and never moved; nothing is written from a cache-only answer.
 */
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/lib/sentry', () => ({ captureError: jest.fn() }));
const mockStored: { records: DailyTargetRecord[]; fromServer: boolean } = { records: [], fromServer: true };
const mockWrite = jest.fn(async () => undefined);
const mockAck = jest.fn(async () => undefined);
jest.mock('@/lib/ledger', () => ({
  subscribeDailyTargets: (_u: string, _n: number, cb: (r: DailyTargetRecord[], m?: { fromCache: boolean }) => void) => {
    cb(mockStored.records, { fromCache: !mockStored.fromServer });
    return () => undefined;
  },
  writeDailyTargetRecord: (...a: unknown[]) => mockWrite(...(a as [])),
  ackTargetNotice: (...a: unknown[]) => mockAck(...(a as [])),
}));
// Open channels immediately, WITH provenance — the focus gate is useLedgerFeed's
// own and tested where it lives.
jest.mock('@/hooks/useLedgerFeed', () => {
  const React = jest.requireActual('react');
  return {
    feedChannel: (spec: unknown) => spec,
    useLedgerFeed: (opts: {
      channels: () => { open: (d: (v: unknown, m?: { fromCache: boolean }) => void) => void; apply: (v: unknown, p: { authoritative: boolean }) => void }[];
      deps: unknown[];
    }) => {
      React.useEffect(() => {
        for (const c of opts.channels()) c.open((v, m) => c.apply(v, { authoritative: !m?.fromCache }));
      }, opts.deps);
      return { answered: {}, ready: true, failed: false, error: null };
    },
  };
});

import { useTargetHistory } from '@/hooks/useTargetHistory';
import { TargetChangeNotice } from '@/components/TargetChangeNotice';
import { en } from '@/i18n/en';


const at = new Date('2026-10-08T12:00:00Z');
const owner = (over: Partial<Profile> = {}) => ({
  email: 'o@o', createdAt: new Date(0), lastSeenAt: new Date(0), profileCompleted: true,
  heightIn: 68, age: 33, sex: 'male', activityLevel: 'moderate', targetPaceLbsPerWeek: 0.8,
  proteinPerKg: 1.9, calorieFloor: 1850, ...over,
}) as Profile;
const rec7 = (): DailyTargetRecord => ({
  date: '2026-10-07', kcalTarget: 1850, kcalSource: 'auto', proteinTarget: 135, proteinSource: 'auto',
  basis: { weightLb: 153.8, proteinPerKg: 1.9, paceLbPerWeek: 0.8, calorieFloor: 1850 },
  recordedBy: 'app', recordedAt: at, updatedAt: at,
});

beforeEach(() => {
  mockWrite.mockClear();
  mockAck.mockClear();
  mockStored.records = [rec7()];
  mockStored.fromServer = true;
});

it('the 10/8 drop: records 135 → 130 with the weight reason', async () => {
  const profile = owner();
  const targets = dailyTargets(profile, [], { '2026-10-08': 153.6 });
  // Yesterday's calories as today's, so the only move is the protein one.
  mockStored.records = [{ ...rec7(), kcalTarget: targets.calorieTarget }];
  await renderHook(() => useTargetHistory({ todayKey: '2026-10-08', targets, profile, authoritative: true }));
  expect(mockWrite).toHaveBeenCalledTimes(1);
  const [uid, plan] = mockWrite.mock.calls[0] as unknown as [string, DailyTargetRecord];
  expect(uid).toBe('u1');
  expect(plan.proteinTarget).toBe(130);
  expect(plan.change?.protein).toEqual({ from: 135, to: 130, fromSource: 'auto', toSource: 'auto' });
  expect(plan.change?.reasons).toEqual([{ kind: 'weight', fromLb: 153.8, toLb: 153.6, perKg: 1.9 }]);
});

it('a user override is recorded once and survives later weigh-ins without another change', async () => {
  const profile = owner({ targetMode: 'custom', manualProteinTarget: 140 });
  const t1 = dailyTargets(profile, [], { '2026-10-09': 153.6 });
  mockStored.records = [{ ...rec7(), kcalTarget: t1.calorieTarget }];
  await renderHook(() => useTargetHistory({ todayKey: '2026-10-09', targets: t1, profile, authoritative: true }));
  const [, plan] = mockWrite.mock.calls[0] as unknown as [string, DailyTargetRecord];
  expect([plan.proteinTarget, plan.proteinSource]).toEqual([140, 'user']);
  expect(plan.change?.reasons).toEqual([{ kind: 'user-set', field: 'protein' }]);

  mockWrite.mockClear();
  mockStored.records = [{ ...rec7(), kcalTarget: t1.calorieTarget }, { ...plan, recordedBy: 'app', recordedAt: at, updatedAt: at }];
  const t2 = dailyTargets(profile, [], { '2026-10-09': 151.2 });
  expect(t2.proteinTarget).toBe(140);
  await renderHook(() => useTargetHistory({ todayKey: '2026-10-09', targets: t2, profile, authoritative: true }));
  expect(mockWrite).not.toHaveBeenCalled();
});

it('writes nothing from cache-only inputs or cache-only records', async () => {
  const profile = owner();
  const targets = dailyTargets(profile, [], { '2026-10-08': 153.6 });
  await renderHook(() => useTargetHistory({ todayKey: '2026-10-08', targets, profile, authoritative: false }));
  mockStored.fromServer = false;
  await renderHook(() => useTargetHistory({ todayKey: '2026-10-08', targets, profile, authoritative: true }));
  expect(mockWrite).not.toHaveBeenCalled();
});

it('surfaces an unacknowledged automatic change, and not an acknowledged one', async () => {
  const changed: DailyTargetRecord = {
    ...rec7(), date: '2026-10-08', proteinTarget: 130,
    change: { protein: { from: 135, to: 130, fromSource: 'auto', toSource: 'auto' }, reasons: [{ kind: 'weight', fromLb: 153.8, toLb: 153.6, perKg: 1.9 }] },
  };
  const profile = owner();
  const targets = dailyTargets(profile, [], { '2026-10-08': 153.6 });
  mockStored.records = [rec7(), changed];
  const a = await renderHook(() => useTargetHistory({ todayKey: '2026-10-08', targets, profile, authoritative: true }));
  expect(a.result.current.notice?.date).toBe('2026-10-08');
  mockStored.records = [rec7(), { ...changed, noticeAckAt: at }];
  const b = await renderHook(() => useTargetHistory({ todayKey: '2026-10-08', targets, profile, authoritative: true }));
  expect(b.result.current.notice).toBeNull();
});

it('the notice states old → new and why, and Got it acknowledges that day', async () => {
  const onAck = jest.fn();
  const record: DailyTargetRecord = {
    ...rec7(), date: '2026-10-08', proteinTarget: 130,
    change: { protein: { from: 135, to: 130, fromSource: 'auto', toSource: 'auto' }, reasons: [{ kind: 'weight', fromLb: 153.8, toLb: 153.6, perKg: 1.9 }] },
  };
  await render(<TargetChangeNotice record={record} unitSystem="us" onAck={onAck} onSetOwn={jest.fn()} />);
  expect(screen.getByText(en['targetNotice.title'])).toBeTruthy();
  expect(screen.getByTestId('target-change-from-to').props.children).toBe('Protein: 135 g → 130 g');
  expect(screen.getByTestId('target-change-why').props.children).toMatch(/1\.9 g\/kg.*153\.8.*153\.6/);
  await act(async () => {
    fireEvent.press(screen.getByTestId('target-change-ack'));
  });
  expect(onAck).toHaveBeenCalledWith('2026-10-08');
});
