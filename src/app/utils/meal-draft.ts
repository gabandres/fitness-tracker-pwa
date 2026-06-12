import type { LogEntry } from '../services/firebase.service';

/**
 * The one place a raw entry form becomes a persistable meal. Pure and
 * dependency-free, the same way `summarizeDay` (ADR-0003) owns per-day
 * rollups: number coercion, the "calories required" rule, label
 * resolution, and timestamp construction all live here and nowhere else.
 *
 * Before this module the coercion ran in `entry-sheet`'s input handlers,
 * its `save()` guard, and `EntryFormManager.submit()` — three copies, and
 * the edge cases (`""`, `NaN`, `Infinity`) sat where no test could reach
 * them. Now the interface is the test surface (see `meal-draft.spec.ts`).
 */

/** Raw form fields, exactly as the entry form holds them — numbers may
 *  arrive as strings (straight off an `<input>`), as `number`, or null. */
export interface RawMealInput {
  calories: string | number | null | undefined;
  protein?: string | number | null | undefined;
  carbs?: string | number | null | undefined;
  fat?: string | number | null | undefined;
  exerciseCompleted?: boolean;
  /** Free-text label the user typed. */
  mealLabel?: string | null;
  /** Label carried in from a preset / photo / barcode estimate; used when
   *  the user didn't type their own. */
  activePresetName?: string | null;
  /** `YYYY-MM-DD` local date key. When present, the entry is stamped at
   *  local noon on that day (matching the pre-extraction behavior). */
  dateKey?: string | null;
}

/** A validated, ready-to-persist meal. `entry` is what the ledger saves;
 *  the scalar fields are surfaced for the preset-save snapshot so callers
 *  never re-coerce. */
export interface MealDraft {
  entry: LogEntry;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  label?: string;
}

/** Why a raw input could not become a draft. Extend as rules grow; today
 *  only calories are mandatory. */
export type MealDraftError = 'calories-required';

export type MealDraftResult =
  | { ok: true; draft: MealDraft }
  | { ok: false; error: MealDraftError };

/** i18n key per error, so callers translate without re-encoding the rule. */
export const MEAL_DRAFT_ERROR_MESSAGE_KEYS: Record<MealDraftError, string> = {
  'calories-required': 'entry.errorCaloriesRequired',
};

/**
 * Coerce a raw numeric form field to a finite number, or null. Handles the
 * three shapes a field can arrive in (string from an `<input>`, `number`
 * from a signal, or null/undefined) uniformly. Empty / blank / non-numeric
 * / non-finite (NaN, Infinity) all collapse to null.
 */
export function parseNumericInput(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Resolve the meal label: the user's typed label wins; otherwise the
 *  estimate/preset name; otherwise none. */
function resolveLabel(
  mealLabel: string | null | undefined,
  activePresetName: string | null | undefined,
): string | undefined {
  const typed = (mealLabel ?? '').trim();
  if (typed) return typed;
  return activePresetName || undefined;
}

/** Build the local-noon timestamp for a `YYYY-MM-DD` key, or undefined
 *  (the ledger then stamps `now`). Noon avoids the entry landing on the
 *  previous day under negative UTC offsets. */
function timestampForDateKey(dateKey: string | null | undefined): Date | undefined {
  if (!dateKey) return undefined;
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Parse raw entry-form fields into a persistable {@link MealDraft}, or an
 * error. Calories are required (after coercion); protein is optional and
 * dropped when blank/invalid; exercise, label, and date are normalized in.
 */
export function parseMealDraft(raw: RawMealInput): MealDraftResult {
  const calories = parseNumericInput(raw.calories);
  if (calories == null) {
    return { ok: false, error: 'calories-required' };
  }

  const entry: LogEntry = { calories };

  const protein = parseNumericInput(raw.protein);
  if (protein != null) entry.protein = protein;

  const carbs = parseNumericInput(raw.carbs);
  if (carbs != null) entry.carbs = carbs;

  const fat = parseNumericInput(raw.fat);
  if (fat != null) entry.fat = fat;

  entry.exerciseCompleted = raw.exerciseCompleted === true;

  const timestamp = timestampForDateKey(raw.dateKey);
  if (timestamp) entry.timestamp = timestamp;

  const label = resolveLabel(raw.mealLabel, raw.activePresetName);
  if (label) entry.mealLabel = label;

  return {
    ok: true,
    draft: {
      entry,
      calories,
      ...(protein != null ? { protein } : {}),
      ...(carbs != null ? { carbs } : {}),
      ...(fat != null ? { fat } : {}),
      ...(label ? { label } : {}),
    },
  };
}
