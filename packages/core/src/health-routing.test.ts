import { describe, expect, it } from 'vitest';
import type { CardioBlock } from './cardio';
import { zone2Check } from './cardio';
import {
  inSessionWindow,
  mergeImportedBlocks,
  mergeIntoZone2,
  sessionWindow,
  toCardioBlockFromHealth,
  watchWorkoutName,
  zone2MergeIndex,
  type HealthWorkout,
} from './health-workouts';

// 2026-10-20 export review, items 1 and 3 — the pure halves.
const Z = (iso: string) => new Date(iso);
const zone2 = (over: Partial<CardioBlock> = {}): CardioBlock => ({
  modality: 'run', label: 'Zone 2', durationSec: 1200, source: 'manual', targetHrMin: 120, targetHrMax: 130, rpe: 2, ...over,
});
const watch = (startedAt: Date, durationSec: number, over: Partial<CardioBlock> = {}): CardioBlock => ({
  modality: 'walk', durationSec, source: 'health', provider: 'apple-watch', sourceId: 'w', startedAt, ...over,
});
const pull = { date: Z('2026-10-20T12:21:53Z'), durationMin: 54, cardio: [zone2({ avgHr: 118 })] };

describe('session window — start to end + 15 min', () => {
  it('ends 15 min after the logged duration', () => {
    expect(new Date(sessionWindow(pull).endMs).toISOString()).toBe('2026-10-20T13:30:53.000Z');
  });
  it('a workout starting or ending inside it belongs; the 10/15 20:33 walk does not belong to the 07:29 Push Day', () => {
    expect(inSessionWindow(pull, watch(Z('2026-10-20T12:55:49Z'), 1215))).toBe(true);
    expect(inSessionWindow(pull, watch(Z('2026-10-20T12:00:00Z'), 1500))).toBe(true); // ends inside
    const push = { date: Z('2026-10-15T11:29:53Z'), durationMin: 51 };
    expect(inSessionWindow(push, watch(Z('2026-10-16T00:33:53Z'), 2036))).toBe(false);
  });
  it('a cardio-only session with no duration is as long as its cardio', () => {
    const s = { date: Z('2026-10-15T10:00:00Z'), cardio: [zone2()] };
    expect(sessionWindow(s).endMs - sessionWindow(s).startMs).toBe((1200 + 15 * 60) * 1000);
  });
});

describe('Zone 2 merge — ±25 % of the logged duration, inside the window', () => {
  it('finds the hand-logged Zone 2 for the 10/20 and 10/14 Watch walks', () => {
    expect(zone2MergeIndex(pull, watch(Z('2026-10-20T12:55:49Z'), 1215))).toBe(0);
    const pull14 = { date: Z('2026-10-14T11:22:51Z'), durationMin: 58, cardio: [zone2({ avgHr: 137 })] };
    expect(zone2MergeIndex(pull14, watch(Z('2026-10-14T12:03:58Z'), 1048))).toBe(0);
  });
  it('not past ±25 %, not outside the window, not into an imported block', () => {
    expect(zone2MergeIndex(pull, watch(Z('2026-10-20T12:55:49Z'), 1501))).toBe(-1);
    expect(zone2MergeIndex(pull, watch(Z('2026-10-20T12:55:49Z'), 899))).toBe(-1);
    expect(zone2MergeIndex(pull, watch(Z('2026-10-20T18:00:00Z'), 1215))).toBe(-1);
    const imported = { ...pull, cardio: [zone2({ sourceId: 'x', source: 'health' })] };
    expect(zone2MergeIndex(imported, watch(Z('2026-10-20T12:55:49Z'), 1215))).toBe(-1);
  });
  it('the merged block keeps the user’s label, band, RPE, notes and HR; takes the Watch duration and fills what is missing', () => {
    const m = mergeIntoZone2(zone2({ avgHr: 118, notes: 'Good', distanceM: 1834.7 }), watch(Z('2026-10-20T12:55:49Z'), 1215, { avgHr: 131, maxHr: 140, kcal: 115, distanceM: 1842.6 }));
    expect(m).toMatchObject({ label: 'Zone 2', source: 'manual', rpe: 2, notes: 'Good', avgHr: 118, maxHr: 140, kcal: 115, distanceM: 1834.7, durationSec: 1215 });
    expect(m.sourceId).toBeUndefined();
  });
  it('with no HR of its own, it takes the Watch’s, and in-band is read from it', () => {
    const m = mergeIntoZone2(zone2(), watch(Z('2026-10-20T12:55:49Z'), 1215, { avgHr: 140 }));
    expect(m.avgHr).toBe(140);
    expect(zone2Check(m).inBand).toBe(false);
  });
});

describe('an imported workout is named the way the Watch names it', () => {
  const hw = (over: Partial<HealthWorkout> = {}): HealthWorkout => ({
    id: 'w', activityType: 'walking', startMs: 0, endMs: 2_036_000, fromUs: false, ...over,
  });
  it('"Outdoor Walk" / "Indoor Run", only when the recorder said which', () => {
    expect(watchWorkoutName('walking', false)).toBe('Outdoor Walk');
    expect(watchWorkoutName('HKWorkoutActivityTypeRunning', true)).toBe('Indoor Run');
    expect(toCardioBlockFromHealth(hw({ indoor: false })).label).toBe('Outdoor Walk');
    expect(toCardioBlockFromHealth(hw()).label).toBeUndefined();
  });
  it('carries avg and peak HR', () => {
    expect(toCardioBlockFromHealth(hw({ avgHr: 112, maxHr: 131 }))).toMatchObject({ avgHr: 112, maxHr: 131 });
  });
  it('a re-read without HR (older than the HR window) keeps the HR an earlier read stored', () => {
    const stored = watch(Z('2026-10-01T10:00:00Z'), 1800, { sourceId: 'old', avgHr: 120, maxHr: 135, label: 'Outdoor Walk' });
    const reread = watch(Z('2026-10-01T10:00:00Z'), 1800, { sourceId: 'old' });
    const { blocks, changed } = mergeImportedBlocks([stored], [reread]);
    expect(changed).toBe(false);
    expect(blocks[0]).toMatchObject({ avgHr: 120, maxHr: 135, label: 'Outdoor Walk' });
  });
});
