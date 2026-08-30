/**
 * #115 §3 — before designing a water card, measure who could ever see one.
 *
 * The sibling script `trends-habits-states.mjs` settled §0 by measuring rather
 * than reasoning, and the answer reversed the ticket: 88% of accounts have
 * NEITHER habits card, so the empty state — not the chart — is what almost
 * everyone would meet. A water card inherits exactly that question and it must
 * be asked before the chart is drawn, not after.
 *
 * Buckets, against the same three-state contract the sleep and fasting cards
 * use (card / progress / stub row):
 *
 *   CARD     — {@link MIN_DAYS} or more days with water in the window. A chart
 *              can be drawn and it is worth drawing.
 *   PARTIAL  — some water logged, but under the bar. The progress state.
 *   NONE     — nothing in the window. The stub row, and the state that decides
 *              how much of this feature is empty-state design.
 *
 * Deliberately AGGREGATE and PII-free: counts per bucket, never an email, uid
 * or per-user row. Read-only; touches nothing.
 *
 * ## The read that is easy to get wrong, twice
 *
 * `users/{uid}/dailyWater/{dateKey}` keys the **document id** by date and
 * stores `{ flOz }` — there is no `date` FIELD, so a `where('date', ...)`
 * range returns nothing for every account and reads exactly like "nobody logs
 * water". That is the mistake the first run of the habits script made.
 *
 * And `flOz` is not the only field: documents predating the water-unit
 * migration carry `ml` instead (`packages/core/src/daily-scalars.ts`). Counting
 * `flOz` alone would under-report every long-lived account — the same shape of
 * silent-miss, one field along.
 *
 *   node scripts/trends-water-states.mjs
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const WINDOW_DAYS = 14;
/** Matches SLEEP_CARD_MIN_NIGHTS / FASTING_CARD_MIN_FASTS. */
const MIN_DAYS = 3;

/** Mirrors `readWaterFlOz` — the legacy `ml` branch included. */
function waterFlOz(data) {
  const flOz = data?.flOz;
  if (typeof flOz === 'number' && Number.isFinite(flOz)) return flOz;
  const ml = data?.ml;
  if (typeof ml === 'number' && Number.isFinite(ml)) return ml / 29.5735;
  return null;
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const cutoffKey = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const users = await db.collection('users').get();

  const buckets = { card: 0, partial: 0, none: 0 };
  let scanned = 0;
  let legacyMlAccounts = 0;
  // Distribution of the daily amounts, to check the strip's fixed ceiling is
  // not one a real day routinely clips against.
  const amounts = [];

  for (const doc of users.docs) {
    scanned++;

    const snap = await doc.ref.collection('dailyWater').get();

    let days = 0;
    let sawLegacy = false;
    for (const d of snap.docs) {
      if (d.id < cutoffKey) continue;
      const data = d.data();
      if (typeof data?.flOz !== 'number' && typeof data?.ml === 'number') sawLegacy = true;
      const flOz = waterFlOz(data);
      if (flOz != null && flOz > 0) {
        days++;
        amounts.push(flOz);
      }
    }
    if (sawLegacy) legacyMlAccounts++;

    if (days >= MIN_DAYS) buckets.card++;
    else if (days > 0) buckets.partial++;
    else buckets.none++;
  }

  const pct = (n) => (scanned === 0 ? '0.0' : ((n / scanned) * 100).toFixed(1));

  amounts.sort((a, b) => a - b);
  const at = (q) => (amounts.length ? amounts[Math.floor((amounts.length - 1) * q)] : 0);

  console.log(`\n#115 §3 — water on Trends, ${scanned} accounts, ${WINDOW_DAYS}-day window\n`);
  console.log(`  CARD    (>= ${MIN_DAYS} days logged) : ${buckets.card} (${pct(buckets.card)}%)`);
  console.log(`  PARTIAL (1-${MIN_DAYS - 1} days logged)  : ${buckets.partial} (${pct(buckets.partial)}%)`);
  console.log(`  NONE    (stub row)         : ${buckets.none} (${pct(buckets.none)}%)`);
  console.log(`\n  Accounts holding a legacy \`ml\` doc in the window: ${legacyMlAccounts}`);
  console.log(`\n  Logged days in the window: ${amounts.length}`);
  if (amounts.length) {
    console.log(
      `  fl oz per logged day — min ${amounts[0].toFixed(0)} · p50 ${at(0.5).toFixed(0)} · ` +
        `p90 ${at(0.9).toFixed(0)} · max ${amounts[amounts.length - 1].toFixed(0)}`,
    );
  }
  console.log(
    `\n  Reading: if NONE dominates the way it did for sleep/fasting, the empty\n` +
      `  state is the feature and the chart is the footnote. If CARD dominates,\n` +
      `  the chart is worth the care the fasting card needed. The p90 says\n` +
      `  whether a fixed strip ceiling clips real days.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
