import { describe, expect, it } from 'vitest';
import type { DaySummary } from './day-summary';
import type { DailyTargets } from './targets';
import {
  WIDGET_SNAPSHOT_VERSION,
  type WidgetSnapshot,
  buildWidgetSnapshot,
  parseWidgetSnapshot,
  widgetSnapshotChanged,
  widgetView,
} from './widget-snapshot';

function summary(over: Partial<DaySummary> = {}): DaySummary {
  return {
    dateKey: '2026-07-23',
    totalCalories: 1200,
    totalProtein: 90,
    totalCarbs: 100,
    totalFat: 40,
    mealCount: 3,
    exercised: false,
    weightLb: null,
    ...over,
  };
}

function targets(over: Partial<DailyTargets> = {}): DailyTargets {
  return {
    calorieTarget: 2000,
    proteinTarget: 160,
    proteinMinTarget: 120,
    currentWeight: 180,
    tdee: {} as DailyTargets['tdee'],
    ...over,
  };
}

function snap(over: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    v: WIDGET_SNAPSHOT_VERSION,
    dateKey: '2026-07-23',
    kcalConsumed: 1200,
    kcalTarget: 2000,
    proteinConsumed: 90,
    proteinTarget: 160,
    updatedMs: 1_700_000_000_000,
    locale: 'en',
    ...over,
  };
}

describe('buildWidgetSnapshot', () => {
  it('carries totals and targets at the given date key', () => {
    const s = buildWidgetSnapshot(summary(), targets(), '2026-07-23', 1_700_000_000_000, 'es-PR');
    expect(s).toEqual({
      v: 1,
      dateKey: '2026-07-23',
      kcalConsumed: 1200,
      kcalTarget: 2000,
      proteinConsumed: 90,
      proteinTarget: 160,
      updatedMs: 1_700_000_000_000,
      locale: 'es-PR',
    });
  });

  it('defaults the locale to English', () => {
    expect(buildWidgetSnapshot(summary(), targets(), '2026-07-23', 1).locale).toBe('en');
  });

  it('trusts the caller dateKey over the summary dateKey', () => {
    // The Today screen is the authority on "today"; a summary rendered just
    // before midnight can lag it.
    const s = buildWidgetSnapshot(summary({ dateKey: '2026-07-22' }), targets(), '2026-07-23', 1);
    expect(s.dateKey).toBe('2026-07-23');
  });

  it('rounds to integers so JS and Swift format identically', () => {
    const s = buildWidgetSnapshot(
      summary({ totalCalories: 1200.6, totalProtein: 90.4 }),
      targets({ calorieTarget: 1999.5, proteinTarget: 160.49 }),
      '2026-07-23',
      1.7,
    );
    expect(s).toMatchObject({
      kcalConsumed: 1201,
      kcalTarget: 2000,
      proteinConsumed: 90,
      proteinTarget: 160,
      updatedMs: 2,
    });
  });

  it('never emits NaN or negatives (Swift Codable would throw)', () => {
    const s = buildWidgetSnapshot(
      summary({ totalCalories: Number.NaN, totalProtein: -5 }),
      targets({ calorieTarget: Number.POSITIVE_INFINITY }),
      '2026-07-23',
      Number.NaN,
    );
    expect(s.kcalConsumed).toBe(0);
    expect(s.proteinConsumed).toBe(0);
    expect(s.kcalTarget).toBe(0);
    expect(s.updatedMs).toBe(0);
  });
});

describe('parseWidgetSnapshot', () => {
  it('round-trips what build wrote', () => {
    const s = buildWidgetSnapshot(summary(), targets(), '2026-07-23', 42);
    expect(parseWidgetSnapshot(JSON.stringify(s))).toEqual(s);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['truncated by a mid-write kill', '{"v":1,"dateK'],
    ['not an object', '"nope"'],
    ['null literal', 'null'],
  ])('returns null for input %s', (_label, raw) => {
    expect(parseWidgetSnapshot(raw)).toBeNull();
  });

  it('rejects a newer wire version rather than mis-decoding it', () => {
    expect(parseWidgetSnapshot(JSON.stringify(snap({ v: 2 })))).toBeNull();
  });

  it('rejects a blob with a missing or non-numeric field', () => {
    const missing = { ...snap() } as Partial<WidgetSnapshot>;
    delete missing.proteinTarget;
    expect(parseWidgetSnapshot(JSON.stringify(missing))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ ...snap(), kcalTarget: '2000' }))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ ...snap(), kcalConsumed: null }))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ ...snap(), dateKey: '' }))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ ...snap(), locale: undefined }))).toBeNull();
  });
});

describe('widgetView', () => {
  it('reports remaining for both metrics on a normal day', () => {
    const v = widgetView(snap(), '2026-07-23');
    expect(v).toMatchObject({
      state: 'ready',
      kcal: { value: 800, over: false },
      protein: { value: 70, over: false },
    });
  });

  it('flips to over once consumed passes target', () => {
    const v = widgetView(snap({ kcalConsumed: 2300, proteinConsumed: 175 }), '2026-07-23');
    expect(v).toMatchObject({
      state: 'ready',
      kcal: { value: 300, over: true },
      protein: { value: 15, over: true },
    });
  });

  it('treats exactly-on-target as not over', () => {
    const v = widgetView(snap({ kcalConsumed: 2000 }), '2026-07-23');
    expect(v).toMatchObject({ state: 'ready', kcal: { value: 0, over: false, progress: 1 } });
  });

  it('clamps progress to 0..1', () => {
    const v = widgetView(snap({ kcalConsumed: 4000, proteinConsumed: 0 }), '2026-07-23');
    if (v.state !== 'ready') throw new Error('expected ready');
    expect(v.kcal.progress).toBe(1);
    expect(v.protein.progress).toBe(0);
  });

  it('blanks after midnight instead of showing yesterday as today', () => {
    expect(widgetView(snap({ dateKey: '2026-07-22' }), '2026-07-23')).toEqual({
      state: 'empty',
      reason: 'stale',
    });
  });

  it('blanks when nothing has been written yet', () => {
    expect(widgetView(null, '2026-07-23')).toEqual({ state: 'empty', reason: 'no-snapshot' });
  });

  it('blanks when onboarding never set a calorie target', () => {
    // "0 left" against a 0 target would read as a fully-eaten day.
    expect(widgetView(snap({ kcalTarget: 0, kcalConsumed: 0 }), '2026-07-23')).toEqual({
      state: 'empty',
      reason: 'no-targets',
    });
  });

  it('renders a zero-protein-target day rather than blanking', () => {
    // Only the calorie target gates the widget; protein can legitimately be 0.
    const v = widgetView(snap({ proteinTarget: 0, proteinConsumed: 0 }), '2026-07-23');
    expect(v).toMatchObject({ state: 'ready', protein: { value: 0, over: false, progress: 0 } });
  });
});

describe('widgetSnapshotChanged', () => {
  it('is true with no previous write', () => {
    expect(widgetSnapshotChanged(null, snap())).toBe(true);
  });

  it('ignores updatedMs, which always differs and is never drawn', () => {
    expect(widgetSnapshotChanged(snap(), snap({ updatedMs: 999 }))).toBe(false);
  });

  it.each([
    ['dateKey', { dateKey: '2026-07-24' }],
    ['kcalConsumed', { kcalConsumed: 1201 }],
    ['kcalTarget', { kcalTarget: 2100 }],
    ['proteinConsumed', { proteinConsumed: 91 }],
    ['proteinTarget', { proteinTarget: 170 }],
    ['locale', { locale: 'es-PR' }],
  ])('is true when %s changes', (_label, over) => {
    expect(widgetSnapshotChanged(snap(), snap(over))).toBe(true);
  });
});
