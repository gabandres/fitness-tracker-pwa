/**
 * Sanity bands for the four Mifflin-St Jeor profile inputs.
 *
 * They existed as bare literals in three places that had to agree and had no
 * way to say so: `firestore.rules` (`heightIn >= 40 && <= 96`, `age >= 13 &&
 * <= 120`), the Refine-targets screen's `heightValid` / `ageValid`, and — as
 * of F1/F2 — the onboarding body step, which collects the same four fields at
 * first run. A client band looser than the rules band is a write the server
 * silently rejects; a tighter one is a value the user cannot enter for no
 * stated reason. Naming them once is what keeps the two ends honest.
 *
 * `firestore.rules` cannot import TypeScript, so it still spells the numbers
 * out. `functions/test/firestore-rules.spec.ts` is where that copy is pinned.
 *
 * Bands are typo filters, not fitness judgements — the app is 13+, and 40 in
 * / 96 in spans a small teenager to the tallest adult on record.
 */

/** Total height in inches. */
export const HEIGHT_IN_MIN = 40;
export const HEIGHT_IN_MAX = 96;
/** Years. 13 is the app's minimum age (App Store 12+/13+ policy). */
export const AGE_MIN = 13;
export const AGE_MAX = 120;

export function isPlausibleHeightIn(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= HEIGHT_IN_MIN && value <= HEIGHT_IN_MAX;
}

export function isPlausibleAge(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= AGE_MIN && value <= AGE_MAX;
}
