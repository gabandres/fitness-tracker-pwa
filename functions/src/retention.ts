import { Firestore, Timestamp } from "firebase-admin/firestore";

// ─── Retention cohorts ──────────────────────────────────────────────
//
// `getPlatformStats` already answers "how many users are there right
// now, and how many ever logged" — a point-in-time funnel. It cannot
// answer the question that decides whether to build, market, or stop:
// **of the people who signed up in a given week and actually started
// using the app, how many were still logging N days later?**
//
// That needs a cohort, not a total, and it needs to be recorded over
// time — a retention curve read once tells you nothing about whether
// a friction fix moved it.
//
// Two deliberate definitions, because the naive ones mislead:
//
//   Retained = still LOGGING, not still opening. `lastSeenAt` moves
//   when the app is foregrounded, which a background refresh or a
//   notification tap can do; a food tracker whose user opens it and
//   logs nothing has churned. Retention here is measured off the last
//   dailyLog timestamp.
//
//   Activated = 3+ logs, ever. Aggregate retention over ALL installs
//   is dominated by people who never completed onboarding, so it looks
//   terrible for every tracker regardless of product quality and can't
//   distinguish "nobody arrives" from "they arrive and leave". Every
//   cohort below is reported twice: all signups, and the activated
//   subset. The activated number is the one that carries a verdict.
//
// Cost: three aggregation queries per in-scope user per DAY (count of
// all logs, count of logs in the last 7 days, and one 1-doc read for
// the newest log). Aggregations bill ~1 read per 1000 index entries,
// so this is roughly 2 reads/user/day — cheaper than the
// collection-group log scans getPlatformStats does, and it stays
// inside the free daily read tier at any user count we can plausibly
// reach. It is NOT a new Cloud Scheduler job: the free tier is 3 and
// all 3 are spent, so this runs from the hourly dispatcher and
// no-ops on 23 of every 24 invocations.

/** UTC hour the daily pass runs. Off-peak, and after the day has
 *  closed in the Americas so "yesterday" is settled. */
const RUN_AT_UTC_HOUR = 9;

/** Cohorts older than this are frozen history — their D30 can no longer
 *  change, so recomputing them every day is wasted reads. */
const COHORT_WINDOW_DAYS = 120;

/** Hard cap on users examined per run, so a growth spike can't turn one
 *  scheduled tick into an unbounded read bill. Truncation is logged, never
 *  silent — a quietly-capped metric reads as a complete one. */
const MAX_USERS_PER_RUN = 3000;

/** Logs-ever needed to count as activated. Below this a signup is a
 *  tourist, and including them buries the signal. */
const ACTIVATION_LOGS = 3;

/** Retention checkpoints, in days since signup. */
const CHECKPOINTS = [1, 7, 30] as const;

/** Retention curves below this many activated users are noise; a kill or
 *  ship decision read off a smaller sample is the likeliest way to get
 *  this wrong. Surfaced on the doc rather than left for the reader to
 *  work out. */
const MIN_ACTIVATED_FOR_CONFIDENCE = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the `onDailyLogCreated` first-entry latch shipped (e2b8f6a2). Before
 *  this, a missing `firstEntryAt` proves nothing about whether a user logged. */
const FIRST_ENTRY_TRIGGER_MS = Date.parse("2026-04-30T00:00:00Z");

interface CohortRow {
  /** Monday of the signup week, YYYY-MM-DD (UTC). */
  week: string;
  signups: number;
  activated: number;
  /** `d1`/`d7`/`d30`: retained over eligible, for all signups. */
  retained: Record<string, { retained: number; eligible: number }>;
  /** Same checkpoints, restricted to the activated subset. */
  retainedActivated: Record<string, { retained: number; eligible: number }>;
}

/** Monday-anchored UTC week key, so a cohort is a stable bucket. */
function weekKey(d: Date): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0=Sun. Shift so Monday starts the week.
  const offset = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - offset);
  return utc.toISOString().slice(0, 10);
}

/** Per-user log facts, from aggregations rather than reading the logs. */
async function logFacts(db: Firestore, uid: string, sevenDaysAgo: Timestamp): Promise<{
  total: number;
  last7d: number;
  lastLogAt: Timestamp | null;
}> {
  const logs = db.collection(`users/${uid}/dailyLogs`);
  const [totalSnap, recentSnap, newestSnap] = await Promise.all([
    logs.count().get(),
    logs.where("timestamp", ">=", sevenDaysAgo).count().get(),
    logs.orderBy("timestamp", "desc").limit(1).select("timestamp").get(),
  ]);
  const newest = newestSnap.docs[0]?.data()?.["timestamp"] as Timestamp | undefined;
  return {
    total: totalSnap.data().count,
    last7d: recentSnap.data().count,
    lastLogAt: newest ?? null,
  };
}

/**
 * Plain async task run by the hourly dispatcher (`hourly-tasks.ts`). The
 * dispatcher fires every hour; the daily pass is one of those 24, so this
 * returns immediately on the other 23.
 */
export async function runRetentionCohorts(db: Firestore): Promise<void> {
  const now = new Date();
  if (now.getUTCHours() !== RUN_AT_UTC_HOUR) return;
  await computeRetentionCohorts(db, now);
}

/**
 * Recompute the retention cohorts and write them to `config/retention`
 * (admin-read, server-write — no rules change needed), plus a rolling
 * 90-day history in `config/retentionHistory` so a curve can be read as a
 * trend instead of a single reading. Returns what it wrote.
 *
 * Separate from the scheduling gate above so it can be run — and tested —
 * at any clock time.
 */
export async function computeRetentionCohorts(db: Firestore, now = new Date()) {
  const windowStart = Timestamp.fromDate(new Date(now.getTime() - COHORT_WINDOW_DAYS * DAY_MS));
  const sevenDaysAgo = Timestamp.fromDate(new Date(now.getTime() - 7 * DAY_MS));

  // `createdAt` is required on every profile by firestore.rules, so it is
  // the cohort anchor — no Auth listUsers pagination needed.
  //
  // Caveat worth knowing when reading the output: a Firestore range filter
  // skips documents that lack the field entirely, so any profile written
  // before `createdAt` was required is invisible here rather than
  // miscounted. That only affects accounts older than the cohort window,
  // which this query excludes anyway.
  //
  // `syntheticAccount` is fetched, not filtered on: a Firestore inequality
  // (`!=`, `==` false) skips documents that lack the field entirely, which is
  // every real user. So the seeded accounts are dropped in the loop below.
  const profiles = await db
    .collection("users")
    .where("createdAt", ">=", windowStart)
    .select("createdAt", "firstEntryAt", "syntheticAccount")
    .limit(MAX_USERS_PER_RUN)
    .get();

  const truncated = profiles.size === MAX_USERS_PER_RUN;
  if (truncated) {
    console.warn(
      `runRetentionCohorts: hit the ${MAX_USERS_PER_RUN}-user cap — cohorts are ` +
        "computed from a TRUNCATED sample and undercount the newest week.",
    );
  }

  const cohorts = new Map<string, CohortRow>();
  let activatedTotal = 0;
  let logsLast7dTotal = 0;
  let excludedSynthetic = 0;

  // Sequential on purpose: three aggregations per user in parallel across
  // thousands of users would burst the Firestore client's connection pool
  // for no wall-clock benefit inside a 540s scheduled function.
  for (const doc of profiles.docs) {
    const createdAt = doc.data()["createdAt"] as Timestamp | undefined;
    if (!createdAt) continue; // unreachable given the filter; narrows the type

    // Seeded accounts (the App Store demo + review logins) are excluded
    // entirely — not just from the activated subset. `seed-demo-account.mjs`
    // writes 83 logs and back-dates `createdAt` ~30 days, which produces a
    // flawless D1/D7/D30 user. At the sample size this project actually has
    // (n=11 activated on the first real run), two of those distort the only
    // retention number it owns: they made one week read 2/2 across every
    // checkpoint. Dropped before the cohort row is created, so a week
    // containing nothing but seeded signups does not appear at all.
    if (doc.data()["syntheticAccount"] === true) {
      excludedSynthetic++;
      continue;
    }

    const signupMs = createdAt.toMillis();
    const ageDays = (now.getTime() - signupMs) / DAY_MS;
    const week = weekKey(createdAt.toDate());

    let row = cohorts.get(week);
    if (!row) {
      row = {
        week,
        signups: 0,
        activated: 0,
        retained: {},
        retainedActivated: {},
      };
      for (const n of CHECKPOINTS) {
        row.retained[`d${n}`] = { retained: 0, eligible: 0 };
        row.retainedActivated[`d${n}`] = { retained: 0, eligible: 0 };
      }
      cohorts.set(week, row);
    }
    row.signups++;

    // `firstEntryAt` is a cheap pre-filter: no first entry means no logs at
    // all, so skip the three aggregations entirely for users who never
    // started. Only trustworthy for accounts created after the
    // onDailyLogCreated trigger shipped (e2b8f6a2, 2026-04-30) — older ones
    // can have logs with no stamp, so they fall through to the aggregations
    // and are still counted correctly.
    const neverLogged =
      doc.data()["firstEntryAt"] == null && signupMs > FIRST_ENTRY_TRIGGER_MS;
    const facts = neverLogged
      ? { total: 0, last7d: 0, lastLogAt: null }
      : await logFacts(db, doc.id, sevenDaysAgo);

    const activated = facts.total >= ACTIVATION_LOGS;
    if (activated) {
      row.activated++;
      activatedTotal++;
      logsLast7dTotal += facts.last7d;
    }

    for (const n of CHECKPOINTS) {
      // Only users who have HAD the chance to reach day N belong in the
      // denominator; counting a 3-day-old signup as "not retained at D30"
      // would drag every recent cohort toward zero.
      if (ageDays < n) continue;
      const retained =
        facts.lastLogAt != null && facts.lastLogAt.toMillis() - signupMs >= n * DAY_MS;
      row.retained[`d${n}`].eligible++;
      if (retained) row.retained[`d${n}`].retained++;
      if (activated) {
        row.retainedActivated[`d${n}`].eligible++;
        if (retained) row.retainedActivated[`d${n}`].retained++;
      }
    }
  }

  const rows = [...cohorts.values()].sort((a, b) => b.week.localeCompare(a.week));

  const summary = {
    computedAt: Timestamp.now(),
    windowDays: COHORT_WINDOW_DAYS,
    activationThreshold: ACTIVATION_LOGS,
    usersExamined: profiles.size,
    /** Seeded accounts dropped from every cohort above. Reported rather than
     *  silently subtracted: `usersExamined` minus this is the real
     *  denominator, and a reader who can't see the gap can't check it. */
    excludedSynthetic,
    truncated,
    activatedTotal,
    /** The PMF signal for a tracker: an activated user logging < ~1×/day
     *  has effectively churned even if they still open the app. */
    logsPerActivatedUserPerDay:
      activatedTotal > 0 ? Number((logsLast7dTotal / activatedTotal / 7).toFixed(2)) : 0,
    /** Read the curves as directional only while this is true. */
    insufficientSample: activatedTotal < MIN_ACTIVATED_FOR_CONFIDENCE,
    cohorts: rows,
  };

  await db.doc("config/retention").set(summary);

  // Rolling history — one small row per day, so a fix can be shown to have
  // moved (or not moved) the curve. Trimmed to 90 rows; the full cohort
  // breakdown lives in the doc above and is not duplicated here.
  const today = now.toISOString().slice(0, 10);
  const historyRef = db.doc("config/retentionHistory");
  const prior = (await historyRef.get()).data()?.["days"];
  const days: Array<Record<string, unknown>> = Array.isArray(prior) ? prior : [];
  const todayRow = {
    date: today,
    activatedTotal,
    logsPerActivatedUserPerDay: summary.logsPerActivatedUserPerDay,
    // Whole-population rates across every eligible user, cohort-independent
    // — the single number to watch move.
    ...Object.fromEntries(
      CHECKPOINTS.map((n) => {
        const key = `d${n}`;
        const retained = rows.reduce((sum, r) => sum + r.retainedActivated[key].retained, 0);
        const eligible = rows.reduce((sum, r) => sum + r.retainedActivated[key].eligible, 0);
        return [key, eligible > 0 ? Number((retained / eligible).toFixed(3)) : null];
      }),
    ),
  };
  await historyRef.set({
    days: [...days.filter((d) => d["date"] !== today), todayRow].slice(-90),
    updatedAt: Timestamp.now(),
  });

  console.log(
    `retentionCohorts: ${profiles.size} user(s), ${activatedTotal} activated, ` +
      `${rows.length} cohort(s)` +
      (excludedSynthetic > 0 ? `, ${excludedSynthetic} synthetic excluded` : "") +
      (truncated ? " [TRUNCATED]" : ""),
  );

  return summary;
}
