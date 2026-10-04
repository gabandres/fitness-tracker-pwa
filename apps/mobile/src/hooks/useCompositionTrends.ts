import { useMemo, useState } from 'react';
import {
  type CompositionMaintenance,
  type DailyLog,
  type Measurement,
  type Profile,
  type RecompSignal,
  LOG_WINDOW_ROWS,
  compositionMaintenance,
  dayBoundaryOf,
  logsCompleteFrom,
  recompSignal,
} from '@macrolog/core';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useAuth } from '@/lib/auth';
import { FEATURES, isFeatureOn } from '@/lib/features';
import { subscribeMeasurements } from '@/lib/ledger';

/** Rows the composition windows can need: the DXA-anchored mode looks back
 *  182 days (26 weekly tapes plus the scans), and a three-readings day adds a
 *  few. Bounded like Body's 20; read only while the flag is on. */
const MEASUREMENT_ROWS = 80;

export interface CompositionTrends {
  /** The flag (`FEATURES.compositionMaintenance`) for this user. When false
   *  nothing below is computed and Trends renders exactly as before. */
  enabled: boolean;
  composition: CompositionMaintenance | null;
  recomp: RecompSignal | null;
  /** Newest tape row's date — the default weekday for the tape reminder. */
  lastTapeAt: Date | null;
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
              open: (deliver, fail) => subscribeMeasurements(uid, MEASUREMENT_ROWS, deliver, fail),
              apply: (rows: Measurement[]) => setMeasurements(rows),
            }),
          ]
        : [],
    deps: [uid, enabled],
  });

  return useMemo<CompositionTrends>(() => {
    if (!enabled) return { enabled: false, composition: null, recomp: null, lastTapeAt: null };
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
    };
  }, [enabled, logs, weights, profile, measurements]);
}
