/**
 * Per-template post-travel re-entry rules (owner, 2026-11-18: legs −10 % at
 * RIR 2, upper body −5 % at the normal effort). No imports, so both
 * `travel.ts` (which stores them on a trip, `TravelPeriod.reentryRules`) and
 * `reentry.ts` (which applies them) can read it. Pure.
 */

/**
 * How hard a re-entry session backs off. Frozen on the session
 * (`WorkoutSession.reentryRule`). Absent → {@link DEFAULT_REENTRY_RULE}.
 */
export interface ReentryRule {
  /** Load cut, percent (10 = −10 %). 0–50. */
  loadPct: number;
  /** The RIR every set stops at. Absent = the lift's normal effort standard
   *  (RIR 1 compounds, failure isolations, drop sets allowed). */
  rir?: number;
  /** The banner ("Re-entry — legs: −10%, RIR 2"). Absent → the default text. */
  label?: string;
  /** How the cut load meets the equipment: `down` (default) to the step at or
   *  under it; `nearest` to the closest step not above the original — a −5 %
   *  cut on a 5-lb dumbbell jump is then "same load", not −25 %. */
  round?: 'down' | 'nearest';
}

/** A trip's rule for some of its templates. */
export interface ReentryRuleEntry extends ReentryRule {
  templateIds: string[];
}

/** −10 %, RIR 2 — `REENTRY_LOAD_FACTOR` / `REENTRY_RIR` in `reentry.ts`
 *  (`reentry-rule.test.ts` pins them equal). */
export const DEFAULT_REENTRY_RULE: ReentryRule = { loadPct: 10, rir: 2 };

/** Well-formed rule fields, or null. */
export function sanitizeReentryRule(raw: unknown): ReentryRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pct = r['loadPct'];
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 50) return null;
  const out: ReentryRule = { loadPct: pct };
  const rir = r['rir'];
  if (typeof rir === 'number' && Number.isInteger(rir) && rir >= 0 && rir <= 5) out.rir = rir;
  if (r['round'] === 'nearest' || r['round'] === 'down') out.round = r['round'];
  const label = r['label'];
  if (typeof label === 'string' && label.trim()) out.label = label.trim().slice(0, 80);
  return out;
}

/** A trip's rule list, malformed entries dropped (the `travelPeriodsOf` way). */
export function sanitizeReentryRules(raw: unknown): ReentryRuleEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReentryRuleEntry[] = [];
  for (const e of raw.slice(0, 10)) {
    const rule = sanitizeReentryRule(e);
    const ids = (e as Record<string, unknown> | null)?.['templateIds'];
    if (!rule || !Array.isArray(ids)) continue;
    const templateIds = ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 100).slice(0, 20);
    if (templateIds.length) out.push({ ...rule, templateIds });
  }
  return out;
}
