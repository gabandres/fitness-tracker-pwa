import { describe, expect, it } from 'vitest';
import {
  type DailyTargetRecord,
  type TargetSnapshot,
  describeTargetChange,
  owesNotice,
  planTargetRecord,
  targetSnapshot,
} from './target-history';
import { dailyTargets } from './targets';
import type { Profile } from './types';

const at = new Date('2026-10-08T12:00:00Z');
const rec = (date: string, s: TargetSnapshot, extra: Partial<DailyTargetRecord> = {}): DailyTargetRecord => ({
  date, ...s, recordedBy: 'app', recordedAt: at, updatedAt: at, ...extra,
});
const snap = (protein: number, weightLb: number, over: Partial<TargetSnapshot> = {}): TargetSnapshot => ({
  kcalTarget: 1850, kcalSource: 'auto', proteinTarget: protein, proteinSource: 'auto',
  maintenanceEstimate: 2030, maintenanceSource: 'measured',
  basis: { weightLb, proteinPerKg: 1.9, paceLbPerWeek: 0.8, calorieFloor: 1850 },
  ...over,
});

describe('planTargetRecord — an automatic change creates a notice', () => {
  it("the owner's 10/8: 135 → 130 after 153.8 → 153.6 lb, reason named, notice owed", () => {
    const stored = [rec('2026-10-07', snap(135, 153.8))];
    const plan = planTargetRecord('2026-10-08', snap(130, 153.6), stored)!;
    expect(plan.change?.protein).toEqual({ from: 135, to: 130, fromSource: 'auto', toSource: 'auto' });
    expect(plan.change?.kcal).toBeUndefined();
    expect(plan.change?.reasons).toEqual([{ kind: 'weight', fromLb: 153.8, toLb: 153.6, perKg: 1.9 }]);
    const written = rec('2026-10-08', snap(130, 153.6), { change: plan.change });
    expect(owesNotice(written)).toBe(true);
    expect(owesNotice({ ...written, noticeAckAt: at })).toBe(false);
    expect(describeTargetChange(plan.change!)).toBe('protein 135 g (auto) -> 130 g (auto): weight 153.8 -> 153.6 lb at 1.9 g/kg');
  });

  it('a calorie move names the maintenance estimate', () => {
    const plan = planTargetRecord('2026-10-09', snap(135, 154, { kcalTarget: 1900, maintenanceEstimate: 2300 }),
      [rec('2026-10-08', snap(135, 154))])!;
    expect(plan.change?.kcal).toEqual({ from: 1850, to: 1900, fromSource: 'auto', toSource: 'auto' });
    expect(plan.change?.reasons).toEqual([{ kind: 'maintenance', from: 2030, to: 2300 }]);
  });

  it('no change → today written once without a change; an identical rewrite is skipped', () => {
    const stored = [rec('2026-10-07', snap(135, 153.8))];
    const first = planTargetRecord('2026-10-08', snap(135, 153.9), stored)!;
    expect(first.change).toBeUndefined();
    expect(planTargetRecord('2026-10-08', snap(135, 153.9), [...stored, rec('2026-10-08', snap(135, 153.9))])).toBeNull();
  });

  it('a first-ever record has nothing to compare and no change', () => {
    expect(planTargetRecord('2026-10-08', snap(130, 153.6), [])).toEqual({ date: '2026-10-08', ...snap(130, 153.6) });
  });
});

describe('planTargetRecord — a user override is recorded, not announced', () => {
  it('130 auto → 140 user: reason user-set, no notice', () => {
    const stored = [rec('2026-10-08', snap(130, 153.6))];
    const plan = planTargetRecord('2026-10-09', snap(140, 153.6, { proteinSource: 'user' }), stored)!;
    expect(plan.change?.protein).toEqual({ from: 130, to: 140, fromSource: 'auto', toSource: 'user' });
    expect(plan.change?.reasons).toEqual([{ kind: 'user-set', field: 'protein' }]);
    expect(owesNotice(rec('2026-10-09', snap(140, 153.6, { proteinSource: 'user' }), { change: plan.change }))).toBe(false);
  });

  it('later weigh-ins never move the user target, so no further change is planned', () => {
    const stored = [
      rec('2026-10-08', snap(130, 153.6)),
      rec('2026-10-09', snap(140, 153.6, { proteinSource: 'user' })),
    ];
    for (const lb of [153.2, 155, 150]) {
      const plan = planTargetRecord('2026-10-10', snap(140, lb, { proteinSource: 'user' }), stored)!;
      expect(plan.change).toBeUndefined();
    }
  });
});

describe('planTargetRecord — historical targets are preserved', () => {
  it('only today is ever planned; earlier days are read, never rewritten', () => {
    const stored = [rec('2026-10-07', snap(135, 153.8)), rec('2026-10-08', snap(130, 153.6))];
    const plan = planTargetRecord('2026-10-09', snap(140, 153.6, { proteinSource: 'user' }), stored)!;
    expect(plan.date).toBe('2026-10-09');
    expect(stored.map((r) => [r.date, r.proteinTarget, r.proteinSource])).toEqual([
      ['2026-10-07', 135, 'auto'], ['2026-10-08', 130, 'auto'],
    ]);
  });

  it('a record dated after today is ignored (a clock moved back)', () => {
    const plan = planTargetRecord('2026-10-08', snap(130, 153.6), [rec('2026-10-09', snap(140, 153.6))])!;
    expect(plan.change).toBeUndefined();
  });

  it("a second move the same day keeps the day's ORIGINAL starting value", () => {
    const stored = [rec('2026-10-07', snap(135, 153.8))];
    const morning = planTargetRecord('2026-10-08', snap(130, 153.6), stored)!;
    const evening = planTargetRecord('2026-10-08', snap(125, 150),
      [...stored, rec('2026-10-08', snap(130, 153.6), { change: morning.change })])!;
    expect(evening.change?.protein).toEqual({ from: 135, to: 125, fromSource: 'auto', toSource: 'auto' });
  });
});

describe('targetSnapshot', () => {
  it('carries the sources and the live basis from dailyTargets', () => {
    const profile = {
      email: 't@t', createdAt: new Date(0), lastSeenAt: new Date(0), profileCompleted: true,
      heightIn: 68, age: 33, sex: 'male', activityLevel: 'moderate', targetPaceLbsPerWeek: 0.8,
      proteinPerKg: 1.9, calorieFloor: 1850,
    } as Profile;
    const s = targetSnapshot(dailyTargets(profile, [], { '2026-10-08': 153.6 }), profile);
    expect(s).toMatchObject({ proteinTarget: 130, proteinSource: 'auto', kcalSource: 'auto' });
    expect(s.basis).toEqual({ weightLb: 153.6, proteinPerKg: 1.9, paceLbPerWeek: 0.8, calorieFloor: 1850 });
  });
});
