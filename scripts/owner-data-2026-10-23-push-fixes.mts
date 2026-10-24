/**
 * Owner data, requested 2026-10-23 (America/Puerto_Rico): 10/22–10/23 fixes
 * and the 10/23 Push Day corrections. Values are the owner's, entered exactly.
 *
 * What the read found (each value checked; any drift → refuse):
 *   - Hunger 10/22: no row → ADDED (level 3).
 *   - Hunger 10/21: level 1 stored, owner says not rated → mismatch, KEPT
 *     (reported; the 10/22 script reported the same).
 *   - Steps 10/22: 7,217 stored (device), owner says 7,000 → mismatch, KEPT.
 *     Steps never feed the maintenance estimate (ADR-0024), so nothing else.
 *   - Weight 10/23: 152.4 stored ✓. Zone 2 10/23: no cardio row, nothing to
 *     write (core has no "missed Zone 2" state).
 *   - Calf, 10/23 Push (session HgvkChcLMbGIgYWDsBXn): the six "Single-leg DB
 *     calf raise" L/R rows at 30 were two-leg standing raises, 30 per hand →
 *     MOVED to a new catalog lift "Standing DB calf raise (2-leg)", no side
 *     labels, cluster L → 1, R → 2. A different exerciseId is what takes them
 *     out of the single-leg history (core `engineHistory` reads by id). The
 *     Push template row stays single-leg 30.
 *   - DB Lateral Raise + Skull Crusher (Push): baseline since 2026-10-23,
 *     "context changed: slow eccentric 2–3 s (form)", so 10/23 is the first
 *     read rather than a drop from 10/15; cue "2–3 s eccentric". The Pull
 *     lateral (superset E) gets the cue too; its v2.2 baseline (since 10/22)
 *     already starts before the 10/23 read, so it is left as is.
 *   - Weighted Floor Crunch: target 15 → 20 (loadLog by `prompt`, so
 *     `honourLifterLoad` holds it) + the owner's note as a cue.
 *   - Shoulder Press 80, OHE 35, Flat 25, Incline 20: verified, untouched.
 *
 * Dry run unless `--apply`; re-runs are no-ops; everything touched is backed
 * up to ~/ignia-backups first.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-23-push-fixes.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { TemplateExercise } from '../packages/core/src/workout.ts';
import { contextBaseline, dumbbellStepLb, toWorkoutExercise } from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const DAY = '2026-10-23';

const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const SESSION = 'HgvkChcLMbGIgYWDsBXn';
const SL_CALF = 'm5E72J63gVXltnQ0zC8f';
const LATERAL = 'BGyAEJU6i5nN6AjXRU1g';
const SKULL = 'EyDTWnfO4WrbYDbDkxrk';
const CRUNCH = 'x3G0Speg04GclIOdKHAl';
const KEEP: Record<string, number> = {
  He4o7qVWRftiPneaXjiV: 80, // Seated DB Shoulder Press
  AAHHWXTA7UtbNWZbcf7z: 35, // Overhead DB Extension
  ud6fE363QklE3qXYxLw3: 25, // DB Flat Press
  ngF9959fQPGTYUHXpigC: 20, // Incline Dumbbell Press
};

const CALF_NAME = 'Standing DB calf raise (2-leg)';
const CALF_SETS = [['L', 1, 'activation', 16], ['L', 1, 'mini', 5], ['L', 1, 'mini', 4], ['R', 2, 'activation', 16], ['R', 2, 'mini', 5], ['R', 2, 'mini', 5]] as const;
const TEMPO_REASON = 'context changed: slow eccentric 2–3 s (form)';
const TEMPO_CUE = '2–3 s eccentric';
const CRUNCH_CUE = '10/23 technique reset at 15 lb DB on chest (20/20, abs felt); progress from 20';
const PUSH_NOTE = `${DAY} - owner: 10/23 calves were standard two-leg standing raises, 30 lb DB per hand (machine occupied) → logged under "${CALF_NAME}", out of the single-leg history; template stays single-leg 30 · DB Lateral Raise + Skull Crusher: slow eccentric 2–3 s (form), baseline since ${DAY} (10/23 is the first read, not a regression vs 10/15) · Weighted Floor Crunch 15 → 20 (10/23 technique reset at 15 lb DB on chest, 20/20, abs felt; progress from 20).`;

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const problems: string[] = [];
const plan: string[] = [];
const report: string[] = [];

const [profile, hunger21, hunger22, act22, w23, sesSnap, pushSnap, pullSnap, exSnap] = await Promise.all([
  user.get(),
  user.collection('dailyHunger').doc('2026-10-21').get(),
  user.collection('dailyHunger').doc('2026-10-22').get(),
  user.collection('dailyActivity').doc('2026-10-22').get(),
  user.collection('dailyWeights').doc(DAY).get(),
  user.collection('workoutSessions').doc(SESSION).get(),
  user.collection('workoutTemplates').doc(PUSH).get(),
  user.collection('workoutTemplates').doc(PULL).get(),
  user.collection('exercises').get(),
]);

// ── daily rows ──
const h22 = hunger22.get('level');
if (h22 == null) plan.push('dailyHunger/2026-10-22 ← { level: 3 }');
else if (h22 !== 3) problems.push(`hunger 10/22 stored ${h22}, owner says 3`);
else report.push('hunger 10/22: 3 already stored');
const h21 = hunger21.get('level');
report.push(h21 == null ? 'hunger 10/21: not rated ✓' : `MISMATCH hunger 10/21: level ${h21} stored, owner says not rated — kept`);
const s22 = act22.get('steps');
report.push(s22 === 7000 ? 'steps 10/22: 7,000 ✓' : `MISMATCH steps 10/22: ${s22} stored (device), owner says 7,000 — kept`);
const wt = w23.get('weight');
if (wt !== 152.4) problems.push(`weight 10/23 stored ${wt}, owner says 152.4`);
else report.push('weight 10/23: 152.4 ✓');

// ── session: the calf rows ──
type Row = TemplateExercise & Record<string, unknown>;
type SesRow = { exerciseId: string; name: string; sets: Record<string, unknown>[] } & Record<string, unknown>;
const ses = sesSnap.data() as { templateId: string; cardio?: unknown[]; exercises: SesRow[] } | undefined;
if (!ses || ses.templateId !== PUSH) throw new Error(`session ${SESSION} missing or not Push Day`);
report.push(`Zone 2 10/23: ${ses.cardio?.length ? `${ses.cardio.length} cardio row(s) on the Push session — CHECK` : 'none logged ✓ (left empty)'}`);
const existingCalf = exSnap.docs.find((d) => d.get('name') === CALF_NAME);
const calfRef = existingCalf?.ref ?? user.collection('exercises').doc();
if (!existingCalf) plan.push(`exercises/${calfRef.id} ← "${CALF_NAME}" [calves], weight-reps, effort failure`);
const ci = ses.exercises.findIndex((e) => e.exerciseId === SL_CALF || e.exerciseId === calfRef.id);
if (ci < 0) throw new Error('no calf row in the 10/23 session');
const calf = ses.exercises[ci];
let nextExercises = ses.exercises;
if (calf.exerciseId === calfRef.id) report.push('session calf: already moved');
else {
  const sets = calf.sets;
  const ok = sets.length === 6 && sets.every((s, i) => {
    const [label, group, kind, reps] = CALF_SETS[i];
    return s.label === label && s.group === group && s.kind === kind && s.reps === reps && s.weight === 30 && s.done === true;
  });
  if (!ok) problems.push(`session calf sets drift: ${JSON.stringify(sets)}`);
  const { sideRecommendations: _sr, recommendation: _r, ...rest } = calf;
  const moved: SesRow = {
    ...rest,
    exerciseId: calfRef.id,
    name: CALF_NAME,
    targetLoad: 30,
    sets: sets.map(({ label: _l, ...s }) => s),
  };
  nextExercises = ses.exercises.map((e, i) => (i === ci ? moved : e));
  plan.push(`session ${SESSION}: "${calf.name}" ×6 L/R → "${CALF_NAME}" ×6 (2 clusters, 30/hand, no side)`);
}

// ── templates ──
type RawTpl = { name: string; notes?: string; exercises: Row[] } & Record<string, unknown>;
const push = pushSnap.data() as RawTpl;
const pull = pullSnap.data() as RawTpl;
const catOf = (id: string) => { const d = exSnap.docs.find((x) => x.id === id); return d ? toWorkoutExercise(d.id, d.data()) : null; };
const dbStep = dumbbellStepLb(profile.get('dumbbellHalfSteps') as boolean | undefined);
const touch = (r: Row): Row => ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' });
const withCue = (r: Row, cue: string): Row => (r.cues?.includes(cue) ? r : touch({ ...r, cues: [...(r.cues ?? []), cue] }));

for (const [id, load] of Object.entries(KEEP)) {
  const r = push.exercises.find((e) => e.exerciseId === id);
  if (r?.targetLoad !== load) problems.push(`Push ${r?.name ?? id}: target ${r?.targetLoad}, owner says keep ${load}`);
  else report.push(`Push ${r.name}: ${load} ✓ (kept)`);
}
const slRow = push.exercises.find((e) => e.exerciseId === SL_CALF);
if (slRow?.targetLoad !== 30) problems.push(`Push single-leg calf target ${slRow?.targetLoad}, expected 30`);
else report.push('Push Single-leg DB calf raise: 30 ✓ (kept)');

const pushRows = push.exercises.map((r0) => {
  let r = r0 as Row;
  if (r.exerciseId === LATERAL || r.exerciseId === SKULL) {
    if (r.baseline?.since !== DAY || r.baseline?.reason !== TEMPO_REASON) {
      const b = contextBaseline([], { since: DAY, load: r.targetLoad, catalog: { ...catOf(r.exerciseId)!, dumbbellStepLb: dbStep }, row: r });
      plan.push(`Push ${r.name}: baseline ${r.baseline ? `${r.baseline.since} "${r.baseline.reason}"` : '—'} → ${DAY} "${TEMPO_REASON}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}`);
      r = touch({ ...r, baseline: { ...b, reason: TEMPO_REASON } });
    }
    if (!r.cues?.includes(TEMPO_CUE)) plan.push(`Push ${r.name}: + cue "${TEMPO_CUE}"`);
    r = withCue(r, TEMPO_CUE);
  }
  if (r.exerciseId === CRUNCH) {
    if (r.targetLoad !== 20) {
      if (r.targetLoad !== 15) problems.push(`crunch target ${r.targetLoad}, expected 15 before the change`);
      plan.push(`Push ${r.name}: target ${r.targetLoad} → 20 (loadLog +prompt)`);
      r = touch({
        ...r,
        targetLoad: 20,
        loadLog: [...(r.loadLog ?? []), { at: stamp, from: r.targetLoad, to: 20, by: 'prompt', reason: `Owner, ${DAY}: ${CRUNCH_CUE}` }],
      });
    }
    if (!r.cues?.includes(CRUNCH_CUE)) plan.push(`Push ${r.name}: + cue "${CRUNCH_CUE}"`);
    r = withCue(r, CRUNCH_CUE);
  }
  return r;
});
const pushNotes = push.notes?.includes(`${DAY} - owner: 10/23 calves`) ? push.notes : `${push.notes ?? ''}\n${PUSH_NOTE}`.trim();
if (pushNotes.length > 10000) throw new Error(`Push notes would be ${pushNotes.length} chars`);
if (pushNotes !== push.notes) plan.push('Push: + dated notes line');
const pushChanged = pushNotes !== push.notes || pushRows.some((r, i) => r !== push.exercises[i]);

const pullLat = pull.exercises.find((e) => e.exerciseId === LATERAL);
if (!pullLat) problems.push('Pull Day has no DB Lateral Raise row (superset E)');
if (pullLat && !pullLat.cues?.includes(TEMPO_CUE)) plan.push(`Pull ${pullLat.name} (E): + cue "${TEMPO_CUE}"; baseline kept ${pullLat.baseline?.since} "${pullLat.baseline?.reason}"`);
const pullRows = pull.exercises.map((r) => (r.exerciseId === LATERAL ? withCue(r as Row, TEMPO_CUE) : r));
const pullChanged = pullRows.some((r, i) => r !== pull.exercises[i]);

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp}\n`);
console.log(report.map((l) => `  ${l}`).join('\n'));
console.log(`\nPLAN (${plan.length}):\n${plan.map((l) => `  ${l}`).join('\n') || '  nothing'}`);
if (problems.length) { console.log(`\nREFUSING — drift:\n${problems.map((l) => `  ${l}`).join('\n')}`); process.exit(1); }
if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (!plan.length) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-10-23-push-fixes-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({
  uid, hunger22: hunger22.data() ?? null, session: { id: SESSION, ...ses }, templates: { [PUSH]: push, [PULL]: pull },
}), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
console.log(`\nbackup written: ${backup}`);

const batch = db.batch();
if (h22 == null) batch.set(hunger22.ref, { level: 3 });
if (!existingCalf) batch.set(calfRef, { name: CALF_NAME, muscles: ['calves'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'failure', createdAt: Timestamp.fromDate(now) });
if (nextExercises !== ses.exercises) batch.update(sesSnap.ref, { exercises: JSON.parse(JSON.stringify(nextExercises)), updatedAt: Timestamp.fromDate(now) });
if (pushChanged) batch.update(pushSnap.ref, { exercises: JSON.parse(JSON.stringify(pushRows)), notes: pushNotes, updatedAt: Timestamp.fromDate(now) });
if (pullChanged) batch.update(pullSnap.ref, { exercises: JSON.parse(JSON.stringify(pullRows)), updatedAt: Timestamp.fromDate(now) });
await batch.commit();
console.log('written.');
