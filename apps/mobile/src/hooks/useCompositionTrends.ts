import { useMemo, useState } from 'react';
import {
  type CompositionMaintenance,
  type DailyLog,
  type Measurement,
  type Profile,
  type RecompSignal,
  COMP_DXA_WINDOW_MAX_DAYS,
  LOG_WINDOW_ROWS,
  compositionMaintenance,
  dayBoundaryOf,
  logsCompleteFrom,
  recompSignal,
} from '@macrolog/core';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useAuth } from '@/lib/auth';
import { FEATURES, isFeatureOn } from '@/lib/features';
import { subscribeMeasurementsSince } from '@/lib/ledger';

/** The longest window anything here reads — the DXA-anchored lookback — plus
 *  a day of slack for a non-midnight day boundary. Bounded by time, not rows
 *  (a row cap could drop the older scan); read only while the flag is on. */
const LOOKBACK_DAYS = COMP_DXA_WINDOW_MAX_DAYS + 1;

export interface CompositionTrends {
  /** The flag (`FEATURES.compositionMaintenance`) for this user. When false
   *  nothing below is computed and Trends renders exactly as before. */
  enabled: boolean;
  composition: CompositionMaintenance | null;
  recomp: RecompSignal | null;
  /** Newest tape row's date — the default weekday for the tape reminder. */
  lastTapeAt: Date | null;
  /** Women's Navy set includes the hip — the copy asks for it. */
  female: boolean;
}

/**
 * Composition-adjusted maintenance and the recomp signal for Trends
 * (ADR-0043). Display-only: the calorie target never reads either.
 *
 * Opens its OWN measurements listener (ADR-0016: Body has one too; a second
 * consumer subscribes, it does not share) — and only while the flag is on, so
 * a user without it pays no extra read.
 */
export function useCompositionTrends(
  logs: readonly DailyLog[],
  weights: Readonly<Record<string, number>>,
  profile: Profile | null,
): CompositionTrends {
  const { user, isAdmin } = useAuth();
  const uid = user?.uid;
  const enabled = isFeatureOn(FEATURES.compositionMaintenance, { isAdmin });
  const [measurements, setMeasurements] = useState<Measurement[]>([]);

  useLedgerFeed({
    uid,
    label: 'TrendsMeasurements',
    gate: 'focus',
    channels: () =>
      uid && enabled
        ? [
            feedChannel({
              key: 'measurements',
              open: (deliver, fail) =>
                subscribeMeasurementsSince(uid, new Date(Date.now() - LOOKBACK_DAYS * 86_400_000), deliver, fail),
              apply: (rows: Measurement[]) => setMeasurements(rows),
            }),
          ]
        : [],
    deps: [uid, enabled],
  });

  return useMemo<CompositionTrends>(() => {
    if (!enabled) return { enabled: false, composition: null, recomp: null, lastTapeAt: null, female: false };
    const boundary = dayBoundaryOf(profile);
    const now = new Date();
    const body = { sex: profile?.sex ?? null, heightIn: profile?.heightIn ?? null };
    const lastTape = measurements.find((m) => m.waist != null);
    return {
      enabled: true,
      composition: compositionMaintenance({
        logs,
        dailyWeights: weights,
        measurements,
        profile: body,
        boundary,
        now,
        // Trends' logs are the row-capped cache (ADR-0004): a 182-day DXA span
        // can start before it does.
        logsCompleteFromKey: logsCompleteFrom(logs, LOG_WINDOW_ROWS, boundary),
      }),
      recomp: recompSignal({ dailyWeights: weights, measurements, boundary, now }),
      lastTapeAt: lastTape?.date ?? null,
      female: profile?.sex === 'female',
    };
  }, [enabled, logs, weights, profile, measurements]);
}
