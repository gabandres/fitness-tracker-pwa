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
 */
export interface EntryPrefill {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel?: string;
}

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
  if (calories === undefined) return null;
  const out: EntryPrefill = { calories };
  const protein = num(o['protein']);
  const carbs = num(o['carbs']);
  const fat = num(o['fat']);
  if (protein !== undefined) out.protein = protein;
  if (carbs !== undefined) out.carbs = carbs;
  if (fat !== undefined) out.fat = fat;
  if (typeof o['mealLabel'] === 'string' && o['mealLabel'].trim()) out.mealLabel = o['mealLabel'].slice(0, 100);
  return out;
}
