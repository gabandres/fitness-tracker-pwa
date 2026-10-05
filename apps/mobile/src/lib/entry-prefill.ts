import type { MealType } from '@macrolog/core';

/**
 * A draft entry carried across a navigation — from the scan screen's repeat
 * suggestion to Today's add sheet (ADR-0029, open question settled
 * 2026-09-08: a matched repeat lands on the same editable draft every other
 * path lands on, it does not log silently).
 *
 * Expo Router params are strings, so the draft rides as JSON in a single
 * `prefill` param next to the `openAdd` nonce that opens the sheet. The parser
 * is deliberately strict: a malformed or hand-typed param yields `null` and the
 * sheet opens empty, which is the failure a user can see and recover from.
 *
 * ## Two shapes, one type
 *
 * A **draft** carries numbers (`calories` at least) and opens the sheet on the
 * filled form. A **slot seed** carries only `mealType` — the diary's per-meal
 * "+ Add" (UX_AUDIT Today review U3): the sheet opens on its usual search,
 * with the meal field already set to the slot the user tapped, and treated as
 * a CHOICE (not a clock default), so a retime does not move it. Both may come
 * together. Use {@link isDraftPrefill} to tell them apart; a reader must not
 * assume `calories` is present.
 */
export interface EntryPrefill {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel?: string;
  /** The meal slot the add was started from. */
  mealType?: MealType;
}

/** A prefill that fills the form (it has numbers), as opposed to a bare slot seed. */
export function isDraftPrefill(p: EntryPrefill | null | undefined): p is EntryPrefill & { calories: number } {
  return p?.calories != null;
}

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;

export function encodeEntryPrefill(p: EntryPrefill): string {
  return JSON.stringify(p);
}

export function parseEntryPrefill(raw: unknown): EntryPrefill | null {
  if (typeof raw !== 'string' || !raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const calories = num(o['calories']);
  const mealType = MEAL_TYPES.find((m) => m === o['mealType']);
  if (calories === undefined && mealType === undefined) return null;
  const out: EntryPrefill = {};
  if (calories !== undefined) out.calories = calories;
  if (mealType !== undefined) out.mealType = mealType;
  const protein = num(o['protein']);
  const carbs = num(o['carbs']);
  const fat = num(o['fat']);
  if (protein !== undefined) out.protein = protein;
  if (carbs !== undefined) out.carbs = carbs;
  if (fat !== undefined) out.fat = fat;
  if (typeof o['mealLabel'] === 'string' && o['mealLabel'].trim()) out.mealLabel = o['mealLabel'].slice(0, 100);
  return out;
}
