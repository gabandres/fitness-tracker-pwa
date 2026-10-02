#!/usr/bin/env node
/**
 * One-time template edit on the owner's account, requested 2026-09-30,
 * effective from the next session. Two kinds of change:
 *
 *  1. **Target loads** (what a new session pre-fills — `templateToSessionExercises`
 *     copies `targetLoad` into every set's `weight`):
 *       Leg Day   Weighted Floor Crunch 25 → 30, Leg Extensions 60 → 80,
 *                 Leg Curls 70 → 80 (the load in use since 09-29; "keep 80")
 *       Pull Day  Seated row 90 → 100, Chest-supported DB row 30 → 35,
 *                 Neutral-grip pull-up (none) → 0
 *       Push Day  Chest Dip (forward lean) (none) → 0
 *     Standing calf raise and DB hammer curl are deliberately untouched.
 *     The two `0`s are the bodyweight representation chosen the same day
 *     (0 = no added load / no assistance; absent = unknown): without a target
 *     the load cell starts EMPTY and shows a grey "0" placeholder that looks
 *     exactly like a typed 0, which is how 09-23 and 09-30 stored nothing.
 *
 *  2. **Renames**, by `exerciseId` so history is preserved:
 *       9x3b6rmxlxJyWWSMat3w  Seated cable row → Seated Machine Row
 *       MVC1wLKBkRz7XYyKp79e  DB bicep curl    → Incline DB Curl 45°
 *     A name is stored THREE times — the catalog doc, each template row and
 *     each session's `name` snapshot — and the in-app catalog edit
 *     (`editExercise`) writes only the first. The export prints the session
 *     snapshot, which is why a catalog-only rename never shows up there. All
 *     three are written here. Progression history joins on `exerciseId`, which
 *     no step changes.
 *
 * Dry run unless `--apply`. REFUSES when a template row's current load is not
 * the one this script expects to replace (someone already edited it), when a
 * session is still active (the device writes it back whole), or when another
 * catalog exercise already carries a target name.
 *
 *   node scripts/template-updates-2026-09-30.mjs --email gabrielandresbermudez@gmail.com [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

/** template name → exerciseId → [expected current targetLoad, new targetLoad]. */
const LOADS = {
  'Leg Day': {
    x3G0Speg04GclIOdKHAl: [25, 30], // Weighted Floor Crunch
    hXvPQM7Dv6YvScYW7h2l: [60, 80], // Leg Extensions
    jZWYnikrGcdRG1adHXJ0: [70, 80], // Leg Curls
  },
  'Pull Day': {
    '9x3b6rmxlxJyWWSMat3w': [90, 100], // Seated row
    acs1BlQvTZdL97i5jXJv: [30, 35], // Chest-supported DB row
    GOGOcWJNC9q9aBmN3ENq: [undefined, 0], // Neutral-grip pull-up
  },
  'Push Day': {
    ItWpGxZ72I8dRPEaNXRa: [undefined, 0], // Chest Dip (forward lean)
  },
};
const RENAMES = {
  '9x3b6rmxlxJyWWSMat3w': 'Seated Machine Row',
  MVC1wLKBkRz7XYyKp79e: 'Incline DB Curl 45°',
};

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: node scripts/template-updates-2026-09-30.mjs (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const refusals = [];
const writes = [];
const say = (s) => console.log(`${apply ? 'SET  ' : 'WOULD'} ${s}`);

// ── Catalog ─────────────────────────────────────────────────────────────
const catalog = (await user.collection('exercises').get()).docs;
for (const [id, name] of Object.entries(RENAMES)) {
  const doc = catalog.find((d) => d.id === id);
  if (!doc) { refusals.push(`catalog: no exercise ${id}`); continue; }
  const clash = catalog.find((d) => d.id !== id && String(d.data().name).trim().toLowerCase() === name.toLowerCase());
  if (clash) { refusals.push(`catalog: "${name}" already exists as ${clash.id} — merge, don't rename`); continue; }
  if (doc.data().name === name) { console.log(`catalog ${id}: already "${name}"`); continue; }
  say(`catalog ${id}: "${doc.data().name}" → "${name}"`);
  writes.push({ label: `exercises/${id} name`, ref: doc.ref, data: { name } });
}

// ── Templates ───────────────────────────────────────────────────────────
const templates = (await user.collection('workoutTemplates').get()).docs;
for (const [tplName, loads] of Object.entries(LOADS)) {
  const tpl = templates.filter((d) => d.data().name === tplName);
  if (tpl.length !== 1) { refusals.push(`template "${tplName}": expected one, found ${tpl.length}`); continue; }
  const doc = tpl[0];
  let changed = false;
  const seen = new Set();
  const exercises = doc.data().exercises.map((ex) => {
    let next = ex;
    const load = loads[ex.exerciseId];
    if (load) {
      seen.add(ex.exerciseId);
      const [from, to] = load;
      if (ex.targetLoad === to) console.log(`${tplName} / ${ex.name}: targetLoad already ${to}`);
      else if (ex.targetLoad !== from) refusals.push(`${tplName} / ${ex.name}: targetLoad is ${ex.targetLoad}, expected ${from} — edited since; decide by hand`);
      else { say(`${tplName} / ${ex.name}: targetLoad ${from ?? '(none)'} → ${to}`); next = { ...next, targetLoad: to }; changed = true; }
    }
    const rename = RENAMES[ex.exerciseId];
    if (rename && ex.name !== rename) { say(`${tplName} row: "${ex.name}" → "${rename}"`); next = { ...next, name: rename }; changed = true; }
    return next;
  });
  for (const id of Object.keys(loads)) if (!seen.has(id)) refusals.push(`template "${tplName}": no row for ${id}`);
  if (changed) writes.push({ label: `workoutTemplates/${doc.id} (${tplName})`, ref: doc.ref, data: { exercises } });
}
// A rename must also reach any OTHER template that uses the exercise.
for (const doc of templates.filter((d) => !LOADS[d.data().name])) {
  const hit = doc.data().exercises.some((ex) => RENAMES[ex.exerciseId] && ex.name !== RENAMES[ex.exerciseId]);
  if (!hit) continue;
  const exercises = doc.data().exercises.map((ex) => (RENAMES[ex.exerciseId] ? { ...ex, name: RENAMES[ex.exerciseId] } : ex));
  say(`template "${doc.data().name}": rename rows`);
  writes.push({ label: `workoutTemplates/${doc.id} (${doc.data().name})`, ref: doc.ref, data: { exercises } });
}

// ── Session snapshots ───────────────────────────────────────────────────
const sessions = (await user.collection('workoutSessions').get()).docs;
const renamedIn = [];
for (const doc of sessions) {
  const data = doc.data();
  const touches = (data.exercises ?? []).some((ex) => RENAMES[ex.exerciseId] && ex.name !== RENAMES[ex.exerciseId]);
  if (!touches) continue;
  if (data.status !== 'completed') { refusals.push(`session ${doc.id} is ${data.status} — finish it first`); continue; }
  const exercises = data.exercises.map((ex) => (RENAMES[ex.exerciseId] ? { ...ex, name: RENAMES[ex.exerciseId] } : ex));
  renamedIn.push(doc.id);
  writes.push({ label: `workoutSessions/${doc.id} name snapshot`, ref: doc.ref, data: { exercises } });
}
say(`session name snapshots: ${renamedIn.length} session(s)`);

// ── Decide ──────────────────────────────────────────────────────────────
console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length > 0) {
  console.log('\nAborted: nothing written (refusals above).');
  process.exit(1);
}
if (apply) {
  // Batched: the renames must land together or the export shows two names.
  const batch = db.batch();
  for (const w of writes) batch.update(w.ref, w.data);
  await batch.commit();
  console.log(`\nApplied ${writes.length} write(s).`);
} else {
  console.log(`\n${writes.length} write(s) pending — dry run, re-run with --apply.`);
}
