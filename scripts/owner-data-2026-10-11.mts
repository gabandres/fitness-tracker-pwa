/**
 * Superset DRAFTS of the owner's Push / Pull / Leg templates, requested
 * 2026-10-11. Creates three documents in `users/{uid}/templateDrafts` and
 * NOTHING else: the live `workoutTemplates` are read, never written, and the
 * script re-reads them after writing to prove it.
 *
 * The layout is `OWNER_SUPERSET_LAYOUTS` (packages/core fixture) — the same
 * object the parity test pins — built from COPIES of the LIVE rows by
 * `buildDraftBody`, so each draft starts with today's loads, clusters, L/R
 * labels and the lateral raise's drop set at 10.
 *
 * Prints, from live data: each draft in order; the per-muscle weekly cluster
 * comparison (REFUSES, nothing written, unless every muscle is identical); the
 * context changes activation would flag; the pending load tests on paired
 * lifts; and the rest each draft saves, from cluster count × timers through
 * the same `restAfterSetInFlow` the workout runs.
 *
 * Re-runs read "nothing to do" for a template that already has a draft.
 * Writes a JSON backup of everything it read first.
 *
 *   npx jiti scripts/owner-data-2026-10-11.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type RestSeconds,
  type TemplateBody,
  type TemplateExercise,
  type WorkoutSession,
  type WorkoutTemplate,
  MUSCLE_GROUPS,
  buildDraftBody,
  contextChanges,
  plannedRestSec,
  pruneUndefined,
  rowPendingLoadTest,
  supersetLabel,
  templateClustersByMuscle,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';
import { OWNER_SUPERSET_LAYOUTS } from '../packages/core/src/__fixtures__/owner-templates-2026-10-11.ts';

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
// Newest first: the order both apps pass, and the one `exerciseHistory` and
// the engine read "last session" from.
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const catalog = new Map(exSnap.docs.map((d) => [d.id, d.data() as { name: string; muscles?: string[]; assisted?: boolean }]));
const musclesOf = (id: string) => (catalog.get(id)?.muscles ?? []) as (typeof MUSCLE_GROUPS)[number][];

// ── backup ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-11-${stamp}.json`);
writeFileSync(backup, JSON.stringify({
  uid,
  workoutTemplates: tplSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  templateDrafts: draftSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}, null, 1));
console.log(`backup: ${backup}`);

// ── build ──
const drafts = OWNER_SUPERSET_LAYOUTS.map((layout) => ({ layout, ...buildDraftBody(live, layout) }));

// ── weekly cluster parity: refuse unless identical ──
const before = templateClustersByMuscle(live.filter((t) => drafts.some((d) => d.draftOf === t.id)), musclesOf);
const after = templateClustersByMuscle(drafts.map((d) => ({ id: d.draftOf, exercises: d.body.exercises })), musclesOf);
console.log('\nWeekly clusters per primary muscle (each template once a week)');
console.log('muscle      active  draft');
let parity = true;
for (const m of MUSCLE_GROUPS) {
  const a = before.byMuscle[m] ?? 0;
  const b = after.byMuscle[m] ?? 0;
  if (a === 0 && b === 0) continue;
  if (a !== b) parity = false;
  console.log(`${m.padEnd(11)} ${String(a).padStart(6)} ${String(b).padStart(6)}${a === b ? '' : '   <-- DIFFERS'}`);
}
const total = (r: typeof before) => Object.values(r.byMuscle).reduce((x, y) => x + (y ?? 0), 0);
console.log(`${'total'.padEnd(11)} ${String(total(before)).padStart(6)} ${String(total(after)).padStart(6)}`);
if (before.unattributed.length || after.unattributed.length) {
  parity = false;
  console.log('unattributed:', before.unattributed, after.unattributed);
}
if (!parity) {
  console.error('\nREFUSED: weekly clusters differ. Nothing written.');
  process.exit(1);
}

// ── what each draft is, and what activating it would do ──
const restFor = (t: { restMiniSec?: number; restClusterSec?: number; exercises: readonly TemplateExercise[] }) =>
  (i: number): RestSeconds => ({
    mini: t.exercises[i].restMiniSec ?? t.restMiniSec ?? 10,
    cluster: t.restClusterSec ?? 90,
    ...(t.exercises[i].restAfterSec != null ? { afterExercise: t.exercises[i].restAfterSec } : {}),
  });
const flowRows = (rows: readonly TemplateExercise[]) => rows.map((e) => ({ ...e, sets: e.plannedSets }));
const straightOf = (rows: readonly TemplateExercise[]) =>
  rows.map(({ supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...e }) => e);
const min = (sec: number) => (sec / 60).toFixed(1);

let weekLive = 0;
let weekDraft = 0;
for (const d of drafts) {
  const t = live.find((x) => x.id === d.draftOf)!;
  console.log(`\n── ${d.layout.label}  (replaces "${t.name}" ${t.id} when activated)`);
  for (const r of d.body.exercises) {
    const acts = r.plannedSets.filter((p) => p.kind === 'activation').length;
    const drop = r.plannedSets.find((p) => p.kind === 'drop');
    const rest = r.supersetGroup && r.pairPosition === 1 ? `  transition ${r.transitionRestSec}s · round ${r.roundRestSec}s` : '';
    const after = r.restAfterSec != null ? `  after ${r.restAfterSec}${r.restAfterMaxSec ? `–${r.restAfterMaxSec}` : ''}s` : '';
    console.log(`  ${(supersetLabel(r) ?? '·').padEnd(3)} ${r.name.padEnd(28)} ${String(r.targetLoad ?? '').padStart(4)} lb  ×${acts}${drop ? ` +drop@${drop.weight}` : ''}${rest}${after}`);
  }
  for (const c of t.cardioBlocks ?? []) console.log(`      ${c.label ?? c.modality}: ${Math.round((c.targetDurationSec ?? 0) / 60)} min`);

  const changes = contextChanges(live, { id: d.draftOf, exercises: d.body.exercises });
  console.log('  context changes on activation:');
  for (const [id, c] of changes) console.log(`    ${catalog.get(id)?.name}: ${c.join('/')}`);

  const pending = d.body.exercises.filter((r) => r.supersetGroup)
    .map((r) => ({ r, p: rowPendingLoadTest(r, completed, catalog.get(r.exerciseId) as never) }))
    .filter((x) => x.p);
  for (const { r, p } of pending) console.log(`  LOAD TEST PENDING: ${r.name} ${p!.from} → ${p!.to} lb — run straight sets this session`);

  const restLive = plannedRestSec(flowRows(t.exercises), restFor(t));
  const restDraft = plannedRestSec(flowRows(d.body.exercises), restFor(d.body));
  const restSameStraight = plannedRestSec(flowRows(straightOf(d.body.exercises)), restFor({ ...d.body, exercises: straightOf(d.body.exercises) }));
  weekLive += restLive;
  weekDraft += restDraft;
  console.log(`  between-unit rest: live template ${min(restLive)} min · draft ${min(restDraft)} min`
    + ` · the draft's own lifts done straight ${min(restSameStraight)} min → saves ${min(restSameStraight - restDraft)} min`);
}
console.log(`\nWeek (all three): live ${min(weekLive)} min of between-unit rest · drafts ${min(weekDraft)} min → saves ${min(weekLive - weekDraft)} min`);

// ── write ──
const existing = new Set(draftSnap.docs.map((d) => d.data()['draftOf'] as string));
const toWrite = drafts.filter((d) => !existing.has(d.draftOf));
for (const d of drafts) if (existing.has(d.draftOf)) console.log(`\n${d.layout.label}: a draft already exists — nothing to do`);
if (!APPLY) {
  console.log(`\nDRY RUN — would create ${toWrite.length} draft(s). Re-run with --apply.`);
  process.exit(0);
}
const liveBefore = JSON.stringify(tplSnap.docs.map((d) => [d.id, d.data()]));
const now = Timestamp.now();
for (const d of toWrite) {
  const body: TemplateBody = d.body;
  const ref = userRef.collection('templateDrafts').doc();
  await ref.set(pruneUndefined({ draftOf: d.draftOf, label: d.layout.label, status: 'draft', template: body, createdAt: now, updatedAt: now }, keepTs));
  console.log(`created templateDrafts/${ref.id}  (${d.layout.label})`);
}
const liveAfter = JSON.stringify((await userRef.collection('workoutTemplates').get()).docs.map((d) => [d.id, d.data()]));
if (liveAfter !== liveBefore) {
  console.error('WARNING: workoutTemplates changed during the run (not by this script — it never writes them). Check the device.');
  process.exit(1);
}
console.log('verified: workoutTemplates byte-identical before and after');
