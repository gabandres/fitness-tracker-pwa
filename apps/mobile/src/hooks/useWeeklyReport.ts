import { useCallback, useEffect, useState } from 'react';
import {
  type WeeklyReport,
  buildMilestoneContext,
  buildWeeklyReportPayload,
  computeStreak,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeLatestReport } from '@/lib/ledger';
import { requestWeeklyReport, reportErrorCode } from '@/lib/weeklyReport';
import { useLocale } from '@/i18n';
import { useCoach } from './useCoach';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyReportState {
  report: WeeklyReport | null;
  generating: boolean;
  /** Typed ReportErrorCode of the last failure, or null. */
  errorCode: string | null;
  /** True when there is no report or the cached one is >7 days old. */
  isStale: boolean;
  generate: () => Promise<void>;
}

/**
 * Owns the Pro weekly report on mobile: subscribes to the latest cached
 * report, and generates a fresh one on demand (Pro-gated + 6-day rate-limited
 * server-side). Reuses {@link useCoach} for the grounding inputs so the
 * report and coach share one data path. Generation is strictly user-initiated
 * (no auto-fire — a cost control the web app also enforces).
 */
export function useWeeklyReport(): WeeklyReportState {
  const { user } = useAuth();
  const uid = user?.uid;
  const locale = useLocale();
  const { logs, tdee, profile, dailyWeights } = useCoach();

  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeLatestReport(uid, setReport, () => {});
  }, [uid]);

  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setErrorCode(null);
    try {
      const streak = computeStreak(logs).streak;
      const milestone = buildMilestoneContext(logs, streak);
      const payload = buildWeeklyReportPayload({ logs, tdee, profile, dailyWeights, milestone, locale });
      // The server writes the doc; subscribeLatestReport delivers the update.
      await requestWeeklyReport(payload);
    } catch (err) {
      setErrorCode(reportErrorCode(err) ?? 'REPORT_GENERATE_FAILED');
    } finally {
      setGenerating(false);
    }
  }, [generating, logs, tdee, profile, dailyWeights, locale]);

  const isStale = !report || Date.now() - report.generatedAt.getTime() > SEVEN_DAYS_MS;

  return { report, generating, errorCode, isStale, generate };
}
