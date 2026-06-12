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

/** Uid of the core under test — for seeding server-written docs. */
let currentUid = '';

/** Fresh core per test: new uid, authed context, prod rules enforced. */
function makeCore(): FirestoreLedgerCore {
  const uid = `core-user-${uidCounter++}`;
  currentUid = uid;
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

    it('addLog returns the server-assigned doc id (phase 5)', async () => {
      const id = await core.addLog({ calories: 100, timestamp: new Date('2026-04-22T08:00:00Z') });
      const [entry] = await core.getRecentLogs();
      expect(entry.id).toBe(id);
    });

    it('round-trips carbs/fat under prod rules, and updateLog clears them when omitted', async () => {
      await core.addLog({
        calories: 520, protein: 30, carbs: 45, fat: 18,
        timestamp: new Date('2026-04-22T12:00:00Z'),
      });
      let [entry] = await core.getRecentLogs();
      expect(entry.carbs).toBe(45);
      expect(entry.fat).toBe(18);

      // Omitted carbs/fat clear via deleteField, mirroring protein.
      await core.updateLog(entry.id!, { calories: 520, protein: 30 });
      [entry] = await core.getRecentLogs();
      expect(entry.carbs).toBeUndefined();
      expect(entry.fat).toBeUndefined();
      expect(entry.protein).toBe(30);
    });

    it('prod rules reject out-of-range carbs/fat', async () => {
      await expect(
        core.addLog({ calories: 100, carbs: 5000, timestamp: new Date('2026-04-22T12:00:00Z') }),
      ).rejects.toThrow();
      await expect(
        core.addLog({ calories: 100, fat: -5, timestamp: new Date('2026-04-22T12:00:00Z') }),
      ).rejects.toThrow();
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

  describe('daily weights + water', () => {
    it('round-trips weights keyed by dateKey', async () => {
      await core.setDailyWeight('2026-04-21', 180.4);
      await core.setDailyWeight('2026-04-22', 179.8);
      await core.setDailyWeight('2026-04-22', 179.6); // overwrite same day
      const weights = await core.getDailyWeights();
      expect(weights).toEqual({ '2026-04-21': 180.4, '2026-04-22': 179.6 });
    });

    it('clamps water to [0, 20000] ml and rounds', async () => {
      await core.setDailyWater('2026-04-22', 999999);
      await core.setDailyWater('2026-04-21', -50);
      await core.setDailyWater('2026-04-20', 123.7);
      const water = await core.getDailyWater();
      expect(water['2026-04-22']).toBe(20000);
      expect(water['2026-04-21']).toBe(0);
      expect(water['2026-04-20']).toBe(124);
    });
  });

  describe('presets + measurements', () => {
    it('round-trips presets, dropping the optional protein when absent', async () => {
      await core.addPreset({ name: 'Oatmeal', calories: 300, protein: 10 });
      await core.addPreset({ name: 'Eggs', calories: 140 });
      const presets = await core.getPresets();
      expect(presets.length).toBe(2);
      const eggs = presets.find((p) => p.name === 'Eggs')!;
      expect(eggs.protein).toBeUndefined();
      await core.deletePreset(presets[0].id!);
      expect((await core.getPresets()).length).toBe(1);
    });

    it('measurements return newest-first with Date at the seam', async () => {
      await core.addMeasurement({ waist: 34 });
      await new Promise((r) => setTimeout(r, 5));
      await core.addMeasurement({ waist: 33, chest: 41 });
      const ms = await core.getRecentMeasurements();
      expect(ms[0].waist).toBe(33);
      expect(ms[0].chest).toBe(41);
      expect(ms[0].date).toBeInstanceOf(Date);
      await core.deleteMeasurement(ms[0].id!);
      expect((await core.getRecentMeasurements()).length).toBe(1);
    });
  });

  describe('weekly reports (server-written, client-read)', () => {
    it('returns null with no reports, newest report otherwise', async () => {
      expect(await core.getLatestReport()).toBeNull();
      // Reports are admin-SDK-written in prod (client writes blocked by
      // rules) — seed through the rules-disabled context accordingly.
      const uid = currentUid;
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        const { doc, setDoc, Timestamp: Ts } = await import('firebase/firestore');
        await setDoc(doc(db, 'users', uid, 'reports', 'old'), {
          markdown: 'old', generatedAt: Ts.fromDate(new Date('2026-04-01')),
        });
        await setDoc(doc(db, 'users', uid, 'reports', 'new'), {
          markdown: 'new', generatedAt: Ts.fromDate(new Date('2026-04-08')),
        });
      });
      const latest = await core.getLatestReport();
      expect(latest?.markdown).toBe('new');
      expect(latest?.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('workout: exercises, templates, sessions', () => {
    it('exercise catalog round-trips ordered by name, pruning undefined logStyle', async () => {
      const idB = await core.addExercise({ name: 'Bench Press', muscles: ['chest'], defaultCues: ['arch'] });
      await core.addExercise({ name: 'Arnold Press', muscles: ['shoulders'], defaultCues: [], logStyle: 'weight-reps' });
      const exercises = await core.getExercises();
      expect(exercises.map((e) => e.name)).toEqual(['Arnold Press', 'Bench Press']);
      expect(exercises[1].createdAt).toBeInstanceOf(Date);

      await core.updateExercise(idB, { name: 'Paused Bench' });
      expect((await core.getExercises()).map((e) => e.name)).toEqual(['Arnold Press', 'Paused Bench']);

      await core.deleteExercise(idB);
      expect((await core.getExercises()).length).toBe(1);
    });

    it('templates round-trip newest-updated-first', async () => {
      const t1 = await core.addTemplate({ name: 'Push', exercises: [] });
      await new Promise((r) => setTimeout(r, 5));
      await core.addTemplate({ name: 'Pull', restMiniSec: 60, exercises: [] });
      let templates = await core.getTemplates();
      expect(templates.map((t) => t.name)).toEqual(['Pull', 'Push']);
      expect(templates[1].createdAt).toBeInstanceOf(Date);

      await core.updateTemplate(t1, { name: 'Push Day', exercises: [] });
      templates = await core.getTemplates();
      expect(templates[0].name).toBe('Push Day'); // updatedAt bump reorders

      await core.deleteTemplate(t1);
      expect((await core.getTemplates()).length).toBe(1);
    });

    it('session lifecycle: start active → update → complete → query by template', async () => {
      const tplId = await core.addTemplate({ name: 'Legs', exercises: [] });
      const sessionId = await core.startSession({
        status: 'active',
        templateId: tplId,
        templateName: 'Legs',
        date: new Date('2026-06-10T10:00:00Z'),
        exercises: [{
          exerciseId: 'x1', name: 'Squat', cues: [],
          sets: [{ kind: 'working', weight: 185, reps: 5 }],
        }],
      });

      const active = await core.getActiveSession();
      expect(active?.id).toBe(sessionId);
      expect(active?.date).toBeInstanceOf(Date);
      expect(active?.exercises[0].sets[0].weight).toBe(185);

      // Completed sessions stop matching the active query and start
      // matching the per-template history query.
      await core.updateSession(sessionId, { status: 'completed', bodyweight: 180 });
      expect(await core.getActiveSession()).toBeNull();

      const forTemplate = await core.getSessionsForTemplate(tplId);
      expect(forTemplate.length).toBe(1);
      expect(forTemplate[0].bodyweight).toBe(180);

      expect((await core.getAllSessions()).length).toBe(1);
      expect((await core.getRecentSessions()).length).toBe(1);

      await core.deleteSession(sessionId);
      expect((await core.getAllSessions()).length).toBe(0);
    });

    it('mergeExercises remaps sessions + templates onto the survivor and deletes the victim', async () => {
      const fromId = await core.addExercise({ name: 'DB Press', muscles: ['chest'], defaultCues: [] });
      const toId = await core.addExercise({ name: 'Machine Press', muscles: ['chest'], defaultCues: [] });
      const tplId = await core.addTemplate({
        name: 'Chest',
        exercises: [{ exerciseId: fromId, name: 'DB Press', plannedSets: [] }],
      });
      const sessId = await core.startSession({
        status: 'completed',
        templateId: tplId,
        date: new Date('2026-06-09T10:00:00Z'),
        exercises: [{ exerciseId: fromId, name: 'DB Press', cues: [], sets: [] }],
      });

      await core.mergeExercises(fromId, toId);

      const exercises = await core.getExercises();
      expect(exercises.map((e) => e.id)).toEqual([toId]); // victim deleted

      const [tpl] = await core.getTemplates();
      expect(tpl.exercises[0].exerciseId).toBe(toId);
      expect(tpl.exercises[0].name).toBe('Machine Press'); // survivor name adopted

      const sessions = await core.getAllSessions();
      expect(sessions.find((s) => s.id === sessId)!.exercises[0].exerciseId).toBe(toId);
    });
  });
});
