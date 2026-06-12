import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';
import { FirestoreLedgerCore } from './firestore-ledger.core';
import type { UserProfileDoc } from '../../services/firebase.service';

/**
 * Emulator contract for `FirestoreLedgerCore` (issue #6 phase 3) — the
 * Firestore arm the in-memory port contract couldn't provide. Runs the
 * core against the REAL Firestore emulator with the PRODUCTION rules
 * loaded, authenticated as the owning uid — so query shapes, deleteField
 * semantics, and rules compatibility are all exercised for real.
 *
 * NOT part of the default `ng test` run (`.emulator.test.ts` doesn't
 * match the `*.spec.ts` include). Run via `npm run test:ledger`, which
 * wraps `firebase emulators:exec --only firestore`.
 *
 * Known fidelity note: real Firestore `deleteDoc` on an unknown id is an
 * idempotent no-op (resolves), while `InMemoryLedgerAdapter.deleteLog`
 * rejects. The in-memory adapter is deliberately stricter; the case here
 * asserts the REAL semantics.
 */

const RULES_PATH = join(__dirname, '..', '..', '..', '..', 'firestore.rules');
const PROJECT_ID = 'macrolog-ledger-core-test';

// `ng test` also globs *.test.ts but has no emulator — skip there.
// `npm run test:ledger` runs under emulators:exec, which sets this env.
const EMULATOR_AVAILABLE = !!process.env['FIRESTORE_EMULATOR_HOST'];

let env: RulesTestEnvironment;
let uidCounter = 0;

beforeAll(async () => {
  if (!EMULATOR_AVAILABLE) return;
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

const baseProfile = (): UserProfileDoc => ({
  email: 'core@test.local',
  createdAt: Timestamp.now(),
  lastSeenAt: Timestamp.now(),
  profileCompleted: false,
});

/** Fresh core per test: new uid, authed context, prod rules enforced. */
function makeCore(): FirestoreLedgerCore {
  const uid = `core-user-${uidCounter++}`;
  const db = env
    .authenticatedContext(uid, { email_verified: true })
    .firestore() as unknown as Firestore;
  return new FirestoreLedgerCore(db, () => uid);
}

describe.skipIf(!EMULATOR_AVAILABLE)('FirestoreLedgerCore — emulator contract', () => {
  let core: FirestoreLedgerCore;

  beforeEach(async () => {
    await env.clearFirestore();
    core = makeCore();
  });

  describe('profile doc primitives', () => {
    it('readProfileDoc returns null before the doc exists', async () => {
      expect(await core.readProfileDoc()).toBeNull();
    });

    it('createProfileDoc + readProfileDoc round-trips with Timestamp fields', async () => {
      const initial = baseProfile();
      await core.createProfileDoc(initial);
      const read = await core.readProfileDoc();
      expect(read).not.toBeNull();
      expect(read!.email).toBe('core@test.local');
      expect(read!.profileCompleted).toBe(false);
      // The STORED shape keeps Firestore Timestamps — the Date mapping
      // happens above the core, in toDomainProfile (CONTEXT.md "Date
      // type at the seam").
      expect(typeof (read!.createdAt as Timestamp).toDate).toBe('function');
    });

    it('updateProfileDoc merges a partial patch', async () => {
      await core.createProfileDoc(baseProfile());
      await core.updateProfileDoc({
        heightIn: 70,
        age: 30,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        profileCompleted: true,
        lastSeenAt: Timestamp.now(),
      });
      const read = await core.readProfileDoc();
      expect(read!.profileCompleted).toBe(true);
      expect(read!.heightIn).toBe(70);
      expect(read!.email).toBe('core@test.local'); // untouched field survives
    });

    it('updateProfileDoc rejects when the doc does not exist (updateDoc semantics)', async () => {
      await expect(core.updateProfileDoc({ profileCompleted: true })).rejects.toThrow();
    });

    it('prod rules are live: an unverified email cannot create a profile', async () => {
      const uid = `unverified-${uidCounter++}`;
      const db = env
        .authenticatedContext(uid, { email_verified: false })
        .firestore() as unknown as Firestore;
      const unverifiedCore = new FirestoreLedgerCore(db, () => uid);
      await expect(unverifiedCore.createProfileDoc(baseProfile())).rejects.toThrow();
    });
  });

  describe('daily logs', () => {
    it('returns logs oldest-first from getRecentLogs, dates as JS Date', async () => {
      await core.addLog({ calories: 100, timestamp: new Date('2026-04-21T08:00:00Z') });
      await core.addLog({ calories: 200, timestamp: new Date('2026-04-20T08:00:00Z') });
      await core.addLog({ calories: 300, timestamp: new Date('2026-04-22T08:00:00Z') });
      const logs = await core.getRecentLogs(14);
      expect(logs.map((l) => l.calories)).toEqual([200, 100, 300]);
      expect(logs[0].date).toBeInstanceOf(Date);
      expect((logs[0].date as unknown as { toMillis?: unknown }).toMillis).toBeUndefined();
    });

    it('caps getRecentLogs at the requested row count, keeping the LATEST rows', async () => {
      for (let i = 0; i < 8; i++) {
        await core.addLog({ calories: i, timestamp: new Date(2026, 3, i + 1) });
      }
      const logs = await core.getRecentLogs(5);
      expect(logs.length).toBe(5);
      // Row cap keeps the newest 5 (Apr 4–8), oldest-first.
      expect(logs.map((l) => l.calories)).toEqual([3, 4, 5, 6, 7]);
    });

    it('updateLog mutates the entry and clears flags via deleteField', async () => {
      await core.addLog({
        calories: 100,
        exerciseCompleted: true,
        mealLabel: 'lunch',
        timestamp: new Date('2026-04-22T12:00:00Z'),
      });
      const [entry] = await core.getRecentLogs();
      expect(entry.exerciseCompleted).toBe(true);

      await core.updateLog(entry.id!, { calories: 250, exerciseCompleted: false });
      const [updated] = await core.getRecentLogs();
      expect(updated.calories).toBe(250);
      expect(updated.exerciseCompleted).toBeUndefined(); // deleteField removed it
      expect(updated.mealLabel).toBeUndefined();         // omitted label cleared too
    });

    it('deleteLog removes the entry', async () => {
      await core.addLog({ calories: 100, timestamp: new Date('2026-04-22T12:00:00Z') });
      const [entry] = await core.getRecentLogs();
      await core.deleteLog(entry.id!);
      expect(await core.getRecentLogs()).toEqual([]);
    });

    it('updateLog rejects on unknown id (updateDoc semantics)', async () => {
      await expect(core.updateLog('nope', { calories: 10 })).rejects.toThrow();
    });

    it('deleteLog on unknown id is an idempotent no-op (REAL Firestore semantics)', async () => {
      // Divergence from InMemoryLedgerAdapter, which rejects — see header.
      await expect(core.deleteLog('nope')).resolves.toBeUndefined();
    });

    it('addLog without a timestamp uses now()', async () => {
      const before = Date.now();
      await core.addLog({ calories: 50 });
      const [entry] = await core.getRecentLogs();
      expect(entry.date.getTime()).toBeGreaterThanOrEqual(before - 1);
      expect(entry.date.getTime()).toBeLessThanOrEqual(Date.now() + 1);
    });

    it('prod rules are live: out-of-range calories are rejected', async () => {
      await expect(
        core.addLog({ calories: 999999, timestamp: new Date('2026-04-22T12:00:00Z') }),
      ).rejects.toThrow();
    });
  });
});
