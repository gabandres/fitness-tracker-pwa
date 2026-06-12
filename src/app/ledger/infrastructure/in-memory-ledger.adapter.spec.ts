import { TestBed } from '@angular/core/testing';
import { LEDGER_PORT, LedgerPort } from '../ports/ledger.port';
import { InMemoryLedgerAdapter } from './in-memory-ledger.adapter';
import type { ProfileFields } from '../../services/firebase.service';

/**
 * Contract tests for `LedgerPort`. Written as a `describe.each` factory so
 * the SAME cases run against every adapter — one interface, verified at N
 * seams (issue #6). Today only the in-memory adapter runs here.
 *
 * The Firestore arm exists at the CORE level instead: `FirestoreLedgerCore`
 * (framework-free, profile + dailyLog slice) is exercised against the real
 * emulator with prod rules in `firestore-ledger-core.emulator.test.ts`,
 * via `npm run test:ledger`. It is intentionally NOT part of the default
 * app unit run, which has no emulator.
 *
 * Known fidelity divergence: this adapter REJECTS `deleteLog` on an
 * unknown id; real Firestore `deleteDoc` is an idempotent no-op. The
 * in-memory strictness is deliberate (catches bad-id bugs in store
 * tests); the emulator suite asserts the real semantics.
 */

type ConfigureAdapter = () => void;

const ADAPTERS: ReadonlyArray<readonly [string, ConfigureAdapter]> = [
  [
    'InMemoryLedgerAdapter',
    () => {
      TestBed.configureTestingModule({
        providers: [
          InMemoryLedgerAdapter,
          { provide: LEDGER_PORT, useExisting: InMemoryLedgerAdapter },
        ],
      });
    },
  ],
];

describe.each(ADAPTERS)('LedgerPort contract — %s', (_label, configure) => {
  let port: LedgerPort;

  beforeEach(() => {
    configure();
    port = TestBed.inject(LEDGER_PORT);
  });

  describe('profile lifecycle', () => {
    it('creates a profile on first ensureUserProfile()', async () => {
      expect(port.profile()).toBeNull();
      expect(port.profileCompleted()).toBe(false);

      await port.ensureUserProfile();

      expect(port.profile()).not.toBeNull();
      expect(port.profileCompleted()).toBe(false);
    });

    it('flips profileCompleted after saveProfile', async () => {
      await port.ensureUserProfile();
      const fields: ProfileFields = {
        heightIn: 70,
        age: 30,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
      };
      await port.saveProfile(fields);

      expect(port.profileCompleted()).toBe(true);
      expect(port.profile()?.heightIn).toBe(70);
    });

    it('clearProfile drops the signal', async () => {
      await port.ensureUserProfile();
      port.clearProfile();
      expect(port.profile()).toBeNull();
    });
  });

  // The core invariant issue #6 (phase 2) closes: the seam exposes JS Date,
  // never a Firestore Timestamp. See CONTEXT.md "Date type at the seam".
  describe('Date type at the seam', () => {
    it('exposes profile timestamps as Date, never Timestamp', async () => {
      await port.ensureUserProfile();
      const p = port.profile()!;
      expect(p.createdAt).toBeInstanceOf(Date);
      expect(p.lastSeenAt).toBeInstanceOf(Date);
      // A Firestore Timestamp would expose toDate()/toMillis(); a Date does not.
      expect((p.createdAt as unknown as { toMillis?: unknown }).toMillis).toBeUndefined();
      expect((p.lastSeenAt as unknown as { toDate?: unknown }).toDate).toBeUndefined();
    });

    it('stamps ageConfirmedAt as a Date', async () => {
      await port.ensureUserProfile();
      await port.saveProfile({
        heightIn: 70,
        age: 30,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        ageConfirmed: true,
      });
      expect(port.profile()?.ageConfirmedAt).toBeInstanceOf(Date);
    });

    it('startFast stores fastStartedAt as a Date', async () => {
      await port.ensureUserProfile();
      const at = new Date('2026-05-01T18:00:00Z');
      await port.startFast(at);
      const stored = port.profile()?.fastStartedAt;
      expect(stored).toBeInstanceOf(Date);
      expect((stored as Date).getTime()).toBe(at.getTime());
    });
  });

  describe('daily logs', () => {
    it('returns logs oldest-first from getRecentLogs', async () => {
      const t1 = new Date('2026-04-20T08:00:00Z');
      const t2 = new Date('2026-04-21T08:00:00Z');
      const t3 = new Date('2026-04-22T08:00:00Z');
      await port.addLog({ calories: 100, timestamp: t2 });
      await port.addLog({ calories: 200, timestamp: t1 });
      await port.addLog({ calories: 300, timestamp: t3 });

      const logs = await port.getRecentLogs(14);
      expect(logs.map((l) => l.calories)).toEqual([200, 100, 300]);
      // Dates cross the seam as JS Date, not Timestamp.
      expect(logs[0].date).toBeInstanceOf(Date);
    });

    it('respects the days cap', async () => {
      for (let i = 0; i < 20; i++) {
        await port.addLog({ calories: i, timestamp: new Date(2026, 3, i + 1) });
      }
      const logs = await port.getRecentLogs(5);
      expect(logs.length).toBe(5);
    });

    it('updateLog mutates the entry and deleteLog removes it', async () => {
      await port.addLog({ calories: 100, timestamp: new Date('2026-04-22') });
      const [entry] = await port.getRecentLogs();
      await port.updateLog(entry.id!, { calories: 250 });
      expect((await port.getRecentLogs())[0].calories).toBe(250);

      await port.deleteLog(entry.id!);
      expect(await port.getRecentLogs()).toEqual([]);
    });

    it('updateLog rejects on unknown id, matching Firestore updateDoc', async () => {
      await expect(port.updateLog('nope', { calories: 10 })).rejects.toThrow();
    });

    it('deleteLog rejects on unknown id', async () => {
      await expect(port.deleteLog('nope')).rejects.toThrow();
    });

    it('exerciseCompleted=false clears the flag, matching deleteField() in prod', async () => {
      await port.addLog({ calories: 100, exerciseCompleted: true, timestamp: new Date('2026-04-22') });
      const [entry] = await port.getRecentLogs();
      expect(entry.exerciseCompleted).toBe(true);
      await port.updateLog(entry.id!, { calories: 100, exerciseCompleted: false });
      expect((await port.getRecentLogs())[0].exerciseCompleted).toBeUndefined();
    });

    it('addLog without a timestamp uses now()', async () => {
      const before = Date.now();
      await port.addLog({ calories: 50 });
      const [entry] = await port.getRecentLogs();
      expect(entry.date.getTime()).toBeGreaterThanOrEqual(before);
      expect(entry.date.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('profile idempotency', () => {
    it('saveProfile preserves ageConfirmedAt across subsequent saves', async () => {
      await port.ensureUserProfile();
      const fields: ProfileFields = {
        heightIn: 70,
        age: 30,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        ageConfirmed: true,
      };
      await port.saveProfile(fields);
      const firstStamp = port.profile()?.ageConfirmedAt;
      expect(firstStamp).toBeDefined();

      await port.saveProfile({ ...fields, ageConfirmed: true });
      expect(port.profile()?.ageConfirmedAt).toBe(firstStamp);
    });
  });

  describe('dailyWater clamping', () => {
    it('clamps input to [0, 20000] and rounds', async () => {
      await port.setDailyWater('2026-04-22', 999999);
      await port.setDailyWater('2026-04-21', -50);
      await port.setDailyWater('2026-04-20', 123.7);
      const water = await port.getDailyWater();
      expect(water['2026-04-22']).toBe(20000);
      expect(water['2026-04-21']).toBe(0);
      expect(water['2026-04-20']).toBe(124);
    });
  });

  describe('presets + measurements', () => {
    it('round-trips presets', async () => {
      await port.addPreset({ name: 'Oatmeal', calories: 300, protein: 10 });
      await port.addPreset({ name: 'Eggs', calories: 140 });
      const presets = await port.getPresets();
      expect(presets.length).toBe(2);
      await port.deletePreset(presets[0].id!);
      expect((await port.getPresets()).length).toBe(1);
    });

    it('measurements return newest-first', async () => {
      await port.addMeasurement({ waist: 34 });
      await new Promise((r) => setTimeout(r, 2));
      await port.addMeasurement({ waist: 33 });
      const ms = await port.getRecentMeasurements();
      expect(ms[0].waist).toBe(33);
    });
  });
});
