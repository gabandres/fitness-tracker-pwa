import { describe, expect, it } from 'vitest';
import type { CardioBlock } from './cardio';
import {
  type HealthWorkout,
  OVERLAP_MERGE_THRESHOLD,
  humanizeActivityType,
  importableWorkouts,
  looksLikeSameEffort,
  mergeImportedBlocks,
  normalizeProvider,
  overlapRatio,
  toCardioBlockFromHealth,
  toCardioModality,
  workoutDurationSec,
} from './health-workouts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 7, 24, 12, 0, 0);

const hw = (w: Partial<HealthWorkout> = {}): HealthWorkout => ({
  id: 'w1',
  activityType: 'running',
  startMs: T0,
  endMs: T0 + 1800_000,
  fromUs: false,
  ...w,
});

describe('normalizeProvider', () => {
  // The one that matters: there is exactly one Oura ring available to this
  // project, so if this string is wrong the chip reads "other" in front of the
  // only person who owns one.
  it('recognizes Oura on both platforms', () => {
    expect(normalizeProvider('com.ouraring.oura')).toBe('oura');
    expect(normalizeProvider('com.ouraring.oura.watchkitapp')).toBe('oura');
  });

  it('recognizes the other wearables, including Garmin spelled two ways', () => {
    expect(normalizeProvider('com.garmin.connect.mobile')).toBe('garmin');
    expect(normalizeProvider('com.garmin.android.apps.connectmobile')).toBe('garmin');
    expect(normalizeProvider('com.whoop.iphone')).toBe('whoop');
    expect(normalizeProvider('com.apple.health')).toBe('apple-watch');
  });

  // Apple's identifiers are the broadest, so they are matched LAST. A vendor
  // whose bundle merely mentions apple must not be labelled Apple Watch.
  it('does not let the broad Apple pattern swallow a named vendor', () => {
    expect(normalizeProvider('com.ouraring.oura', 'Oura on Apple Watch')).toBe('oura');
    expect(normalizeProvider('com.whoop.apple.companion')).toBe('whoop');
  });

  it('falls back to other rather than guessing', () => {
    expect(normalizeProvider('com.polar.flow')).toBe('other');
    expect(normalizeProvider(undefined)).toBe('other');
    expect(normalizeProvider('', '')).toBe('other');
  });

  it('uses the source name when there is no bundle id', () => {
    expect(normalizeProvider(undefined, 'Oura')).toBe('oura');
  });
});

describe('toCardioModality', () => {
  it('maps HealthKit names', () => {
    expect(toCardioModality('running')).toBe('run');
    expect(toCardioModality('walking')).toBe('walk');
    expect(toCardioModality('cycling')).toBe('ride');
    expect(toCardioModality('swimming')).toBe('swim');
    expect(toCardioModality('rowing')).toBe('row');
    expect(toCardioModality('elliptical')).toBe('elliptical');
    expect(toCardioModality('hiking')).toBe('hike');
    expect(toCardioModality('stairClimbing')).toBe('stair');
  });

  it('maps Health Connect names, which are shouted and prefixed', () => {
    expect(toCardioModality('EXERCISE_TYPE_RUNNING')).toBe('run');
    expect(toCardioModality('EXERCISE_TYPE_BIKING')).toBe('ride');
    expect(toCardioModality('EXERCISE_TYPE_SWIMMING_POOL')).toBe('swim');
    expect(toCardioModality('EXERCISE_TYPE_ROWING_MACHINE')).toBe('row');
    expect(toCardioModality('EXERCISE_TYPE_STAIR_CLIMBING')).toBe('stair');
  });

  // Order in the pattern table is load-bearing: 'stairclimbing' has to be
  // tested before anything that would match a fragment of it.
  it('prefers the specific compound over the bare word it contains', () => {
    expect(toCardioModality('EXERCISE_TYPE_STAIR_CLIMBING_MACHINE')).toBe('stair');
    expect(toCardioModality('runningTreadmill')).toBe('run');
  });

  // Not a failure: strength work and yoga legitimately are not cardio, and the
  // import path filters them rather than mislabelling them as a run.
  it('degrades to other for anything unrecognized', () => {
    expect(toCardioModality('traditionalStrengthTraining')).toBe('other');
    expect(toCardioModality('EXERCISE_TYPE_YOGA')).toBe('other');
    expect(toCardioModality('')).toBe('other');
  });
});

describe('humanizeActivityType', () => {
  it('turns a platform constant into something a person can read', () => {
    expect(humanizeActivityType('EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING'))
      .toBe('High Intensity Interval Training');
    expect(humanizeActivityType('traditionalStrengthTraining'))
      .toBe('Traditional Strength Training');
  });
});

describe('toCardioBlockFromHealth', () => {
  it('maps a whole record and stamps provenance', () => {
    const block = toCardioBlockFromHealth(
      hw({
        id: 'oura-123',
        activityType: 'running',
        endMs: T0 + 1930_000,
        distanceM: 8046.72,
        kcal: 612,
        avgHr: 148,
        sourceBundleId: 'com.ouraring.oura',
      }),
    );
    expect(block).toMatchObject({
      modality: 'run',
      durationSec: 1930,
      distanceM: 8046.7,
      kcal: 612,
      avgHr: 148,
      source: 'health',
      provider: 'oura',
      sourceId: 'oura-123',
    });
    expect(block.startedAt?.getTime()).toBe(T0);
    // A cleanly mapped modality renders from i18n; an English label beside it
    // would defeat the translation.
    expect(block.label).toBeUndefined();
  });

  it('labels only what it could not place', () => {
    const block = toCardioBlockFromHealth(hw({ activityType: 'EXERCISE_TYPE_PILATES' }));
    expect(block.modality).toBe('other');
    expect(block.label).toBe('Pilates');
  });

  // A health store is a shared bucket any app on the phone can write to, so
  // its contents deserve the same clamps a text input gets — and rules cannot
  // iterate a list to catch them.
  it('runs imported measurements through the same clamps as hand entry', () => {
    const block = toCardioBlockFromHealth(hw({ avgHr: 4000, kcal: 999_999, distanceM: -5 }));
    expect(block.avgHr).toBeUndefined();
    expect(block.kcal).toBeUndefined();
    expect(block.distanceM).toBeUndefined();
  });
});

describe('importableWorkouts', () => {
  it('drops our own exports so a re-sync is idempotent', () => {
    const out = importableWorkouts([hw({ id: 'ours', fromUs: true }), hw({ id: 'theirs' })]);
    expect(out.map((w) => w.id)).toEqual(['theirs']);
  });

  it('drops zero-length records, which both platforms emit on a cancel', () => {
    expect(importableWorkouts([hw({ endMs: T0 })])).toEqual([]);
  });

  it('sorts by start time', () => {
    const out = importableWorkouts([
      hw({ id: 'b', startMs: T0 + HOUR, endMs: T0 + HOUR + 600_000 }),
      hw({ id: 'a' }),
    ]);
    expect(out.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('never returns negative durations', () => {
    expect(workoutDurationSec({ startMs: T0, endMs: T0 - 5000 })).toBe(0);
  });
});

describe('overlap detection', () => {
  const span = (startMs: number, mins: number) => ({ startMs, endMs: startMs + mins * 60_000 });

  it('measures overlap against the SHORTER span', () => {
    // 30 min inside a 60 min window → fully overlapped relative to the shorter.
    expect(overlapRatio(span(T0, 60), span(T0, 30))).toBe(1);
    expect(overlapRatio(span(T0, 30), span(T0 + 15 * 60_000, 30))).toBeCloseTo(0.5, 6);
  });

  it('is zero for disjoint or degenerate spans', () => {
    expect(overlapRatio(span(T0, 30), span(T0 + HOUR, 30))).toBe(0);
    expect(overlapRatio(span(T0, 0), span(T0, 30))).toBe(0);
  });

  const manual = (startMs: number, durationSec: number): CardioBlock => ({
    modality: 'run', durationSec, source: 'manual', startedAt: new Date(startMs),
  });
  const imported = (startMs: number, durationSec: number, id: string): CardioBlock => ({
    modality: 'run', durationSec, source: 'health', sourceId: id, startedAt: new Date(startMs),
  });

  // The case the threshold exists for: the ring starts before you do and stops
  // after, so a hand-logged 30 and an auto-detected 32 must still match.
  it('matches a hand-logged run against the ring version of the same run', () => {
    expect(looksLikeSameEffort(manual(T0, 1800), imported(T0 - 60_000, 1920, 'oura-1'))).toBe(true);
  });

  it('does not match two genuinely different sessions', () => {
    expect(looksLikeSameEffort(manual(T0, 1800), imported(T0 + HOUR * 3, 1800, 'oura-2'))).toBe(false);
  });

  // Two records that both came from THE SAME store are that store's business,
  // not a duplicate to ask the user about.
  it('never asks about two blocks from one transport that both carry a sourceId', () => {
    expect(looksLikeSameEffort(imported(T0, 1800, 'a'), imported(T0, 1800, 'b'))).toBe(false);
  });

  // ── The two-transports case (issue #72) ──
  //
  // One run reaches us twice: HealthKit hands over its own UUID, the Oura
  // Cloud API hands over an Oura document id. Both blocks carry a `sourceId`,
  // neither matches the other, so `mergeImportedBlocks` adds both — and the
  // old short-circuit ("both have ids ⇒ different efforts") suppressed the
  // very prompt that would have let the user say they are one run.
  const fromCloud = (startMs: number, durationSec: number, id: string): CardioBlock => ({
    modality: 'run', durationSec, source: 'oura', sourceId: id, startedAt: new Date(startMs),
  });

  it('DOES ask about one run that arrived through both transports', () => {
    expect(
      looksLikeSameEffort(imported(T0, 1800, 'hk-uuid'), fromCloud(T0 - 60_000, 1920, 'oura-doc')),
    ).toBe(true);
  });

  it('still does not ask when two transports carry genuinely different sessions', () => {
    // Crossing transports relaxes the id short-circuit; it does not relax the
    // overlap test, which is what actually decides.
    expect(
      looksLikeSameEffort(imported(T0, 1800, 'hk-uuid'), fromCloud(T0 + HOUR * 3, 1800, 'oura-doc')),
    ).toBe(false);
  });

  it('treats an absent source as the health store', () => {
    // Reachable in practice, not just in theory: read-path blocks arrive by
    // spreading a Firestore document, which validates nothing. A block stored
    // without a `source` must keep the pre-#72 behaviour rather than suddenly
    // being offered for merge against every imported block on the same day.
    const a = { startedAt: new Date(T0), durationSec: 1800, sourceId: 'a' };
    const b = { startedAt: new Date(T0), durationSec: 1800, sourceId: 'b' };
    expect(looksLikeSameEffort(a, b)).toBe(false);

    // And an absent source is 'health', so it does NOT match a cloud block.
    const cloud = { startedAt: new Date(T0), durationSec: 1800, sourceId: 'c', source: 'oura' as const };
    expect(looksLikeSameEffort(a, cloud)).toBe(true);
  });

  it('cannot match a block with no start time to anchor to', () => {
    const noStart: CardioBlock = { modality: 'run', durationSec: 1800, source: 'manual' };
    expect(looksLikeSameEffort(noStart, imported(T0, 1800, 'x'))).toBe(false);
  });

  it('needs more than half, not merely any, overlap', () => {
    expect(OVERLAP_MERGE_THRESHOLD).toBe(0.5);
    // Exactly half is not enough — the comparison is strict.
    expect(looksLikeSameEffort(manual(T0, 1800), imported(T0 + 900_000, 1800, 'x'))).toBe(false);
  });
});

describe('mergeImportedBlocks', () => {
  const block = (id: string, extra: Partial<CardioBlock> = {}): CardioBlock => ({
    modality: 'run', durationSec: 1800, source: 'health', sourceId: id,
    startedAt: new Date(T0), ...extra,
  });

  it('adds a block it has not seen before', () => {
    const { blocks, changed } = mergeImportedBlocks([], [block('a')]);
    expect(blocks).toHaveLength(1);
    expect(changed).toBe(true);
  });

  // The idempotency property: importing the same run twice must not produce
  // two rows.
  it('updates in place on a re-import instead of duplicating', () => {
    const first = mergeImportedBlocks([], [block('a')]);
    const second = mergeImportedBlocks(first.blocks, [block('a')]);
    expect(second.blocks).toHaveLength(1);
    expect(second.changed).toBe(false);
  });

  it('reports a change when the store revised the numbers', () => {
    const first = mergeImportedBlocks([], [block('a', { distanceM: 5000 })]);
    const second = mergeImportedBlocks(first.blocks, [block('a', { distanceM: 5200 })]);
    expect(second.changed).toBe(true);
    expect(second.blocks[0].distanceM).toBe(5200);
  });

  // A ring has nothing to say about how hard it felt or what you thought about
  // it, so a re-sync must not wipe either.
  it('preserves notes and RPE the user added to an imported block', () => {
    const stored = block('a', { notes: 'legs felt heavy', rpe: 8 });
    const { blocks } = mergeImportedBlocks([stored], [block('a', { distanceM: 5200 })]);
    expect(blocks[0].notes).toBe('legs felt heavy');
    expect(blocks[0].rpe).toBe(8);
    expect(blocks[0].distanceM).toBe(5200);
  });

  // Overlap is a question for the user (ADR-0026 decision 4), so the importer
  // adds and lets the UI ask. Silently collapsing here would be the merge the
  // ADR refuses.
  it('adds an overlapping manual block rather than silently collapsing it', () => {
    const manual: CardioBlock = {
      modality: 'run', durationSec: 1800, source: 'manual', startedAt: new Date(T0),
    };
    const { blocks } = mergeImportedBlocks([manual], [block('a')]);
    expect(blocks).toHaveLength(2);
  });
});
