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
  // ── 14-day window (2026-08-12) ────────────────────────────────
  // Both frontends passed unfiltered windows and the builder trimmed
  // nothing: web sent a 14-ROW cache (~2 days for a heavy logger), mobile
  // sent 400 rows (~100 days). Everything below pins the trim so neither
  // caller can reintroduce that.

  it('keeps only the last 14 calendar days of rows', () => {
    const logs = [
      log({ date: new Date('2026-06-01T12:00:00'), calories: 111 }), // 20 days before newest
      log({ date: new Date('2026-06-07T12:00:00'), calories: 222 }), // 14 days before → out
      log({ date: new Date('2026-06-08T12:00:00'), calories: 333 }), // 13 days before → in
      log({ date: new Date('2026-06-21T12:00:00'), calories: 444 }), // newest
    ];
    const out = buildCoachSystemInstruction({ logs, tdee, profile });
    expect(out).not.toContain('| 111 |');
    expect(out).not.toContain('| 222 |');
    expect(out).toContain('| 333 |');
    expect(out).toContain('| 444 |');
  });

  it('anchors the window on the newest row, not on today', () => {
    // A user who stopped logging months ago still gets their last fortnight
    // to ask about instead of an empty table.
    const logs = [
      log({ date: new Date('2025-01-10T12:00:00'), calories: 555 }),
      log({ date: new Date('2025-01-12T12:00:00'), calories: 666 }),
    ];
    const out = buildCoachSystemInstruction({ logs, tdee, profile });
    expect(out).toContain('| 555 |');
    expect(out).toContain('| 666 |');
  });

  it('counts DAYS as days and rows as entries', () => {
    // Four meal rows across two calendar days. The old line said
    // "Logs available: 4 days".
    const logs = [
      log({ date: new Date('2026-06-10T08:00:00') }),
      log({ date: new Date('2026-06-10T13:00:00') }),
      log({ date: new Date('2026-06-10T19:00:00') }),
      log({ date: new Date('2026-06-11T08:00:00') }),
    ];
    const out = buildCoachSystemInstruction({ logs, tdee, profile });
    expect(out).toContain('- Logs available: 2 of the last 14 days (4 logged entries)');
  });

  it('is identical for a wide and a pre-trimmed window (web/mobile parity)', () => {
    // The two frontends hand in different-sized arrays by design; after the
    // trim the model must see the same prompt from both.
    const inWindow = [
      log({ date: new Date('2026-06-20T12:00:00'), calories: 700 }),
      log({ date: new Date('2026-06-21T12:00:00'), calories: 800 }),
    ];
    const older = Array.from({ length: 300 }, (_, i) =>
      log({ date: new Date(2026, 0, 1 + i % 120), calories: 100 }));
    const wide = buildCoachSystemInstruction({ logs: [...older, ...inWindow], tdee, profile });
    const narrow = buildCoachSystemInstruction({ logs: inWindow, tdee, profile });
    expect(wide).toBe(narrow);
  });
});
