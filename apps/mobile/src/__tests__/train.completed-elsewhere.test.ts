import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A workout finished somewhere else (2026-11-20).
 *
 * `STATUS.md` listed it as known and unfixed: a session closed by a data
 * script stayed "active" in the phone's memory — this runtime's copy beat
 * every server read — and the phone finished it a second time at the 24 h cap
 * (2026-11-06). The sessions listener now tells the active session what the
 * server holds, and a session the server says is completed is closed here.
 *
 * The first hook test to run on the REAL ledger over the in-memory Firestore
 * (`test-support/memory-firestore.ts`) instead of a hand-written fake of it.
 */
jest.mock('firebase/firestore', () => require('@/test-support/memory-firestore').firestoreModule);
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));

import { __resetFinishesInFlight, useTrain } from '@/hooks/useTrain';
import { readActiveSessionJournal } from '@/lib/active-session-journal';
import { updateSession } from '@/lib/ledger';
import { memory } from '@/test-support/memory-firestore';

const UID = 'u1';
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(async () => {
  memory.reset();
  await AsyncStorage.clear();
  __resetFinishesInFlight();
});

async function startedWorkout() {
  const hook = await renderHook(() => useTrain());
  await flush();
  await act(async () => {
    await hook.result.current.startWorkout();
  });
  await flush();
  const id = hook.result.current.active?.id as string;
  expect(memory.read(`users/${UID}/workoutSessions/${id}`)).toMatchObject({ status: 'active' });
  return { hook, id };
}

describe('a workout the server says is completed', () => {
  it('leaves the screen, the journal and the active-workout state', async () => {
    const { hook, id } = await startedWorkout();

    // Finished by another writer: a second device, or a data script.
    await act(async () => {
      await updateSession(UID, id, { status: 'completed' });
    });
    await flush();

    await waitFor(() => expect(hook.result.current.active).toBeNull());
    expect(await readActiveSessionJournal(UID)).toBeNull();
    expect(hook.result.current.recentSessions.map((s) => s.id)).toEqual([id]);
    expect(hook.result.current.error).toBeNull();
    // Nothing wrote to the closed session after the server's word.
    const after = memory.writes.filter((w) => w.path.endsWith(id)).map((w) => w.op);
    expect(after).toEqual(['set', 'update']);
  });

  it('a later edit cannot reopen it: there is no session to write to', async () => {
    const { hook, id } = await startedWorkout();
    await act(async () => {
      await updateSession(UID, id, { status: 'completed' });
    });
    await flush();
    await waitFor(() => expect(hook.result.current.active).toBeNull());
    const writes = memory.writes.length;
    await act(async () => {
      await hook.result.current.commitActive();
    });
    expect(memory.writes).toHaveLength(writes);
    expect(memory.read(`users/${UID}/workoutSessions/${id}`)).toMatchObject({ status: 'completed' });
  });

  it('stays open while the server still says it is active', async () => {
    const { hook, id } = await startedWorkout();
    await act(async () => {
      await updateSession(UID, id, { sessionNote: 'touched elsewhere' });
    });
    await flush();
    expect(hook.result.current.active?.id).toBe(id);
  });
});

describe('finishing on this device', () => {
  it('still completes the workout once, here', async () => {
    const { hook, id } = await startedWorkout();
    let landed = false;
    await act(async () => {
      landed = await hook.result.current.finishWorkout({});
    });
    await flush();
    await flush();
    expect(landed).toBe(true);
    expect(hook.result.current.active).toBeNull();
    await waitFor(() => expect(memory.read(`users/${UID}/workoutSessions/${id}`)).toMatchObject({ status: 'completed' }));
    expect(hook.result.current.error).toBeNull();
  });
});
