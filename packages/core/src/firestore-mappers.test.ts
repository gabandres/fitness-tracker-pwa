import { describe, expect, it } from 'vitest';
import {
  isTimestampLike,
  oldestFirst,
  toCustomFood,
  toDailyLog,
  toDate,
  toDomainProfile,
  toDomainProfilePatch,
  toMeasurement,
  toWeeklyReport,
} from './firestore-mappers';

/**
 * Pure tests for the doc → domain mappers. These are the highest-value thing
 * to pin without an emulator: the logic both adapters lean on to keep
 * `Timestamp` from crossing the ledger seam. A `TimestampLike` stub stands in
 * for a real Firestore `Timestamp` (structural match — no SDK import).
 */
const stamp = (d: Date) => ({ toDate: () => d });

describe('toDate / isTimestampLike', () => {
  const d = new Date('2026-03-04T05:06:07Z');

  it('unwraps a Timestamp-like value', () => {
    expect(toDate(stamp(d)).getTime()).toBe(d.getTime());
  });

  it('passes a Date through untouched (idempotent)', () => {
    expect(toDate(d)).toBe(d);
  });

  it('falls back to epoch for missing/bad values, or the given fallback', () => {
    expect(toDate(undefined).getTime()).toBe(0);
    expect(toDate('nope').getTime()).toBe(0);
    const fb = new Date('2020-01-01T00:00:00Z');
    expect(toDate(null, fb)).toBe(fb);
  });

  it('recognizes only objects with a toDate() method', () => {
    expect(isTimestampLike(stamp(d))).toBe(true);
    expect(isTimestampLike(d)).toBe(false);
    expect(isTimestampLike(null)).toBe(false);
    expect(isTimestampLike({ toDate: 42 })).toBe(false);
  });
});

describe('oldestFirst', () => {
  it('reverses without mutating the input', () => {
    const rows = [3, 2, 1];
    expect(oldestFirst(rows)).toEqual([1, 2, 3]);
    expect(rows).toEqual([3, 2, 1]);
  });
});

describe('toDailyLog', () => {
  const date = new Date('2026-02-01T12:00:00Z');

  it('maps every field and converts timestamp → date', () => {
    const log = toDailyLog('abc', {
      calories: 500,
      timestamp: stamp(date),
      weight: 180,
      protein: 40,
      carbs: 30,
      fat: 10,
      exerciseCompleted: true,
      liftCompleted: false,
      cardioCompleted: true,
      mealLabel: 'lunch',
      mealType: 'lunch',
    });
    expect(log).toEqual({
      id: 'abc',
      calories: 500,
      date,
      weight: 180,
      protein: 40,
      carbs: 30,
      fat: 10,
      exerciseCompleted: true,
      liftCompleted: false,
      cardioCompleted: true,
      mealLabel: 'lunch',
      mealType: 'lunch',
    });
    expect(log.date).toBeInstanceOf(Date);
  });

  it('defaults calories to 0 and leaves optional fields undefined', () => {
    const log = toDailyLog('x', { timestamp: stamp(date) });
    expect(log.calories).toBe(0);
    expect(log.protein).toBeUndefined();
  });

  it('used with oldestFirst yields oldest-first order (desc query reversed)', () => {
    const older = new Date('2026-01-01T00:00:00Z');
    const newer = new Date('2026-01-02T00:00:00Z');
    // Firestore returns timestamp-desc: newest first.
    const descRows = [
      { id: 'n', data: { calories: 1, timestamp: stamp(newer) } },
      { id: 'o', data: { calories: 1, timestamp: stamp(older) } },
    ];
    const logs = oldestFirst(descRows.map((r) => toDailyLog(r.id, r.data)));
    expect(logs.map((l) => l.id)).toEqual(['o', 'n']);
  });
});

describe('toMeasurement', () => {
  it('maps timestamp → date and passes body fields through', () => {
    const date = new Date('2026-04-04T00:00:00Z');
    const m = toMeasurement('m1', { timestamp: stamp(date), waist: 32, neck: 15 });
    expect(m).toEqual({ id: 'm1', date, waist: 32, chest: undefined, bicep: undefined, hip: undefined, neck: 15 });
  });
});

describe('toCustomFood', () => {
  it('spreads the doc, sets id, and converts createdAt', () => {
    const created = new Date('2026-05-05T00:00:00Z');
    const f = toCustomFood('f1', {
      name: 'Oats',
      servingSize: 100,
      servingUnit: 'g',
      calories: 380,
      source: 'label',
      brand: 'Store',
      createdAt: stamp(created),
    });
    expect(f.id).toBe('f1');
    expect(f.name).toBe('Oats');
    expect(f.brand).toBe('Store');
    expect(f.createdAt).toEqual(created);
    expect((f.createdAt as unknown as { toDate?: unknown }).toDate).toBeUndefined();
  });

  it('falls back to epoch when createdAt is absent', () => {
    const f = toCustomFood('f2', { name: 'X', servingSize: 1, servingUnit: 'serving', calories: 0, source: 'manual' });
    expect(f.createdAt.getTime()).toBe(0);
  });
});

describe('toWeeklyReport', () => {
  it('maps generatedAt and defaults markdown', () => {
    const at = new Date('2026-06-06T00:00:00Z');
    expect(toWeeklyReport('r1', { markdown: '# hi', generatedAt: stamp(at) })).toEqual({
      id: 'r1',
      markdown: '# hi',
      generatedAt: at,
    });
    expect(toWeeklyReport('r2', { generatedAt: stamp(at) }).markdown).toBe('');
  });
});

describe('toDomainProfile / toDomainProfilePatch', () => {
  const created = new Date('2026-01-02T03:04:05Z');
  const seen = new Date('2026-05-06T07:08:09Z');

  it('converts required + optional date fields, passes non-dates through', () => {
    const p = toDomainProfile({
      email: 'a@example.com',
      createdAt: stamp(created),
      lastSeenAt: stamp(seen),
      profileCompleted: true,
      heightIn: 70,
      compedUntil: stamp(seen),
    });
    expect(p.createdAt).toEqual(created);
    expect(p.lastSeenAt).toEqual(seen);
    expect(p.compedUntil).toEqual(seen);
    expect(p.email).toBe('a@example.com');
    expect(p.heightIn).toBe(70);
    expect((p.createdAt as unknown as { toMillis?: unknown }).toMillis).toBeUndefined();
  });

  it('leaves a null fastStartedAt null and absent fields absent', () => {
    const p = toDomainProfile({ createdAt: stamp(created), fastStartedAt: null });
    expect(p.fastStartedAt).toBeNull();
    expect('ageConfirmedAt' in p).toBe(false);
  });

  it('patch converts present dates and stays partial', () => {
    const patch = toDomainProfilePatch({ lastSeenAt: stamp(seen), heightIn: 68 });
    expect(patch.lastSeenAt).toEqual(seen);
    expect(patch.heightIn).toBe(68);
    expect('createdAt' in patch).toBe(false);
  });
});
