/**
 * Cardio domain types shared by the Train tab in both apps
 * ([ADR-0025](../../../docs/adr/0025-cardio-is-a-block-on-the-workout-session.md)).
 * Framework-free, like its strength sibling `./workout`.
 *
 * ## A block, not a session
 *
 * Cardio is a `CardioBlock[]` hanging off `WorkoutSession` beside
 * `exercises[]`, so a lifting day with a 20-minute finisher is ONE session and
 * a run on its own is a session with zero exercises. That is what keeps Train
 * to one history, one streak marker and one template concept.
 *
 * The corollary is the rule this file exists to make easy to keep: **nothing
 * here may be reached from the strength math.** `sessionVolume`,
 * `computeExercisePRs` and `suggestProgression` walk `exercises[]` and must
 * keep walking only `exercises[]` — pinned by
 * `./cardio-strength-independence.test.ts`.
 *
 * ## Why the clamps live here and not in firestore.rules
 *
 * Rules cannot iterate a list. `isValidWorkoutSession` validates `cardio` as a
 * capped list and stops, exactly as ADR-0007 already does for nested sets, so
 * per-field validity is the client's job under the same single-user trust
 * model. These clamps ARE that job. `./workout` records a set found stored
 * with `rir: 8` against a 0-5 scale; the same hole is open here until these are
 * on every write path.
 */

/** What the effort was. A closed set, so history can group and chart by it;
 *  `other` plus a free-text {@link CardioBlock.label} carries everything else
 *  rather than growing this union per user request. */
export type CardioModality =
  | 'run'
  | 'walk'
  | 'ride'
  | 'swim'
  | 'row'
  | 'elliptical'
  | 'stair'
  | 'hike'
  | 'sport'
  | 'other';

/** Render order for pickers — commonest first, `other` last. */
export const CARDIO_MODALITIES: readonly CardioModality[] = [
  'run', 'walk', 'ride', 'hike', 'swim', 'row', 'elliptical', 'stair', 'sport', 'other',
];

/**
 * How the block got here — the TRANSPORT, not the device.
 *
 * - `manual` — the user typed it in Ignia.
 * - `health` — imported from the OS health store (ADR-0026).
 * - `oura` — imported from the Oura Cloud API directly (ADR-0026 Amendment 2).
 *
 * The wearable that actually recorded it is {@link CardioBlock.provider},
 * which is a different question: Apple Health is a *store*, not a source, and
 * a block can be `source: 'health'` with `provider: 'oura'` — the same ring,
 * arriving by a different road.
 *
 * **`health` and `oura` are two roads to the same run, and that is the point
 * of keeping them apart.** Both paths can deliver one effort, with DIFFERENT
 * `sourceId`s (a HealthKit UUID against an Oura document id), so `sourceId`
 * dedup cannot see the pair. `looksLikeSameEffort` reads this field to decide
 * whether two ids are two records or two copies — see its note.
 *
 * Adding a member costs no `firestore.rules` deploy: `isValidWorkoutSession`
 * validates `cardio` as a capped list and stops, because rules cannot iterate
 * a list (see this file's header). It DOES cost a line in `./source-axes`: this
 * is one of eight axes spelled `source`, and the pin there proves it shares
 * only the literal `'manual'` with any other. Widen it into another axis's
 * vocabulary and the build fails on purpose.
 */
export type CardioSource = 'manual' | 'health' | 'oura';

/** Which wearable authored an imported block, normalized from HealthKit's
 *  `sourceRevision.source.bundleIdentifier` / Health Connect's
 *  `metadata.dataOrigin.packageName`. Display provenance only — it is what
 *  lets the UI say "via Oura" instead of "via Apple Health". */
export type CardioProvider = 'oura' | 'apple-watch' | 'garmin' | 'whoop' | 'other';

/**
 * One logged effort.
 *
 * `targetDurationSec` / `targetDistanceM` are the template's PRESCRIPTION,
 * snapshotted at start. They are deliberately NOT written into
 * `durationSec` / `distanceM`: {@link isLoggedCardioBlock} treats those as
 * proof the work happened, so pre-filling them would record every prescribed
 * block as performed. They render as the input's placeholder and are committed
 * only when the block is actually completed — the same footgun `WorkoutSet`
 * already documents for `targetReps`.
 */
export interface CardioBlock {
  modality: CardioModality;
  /** Free-text name — "Zone 2", "Intervals", "Commute". Required in spirit
   *  when `modality` is `other`, optional otherwise. Never translated: it is
   *  user data, like an exercise name or a cue (ADR-0007). */
  label?: string;
  /**
   * How long THIS effort took, in seconds.
   *
   * Not to be confused with `WorkoutSession.durationMin`, which is how long the
   * whole gym session took. They are one careless autocomplete apart and they
   * answer different questions.
   */
  durationSec: number;
  /** Distance in METERS. Stored SI and converted at render — unlike load,
   *  which stores pounds to preserve a legacy corpus that has no equivalent
   *  here. Miles/km and pace are derived in `./cardio-view`, never stored. */
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  /** Active energy in kcal, as REPORTED by whatever measured it.
   *
   *  **Display provenance only.** Never added to TDEE, never subtracted from
   *  intake, never folded into a day's budget. ADR-0024 decision 4 extended to
   *  the event stream: past 14 logged days the target comes from energy
   *  balance, which already contains every training calorie, so spending this
   *  again double-counts it. Pinned by `cardio-energy-independence.test.ts`. */
  kcal?: number;
  /** Rate of perceived exertion, 1-10. The cardio analogue of RIR — write
   *  through {@link clampRpe}. */
  rpe?: number;
  notes?: string;
  source: CardioSource;
  /** Set only when `source` is `'health'`. */
  provider?: CardioProvider;
  /** Stable id from the source's own store, so a re-import updates this block
   *  instead of adding a second copy of the same run. */
  sourceId?: string;
  /** When the effort began. Distinct from the session's own date: a run
   *  imported at 9pm may have happened at 6am. */
  startedAt?: Date;
  /** Prescription snapshotted from the template — see the interface note. */
  targetDurationSec?: number;
  targetDistanceM?: number;
  /** The heart-rate band the block is prescribed in, bpm (Program v2: Zone 2
   *  at 120–130). Prescription, like the targets above. */
  targetHrMin?: number;
  targetHrMax?: number;
}

/** What a template tells you to do. The cardio analogue of `PlannedSet`. */
export interface PlannedCardioBlock {
  modality: CardioModality;
  label?: string;
  targetDurationSec?: number;
  targetDistanceM?: number;
  /** See {@link CardioBlock.targetHrMin}. */
  targetHrMin?: number;
  targetHrMax?: number;
  notes?: string;
}

// ─── Zone 2 (Program v2, 2026-10-11) ────────────────────────────

/** The Zone 2 heart-rate band, bpm, when a block names none. */
export const ZONE2_BAND = { min: 120, max: 130 } as const;
/** RPE at or above this is not Zone 2 work. */
export const ZONE2_RPE_MAX = 7;

/** A Zone 2 block: one whose label says so ("Zone 2", "Z2 walk"). */
export function isZone2(block: Pick<CardioBlock, 'label'>): boolean {
  return /\bzone\s*2\b|\bz2\b/i.test(block.label ?? '');
}

/** The band a block is held to: its own prescription, else the Zone 2 default
 *  for a Zone 2 block, else none. */
export function hrBand(block: Pick<CardioBlock, 'label' | 'targetHrMin' | 'targetHrMax'>): { min: number; max: number } | undefined {
  if (block.targetHrMin != null && block.targetHrMax != null) return { min: block.targetHrMin, max: block.targetHrMax };
  return isZone2(block) ? { ...ZONE2_BAND } : undefined;
}

export interface Zone2Check {
  /** Whether the logged average HR is inside the band; undefined when there
   *  is no band or no HR to judge. */
  inBand?: boolean;
  /** RPE {@link ZONE2_RPE_MAX}+ on a Zone 2 block. A blank RPE is never high. */
  rpeTooHigh: boolean;
}

/** The two Zone 2 flags for one logged block. */
export function zone2Check(block: Pick<CardioBlock, 'label' | 'targetHrMin' | 'targetHrMax' | 'avgHr' | 'rpe'>): Zone2Check {
  const band = hrBand(block);
  const inBand = band && block.avgHr != null ? block.avgHr >= band.min && block.avgHr <= band.max : undefined;
  const rpeTooHigh = isZone2(block) && block.rpe != null && block.rpe >= ZONE2_RPE_MAX;
  return { ...(inBand !== undefined ? { inBand } : {}), rpeTooHigh };
}

// ─── Bounds ─────────────────────────────────────────────────────
//
// All generous by design, in the same spirit as `health-mapping`'s
// `STEPS_MAX = 200_000`: the job is to reject corrupt or duplicated data, not
// to referee an ultramarathon.

/** RPE is a 1-10 integer scale. 10 is maximal effort; 0 is not a thing. */
export const RPE_MIN = 1;
export const RPE_MAX = 10;

/** A single effort cannot outlast the day it is filed under. */
export const CARDIO_DURATION_MAX_SEC = 86_400;

/** The 24-hour cycling record is ~1,026 km, so this rejects corruption
 *  without rejecting anybody real. */
export const CARDIO_DISTANCE_MAX_M = 1_100_000;

/** Heart rate. The floor is not zero: an elite resting rate reaches the high
 *  20s, but a *workout* average of single digits is a broken sensor, and a
 *  stored 0 would drag every average it lands in. */
export const HR_MIN = 20;
export const HR_MAX = 250;

/** One effort's active energy. `health-mapping` caps a whole DAY at 20,000 on
 *  the grounds that a Tour stage burns ~8k; one block gets half the day. */
export const CARDIO_KCAL_MAX = 10_000;

/**
 * Coerce user input to a storable RPE, or `undefined` to leave it unset.
 *
 * Modelled on `clampRir` in `./workout`, including the guard that is easy to
 * drop: **emptiness is checked BEFORE coercion**, because `Number('')` and
 * `Number(null)` are both `0`. Non-numeric, out-of-range-low and non-integer
 * input becomes `undefined` rather than a silently rounded value — half a
 * point of perceived exertion is not something the user meant, and guessing
 * which whole number they intended is worse than asking again.
 *
 * Values above the ceiling are rejected too, not pinned to 10. Until
 * 2026-10-10 they clamped, on the theory that "harder than 10" can only mean
 * "as hard as I could go" — but the Effort field is a number pad written per
 * keystroke, so what arrives above 10 is far more likely "34" for "3–4" or a
 * heart rate typed one field over, and every such entry was stored as an
 * all-out effort. The owner's Zone 2 walks/runs of 9/30, 10/7 and 10/9 all
 * read RPE 10 (which keys were typed is not recorded).
 * Same rule as the measured fields now: dropping the value loses one number,
 * clamping it fabricates one.
 */
export function clampRpe(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < RPE_MIN || n > RPE_MAX) return undefined;
  return n;
}

/**
 * Shared shape for the measured fields: reject anything non-finite or outside
 * the band rather than clamping into it.
 *
 * `clampRpe` follows the same rule since 2026-10-10 (it used to pin anything
 * above 10 to 10). A distance, a duration or a heart rate is a *measurement*:
 * a value outside the band is a broken sensor or a unit mix-up, and silently pinning
 * 4,000 bpm to 250 would launder corrupt data into something that looks real
 * and charts smoothly. Dropping the field loses one number; clamping it
 * fabricates one.
 */
function bounded(value: unknown, min: number, max: number, round: (n: number) => number) {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return round(n);
}

/** Seconds, whole. Zero is allowed — a scaffold block not yet performed. */
export function clampCardioDurationSec(value: unknown): number | undefined {
  return bounded(value, 0, CARDIO_DURATION_MAX_SEC, Math.round);
}

/** Meters, to one decimal. Sub-meter precision is noise on a GPS trace. */
export function clampDistanceM(value: unknown): number | undefined {
  return bounded(value, 0, CARDIO_DISTANCE_MAX_M, (n) => Math.round(n * 10) / 10);
}

/** Beats per minute, whole. */
export function clampHr(value: unknown): number | undefined {
  return bounded(value, HR_MIN, HR_MAX, Math.round);
}

/** Active energy in kcal, whole. Storable ≠ spendable — see
 *  {@link CardioBlock.kcal}. */
export function clampCardioKcal(value: unknown): number | undefined {
  return bounded(value, 0, CARDIO_KCAL_MAX, Math.round);
}

/**
 * True when the block records work that actually happened — a positive
 * duration. The analogue of `isLoggedSet`, and the reason a prescription is
 * never written into `durationSec`: a scaffold block sits at `0` and must not
 * count toward a weekly total, a streak, or history.
 */
export function isLoggedCardioBlock(b: Pick<CardioBlock, 'durationSec'>): boolean {
  return Number.isFinite(b.durationSec) && b.durationSec > 0;
}

// ─── The energy seam ────────────────────────────────────────────

/**
 * The calorie value of the marker log a finished workout writes. It is zero,
 * and it stays zero however much energy the ring reported.
 *
 * ## Why this is a named constant and not an inline `0`
 *
 * Finishing a session stamps a `DailyLog` so the day counts toward the streak
 * and shows its History dot (ADR-0007). That log is an input to energy
 * balance, and energy balance is what produces a measured target past 14
 * logged days (ADR-0024). So this literal is the ONLY place a cardio calorie
 * could cross into the estimator — and "we have the number, let's use it" is a
 * natural-looking change that no existing test would have caught.
 *
 * Spending it here double-counts: the weight trend the estimator reads already
 * contains the run. `CardioBlock.kcal` is what your ring said, rendered as
 * provenance; it is not a budget.
 *
 * Pinned by `./cardio-energy-independence.test.ts`, which also demonstrates
 * how far a measured target WOULD move if this were wired up — so the test
 * cannot pass vacuously.
 */
export const WORKOUT_MARKER_KCAL = 0;

/**
 * The zero-calorie marker a finished session writes, whatever cardio it
 * carried. Both the block list and its reported energy are accepted and
 * deliberately ignored — taking them as arguments is what makes the discarding
 * explicit at the call site instead of implicit in a literal.
 */
export function workoutMarkerEntry(
  _cardio?: readonly Pick<CardioBlock, 'kcal'>[],
): { calories: number; exerciseCompleted: true } {
  return { calories: WORKOUT_MARKER_KCAL, exerciseCompleted: true };
}

/**
 * Whether a modality's rate reads naturally as pace (time per distance) or as
 * speed (distance per hour).
 *
 * Cycling is quoted in mph/kph and running in minutes per mile; telling a
 * cyclist they rode "3:12 /mi" is technically correct and reads as nonsense.
 * Modalities that are usually done without a distance at all fall back to pace
 * only when a distance is actually present.
 */
export const CARDIO_RATE_STYLE: Record<CardioModality, 'pace' | 'speed'> = {
  run: 'pace',
  walk: 'pace',
  hike: 'pace',
  swim: 'pace',
  row: 'pace',
  elliptical: 'pace',
  stair: 'pace',
  ride: 'speed',
  sport: 'speed',
  other: 'speed',
};
