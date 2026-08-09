#!/usr/bin/env node
/**
 * Ground-truth companion to the Maestro regression suite
 * (`apps/mobile/.maestro/regression/`). The suite's screen asserts prove what
 * RENDERED; this proves what Firestore actually HOLDS — the two halves of the
 * e2e flows 11–13 (log → edit → delete), and the janitor for what they leave
 * behind. Runs from the machine with ADC (the Windows workstation), while
 * Maestro runs on `ignia-mac`; the interleave is documented in the suite's
 * coverage.md.
 *
 * Writes to PRODUCTION Firestore, admin SDK, same guardrails as
 * seed-demo-account.mjs: the email must contain demo|test|review|appstore, and
 * every mutation is scoped to that one account.
 *
 *   node scripts/qa-regression-verify.mjs snapshot     --email qa-test@ignia.fit
 *   node scripts/qa-regression-verify.mjs cleanup      --email qa-test@ignia.fit [--label 'QA E2E Sandwich']
 *   node scripts/qa-regression-verify.mjs set-locale   --email qa-test@ignia.fit --locale en
 *   node scripts/qa-regression-verify.mjs create-empty --email qa-test-empty@ignia.fit --password '…' [--unverified]
 *   node scripts/qa-regression-verify.mjs set-verified --email qa-test-empty@ignia.fit
 *   node scripts/qa-regression-verify.mjs reset-empty  --email qa-test-empty@ignia.fit
 *
 * `snapshot` prints JSON: today's dailyLogs rows (id, label, calories,
 * protein), water flOz, sleep hours, preset labels, preferredLocale. Compare
 * it before/after a flow; the diff is the verdict.
 *
 * `reset-empty` deletes the account's PROFILE DOC and every subcollection doc
 * so the fresh-account arc (regression/empty/) can run again — the arc is
 * one-shot per fresh account by nature (onboarding only shows when no profile
 * exists). It refuses to touch an account whose email lacks the QA marker.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const email = arg('email');
const label = arg('label') ?? 'QA E2E Sandwich';

const CMDS = ['snapshot', 'cleanup', 'set-locale', 'create-empty', 'set-verified', 'reset-empty'];
if (!CMDS.includes(cmd) || !email) {
  console.error(`Usage: qa-regression-verify.mjs <${CMDS.join('|')}> --email <qa address> [options]`);
  process.exit(1);
}
// Same typo guard as seed-demo-account.mjs — these commands mutate an account.
if (!/(demo|test|review|appstore)/i.test(email)) {
  console.error(`Refusing: "${email}" has no demo/test/review/appstore marker — this tool only touches QA accounts.`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function uidOf(e) {
  const u = await auth.getUserByEmail(e);
  return u.uid;
}

/** Today's log rows: dailyLogs is timestamp-keyed, so filter on the local-day
 *  window rather than a doc-id prefix. */
async function todaysLogs(uid) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const snap = await db
    .collection(`users/${uid}/dailyLogs`)
    .where('timestamp', '>=', Timestamp.fromDate(start))
    .where('timestamp', '<', Timestamp.fromDate(end))
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, label: x.mealLabel ?? null, calories: x.calories ?? null, protein: x.protein ?? null };
  });
}

if (cmd === 'snapshot') {
  const uid = await uidOf(email);
  const key = todayKey();
  const [entries, water, sleep, presets, profile] = await Promise.all([
    todaysLogs(uid),
    db.doc(`users/${uid}/dailyWater/${key}`).get(),
    db.doc(`users/${uid}/dailySleep/${key}`).get(),
    db.collection(`users/${uid}/presets`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  console.log(
    JSON.stringify(
      {
        uid,
        date: key,
        entries,
        waterFlOz: water.exists ? (water.data().flOz ?? null) : null,
        sleepHours: sleep.exists ? (sleep.data().hours ?? null) : null,
        presets: presets.docs.map((d) => d.data().name ?? d.id),
        preferredLocale: profile.exists ? (profile.data().preferredLocale ?? 'en') : null,
        hasProfile: profile.exists,
      },
      null,
      2,
    ),
  );
} else if (cmd === 'cleanup') {
  const uid = await uidOf(email);
  const entries = (await todaysLogs(uid)).filter((e) => e.label === label);
  for (const e of entries) await db.doc(`users/${uid}/dailyLogs/${e.id}`).delete();
  const presets = await db.collection(`users/${uid}/presets`).where('name', '==', label).get();
  for (const d of presets.docs) await d.ref.delete();
  console.log(`✓ removed ${entries.length} entries + ${presets.size} presets labeled "${label}"`);
} else if (cmd === 'set-locale') {
  const locale = arg('locale');
  if (locale !== 'en' && locale !== 'es-PR') {
    console.error('--locale must be en or es-PR');
    process.exit(1);
  }
  const uid = await uidOf(email);
  await db.doc(`users/${uid}`).set({ preferredLocale: locale }, { merge: true });
  console.log(`✓ ${email} preferredLocale → ${locale}`);
} else if (cmd === 'create-empty') {
  const password = arg('password');
  if (!password) {
    console.error('--password required');
    process.exit(1);
  }
  let uid;
  try {
    uid = await uidOf(email);
    console.log(`account exists (uid ${uid}) — leaving auth as-is`);
  } catch {
    const u = await auth.createUser({ email, password, emailVerified: !has('unverified') });
    uid = u.uid;
    console.log(`✓ created ${email} (uid ${uid}, verified: ${!has('unverified')}) — NO docs seeded`);
  }
} else if (cmd === 'set-verified') {
  const uid = await uidOf(email);
  await auth.updateUser(uid, { emailVerified: true });
  console.log(`✓ ${email} emailVerified → true`);
} else if (cmd === 'reset-empty') {
  const uid = await uidOf(email);
  const cols = await db.doc(`users/${uid}`).listCollections();
  let n = 0;
  for (const col of cols) {
    const docs = await col.listDocuments();
    for (const ref of docs) {
      await ref.delete();
      n++;
    }
  }
  await db.doc(`users/${uid}`).delete();
  console.log(`✓ ${email} reset to fresh: profile + ${n} subcollection docs deleted`);
}
