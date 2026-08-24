/**
 * Derivations the Train tab reads for cardio — the weekly roll-up, the
 * per-block summary line, and the distance/pace formatting neither frontend
 * should be reinventing.
 *
 * The sibling of `./train-view`, and deliberately a **separate file rather
 * than an addition to it** (ADR-0025): the strength derivations walk
 * `session.exercises` and must keep walking only that. Nothing here is called
 * by anything there, and `./cardio-strength-independence.test.ts` pins it.
 *
 * ## What is NOT here
 *
 * Anything that needs a translator, exactly as `./train-view` says. These
 * return cells and numbers — `["32:10", "5.02 mi", "8:42 /mi"]` — and each
 * frontend joins and labels them in its own i18n. Unit *suffixes* are not
 * translation: `./load-units` already emits `"225 lb"` from core, and mi/km
 * are the same kind of thing.
 *
 * ## Units
 *
 * Distance is STORED in meters (ADR-0025) and converted here for display,
 * which is the mirror image of load — stored in pounds, converted by
 * `./load-units`. The asymmetry is deliberate and is explained in both files:
 * load preserves a legacy corpus, distance has none to preserve, so it stores
 * the unit that does not lose precision on conversion.
 */
import type { CardioBlock, CardioModality } from './cardio';
import { CARDIO_RATE_STYLE, isLoggedCardioBlock } from './cardio';
import type { UnitSystem } from './unit-system';
import type { WorkoutSession } from './workout';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_KM = 1000;

// ─── Units and formatting ───────────────────────────────────────

export function distanceUnit(unitSystem: UnitSystem | undefined): 'mi' | 'km' {
  return unitSystem === 'metric' ? 'km' : 'mi';
}

/** Stored meters → the number to SHOW, in the user's distance unit. */
export function toDisplayDistance(
  meters: number,
  unitSystem: UnitSystem | undefined,
  decimals: 0 | 1 | 2 = 2,
): number {
  const per = unitSystem === 'metric' ? METERS_PER_KM : METERS_PER_MILE;
  const f = 10 ** decimals;
  return Math.round((meters / per) * f) / f;
}

/** What the user typed, in their distance unit → meters to store. Null for
 *  anything unparseable. Accepts a comma decimal separator, as
 *  `parseLoadToLb` does, because es-PR and pt-BR keyboards produce one. */
export function parseDistanceToM(
  input: string,
  unitSystem: UnitSystem | undefined,
): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * (unitSystem === 'metric' ? METERS_PER_KM : METERS_PER_MILE);
}

/** `"5.02 mi"` / `"8.08 km"`. */
export function formatDistance(
  meters: number,
  unitSystem: UnitSystem | undefined,
  decimals: 0 | 1 | 2 = 2,
): string {
  return `${toDisplayDistance(meters, unitSystem, decimals)} ${distanceUnit(unitSystem)}`;
}

/**
 * `"32:10"` under an hour, `"1:02:30"` over it — the clock format every
 * running app uses, where the leading unit is unpadded and the rest are not.
 * Negative and non-finite input reads as `"0:00"` rather than throwing; this
 * is display code and a crash here would take the whole history list with it.
 */
export function formatDuration(totalSec: number): string {
  const s = Number.isFinite(totalSec) && totalSec > 0 ? Math.round(totalSec) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// ─── Rate: pace or speed, by modality ───────────────────────────

/** Seconds per mile / per km. Null when either input is missing or zero —
 *  a pace needs both numbers, and dividing by a zero distance is how a
 *  history row ends up rendering `Infinity`. */
export function paceSecPerUnit(
  durationSec: number,
  distanceM: number | undefined,
  unitSystem: UnitSystem | undefined,
): number | null {
  const dist = toDisplayDistance(distanceM ?? 0, unitSystem, 2);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || dist <= 0) return null;
  return durationSec / dist;
}

/** Miles or km per hour. Same null contract as {@link paceSecPerUnit}. */
export function speedPerHour(
  durationSec: number,
  distanceM: number | undefined,
  unitSystem: UnitSystem | undefined,
): number | null {
  const dist = toDisplayDistance(distanceM ?? 0, unitSystem, 2);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || dist <= 0) return null;
  return Math.round((dist / (durationSec / 3600)) * 10) / 10;
}

/** `"8:42 /mi"`. */
export function formatPace(secPerUnit: number, unitSystem: UnitSystem | undefined): string {
  return `${formatDuration(secPerUnit)} /${distanceUnit(unitSystem)}`;
}

/** `"18.4 mph"` / `"29.6 km/h"`. */
export function formatSpeed(perHour: number, unitSystem: UnitSystem | undefined): string {
  return unitSystem === 'metric' ? `${perHour} km/h` : `${perHour} mph`;
}

/**
 * The one rate cell a block deserves, picked by modality
 * (`CARDIO_RATE_STYLE`): pace for anything done on foot or in water, speed for
 * a ride. Null when there is no distance to derive either from.
 */
export function formatRate(
  block: Pick<CardioBlock, 'modality' | 'durationSec' | 'distanceM'>,
  unitSystem: UnitSystem | undefined,
): string | null {
  if (CARDIO_RATE_STYLE[block.modality] === 'speed') {
    const v = speedPerHour(block.durationSec, block.distanceM, unitSystem);
    return v == null ? null : formatSpeed(v, unitSystem);
  }
  const v = paceSecPerUnit(block.durationSec, block.distanceM, unitSystem);
  return v == null ? null : formatPace(v, unitSystem);
}

/**
 * One block's summary as cells the caller joins — duration, distance, rate,
 * average heart rate. Cells that have no data are omitted rather than
 * rendered empty, so a treadmill walk with no GPS shows `["24:00"]` and not
 * `["24:00", "0 mi", "", ""]`.
 *
 * `kcal` is deliberately absent. It is display provenance and belongs on the
 * expanded block with its own "what your ring said" framing — putting it in a
 * summary line next to real numbers is how it starts looking like a budget.
 */
export function cardioSummaryCells(
  block: Pick<CardioBlock, 'modality' | 'durationSec' | 'distanceM' | 'avgHr'>,
  unitSystem?: UnitSystem,
): string[] {
  const cells: string[] = [];
  if (block.durationSec > 0) cells.push(formatDuration(block.durationSec));
  if (block.distanceM != null && block.distanceM > 0) {
    cells.push(formatDistance(block.distanceM, unitSystem));
  }
  const rate = formatRate(block, unitSystem);
  if (rate) cells.push(rate);
  if (block.avgHr != null && block.avgHr > 0) cells.push(`${block.avgHr} bpm`);
  return cells;
}

// ─── Roll-ups over sessions ─────────────────────────────────────

/** Every LOGGED block on a session, scaffold prescriptions dropped. */
export function loggedBlocks(session: Pick<WorkoutSession, 'cardio'>): CardioBlock[] {
  return (session.cardio ?? []).filter(isLoggedCardioBlock);
}

/** Total logged cardio seconds on one session. */
export function sessionCardioSec(session: Pick<WorkoutSession, 'cardio'>): number {
  return loggedBlocks(session).reduce((sum, b) => sum + b.durationSec, 0);
}

/** Total logged cardio distance on one session, in meters. */
export function sessionCardioDistanceM(session: Pick<WorkoutSession, 'cardio'>): number {
  return loggedBlocks(session).reduce((sum, b) => sum + (b.distanceM ?? 0), 0);
}

export interface CardioWeekStats {
  /** Sessions in the trailing 7 days carrying at least one logged block. */
  sessions: number;
  /** Logged blocks in that window. */
  blocks: number;
  minutes: number;
  distanceM: number;
}

/**
 * The weekly cardio roll-up. `now` is passed in rather than read, for the same
 * two reasons `trainHeroStats` does it: the window is testable, and a screen
 * that already knows its render time cannot disagree with itself mid-frame.
 *
 * Pass only the sessions that should count — both frontends pass completed
 * ones.
 */
export function cardioWeekStats(
  sessions: readonly Pick<WorkoutSession, 'cardio' | 'date'>[],
  now: number,
): CardioWeekStats {
  const weekAgo = now - WEEK_MS;
  let sessionCount = 0;
  let blocks = 0;
  let seconds = 0;
  let distanceM = 0;
  for (const s of sessions) {
    if (s.date.getTime() < weekAgo) continue;
    const logged = loggedBlocks(s);
    if (!logged.length) continue;
    sessionCount += 1;
    blocks += logged.length;
    for (const b of logged) {
      seconds += b.durationSec;
      distanceM += b.distanceM ?? 0;
    }
  }
  return { sessions: sessionCount, blocks, minutes: Math.round(seconds / 60), distanceM };
}

/** The longest single logged effort across every session given, in seconds.
 *  Zero when there is no cardio at all — the caller decides whether that is
 *  worth rendering. */
export function longestEffortSec(
  sessions: readonly Pick<WorkoutSession, 'cardio'>[],
): number {
  let best = 0;
  for (const s of sessions) {
    for (const b of loggedBlocks(s)) if (b.durationSec > best) best = b.durationSec;
  }
  return best;
}

/**
 * Logged-block counts per modality, newest-first order irrelevant. Modalities
 * with no blocks are ABSENT rather than zero, so a caller can render "what you
 * actually do" without filtering a table of nine zeroes first.
 */
export function modalityCounts(
  sessions: readonly Pick<WorkoutSession, 'cardio'>[],
): Partial<Record<CardioModality, number>> {
  const out: Partial<Record<CardioModality, number>> = {};
  for (const s of sessions) {
    for (const b of loggedBlocks(s)) out[b.modality] = (out[b.modality] ?? 0) + 1;
  }
  return out;
}
