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
 *   node scripts/qa-regression-verify.mjs create-empty --email qa-test-empty@ignia.fit [--password '…'] [--unverified]
 *       omit --password and one is generated, printed, and set even if the account already exists
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
import { randomBytes } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
// Node 24 strips TS types natively, so core's locale list is importable here
// with no build step — the same list the app's language picker is built from.
import { LOCALES as CORE_LOCALES } from '../packages/core/src/locales.ts';

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

  // Train leftovers. Flows 16 and 18 each create a catalog exercise or a
  // template and delete it in their own tail — and on 2026-08-23 flow 16's
  // teardown was the ONLY step of it that failed, which left "QA Term Check"
  // sitting in the account's exercise list. That is the state the flow's own
  // header warns about ("delete it by hand"), and until now this tool could
  // not, so the documented recovery did not cover the documented failure.
  //
  // Matched by NAME PREFIX rather than by the `--label` value: the two flows
  // use their own names ("QA Term Check", "QA Tpl Check"), not the meal label,
  // and a QA account has no legitimate row starting with "QA ".
  let train = 0;
  for (const coll of ['exercises', 'workoutTemplates']) {
    const snap = await db.collection(`users/${uid}/${coll}`).get();
    for (const d of snap.docs) {
      if (String(d.data()?.name ?? '').startsWith('QA ')) {
        await d.ref.delete();
        train++;
      }
    }
  }
  console.log(
    `✓ removed ${entries.length} entries + ${presets.size} presets labeled "${label}"` +
    `, and ${train} "QA " exercise/template row(s)`,
  );
} else if (cmd === 'set-locale') {
  const locale = arg('locale');
  // Derived from core's registry, not a hardcoded pair. This accepted only
  // `en` and `es-PR` until 2026-08-23, the day Portuguese shipped — and that
  // was the day it was needed: the device was found sitting in pt-BR, and the
  // documented recovery for a locale-stranded account could not express the
  // locale it was stranded in. `packages/core/src/locales.ts` is the list both
  // frontends already derive their pickers from, so a fourth language makes
  // this tool work with no edit here at all.
  const allowed = CORE_LOCALES.map((l) => l.tag);
  if (!allowed.includes(locale)) {
    console.error(`--locale must be one of: ${allowed.join(', ')}`);
    process.exit(1);
  }
  const uid = await uidOf(email);
  await db.doc(`users/${uid}`).set({ preferredLocale: locale }, { merge: true });
  console.log(`✓ ${email} preferredLocale → ${locale}`);
} else if (cmd === 'create-empty') {
  // --password is OPTIONAL now, and an existing account has its password RESET
  // rather than left alone. Both changes close traps measured on 2026-08-18,
  // when the fresh-account arc ran for the first time and cost three cycles to
  // the same symptom — the app's own `signin-error`, "Wrong email or password",
  // which is indistinguishable from having typed the wrong password.
  //
  //   1. The old code printed "leaving auth as-is" when the account existed,
  //      so a caller who passed a NEW password got an account that still had
  //      the OLD one. Nothing said so; the run failed at sign-in, in Maestro,
  //      several minutes later.
  //   2. A caller-supplied password went straight to Firebase, which rejects
  //      it with `Missing password requirements: [Password must contain an
  //      upper case character]` — a server error for something checkable here.
  //   3. Generating one with `openssl rand -base64 18` piped through a newline
  //      strip that only removes LF leaves a CARRIAGE RETURN on Windows, so
  //      the account gets a password one invisible byte longer than the one
  //      Maestro later types.
  //
  // Generating it here removes all three: the value is known-good, known-clean,
  // and printed once so the caller can hand it to Maestro.
  const supplied = arg('password');
  if (supplied !== null && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(supplied.trim())) {
    console.error(
      'Refusing: --password must be 8+ chars with an upper case letter, a lower case letter and a digit.',
    );
    console.error('Firebase enforces this server-side and reports it as "Missing password requirements".');
    console.error('Omit --password to have one generated.');
    process.exit(1);
  }
  // .trim() is not cosmetic — see trap 3 above.
  const password = supplied === null ? `Qa1!${randomBytes(9).toString('hex')}` : supplied.trim();

  let uid;
  let created = false;
  try {
    uid = await uidOf(email);
  } catch {
    const u = await auth.createUser({ email, password, emailVerified: !has('unverified') });
    uid = u.uid;
    created = true;
  }
  if (!created) {
    // Idempotent: the password the caller is about to use must be the one the
    // account has, whether or not this invocation created it.
    await auth.updateUser(uid, { password, emailVerified: !has('unverified') });
  }
  console.log(
    `✓ ${created ? 'created' : 'reset'} ${email} (uid ${uid}, verified: ${!has('unverified')}) — NO docs seeded`,
  );
  if (supplied === null) console.log(`  password: ${password}`);
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
