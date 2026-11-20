/**
 * The in-memory Firestore (`test-support/memory-firestore.ts`), checked the
 * way it is meant to be used: through the REAL ledger. A write is read back,
 * a listener hears it, a query orders and limits, and a missing document
 * answers `not-found`.
 */
jest.mock('firebase/firestore', () => require('@/test-support/memory-firestore').firestoreModule);
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));

import {
  clearDailyLogged,
  deleteSession,
  readActiveSession,
  setDailyLogged,
  startSession,
  subscribeDailyLogged,
  subscribeRecentSessions,
  updateSession,
} from '@/lib/ledger';
import { firestoreModule, memory } from '@/test-support/memory-firestore';
import type { SessionDraft, WorkoutSession } from '@/lib/workout';

const UID = 'u1';
const draft = (over: Partial<SessionDraft> = {}): SessionDraft =>
  ({ status: 'active', date: new Date('2026-11-20T15:00:00Z'), exercises: [], ...over }) as SessionDraft;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => memory.reset());

describe('the real ledger over the in-memory Firestore', () => {
  it('reads back the session it wrote', async () => {
    await startSession(UID, draft({ templateName: 'Leg Day' }), 's1');
    const { session, fromCache } = await readActiveSession(UID);
    expect(fromCache).toBe(false);
    expect(session).toMatchObject({ id: 's1', status: 'active', templateName: 'Leg Day' });
    expect(session?.updatedAt).toBeInstanceOf(Date);
  });

  it('answers not-found for an update of a session that was never created', async () => {
    await expect(updateSession(UID, 'ghost', { exercises: [] })).rejects.toMatchObject({ code: 'not-found' });
    expect(memory.read(`users/${UID}/workoutSessions/ghost`)).toBeUndefined();
  });

  it('an update changes only what it names', async () => {
    await startSession(UID, draft({ templateName: 'Pull Day' }), 's1');
    await updateSession(UID, 's1', { status: 'completed' });
    expect((await readActiveSession(UID)).session).toBeNull();
    expect(memory.read(`users/${UID}/workoutSessions/s1`)).toMatchObject({ status: 'completed', templateName: 'Pull Day' });
  });

  it('a listener hears each change, newest session first, and stops when unsubscribed', async () => {
    const seen: WorkoutSession[][] = [];
    const stop = subscribeRecentSessions(UID, 2, (list) => seen.push(list));
    await settle();
    expect(seen).toEqual([[]]);

    await startSession(UID, draft({ date: new Date('2026-11-18T15:00:00Z') }), 'old');
    await startSession(UID, draft({ date: new Date('2026-11-20T15:00:00Z') }), 'new');
    await startSession(UID, draft({ date: new Date('2026-11-19T15:00:00Z') }), 'mid');
    await settle();
    expect(seen[seen.length - 1].map((s) => s.id)).toEqual(['new', 'mid']);

    await deleteSession(UID, 'new');
    await settle();
    expect(seen[seen.length - 1].map((s) => s.id)).toEqual(['mid', 'old']);

    stop();
    const count = seen.length;
    await deleteSession(UID, 'mid');
    await settle();
    expect(seen).toHaveLength(count);
  });

  it('reports a read the server did not answer', async () => {
    memory.fromCache = true;
    expect((await readActiveSession(UID)).fromCache).toBe(true);
  });

  it('stores the day flag as the app writes it, and removes it on clear', async () => {
    const seen: Record<string, boolean>[] = [];
    const stop = subscribeDailyLogged(UID, (answers) => seen.push(answers));
    await setDailyLogged(UID, '2026-11-19', true);
    await settle();
    const stored = memory.read(`users/${UID}/dailyLogged/2026-11-19`);
    expect(stored?.complete).toBe(true);
    expect(stored?.updatedAt).toBeInstanceOf(firestoreModule.Timestamp);
    expect(seen[seen.length - 1]).toEqual({ '2026-11-19': true });
    await clearDailyLogged(UID, '2026-11-19');
    await settle();
    expect(memory.read(`users/${UID}/dailyLogged/2026-11-19`)).toBeUndefined();
    expect(seen[seen.length - 1]).toEqual({});
    stop();
  });

  it('refuses a write when the test says the server would', async () => {
    memory.failWrite = () => Object.assign(new Error('offline'), { code: 'unavailable' });
    await expect(startSession(UID, draft(), 's1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(memory.writes).toEqual([]);
  });
});

describe('the adapter on its own', () => {
  const { doc, collection, setDoc, updateDoc, getDoc, getDocs, query, where, orderBy, limit, documentId, writeBatch, deleteField, increment, serverTimestamp } = firestoreModule;
  const db = {};

  it('merges on set-with-merge and replaces without it', async () => {
    const ref = doc(db, 'users', 'u', 'x', 'a');
    await setDoc(ref, { a: 1, nested: { keep: true, drop: 1 } });
    await setDoc(ref, { b: 2, nested: { drop: deleteField() } }, { merge: true });
    expect(memory.read('users/u/x/a')).toEqual({ a: 1, b: 2, nested: { keep: true } });
    await setDoc(ref, { c: 3 });
    expect(memory.read('users/u/x/a')).toEqual({ c: 3 });
  });

  it('updates dotted paths, increments, deletes fields and stamps the server time', async () => {
    memory.now = () => Date.UTC(2026, 10, 20, 12);
    const ref = doc(db, 'users', 'u', 'x', 'a');
    await setDoc(ref, { n: 1, m: { a: 1, b: 2 }, gone: true });
    await updateDoc(ref, { n: increment(2), 'm.a': 5, gone: deleteField(), at: serverTimestamp() });
    const stored = memory.read('users/u/x/a');
    expect(stored).toMatchObject({ n: 3, m: { a: 5, b: 2 } });
    expect(stored).not.toHaveProperty('gone');
    expect((stored?.at as { toMillis(): number }).toMillis()).toBe(Date.UTC(2026, 10, 20, 12));
  });

  it('queries by range on the document id, in order, with a limit', async () => {
    const col = collection(db, 'users', 'u', 'days');
    for (const id of ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']) await setDoc(doc(col, id), { v: id });
    const snap = await getDocs(query(col, where(documentId(), '>=', '2026-11-18'), orderBy(documentId(), 'desc'), limit(2)));
    expect(snap.docs.map((d) => d.id)).toEqual(['2026-11-20', '2026-11-19']);
  });

  it('leaves a document without the ordered field out of the result', async () => {
    const col = collection(db, 'users', 'u', 'rows');
    await setDoc(doc(col, 'a'), { at: 2 });
    await setDoc(doc(col, 'b'), { other: 1 });
    expect((await getDocs(query(col, orderBy('at', 'asc')))).docs.map((d) => d.id)).toEqual(['a']);
  });

  it('applies a batch whole, or not at all', async () => {
    const col = collection(db, 'users', 'u', 'rows');
    await setDoc(doc(col, 'a'), { v: 1 });
    const bad = writeBatch();
    bad.set(doc(col, 'b'), { v: 2 }).update(doc(col, 'missing'), { v: 3 });
    await expect(bad.commit()).rejects.toMatchObject({ code: 'not-found' });
    expect(memory.ids('users/u/rows')).toEqual(['a']);
    const good = writeBatch();
    good.set(doc(col, 'b'), { v: 2 }).update(doc(col, 'a'), { v: 9 }).delete(doc(col, 'b'));
    await good.commit();
    expect(memory.read('users/u/rows/a')).toEqual({ v: 9 });
    expect(memory.ids('users/u/rows')).toEqual(['a']);
  });

  it('mints an id for doc(collection) and hands back copies, never the stored object', async () => {
    const ref = doc(collection(db, 'users', 'u', 'rows'));
    expect(ref.id).toMatch(/^mem\d+$/);
    await setDoc(ref, { list: [1] });
    const first = (await getDoc(ref)).data() as { list: number[] };
    first.list.push(2);
    expect((await getDoc(ref)).data()).toEqual({ list: [1] });
  });
});
