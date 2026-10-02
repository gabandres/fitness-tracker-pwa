#!/usr/bin/env node
/**
 * One-time repair on the owner's account, 2026-09-30: apply the bodyweight
 * representation decided that day (CONTEXT.md "Set load": 0 = no added load,
 * absent = unknown) to the Neutral-grip pull-up's history.
 *
 * The pull-up has never carried a positive load in any session, so a logged
 * set with no `weight` is the grey "0" placeholder left untyped, not an
 * unknown load. Every such set gets `weight: 0` — 08-12, 08-27, 09-09, 09-23
 * (set 3) and 09-30 at the time of writing.
 *
 * Deliberately NOT touched: Chest Dip / Dips (the load field is ASSISTANCE, so
 * a blank is genuinely unknown), Skull Crusher 09-24 (a real load, value
 * unknown), and any set without reps (a scaffold row, not a performed set).
 *
 * REFUSES if the pull-up ever stored a positive load (then blank ≠ 0), or if a
 * session holding one is still active. Dry run unless `--apply`; re-runs are
 * no-ops.
 *
 *   node scripts/backfill-bodyweight-zero-2026-09-30.mjs --email gabrielandresbermudez@gmail.com [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const TZ = 'America/Puerto_Rico';
const PULL_UP = 'GOGOcWJNC9q9aBmN3ENq';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
let uid = arg('uid');
const email = arg('email');
if (!email && !uid) { console.error('usage: … (--email <email> | --uid <uid>) [--apply]'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);
const localDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

const docs = (await db.collection('users').doc(uid).collection('workoutSessions').get()).docs
  .filter((d) => (d.data().exercises ?? []).some((e) => e.exerciseId === PULL_UP))
  .sort((a, b) => a.data().timestamp.toMillis() - b.data().timestamp.toMillis());

const loaded = docs.flatMap((d) => d.data().exercises.filter((e) => e.exerciseId === PULL_UP).flatMap((e) => e.sets))
  .filter((s) => (s.weight ?? 0) > 0);
if (loaded.length > 0) {
  console.log(`REFUSE  the pull-up has ${loaded.length} set(s) with a positive load — a blank is not 0 here`);
  process.exit(1);
}

const writes = [];
for (const doc of docs) {
  const data = doc.data();
  let n = 0;
  const exercises = data.exercises.map((ex) => (ex.exerciseId !== PULL_UP ? ex : {
    ...ex,
    sets: ex.sets.map((s) => (s.reps != null && s.weight == null ? (n++, { ...s, weight: 0 }) : s)),
  }));
  if (n === 0) continue;
  if (data.status !== 'completed') { console.log(`REFUSE  ${doc.id} is ${data.status}`); process.exit(1); }
  console.log(`${apply ? 'WRITE' : 'WOULD'} ${localDate(data.timestamp.toDate())} ${doc.id}: ${n} set(s) weight (absent) → 0`);
  writes.push({ ref: doc.ref, exercises });
}
if (apply && writes.length) {
  const batch = db.batch();
  for (const w of writes) batch.update(w.ref, { exercises: w.exercises });
  await batch.commit();
  console.log(`\nApplied ${writes.length} session write(s).`);
} else if (writes.length) console.log('\nDry run — re-run with --apply.');
else console.log('Nothing to do.');
