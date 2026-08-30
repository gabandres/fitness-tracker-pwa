/**
 * The admin panel's insight engine — pure functions over the numbers the
 * panel already loads, so every sentence it prints is testable without
 * Firebase and can be re-derived from the same inputs the cards show.
 *
 * An insight is a claim with a level and a place to click. Levels are
 * deliberately few: `good` (leave it alone), `watch` (worth a look this
 * week), `bad` (act today), `info` (context, not a judgement). Thresholds are
 * the ones the product-analytics literature uses for early-stage consumer
 * apps — DAU/MAU ≥ 20% is "sticky", D7 ≥ 40% activated retention is strong
 * for a tracker — stated in each rule so they can be argued with.
 */

export type InsightLevel = 'good' | 'watch' | 'bad' | 'info';

export interface Insight {
  readonly level: InsightLevel;
  readonly title: string;
  readonly detail: string;
  /** Section id the insight points at, for the "open" affordance. */
  readonly section: string;
}

export interface UsageDay {
  readonly day: string;
  readonly activeUsers: number;
  readonly platforms: Record<string, number>;
  readonly events: Record<string, number>;
}

export interface UsageSeries {
  readonly from: string;
  readonly to: string;
  readonly days: number;
  readonly computedAt: string;
  readonly daily: readonly UsageDay[];
  readonly dau: number;
  readonly wau: number;
  readonly mau: number;
  readonly wauPrior: number | null;
  readonly usersInWindow: number;
  readonly eventTotals: Record<string, number>;
  readonly platformTotals: Record<string, number>;
}

export interface RetentionCheckpoint { readonly retained: number; readonly eligible: number; }
export interface RetentionCohort {
  readonly week: string;
  readonly size: number;
  readonly activated: number;
  readonly retained: Record<string, RetentionCheckpoint>;
  readonly retainedActivated: Record<string, RetentionCheckpoint>;
}
export interface RetentionSummary {
  readonly computedAt?: unknown;
  readonly windowDays: number;
  readonly activationThreshold: number;
  readonly usersExamined: number;
  readonly excludedSynthetic: number;
  readonly truncated: boolean;
  readonly activatedTotal: number;
  readonly logsPerActivatedUserPerDay: number;
  readonly insufficientSample: boolean;
  readonly cohorts: readonly RetentionCohort[];
}

export interface CeilingStatus {
  readonly kind: string;
  readonly date: string;
  readonly used: number;
  readonly limit: number;
  readonly killed: boolean;
  readonly killedReason: string;
  readonly ratio: number;
}

export interface StatsLike {
  readonly totalUsers: number;
  readonly newUsers7d: number;
  readonly newUsers30d: number;
  readonly verifiedCount: number;
  readonly disabledCount: number;
  readonly usersWithFirstEntryCount: number;
  readonly firstEntryWithin24hCount?: number;
  readonly profileCompletedCount: number;
}

export interface InsightInputs {
  readonly stats: StatsLike | null;
  readonly usage: UsageSeries | null;
  readonly retention: RetentionSummary | null;
  readonly ceilings: readonly CeilingStatus[];
  /** Minutes since the last `status/heartbeat` pulse; null when unknown. */
  readonly heartbeatAgeMin: number | null;
  readonly unreadFeedback: number;
}

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

/** Pooled retention across every cohort at one checkpoint, activated users only. */
export function pooledRetention(summary: RetentionSummary | null, checkpoint: 'd1' | 'd7' | 'd30'): { rate: number | null; retained: number; eligible: number } {
  if (!summary) return { rate: null, retained: 0, eligible: 0 };
  let retained = 0;
  let eligible = 0;
  for (const c of summary.cohorts) {
    const cp = c.retainedActivated?.[checkpoint];
    if (!cp) continue;
    retained += cp.retained;
    eligible += cp.eligible;
  }
  return { rate: pct(retained, eligible), retained, eligible };
}

/** Sum of a usage event over the last `n` days of the series. */
export function sumEvent(usage: UsageSeries | null, event: string, n?: number): number {
  if (!usage) return 0;
  const days = n ? usage.daily.slice(-n) : usage.daily;
  return days.reduce((acc, d) => acc + (d.events[event] ?? 0), 0);
}

export function deltaPct(current: number, prior: number | null): number | null {
  if (prior === null || prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
}

export function buildInsights(input: InsightInputs): Insight[] {
  const out: Insight[] = [];
  const { stats, usage, retention, ceilings } = input;

  // ── Operational first: things that are wrong right now outrank trends.
  for (const c of ceilings) {
    if (c.killed) {
      out.push({
        level: 'bad',
        title: `${c.kind} is switched OFF`,
        detail: c.killedReason ? `Kill-switch reason: “${c.killedReason}”. It does not clear itself.` : 'The kill-switch is engaged and does not clear itself.',
        section: 'ai',
      });
    } else if (c.limit > 0 && c.ratio >= 0.8) {
      out.push({
        level: 'watch',
        title: `${c.kind} spend is at ${Math.round(c.ratio * 100)}% of today's ceiling`,
        detail: `${c.used} of ${c.limit} used. The ceiling resets at UTC midnight; raise it only if the traffic is real.`,
        section: 'ai',
      });
    }
  }
  if (input.heartbeatAgeMin !== null && input.heartbeatAgeMin > 45) {
    out.push({
      level: 'bad',
      title: `No status pulse for ${Math.round(input.heartbeatAgeMin)} min`,
      detail: 'statusPulse writes every 15 minutes. Three misses means Cloud Scheduler or the function is down — check the functions logs.',
      section: 'overview',
    });
  }
  if (input.unreadFeedback > 0) {
    out.push({
      level: 'info',
      title: `${input.unreadFeedback} feedback report${input.unreadFeedback === 1 ? '' : 's'} not yet read`,
      detail: 'Reports are append-only; reading one here marks it seen on this browser only.',
      section: 'feedback',
    });
  }

  // ── Engagement
  if (usage) {
    const stick = pct(usage.dau, usage.mau);
    if (stick !== null && usage.mau >= 10) {
      out.push(stick >= 20
        ? { level: 'good', title: `Stickiness ${stick}% (DAU/MAU)`, detail: `${usage.dau} of ${usage.mau} monthly users opened the app today. 20%+ is the consumer-app bar.`, section: 'overview' }
        : stick >= 10
          ? { level: 'watch', title: `Stickiness ${stick}% (DAU/MAU)`, detail: `${usage.dau} of ${usage.mau} monthly users today. Under 20% means most people use Ignia weekly, not daily.`, section: 'overview' }
          : { level: 'bad', title: `Stickiness ${stick}% (DAU/MAU)`, detail: `${usage.dau} of ${usage.mau} monthly users today. Under 10% is a habit that has not formed.`, section: 'overview' });
    }
    const wauDelta = deltaPct(usage.wau, usage.wauPrior);
    if (wauDelta !== null && Math.abs(wauDelta) >= 15) {
      out.push({
        level: wauDelta > 0 ? 'good' : 'watch',
        title: `Weekly actives ${wauDelta > 0 ? 'up' : 'down'} ${Math.abs(wauDelta)}% week over week`,
        detail: `${usage.wau} this week vs ${usage.wauPrior} the week before.`,
        section: 'overview',
      });
    }
    const web = usage.platformTotals['web'] ?? 0;
    const total = Object.values(usage.platformTotals).reduce((a, b) => a + b, 0);
    if (total > 0 && web > 0) {
      out.push({
        level: 'info',
        title: `Web still shows ${pct(web, total)}% of active days in this window`,
        detail: 'The web logging app was retired 2026-08-30 (ADR-0036); this reads 0 once the window rolls past that date.',
        section: 'overview',
      });
    }
  }

  // ── Activation
  if (stats && stats.usersWithFirstEntryCount > 0 && stats.firstEntryWithin24hCount !== undefined) {
    const fast = pct(stats.firstEntryWithin24hCount, stats.usersWithFirstEntryCount);
    if (fast !== null) {
      out.push(fast >= 50
        ? { level: 'good', title: `${fast}% of activated users logged within 24h of signing up`, detail: 'Time-to-first-log is the activation metric that predicts retention. This is healthy.', section: 'overview' }
        : { level: 'watch', title: `Only ${fast}% of activated users logged within 24h`, detail: 'The first log is the “aha”. If it slips past the first day it usually never happens — look at onboarding.', section: 'overview' });
    }
  }
  if (stats && stats.totalUsers > 0) {
    const onboarded = pct(stats.profileCompletedCount, stats.totalUsers);
    if (onboarded !== null && onboarded < 60) {
      out.push({ level: 'watch', title: `${onboarded}% of accounts finished onboarding`, detail: `${stats.totalUsers - stats.profileCompletedCount} accounts signed up and never completed the two questions.`, section: 'users' });
    }
    const unverified = stats.totalUsers - stats.verifiedCount;
    if (pct(unverified, stats.totalUsers)! >= 30) {
      out.push({ level: 'watch', title: `${unverified} accounts never verified their email`, detail: 'Unverified accounts cannot write (rules require email_verified). Usually a sign the verification mail is not landing.', section: 'users' });
    }
    if (stats.disabledCount > 0) {
      out.push({ level: 'info', title: `${stats.disabledCount} suspended account${stats.disabledCount === 1 ? '' : 's'}`, detail: 'Suspended by an admin action; each one is in the audit log.', section: 'audit' });
    }
  }

  // ── Retention
  if (retention) {
    const d7 = pooledRetention(retention, 'd7');
    if (d7.rate !== null && d7.eligible > 0) {
      const sample = retention.insufficientSample ? ` (n=${d7.eligible}, read as directional only)` : '';
      out.push(d7.rate >= 40
        ? { level: 'good', title: `D7 retention ${d7.rate}% among activated users${sample}`, detail: `${d7.retained} of ${d7.eligible} people who logged ${retention.activationThreshold}+ times were still logging a week later.`, section: 'overview' }
        : d7.rate >= 25
          ? { level: 'watch', title: `D7 retention ${d7.rate}% among activated users${sample}`, detail: `${d7.retained} of ${d7.eligible}. 40% is where a tracker starts to look durable.`, section: 'overview' }
          : { level: 'bad', title: `D7 retention ${d7.rate}% among activated users${sample}`, detail: `${d7.retained} of ${d7.eligible}. Most people who tried it were gone within a week.`, section: 'overview' });
    }
    if (retention.activatedTotal > 0 && retention.logsPerActivatedUserPerDay < 1) {
      out.push({ level: 'watch', title: `Activated users log ${retention.logsPerActivatedUserPerDay.toFixed(2)}× per day`, detail: 'Under ~1 log a day an activated user has effectively churned even if they still open the app.', section: 'overview' });
    }
  }

  const order: Record<InsightLevel, number> = { bad: 0, watch: 1, good: 2, info: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
