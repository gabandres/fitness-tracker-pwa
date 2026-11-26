import { describe, expect, it } from 'vitest';
import {
  activeHomeNotes,
  checkInReading,
  checkInSites,
  checkInToday,
  estimatedMealToday,
  homePlanOf,
  reviewDue,
  reviewRotations,
  weightAlertsQuiet,
} from './home-plan';
import { DEFAULT_REENTRY_RULE, sanitizeReentryRules } from './reentry-rule';
import { REENTRY_LOAD_FACTOR, REENTRY_RIR, reentryLoad, reentryRuleFor, reentrySessionExercises } from './reentry';
import { travelPeriodsOf } from './travel';
import { archivedByTag, templateTagsOf } from './rotation-templates';
import { MIDNIGHT } from './day-boundary';
import type { WorkoutSession } from './workout';

const plan = homePlanOf({
  homePlan: {
    label: 'Home v2.4',
    trainingDays: [5, 1, 3, 3, 9],
    notes: [{ from: '2026-11-28', to: '2026-12-06', label: 'Evenings', note: 'sessions in the evening' }, { from: 'bad', to: 'x', label: 'dropped' }],
    review: { title: 'v2.4 review', body: 'Recovery OK?', templateIds: ['leg', 'pull', 'push'], since: '2026-11-20', afterRotations: 2 },
    deloadTriggerLifts: 3,
    deloadRepsDown: 1,
    weightQuietUntil: '2026-11-26',
    checkIn: { date: '2026-11-26', title: 'Tape + photo', baseline: { date: '2026-10-30', weightLb: 151.8, waistIn: 31.25, neckIn: 14.5 } },
    estimatedMeals: [{ from: '2026-11-28', to: '2026-12-06', slot: 'Lunch' }],
  },
});

describe('home plan (2026-11-18)', () => {
  it('reads a well-formed plan and drops what is malformed', () => {
    expect(plan?.trainingDays).toEqual([1, 3, 5]);
    expect(plan?.notes).toHaveLength(1);
    expect(homePlanOf({})).toBeNull();
    expect(homePlanOf({ homePlan: 'x' })).toBeNull();
  });
  it('dates: notes, estimated meals, quiet window, check-in for a week', () => {
    expect(activeHomeNotes(plan, '2026-11-27')).toHaveLength(0);
    expect(activeHomeNotes(plan, '2026-12-06')).toHaveLength(1);
    expect(estimatedMealToday(plan, '2026-11-28')?.slot).toBe('Lunch');
    expect(estimatedMealToday(plan, '2026-12-07')).toBeNull();
    expect(weightAlertsQuiet(plan, '2026-11-25')).toBe(true);
    expect(weightAlertsQuiet(plan, '2026-11-26')).toBe(false);
    expect(checkInToday(plan, '2026-11-25')).toBeNull();
    expect(checkInToday(plan, '2026-11-26')?.title).toBe('Tape + photo');
    expect(checkInToday(plan, '2026-12-02')).not.toBeNull();
    expect(checkInToday(plan, '2026-12-03')).toBeNull();
  });
  it('check-in reading: 7-day average and the newest tape vs the baseline', () => {
    const weights = { '2026-11-19': 150, '2026-11-20': 152, '2026-11-26': 151, '2026-11-18': 160 };
    const tapes = [
      { date: new Date(2026, 10, 26, 7), waist: 31, neck: 14.5 },
      { date: new Date(2026, 10, 20, 7), waist: 33 },
    ];
    const r = checkInReading(plan!.checkIn!, '2026-11-26', weights, tapes, MIDNIGHT);
    // 11/20–11/26: 152 and 151 (11/19 is outside the 7 days).
    expect(r.avgWeightLb).toBe(151.5);
    expect(r.weighIns).toBe(2);
    expect(r.weightDelta).toBe(-0.3);
    expect(r.waistDelta).toBe(-0.25);
    expect(r.neckDelta).toBe(0);
    expect(r.chestIn).toBeNull();
    expect(checkInSites(plan!.checkIn!)).toEqual(['waist', 'neck']);
  });
  it('check-in sites: chest tracked with no baseline reads its first tape (2026-11-26)', () => {
    const ci = homePlanOf({ homePlan: { checkIn: {
      date: '2026-11-30', title: 'Tape', sites: ['waist', 'chest', 'neck', 'hip', 'chest'],
      baseline: { date: '2026-10-30', waistIn: 31.25, neckIn: 14.5, chestIn: 'x' },
    } } })!.checkIn!;
    expect(ci.sites).toEqual(['waist', 'neck', 'chest']);
    expect(ci.baseline.chestIn).toBeUndefined();
    expect(checkInSites(ci)).toEqual(['waist', 'neck', 'chest']);
    const r = checkInReading(ci, '2026-11-30', {}, [
      { date: new Date(2026, 10, 30, 7), waist: 31.25, neck: 14.5, chest: 38.5 },
      { date: new Date(2026, 10, 26, 7), chest: 39 },
    ], MIDNIGHT);
    expect(r.chestIn).toBe(38.5);
    expect(r.chestDelta).toBeNull();
    expect(checkInReading({ ...ci, baseline: { ...ci.baseline, chestIn: 39 } }, '2026-11-30', {}, [
      { date: new Date(2026, 10, 30, 7), chest: 38.5 },
    ], MIDNIGHT).chestDelta).toBe(-0.5);
  });
  it('review: due after two full NORMAL rotations; re-entry sessions do not count', () => {
    const s = (day: number, templateId: string, extra: Partial<WorkoutSession> = {}) => ({
      date: new Date(2026, 10, day, 10), templateId, status: 'completed' as const, exercises: [{}] as WorkoutSession['exercises'], ...extra,
    });
    const reentry = [s(20, 'leg', { reentry: 'post-travel' }), s(22, 'pull', { reentry: 'post-travel' }), s(24, 'push', { reentry: 'post-travel' })];
    const one = [s(25, 'leg'), s(27, 'pull'), s(29, 'push')];
    const two = [s(30, 'leg'), s(32, 'pull')];
    expect(reviewRotations(plan!.review!, [...reentry, ...one], MIDNIGHT)).toBe(1);
    expect(reviewDue(plan, [...reentry, ...one, ...two], MIDNIGHT)).toBeNull();
    expect(reviewDue(plan, [...reentry, ...one, ...two, s(34, 'push')], MIDNIGHT)?.title).toBe('v2.4 review');
  });
});

describe('per-template re-entry rules (2026-11-18)', () => {
  const periods = travelPeriodsOf({
    travelPeriods: [{
      start: '2026-10-31', end: '2026-11-18',
      reentryRules: [
        { templateIds: ['leg'], loadPct: 10, rir: 2, label: 'Re-entry — legs: −10%, RIR 2' },
        { templateIds: ['pull', 'push'], loadPct: 5, label: 'Re-entry — upper: −5%, normal effort' },
        { templateIds: [], loadPct: 5 },
        { templateIds: ['x'], loadPct: 90 },
      ],
    }],
  });
  it('survives the travel sanitizer; malformed rules dropped', () => {
    expect(periods[0].reentryRules).toHaveLength(2);
    expect(sanitizeReentryRules('x')).toEqual([]);
  });
  it('picks the template rule; a travel re-entry or an unlisted template takes the default', () => {
    expect(reentryRuleFor('post-travel', 'leg', periods[0])).toEqual({ loadPct: 10, rir: 2, label: 'Re-entry — legs: −10%, RIR 2' });
    expect(reentryRuleFor('post-travel', 'push', periods[0]).rir).toBeUndefined();
    expect(reentryRuleFor('post-travel', 'other', periods[0])).toBe(DEFAULT_REENTRY_RULE);
    expect(reentryRuleFor('travel', 'leg', periods[0])).toBe(DEFAULT_REENTRY_RULE);
    expect(DEFAULT_REENTRY_RULE).toEqual({ loadPct: Math.round((1 - REENTRY_LOAD_FACTOR) * 100), rir: REENTRY_RIR });
  });
  it('−5 % rounds down to a real step; −10 % unchanged', () => {
    expect(reentryLoad(110, { stepLb: 5 }, 0.95)).toBe(100);
    expect(reentryLoad(40, { stepLb: 5 }, 0.95)).toBe(35);
    expect(reentryLoad(35, { stepLb: 5 })).toBe(30);
    const ex = reentrySessionExercises(
      [{ exerciseId: 'row', name: 'Row', cues: [], sets: [{ kind: 'activation', group: 1, weight: 100 }] }],
      () => ({ stepLb: 2.5 }), { loadPct: 5 },
    );
    expect(ex[0].sets[0].weight).toBe(95);
  });
  it('nearest: a −5 % cut on a 5-lb jump keeps the load; a big stack still drops', () => {
    expect(reentryLoad(20, { stepLb: 5 }, 0.95, 'nearest')).toBe(20);
    expect(reentryLoad(110, { stepLb: 5 }, 0.95, 'nearest')).toBe(105);
    expect(reentryLoad(90, { stepLb: 5 }, 0.95, 'nearest')).toBe(85);
    expect(reentryLoad(80, { stepLb: 5, loadSteps: [70, 80, 90] }, 0.95, 'nearest')).toBe(80);
    expect(reentryLoad(20, { stepLb: 2.5 }, 0.95, 'nearest')).toBe(20);
    expect(reentryLoad(20, { stepLb: 5 }, 0.9, 'down')).toBe(15);
  });
});

describe('template tags (2026-11-18)', () => {
  it('cleans tags and groups archived templates by tag', () => {
    expect(templateTagsOf([' travel kit ', 'travel kit', 3, ''])).toEqual(['travel kit']);
    const at = new Date();
    const g = archivedByTag([
      { id: 'a', archivedAt: at, tags: ['travel kit'] },
      { id: 'b', archivedAt: at, tags: ['travel kit'] },
      { id: 'c', tags: ['travel kit'] },
      { id: 'd', archivedAt: at },
    ]);
    expect(g).toEqual([{ tag: 'travel kit', templates: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })] }]);
  });
});
