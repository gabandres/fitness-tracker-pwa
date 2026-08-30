/**
 * #115 §0 — which Habits state does each account actually land in?
 *
 * The report was "sent to Trends, could not find the Fasting graph". Three
 * structurally different things can produce that symptom, and they need
 * completely different fixes:
 *
 *   BOTH   — sleep card AND fasting card → a tab strip that OPENS ON SLEEP
 *            (`trends.tsx:70`, usePersistedTab default 'sleep'). Fasting is one
 *            tap away and the tap is not discoverable. An affordance problem.
 *   SLEEP  — sleep card only → fasting renders as a stub row.
 *   FAST   — fasting card only → it renders standalone with its own header.
 *            Nothing is hidden; not this case.
 *   NEITHER— no card either side. There is NOTHING to find. No colour, contrast
 *            or icon change fixes this.
 *
 * Both cards need 3 qualifying entries inside a 14-day window
 * (FASTING_CARD_MIN_FASTS / SLEEP_CARD_MIN_NIGHTS, both 3).
 *
 * Deliberately AGGREGATE and PII-free: it prints counts per bucket, never an
 * email, uid or any per-user row. We do not need to identify one reporter to
 * learn whether the state she hit is the common one.
 *
 * Read-only. Touches nothing.
 *
 *   node scripts/trends-habits-states.mjs
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const WINDOW_DAYS = 14;
const MIN_ENTRIES = 3;

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const cutoff = Timestamp.fromDate(new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000));

  const users = await db.collection('users').get();

  const buckets = { both: 0, sleepOnly: 0, fastOnly: 0, neither: 0 };
  // Of the accounts with SOME fasting activity, how many fall short of the bar?
  let fastingPartial = 0;
  let fastingAny = 0;
  let scanned = 0;

  // Sleep documents are keyed BY DATE KEY (`users/{uid}/dailySleep/{dateKey}`,
  // `ledger.ts:432`) and carry `{ hours }` — there is no `date` FIELD. A range
  // query on one returns nothing for every account, which is indistinguishable
  // from "nobody logs sleep". YYYY-MM-DD sorts lexicographically, so the id is
  // the filter. This bit once already: the first run of this script reported
  // 0/43 on a `where('date', ...)` that could never match.
  const cutoffKey = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  for (const doc of users.docs) {
    scanned++;

    // `endedAt` is what the app's own fasting window filters and orders on
    // (`ledger.ts:799`) — a fast counts for the card when it ENDED in the
    // window, not when it started. Errors are NOT swallowed here.
    const fastsSnap = await doc.ref
      .collection('fasts')
      .where('endedAt', '>=', cutoff)
      .get();

    const sleepSnap = await doc.ref.collection('dailySleep').get();

    const fastCount = fastsSnap.size;
    // A night "with a reading" needs an actual number, not merely a document.
    const sleepCount = sleepSnap.docs.filter(
      (d) => d.id >= cutoffKey && typeof d.data()?.hours === 'number' && d.data().hours > 0,
    ).length;

    if (fastCount > 0) fastingAny++;
    if (fastCount > 0 && fastCount < MIN_ENTRIES) fastingPartial++;

    const hasFast = fastCount >= MIN_ENTRIES;
    const hasSleep = sleepCount >= MIN_ENTRIES;

    if (hasFast && hasSleep) buckets.both++;
    else if (hasSleep) buckets.sleepOnly++;
    else if (hasFast) buckets.fastOnly++;
    else buckets.neither++;
  }

  const pct = (n) => (scanned === 0 ? '0.0' : ((n / scanned) * 100).toFixed(1));

  console.log(`\n#115 §0 — Trends "Habits" state, ${scanned} accounts, ${WINDOW_DAYS}-day window\n`);
  console.log(`  BOTH cards  → tab strip, opens on SLEEP : ${buckets.both} (${pct(buckets.both)}%)`);
  console.log(`  SLEEP only  → fasting is a stub row     : ${buckets.sleepOnly} (${pct(buckets.sleepOnly)}%)`);
  console.log(`  FAST only   → renders standalone, fine  : ${buckets.fastOnly} (${pct(buckets.fastOnly)}%)`);
  console.log(`  NEITHER     → nothing to find at all    : ${buckets.neither} (${pct(buckets.neither)}%)`);
  console.log(`\n  Accounts with ANY fast in the window   : ${fastingAny}`);
  console.log(`  ...of those, short of the 3-fast bar    : ${fastingPartial}`);
  console.log(
    `\n  Reading: if BOTH dominates, #115 is an affordance problem (the tab default).\n` +
      `  If NEITHER dominates, the reporter was hunting something that could not be\n` +
      `  on screen, and no contrast change addresses it.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
