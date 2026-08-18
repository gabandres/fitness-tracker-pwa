/**
 * Building a storable {@link MealPreset} (ADR-0020 quick-add templates).
 *
 * This exists for one reason: `isValidPreset` in `firestore.rules` bounds every
 * field, and a client that writes past those bounds gets `permission-denied`
 * with **no indication of which field was wrong** — the row is silently lost.
 * That happened in production (Sentry `IGNIA-MOBILE-9`, 2026-08-17): the mobile
 * entry sheet hand-built the preset payload with `name: label.trim()` and raw
 * numbers, bypassing every limit.
 *
 * So the limits live here, next to the builder, and every write path goes
 * through it. Mirrors {@link buildCustomFood}, which already did this for the
 * My Foods library and is why that path had no such bug.
 *
 * Framework-free and dependency-free — see `@macrolog/core` (ADR-0012).
 */
import type { MealPreset } from './types';

/** The bounds `isValidPreset` enforces server-side. Keep in step with
 *  `firestore.rules`; a change there without a change here reintroduces the
 *  silent-write-loss bug this module exists to prevent. */
export const PRESET_LIMITS = {
  nameChars: 100,
  maxCalories: 19_999,
  maxMacro: 999,
} as const;

const round1 = (n: number): number => Math.round(n * 10) / 10;

const clampNum = (n: number | undefined, hi: number): number | undefined =>
  n == null ? undefined : Number.isFinite(n) ? Math.min(hi, Math.max(0, n)) : undefined;

/** What the user typed, before any clamping. */
export interface MealPresetDraft {
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/**
 * Build the storable preset payload (sans id), clamped into the
 * `isValidPreset` bounds. Absent macros stay absent — never written as fake
 * zeros, which would be indistinguishable from a real logged 0 g.
 *
 * A non-finite macro (NaN/Infinity) is dropped rather than coerced, because a
 * preset with a wrong-but-plausible number is worse than one with a missing
 * one: quick-add fires it blind from the widget with no review screen.
 */
export function buildMealPreset(draft: MealPresetDraft): Omit<MealPreset, 'id'> {
  const calories = Number.isFinite(draft.calories)
    ? Math.round(Math.min(PRESET_LIMITS.maxCalories, Math.max(0, draft.calories)))
    : 0;

  const preset: Omit<MealPreset, 'id'> = {
    name: draft.name.trim().slice(0, PRESET_LIMITS.nameChars),
    calories,
  };

  const p = clampNum(draft.protein, PRESET_LIMITS.maxMacro);
  const c = clampNum(draft.carbs, PRESET_LIMITS.maxMacro);
  const f = clampNum(draft.fat, PRESET_LIMITS.maxMacro);
  if (p != null) preset.protein = round1(p);
  if (c != null) preset.carbs = round1(c);
  if (f != null) preset.fat = round1(f);
  return preset;
}
