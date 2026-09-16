#!/usr/bin/env node
/**
 * One-time GDPR Art. 17 cleanup: `usageEvents` documents belonging to accounts
 * that no longer exist in Firebase Auth.
 *
 * ## Why these exist
 *
 * `deleteAccount` (`functions/src/gdpr.ts`) walked `USER_SUBCOLLECTIONS`, which
 * can only reach children of `users/{uid}`. `usageEvents` is a TOP-LEVEL
 * collection keyed `<uid>_<YYYY-MM-DD>`, so nothing erased it — even though
 * `firestore.rules` has said since it was written that *"deletion is the
 * account-deletion path, which runs in the admin SDK and bypasses these
 * rules"*. The forward fix is `deleteUidKeyedTopLevel`, added 2026-09-16. This
 * script is for the accounts deleted BEFORE it, whose rows nothing will ever
 * revisit.
 *
 * ## The test it uses, and why that one
 *
 * A document is orphaned when `getUsers` says its uid no longer exists in
 * Firebase Auth. Deliberately NOT "has no `users/{uid}` document": a live
 * account can legitimately lack one (a signup that abandoned onboarding before
 * the profile write — five such accounts existed on 2026-09-16, all still
 * signed in), and deleting a living user's data because their onboarding is
 * incomplete would be a far worse bug than the one this fixes. Auth presence is
 * the only signal that means "this person still has an account".
 *
 * Dry run unless `--apply`. Refuses to act on a partial Auth answer.
 *
 *   node scripts/purge-orphan-usage-events.mjs
 *   node scripts/purge-orphan-usage-events.mjs --apply
 *
 * Auth: ADC (`gcloud auth application-default login`) or
 * GOOGLE_APPLICATION_CREDENTIALS. Same precedent as
 * `scripts/migrate-time-sets-duration.mjs`.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const apply = process.argv.includes('--apply');

/** `getUsers` takes at most 100 identifiers per call. */
const AUTH_BATCH = 100;

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

const snap = await db.collection('usageEvents').get();
const byUid = new Map();
let noUidField = 0;
for (const d of snap.docs) {
  const uid = d.data().uid;
  if (typeof uid !== 'string' || !uid) { noUidField++; continue; }
  const list = byUid.get(uid) ?? [];
  list.push(d);
  byUid.set(uid, list);
}

const uids = [...byUid.keys()];
console.log(`${apply ? '' : '[dry run] '}${snap.size} usageEvents doc(s) · ${uids.length} distinct uid(s)`);
if (noUidField > 0) {
  console.log(`  ${noUidField} doc(s) carry no uid field and are LEFT ALONE — they cannot be attributed to anyone.`);
}

// Ask Auth in batches. A uid missing from the response is a deleted account.
const alive = new Set();
for (let i = 0; i < uids.length; i += AUTH_BATCH) {
  const chunk = uids.slice(i, i + AUTH_BATCH);
  const res = await getAuth().getUsers(chunk.map((uid) => ({ uid })));
  for (const u of res.users) alive.add(u.uid);
  // `notFound` is the deleted set; anything else means the answer is partial
  // and deleting on it would be guessing.
  const accounted = res.users.length + res.notFound.length;
  if (accounted !== chunk.length) {
    console.error(`ABORT: Auth accounted for ${accounted} of ${chunk.length} uid(s) in a batch. Nothing written.`);
    process.exit(1);
  }
}

const orphanUids = uids.filter((u) => !alive.has(u));
const orphanDocs = orphanUids.flatMap((u) => byUid.get(u));

console.log(`\nalive in Auth : ${alive.size}`);
console.log(`deleted       : ${orphanUids.length}`);
for (const u of orphanUids) {
  const days = byUid.get(u).map((d) => d.data().day).filter(Boolean).sort();
  console.log(`  ${u}  ${byUid.get(u).length} doc(s)  ${days[0] ?? '?'}..${days[days.length - 1] ?? '?'}`);
}
console.log(`\norphaned docs : ${orphanDocs.length} of ${snap.size}`);

if (orphanDocs.length === 0) { console.log('\nnothing to purge.'); process.exit(0); }
if (!apply) { console.log('\n[dry run] re-run with --apply'); process.exit(0); }

let batch = db.batch();
let pending = 0;
for (const d of orphanDocs) {
  batch.delete(d.ref);
  if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
}
if (pending > 0) await batch.commit();
console.log(`\npurged ${orphanDocs.length} doc(s).`);
