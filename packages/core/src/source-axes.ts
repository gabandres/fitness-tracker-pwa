/**
 * The `source` axes — one registry, and a compile-time proof they stay apart.
 *
 * ## The footgun this replaces
 *
 * Eight unrelated domain questions are all answered by a field spelled
 * `source`, and until now the guard was a doc comment on three of them saying
 * "careful, there are three of these". The comment was wrong twice over: there
 * are eight, not three, and the compiler had already closed the hole the
 * comment was worried about — every one of these axes is a NAMED alias over a
 * DISJOINT set of literals, so handing a `FoodSource` to something expecting a
 * `CardioSource` is TS2322 today, not a silent bug.
 *
 * What a comment cannot do is keep that true. The separation is a property of
 * the literal sets, and it survives only for as long as nobody widens one axis
 * into another's vocabulary — `CardioSource` gaining `'text'`, or `FoodSource`
 * gaining `'health'`, would quietly re-open exactly the hole the comment warns
 * about, and no existing test would notice. {@link SharedLiterals} below turns
 * that into a build failure.
 *
 * ## What each axis answers
 *
 * | axis | type | question | stored at |
 * |---|---|---|---|
 * | `log` | {@link LogSource} | how was this LOG created? | `dailyLogs/{id}.source` |
 * | `food` | {@link FoodSource} | how was this FOOD captured? | `customFoods/{id}.source` |
 * | `foodDb` | {@link FoodDbSource} | which DATABASE answered? | wire only, never stored |
 * | `cardio` | {@link CardioSource} | how did this EFFORT get here? | inside `workouts/{id}.cardio[]` |
 * | `fast` | {@link FastSource} | was the fast timed or typed? | `fasts/{id}.source` |
 * | `sleep` | {@link SleepSource} | was the night typed or imported? | `dailySleep/{dateKey}.source` |
 * | `scannedItem` | {@link ScannedItemSource} | what grounded this scanned item's macros? | never stored |
 * | `tdee` | `TdeeResult['source']` | which estimator produced this number? | never stored (derived) |
 *
 * ## This module emits NOTHING
 *
 * It is types only, on purpose. The axes are *stored* fields on live user
 * documents that `firestore.rules` validates by literal, so the values must
 * stay byte-identical — a branded type or a runtime constructor would have
 * bought a marginally tighter guard at the price of a cast at all ~123 literal
 * assignment sites, most of them test fixtures. The named aliases already do
 * the work; this file proves they keep doing it.
 */
import type { CardioSource } from './cardio';
import type { FastSource } from './fasting-history';
import type { FoodDbSource } from './food-search';
import type { ScannedItemSource } from './photo-scan';
import type { SleepSource } from './sleep-intake';
import type { TdeeResult } from './tdee';
import type { FoodSource, LogSource } from './types';

/**
 * Every domain axis in `packages/core` whose field is spelled `source`.
 *
 * Add a new one HERE as well as at its declaration — the pins at the bottom of
 * this file are computed across this map, so an axis that is not registered is
 * an axis nothing is checking.
 *
 * Two mobile-only unions are deliberately absent because core cannot see them
 * and neither is a domain axis: `ScanSource` (`camera | library`, which picker
 * the user tapped) and `ErrSource` (`password | federated`, which sign-in arm
 * failed). Both are UI plumbing that never reaches a document.
 */
export interface SourceAxes {
  log: LogSource;
  food: FoodSource;
  foodDb: FoodDbSource;
  cardio: CardioSource;
  fast: FastSource;
  sleep: SleepSource;
  scannedItem: ScannedItemSource;
  tdee: TdeeResult['source'];
}

/** The name of one registered axis. */
export type SourceAxis = keyof SourceAxes;

/**
 * The literals axis `K` shares with ANY other registered axis.
 *
 * `never` is the strong result: it means a value of `K` can never be assigned
 * to another axis, nor another axis's value to `K`, so the compiler alone keeps
 * them apart and no discipline is required of the author.
 */
export type SharedLiterals<K extends SourceAxis> =
  Extract<SourceAxes[K], SourceAxes[Exclude<SourceAxis, K>]>;

// ─── The pin ────────────────────────────────────────────────────
// A `_pin*` line stops compiling the moment its axis starts sharing a literal
// it did not share before. Widening an axis is still allowed — but it has to
// be done here, in the open, rather than discovered later from a bad document.

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** `'photo'` is unique to logs — nothing else in the codebase uses it. */
export type _pinLog = Expect<Equals<SharedLiterals<'log'>, never>>;
/** `'fdc' | 'off' | 'menu'` are database names; no other axis names a database. */
export type _pinFoodDb = Expect<Equals<SharedLiterals<'foodDb'>, never>>;
/** `'usda' | 'custom' | 'model'` — grounding, not transport. */
export type _pinScannedItem = Expect<Equals<SharedLiterals<'scannedItem'>, never>>;
/** `'measured' | 'formula' | 'seed'` — estimator names, disjoint by construction. */
export type _pinTdee = Expect<Equals<SharedLiterals<'tdee'>, never>>;

// The four axes that CAN collide all collide on exactly one word, and it is the
// same word: `'manual'`, meaning "a human typed it" on four different nouns.
// That single literal is the entire residual surface of the footgun: a value
// narrowed to `'manual'` is assignable across these four axes, and nothing
// short of branding every literal site would change that. It is also the least
// harmful crossing possible — every one of the four treats `'manual'` as the
// conservative reading, so a mix-up writes a legal, already-default value.
/** Shares `'manual'` with cardio, fast and sleep — and nothing else. */
export type _pinFood = Expect<Equals<SharedLiterals<'food'>, 'manual'>>;
/** Shares `'manual'` with food, fast and sleep — and nothing else. */
export type _pinCardio = Expect<Equals<SharedLiterals<'cardio'>, 'manual'>>;
/** Shares `'manual'` with food, cardio and sleep — and nothing else. */
export type _pinFast = Expect<Equals<SharedLiterals<'fast'>, 'manual'>>;
/** Shares `'manual'` with food, cardio and fast — and nothing else. */
export type _pinSleep = Expect<Equals<SharedLiterals<'sleep'>, 'manual'>>;
