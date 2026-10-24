/**
 * Stephanie's Program S-v2 (owner, 2026-10-24), effective from her next
 * session. DRY RUN unless `--apply`; re-runs are no-ops; everything it touches
 * is backed up to ~/ignia-backups first.
 *
 * Why (stored as the program note on each template): loads frozen ~6 weeks
 * (pulldown 40, rows 10, goblet 15, RDL 10, hip thrust 20, ext/curl 40), every
 * set exactly 10 reps with no RIR → far from failure; 180 s rest on everything
 * → the 10/23 session ran 70 min. S-v2: rep ranges at RIR 2, non-competing
 * supersets, double progression.
 *
 * Writes:
 *   - three NEW templates `stph-sv2-day-{1,2,3}` (templateVersion "S-v2"):
 *     straight sets in `plannedSets` (reps = range bottom, repsMax = top),
 *     `progression { targetReps: top, holdSessions: 1, incrementLb }` — core
 *     `recommendStraight` adds load when every working set holds the top at
 *     the target RIR (rir2: 12 reps @ RIR 2 holds 12, @ RIR 1 does not).
 *     Supersets: switch 60 s, round 75 s; 90 s after a block / between a
 *     single lift's sets. No template-level restMiniSec / restClusterSec.
 *     Every row: baseline { since 2026-10-24, "context changed: S-v2 (rep
 *     range + RIR 2)" } — no drop floor (S-v2 loads go UP on purpose), so the
 *     fixed-10 history is never read as a regression; charts keep it.
 *   - catalog: 4 new lifts (Smith Hip Thrust (pad), Incline DB Press, DB
 *     Reverse Lunge, DB Flat Press); "Supported Dumbbell Rows" renamed
 *     "Chest-Supported DB Row" (same id → history carried); effortStandard
 *     rir2 on every loaded S-v2 lift; Seated Bicep Curls gets a dumbbell rack
 *     (its name does not read as a dumbbell, so +5 would land on 17).
 *   - profile: targetMode custom, 1,500 kcal / 110 g (was manual 1,640 in
 *     auto mode, where the floor gave 1,500); dumbbellHalfSteps false (+5 lb).
 *
 * Smith hip thrust: the schema has one load number, so `targetLoad` is the
 * PLATES total (10/side = 20, 5/side = 10) and the cue says per side + bar.
 * `smithBarEffectiveLb` is left unset (bar unknown = 0 in the load; the
 * engine marks its predictions approximate). Both days share the id, so one
 * history. +5/side = incrementLb 10.
 *
 * Old templates "Day 1 - Lower + Push", "Day 2 - Pull + Arms", "Day 3 -
 * Posterior Chain + Core" are NOT touched unless `--archive`, which sets
 * `archivedAt`. Run `--archive` only AFTER the rules allowing `archivedAt`
 * are deployed (branch feat/s-v2-training): rules validate the whole
 * document, so an unknown key would make every client save of them fail.
 * Nothing is deleted; sessions and the removed lifts (Incline Bench Push-Up,
 * Pallof Press) stay in the library.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/user-data-2026-10-24-stephanie-s-v2.mts [--apply] [--archive]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  buildCsv,
  calendarDateKey,
  creditsFor,
  dumbbellStepLb,
  estimateTemplateDuration,
  hardSetCount,
  plannedHardSets,
  restAfterSetInFlow,
  sessionCall,
  supersetFlow,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const EMAIL = 'stph.ctllo@gmail.com';
const DAY = '2026-10-24';
const SINCE = '2026-10-24';
const VERSION = 'S-v2';
const REASON = 'context changed: S-v2 (rep range + RIR 2)';
const LOAD_REASON = `Program S-v2 (owner, ${DAY})`;
const OLD_IDS = ['stph-day-1', 'stph-day-2', 'stph-day-3'];
const OLD_NAMES = ['Day 1 - Lower + Push', 'Day 2 - Pull + Arms', 'Day 3 - Posterior Chain + Core'];
const SWITCH = 60;
const ROUND = 75;
const AFTER = 90;

const RIR_CUE = 'RIR 2 — stop 2 reps short (the last set may be RIR 1). Log RIR on the last set.';
const CAL_CUE = 'First S-v2 session = calibration: if set 1 beats the top of the range by 3+, raise the load now.';

const WHY = `${DAY} - Program S-v2 (owner). WHY: loads frozen ~6 weeks (pulldown 40, rows 10, goblet 15, RDL 10, hip thrust 20, ext/curl 40). Every set exactly 10 reps, no RIR logged → far from failure. 180 s rest on everything → the 10/23 session ran 70 min. NEW: rep ranges at RIR 2, non-competing supersets, double progression.
FORMAT: straight sets. Supersets A1 ↔ A2: 60 s between them, 75 s before the next round; 90 s after each block and between sets of a single lift.
RIR 2 on every set (the last set may be RIR 1). LOG RIR ON THE LAST SET of each lift. Planks / dead bugs: no RIR — log time / reps.
PROGRESSION: when ALL sets reach the TOP of the range at RIR 2 → the app adds load next session (+5 lb dumbbell, +1 pin on machines, +5 per side on the Smith).
SESSION 1 IS CALIBRATION: if set 1 beats the top of the range by 3+ reps, raise the load in that session.
Old fixed-10 sets are history, not a baseline: every lift starts a new baseline on the first S-v2 session (on/after ${SINCE}).`;

// ── the spec ──
type Equip = 'db' | 'machine' | 'smith' | 'other' | 'bw' | 'time';
interface Spec {
  id: string; name?: string; block?: string; pos?: 1 | 2 | 3;
  sets: number; min: number; max: number; load?: number; equip: Equip;
  cues?: string[]; durationSec?: number;
}
const INC: Record<Equip, number | undefined> = { db: 5, machine: 10, smith: 10, other: 5, bw: undefined, time: undefined };
const DAYS: { id: string; name: string; rows: Spec[] }[] = [
  {
    id: 'stph-sv2-day-1', name: 'S-v2 Day 1 — Squat + Glutes', rows: [
      { id: 'stph-goblet-squat', block: 'A', pos: 1, sets: 3, min: 8, max: 12, load: 20, equip: 'other' },
      { id: 'stph-wide-lat-pulldown', block: 'A', pos: 2, sets: 3, min: 10, max: 12, load: 50, equip: 'machine' },
      { id: 'stph-smith-hip-thrust', block: 'B', pos: 1, sets: 3, min: 8, max: 12, load: 20, equip: 'smith', cues: ['Load = 10 lb per side + the bar (logged as the plates total, 20). Pad on the hips.'] },
      { id: 'stph-incline-db-press', block: 'B', pos: 2, sets: 3, min: 10, max: 12, load: 10, equip: 'db', cues: ['Load is per hand.'] },
      { id: 'stph-leg-curl', block: 'C', pos: 1, sets: 2, min: 10, max: 15, load: 50, equip: 'machine' },
      { id: 'stph-dead-bug', block: 'C', pos: 2, sets: 2, min: 8, max: 8, equip: 'bw', cues: ['8 per side. Lower back flat. Log reps per side; no RIR.'] },
    ],
  },
  {
    id: 'stph-sv2-day-2', name: 'S-v2 Day 2 — Hinge + Back', rows: [
      { id: 'stph-db-rdl', block: 'A', pos: 1, sets: 3, min: 8, max: 12, load: 20, equip: 'db', cues: ['Hips back, DBs on thighs, neutral back, stop at mid-shin.', 'Load is per hand.'] },
      { id: 'stph-seated-db-ohp', block: 'A', pos: 2, sets: 3, min: 10, max: 12, load: 10, equip: 'db', cues: ['Seated. Load is per hand.'] },
      { id: 'stph-seated-cable-row', block: 'B', pos: 1, sets: 3, min: 10, max: 12, load: 50, equip: 'machine' },
      { id: 'stph-db-reverse-lunge', block: 'B', pos: 2, sets: 2, min: 10, max: 10, load: 10, equip: 'db', cues: ['10 per leg. Load is per hand. Log the reps per leg.'] },
      { id: 'stph-leg-extension', block: 'C', pos: 1, sets: 2, min: 12, max: 15, load: 50, equip: 'machine' },
      { id: 'stph-plank', block: 'C', pos: 2, sets: 2, min: 30, max: 45, equip: 'time', durationSec: 30, cues: ['30–45 s. Log the time; no RIR.'] },
    ],
  },
  {
    id: 'stph-sv2-day-3', name: 'S-v2 Day 3 — Glutes + Upper + Arms', rows: [
      { id: 'stph-smith-hip-thrust', block: 'A', pos: 1, sets: 3, min: 12, max: 15, load: 10, equip: 'smith', cues: ['Load = 5 lb per side + the bar (logged as the plates total, 10). Same lift as Day 1 — one history.'] },
      { id: 'stph-supported-db-row', name: 'Chest-Supported DB Row', block: 'A', pos: 2, sets: 3, min: 10, max: 12, load: 15, equip: 'db', cues: ['Load is per hand. Replaces "Supported Dumbbell Rows" — same lift, history carried.'] },
      { id: 'stph-leg-curl', block: 'B', pos: 1, sets: 2, min: 10, max: 15, load: 50, equip: 'machine', cues: ['Same lift as Day 1 — one history.'] },
      { id: 'stph-db-flat-press', block: 'B', pos: 2, sets: 2, min: 10, max: 12, load: 10, equip: 'db', cues: ['Load is per hand.'] },
      { id: 'stph-seated-bicep-curl', block: 'C', pos: 1, sets: 2, min: 10, max: 12, load: 12, equip: 'db', cues: ['Seated. Load is per hand.'] },
      { id: 'stph-single-db-tricep-ext', block: 'C', pos: 2, sets: 2, min: 10, max: 12, load: 12, equip: 'db', cues: ['Seated, overhead, one dumbbell.'] },
      { id: 'stph-db-lateral-raise', sets: 2, min: 12, max: 15, load: 5, equip: 'db', cues: ['Single lift: 90 s between sets.'] },
    ],
  },
];
const NEW_CATALOG: Record<string, { name: string; muscles: string[] }> = {
  'stph-smith-hip-thrust': { name: 'Smith Hip Thrust (pad)', muscles: ['glutes', 'hamstrings'] },
  'stph-incline-db-press': { name: 'Incline DB Press', muscles: ['chest', 'shoulders', 'triceps'] },
  'stph-db-reverse-lunge': { name: 'DB Reverse Lunge', muscles: ['quads', 'glutes'] },
  'stph-db-flat-press': { name: 'DB Flat Press', muscles: ['chest', 'triceps'] },
};
const RENAME: Record<string, string> = { 'stph-supported-db-row': 'Chest-Supported DB Row' };
// Seated Bicep Curls: the name has no "DB"/"dumbbell", so the engine would
// step +5 off any load (12 → 17). A rack list makes it step 12 → 15.
const RACKS: Record<string, number[]> = { 'stph-seated-bicep-curl': [5, 8, 10, 12, 15, 20, 25, 30] };

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ARCHIVE = args.includes('--archive');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(EMAIL)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();

const [profileSnap, exSnap, sesSnap, ...tplSnaps] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
  ...[...OLD_IDS, ...DAYS.map((d) => d.id)].map((id) => user.collection('workoutTemplates').doc(id).get()),
]);
const oldSnaps = tplSnaps.slice(0, 3);
const newSnaps = tplSnaps.slice(3);
const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'}${ARCHIVE ? ' +archive' : ''} — ${EMAIL} uid ${uid} — ${stamp}`);

// ── refuse on drift ──
oldSnaps.forEach((s, i) => {
  if (!s.exists) throw new Error(`old template ${OLD_IDS[i]} missing`);
  if (s.get('name') !== OLD_NAMES[i]) throw new Error(`${OLD_IDS[i]} is "${s.get('name')}", expected "${OLD_NAMES[i]}"`);
});
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const lifted = completed.filter((s) => calendarDateKey(s.date) >= SINCE && s.exercises.length > 0);
if (lifted.length) throw new Error(`${lifted.length} lifting session(s) on/after ${SINCE} — the baseline date needs a decision first`);
const exDocs = new Map(exSnap.docs.map((d) => [d.id, d]));
for (const d of DAYS) for (const r of d.rows) if (!exDocs.has(r.id) && !NEW_CATALOG[r.id]) throw new Error(`catalog ${r.id} missing`);
for (const id of Object.keys(NEW_CATALOG)) if (exDocs.has(id) && exDocs.get(id)!.get('name') !== NEW_CATALOG[id].name) throw new Error(`catalog ${id} exists as "${exDocs.get(id)!.get('name')}"`);
for (const id of ['stph-incline-bench-pushup', 'stph-pallof-press', 'stph-db-hip-thrust']) if (!exDocs.has(id)) throw new Error(`library lift ${id} missing — it must stay`);

// ── catalog after ──
type CatPatch = { id: string; create?: Record<string, unknown>; patch?: Record<string, unknown> };
const catWrites: CatPatch[] = [];
const loaded = new Set(DAYS.flatMap((d) => d.rows.filter((r) => r.equip !== 'bw' && r.equip !== 'time').map((r) => r.id)));
for (const [id, c] of Object.entries(NEW_CATALOG)) {
  if (!exDocs.has(id)) catWrites.push({ id, create: { name: c.name, muscles: c.muscles, defaultCues: [], logStyle: 'weight-reps', effortStandard: 'rir2', setStructure: 'straight', createdAt: Timestamp.fromDate(now) } });
}
for (const id of loaded) {
  const d = exDocs.get(id);
  if (!d) continue;
  const patch: Record<string, unknown> = {};
  if (d.get('effortStandard') !== 'rir2') patch.effortStandard = 'rir2';
  if (RENAME[id] && d.get('name') !== RENAME[id]) patch.name = RENAME[id];
  if (RACKS[id] && JSON.stringify(d.get('availableLoads')) !== JSON.stringify(RACKS[id])) patch.availableLoads = RACKS[id];
  if (Object.keys(patch).length) catWrites.push({ id, patch });
}
const catalogAfter: Exercise[] = [
  ...exSnap.docs.map((d) => {
    const w = catWrites.find((x) => x.id === d.id);
    return toWorkoutExercise(d.id, { ...d.data(), ...(w?.patch ?? {}) });
  }),
  ...catWrites.filter((w) => w.create).map((w) => toWorkoutExercise(w.id, w.create!)),
];
const catOf = (id: string) => catalogAfter.find((c) => c.id === id)!;
const musclesOf = (id: string) => catalogAfter.find((c) => c.id === id)?.muscles;
const dbStep = dumbbellStepLb(false);
const engineCat = (id: string) => ({ ...catOf(id), dumbbellStepLb: dbStep });

// ── build the templates ──
type Row = TemplateExercise & Record<string, unknown>;
const working = (s: Spec): PlannedSet[] => Array.from({ length: s.sets }, () => (
  s.equip === 'time'
    ? { kind: 'working', durationSec: s.durationSec }
    : { kind: 'working', reps: s.min, ...(s.max !== s.min ? { repsMax: s.max } : {}), ...(s.load != null ? { weight: s.load } : {}) }
) as PlannedSet);
function buildRow(s: Spec, d: (typeof DAYS)[number]): Row {
  const c = catOf(s.id);
  const leader = s.pos === 1;
  const blockSize = s.block ? d.rows.filter((r) => r.block === s.block).length : 0;
  const lastOfBlock = s.block ? d.rows.filter((r) => r.block === s.block).at(-1) === s : true;
  const partnerSets = s.block ? Math.max(...d.rows.filter((r) => r.block === s.block).map((r) => r.sets)) : 0;
  const rir = s.equip !== 'bw' && s.equip !== 'time';
  const inc = INC[s.equip];
  return {
    exerciseId: s.id,
    name: s.name ?? c.name,
    ...(s.load != null ? { targetLoad: s.load } : s.equip === 'bw' ? { targetLoad: 0 } : {}),
    logStyle: s.equip === 'time' ? 'time' : s.equip === 'bw' ? 'bodyweight' : 'weight-reps',
    setStructure: 'straight',
    plannedSets: working(s),
    ...(s.equip !== 'time' ? { progression: { targetReps: s.max, holdSessions: 1, ...(inc != null ? { incrementLb: inc } : {}) } } : {}),
    cues: [...(rir ? [RIR_CUE] : []), ...(s.cues ?? []), ...(rir ? [CAL_CUE] : [])],
    ...(s.block ? { supersetGroup: s.block, pairPosition: s.pos } : {}),
    ...(s.block && leader && blockSize > 1 ? { transitionRestSec: SWITCH, roundRestSec: ROUND } : {}),
    // A member with sets left after its partner finished rests this long
    // (core `restAfterSetInFlow` reads `restClusterSec` for a lone set).
    ...(s.block && s.sets === partnerSets && d.rows.some((r) => r.block === s.block && r.sets < s.sets) ? { restClusterSec: ROUND } : {}),
    ...(lastOfBlock ? { restAfterSec: AFTER } : {}),
    ...(!s.block ? { restMiniSec: AFTER } : {}),
    baseline: { since: SINCE, reason: REASON },
    ...(s.load != null ? { loadLog: [{ at: stamp, to: s.load, by: 'prompt', reason: `${LOAD_REASON}: start ${s.load}` }] } : {}),
    lastModifiedAt: stamp,
    lastModifiedBy: 'prompt',
  } as Row;
}
const newDocs = DAYS.map((d) => ({
  id: d.id,
  body: {
    name: d.name,
    notes: WHY,
    templateVersion: VERSION,
    exercises: d.rows.map((r) => buildRow(r, d)),
  },
}));
const toCreate = newDocs.filter((_, i) => !newSnaps[i].exists);
newDocs.forEach((d, i) => { if (newSnaps[i].exists && newSnaps[i].get('templateVersion') !== VERSION) throw new Error(`${d.id} exists and is not S-v2`); });

// ── profile ──
const prof = profileSnap.data()!;
const profPatch: Record<string, unknown> = {};
if (prof.targetMode !== 'custom') profPatch.targetMode = 'custom';
if (prof.manualCaloriesTarget !== 1500) profPatch.manualCaloriesTarget = 1500;
if (prof.manualProteinTarget !== 110) profPatch.manualProteinTarget = 110;
if (prof.dumbbellHalfSteps !== false) profPatch.dumbbellHalfSteps = false;

// ── archive ──
const archiveIds = ARCHIVE ? OLD_IDS.filter((_, i) => !oldSnaps[i].get('archivedAt')) : [];

// ── report: before ──
const oldTpls: WorkoutTemplate[] = oldSnaps.map((s) => toWorkoutTemplate(s.id, s.data()!));
const fmtSets = (r: TemplateExercise) => {
  const w = r.plannedSets.filter((s) => s.kind === 'working');
  if (!w.length) return '—';
  const s0 = w[0];
  if (s0.durationSec != null) return `${w.length}×${s0.durationSec}s`;
  return `${w.length}×${s0.reps}${s0.repsMax != null && s0.repsMax !== s0.reps ? `–${s0.repsMax}` : ''}`;
};
const blk = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
say('\nBEFORE (archived-to-be; rest: template restMiniSec / restClusterSec)');
for (const t of oldTpls) {
  say(`  ${t.name} [${t.id}] rest mini ${t.restMiniSec} / cluster ${t.restClusterSec} · ${estimateTemplateDuration(t, musclesOf).minutes} min est.`);
  for (const r of t.exercises) say(`     ${r.name.padEnd(34)} ${fmtSets(r).padEnd(8)} @ ${r.targetLoad ?? 'BW'}`);
}
const lastLoads = new Map<string, string>();
for (const s of [...completed].reverse()) for (const e of s.exercises) {
  const w = e.sets.filter((x) => x.weight != null || x.reps != null || x.durationSec != null);
  if (w.length) lastLoads.set(e.exerciseId, `${calendarDateKey(s.date)} ${w.map((x) => `${x.weight ?? 'BW'}×${x.reps ?? x.durationSec}`).join(' ')}`);
}

say('\nAFTER');
const after: WorkoutTemplate[] = newDocs.map((d) => toWorkoutTemplate(d.id, d.body));
for (const t of after) {
  say(`  ${t.name} [${t.id}] · ${estimateTemplateDuration(t, musclesOf).minutes} min est.`);
  for (const r of t.exercises) {
    const rest = [r.transitionRestSec != null ? `switch ${r.transitionRestSec}` : '', r.roundRestSec != null ? `round ${r.roundRestSec}` : '', r.restClusterSec != null ? `lone-set ${r.restClusterSec}` : '', r.restMiniSec != null ? `between sets ${r.restMiniSec}` : '', r.restAfterSec != null ? `after ${r.restAfterSec}` : ''].filter(Boolean).join(' ');
    const isNew = !exDocs.has(r.exerciseId);
    say(`     ${blk(r).padEnd(3)} ${r.name.padEnd(30)} ${fmtSets(r).padEnd(8)} @ ${String(r.targetLoad ?? 'BW').padEnd(4)} +${r.progression?.incrementLb ?? '—'}  [${rest}]${isNew ? '  NEW LIFT' : ''}`);
    say(`         last logged: ${lastLoads.get(r.exerciseId) ?? 'never'}`);
  }
}

say('\nSuperset flow, Day 2 (block B has 3 vs 2 sets):');
{
  const t = after[1];
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(flowRows);
  flow.forEach((s, k) => {
    const r = restAfterSetInFlow(flowRows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
    const nx = flow[k + 1] ? t.exercises[flow[k + 1].exerciseIndex].name : 'end';
    if (t.exercises[s.exerciseIndex].supersetGroup === 'B') say(`   ${s.label} ${t.exercises[s.exerciseIndex].name} set ${s.unit + 1} → ${r.kind} ${r.seconds} s → ${nx}`);
  });
}

say('\nCatalog');
for (const w of catWrites) say(`   ${w.id}: ${w.create ? `CREATE ${JSON.stringify({ ...w.create, createdAt: undefined })}` : `PATCH ${JSON.stringify(w.patch)}`}`);
say('   kept in the library, in no S-v2 template: Incline Bench Push-Up, Pallof Press, Dumbbell Hip Thrust, Plank stays (Day 2), Dead Bug stays (Day 1)');
say(`\nProfile: ${Object.keys(profPatch).length ? JSON.stringify(profPatch) : 'already set'} (was targetMode ${prof.targetMode ?? '(absent = auto)'}, manual ${prof.manualCaloriesTarget}/${prof.manualProteinTarget}, dumbbellHalfSteps ${prof.dumbbellHalfSteps ?? '(absent = 2.5 lb)'})`);
say(`Archive: ${ARCHIVE ? (archiveIds.length ? `archivedAt on ${archiveIds.join(', ')}` : 'already archived') : 'NOT this run (needs the archivedAt rules deployed; re-run with --archive)'}`);

// ── engine ──
say('\nEngine — first call per S-v2 row (core sessionCall, after the write)');
for (const t of after) for (const r of t.exercises) {
  const { rec } = sessionCall(r, completed, engineCat(r.exerciseId));
  const kind = rec.reason && typeof rec.reason === 'object' && 'kind' in rec.reason ? (rec.reason as { kind: string }).kind : '?';
  say(`   ${t.name.slice(5, 11)} ${r.name.padEnd(30)} ${rec.action} ${rec.load ?? ''} (${kind})`);
}

// ── volume ──
say('\nWeekly volume (3 days = 1 rotation/week; straight sets 1:1; compound primary 1 + secondary 0.5) — core plannedHardSets');
const vol = plannedHardSets(after, catalogAfter);
for (const m of vol.filter((v) => v.fractional > 0 || v.direct > 0)) say(`   ${m.muscle.padEnd(11)} fractional ${String(m.fractional).padStart(5)}   direct ${m.direct}`);
say('   credits per lift:');
for (const t of after) for (const r of t.exercises) say(`      ${t.name.slice(5, 11)} ${r.name.padEnd(30)} ×${hardSetCount(r.plannedSets, r.logStyle ?? 'weight-reps', false)} → ${creditsFor(r.name, musclesOf(r.exerciseId)).map((x) => `${x.muscle} ${x.weight}`).join(', ') || 'NONE'}`);

// ── export ──
say('\nSample export — S-v2 Day 1 (core buildCsv, template rows)');
const effortStandards = Object.fromEntries(catalogAfter.map((c) => [c.id!, c.effortStandard]));
const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: [after[0]], effortStandards });
for (const l of csv.split(/\r?\n/).filter((l, i) => i === 0 || l.startsWith('template,'))) say(`   ${l}`);

say(`\nSUMMARY: ${toCreate.length} template(s) to create, ${catWrites.length} catalog write(s), profile ${Object.keys(profPatch).length} field(s), ${archiveIds.length} archived; 0 sessions, 0 deletes.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (!toCreate.length && !catWrites.length && !Object.keys(profPatch).length && !archiveIds.length) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `user-data-2026-10-24-stephanie-s-v2-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({
  uid,
  profile: Object.fromEntries(Object.keys(profPatch).map((k) => [k, prof[k] ?? null])),
  oldTemplates: Object.fromEntries(oldSnaps.map((s) => [s.id, s.data()])),
  exercises: Object.fromEntries(catWrites.filter((w) => w.patch).map((w) => [w.id, exDocs.get(w.id)!.data()])),
}), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
console.log(`\nbackup written: ${backup}`);

const batch = db.batch();
for (const d of toCreate) batch.set(user.collection('workoutTemplates').doc(d.id), { ...JSON.parse(JSON.stringify(d.body)), createdAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) });
for (const w of catWrites) {
  if (w.create) batch.set(user.collection('exercises').doc(w.id), w.create);
  else batch.update(user.collection('exercises').doc(w.id), w.patch!);
}
if (Object.keys(profPatch).length) batch.update(user, profPatch);
for (const id of archiveIds) batch.update(user.collection('workoutTemplates').doc(id), { archivedAt: Timestamp.fromDate(now) });
await batch.commit();
console.log(`written: ${toCreate.map((d) => d.body.name).join(', ') || 'no templates'}; ${catWrites.length} catalog; profile ${Object.keys(profPatch).join(', ') || '—'}; archived ${archiveIds.join(', ') || '—'}`);
