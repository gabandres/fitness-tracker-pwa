import { describe, expect, it } from 'vitest';
import {
  PENDING_LOGS_MAX,
  PENDING_LOGS_VERSION,
  PENDING_LOG_TTL_MS,
  QUICK_ADD_MAX,
  type PendingLog,
  type QuickAddTarget,
  buildPendingLog,
  mergePendingLog,
  newLedgerId,
  parsePendingLogs,
  pendingLogEntry,
  prunePendingLogs,
  quickAddEntry,
  resolveQuickAddTargets,
  serializePendingLogs,
} from './quick-add';
import type { MealPreset } from './types';

const shake: MealPreset = { id: 'p1', name: 'Protein shake', calories: 180, protein: 32 };
const eggs: MealPreset = { id: 'p2', name: 'Three eggs', calories: 210, protein: 18, fat: 15 };
const salad: MealPreset = { id: 'p3', name: 'Side salad', calories: 90 };
const rice: MealPreset = { id: 'p4', name: 'Rice', calories: 240, carbs: 53 };

describe('resolveQuickAddTargets', () => {
  it('keeps the user slot order, not the preset order', () => {
    const out = resolveQuickAddTargets(['p3', 'p1'], [shake, eggs, salad]);
    expect(out.map((t) => t.presetId)).toEqual(['p3', 'p1']);
  });

  it('flattens the macros a widget needs to write the row', () => {
    expect(resolveQuickAddTargets(['p2'], [eggs])[0]).toEqual({
      presetId: 'p2',
      name: 'Three eggs',
      calories: 210,
      protein: 18,
      fat: 15,
    });
  });

  it('omits absent macros rather than defaulting them to 0', () => {
    const t = resolveQuickAddTargets(['p3'], [salad])[0];
    expect('protein' in t).toBe(false);
    expect('carbs' in t).toBe(false);
    expect('fat' in t).toBe(false);
  });

  it('drops a slot whose preset was deleted on another device', () => {
    expect(resolveQuickAddTargets(['p1', 'gone', 'p2'], [shake, eggs]).map((t) => t.presetId)).toEqual([
      'p1',
      'p2',
    ]);
  });

  it('collapses duplicate slots', () => {
    expect(resolveQuickAddTargets(['p1', 'p1'], [shake])).toHaveLength(1);
  });

  it('caps at QUICK_ADD_MAX', () => {
    const out = resolveQuickAddTargets(['p1', 'p2', 'p3', 'p4'], [shake, eggs, salad, rice]);
    expect(out).toHaveLength(QUICK_ADD_MAX);
    expect(out.map((t) => t.presetId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('drops a zero-calorie preset — a button whose tap changes nothing reads as broken', () => {
    expect(resolveQuickAddTargets(['z'], [{ id: 'z', name: 'Water', calories: 0 }])).toEqual([]);
  });

  it('drops a preset with a non-finite calorie count', () => {
    expect(resolveQuickAddTargets(['n'], [{ id: 'n', name: 'Bad', calories: NaN }])).toEqual([]);
  });

  it('ignores presets with no id — they cannot be addressed by a slot', () => {
    expect(resolveQuickAddTargets(['p1'], [{ name: 'Unsaved', calories: 100 }])).toEqual([]);
  });

  it('is empty for absent input rather than throwing', () => {
    expect(resolveQuickAddTargets(null, null)).toEqual([]);
    expect(resolveQuickAddTargets(undefined, [shake])).toEqual([]);
    expect(resolveQuickAddTargets(['p1'], undefined)).toEqual([]);
  });

  it('skips a non-string slot id from a hand-edited store', () => {
    expect(
      resolveQuickAddTargets([42 as unknown as string, 'p1', ''], [shake]).map((t) => t.presetId),
    ).toEqual(['p1']);
  });
});

describe('quickAddEntry', () => {
  const target: QuickAddTarget = { presetId: 'p1', name: 'Protein shake', calories: 180, protein: 32 };

  it('labels the row with the preset name and stamps the tap time', () => {
    const at = new Date('2026-08-07T18:30:00Z');
    expect(quickAddEntry(target, at)).toEqual({
      calories: 180,
      protein: 32,
      mealLabel: 'Protein shake',
      timestamp: at,
    });
  });

  it('sets no mealType — a preset has none and the clock does not imply one', () => {
    expect('mealType' in quickAddEntry(target, new Date())).toBe(false);
  });
});

describe('newLedgerId', () => {
  it('matches Firestore auto-id shape', () => {
    const id = newLedgerId(Math.random);
    expect(id).toHaveLength(20);
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  it('stays in the alphabet at both ends of the random range', () => {
    expect(newLedgerId(() => 0)).toBe('A'.repeat(20));
    // 1 is out of contract for `rand`, but a clamp beats an `undefined` char.
    expect(newLedgerId(() => 0.999999999)).toBe('9'.repeat(20));
  });

  it('does not repeat itself across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newLedgerId(Math.random)));
    expect(ids.size).toBe(50);
  });
});

describe('buildPendingLog / pendingLogEntry', () => {
  const entry = {
    calories: 180,
    protein: 32,
    mealLabel: 'Protein shake',
    timestamp: new Date('2026-08-07T18:30:00Z'),
  };

  it('parks a flat, primitive-only row — Swift encodes the same shape', () => {
    const p = buildPendingLog('abc', 'u1', entry, 0);
    expect(p).toEqual({
      v: PENDING_LOGS_VERSION,
      id: 'abc',
      uid: 'u1',
      calories: 180,
      protein: 32,
      mealLabel: 'Protein shake',
      atMs: entry.timestamp.getTime(),
    });
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('falls back to nowMs when the entry carries no timestamp', () => {
    expect(buildPendingLog('abc', 'u1', { calories: 100 }, 1234).atMs).toBe(1234);
  });

  it('round-trips back to the entry that will be written', () => {
    const back = pendingLogEntry(buildPendingLog('abc', 'u1', entry, 0));
    expect(back).toEqual(entry);
  });

  it('keeps the tap day, not the flush day', () => {
    const tapped = new Date('2026-08-07T22:45:00Z');
    const p = buildPendingLog('abc', 'u1', { calories: 100, timestamp: tapped }, 0);
    expect(pendingLogEntry(p).timestamp).toEqual(tapped);
  });

  it('omits mealType entirely when the caller had no slot — the native case', () => {
    const p = buildPendingLog('abc', 'u1', { calories: 100 }, 0);
    expect('mealType' in p).toBe(false);
  });

  it('carries the slot the user picked, so a flush hours later still files it right', () => {
    const p = buildPendingLog('abc', 'u1', { calories: 100, mealType: 'breakfast' }, 0);
    expect(p.mealType).toBe('breakfast');
    expect(pendingLogEntry(p).mealType).toBe('breakfast');
  });
});

describe('parsePendingLogs', () => {
  const good = buildPendingLog('abc', 'u1', { calories: 100 }, 1000);

  it('reads back what it wrote', () => {
    expect(parsePendingLogs(serializePendingLogs([good]))).toEqual([good]);
  });

  it('is empty for absent or unparseable storage', () => {
    expect(parsePendingLogs(null)).toEqual([]);
    expect(parsePendingLogs('')).toEqual([]);
    expect(parsePendingLogs('{tru')).toEqual([]);
    expect(parsePendingLogs('{"not":"an array"}')).toEqual([]);
  });

  it('keeps the good rows around a corrupt one', () => {
    const raw = JSON.stringify([good, { v: 1, id: '' }, 7, null, good]);
    expect(parsePendingLogs(raw)).toHaveLength(2);
  });

  it('rejects a foreign wire version', () => {
    expect(parsePendingLogs(JSON.stringify([{ ...good, v: 99 }]))).toEqual([]);
  });

  it('rejects a row with no uid — it cannot be attributed to an account', () => {
    expect(parsePendingLogs(JSON.stringify([{ ...good, uid: '' }]))).toEqual([]);
  });

  it('rejects an unknown mealType — the rules would refuse it on every flush', () => {
    expect(parsePendingLogs(JSON.stringify([{ ...good, mealType: 'brunch' }]))).toEqual([]);
  });

  it('accepts a row with no mealType at all — Swift omits the key', () => {
    expect(parsePendingLogs(JSON.stringify([good]))).toEqual([good]);
  });
});

describe('mergePendingLog', () => {
  const at = (id: string, ms: number): PendingLog => buildPendingLog(id, 'u1', { calories: 100 }, ms);

  it('appends oldest-first', () => {
    const list = mergePendingLog(mergePendingLog([], at('a', 1)), at('b', 2));
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('dedupes by id, newest copy winning — the replayed tap parks once', () => {
    const first = at('a', 1);
    const replay = { ...first, calories: 250 };
    const list = mergePendingLog([first], replay);
    expect(list).toHaveLength(1);
    expect(list[0].calories).toBe(250);
  });

  it('drops the oldest past the cap', () => {
    let list: PendingLog[] = [];
    for (let i = 0; i < PENDING_LOGS_MAX + 5; i++) list = mergePendingLog(list, at(`id${i}`, i));
    expect(list).toHaveLength(PENDING_LOGS_MAX);
    expect(list[0].id).toBe('id5');
  });
});

describe('prunePendingLogs', () => {
  const mine = buildPendingLog('a', 'u1', { calories: 100 }, 10_000);
  const theirs = buildPendingLog('b', 'u2', { calories: 100 }, 10_000);

  it('drops another account’s parked writes', () => {
    expect(prunePendingLogs([mine, theirs], 10_000, 'u1')).toEqual([mine]);
  });

  it('drops everything when the account changed — this is the sign-out clear', () => {
    expect(prunePendingLogs([mine, theirs], 10_000, 'u3')).toEqual([]);
  });

  it('prunes on age only when there is no session to compare against', () => {
    expect(prunePendingLogs([mine, theirs], 10_000, null)).toEqual([mine, theirs]);
  });

  it('drops a write past the TTL', () => {
    const now = 10_000 + PENDING_LOG_TTL_MS + 1;
    expect(prunePendingLogs([mine], now, 'u1')).toEqual([]);
  });

  it('keeps a write exactly at the TTL boundary', () => {
    expect(prunePendingLogs([mine], 10_000 + PENDING_LOG_TTL_MS, 'u1')).toEqual([mine]);
  });
});
