/**
 * The active session (`lib/active-session.ts`), through its own interface:
 * no renderer, the REAL ledger over the in-memory Firestore, the real journal
 * over the AsyncStorage mock.
 *
 * The rule under test is which copy of a live workout wins — this runtime's,
 * the device journal's or the server's — and the case that had no test until
 * 2026-11-20: a session the server says is completed.
 */
jest.mock('firebase/firestore', () => require('@/test-support/memory-firestore').firestoreModule);
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createActiveSession } from '@/lib/active-session';
import { journalActiveSession, readActiveSessionJournal } from '@/lib/active-session-journal';
import { startSession, subscribeRecentSessions, updateSession } from '@/lib/ledger';
import { memory } from '@/test-support/memory-firestore';
import type { SessionDraft, WorkoutSession } from '@/lib/workout';

const UID = 'u1';
const path = (id: string) => `users/${UID}/workoutSessions/${id}`;
const settle = () => new Promise((r) => setTimeout(r, 0));
const draft = (over: Partial<SessionDraft> = {}): SessionDraft =>
  ({ status: 'active', date: new Date('2026-11-20T15:00:00Z'), exercises: [], ...over }) as SessionDraft;
const exercise = (name: string) => ({ exerciseId: name, name, sets: [] }) as unknown as WorkoutSession['exercises'][number];
const noFinishes = Promise.resolve([]);
const alive = () => true;

function setup() {
  const seen: (WorkoutSession | null)[] = [];
  const saving: boolean[] = [];
  const errors: Error[] = [];
  const resolved: string[] = [];
  const session = createActiveSession({
    onChange: (s) => seen.push(s),
    onSaving: (v) => saving.push(v),
    onError: (e) => errors.push(e),
    onResolved: (u) => resolved.push(u),
  });
  return { session, seen, saving, errors, resolved };
}

beforeEach(async () => {
  memory.reset();
  await AsyncStorage.clear();
});

describe('starting a workout', () => {
  it('is on screen at once, on the device, and then on the server', async () => {
    const { session, seen, errors } = setup();
    session.begin(UID, draft({ templateName: 'Leg Day' }));
    // Before any await: the screen has it.
    expect(seen).toHaveLength(1);
    const id = session.peek()?.id as string;
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    await settle();
    expect(memory.read(path(id))).toMatchObject({ status: 'active', templateName: 'Leg Day' });
    await session.flush();
    expect((await readActiveSessionJournal(UID))?.session.id).toBe(id);
    expect(errors).toEqual([]);
  });

  it('keeps the workout on the device, marked unsent, when the create is refused', async () => {
    const { session, errors } = setup();
    memory.failWrite = () => Object.assign(new Error('offline'), { code: 'unavailable' });
    session.begin(UID, draft());
    await settle();
    await session.flush();
    expect(errors).toHaveLength(1);
    expect(session.peek()).not.toBeNull();
    expect((await readActiveSessionJournal(UID))?.created).toBe(false);
  });
});

describe('saving an edit', () => {
  it('writes the live fields and reports saving while the write is out', async () => {
    const { session, saving } = setup();
    session.begin(UID, draft());
    await settle();
    const edited = { ...(session.peek() as WorkoutSession), exercises: [exercise('Squat')] };
    session.set(UID, edited);
    const write = session.persist(UID, edited);
    expect(session.isSaving()).toBe(true);
    await write;
    expect(session.isSaving()).toBe(false);
    expect(saving).toEqual([true, false]);
    expect((memory.read(path(edited.id as string))?.exercises as unknown[]).length).toBe(1);
  });

  it('sends the whole document when the server never got the create', async () => {
    const { session, errors } = setup();
    const now = new Date();
    const orphan = { ...draft({ exercises: [exercise('Row')] }), id: 'orphan', createdAt: now, updatedAt: now } as WorkoutSession;
    session.set(UID, orphan);
    await session.persist(UID, orphan);
    expect(memory.read(path('orphan'))).toMatchObject({ status: 'active' });
    expect(errors).toEqual([]);
  });
});

describe('gaining focus', () => {
  it('shows the journal while the server cannot be asked, and writes it back', async () => {
    const now = new Date();
    await journalActiveSession(UID, { ...draft({ templateName: 'Pull Day' }), id: 's1', createdAt: now, updatedAt: now } as WorkoutSession, Date.now());
    memory.fromCache = true;
    const { session, resolved } = setup();
    session.open(UID, { alive, finishes: noFinishes });
    await settle();
    await settle();
    expect(session.peek()?.id).toBe('s1');
    expect(resolved).toEqual([UID]);
    expect(memory.read(path('s1'))).toMatchObject({ templateName: 'Pull Day' });
  });

  it('does not bring back a journaled session the server no longer holds as active', async () => {
    const now = new Date();
    await journalActiveSession(UID, { ...draft(), id: 's1', createdAt: now, updatedAt: now } as WorkoutSession, Date.now());
    await startSession(UID, draft({ status: 'completed' }), 's1');
    const { session, seen } = setup();
    session.open(UID, { alive, finishes: noFinishes });
    await settle();
    await settle();
    // Shown from the device first, then corrected by the server's answer.
    expect(session.peek()).toBeNull();
    expect(seen[seen.length - 1]).toBeNull();
  });

  it('keeps a workout started in this runtime over what a server read says', async () => {
    await startSession(UID, draft({ templateName: 'Somewhere else' }), 'other');
    const { session } = setup();
    session.begin(UID, draft({ templateName: 'Here' }));
    const mine = session.peek()?.id;
    session.open(UID, { alive, finishes: noFinishes });
    await settle();
    await settle();
    expect(session.peek()?.id).toBe(mine);
  });

  it('answers nothing to a screen that has already gone', async () => {
    await startSession(UID, draft(), 's1');
    const { session, resolved } = setup();
    session.open(UID, { alive: () => false, finishes: noFinishes });
    await settle();
    await settle();
    expect(session.peek()).toBeNull();
    expect(resolved).toEqual([]);
  });
});

describe('a session the server says is completed', () => {
  it('is closed here, and its journal is cleared', async () => {
    const { session, seen } = setup();
    session.begin(UID, draft({ templateName: 'Leg Day' }));
    const id = session.peek()?.id as string;
    await settle();
    await session.flush();
    const stop = subscribeRecentSessions(UID, 50, (list) => session.serverSaw(UID, list));
    await settle();
    expect(session.peek()?.id).toBe(id);

    // Finished somewhere else: another device, or a data script.
    await updateSession(UID, id, { status: 'completed' });
    await settle();
    await settle();

    expect(session.peek()).toBeNull();
    expect(seen[seen.length - 1]).toBeNull();
    expect(await readActiveSessionJournal(UID)).toBeNull();
    stop();

    // And the next focus does not bring it back.
    session.open(UID, { alive, finishes: noFinishes });
    await settle();
    await settle();
    expect(session.peek()).toBeNull();
  });

  it('stays open while the server still says active', async () => {
    const { session } = setup();
    session.begin(UID, draft());
    const mine = session.peek() as WorkoutSession;
    expect(session.serverSaw(UID, [{ ...mine, status: 'active' }])).toBe(false);
    expect(session.serverSaw(UID, [])).toBe(false);
    expect(session.peek()?.id).toBe(mine.id);
  });

  it('is left alone while this device is the one finishing it', async () => {
    const { session } = setup();
    session.begin(UID, draft());
    const mine = session.peek() as WorkoutSession;
    expect(session.serverSaw(UID, [{ ...mine, status: 'completed' }], { has: (id) => id === mine.id })).toBe(false);
    expect(session.peek()?.id).toBe(mine.id);
  });

  it('is left alone when it is a completed session open for editing', async () => {
    const { session } = setup();
    const now = new Date();
    const past = { ...draft({ status: 'completed' }), id: 'past', createdAt: now, updatedAt: now } as WorkoutSession;
    expect(session.reopen(UID, past)).toBe(true);
    expect(session.serverSaw(UID, [past])).toBe(false);
    expect(session.peek()?.id).toBe('past');
  });
});

describe('editing a completed session', () => {
  it('is refused while a workout is live', () => {
    const { session } = setup();
    session.begin(UID, draft());
    const now = new Date();
    expect(session.reopen(UID, { ...draft({ status: 'completed' }), id: 'past', createdAt: now, updatedAt: now } as WorkoutSession)).toBe(false);
  });

  it('hands back the edited copy and the pristine one, and leaves the screen', () => {
    const { session } = setup();
    const now = new Date();
    const past = { ...draft({ status: 'completed' }), id: 'past', createdAt: now, updatedAt: now } as WorkoutSession;
    session.reopen(UID, past);
    const edited = { ...past, exercises: [exercise('Curl')] };
    session.set(UID, edited);
    const result = session.endEdit(UID);
    expect(result.edited).toBe(edited);
    expect(result.original).toBe(past);
    expect(session.peek()).toBeNull();
    expect(session.editing()).toBeNull();
  });
});

describe('closing', () => {
  it('drops a journal write that was still waiting', async () => {
    jest.useFakeTimers();
    try {
      const { session } = setup();
      const now = new Date();
      session.set(UID, { ...draft(), id: 's1', createdAt: now, updatedAt: now } as WorkoutSession);
      session.close(UID);
      jest.advanceTimersByTime(2000);
    } finally {
      jest.useRealTimers();
    }
    await settle();
    expect(await readActiveSessionJournal(UID)).toBeNull();
  });
});
