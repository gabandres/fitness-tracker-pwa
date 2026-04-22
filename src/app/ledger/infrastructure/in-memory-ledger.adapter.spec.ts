import { TestBed } from '@angular/core/testing';
import { LEDGER_PORT, LedgerPort } from '../ports/ledger.port';
import { InMemoryLedgerAdapter } from './in-memory-ledger.adapter';
import type { ProfileFields } from '../../services/firebase.service';

/**
 * Contract tests for LedgerPort against the in-memory adapter. When the
 * Firestore adapter comes online as a separate implementation, these same
 * cases should run against it via describe.each or the emulator.
 */
describe('InMemoryLedgerAdapter (LedgerPort contract)', () => {
  let port: LedgerPort;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        InMemoryLedgerAdapter,
        { provide: LEDGER_PORT, useExisting: InMemoryLedgerAdapter },
      ],
    });
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
