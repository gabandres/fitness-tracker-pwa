/**
 * The owner's 2026-10-15 training data fixes, requested and confirmed that day
 * (status check items 1-E, 3 and 5). Dry run unless `--apply`; every document
 * touched is backed up first; re-runs are no-ops.
 *
 *   1. 10/14 Pull Day, Wide-grip lat pulldown: the last mini-set's 38 reps → 3.
 *   2. 10/14 Pull Day, Incline DB Curl 45°: RIR → 0 on all three rows.
 *   3. 10/15 Push Day, Deficit Push-up: RIR → 0 on all three rows.
 *   4. 10/14 Pull Day: the Apple Watch walk the Health import attached
 *      (1,048 s, no HR, no RPE) is removed and its `sourceId` recorded in
 *      `dismissedSourceIds`, so the import does not put it back. The manual
 *      20-min Zone 2 run is kept.
 *   5. Pace → 0.5 lb/wk (projections only; the targets stay the owner's own
 *      1,850 / 140, which the script checks and does not touch).
 *   6. Bug E: "context changed" baselines dated by the 10/11 switch are
 *      re-dated to each template's FIRST v2 session — Push 2026-10-15, Leg
 *      2026-10-13. Pull: the neutral-grip pull-up and the seated machine row
 *      get a PENDING baseline (2026-10-16): no Pull Day has run in the new
 *      order yet, so the first one that does is their baseline, and nothing
 *      before it is compared. Their 10/14 excluded reads stay.
 *   7. Workout marker rows (0 kcal, unlabeled, `exerciseCompleted`, timestamp
 *      equal to a workout session's) — the artifact bug C stops writing — are
 *      deleted, as the owner chose for every earlier one on 10/13.
 *
 *   npx jiti scripts/owner-data-2026-10-15-train.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const PULL_SESSION = 'Vw0iaQ5ClAVHx7Dymxo8'; // 2026-10-14 Pull Day
const PUSH_SESSION = '4DEYM7NxuDVqMnrMFr8t'; // 2026-10-15 Push Day
const WATCH_WALK = '24D8F0AB-583D-46D3-8E78-C735547D0358';
const PUSH_TPL = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL_TPL = 'aliWJBD2FND6mU9foLdC';
const LEG_TPL = 'quxwARQlCnItzpLJgcr4';
const PULLUP = 'GOGOcWJNC9q9aBmN3ENq';
const ROW = '9x3b6rmxlxJyWWSMat3w';
const SWITCH_DAY = '2026-10-11';
const FIRST_V2: Record<string, string> = { [PUSH_TPL]: '2026-10-15', [LEG_TPL]: '2026-10-13' };
const PULL_PENDING = {
  since: '2026-10-16',
  reason: 'context changed: position 2026-10-14 — baseline pending: the first Pull Day in the new order sets it',
};
const PACE = 0.5;

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stampIso = now.toISOString();

type Set_ = Record<string, unknown> & { kind?: string; reps?: number; rir?: number };
type Ex = Record<string, unknown> & { name: string; exerciseId: string; sets: Set_[] };
type Row = Record<string, unknown> & { name: string; exerciseId: string; baseline?: { since: string; reason: string } };

const [profileSnap, pullSnap, pushSnap, pushT, pullT, legT, sessionsSnap, logsSnap] = await Promise.all([
  user.get(),
  user.collection('workoutSessions').doc(PULL_SESSION).get(),
  user.collection('workoutSessions').doc(PUSH_SESSION).get(),
  user.collection('workoutTemplates').doc(PUSH_TPL).get(),
  user.collection('workoutTemplates').doc(PULL_TPL).get(),
  user.collection('workoutTemplates').doc(LEG_TPL).get(),
  user.collection('workoutSessions').select('timestamp').get(),
  user.collection('dailyLogs').where('exerciseCompleted', '==', true).get(),
]);
for (const [name, s] of [['pull session', pullSnap], ['push session', pushSnap], ['Push', pushT], ['Pull', pullT], ['Leg', legT]] as const) {
  if (!s.exists) throw new Error(`${name} not found`);
}

// ── backup ──
const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-15-train-${stampIso.replace(/[:.]/g, '-')}.json`);
writeFileSync(backup, JSON.stringify(conv({
  profile: profileSnap.data(), pullSession: pullSnap.data(), pushSession: pushSnap.data(),
  templates: { push: pushT.data(), pull: pullT.data(), leg: legT.data() },
  markers: logsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}), null, 1));
console.log(`backup: ${backup}`);

const report: string[] = [];
const sessionWrites: { ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> }[] = [];

// ── 1, 2, 4: the 10/14 Pull session ──
{
  const data = pullSnap.data()!;
  const exercises = structuredClone(data.exercises) as Ex[];
  let changed = false;
  const pulldown = exercises.find((e) => e.name === 'Wide-grip lat pulldown');
  if (!pulldown) throw new Error('pulldown not in the 10/14 session');
  const last = pulldown.sets[pulldown.sets.length - 1];
  if (last.kind === 'mini' && last.reps === 38) { last.reps = 3; changed = true; report.push('1. pulldown 10/14 last mini 38 → 3'); }
  else if (last.reps === 3) report.push('1. pulldown 10/14 last mini already 3 (skip)');
  else throw new Error(`pulldown last set is ${JSON.stringify(last)} — refusing`);

  const curl = exercises.find((e) => e.name === 'Incline DB Curl 45°');
  if (!curl || curl.sets.length !== 3) throw new Error('curl 10/14 not as expected');
  const blank = curl.sets.filter((s) => s.rir == null).length;
  if (blank === 3) { curl.sets.forEach((s) => { s.rir = 0; }); changed = true; report.push('2. incline curl 10/14 RIR → 0 ×3'); }
  else if (curl.sets.every((s) => s.rir === 0)) report.push('2. incline curl 10/14 RIR already 0 (skip)');
  else throw new Error(`curl 10/14 RIR is partly set (${curl.sets.map((s) => s.rir).join(',')}) — refusing`);

  const cardio = (data.cardio ?? []) as Record<string, unknown>[];
  const walk = cardio.find((b) => b.sourceId === WATCH_WALK);
  const dismissed = new Set<string>((data.dismissedSourceIds as string[] | undefined) ?? []);
  const patch: Record<string, unknown> = {};
  if (walk) {
    if (walk.durationSec !== 1048 || walk.avgHr != null || walk.rpe != null) throw new Error(`walk is ${JSON.stringify(walk)} — refusing`);
    if (!cardio.some((b) => b.label === 'Zone 2' && b.durationSec === 1200 && b.source === 'manual')) throw new Error('manual Zone 2 not found — refusing');
    patch.cardio = cardio.filter((b) => b.sourceId !== WATCH_WALK);
    report.push('4. removed the 1,048 s Apple Watch walk from 10/14; kept the 20-min Zone 2');
  } else report.push('4. 1,048 s walk already gone (skip)');
  if (!dismissed.has(WATCH_WALK)) { patch.dismissedSourceIds = [...dismissed, WATCH_WALK]; report.push('4. recorded its sourceId in dismissedSourceIds'); }
  if (changed) patch.exercises = exercises;
  if (Object.keys(patch).length) sessionWrites.push({ ref: pullSnap.ref, patch: { ...patch, updatedAt: Timestamp.fromDate(now) } });
}

// ── 3: the 10/15 Push session ──
{
  const exercises = structuredClone(pushSnap.data()!.exercises) as Ex[];
  const push = exercises.find((e) => e.name === 'Deficit Push-up');
  if (!push || push.sets.length !== 3) throw new Error('deficit push-up 10/15 not as expected');
  if (push.sets.every((s) => s.rir == null)) {
    push.sets.forEach((s) => { s.rir = 0; });
    sessionWrites.push({ ref: pushSnap.ref, patch: { exercises, updatedAt: Timestamp.fromDate(now) } });
    report.push('3. deficit push-up 10/15 RIR → 0 ×3');
  } else if (push.sets.every((s) => s.rir === 0)) report.push('3. deficit push-up 10/15 RIR already 0 (skip)');
  else throw new Error('deficit push-up RIR partly set — refusing');
}

// ── 5: pace ──
const profile = profileSnap.data()!;
if (profile.goalDirection !== 'lose' || profile.targetMode !== 'custom' || profile.manualCaloriesTarget !== 1850 || profile.manualProteinTarget !== 140) {
  throw new Error(`profile targets are not lose / custom 1850 / 140 (${profile.goalDirection}, ${profile.targetMode}, ${profile.manualCaloriesTarget}, ${profile.manualProteinTarget}) — refusing`);
}
const profilePatch = profile.targetPaceLbsPerWeek === PACE ? null : { targetPaceLbsPerWeek: PACE };
report.push(profilePatch ? `5. pace ${profile.targetPaceLbsPerWeek} → ${PACE} lb/wk (targets stay 1,850 / 140, custom)` : '5. pace already 0.5 (skip)');

// ── 6: baselines ──
const tplWrites: { ref: FirebaseFirestore.DocumentReference; exercises: Row[] }[] = [];
for (const snap of [pushT, legT]) {
  const rows = structuredClone(snap.data()!.exercises) as Row[];
  const to = FIRST_V2[snap.id];
  let changed = false;
  for (const r of rows) {
    if (r.baseline?.since === SWITCH_DAY && r.baseline.reason.startsWith('context changed')) {
      report.push(`6. ${snap.data()!.name} · ${r.name}: baseline ${SWITCH_DAY} → ${to} (${r.baseline.reason})`);
      r.baseline = { ...r.baseline, since: to };
      r.lastModifiedAt = stampIso;
      r.lastModifiedBy = 'prompt';
      changed = true;
    }
  }
  if (changed) tplWrites.push({ ref: snap.ref, exercises: rows });
}
{
  const rows = structuredClone(pullT.data()!.exercises) as Row[];
  if (rows[0]?.exerciseId !== PULLUP || rows[1]?.exerciseId !== ROW) throw new Error('Pull order is not pull-up, row — refusing');
  let changed = false;
  for (const r of rows.slice(0, 2)) {
    if (r.baseline?.since === PULL_PENDING.since) { report.push(`6. Pull Day · ${r.name}: baseline already pending (skip)`); continue; }
    report.push(`6. Pull Day · ${r.name}: baseline ${r.baseline?.since ?? 'none'} → pending (first new-order Pull, on/after ${PULL_PENDING.since})`);
    r.baseline = { ...PULL_PENDING };
    r.lastModifiedAt = stampIso;
    r.lastModifiedBy = 'prompt';
    changed = true;
  }
  if (changed) tplWrites.push({ ref: pullT.ref, exercises: rows });
}

// ── 7: workout markers ──
const sessionTimes = new Set(sessionsSnap.docs.map((d) => (d.get('timestamp') as Timestamp | undefined)?.toMillis()).filter((x): x is number => x != null));
const markers = logsSnap.docs.filter((d) => {
  const x = d.data();
  return (x.calories ?? 0) === 0 && !x.mealLabel && x.timestamp instanceof Timestamp && sessionTimes.has(x.timestamp.toMillis());
});
for (const m of markers) report.push(`7. marker ${m.id} at ${(m.get('timestamp') as Timestamp).toDate().toISOString()} — delete`);
const strays = logsSnap.docs.filter((d) => !markers.includes(d));
for (const s of strays) report.push(`7. NOT touched: exerciseCompleted row ${s.id} (${JSON.stringify(conv(s.data()))}) — not a session-timed marker`);

console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid}\n${report.map((l) => `  ${l}`).join('\n')}`);
if (!APPLY) { console.log('\nRe-run with --apply.'); process.exit(0); }

const batch = db.batch();
for (const w of sessionWrites) batch.update(w.ref, w.patch);
if (profilePatch) batch.update(user, { ...profilePatch, lastSeenAt: FieldValue.serverTimestamp() });
for (const w of tplWrites) batch.update(w.ref, { exercises: w.exercises, updatedAt: Timestamp.fromDate(now) });
for (const m of markers) batch.delete(m.ref);
await batch.commit();
console.log(`\napplied: ${sessionWrites.length} session(s), ${profilePatch ? 1 : 0} profile, ${tplWrites.length} template(s), ${markers.length} marker(s) deleted`);
