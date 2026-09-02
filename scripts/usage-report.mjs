#!/usr/bin/env node
/**
 * Read the product-analytics counters and answer the three questions they were
 * added for (`packages/core/src/usage-events.ts`).
 *
 *   node scripts/usage-report.mjs                 # last 30 days
 *   node scripts/usage-report.mjs --days 14
 *   node scripts/usage-report.mjs --json          # machine-readable
 *
 * Runs on ADC (`gcloud auth application-default login`, already configured on
 * this machine per CLAUDE.local.md), so it needs no key file and no Cloud
 * Function. Reads only — it never writes anything.
 *
 * ## Why a script and not a dashboard
 *
 * Cloud Scheduler's free tier is spent (`CLAUDE.md`), so a nightly rollup would
 * either cost money or displace an existing job. A read-only script the owner
 * runs when a question comes up costs nothing and answers the same question.
 * The document shape is designed for exactly this: one doc per user per day
 * means "how many people came back on day 3" is a range query, not a scan.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const daysArg = args.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(args[daysArg + 1]) : 30;

if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 365) {
  console.error('--days must be an integer between 1 and 365');
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}
const db = getFirestore();

/** Local-date keys, oldest first, ending today. Matches `localDateKey`. */
function dayKeys(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d);
    day.setDate(d.getDate() - i);
    out.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

const keys = dayKeys(DAYS);
const from = keys[0];
const to = keys[keys.length - 1];

// `day` is a stored field as well as half the doc id, precisely so this is a
// range query rather than a full-collection read.
const snap = await db
  .collection('usageEvents')
  .where('day', '>=', from)
  .where('day', '<=', to)
  .get();

/** uid → Set<day> */
const daysByUser = new Map();
/** day → { event: count } */
const byDay = new Map();
/** event → total */
const totals = {};
const platforms = {};

for (const docSnap of snap.docs) {
  const d = docSnap.data();
  const uid = d.uid;
  const day = d.day;
  if (typeof uid !== 'string' || typeof day !== 'string') continue;

  if (!daysByUser.has(uid)) daysByUser.set(uid, new Set());
  daysByUser.get(uid).add(day);

  if (!byDay.has(day)) byDay.set(day, {});
  const bucket = byDay.get(day);

  if (typeof d.platform === 'string') {
    platforms[d.platform] = (platforms[d.platform] ?? 0) + 1;
  }

  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== 'number') continue;
    bucket[k] = (bucket[k] ?? 0) + v;
    totals[k] = (totals[k] ?? 0) + v;
  }
}

/**
 * Retention by ACTIVE DAYS, not by cohort age.
 *
 * "Came back on day 3" needs a signup date this collection does not carry, and
 * inferring one from the first day seen is wrong for anyone who existed before
 * these counters shipped. Counting distinct active days per user answers the
 * question the roadmap actually asks — do people use it more than once — and is
 * honest about what the data supports.
 */
const activeDayHistogram = {};
for (const days of daysByUser.values()) {
  const n = days.size;
  const bucket = n === 1 ? '1 day' : n <= 3 ? '2-3 days' : n <= 7 ? '4-7 days' : '8+ days';
  activeDayHistogram[bucket] = (activeDayHistogram[bucket] ?? 0) + 1;
}

const report = {
  window: { from, to, days: DAYS },
  users: daysByUser.size,
  documents: snap.size,
  platforms,
  activeDays: activeDayHistogram,
  totals,
  funnel: {
    signup: totals.signup ?? 0,
    onboarding_start: totals.onboarding_start ?? 0,
    onboarding_step_body: totals.onboarding_step_body ?? 0,
    onboarding_step_plan: totals.onboarding_step_plan ?? 0,
    onboarding_complete: totals.onboarding_complete ?? 0,
    log_added: totals.log_added ?? 0,
  },
  offlineShare:
    (totals.log_added ?? 0) + (totals.log_queued_offline ?? 0) > 0
      ? Number(
          (
            ((totals.log_queued_offline ?? 0) /
              ((totals.log_added ?? 0) + (totals.log_queued_offline ?? 0))) *
            100
          ).toFixed(1),
        )
      : 0,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`\nIgnia usage — ${from} → ${to} (${DAYS} days)\n`);
console.log(`  users seen          ${report.users}`);
console.log(`  day-documents       ${report.documents}`);
console.log(`  platforms           ${JSON.stringify(report.platforms)}`);
console.log('\n  active days per user');
for (const [bucket, n] of Object.entries(report.activeDays)) {
  console.log(`    ${bucket.padEnd(10)} ${n}`);
}
console.log('\n  funnel');
console.log(`    signup                ${report.funnel.signup}   (email/password only — see usage-events.ts)`);
console.log(`    onboarding_start      ${report.funnel.onboarding_start}   (all providers; counters start 2026-08-31)`);
console.log(`    onboarding_step_body  ${report.funnel.onboarding_step_body}`);
console.log(`    onboarding_step_plan  ${report.funnel.onboarding_step_plan}`);
console.log(`    onboarding_complete   ${report.funnel.onboarding_complete}`);
console.log(`    log_added             ${report.funnel.log_added}`);
console.log('\n  all counters');
for (const [event, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  // `log_secs` is the catalogue's one DURATION (seconds spent inside the add
  // sheet / scan screen, since Android OTA 107 / iOS OTA 69). Summed like an
  // event it would top this list and read as a count; print it as time.
  if (event === 'log_secs') {
    console.log(`    ${event.padEnd(22)} ${n} s  (duration, not a count — secs/log lives in config/retention)`);
    continue;
  }
  console.log(`    ${event.padEnd(22)} ${n}`);
}
console.log(`\n  logs that had to be queued offline: ${report.offlineShare}%`);
console.log(
  '\n  Note: these counters start the day the analytics release shipped. An empty\n' +
    '  window means nobody on a build that carries them was active, not that\n' +
    '  nobody used the app.\n',
);
