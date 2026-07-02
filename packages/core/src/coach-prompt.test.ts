import { describe, it, expect } from 'vitest';
import { buildCoachSystemInstruction } from './coach-prompt';
import type { DailyLog, ProfileFields } from './types';
import type { TdeeResult } from './tdee';

const tdee: TdeeResult = {
  trueTdee: 2450,
  newDailyTarget: 1900,
  weightChangeTrend: 0.5,
  source: 'measured',
};

const profile: ProfileFields = {
  heightIn: 68,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1.0,
  goalWeightLbs: 170,
};

const log = (over: Partial<DailyLog>): DailyLog => ({
  calories: 500,
  date: new Date('2026-06-01T12:00:00'),
  ...over,
});

describe('buildCoachSystemInstruction', () => {
  it('pins the computed values so the model cannot miscount', () => {
    const out = buildCoachSystemInstruction({ logs: [], tdee, profile });
    expect(out).toContain('True TDEE: 2450 kcal/day');
    expect(out).toContain('Daily target: 1900 kcal/day');
    expect(out).toContain('TDEE source: measured');
  });

  it('formats height and renders the profile block', () => {
    const out = buildCoachSystemInstruction({ logs: [], tdee, profile });
    expect(out).toContain("Height: 5'8\"");
    expect(out).toContain('Goal weight: 170 lbs');
  });

  it('omits the profile block when profile is null', () => {
    const out = buildCoachSystemInstruction({ logs: [], tdee, profile: null });
    expect(out).not.toContain('## User profile');
    expect(out).toContain('_(no entries yet)_');
  });

  it('prefers the per-day weight map over a meal row weight', () => {
    const logs = [log({ date: new Date('2026-06-01T12:00:00'), calories: 600, protein: 40 })];
    const out = buildCoachSystemInstruction({
      logs, tdee, profile,
      dailyWeights: { '2026-06-01': 182 },
    });
    // The row weight is absent; the map supplies 182.
    expect(out).toMatch(/\| 2026-06-01 \| 182 \| 600 \| 40 \| — \|/);
  });

  it('marks exercise from any of the three completion flags', () => {
    const logs = [log({ date: new Date('2026-06-02T12:00:00'), liftCompleted: true })];
    const out = buildCoachSystemInstruction({ logs, tdee, profile });
    expect(out).toMatch(/\| 2026-06-02 \|.*\| ✓ \|/);
  });

  it('renders "—" for a missing protein rather than a fake number', () => {
    const logs = [log({ date: new Date('2026-06-03T12:00:00'), calories: 700 })];
    const out = buildCoachSystemInstruction({ logs, tdee, profile });
    expect(out).toMatch(/\| 2026-06-03 \| — \| 700 \| — \| — \|/);
  });

  it('appends the English language instruction by default', () => {
    const out = buildCoachSystemInstruction({ logs: [], tdee, profile });
    expect(out.trimEnd().endsWith('Respond in English.')).toBe(true);
  });

  it('appends the Puerto Rican Spanish instruction for es-PR', () => {
    const out = buildCoachSystemInstruction({ logs: [], tdee, profile, locale: 'es-PR' });
    expect(out).toContain('Respond in Puerto Rican Spanish');
    expect(out).toContain('tú');
  });
});
