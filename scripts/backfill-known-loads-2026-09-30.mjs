#!/usr/bin/env node
/**
 * One-time repair on the owner's account, 2026-09-30 — loads the owner stated
 * outright, applied to every PERFORMED set of the exercise that stored none:
 *
 *   Plank                     0   (bodyweight; June–July rows already store 0)
 *   Chest Dip / Dips          0   (no assistance — owner: "chest dips are 0")
 *   Skull Crusher             15  (owner: "always 15")
 *
 * A performed set is one with `reps` or `durationSec`; the 06-15 plank
 * scaffold rows carry neither and are left alone. No duration is invented —
 * 09-29 has no plank and gets none. Also sets the Push Day template's Skull
 * Crusher `targetLoad` to 15, so the load cell no longer starts empty (the
 * blank that produced 09-24).
 *
 * REFUSES if a performed set already stores a DIFFERENT load (the owner's rule
 * would then contradict the record), or a touched session is still active.
 * Dry run unless `--apply`; re-runs are no-ops.
 *
 *   node scripts/backfill-known-loads-2026-09-30.mjs --email gabrielandresbermudez@gmail.com [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const TZ = 'America/Puerto_Rico';
/** exerciseId → [label, load in lb]. */
const LOADS = {
  NjZljASOpsZXzS1o2huS: ['Plank', 0],
  ItWpGxZ72I8dRPEaNXRa: ['Chest Dip', 0],
  EyDTWnfO4WrbYDbDkxrk: ['Skull Crusher', 15],
};
const TEMPLATE_TARGET = { template: 'Push Day', exerciseId: 'EyDTWnfO4WrbYDbDkxrk', load: 15 };

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
let uid = arg('uid');
const email = arg('email');
if (!email && !uid) { console.error('usage: … (--email <email> | --uid <uid>) [--apply]'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);
const localDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const performed = (s) => s.reps != null || s.durationSec != null;

const refusals = [];
const writes = [];
const docs = (await user.collection('workoutSessions').get()).docs
  .sort((a, b) => a.data().timestamp.toMillis() - b.data().timestamp.toMillis());
for (const doc of docs) {
  const data = doc.data();
  const day = localDate(data.timestamp.toDate());
  const notes = [];
  const exercises = (data.exercises ?? []).map((ex) => {
    const rule = LOADS[ex.exerciseId];
    if (!rule) return ex;
    const [label, load] = rule;
    let n = 0;
    const sets = ex.sets.map((s) => {
      if (!performed(s)) return s;
      if (s.weight == null) { n++; return { ...s, weight: load }; }
      if (s.weight !== load) refusals.push(`${day} ${label}: a set stores ${s.weight}, the rule says ${load} — decide by hand`);
      return s;
    });
    if (n) notes.push(`${label} ${n} set(s) → ${load}`);
    return n ? { ...ex, sets } : ex;
  });
  if (!notes.length) continue;
  if (data.status !== 'completed') { refusals.push(`${day} ${doc.id} is ${data.status}`); continue; }
  console.log(`${apply ? 'WRITE' : 'WOULD'} ${day} ${doc.id}: ${notes.join('; ')}`);
  writes.push({ ref: doc.ref, data: { exercises } });
}

const tpl = (await user.collection('workoutTemplates').get()).docs.filter((d) => d.data().name === TEMPLATE_TARGET.template);
if (tpl.length !== 1) refusals.push(`template "${TEMPLATE_TARGET.template}": expected one, found ${tpl.length}`);
else {
  const t = tpl[0];
  const row = t.data().exercises.find((e) => e.exerciseId === TEMPLATE_TARGET.exerciseId);
  if (!row) refusals.push(`template ${TEMPLATE_TARGET.template}: no Skull Crusher row`);
  else if (row.targetLoad === TEMPLATE_TARGET.load) console.log('template: Skull Crusher targetLoad already 15');
  else if (row.targetLoad != null) refusals.push(`template: Skull Crusher targetLoad is ${row.targetLoad}, not empty — decide by hand`);
  else {
    console.log(`${apply ? 'WRITE' : 'WOULD'} template ${TEMPLATE_TARGET.template} / ${row.name}: targetLoad (none) → 15`);
    const exercises = t.data().exercises.map((e) => (e.exerciseId === TEMPLATE_TARGET.exerciseId ? { ...e, targetLoad: TEMPLATE_TARGET.load } : e));
    writes.push({ ref: t.ref, data: { exercises } });
  }
}

for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length) { console.log('\nAborted: nothing written.'); process.exit(1); }
if (!writes.length) console.log('Nothing to do.');
else if (apply) {
  const batch = db.batch();
  for (const w of writes) batch.update(w.ref, w.data);
  await batch.commit();
  console.log(`\nApplied ${writes.length} write(s).`);
} else console.log('\nDry run — re-run with --apply.');
