import { GoalDirection, WEIGHT_MIN_LB, WEIGHT_MAX_LB } from './macro-heuristic';

/**
 * Funnel handoff between unauthed surfaces (`/calculator`, `/macros/...`)
 * and the v2 onboarding flow. Stash the user's last calculator inputs in
 * sessionStorage when they tap a sign-up CTA so onboarding can pre-fill
 * weight + goal and skip the first 1-2 steps. Without this, a user who
 * just typed "180 lb / lose" on /calculator has to re-type the same
 * answers on /onboarding — the most common funnel drop-off.
 */

export interface CalcPrefill {
  weight: number;
  goal: GoalDirection;
}

const KEY = 'macrolog.calc-prefill';

export function setCalcPrefill(weight: number, goal: GoalDirection): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ weight, goal }));
  } catch {
    // Storage quota / privacy mode — non-fatal, just no prefill.
  }
}

/** Read + clear. Returns null when nothing stored, on parse failure, or
 *  when the stored values fail validation (weight in band, goal in enum).
 *  Always clears the key — a stale prefill across sessions would silently
 *  prepopulate a fresh onboarding for an unrelated user. */
export function consumeCalcPrefill(): CalcPrefill | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
  try {
    const parsed = JSON.parse(raw) as Partial<CalcPrefill>;
    const w = Number(parsed.weight);
    const g = parsed.goal;
    if (!Number.isFinite(w) || w < WEIGHT_MIN_LB || w > WEIGHT_MAX_LB) return null;
    if (g !== 'lose' && g !== 'maintain' && g !== 'gain') return null;
    return { weight: w, goal: g };
  } catch {
    return null;
  }
}
