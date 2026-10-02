#!/usr/bin/env node
/**
 * One-time template edit on the owner's account, requested 2026-10-02,
 * effective from the next session. Templates are USER DATA
 * (`users/{uid}/workoutTemplates`), not seed files, so this is the edit.
 *
 * Push Day
 *   - "Chest Dip (forward lean)" → NEW "Deficit Push-up" in the same slot:
 *     bodyweight (targetLoad 0), one cluster. The dip's catalog doc and every
 *     logged dip set are untouched; it simply leaves the template.
 *   - Seated DB Shoulder Press → 70. (The owner said 60 → 70; the template
 *     row says 50 — the 10-01 session ran 60 because the engine recommended
 *     it. The target is 70 either way.)
 *   - DB Flat Press 20 → 25 (one `targetLoad` covers both clusters).
 *   - HOLD, verified not written: Incline 20, Overhead DB Extension 30,
 *     Skull Crusher 15, DB Lateral Raise 15.
 * Leg Day
 *   - "Plank" leaves the template (its history stays).
 *   - "Standing calf raise" → NEW "Single-leg DB calf raise" in the same slot:
 *     25 lb, two clusters (one per leg), cue "lengthened partial: full
 *     stretch + 1–2 s pause; top at level". A new exercise, NOT a rename: the
 *     old one was two-leg, the new one is ~1.8× the load per calf, and
 *     progress must not join across them (`exercise-relabel.test.ts`).
 *   - NEW "Hanging Knee Raise" directly after Weighted Floor Crunch:
 *     bodyweight (targetLoad 0), one cluster.
 *   - Weighted Floor Crunch: VERIFIED at 30, two clusters; not written.
 * History
 *   - The three 2026-09-29 "Standing calf raise" rows (25 lb × 12/5/4) were
 *     one leg of the single-leg raise. That session's entry moves to the new
 *     exercise — `exerciseId` AND `name`, sets untouched. No second-leg
 *     cluster is created. Every earlier calf-raise session keeps the old id.
 *
 * Catalog docs are created in the shape `toExerciseDoc` writes. Re-runnable:
 * an exercise that already exists by name is reused, a template already in
 * the target shape is left alone, the relabel is skipped once applied.
 *
 * Dry run unless `--apply`. REFUSES (exit 1, nothing written) when a held
 * value or a row this script replaces is not what it expects (someone edited
 * it since — decide by hand), when the 09-29 rows are not 25 × 12/5/4, or when
 * a session is still active (the device writes it back whole).
 *
 *   node scripts/template-updates-2026-10-02.mjs --email gabrielandresbermudez@gmail.com [--apply]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

const ID = {
  shoulderPress: 'He4o7qVWRftiPneaXjiV',
  flatPress: 'ud6fE363QklE3qXYxLw3',
  incline: 'ngF9959fQPGTYUHXpigC',
  dip: 'ItWpGxZ72I8dRPEaNXRa',
  overhead: 'AAHHWXTA7UtbNWZbcf7z',
  skull: 'EyDTWnfO4WrbYDbDkxrk',
  lateral: 'BGyAEJU6i5nN6AjXRU1g',
  calf: 'WJZiGzkNnu2wft3wQMV5',
  crunch: 'x3G0Speg04GclIOdKHAl',
  plank: 'NjZljASOpsZXzS1o2huS',
};
const RELABEL_SESSION = 'HFHuqsjIQKM0xvq9zusO'; // 2026-09-29 Leg Day

const ONE_CLUSTER = [
  { group: 1, kind: 'activation' }, { group: 1, kind: 'mini' }, { group: 1, kind: 'mini' },
];
const TWO_CLUSTERS = [
  ...ONE_CLUSTER,
  { group: 2, kind: 'activation' }, { group: 2, kind: 'mini' }, { group: 2, kind: 'mini' },
];
const CALF_CUE = 'lengthened partial: full stretch + 1–2 s pause; top at level';

/** New catalog entries, keyed for lookup below. */
const NEW_EXERCISES = {
  pushup: { name: 'Deficit Push-up', muscles: ['chest', 'triceps', 'shoulders'], defaultCues: [], logStyle: 'weight-reps' },
  kneeRaise: { name: 'Hanging Knee Raise', muscles: ['core'], defaultCues: [], logStyle: 'weight-reps' },
  calf: { name: 'Single-leg DB calf raise', muscles: ['calves'], defaultCues: [CALF_CUE], logStyle: 'weight-reps' },
};

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: node scripts/template-updates-2026-10-02.mjs (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const refusals = [];
const say = (s) => console.log(`${apply ? 'SET  ' : 'WOULD'} ${s}`);
const batch = db.batch();
let writeCount = 0;
const now = Timestamp.now();

// ── Catalog ─────────────────────────────────────────────────────────────
const catalog = (await user.collection('exercises').get()).docs;
/** key → { id, name } for each new exercise, existing or about to be created. */
const made = {};
for (const [key, ex] of Object.entries(NEW_EXERCISES)) {
  const existing = catalog.find((d) => String(d.data().name).trim().toLowerCase() === ex.name.toLowerCase());
  if (existing) {
    console.log(`catalog: "${ex.name}" already exists as ${existing.id} — reused`);
    made[key] = { id: existing.id, name: existing.data().name };
    continue;
  }
  const ref = user.collection('exercises').doc();
  say(`catalog: create "${ex.name}" (${ref.id}) ${JSON.stringify({ muscles: ex.muscles, logStyle: ex.logStyle, defaultCues: ex.defaultCues })}`);
  batch.set(ref, { ...ex, createdAt: now });
  writeCount++;
  made[key] = { id: ref.id, name: ex.name };
}

// ── Templates ───────────────────────────────────────────────────────────
const templates = (await user.collection('workoutTemplates').get()).docs;
const one = (name) => {
  const hits = templates.filter((d) => d.data().name === name);
  if (hits.length !== 1) { refusals.push(`template "${name}": expected one, found ${hits.length}`); return null; }
  return hits[0];
};
const rowName = (r) => `${r.name} (${r.exerciseId})`;
const show = (rows) => rows.map((r) => `${r.name}${r.targetLoad != null ? ` @${r.targetLoad}` : ''} ×${(r.plannedSets ?? []).filter((p) => p.kind === 'activation').length}c`).join(' | ');

function expectLoad(tpl, rows, id, load) {
  const r = rows.find((x) => x.exerciseId === id);
  if (!r) { refusals.push(`${tpl}: no row ${id}`); return null; }
  if (r.targetLoad !== load) { refusals.push(`${tpl} / ${rowName(r)}: targetLoad is ${r.targetLoad}, expected ${load}`); return null; }
  return r;
}

function edit(tplName, fn) {
  const doc = one(tplName);
  if (!doc) return;
  const before = doc.data().exercises;
  const after = fn(before);
  if (!after) return; // refused inside
  if (JSON.stringify(before) === JSON.stringify(after)) { console.log(`${tplName}: already in the target shape`); return; }
  console.log(`\n${tplName} BEFORE: ${show(before)}`);
  console.log(`${tplName} AFTER : ${show(after)}`);
  say(`workoutTemplates/${doc.id} (${tplName}) exercises (${before.length} → ${after.length} rows)`);
  batch.update(doc.ref, { exercises: after, updatedAt: now });
  writeCount++;
}

edit('Push Day', (rows) => {
  // Held values: verify, never write.
  for (const [id, load] of [[ID.incline, 20], [ID.overhead, 30], [ID.skull, 15], [ID.lateral, 15]]) {
    if (!expectLoad('Push Day', rows, id, load)) return null;
  }
  let out = rows.map((r) => {
    if (r.exerciseId === ID.shoulderPress) {
      if (r.targetLoad === 70) return r;
      if (r.targetLoad !== 50 && r.targetLoad !== 60) { refusals.push(`Push Day / ${rowName(r)}: targetLoad is ${r.targetLoad}, expected 50 or 60`); return r; }
      say(`Push Day / ${r.name}: targetLoad ${r.targetLoad} → 70`);
      return { ...r, targetLoad: 70 };
    }
    if (r.exerciseId === ID.flatPress) {
      if (r.targetLoad === 25) return r;
      if (r.targetLoad !== 20) { refusals.push(`Push Day / ${rowName(r)}: targetLoad is ${r.targetLoad}, expected 20`); return r; }
      say(`Push Day / ${r.name}: targetLoad 20 → 25 (both clusters)`);
      return { ...r, targetLoad: 25 };
    }
    if (r.exerciseId === ID.dip) {
      say(`Push Day / slot ${rows.indexOf(r)}: "${r.name}" → "${made.pushup.name}" (targetLoad 0, 1 cluster)`);
      return {
        exerciseId: made.pushup.id,
        name: made.pushup.name,
        logStyle: 'weight-reps',
        targetLoad: 0,
        cues: [],
        plannedSets: ONE_CLUSTER,
      };
    }
    return r;
  });
  if (!rows.some((r) => r.exerciseId === ID.dip) && !rows.some((r) => r.exerciseId === made.pushup.id)) {
    refusals.push('Push Day: neither the dip nor the push-up is in the template');
  }
  return out;
});

edit('Leg Day', (rows) => {
  const crunch = rows.find((r) => r.exerciseId === ID.crunch);
  if (!crunch) { refusals.push('Leg Day: no Weighted Floor Crunch row'); return null; }
  const crunchClusters = crunch.plannedSets.filter((p) => p.kind === 'activation').length;
  if (crunch.targetLoad !== 30 || crunchClusters !== 2) {
    refusals.push(`Leg Day / Weighted Floor Crunch: ${crunch.targetLoad} lb × ${crunchClusters} clusters, expected 30 × 2`);
    return null;
  }
  console.log('Leg Day / Weighted Floor Crunch: confirmed 30 lb, 2 clusters');
  const out = [];
  for (const r of rows) {
    if (r.exerciseId === ID.plank) { say(`Leg Day: remove "${r.name}" (history kept)`); continue; }
    if (r.exerciseId === ID.calf) {
      say(`Leg Day / slot ${out.length}: "${r.name}" → "${made.calf.name}" (25 lb, 2 clusters = one per leg)`);
      out.push({
        exerciseId: made.calf.id,
        name: made.calf.name,
        logStyle: 'weight-reps',
        targetLoad: 25,
        cues: [CALF_CUE],
        plannedSets: TWO_CLUSTERS,
      });
      continue;
    }
    out.push(r);
    if (r.exerciseId === ID.crunch && !rows.some((x) => x.exerciseId === made.kneeRaise.id)) {
      say(`Leg Day: insert "${made.kneeRaise.name}" after "${r.name}" (targetLoad 0, 1 cluster)`);
      out.push({
        exerciseId: made.kneeRaise.id,
        name: made.kneeRaise.name,
        logStyle: 'weight-reps',
        targetLoad: 0,
        cues: [],
        plannedSets: ONE_CLUSTER,
      });
    }
  }
  return out;
});

// ── 09-29 relabel ───────────────────────────────────────────────────────
{
  const ref = user.collection('workoutSessions').doc(RELABEL_SESSION);
  const snap = await ref.get();
  const data = snap.data();
  if (!snap.exists) refusals.push(`session ${RELABEL_SESSION} not found`);
  else if (data.status !== 'completed') refusals.push(`session ${RELABEL_SESSION} is ${data.status}`);
  else if (data.exercises.some((e) => e.exerciseId === made.calf.id)) console.log('\n09-29: already relabeled');
  else {
    const idx = data.exercises.findIndex((e) => e.exerciseId === ID.calf);
    const ex = data.exercises[idx];
    const shape = ex?.sets.map((s) => `${s.kind} ${s.reps} @ ${s.weight}`).join(', ');
    const want = 'activation 12 @ 25, mini 5 @ 25, mini 4 @ 25';
    if (idx < 0) refusals.push('09-29: no Standing calf raise entry');
    else if (shape !== want) refusals.push(`09-29 / Standing calf raise: stored ${shape}, expected ${want}`);
    else {
      say(`\n09-29 Leg Day [ex ${idx}]: "${ex.name}" (${ID.calf}) → "${made.calf.name}" (${made.calf.id}); sets unchanged: ${shape}`);
      const exercises = data.exercises.map((e, i) => (i === idx ? { ...e, exerciseId: made.calf.id, name: made.calf.name } : e));
      batch.update(ref, { exercises, updatedAt: now });
      writeCount++;
    }
  }
}

// No ACTIVE session may be open: the device would write its whole copy back.
const active = (await user.collection('workoutSessions').where('status', '==', 'active').get()).docs;
if (active.length) refusals.push(`an active session is open (${active.map((d) => d.id).join(', ')}) — finish it first`);

console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length > 0) {
  console.log('\nAborted: nothing written (refusals above).');
  process.exit(1);
}
if (writeCount === 0) console.log('Nothing to do.');
else if (apply) {
  // One batch: the catalog docs the templates point at must exist when they do.
  await batch.commit();
  console.log(`Applied ${writeCount} write(s).`);
} else {
  console.log(`${writeCount} write(s) pending — dry run, re-run with --apply.`);
}
