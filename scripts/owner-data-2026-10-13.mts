/**
 * The owner's 2026-10-13 data fixes, requested and confirmed 2026-10-13.
 *
 *   1. Leg Day 10/13 (`OqkfxBFB56LyvB6exlnl`), DB Romanian deadlift: `rir: 0`
 *      on all three rows (activation + 2 minis). Confirmed RIR 0; left blank.
 *   2. Every workout MARKER in `dailyLogs` — a 0-kcal, unlabeled row whose
 *      timestamp is a workout session's timestamp to the millisecond — is
 *      listed and deleted. These are not stray rows: finishing a session
 *      writes one on purpose (`workoutMarkerEntry`, ADR-0007) so the day
 *      counts toward the streak. The owner was told that and chose deletion
 *      (2026-10-13); a day with no food logged loses its streak day. The CSV
 *      export, which is where they read as "meals", is fixed in code.
 *   3. The 10/13 Zone 2 block's `rpe: 10` is cleared (owner: "clear it").
 *   4. The engine is re-run on Leg Day with the fixed 10/13 read, exactly as
 *      the finish sheet runs it, and its moves are applied to the template as
 *      the ENGINE's (`by: 'engine'`, auto-apply's path).
 *
 * Nothing else is written. Every document touched is backed up first.
 *
 *   npx jiti scripts/owner-data-2026-10-13.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Timestamp } from 'firebase-admin/firestore';
import {
  type Recommendation,
  type WorkoutSession,
  calendarDateKey,
  engineHistory,
  finishProgression,
  honourLifterLoad,
  readableHistory,
  recommend,
  recommendOptionsFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';
import { reasonText } from '../apps/mobile/src/components/train/recommendation-text.ts';
import { en } from '../apps/mobile/src/i18n/en.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const SESSION_ID = 'OqkfxBFB56LyvB6exlnl';
const TEMPLATE_ID = 'quxwARQlCnItzpLJgcr4';
const RDL_ID = 'vtSvqglnBZdM1f3qOJi4';

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const userRef = db.doc(`users/${uid}`);

const [sesSnap, tplSnap, exSnap, logSnap] = await Promise.all([
  userRef.collection('workoutSessions').get(),
  userRef.collection('workoutTemplates').doc(TEMPLATE_ID).get(),
  userRef.collection('exercises').get(),
  userRef.collection('dailyLogs').get(),
]);
const sessionDoc = sesSnap.docs.find((d) => d.id === SESSION_ID);
if (!sessionDoc) throw new Error(`session ${SESSION_ID} not found`);
if (!tplSnap.exists) throw new Error(`template ${TEMPLATE_ID} not found`);

type RawSet = Record<string, unknown> & { rir?: number };
type RawExercise = Record<string, unknown> & { exerciseId: string; name: string; sets: RawSet[] };
type RawCardio = Record<string, unknown> & { rpe?: number };
const raw = sessionDoc.data() as { exercises: RawExercise[]; cardio?: RawCardio[] };

// ── 1. RDL RIR ──
const rdl = raw.exercises.find((e) => e.exerciseId === RDL_ID);
if (!rdl) throw new Error('DB Romanian deadlift not in the 10/13 session');
const rdlBefore = rdl.sets.map((s) => s.rir ?? null);
const fixedExercises = raw.exercises.map((e) =>
  e.exerciseId === RDL_ID ? { ...e, sets: e.sets.map((s) => ({ ...s, rir: 0 })) } : e,
);

// ── 3. Zone 2 RPE ──
const fixedCardio = (raw.cardio ?? []).map((b) => {
  if (b.rpe == null) return b;
  const { rpe: _r, ...rest } = b;
  return rest;
});
const rpeBefore = (raw.cardio ?? []).map((b) => b.rpe ?? null);

// ── 2. workout markers ──
const tsMs = (v: unknown) => (v as Timestamp | undefined)?.toMillis?.();
const sessionMs = new Set(sesSnap.docs.map((d) => tsMs(d.data()['timestamp'])).filter((x): x is number => x != null));
const markers = logSnap.docs.filter((d) => {
  const l = d.data();
  const flagged = l['exerciseCompleted'] === true || l['liftCompleted'] === true || l['cardioCompleted'] === true;
  const label = typeof l['mealLabel'] === 'string' ? l['mealLabel'].trim() : '';
  const ms = tsMs(l['timestamp']);
  return flagged && !(Number(l['calories']) > 0) && label === '' && l['weight'] == null && ms != null && sessionMs.has(ms);
});

// ── backup ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(homedir(), 'ignia-backups');
mkdirSync(dir, { recursive: true });
const backup = join(dir, `owner-data-2026-10-13-${stamp}.json`);
writeFileSync(backup, JSON.stringify({
  uid,
  session: { id: SESSION_ID, ...sessionDoc.data() },
  template: { id: TEMPLATE_ID, ...tplSnap.data() },
  markers: markers.map((d) => ({ id: d.id, ...d.data() })),
}, null, 1));
console.log(`backup: ${backup}`);

console.log(`\n1. DB Romanian deadlift 10/13 RIR: [${rdlBefore.join(', ')}] → [0, 0, 0]`);
console.log(`3. 10/13 cardio RPE: [${rpeBefore.join(', ')}] → cleared`);
console.log(`\n2. Workout markers (0 kcal, no label, timestamp = a session's): ${markers.length}`);
for (const d of [...markers].sort((a, b) => (tsMs(a.data()['timestamp']) ?? 0) - (tsMs(b.data()['timestamp']) ?? 0))) {
  console.log(`   ${d.id}  ${(d.data()['timestamp'] as Timestamp).toDate().toISOString()}`);
}

// ── 4. the engine on the FIXED data, the way the finish sheet runs it ──
const sessions: WorkoutSession[] = sesSnap.docs.map((d) =>
  toWorkoutSession(d.id, d.id === SESSION_ID ? { ...d.data(), exercises: fixedExercises, cardio: fixedCardio } : d.data()),
);
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const catalog = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const template = toWorkoutTemplate(TEMPLATE_ID, tplSnap.data() as Record<string, unknown>);
const t = (key: string, params?: Record<string, string | number>) =>
  ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? ''));

const recs = new Map<string, Recommendation>();
console.log('\n4. Leg Day — the engine on the fixed 10/13 read');
for (const row of template.exercises) {
  const history = engineHistory(completed, row.exerciseId, row);
  const rec0 = recommend(history, recommendOptionsFor(row, catalog.find((c) => c.id === row.exerciseId) ?? null));
  const since = row.baseline?.since;
  const basedOn = completed.find((s) => {
    if (since && calendarDateKey(s.date) < since) return false;
    const e = s.exercises.find((x) => x.exerciseId === row.exerciseId);
    return e != null && readableHistory([e], row).length > 0;
  })?.date;
  const rec = honourLifterLoad(rec0, row, basedOn);
  recs.set(row.exerciseId, rec);
  const load = rec.load == null ? '—' : rec.load === 0 && !rec.assisted ? 'BW' : String(rec.load);
  console.log(`   ${row.name.padEnd(22)} ${String(row.targetLoad ?? '—').padStart(4)} → ${load.padStart(4)}  ${rec.action.padEnd(12)} ${reasonText(rec, 'us', t as never)}`
    + `${rec.predictedReps != null ? `  (expect ~${rec.predictedReps})` : ''}${rec.warnings.length ? `  [${rec.warnings.join(', ')}]` : ''}`);
}
const at = new Date();
const { proposed, applied } = finishProgression({
  rows: template.exercises, recs, autoApply: true, at, reasonFor: (r) => reasonText(r, 'us', t as never),
});
console.log(`\n   template moves: ${proposed.length === 0 ? 'none' : proposed.map((c) => `${c.name} ${c.from} → ${c.to}`).join(' · ')}`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
  process.exit(0);
}

// ── write ──
await sessionDoc.ref.update({ exercises: fixedExercises, cardio: fixedCardio, updatedAt: FieldValue.serverTimestamp() });
for (let i = 0; i < markers.length; i += 400) {
  const batch = db.batch();
  for (const d of markers.slice(i, i + 400)) batch.delete(d.ref);
  await batch.commit();
}
if (applied) {
  // Only the fields `applyTemplateChanges` moves, merged onto the RAW rows, so
  // nothing the domain mapper does not carry is dropped from the template.
  const changed = new Set(proposed.map((c) => c.exerciseId));
  const rawRows = (tplSnap.data() as { exercises: Record<string, unknown>[] }).exercises;
  const rows = rawRows.map((r) => {
    if (!changed.has(r['exerciseId'] as string)) return r;
    const a = applied.find((x) => x.exerciseId === r['exerciseId'])!;
    return {
      ...r,
      targetLoad: a.targetLoad,
      plannedSets: a.plannedSets,
      loadLog: a.loadLog,
      lastModifiedAt: a.lastModifiedAt,
      lastModifiedBy: a.lastModifiedBy,
    };
  });
  await tplSnap.ref.update({ exercises: JSON.parse(JSON.stringify(rows)), updatedAt: FieldValue.serverTimestamp() });
}

// ── verify ──
const after = (await sessionDoc.ref.get()).data() as typeof raw;
const left = (await userRef.collection('dailyLogs').get()).docs.filter((d) => markers.some((m) => m.id === d.id)).length;
const tplAfter = toWorkoutTemplate(TEMPLATE_ID, (await tplSnap.ref.get()).data() as Record<string, unknown>);
console.log('\nwritten:');
console.log(`   RDL RIR now [${after.exercises.find((e) => e.exerciseId === RDL_ID)!.sets.map((s) => s.rir).join(', ')}]`);
console.log(`   cardio RPE now [${(after.cardio ?? []).map((b) => b.rpe ?? 'blank').join(', ')}]`);
console.log(`   markers deleted: ${markers.length - left} of ${markers.length}`);
console.log(`   template loads: ${tplAfter.exercises.map((e) => `${e.name} ${e.targetLoad}`).join(' · ')}`);
