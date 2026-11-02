import { describe, expect, it } from 'vitest';
import { maintenanceDisplay } from './maintenance-display';
import { maintenanceView } from './maintenance-view';
import { planTargetRecord, targetSnapshot, toDailyTargetRecord } from './target-history';
import type { DailyTargets } from './targets';
import type { TdeeResult } from './tdee';

const measured = (over: Record<string, unknown> = {}) =>
  ({ source: 'measured', trueTdee: 2258, ci95Tdee: 60, intakeDays: 42, windowDays: 42, reliable: true, confidence: 1, ...over }) as unknown as TdeeResult;
const rec = (date: string, maintenanceEstimate: number, over: Record<string, unknown> = {}) =>
  ({ date, maintenanceEstimate, maintenanceSource: 'measured' as const, ...over });

describe('maintenanceDisplay', () => {
  it('shows the 7-day mean of the raw values, today live, with the range and the day count', () => {
    const records = [rec('2026-10-24', 2100), rec('2026-10-27', 2135), rec('2026-10-29', 2211)];
    expect(maintenanceDisplay(measured(), records, '2026-10-30')).toEqual({
      raw: 2258,
      displayed: Math.round((2258 + 2100 + 2135 + 2211) / 4),
      range: { low: 2176 - 60, high: 2176 + 60 },
      validDays: 42,
    });
  });
  it('reads only the window: not older than 7 days, not today’s own record, not a formula day', () => {
    const records = [
      rec('2026-10-23', 1000),
      rec('2026-10-30', 1000),
      rec('2026-10-28', 1000, { maintenanceSource: 'formula' }),
    ];
    expect(maintenanceDisplay(measured(), records, '2026-10-30')?.displayed).toBe(2258);
  });
  it('averages the stored raw value, never an earlier displayed one', () => {
    const records = [rec('2026-10-29', 2000, { maintenanceRaw: 2200, maintenanceDisplayed: 2000 })];
    expect(maintenanceDisplay(measured({ trueTdee: 2300 }), records, '2026-10-30')?.displayed).toBe(2250);
  });
  it('a travel hold is shown as held, unsmoothed', () => {
    const hold = { travelHold: { state: 'frozen', start: '2026-10-31', end: '2026-11-18', frozenAsOf: '2026-10-30' } };
    expect(maintenanceDisplay(measured(hold), [rec('2026-10-30', 1000)], '2026-11-05')?.displayed).toBe(2258);
  });
  it('no range when the run measured no interval; nothing at all for a formula figure', () => {
    expect(maintenanceDisplay(measured({ ci95Tdee: undefined }), [], '2026-10-30')?.range).toBeUndefined();
    expect(maintenanceDisplay({ source: 'formula', trueTdee: 2000 } as unknown as TdeeResult, [], '2026-10-30')).toBeNull();
  });
});

describe('the display is a reading: nothing else moves', () => {
  const display = { raw: 2258, displayed: 2176, range: { low: 2116, high: 2236 }, validDays: 42 };
  it('Today’s line and its delta read the displayed value; without one they read the raw', () => {
    expect(maintenanceView(measured(), 1216, display)).toMatchObject({ maintenance: 2176, delta: 1216 - 2176, range: display.range, validDays: 42 });
    const plain = maintenanceView(measured(), 1216);
    expect(plain).toMatchObject({ maintenance: 2258, delta: 1216 - 2258 });
    expect(plain?.range).toBeUndefined();
  });
  const targets = { tdee: measured(), calorieTarget: 1850, calorieSource: 'user', proteinTarget: 140, proteinSource: 'user' } as unknown as DailyTargets;
  it('the snapshot stores both next to an unchanged `maintenanceEstimate`', () => {
    expect(targetSnapshot(targets, null, null, display)).toMatchObject({ maintenanceEstimate: 2258, maintenanceRaw: 2258, maintenanceDisplayed: 2176 });
    const off = targetSnapshot(targets, null);
    expect(off.maintenanceEstimate).toBe(2258);
    expect('maintenanceRaw' in off).toBe(false);
    expect('maintenanceDisplayed' in off).toBe(false);
  });
  it('they reach the plan and come back through the mapper', () => {
    const plan = planTargetRecord('2026-10-30', targetSnapshot(targets, null, null, display), []);
    expect(plan).toMatchObject({ maintenanceRaw: 2258, maintenanceDisplayed: 2176 });
    const back = toDailyTargetRecord('2026-10-30', { ...plan, recordedBy: 'app', recordedAt: new Date(), updatedAt: new Date() });
    expect(back).toMatchObject({ maintenanceRaw: 2258, maintenanceDisplayed: 2176 });
  });
});
