#!/usr/bin/env node
/**
 * ADR-0039 recalibration flag.
 *
 * Every logged set on or before the cutoff (2026-09-15, inclusive, in the
 * owner's timezone) was collected under an uncalibrated RIR standard —
 * a logged RIR 2 was functionally RIR 4-5. The progression engine must not
 * derive a rep band from them, but they stay in history. This marks each such
 * set with `legacyEffortStandard: true`, once, idempotently; the app never
 * writes that field.
 *
 * Optionally (`--effort`) it also sets `effortStandard: 'rir1'` on the two
 * lifts the spec names — Smith squat and Seated Cable Row — matched by the
 * same name key the app dedupes with, so "Smith squat" and "Smith Squat" are
 * one lift.
 *
 *   node scripts/mark-legacy-effort-standard.mjs --uid <uid> [--dry-run] [--effort]
 *   node scripts/mark-legacy-effort-standard.mjs --all-users --dry-run
 *
 * Auth: ADC (`gcloud auth application-default login`) or
 * GOOGLE_APPLICATION_CREDENTIALS. Reads `timestamp` on
 * `users/{uid}/workoutSessions` — the session date the rules require.
 *
 * An ACTIVE session on the device is edited in memory and written back whole,
 * so a flag written here to an active session can be overwritten by the next
 * device write; the report lists any active session touched. Re-run after it
 * is finished if that happens.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
/** Inclusive cutoff date, end of day in the owner's timezone (AST, UTC-4). */
const CUTOFF_END = new Date('2026-09-15T23:59:59.999-04:00');
/** `Exercise.effortStandard = 'rir1'` targets, by `exerciseNameKey`. */
const RIR1_LIFTS = new Set(['smith squat', 'seated cable row']);

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const uidArg = arg('uid');
const allUsers = has('all-users');
const dryRun = has('dry-run');
const setEffort = has('effort');

if (!uidArg && !allUsers) {
  console.error('usage: node scripts/mark-legacy-effort-standard.mjs (--uid <uid> | --all-users) [--dry-run] [--effort]');
  process.exit(2);
}

// Same collapse as packages/core `exerciseNameKey` — kept inline because this
// is a plain .mjs script and core is TypeScript.
const nameKey = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~()]/g, '')
    .replace(/\s+/g, ' ');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

async function markUser(uid) {
  const snap = await db
    .collection('users').doc(uid).collection('workoutSessions')
    .where('timestamp', '<=', Timestamp.fromDate(CUTOFF_END))
    .get();

  let sessions = 0;
  let sessionsChanged = 0;
  let sets = 0;
  let setsFlagged = 0;
  const activeTouched = [];
  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending === 0) return;
    if (!dryRun) await batch.commit();
    batch = db.batch();
    pending = 0;
  };

  for (const doc of snap.docs) {
    sessions += 1;
    const data = doc.data();
    let changed = false;
    const exercises = (data.exercises ?? []).map((ex) => ({
      ...ex,
      sets: (ex.sets ?? []).map((s) => {
        sets += 1;
        if (s.legacyEffortStandard === true) return s;
        changed = true;
        setsFlagged += 1;
        return { ...s, legacyEffortStandard: true };
      }),
    }));
    if (!changed) continue;
    sessionsChanged += 1;
    if (data.status === 'active') activeTouched.push(doc.id);
    batch.update(doc.ref, { exercises });
    pending += 1;
    if (pending >= 400) await flush();
  }
  await flush();

  let effort = [];
  if (setEffort) {
    const cat = await db.collection('users').doc(uid).collection('exercises').get();
    for (const doc of cat.docs) {
      const name = doc.data().name;
      if (!RIR1_LIFTS.has(nameKey(name))) continue;
      const already = doc.data().effortStandard === 'rir1';
      effort.push({ id: doc.id, name, already });
      if (!already && !dryRun) await doc.ref.update({ effortStandard: 'rir1' });
    }
  }

  return { uid, sessions, sessionsChanged, sets, setsFlagged, activeTouched, effort };
}

const uids = allUsers
  ? (await db.collection('users').listDocuments()).map((d) => d.id)
  : [uidArg];

console.log(`${dryRun ? '[dry-run] ' : ''}cutoff ≤ ${CUTOFF_END.toISOString()} · ${uids.length} user(s)`);
let totalSets = 0;
for (const uid of uids) {
  const r = await markUser(uid);
  totalSets += r.setsFlagged;
  if (r.sessions === 0 && r.effort.length === 0) continue;
  console.log(
    `${r.uid}: ${r.sessions} sessions ≤ cutoff, ${r.sessionsChanged} updated, ` +
    `${r.setsFlagged}/${r.sets} sets flagged` +
    (r.activeTouched.length ? ` · ACTIVE session touched: ${r.activeTouched.join(', ')}` : ''),
  );
  for (const e of r.effort) {
    console.log(`  effortStandard rir1 → ${e.name} (${e.id})${e.already ? ' — already set' : dryRun ? ' — would set' : ''}`);
  }
}
console.log(`${dryRun ? 'would flag' : 'flagged'} ${totalSets} sets in total`);
