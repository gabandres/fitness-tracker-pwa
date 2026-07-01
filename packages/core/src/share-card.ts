/**
 * Share-card stat selection — the pure, shared part of the progress-share
 * feature. The actual image render (canvas on web, ViewShot on native) lives
 * in each app; this module only chooses and formats the tiles.
 *
 * Privacy: the card is built from numbers only (streak, days, weight delta) —
 * it NEVER sources a progress photo (ADR-0010 guardrail).
 */

export interface ShareStats {
  streak: number;
  /** Distinct calendar days with at least one log, all-time. */
  loggedDays: number;
  /** Signed lb change since the start weight; positive = lost. Null when
   *  there's no weight history to compare. */
  weightDeltaLb: number | null;
}

/** A stat tile: a formatted value plus a stable `kind` the caller maps to a
 *  localized label (so this module stays translation-free). */
export interface ShareStatItem {
  value: string;
  kind: 'streak' | 'days' | 'lost' | 'gained';
}

/** Minimum weight move worth putting on a card — below this it's noise. */
const MIN_WEIGHT_DELTA = 0.1;

/**
 * Choose and format the tiles for the card. Streak and days always appear; the
 * weight tile only when there's a meaningful move (and its `kind` encodes
 * direction so the label can read "lost"/"gained" and the value stays
 * unsigned).
 */
export function shareStatItems(s: ShareStats): ShareStatItem[] {
  const items: ShareStatItem[] = [
    { value: s.streak.toLocaleString(), kind: 'streak' },
    { value: s.loggedDays.toLocaleString(), kind: 'days' },
  ];
  if (s.weightDeltaLb != null && Math.abs(s.weightDeltaLb) >= MIN_WEIGHT_DELTA) {
    const lost = s.weightDeltaLb > 0;
    items.push({
      value: `${Math.abs(s.weightDeltaLb).toFixed(1)} lb`,
      kind: lost ? 'lost' : 'gained',
    });
  }
  return items;
}
