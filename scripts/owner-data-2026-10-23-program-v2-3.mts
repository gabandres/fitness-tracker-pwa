/**
 * The owner's Program v2.3 (2026-10-23) — ab hypertrophy: direct ab work on
 * every day, 4 clusters per rotation, loaded and progressive. Applied on top
 * of v2.2 (read first: RDL re-added, Pull superset E, crunch at 20 since the
 * 10/23 fixes). DRY RUN unless `--apply`; re-runs are no-ops; every document
 * it would touch is backed up first. Modelled on
 * `owner-data-2026-10-22-program-v2-2.mts`.
 *
 *   PUSH  Weighted Floor Crunch (A2, with DB Flat Press): 20, ×2, failure —
 *           prescription unchanged. The owner's technique note becomes the
 *           row's cue list (the plate / 25-lb calibration / "go to 35" cues it
 *           replaces contradict it); `incrementLb` 10 → 5 so the row says
 *           what the engine does for a plate lift (20 → 25 → 30).
 *   PULL  superset E becomes a TRI-SET: E1 Leg Extensions 100 ×1 → E2 DB
 *           Lateral Raise 15 ×1 (2–3 s eccentric) → E3 NEW Weighted Floor
 *           Crunch at the Push load ×1; switch 15 s / round 60 s.
 *           Same `exerciseId` as Push — the engine reads history by id (core
 *           `engineHistory`), so both rows read ONE crunch history, and the
 *           same baseline date keeps them reading the same slice of it.
 *   LEG   D3 Hanging Knee Raise → Hanging Leg Raise ×1, failure, BW. The
 *           catalog's own "Hanging leg raise" (jMGQ…, unused in any template)
 *           is the row — a different id is what keeps the knee-raise history
 *           out of its reads. Catalog name capitalised, logStyle/effort set.
 *   ALL   `templateVersion: "v2.3"`; a dated notes line.
 *
 * Baselines: every CHANGED row — the two crunch rows and the leg raise — gets
 * `{ since: 2026-10-24, reason: "context changed: v2.3 ab focus" }`. 10/24,
 * not 10/23: the 10/23 Push session is already logged and is v2.2's read. The
 * export renders it as "baseline since 2026-10-24: context changed: v2.3 ab
 * focus". A session logged later on 10/23 would NOT be read — the script
 * refuses if one exists already.
 *
 * Progression: the engine's ≥ 15 flag (core `REP_FLAG_AT`, Program v2.2)
 * already steps any loaded lift whose activation reaches 15 at its target
 * RIR — both crunch rows get it with no change. A lift at 0 lb is excluded
 * from that flag (`loadNow <= 0`), so the leg raise's "add an ankle weight /
 * DB between the feet" is a cue; its first loaded session is recorded by
 * logging the weight, and the flag applies from then on.
 *
 * Template drafts and sessions are read and reported, never written.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-23-program-v2-3.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`). No rules change:
 * `templateVersion` already accepts any 1–16 char string (v2.2 rules).
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
  clusterCount,
  contextBaseline,
  contextChanges,
  creditsFor,
  dumbbellStepLb,
  estimateTemplateDuration,
  normalizeSupersets,
  plannedVolume,
  restAfterSetInFlow,
  sessionCall,
  supersetFlow,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-23';
const SINCE = '2026-10-24';
const VERSION = 'v2.3';
const FROM_VERSION = 'v2.2';
const REASON = 'context changed: v2.3 ab focus';
const LOAD_REASON = `Program v2.3 (owner, ${DAY})`;
const FAIL_CUE = 'RIR 0 — to failure';

const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const LEG = 'quxwARQlCnItzpLJgcr4';
const TPL_IDS = [LEG, PULL, PUSH];

const EXT = 'hXvPQM7Dv6YvScYW7h2l';
const CURL = 'jZWYnikrGcdRG1adHXJ0';
const KNEE = '8WVjS3nPucY5nQUC6lHM';
const LEG_RAISE = 'jMGQm6C9I6HNNPXPYYLM';
const LATERAL = 'BGyAEJU6i5nN6AjXRU1g';
const CRUNCH = 'x3G0Speg04GclIOdKHAl';
const FLAT = 'ud6fE363QklE3qXYxLw3';

const LEG_RAISE_NAME = 'Hanging Leg Raise';
const CRUNCH_CUES = [
  FAIL_CUE,
  'DB upright on sternum; curl ribs to pelvis, lower back stays down; exhale + 1–2 s squeeze; 2 s down.',
  'Knees bent, feet flat. Felt in the low back instead of the abs = stop the set. NO drop set.',
  'Progression: activation ≥ 15 reps → next load (25, then 30…).',
  '10/23 technique reset at 15 lb DB on chest (20/20, abs felt); progress from 20',
];
const LEG_RAISE_CUES = [
  FAIL_CUE,
  'Legs as straight as possible, tilt the pelvis up at the top (posterior tilt), 2 s down, no swinging.',
  'Progression: activation ≥ 15 reps → add an ankle weight or hold a light DB between the feet; log that load.',
];

const NOTES: Record<string, string> = {
  [LEG]: `${DAY} - Program v2.3 ab focus (owner): superset D3 Hanging Knee Raise → Hanging Leg Raise ×1 (BW, failure; legs straight, posterior tilt at the top, 2 s down, no swing; ≥ 15 → ankle weight / DB between the feet). New baseline — no comparison with the knee-raise history. Baseline "${REASON}" from the first v2.3 Leg Day (on/after ${SINCE}).`,
  [PULL]: `${DAY} - Program v2.3 ab focus (owner): superset E is a TRI-SET — E1 Leg Extensions ×1 (100) → E2 DB Lateral Raise ×1 (15, 2–3 s eccentric) → E3 Weighted Floor Crunch ×1 (the Push load; one history with Push), switch 15 s / round 60 s. Baseline "${REASON}" from the first v2.3 Pull (on/after ${SINCE}).`,
  [PUSH]: `${DAY} - Program v2.3 ab focus (owner): Weighted Floor Crunch (A2) 20 ×2, failure, unchanged — DB upright on sternum; ribs to pelvis, lower back down; exhale + 1–2 s squeeze; 2 s down. Activation ≥ 15 → next load (25, then 30…). Shares its history with Pull E3. Baseline "${REASON}" from the first v2.3 Push (on/after ${SINCE}).`,
};

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();

const [profileSnap, exSnap, sesSnap, draftSnap, ...tplSnaps] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
  user.collection('templateDrafts').get(),
  ...TPL_IDS.map((id) => user.collection('workoutTemplates').doc(id).get()),
]);
for (const s of tplSnaps) if (!s.exists) throw new Error(`template ${s.id} not found`);

type Row = TemplateExercise & Record<string, unknown>;
type RawTpl = { name: string; notes?: string; templateVersion?: string; exercises: Row[] } & Record<string, unknown>;
const raw = new Map(tplSnaps.map((s) => [s.id, s.data() as RawTpl]));
const exDocs = new Map(exSnap.docs.map((d) => [d.id, d]));
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const dbStep = dumbbellStepLb(profileSnap.get('dumbbellHalfSteps') as boolean | undefined);
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const liveBefore: WorkoutTemplate[] = TPL_IDS.map((id) => toWorkoutTemplate(id, raw.get(id)!));

const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp}`);
say(`dumbbell step: ${dbStep} lb`);

// ── refuse on anything the spec does not expect ──
for (const id of [EXT, CURL, KNEE, LEG_RAISE, LATERAL, CRUNCH, FLAT]) if (!catOf(id)) throw new Error(`catalog exercise ${id} missing`);
const versions = TPL_IDS.map((id) => raw.get(id)!.templateVersion);
if (versions.some((v) => v !== FROM_VERSION && v !== VERSION)) throw new Error(`templates are not on ${FROM_VERSION}: ${versions.join(', ')} — apply v2.2 first`);
const onOrAfter = completed.filter((s) => calendarDateKey(s.date) >= SINCE);
if (onOrAfter.length) throw new Error(`${onOrAfter.length} session(s) on/after ${SINCE} — the baseline date needs a decision first`);
// A cardio-only session (a Health walk) carries no lift, so it reads nothing.
const today = completed.filter((s) => calendarDateKey(s.date) === DAY && s.exercises.length > 0);
if (today.some((s) => s.templateId !== PUSH)) throw new Error(`a non-Push lifting session is logged on ${DAY} — it would fall before the ${SINCE} baseline`);
say(`sessions on ${DAY}: ${today.map((s) => `${s.id} (${raw.get(s.templateId ?? '')?.name ?? s.templateId})`).join(', ') || 'none'}`);
const legRaiseUses = TPL_IDS.filter((id) => id !== LEG && raw.get(id)!.exercises.some((r) => r.exerciseId === LEG_RAISE));
if (legRaiseUses.length) throw new Error(`"Hanging leg raise" ${LEG_RAISE} is already in ${legRaiseUses.join(', ')}`);
const legRaiseHistory = completed.filter((s) => s.exercises.some((e) => e.exerciseId === LEG_RAISE));
say(`"${catOf(LEG_RAISE)!.name}" (${LEG_RAISE}): ${legRaiseHistory.length} past session(s)${legRaiseHistory.length ? ` (${legRaiseHistory.map((s) => calendarDateKey(s.date)).join(', ')}) — cut by the ${SINCE} baseline` : ''}`);

// ── helpers ──
const oneCluster = (): PlannedSet[] => [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }];
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const strip = (r: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...x } = r; return stable(x); };
const blockOf = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
const fmtBase = (b?: TemplateExercise['baseline']) => (b ? `${b.since} "${b.reason}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}` : '—');
const shape = (r: TemplateExercise) => `×${clusterCount(r.plannedSets, false)}` + (r.plannedSets.some((s) => s.kind === 'working') ? ' (str)' : '');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const loadEntry = (from: number | undefined, to: number, reason: string) =>
  ({ at: stamp, ...(from != null ? { from } : {}), to, by: 'prompt' as const, reason });

// The catalog as it will be after the write (leg raise renamed + typed).
const legRaiseCat = { ...catOf(LEG_RAISE)!, name: LEG_RAISE_NAME, logStyle: 'weight-reps' as const, effortStandard: 'failure' as const };
const catalogAfter = catalog.map((c) => (c.id === LEG_RAISE ? legRaiseCat : c));
const catAfterOf = (id: string) => catalogAfter.find((c) => c.id === id);
const musclesOf = (id: string) => catAfterOf(id)?.muscles;
const engineCat = (id: string) => { const c = catAfterOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };

// ── 1. build each template ──
const pushCrunch = raw.get(PUSH)!.exercises.find((r) => r.exerciseId === CRUNCH);
if (!pushCrunch) throw new Error('Push Day has no Weighted Floor Crunch row');
if (pushCrunch.supersetGroup !== 'A' || pushCrunch.pairPosition !== 2) throw new Error(`Push crunch is ${blockOf(pushCrunch)}, spec says A2`);
if (raw.get(PUSH)!.exercises.find((r) => r.supersetGroup === 'A' && r.pairPosition === 1)?.exerciseId !== FLAT) throw new Error('Push A1 is not DB Flat Press');
if (pushCrunch.targetLoad !== 20) throw new Error(`Push crunch target ${pushCrunch.targetLoad}, spec says 20 — refusing`);
if (clusterCount(pushCrunch.plannedSets, false) !== 2) throw new Error('Push crunch is not 2 clusters');
if ((catOf(CRUNCH)!.effortStandard ?? 'failure') !== 'failure') throw new Error('crunch catalog effort is not failure');
const CRUNCH_LOAD = pushCrunch.targetLoad;
const crunchShared = { cues: CRUNCH_CUES, progression: { ...(pushCrunch.progression ?? { targetReps: 12, holdSessions: 2 }), incrementLb: 5 } };

const next = new Map<string, RawTpl>();
const changedIds = new Set<string>();
const whyById = new Map<string, string>();
let rowCount = 0;
for (const id of TPL_IDS) {
  const cur = raw.get(id)!;
  let rows: Row[] = cur.exercises.map((r) => structuredClone(r) as Row);
  if (id === LEG) {
    const order = rows.map((r) => `${blockOf(r)}:${r.exerciseId}`).join();
    const i = rows.findIndex((r) => r.exerciseId === KNEE || r.exerciseId === LEG_RAISE);
    if (i < 0) throw new Error(`Leg Day has neither the knee raise nor the leg raise: ${order}`);
    if (rows[i].supersetGroup !== 'D' || rows[i].pairPosition !== 3 || rows[i - 1]?.exerciseId !== CURL) throw new Error(`Leg Day D3 is not after the leg curl: ${order}`);
    if (rows[i].exerciseId === KNEE) {
      const { baseline: _b, excludedReads: _x, loadLog: _l, clusterCountChange: _c, sideLoads: _s, ...keep } = rows[i];
      rows[i] = {
        ...keep,
        exerciseId: LEG_RAISE,
        name: LEG_RAISE_NAME,
        targetLoad: 0,
        logStyle: 'weight-reps',
        plannedSets: oneCluster(),
        cues: LEG_RAISE_CUES,
      } as Row;
    }
  } else if (id === PULL) {
    const e = rows.filter((r) => r.supersetGroup === 'E');
    const ids = e.map((r) => r.exerciseId).join();
    if (ids !== [EXT, LATERAL].join() && ids !== [EXT, LATERAL, CRUNCH].join()) throw new Error(`Pull superset E is not Leg Extensions → Lateral Raise: ${ids}`);
    if (rows.length !== 9 + (ids.endsWith(CRUNCH) ? 1 : 0) || rows.at(-1)!.supersetGroup !== 'E') throw new Error(`Pull Day: expected 7 rows + superset E last, found ${rows.length}`);
    const e1 = rows.find((r) => r.exerciseId === EXT)!;
    const e2 = rows.find((r) => r.exerciseId === LATERAL)!;
    if (e1.targetLoad !== 100 || e2.targetLoad !== 15) throw new Error(`Pull E loads ${e1.targetLoad}/${e2.targetLoad}, spec says 100/15`);
    if (clusterCount(e1.plannedSets, false) !== 1 || clusterCount(e2.plannedSets, false) !== 1 || e2.plannedSets.some((s) => s.kind === 'drop')) throw new Error('Pull E1/E2 are not 1 cluster, no drop');
    if (!e2.cues?.includes('2–3 s eccentric')) throw new Error('Pull E2 lacks the 2–3 s eccentric cue (10/23 fixes not applied?)');
    e1.transitionRestSec = 15;
    e1.roundRestSec = 60;
    if (!ids.endsWith(CRUNCH)) {
      rows.push({
        exerciseId: CRUNCH,
        name: pushCrunch.name,
        targetLoad: CRUNCH_LOAD,
        logStyle: 'weight-reps',
        plannedSets: oneCluster(),
        ...structuredClone(crunchShared),
        supersetGroup: 'E',
        pairPosition: 3,
        loadLog: [loadEntry(undefined, CRUNCH_LOAD, `${LOAD_REASON}: E3 on Pull, the Push crunch load (one history)`)],
      } as Row);
    }
  } else {
    const c = rows.find((r) => r.exerciseId === CRUNCH)!;
    Object.assign(c, structuredClone(crunchShared));
  }
  rows = normalizeSupersets(rows, { keepLetters: true });

  // Baselines: the rows the spec changes — the two crunch rows and the leg
  // raise. Both crunch rows get the SAME since, so they read the same slice
  // of the one crunch history. Core `contextChanges` also names the rows
  // whose superset partners changed (Leg D1/D2, Pull E1/E2); they are
  // performed before the new member, at the same load, and keep their v2.2
  // baseline — no Leg or Pull session has run since it, so nothing is lost,
  // and Pull E2 keeps reading the 10/23 Push lateral (the 10/23 fixes' call).
  const ctx = contextChanges(liveBefore, { id, exercises: rows });
  rows = rows.map((r) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId);
    if (r.exerciseId !== CRUNCH && r.exerciseId !== LEG_RAISE) return r;
    const why = [
      ...(old ? [] : ['new row']),
      ...(r.exerciseId === CRUNCH && old ? ['crunch cues/progression'] : []),
      ...(ctx.get(r.exerciseId) ?? []),
    ];
    if (r.baseline?.reason === REASON) return r;
    const b = contextBaseline(['superset'], { since: SINCE, load: r.targetLoad, catalog: engineCat(r.exerciseId), row: r });
    whyById.set(`${id}:${r.exerciseId}`, why.join('+'));
    return { ...r, baseline: { ...b, reason: REASON } };
  });
  rows = rows.map((r) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId);
    return old && strip(r) === strip(old) ? old : ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
  });
  rowCount += rows.filter((r) => r !== cur.exercises.find((e) => e.exerciseId === r.exerciseId)).length;
  const notes = cur.notes?.includes(`${DAY} - Program v2.3`) ? cur.notes : `${cur.notes ?? ''}\n${NOTES[id]}`.trim();
  if (notes.length > 10000) throw new Error(`${cur.name}: notes would be ${notes.length} chars, over the rules' 10,000`);
  const order = (xs: readonly Row[]) => xs.map((r) => r.exerciseId).join();
  const rowsChanged = order(rows) !== order(cur.exercises) || rows.some((r) => r !== cur.exercises.find((e) => e.exerciseId === r.exerciseId));
  if (rowsChanged || notes !== cur.notes || cur.templateVersion !== VERSION) changedIds.add(id);
  next.set(id, { ...cur, exercises: rows, notes, templateVersion: VERSION });

  // ── report ──
  say(`\n1. ${cur.name} (${id}) — ${rowsChanged ? 'CHANGES' : 'rows unchanged'} · templateVersion ${cur.templateVersion ?? '(none)'} → ${VERSION}${notes !== cur.notes ? ' · + dated notes line' : ''} (notes ${notes.length} chars)`);
  say('   BEFORE');
  cur.exercises.forEach((r, i) => say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(24)} ${shape(r).padEnd(9)} ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}`));
  say('   AFTER');
  rows.forEach((r, i) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId);
    const d: string[] = [];
    if (!old) d.push(r.exerciseId === LEG_RAISE ? 'REPLACES Hanging Knee Raise (new id)' : 'NEW');
    else {
      if (cur.exercises.indexOf(old) !== i) d.push(`pos ${cur.exercises.indexOf(old) + 1}→${i + 1}`);
      if (blockOf(old) !== blockOf(r)) d.push(`block ${blockOf(old)}→${blockOf(r)}`);
      if (shape(old) !== shape(r)) d.push(`${shape(old)}→${shape(r)}`);
      if (old.targetLoad !== r.targetLoad) d.push(`load ${old.targetLoad}→${r.targetLoad}`);
      if (stable(old.cues) !== stable(r.cues)) d.push('cues');
      if (stable(old.progression) !== stable(r.progression)) d.push(`progression ${stable(old.progression)}→${stable(r.progression)}`);
      if (old.transitionRestSec !== r.transitionRestSec || old.roundRestSec !== r.roundRestSec) d.push(`switch/round ${old.transitionRestSec}/${old.roundRestSec}→${r.transitionRestSec}/${r.roundRestSec}`);
    }
    if (stable(old?.baseline) !== stable(r.baseline)) d.push(`BASELINE (${whyById.get(`${id}:${r.exerciseId}`) ?? '?'})`);
    const rest = [r.restAfterSec != null ? `after ${r.restAfterSec}` : '', r.transitionRestSec != null ? `switch ${r.transitionRestSec}` : '', r.roundRestSec != null ? `round ${r.roundRestSec}` : ''].filter(Boolean).join(' ');
    say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(24)} ${shape(r).padEnd(9)} ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}${rest ? `  [${rest}]` : ''}${d.length ? `   ← ${d.join('; ')}` : ''}`);
    if (!old || stable(old.cues) !== stable(r.cues)) say(`         cues: ${JSON.stringify(r.cues ?? [])}`);
  });
  const ctxLine = [...ctx].map(([eid, c]) => `${rows.find((r) => r.exerciseId === eid)?.name}: ${c.join('/')}`);
  say(`   core contextChanges: ${ctxLine.length ? ctxLine.join('; ') : 'none'} (only the ab rows are re-baselined)`);
}
const oldPushCues = pushCrunch.cues ?? [];
say(`\n   Push crunch cues dropped: ${JSON.stringify(oldPushCues.filter((c) => !CRUNCH_CUES.includes(c)))}`);

// ── 1c. catalog ──
say('\n1c. Catalog');
const catalogWrites: { id: string; patch: Record<string, unknown> }[] = [];
const lr = catOf(LEG_RAISE)!;
const lrPatch: Record<string, unknown> = {};
if (lr.name !== LEG_RAISE_NAME) lrPatch.name = LEG_RAISE_NAME;
if (lr.logStyle !== 'weight-reps') lrPatch.logStyle = 'weight-reps';
if (lr.effortStandard !== 'failure') lrPatch.effortStandard = 'failure';
if (Object.keys(lrPatch).length) catalogWrites.push({ id: LEG_RAISE, patch: lrPatch });
say(`   ${lr.name} (${LEG_RAISE}): ${Object.keys(lrPatch).length ? JSON.stringify(lrPatch) : 'already set'} · muscles [${lr.muscles.join(',')}]`);
const cr = catOf(CRUNCH)!;
say(`   ${cr.name}: effortStandard ${cr.effortStandard}, logStyle ${cr.logStyle}, muscles [${cr.muscles.join(',')}] — not changed (its defaultCues still carry the old plate/calibration text; templates do not read them)`);
say(`   ${catOf(KNEE)!.name} (${KNEE}): left in the catalog, no template uses it after this`);

// ── 2. superset flows ──
const after = TPL_IDS.map((id) => toWorkoutTemplate(id, next.get(id)!));
say('\n2. Superset blocks — performed sequence (core supersetFlow), with the rest after each step');
for (const t of after) {
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(flowRows);
  for (const g of [...new Set(flow.filter((s) => s.group).map((s) => s.group!))]) {
    if (!flow.some((s) => s.group === g && [CRUNCH, LEG_RAISE].includes(t.exercises[s.exerciseIndex].exerciseId))) continue;
    say(`   ${t.name} block ${g}:`);
    flow.map((s, k) => ({ s, k })).filter((x) => x.s.group === g).forEach(({ s, k }) => {
      const r = restAfterSetInFlow(flowRows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
      const nextName = flow[k + 1] ? t.exercises[flow[k + 1].exerciseIndex].name : 'Zone 2 / end';
      say(`      ${s.label} ${t.exercises[s.exerciseIndex].name} cluster ${s.unit + 1}   → ${r.kind} ${r.seconds} s → ${nextName}`);
    });
  }
}

// ── 3. estimates ──
say('\n3. Session estimates (core estimateTemplateDuration)');
for (const [i, t] of after.entries()) {
  const eb = estimateTemplateDuration(liveBefore[i], musclesOf);
  const ea = estimateTemplateDuration(t, musclesOf);
  say(`   ${t.name.padEnd(9)} ${eb.minutes} → ${ea.minutes} min   (work ${mmss(eb.clustersSec)} → ${mmss(ea.clustersSec)} · rest ${mmss(eb.restSec)} → ${mmss(ea.restSec)})`);
}

// ── 4. volume ──
say('\n4. Planned per rotation (core plannedVolume — the number Train\'s volume card shows)');
const vb = new Map(plannedVolume(liveBefore, catalog).map((m) => [m.muscle, m]));
const va = new Map(plannedVolume(after, catalogAfter).map((m) => [m.muscle, m]));
say(`   ${'muscle'.padEnd(11)} ${'before'.padStart(7)} ${'after'.padStart(7)}   direct before→after`);
for (const m of ['chest', 'frontDelt', 'sideDelt', 'rearDelt', 'triceps', 'back', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'] as const) {
  const b = vb.get(m)!; const a = va.get(m)!;
  say(`   ${m.padEnd(11)} ${String(b.fractional).padStart(7)} ${String(a.fractional).padStart(7)}${a.fractional !== b.fractional ? ' *' : '  '}  ${b.direct}→${a.direct}`);
}
const absDays = after.filter((t) => t.exercises.some((r) => creditsFor(r.name, musclesOf(r.exerciseId)).some((x) => x.muscle === 'abs')));
say(`   abs frequency: ${absDays.length}×/rotation (${absDays.map((t) => t.name).join(', ')})`);
say('   abs credits per lift:');
for (const t of after) for (const r of t.exercises) {
  const cs = creditsFor(r.name, musclesOf(r.exerciseId));
  if (cs.some((x) => x.muscle === 'abs')) say(`      ${t.name.padEnd(9)} ${r.name.padEnd(24)} ×${clusterCount(r.plannedSets, false)} → ${cs.map((x) => `${x.muscle} ${x.weight}`).join(', ')} per cluster`);
}

// ── 5. engine ──
say('\n5. Engine — next call on each ab row (core sessionCall, v2.3 catalog + baselines)');
for (const t of after) for (const r of t.exercises) {
  if (r.exerciseId !== CRUNCH && r.exerciseId !== LEG_RAISE) continue;
  const { rec, basedOn } = sessionCall(r, completed, engineCat(r.exerciseId));
  const kind = rec.reason && typeof rec.reason === 'object' && 'kind' in rec.reason ? (rec.reason as { kind: string }).kind : '?';
  say(`   ${t.name} · ${r.name}: ${rec.action} ${rec.load ?? '—'} (${kind})${basedOn ? ` from ${calendarDateKey(basedOn)}` : ` — no read yet under the ${SINCE} baseline`}`);
}
const crunchReads = completed.filter((s) => s.exercises.some((e) => e.exerciseId === CRUNCH));
say(`   crunch history (one id, read by both rows): ${crunchReads.length} session(s), latest ${crunchReads[0] ? `${calendarDateKey(crunchReads[0].date)} (${raw.get(crunchReads[0].templateId ?? '')?.name})` : '—'}; both rows cut it at ${SINCE}`);

// ── 6. sample export ──
say('\n6. Sample export — the changed ab rows (core buildCsv)');
const effortStandards = Object.fromEntries(catalogAfter.map((c) => [c.id!, c.effortStandard]));
const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: after, effortStandards });
const [head, ...lines] = csv.split(/\r?\n/);
const cols = head.split(',');
const want = ['template', 'exercise', 'load', 'clusters', 'effortStandard', 'rirTarget', 'supersetBlock', 'supersetOrder', 'transitionSec', 'roundRestSec', 'templateVersion', 'notes'];
const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
say(`   ${want.join(',')}`);
for (const l of lines.filter((x) => x.startsWith('template,'))) {
  const c = cells(l);
  if (!/Crunch|Leg Raise|^Leg Extensions$|DB Lateral Raise|Leg Curls/.test(c[cols.indexOf('exercise')] ?? '')) continue;
  say(`   ${want.map((w) => { const v = c[cols.indexOf(w)] ?? ''; return v.includes(',') ? `"${v}"` : v; }).join(',')}`);
}

// ── 7. drafts ──
say('\n7. Template drafts (read only — not touched)');
for (const d of draftSnap.docs) {
  const x = d.data();
  say(`   ${d.id} "${x.label}" status=${x.status} draftOf=${x.draftOf}`);
}

// ── backup + write ──
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-10-23-program-v2-3-${stamp.replace(/[:.]/g, '-')}.json`);
say(`\n8. Backup: ${APPLY ? '' : '(would write) '}${backup}`);
say(`\nSUMMARY: ${rowCount} template row(s) changed in ${changedIds.size} template(s) [${[...changedIds].map((id) => raw.get(id)!.name).join(', ') || 'none'}] + ${catalogWrites.length} catalog exercise(s); 0 drafts, 0 sessions.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (changedIds.size === 0 && catalogWrites.length === 0) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({
  uid,
  templates: Object.fromEntries(TPL_IDS.map((id) => [id, raw.get(id)])),
  exercises: Object.fromEntries(catalogWrites.map((w) => [w.id, exDocs.get(w.id)!.data()])),
  templateDrafts: draftSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
}), null, 1));
if (!existsSync(backup)) throw new Error(`backup ${backup} not written — refusing to write`);
console.log(`backup written: ${backup}`);

const batch = db.batch();
for (const id of changedIds) {
  const t = next.get(id)!;
  batch.update(user.collection('workoutTemplates').doc(id), {
    exercises: JSON.parse(JSON.stringify(t.exercises)), notes: t.notes, templateVersion: VERSION, updatedAt: Timestamp.fromDate(now),
  });
}
for (const w of catalogWrites) batch.update(user.collection('exercises').doc(w.id), w.patch);
await batch.commit();

for (const id of changedIds) {
  const t = toWorkoutTemplate(id, (await user.collection('workoutTemplates').doc(id).get()).data()!);
  console.log(`written ${t.name} [${t.templateVersion}]: ${t.exercises.map((r) => `${blockOf(r)} ${r.name} ${shape(r)}@${r.targetLoad}`).join(' · ')} — ${estimateTemplateDuration(t, musclesOf).minutes} min`);
}
console.log(`written ${catalogWrites.length} catalog exercise(s)`);
