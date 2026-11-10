/**
 * The Train screen's half of the timer auto-stop (`useSessionIdle`, core
 * `session-idle.ts`): an unanswered idle session ends itself at the last set
 * + 5 min; a session open > 2 h is asked about; a notification's "End
 * session" opens Finish at the last set.
 */
import React, { type ReactNode } from 'react';
import { renderHook as rawRenderHook, waitFor } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import type { WorkoutSession } from '@/lib/workout';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (o: unknown) => mockConfirm(o),
  confirmNative: (o: object) => mockConfirm({ ...o, native: true }),
}));
const mockToast = jest.fn();
jest.mock('@/components/Toast', () => ({ showToast: (...a: unknown[]) => mockToast(...a) }));

const { useSessionIdle } = jest.requireActual('@/hooks/useSessionIdle') as typeof import('@/hooks/useSessionIdle');
import { stashIdleTap } from '@/lib/session-idle-notify';

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
const renderHook = <T,>(cb: () => T) => rawRenderHook(cb, { wrapper });

const MIN = 60_000;
function session(startMinAgo: number, setsMinAgo: number[]): WorkoutSession {
  const now = Date.now();
  return {
    id: `s-${startMinAgo}-${setsMinAgo.join('-')}`,
    status: 'active',
    date: new Date(now - startMinAgo * MIN),
    exercises: [{
      exerciseId: 'x', name: 'X', cues: [], logStyle: 'weight-reps',
      sets: setsMinAgo.map((m) => ({ kind: 'working' as const, weight: 50, reps: 10, done: true, loggedAt: new Date(now - m * MIN).toISOString() })),
    }],
    createdAt: new Date(now), updatedAt: new Date(now),
  } as WorkoutSession;
}

beforeEach(() => {
  mockConfirm.mockClear();
  mockToast.mockClear();
});

it('ends an idle session by itself at the last set + 5 min, flagged auto-ended', async () => {
  const finishWorkout = jest.fn().mockResolvedValue(true);
  // Started 100 min ago, last set 45 min ago: idle past 20 + 10.
  const s = session(100, [90, 45]);
  await renderHook(() => useSessionIdle({ active: s, editingExisting: false, finishWorkout }, jest.fn(), false));
  await waitFor(() => expect(finishWorkout).toHaveBeenCalledTimes(1));
  expect(finishWorkout.mock.calls[0][0]).toEqual({ durationMin: 60, durationNote: expect.stringMatching(/^auto-ended: 100 → 60 min/) });
  expect(mockToast).toHaveBeenCalled();
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('asks "End session at last set?" on a session open over 2 h — End opens Finish pre-filled', async () => {
  const openFinish = jest.fn();
  const s = session(130, [125, 4]);
  await renderHook(() => useSessionIdle({ active: s, editingExisting: false, finishWorkout: jest.fn() }, openFinish, false));
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
  const ask = mockConfirm.mock.calls[0][0];
  expect(ask.title).toMatch(/^End session at last set \(/);
  expect(ask.secondaryText).toBe('Enter duration');
  expect(ask.cancelText).toBe('Keep going');
  ask.onConfirm();
  // 130 − 4 + 5 = 131 min.
  expect(openFinish).toHaveBeenCalledWith({ askLength: true, presetMin: 131 });
});

it('does nothing to a session in progress, or while editing a finished one', async () => {
  const finishWorkout = jest.fn();
  await renderHook(() => useSessionIdle({ active: session(40, [3]), editingExisting: false, finishWorkout }, jest.fn(), false));
  await renderHook(() => useSessionIdle({ active: session(400, [300]), editingExisting: true, finishWorkout }, jest.fn(), false));
  await new Promise((r) => setTimeout(r, 50));
  expect(finishWorkout).not.toHaveBeenCalled();
  expect(mockConfirm).not.toHaveBeenCalled();
});

it('a notification "End session" tap opens Finish at the last set', async () => {
  const openFinish = jest.fn();
  const s = session(40, [30, 22]);
  stashIdleTap({ sessionId: s.id!, action: 'end' });
  await renderHook(() => useSessionIdle({ active: s, editingExisting: false, finishWorkout: jest.fn() }, openFinish, false));
  await waitFor(() => expect(openFinish).toHaveBeenCalledWith({ askLength: true, presetMin: 23 }));
});
