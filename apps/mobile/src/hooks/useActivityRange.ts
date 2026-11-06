import { useEffect, useState } from 'react';
import type { DailyActivity } from '@macrolog/core';
import { getActivityWindow } from '@/lib/ledger';

/**
 * A one-shot read of `dailyActivity` days `[from, to]` (inclusive), re-read
 * when the range or `refreshKey` changes (2026-11-06: the usual-steps line on
 * Today, the 7-day average on Trends, a trip's day list). Not a listener: these
 * are past days, and today's live count already has its own day listener
 * (`subscribeDailyActivityDay`). Each surface reads for itself (ADR-0016).
 *
 * `null` until the first answer; `{}` on a failed read — no steps line rather
 * than a spinner.
 */
export function useActivityRange(
  uid: string | undefined,
  from: string | null,
  to: string | null,
  refreshKey: unknown = 0,
): Record<string, DailyActivity> | null {
  const [days, setDays] = useState<Record<string, DailyActivity> | null>(null);
  useEffect(() => {
    if (!uid || !from || !to || from > to) {
      setDays(null);
      return;
    }
    let alive = true;
    getActivityWindow(uid, from, to)
      .then((d) => alive && setDays(d))
      .catch(() => alive && setDays({}));
    return () => {
      alive = false;
    };
  }, [uid, from, to, refreshKey]);
  return days;
}
