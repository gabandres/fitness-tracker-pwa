#!/usr/bin/env node
/**
 * One-time repair on the owner's account, requested 2026-10-02: `rir: 0` on
 * the 2026-10-01 Push Day sets that stored none, and ONLY those.
 *
 *   Incline Dumbbell Press   ×6 (two clusters, 20 lb: 11/5/4, 11/4/4)
 *   Chest Dip (forward lean) ×3 (0 lb: 2/2/1)
 *
 * The key is ABSENT in Firestore (not null). Cause: set edits still queued in
 * the RN Firestore SDK's memory-only write queue died with a runtime restart,
 * and the next whole-array session write made it permanent — see
 * `apps/mobile/src/lib/active-session-journal.ts` and the CHANGELOG entry of
 * the same date. The owner confirmed every activation and mini set of that
 * session was taken to RIR 0.
 *
 * Also re-checks the 2026-09-29 Standing calf raise rows (25 lb: 12/5/4), which
 * the 09-30 backfill already set to 0 — a no-op unless something undid it.
 * They are matched BEFORE `template-updates-2026-10-02.mjs` relabels them, or
 * under their new name after it; either order works.
 *
 * Each set is matched on exercise id + position AND on the reps/weight the
 * owner reported, so a session that is not the one described is refused
 * rather than patched. Dry run unless `--apply`. REFUSES (exit 1, nothing
 * written) when a target set's reps/weight differ, a set already carries a
 * DIFFERENT rir, or the session is not completed. A value already 0 is a
 * no-op, so re-runs are safe.
 *
 *   node scripts/backfill-2026-10-02.mjs --email gabrielandresbermudez@gmail.com
 *   node scripts/backfill-2026-10-02.mjs --email gabrielandresbermudez@gmail.com --apply
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

/** session id → exerciseId(s) → the sets as reported: [kind, reps, weight]. */
const TARGETS = [
  {
    session: 'IrEJXlb9x9Fb11y0a0ck', // 2026-10-01 Push Day
    label: '2026-10-01 Push Day',
    exercises: {
      ngF9959fQPGTYUHXpigC: {
        name: 'Incline Dumbbell Press',
        sets: [
          ['activation', 11, 20], ['mini', 5, 20], ['mini', 4, 20],
          ['activation', 11, 20], ['mini', 4, 20], ['mini', 4, 20],
        ],
      },
      ItWpGxZ72I8dRPEaNXRa: {
        name: 'Chest Dip (forward lean)',
        sets: [['activation', 2, 0], ['mini', 2, 0], ['mini', 1, 0]],
      },
    },
  },
  {
    session: 'HFHuqsjIQKM0xvq9zusO', // 2026-09-29 Leg Day
    label: '2026-09-29 Leg Day',
    exercises: {
      // Either id: before or after the relabel to Single-leg DB calf raise.
      WJZiGzkNnu2wft3wQMV5: {
        name: 'Standing calf raise',
        alsoUnder: 'Single-leg DB calf raise',
        sets: [['activation', 12, 25], ['mini', 5, 25], ['mini', 4, 25]],
      },
    },
  },
];

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: node scripts/backfill-2026-10-02.mjs (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const refusals = [];
const writes = [];

for (const t of TARGETS) {
  const ref = user.collection('workoutSessions').doc(t.session);
  const snap = await ref.get();
  if (!snap.exists) { refusals.push(`${t.label}: session ${t.session} not found`); continue; }
  const data = snap.data();
  if (data.status !== 'completed') { refusals.push(`${t.label}: status is ${data.status} — the device writes an active session back whole`); continue; }
  let changed = false;
  const exercises = data.exercises.map((ex, exIdx) => {
    const target = Object.entries(t.exercises).find(([id, spec]) =>
      ex.exerciseId === id || (spec.alsoUnder && ex.name === spec.alsoUnder));
    if (!target) return ex;
    const [, spec] = target;
    if (ex.sets.length !== spec.sets.length) {
      refusals.push(`${t.label} / ${ex.name}: ${ex.sets.length} sets stored, ${spec.sets.length} reported`);
      return ex;
    }
    const sets = ex.sets.map((s, j) => {
      const [kind, reps, weight] = spec.sets[j];
      const where = `${t.label} / ${ex.name} [ex ${exIdx}] set ${j} (${kind} ${reps} @ ${weight})`;
      if (s.kind !== kind || s.reps !== reps || s.weight !== weight) {
        refusals.push(`${where}: stored ${s.kind} ${s.reps} @ ${s.weight} — not the reported set`);
        return s;
      }
      if (s.rir === 0) { console.log(`${where}: rir already 0`); return s; }
      if (s.rir != null) { refusals.push(`${where}: rir is ${s.rir}, not absent — decide by hand`); return s; }
      console.log(`${apply ? 'SET  ' : 'WOULD'} ${where}: rir (absent) → 0`);
      changed = true;
      return { ...s, rir: 0 };
    });
    return { ...ex, sets };
  });
  for (const [id, spec] of Object.entries(t.exercises)) {
    if (!data.exercises.some((ex) => ex.exerciseId === id || (spec.alsoUnder && ex.name === spec.alsoUnder))) {
      refusals.push(`${t.label}: no "${spec.name}" (${id}) in the session`);
    }
  }
  if (changed) writes.push({ label: `workoutSessions/${t.session} (${t.label})`, ref, data: { exercises, updatedAt: Timestamp.now() } });
}

console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
if (refusals.length > 0) {
  console.log('\nAborted: nothing written (refusals above).');
  process.exit(1);
}
if (writes.length === 0) {
  console.log('Nothing to do.');
} else if (apply) {
  const batch = db.batch();
  for (const w of writes) batch.update(w.ref, w.data);
  await batch.commit();
  console.log(`Applied ${writes.length} write(s): ${writes.map((w) => w.label).join(', ')}`);
} else {
  console.log(`${writes.length} write(s) pending — dry run, re-run with --apply.`);
}
