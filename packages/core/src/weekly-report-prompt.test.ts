import { describe, it, expect } from 'vitest';
import {
  buildWeeklyReportPayload,
  buildMilestoneContext,
  formatMilestoneContext,
  type MilestoneContext,
} from './weekly-report-prompt';
import type { DailyLog, ProfileFields } from './types';
import type { TdeeResult } from './tdee';

const NOW = new Date('2026-06-15T12:00:00'); // fixed "today" for determinism

const tdee: TdeeResult = {
  trueTdee: 2400,
  newDailyTarget: 1900,
  weightChangeTrend: 0.4,
  source: 'measured',
};

const profile: ProfileFields = {
  heightIn: 70,
  age: 28,
  sex: 'male',
  activityLevel: 'active',
  targetPaceLbsPerWeek: 1.0,
  goalWeightLbs: 175,
};

// Two logged days inside the 14-day window ending NOW.
const logs: DailyLog[] = [
  { calories: 1800, protein: 140, date: new Date('2026-06-14T09:00:00') },
  { calories: 2000, protein: 120, date: new Date('2026-06-13T09:00:00'), exerciseCompleted: true },
];

describe('buildWeeklyReportPayload', () => {
  const { systemInstruction, prompt } = buildWeeklyReportPayload({
    logs, tdee, profile, dailyWeights: { '2026-06-14': 180 }, now: NOW,
  });

  it('emits the one-row-per-day 14-day summary header', () => {
    expect(systemInstruction).toContain('## 14-day summary');
    expect(systemInstruction).toContain('Days logged: 2/14');
  });

  it('pins computed values + profile', () => {
    expect(systemInstruction).toContain('True TDEE: 2400 kcal/day');
    expect(systemInstruction).toContain("Height: 5'10\"");
  });

  it('averages only logged days', () => {
    // (1800 + 2000) / 2 = 1900
    expect(systemInstruction).toContain('Avg kcal (on logged days): 1900');
  });

  it('renders the per-day table with the weigh-in from the map', () => {
    expect(systemInstruction).toContain('| 2026-06-14 | 180 | 1800 | 140 | 1 | — |');
  });

  it('counts exercise days', () => {
    expect(systemInstruction).toContain('Exercise days: 1/14');
  });

  it('builds the fixed 5-point review prompt', () => {
    expect(prompt).toContain('Generate a concise weekly review');
    expect(prompt).toContain('One specific, actionable recommendation');
    expect(prompt).toContain('Format as markdown');
  });

  it('defaults to the English language instruction', () => {
    expect(systemInstruction).toContain('Respond in English.');
  });

  it('switches to Spanish for es-PR', () => {
    const es = buildWeeklyReportPayload({ logs, tdee, profile, locale: 'es-PR', now: NOW });
    expect(es.systemInstruction).toContain('Respond in Puerto Rican Spanish');
  });

  it('appends the milestone fragment to the prompt when present', () => {
    const withMs = buildWeeklyReportPayload({
      logs, tdee, profile, now: NOW,
      milestone: { totalLogs: 100, earliestLogAt: new Date('2026-06-05T00:00:00'), currentStreak: 5 },
    });
    expect(withMs.prompt).toContain('Milestone context');
    expect(withMs.prompt).toContain('100th meal logged this week.');
  });
});

describe('buildMilestoneContext', () => {
  it('summarises lifetime logs', () => {
    const ctx = buildMilestoneContext(
      [
        { calories: 100, date: new Date('2026-06-01T00:00:00') },
        { calories: 100, date: new Date('2026-05-01T00:00:00') },
      ],
      12,
    );
    expect(ctx.totalLogs).toBe(2);
    expect(ctx.currentStreak).toBe(12);
    expect(ctx.earliestLogAt?.toISOString()).toBe(new Date('2026-05-01T00:00:00').toISOString());
  });

  it('handles an empty history', () => {
    const ctx = buildMilestoneContext([], 0);
    expect(ctx).toEqual({ totalLogs: 0, earliestLogAt: null, currentStreak: 0 });
  });
});

describe('formatMilestoneContext', () => {
  it('returns empty when no milestone is hit', () => {
    const ctx: MilestoneContext = { totalLogs: 3, earliestLogAt: new Date('2026-06-14T00:00:00'), currentStreak: 2 };
    expect(formatMilestoneContext(ctx, NOW)).toBe('');
  });

  it('recognises a ~10-day-in "first week" milestone', () => {
    const ctx: MilestoneContext = { totalLogs: 30, earliestLogAt: new Date('2026-06-05T00:00:00'), currentStreak: 9 };
    const out = formatMilestoneContext(ctx, NOW);
    expect(out).toContain('First week of logging completed');
    expect(out).toContain('No emojis');
  });

  it('recognises a 100-day streak', () => {
    const ctx: MilestoneContext = { totalLogs: 40, earliestLogAt: new Date('2026-01-01T00:00:00'), currentStreak: 120 };
    const out = formatMilestoneContext(ctx, NOW);
    expect(out).toContain('120 days (deep consistency territory)');
  });
});
