/**
 * Health workouts — the pure mapping layer for the OS health store's EVENT
 * stream ([ADR-0026](../../../docs/adr/0026-oura-through-the-os-health-store.md)).
 *
 * The sibling of `./health-mapping`, which owns the DAILY SCALARS (weight,
 * sleep, water, steps, active energy) and says in its own header that
 * "per-event exports (nutrition, workouts) don't fit the daily-scalar shape".
 * This is that other shape, given a home.
 *
 * A workout is an event with a start, an end and a modality. Folding it
 * through `reduceImportedSamples`' one-value-per-day model would destroy
 * exactly the information that makes it a cardio session, so nothing here
 * touches `HealthKind`, `DAILY_FOLD` or `valuesToApply`.
 *
 * No native imports and no Firebase: the per-frontend adapter
 * (`apps/mobile/src/lib/health.ts`) reads HealthKit / Health Connect and hands
 * over {@link HealthWorkout}; everything from there is unit-testable with zero
 * devices, which matters because there is exactly one Oura ring available to
 * this project.
 */
import type { CardioBlock, CardioModality, CardioProvider } from './cardio';
import { clampCardioKcal, clampDistanceM, clampHr } from './cardio';

/**
 * One workout as the adapter reads it, normalized to neutral units but NOT
 * yet to our domain.
 *
 * `activityType` is whatever the platform called it, stringified — HealthKit's
 * `'running'`, Health Connect's `'RUNNING'` or `'EXERCISE_TYPE_RUNNING'`. It is
 * deliberately a string rather than a union: the platforms have ~80 values
 * each, they gain more every release, and an unknown one must degrade to
 * `other` rather than fail to typecheck.
 */
export interface HealthWorkout {
  /** Stable id from the platform's own store — the dedup key. */
  id: string;
  activityType: string;
  startMs: number;
  endMs: number;
  distanceM?: number;
  kcal?: number;
  avgHr?: number;
  /** HealthKit `sourceRevision.source.bundleIdentifier` / Health Connect
   *  `metadata.dataOrigin.packageName`. */
  sourceBundleId?: string;
  /** HealthKit `sourceRevision.source.name`. Health Connect exposes no
   *  equivalent, so this is iOS-only and only ever a fallback. */
  sourceName?: string;
  /** True when the writing app was us — see `health-mapping`'s `fromUs`. Our
   *  own `writeWorkout` exports must never be re-imported as cardio. */
  fromUs: boolean;
}

// ─── Provider provenance ────────────────────────────────────────

/**
 * Vendor patterns, matched against the lowercased bundle id AND the
 * human-readable source name.
 *
 * **Word-boundary regexes rather than substrings**, and that is not
 * fastidiousness. Both halves of the haystack have to work: a bundle id is
 * dot-separated (`com.ouraring.oura`, and Garmin ships
 * `com.garmin.connect.mobile` on iOS against
 * `com.garmin.android.apps.connectmobile` on Android), while HealthKit's
 * `source.name` is a bare display string — plain `'Oura'`. A substring table
 * tuned to bundle ids silently fails the name case, which is the one that
 * carries when a record arrives without a bundle id at all.
 *
 * A dot is a non-word character, so `\b` lands exactly on the segment
 * boundaries a bundle id already has.
 *
 * **Order is load-bearing.** Apple sits last because its identifiers are the
 * broadest — the Watch writes through `com.apple.health`, `com.apple.workout`
 * and others — so an earlier position would swallow a third-party app whose
 * own id merely mentions Apple.
 */
const PROVIDER_PATTERNS: readonly (readonly [CardioProvider, RegExp])[] = [
  ['oura', /\boura(ring)?\b/],
  ['whoop', /\bwhoop\b/],
  ['garmin', /\bgarmin\b/],
  ['apple-watch', /\bapple\b/],
];

/**
 * Which wearable authored a record. Display provenance only — it is what lets
 * the UI say "via Oura" rather than "via Apple Health", which is the whole
 * difference between reading as an integration and reading as a settings
 * toggle.
 *
 * Falls back to `other` rather than guessing. An unrecognized provider is a
 * fact about our table, not about the data, and labelling a Polar chest strap
 * "Apple Watch" is worse than labelling it nothing.
 */
export function normalizeProvider(
  bundleId: string | undefined,
  sourceName?: string,
): CardioProvider {
  const haystack = `${bundleId ?? ''} ${sourceName ?? ''}`.toLowerCase();
  if (!haystack.trim()) return 'other';
  for (const [provider, pattern] of PROVIDER_PATTERNS) {
    if (pattern.test(haystack)) return provider;
  }
  return 'other';
}

// ─── Modality ───────────────────────────────────────────────────

/**
 * Collapse a platform activity-type name to a comparison key: lowercase,
 * alphanumerics only. `'EXERCISE_TYPE_RUNNING'`, `'running'` and
 * `'HKWorkoutActivityTypeRunning'` all become `'exercisetyperunning'`,
 * `'running'` and `'hkworkoutactivitytyperunning'` — which is why matching
 * below is by *substring* rather than equality.
 */
function typeKey(activityType: string): string {
  return activityType.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Substring → modality, most specific first.
 *
 * Order is load-bearing and not alphabetical. `'stairclimbing'` must be tested
 * before `'climbing'`-like fragments, and `'walking'` before `'running'` would
 * be wrong for `'runningwalking'`-style compound names, so the specific
 * compounds sit above the bare words they contain.
 */
const MODALITY_PATTERNS: readonly (readonly [string, CardioModality])[] = [
  ['stairclimbing', 'stair'],
  ['stairs', 'stair'],
  ['stepper', 'stair'],
  ['elliptical', 'elliptical'],
  ['hiking', 'hike'],
  ['hike', 'hike'],
  ['walking', 'walk'],
  ['walk', 'walk'],
  ['running', 'run'],
  ['run', 'run'],
  ['cycling', 'ride'],
  ['biking', 'ride'],
  ['bike', 'ride'],
  ['swimming', 'swim'],
  ['swim', 'swim'],
  ['rowing', 'row'],
  ['row', 'row'],
];

/**
 * Platform activity type → our modality, falling back to `other`.
 *
 * The fallback is not a failure: `other` plus the raw name kept as the block's
 * label preserves everything the platform told us, and it is what keeps this
 * table from needing an entry per release. Strength training, yoga and the
 * rest legitimately land there — they are not cardio, and the import path
 * filters them separately rather than mislabelling them as a run.
 */
export function toCardioModality(activityType: string): CardioModality {
  const key = typeKey(activityType);
  for (const [fragment, modality] of MODALITY_PATTERNS) {
    if (key.includes(fragment)) return modality;
  }
  return 'other';
}

/**
 * A human-ish label for a block whose modality degraded to `other`, so the row
 * says "Functional Strength Training" rather than nothing.
 *
 * `'EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING'` → `'High Intensity
 * Interval Training'`. Deliberately NOT translated: it is data from the
 * platform, and ADR-0007 already settled that user-and-source-authored strings
 * are never run through i18n.
 */
export function humanizeActivityType(activityType: string): string {
  return activityType
    .replace(/^(EXERCISE_TYPE_|HKWorkoutActivityType)/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// ─── Mapping ────────────────────────────────────────────────────

/** Duration in whole seconds, floored at zero. A record whose end precedes its
 *  start is corrupt; it becomes 0 and is then dropped by the caller's
 *  `isLoggedCardioBlock` gate rather than storing negative time. */
export function workoutDurationSec(w: Pick<HealthWorkout, 'startMs' | 'endMs'>): number {
  return Math.max(0, Math.round((w.endMs - w.startMs) / 1000));
}

/**
 * One imported workout → one cardio block.
 *
 * Every measured field goes through the same clamps a hand-typed block does.
 * That is not belt-and-braces: a health store is a shared bucket that any app
 * on the phone can write to, so its contents are no more trustworthy than a
 * text input, and `firestore.rules` cannot iterate a list to check them.
 */
export function toCardioBlockFromHealth(w: HealthWorkout): CardioBlock {
  const modality = toCardioModality(w.activityType);
  return {
    modality,
    // Only label the ones the table could not place. A block that mapped
    // cleanly to `run` renders its modality name from i18n, and a redundant
    // English "Running" beside it would defeat the translation.
    ...(modality === 'other' ? { label: humanizeActivityType(w.activityType) } : {}),
    durationSec: workoutDurationSec(w),
    distanceM: clampDistanceM(w.distanceM),
    avgHr: clampHr(w.avgHr),
    kcal: clampCardioKcal(w.kcal),
    source: 'health',
    provider: normalizeProvider(w.sourceBundleId, w.sourceName),
    sourceId: w.id,
    startedAt: new Date(w.startMs),
  };
}

/**
 * The workouts worth importing, in start order.
 *
 * Drops two classes: our own exports (`fromUs`, so a re-sync never re-imports
 * what we wrote — the same idempotency `health-mapping` buys on the scalar
 * side), and zero-length records, which both platforms emit for a workout that
 * was started and immediately cancelled.
 */
export function importableWorkouts(workouts: readonly HealthWorkout[]): HealthWorkout[] {
  return workouts
    .filter((w) => !w.fromUs && workoutDurationSec(w) > 0)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
}

// ─── Dedup: suggest, never merge ────────────────────────────────

/**
 * How much two blocks must overlap in time before they are treated as
 * candidates for the same effort.
 *
 * Expressed as a fraction of the SHORTER block, so a 30-minute run recorded by
 * hand and a 32-minute auto-detected one still match — the ring starts before
 * you do and stops after. A fraction of the longer one would miss exactly that
 * case, which is the common one.
 */
export const OVERLAP_MERGE_THRESHOLD = 0.5;

interface Span {
  startMs: number;
  endMs: number;
}

/** Overlapping fraction of the shorter span, 0..1. Zero-length spans never
 *  match, which keeps a prescription scaffold out of the dedup. */
export function overlapRatio(a: Span, b: Span): number {
  const aLen = a.endMs - a.startMs;
  const bLen = b.endMs - b.startMs;
  if (aLen <= 0 || bLen <= 0) return 0;
  const overlap = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
  if (overlap <= 0) return 0;
  return overlap / Math.min(aLen, bLen);
}

/** The time span a block occupies, or null when it has no start to anchor to
 *  (a hand-logged block need not carry one). */
export function blockSpan(b: Pick<CardioBlock, 'startedAt' | 'durationSec'>): Span | null {
  if (!b.startedAt || !(b.durationSec > 0)) return null;
  const startMs = b.startedAt.getTime();
  return { startMs, endMs: startMs + b.durationSec * 1000 };
}

/**
 * Do these two blocks look like the same effort recorded twice?
 *
 * **This is a SUGGESTION, never an instruction.** ADR-0026 decision 4 follows
 * the precedent `findDuplicateExercise` set in `./workout`: a false positive
 * destroys a real training record, so the UI offers a one-tap merge and the
 * user decides. A visible duplicate is an annoyance; a wrong merge is data
 * loss.
 *
 * Two blocks that came from the same `sourceId` are not "duplicates" — they are
 * the same record, and the importer updates in place rather than asking.
 */
export function looksLikeSameEffort(
  a: Pick<CardioBlock, 'startedAt' | 'durationSec' | 'sourceId'>,
  b: Pick<CardioBlock, 'startedAt' | 'durationSec' | 'sourceId'>,
): boolean {
  if (a.sourceId && b.sourceId) return false;
  const spanA = blockSpan(a);
  const spanB = blockSpan(b);
  if (!spanA || !spanB) return false;
  return overlapRatio(spanA, spanB) > OVERLAP_MERGE_THRESHOLD;
}

/**
 * Fold imported blocks into the ones already stored on a session.
 *
 * Matching is by `sourceId` ONLY, which is what makes a re-import idempotent:
 * the same run read twice updates its block instead of adding a second copy.
 * Blocks that merely *overlap* an existing manual entry are still added — they
 * are a different record of the same effort, and collapsing them here would be
 * the silent merge ADR-0026 refuses. Surfacing them is
 * {@link looksLikeSameEffort}'s job, on screen, where a person can answer.
 *
 * Returns the merged list plus whether anything actually changed, so a caller
 * can skip a Firestore write that would be a no-op.
 */
export function mergeImportedBlocks(
  existing: readonly CardioBlock[],
  incoming: readonly CardioBlock[],
): { blocks: CardioBlock[]; changed: boolean } {
  const blocks = existing.slice();
  let changed = false;
  for (const block of incoming) {
    const at = block.sourceId
      ? blocks.findIndex((b) => b.sourceId != null && b.sourceId === block.sourceId)
      : -1;
    if (at >= 0) {
      // Preserve anything the user added to an imported block by hand — notes
      // and RPE are theirs, and a re-sync must not wipe them just because the
      // ring has nothing to say about either.
      const merged: CardioBlock = {
        ...block,
        ...(blocks[at].notes !== undefined ? { notes: blocks[at].notes } : {}),
        ...(blocks[at].rpe !== undefined ? { rpe: blocks[at].rpe } : {}),
      };
      if (JSON.stringify(merged) !== JSON.stringify(blocks[at])) {
        blocks[at] = merged;
        changed = true;
      }
    } else {
      blocks.push(block);
      changed = true;
    }
  }
  return { blocks, changed };
}
