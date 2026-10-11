/**
 * Program v2 DRAFTS of the owner's Push / Pull / Leg templates (requested
 * 2026-10-11, "Ignia — Program v2: Push supersets, Lateral Raise ×2, volume
 * report, Zone 2 band, sleep field"). Writes `users/{uid}/templateDrafts` and
 * NOTHING else: the live `workoutTemplates` (v1) are read, never written, and
 * re-read after the write to prove it. No historical session is touched.
 *
 * The three superset drafts made earlier the same day are REPLACED in place
 * (same doc ids) by the v2 versions — their Pull and Leg pairs are gone by the
 * spec. The script refuses if any of them is switched on.
 *
 * Each v2 draft is `PROGRAM_V2_LAYOUTS` (packages/core fixture, the object the
 * tests pin) built from COPIES of the LIVE rows by `buildDraftBody` — no load
 * is written by hand; every load is refreshed from the live template again at
 * the switch. The Push draft is armed to switch ALL THREE on by themselves
 * once, after the next Push session is completed (`autoActivate`), so v1 runs
 * that session — the flat-press load test, straight sets.
 *
 * Prints, from live data: the v2 templates in order with blocks, clusters,
 * drops and rests; the weekly direct-cluster comparison (REFUSES unless every
 * muscle matches v1 except side delt +1); the duration estimate v1 vs v2; the
 * pending load tests; and the weekly fractional volume of the last 7 days.
 *
 *   npx jiti scripts/owner-data-2026-10-11-program-v2.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`). Writes a JSON backup of
 * everything it read first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type MuscleGroup,
  type WorkoutSession,
  type WorkoutTemplate,
  PROGRAM_V2_REASON,
  buildDraftBody,
  estimateTemplateDuration,
  plannedVolume,
  primaryMuscleOf,
  pruneUndefined,
  rowPendingLoadTest,
  supersetLabel,
  toWorkoutSession,
  toWorkoutTemplate,
  weeklyVolume,
} from '../packages/core/src/index.ts';
import { PROGRAM_V2_LAYOUTS } from '../packages/core/src/__fixtures__/owner-program-v2.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
// Admin Timestamps are kept as they are: `pruneUndefined` rebuilds every object
// it is not told is opaque, and a rebuilt Timestamp is stored as a plain
// {_seconds, _nanoseconds} map — which the rules' `is timestamp` refuses, so
// the app could never switch the drafts (found 2026-10-11 on the owner's
// Program v2 drafts; repaired in place).
const keepTs = (v: object) => v instanceof Timestamp;
const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const userRef = db.doc(`users/${uid}`);

const tplSnap = await userRef.collection('workoutTemplates').get();
const exSnap = await userRef.collection('exercises').get();
const sesSnap = await userRef.collection('workoutSessions').get();
const draftSnap = await userRef.collection('templateDrafts').get();

const live: WorkoutTemplate[] = tplSnap.docs.map((d) => toWorkoutTemplate(d.id, d.data()));
const sessions: WorkoutSession[] = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const catalog = exSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; muscles?: MuscleGroup[]; assisted?: boolean }) }));
const musclesOf = (id: string) => (catalog.find((c) => c.id === id)?.muscles ?? []) as MuscleGroup[];
const catalogMuscles = catalog.map((c) => ({ id: c.id, muscles: c.muscles ?? [] }));

// ── backup ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-11-program-v2-${stamp}.json`);
writeFileSync(backup, JSON.stringify({
  uid,
  workoutTemplates: tplSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  templateDrafts: draftSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}, null, 1));
console.log(`backup: ${backup}`);

// ── build ──
const primaryOf = (row: { name: string; exerciseId: string }) => primaryMuscleOf(row.name, musclesOf(row.exerciseId));
const built = PROGRAM_V2_LAYOUTS.map((layout) => ({ layout, ...buildDraftBody(live, layout, primaryOf) }));
const v1Of = (id: string) => live.find((t) => t.id === id)!;

// ── existing drafts: replaced in place, never while switched on ──
const existing = new Map(draftSnap.docs.map((d) => [d.data()['draftOf'] as string, d]));
for (const b of built) {
  const d = existing.get(b.draftOf);
  if (d && d.data()['status'] === 'active') {
    console.error(`REFUSED: the draft of "${v1Of(b.draftOf).name}" (${d.id}) is switched on. Switch it back first. Nothing written.`);
    process.exit(1);
  }
}

// ── weekly direct clusters: v1 vs v2, refuse unless only side delt +1 ──
const before = new Map(plannedVolume(built.map((b) => v1Of(b.draftOf)), catalogMuscles).map((m) => [m.muscle, m]));
const after = new Map(plannedVolume(built.map((b) => b.body), catalogMuscles).map((m) => [m.muscle, m]));
console.log('\nWeekly clusters (myo-rep) per muscle, each template once a week — direct (fractional)');
console.log('muscle       v1            v2');
let ok = true;
for (const [m, a] of before) {
  const b = after.get(m)!;
  const expected = m === 'sideDelt' ? a.direct + 1 : a.direct;
  if (b.direct !== expected) ok = false;
  console.log(`${m.padEnd(12)} ${String(a.direct).padStart(3)} (${String(a.fractional).padStart(4)})   ${String(b.direct).padStart(3)} (${String(b.fractional).padStart(4)})${b.direct !== a.direct ? `   ${b.direct > a.direct ? '+' : ''}${b.direct - a.direct}` : ''}${b.direct !== expected ? '  <-- NOT IN SPEC' : ''}`);
}
if (!ok) {
  console.error('\nREFUSED: weekly direct clusters differ from v1 beyond side delt +1. Nothing written.');
  process.exit(1);
}

// ── the v2 templates, as the app will show them ──
let weekV1 = 0;
let weekV2 = 0;
for (const b of built) {
  const t = v1Of(b.draftOf);
  const v1min = estimateTemplateDuration(t, musclesOf).minutes;
  const v2min = estimateTemplateDuration(b.body, musclesOf).minutes;
  weekV1 += v1min;
  weekV2 += v2min;
  console.log(`\n── ${b.layout.label}  (replaces "${t.name}" ${t.id} when switched on) — ${v1min} → ${v2min} min`);
  for (const r of b.body.exercises) {
    const acts = r.plannedSets.filter((p) => p.kind === 'activation');
    const labels = acts.map((p) => p.label).filter(Boolean);
    const drop = r.plannedSets.find((p) => p.kind === 'drop');
    const rests = [
      r.supersetGroup && r.pairPosition === 1 ? `transition ${r.transitionRestSec}s · round ${r.roundRestSec}s` : '',
      r.minClusterRestSec ? `≥${r.minClusterRestSec}s between own clusters` : '',
      r.restClusterSec ? `${r.restClusterSec}s between clusters` : '',
      r.restAfterSec != null ? `after ${r.restAfterSec}${r.restAfterMaxSec ? `–${r.restAfterMaxSec}` : ''}s` : '',
    ].filter(Boolean).join(' · ');
    const notes = [
      drop ? `drop on cluster ${drop.group} at ${drop.weight}` : '',
      r.clusterCountChange ? `cluster count ${r.clusterCountChange.from}→${r.clusterCountChange.to} (dated at the switch)` : '',
      b.keepBaselines.includes(r.exerciseId) && r.baseline ? `keeps baseline since ${r.baseline.since}` : '',
      ...(r.cues ?? []).filter((c) => /pause/i.test(c)),
    ].filter(Boolean).join(' · ');
    console.log(`  ${(supersetLabel(r) ?? '·').padEnd(3)} ${r.name.padEnd(28)} ${String(r.targetLoad ?? 'BW').padStart(4)}  ×${labels.length ? labels.join('+') : acts.length}  ${rests}${notes ? `  [${notes}]` : ''}`);
  }
  for (const c of b.body.cardioBlocks ?? []) {
    console.log(`      ${c.label ?? c.modality}: ${Math.round((c.targetDurationSec ?? 0) / 60)} min${c.targetHrMin ? ` · HR ${c.targetHrMin}–${c.targetHrMax}` : ''}`);
  }
  const pending = b.body.exercises
    .map((r) => ({ r, p: rowPendingLoadTest(r, completed, catalog.find((c) => c.id === r.exerciseId) as never) }))
    .filter((x) => x.p);
  for (const { r, p } of pending) console.log(`  load test pending: ${r.name} ${p!.from} → ${p!.to}`);
}
console.log(`\nWeek: v1 ${weekV1} min · v2 ${weekV2} min (${weekV2 - weekV1 >= 0 ? '+' : ''}${weekV2 - weekV1})`);

// ── the last 7 days of real data ──
const vol = weeklyVolume(completed, catalogMuscles, Date.now());
console.log('\nWeekly volume, last 7 days (clusters, myo-rep) — lowest first: direct / fractional / v2 plan');
for (const m of vol.week) console.log(`  ${m.muscle.padEnd(12)} ${String(m.direct).padStart(3)} / ${String(m.fractional).padStart(4)} / ${after.get(m.muscle)?.fractional ?? 0}`);
for (const s of vol.perSession) {
  const name = completed.find((x) => x.id === s.sessionId)?.templateName ?? 'session';
  console.log(`  ${s.date.toISOString().slice(0, 10)} ${name}: ${[...s.muscles].reverse().filter((m) => m.fractional > 0).map((m) => `${m.muscle} ${m.fractional}`).join(', ')}${s.overPlateau.length ? `  ABOVE PLATEAU: ${s.overPlateau.join(', ')}` : ''}`);
}
if (vol.unattributed.length) console.log(`  not counted: ${vol.unattributed.join(', ')}`);

// ── write ──
const push = live.find((t) => t.name === 'Push Day');
if (!push?.id) throw new Error('no live "Push Day"');
if (!APPLY) {
  console.log(`\nDRY RUN — would write ${built.length} v2 draft(s), armed to switch on after the next completed Push Day. Re-run with --apply.`);
  process.exit(0);
}
const liveBefore = JSON.stringify(tplSnap.docs.map((d) => [d.id, d.data()]));
const now = Timestamp.now();
const armedAt = now.toDate().toISOString();
for (const b of built) {
  const fields = pruneUndefined({
    draftOf: b.draftOf,
    label: b.layout.label,
    status: 'draft',
    template: b.body,
    program: 'v2',
    reason: PROGRAM_V2_REASON,
    keepBaselines: b.keepBaselines,
    ...(b.draftOf === push.id ? { autoActivate: { afterTemplateId: push.id, after: armedAt } } : {}),
    updatedAt: now,
  }, keepTs);
  const prior = existing.get(b.draftOf);
  if (prior) {
    // Replaced whole (set, not merge), so nothing of the superset draft —
    // its Pull/Leg pair — survives; createdAt kept.
    await prior.ref.set({ ...fields, createdAt: prior.data()['createdAt'] ?? now });
    console.log(`replaced templateDrafts/${prior.id}  (${b.layout.label})`);
  } else {
    const ref = userRef.collection('templateDrafts').doc();
    await ref.set({ ...fields, createdAt: now });
    console.log(`created templateDrafts/${ref.id}  (${b.layout.label})`);
  }
}
const liveAfter = JSON.stringify((await userRef.collection('workoutTemplates').get()).docs.map((d) => [d.id, d.data()]));
if (liveAfter !== liveBefore) {
  console.error('WARNING: workoutTemplates changed during the run (not by this script — it never writes them). Check the device.');
  process.exit(1);
}
console.log('verified: workoutTemplates (v1) byte-identical before and after');
