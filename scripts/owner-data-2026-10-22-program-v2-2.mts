/**
 * The owner's Program v2.2 (2026-10-22), effective from each template's next
 * session. DRY RUN unless `--apply`; re-runs are no-ops; every document it
 * would touch is backed up first (on `--apply`). Modelled on
 * `owner-data-2026-10-15-program-v2-1.mts`.
 *
 *   LEG   Smith squat ×2 (35) — unchanged
 *         DB Romanian deadlift — RE-ADDED at position 2: STRAIGHT sets, 2 × 8-12
 *           at 35 per hand, RIR 2, 120 s between sets (`restMiniSec`, the
 *           field the timer uses between straight sets), progression
 *           { targetReps 12, holdSessions 1 } so it steps only when BOTH sets
 *           hold 12 at RIR 2 (core `recommendStraight`, Program v2.2). Catalog
 *           effortStandard rir1 → rir2. Low-back rule as a cue.
 *         superset D: Leg Extensions ×1 (100) → Leg Curls ×3 → 2 (100)
 *           → Hanging Knee Raise ×1 (BW); Zone 2.
 *   PULL  rows 1-7 unchanged (Incline DB Curl is already 20 since 10/21)
 *         NEW superset E: Leg Extensions ×1 (100) → DB Lateral Raise ×1 (15, no
 *           drop), switch 15 s / round 60 s; Zone 2.
 *   PUSH  rows unchanged; Weighted Floor Crunch 30 → 15 (technique test, then
 *         the engine's normal progression from what is read).
 *   ALL   `templateVersion: "v2.2"`; a dated notes line.
 *
 * Baselines: every CHANGED row — new, moved (core `contextChanges`), cluster
 * count changed, or load changed — gets `{ since: 2026-10-22, reason:
 * "context changed: v2.2" }` with core `contextBaseline`'s drop-back floor;
 * reads before it are history. No session is logged yet on 10/22, so the first
 * v2.2 session of each template, today or later, is the first read. The export
 * renders it as "baseline since 2026-10-22: context changed: v2.2". A load
 * change is also a `loadLog` entry by `prompt`, so `honourLifterLoad` holds it.
 *
 * Template drafts and sessions are read and reported, never written.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-22-program-v2-2.mts --email gabrielandresbermudez@gmail.com [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`). Needs the v2.2 rules
 * (`rir2`, template `templateVersion`) deployed FIRST: rules validate the whole
 * document, so a field they do not know would make every client save fail.
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
  plannedHardSets,
  plannedVolume,
  restAfterSetInFlow,
  rotationVolume,
  sessionCall,
  supersetFlow,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-22';
const SINCE = '2026-10-22';
const VERSION = 'v2.2';
const REASON = 'context changed: v2.2';
const LOAD_REASON = `Program v2.2 (owner, ${DAY})`;
const RIR2_CUE = 'RIR 2 — stop 2 reps short';
const FAIL_CUE = 'RIR 0 — to failure';
const RDL_RULE = 'Low-back rule: stop if sharp pain or >3/10; swap to hip thrust. Progress only when both sets = 12 @ RIR 2 pain-free.';

const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const LEG = 'quxwARQlCnItzpLJgcr4';
const TPL_IDS = [LEG, PULL, PUSH];

const SQUAT = 'eKW1qiIDpvfnSECIxSUn';
const RDL = 'vtSvqglnBZdM1f3qOJi4';
const EXT = 'hXvPQM7Dv6YvScYW7h2l';
const CURL = 'jZWYnikrGcdRG1adHXJ0';
const KNEE = '8WVjS3nPucY5nQUC6lHM';
const LATERAL = 'BGyAEJU6i5nN6AjXRU1g';
const CRUNCH = 'x3G0Speg04GclIOdKHAl';

const NOTES: Record<string, string> = {
  [LEG]: `${DAY} - Program v2.2 (owner): Smith squat ×2 (35) · DB Romanian deadlift RE-ADDED: straight 2 × 8-12 @ 35/hand, RIR 2, 120 s between sets (low-back rule: stop on sharp pain or >3/10 → hip thrust; progress only when both sets = 12 @ RIR 2 pain-free) · superset D Leg Extensions ×1 (100) → Leg Curls ×2 (100, was 3) → Hanging Knee Raise ×1 (BW); Zone 2 20 min. Baseline "${REASON}" from the first v2.2 Leg Day (on/after ${SINCE}).`,
  [PULL]: `${DAY} - Program v2.2 (owner): rows unchanged (Incline DB Curl at 20 since 10/21) · NEW superset E Leg Extensions ×1 (100) → DB Lateral Raise ×1 (15, no drop), switch 15 s / round 60 s; Zone 2 20 min. Baseline "${REASON}" on E from the first v2.2 Pull (on/after ${SINCE}).`,
  [PUSH]: `${DAY} - Program v2.2 (owner): no exercise changes; presses rir1 on the activation; Weighted Floor Crunch 30 → 15 for the next session (technique test), then the engine's normal progression. Baseline "${REASON}" on the crunch from the first v2.2 Push (on/after ${SINCE}).`,
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
const musclesOf = (id: string) => catOf(id)?.muscles;
const dbStep = dumbbellStepLb(profileSnap.get('dumbbellHalfSteps') as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
const liveBefore: WorkoutTemplate[] = TPL_IDS.map((id) => toWorkoutTemplate(id, raw.get(id)!));

const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp}`);
say(`dumbbell step: ${dbStep} lb`);

// Refuse on anything the spec does not expect: a v2.2 session already logged,
// a missing catalog lift, or a live row the spec does not name.
const loggedToday = completed.filter((s) => calendarDateKey(s.date) >= SINCE && TPL_IDS.includes(s.templateId ?? ''));
if (loggedToday.length) throw new Error(`a session on/after ${SINCE} already exists for a v2.2 template — the baseline date needs a decision first`);
for (const id of [SQUAT, RDL, EXT, CURL, KNEE, LATERAL, CRUNCH]) if (!catOf(id)) throw new Error(`catalog exercise ${id} missing`);

// ── helpers ──
const activationGroups = (sets: readonly PlannedSet[]) =>
  [...new Set(sets.filter((s) => s.kind === 'activation').map((s) => s.group ?? 0))];
/** Exactly `n` clusters: drop the trailing ones (and their minis), or grow by
 *  repeating cluster 1's shape. A drop set is not carried (v2.2 has none). */
function clusters(sets: readonly PlannedSet[], n: number): PlannedSet[] {
  const groups = activationGroups(sets);
  const body = sets.filter((s) => s.kind !== 'drop').map((s) => ({ ...s }));
  if (groups.length >= n) return body.filter((s) => (s.group ?? 0) <= groups[n - 1]);
  const first = body.filter((s) => s.group === groups[0]);
  for (let g = groups.length + 1; g <= n; g++) body.push(...first.map((s) => ({ ...s, group: g })));
  return body;
}
const oneCluster = (): PlannedSet[] => [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }];
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const strip = (r: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...x } = r; return stable(x); };
const blockOf = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
const fmtBase = (b?: TemplateExercise['baseline']) => (b ? `${b.since} "${b.reason}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}` : '—');
const shape = (r: TemplateExercise) => {
  const c = clusterCount(r.plannedSets, false);
  if (c > 0) return `×${c}`;
  const w = r.plannedSets.filter((s) => s.kind === 'working');
  return w.length ? `${w.length}×${w[0].reps ?? ''}${w[0].repsMax != null ? `-${w[0].repsMax}` : ''} str` : '×0';
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const loadEntry = (from: number | undefined, to: number, reason = LOAD_REASON) =>
  ({ at: stamp, ...(from != null ? { from } : {}), to, by: 'prompt' as const, reason });

// ── 1. build each template ──
const next = new Map<string, RawTpl>();
const changedIds = new Set<string>();
const whyById = new Map<string, string>();
let rowCount = 0;
for (const id of TPL_IDS) {
  const cur = raw.get(id)!;
  const rowOf = (eid: string) => {
    const r = cur.exercises.find((e) => e.exerciseId === eid);
    if (!r) throw new Error(`${cur.name}: live row ${eid} missing`);
    return structuredClone(r) as Row;
  };
  let rows: Row[];
  if (id === LEG) {
    const expect = [SQUAT, EXT, CURL, KNEE];
    if (cur.exercises.map((r) => r.exerciseId).join() !== expect.join()) {
      if (!cur.exercises.some((r) => r.exerciseId === RDL)) throw new Error(`Leg Day live order is not the v2.1-without-RDL order: ${cur.exercises.map((r) => r.name).join(', ')}`);
    }
    const already = cur.exercises.find((r) => r.exerciseId === RDL) as Row | undefined;
    const rdl: Row = already ? structuredClone(already) : {
      exerciseId: RDL,
      name: catOf(RDL)!.name,
      targetLoad: 35,
      setStructure: 'straight',
      plannedSets: [{ kind: 'working', reps: 8, repsMax: 12 }, { kind: 'working', reps: 8, repsMax: 12 }],
      progression: { targetReps: 12, holdSessions: 1, incrementLb: 5 },
      restMiniSec: 120,
      cues: [RIR2_CUE, RDL_RULE],
      loadLog: [loadEntry(undefined, 35, `${LOAD_REASON}: RDL re-added, 35 per hand`)],
    } as Row;
    const curl = rowOf(CURL);
    curl.plannedSets = clusters(curl.plannedSets, 2);
    rows = [rowOf(SQUAT), rdl, rowOf(EXT), curl, rowOf(KNEE)];
  } else if (id === PULL) {
    const base = cur.exercises.filter((r) => r.exerciseId !== EXT && r.exerciseId !== LATERAL);
    if (base.length !== 7) throw new Error(`Pull Day: expected 7 rows before superset E, found ${base.length}`);
    const legExt = raw.get(LEG)!.exercises.find((r) => r.exerciseId === EXT)!;
    const pushLat = raw.get(PUSH)!.exercises.find((r) => r.exerciseId === LATERAL)!;
    const e1 = (cur.exercises.find((r) => r.exerciseId === EXT) as Row | undefined) ?? ({
      exerciseId: EXT, name: legExt.name, targetLoad: 100, plannedSets: oneCluster(), cues: [FAIL_CUE],
      supersetGroup: 'E', pairPosition: 1, transitionRestSec: 15, roundRestSec: 60,
      loadLog: [loadEntry(undefined, 100, `${LOAD_REASON}: superset E on Pull`)],
    } as Row);
    const e2 = (cur.exercises.find((r) => r.exerciseId === LATERAL) as Row | undefined) ?? ({
      exerciseId: LATERAL, name: pushLat.name, targetLoad: 15, plannedSets: oneCluster(), cues: [FAIL_CUE, 'NO drop set.'],
      supersetGroup: 'E', pairPosition: 2,
      loadLog: [loadEntry(undefined, 15, `${LOAD_REASON}: superset E on Pull`)],
    } as Row);
    rows = [...base.map((r) => structuredClone(r) as Row), e1, e2];
  } else {
    rows = cur.exercises.map((r) => structuredClone(r) as Row);
    const crunch = rows.find((r) => r.exerciseId === CRUNCH)!;
    if (crunch.targetLoad !== 15) {
      crunch.loadLog = [...(crunch.loadLog ?? []), loadEntry(crunch.targetLoad, 15, `${LOAD_REASON}: technique test at 15 next session, then normal progression`)];
      crunch.targetLoad = 15;
    }
  }
  rows = normalizeSupersets(rows, { keepLetters: true });

  // Baselines on every changed row: new, moved, clusters changed, load changed.
  const ctx = contextChanges(liveBefore, { id, exercises: rows });
  rows = rows.map((r) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId);
    const why = [
      ...(old ? [] : ['new row']),
      ...(ctx.get(r.exerciseId) ?? []),
      ...(old && clusterCount(r.plannedSets, false) !== clusterCount(old.plannedSets, false) ? ['clusters'] : []),
      ...(old && r.targetLoad !== old.targetLoad ? ['load'] : []),
    ];
    if (why.length === 0 || r.baseline?.reason === REASON) return r;
    const b = contextBaseline(['superset'], { since: SINCE, load: r.targetLoad, catalog: engineCat(r.exerciseId), row: r });
    whyById.set(`${id}:${r.exerciseId}`, why.join('+'));
    return { ...r, baseline: { ...b, reason: REASON } };
  });
  rows = rows.map((r) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId);
    return old && strip(r) === strip(old) ? old : ({ ...r, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
  });
  rowCount += rows.filter((r) => r !== cur.exercises.find((e) => e.exerciseId === r.exerciseId)).length;
  const notes = cur.notes?.includes(`${DAY} - Program v2.2`) ? cur.notes : `${cur.notes ?? ''}\n${NOTES[id]}`.trim();
  if (notes.length > 10000) throw new Error(`${cur.name}: notes would be ${notes.length} chars, over the rules' 10,000`);
  const order = (xs: readonly Row[]) => xs.map((r) => r.exerciseId).join();
  const rowsChanged = order(rows) !== order(cur.exercises) || rows.some((r) => r !== cur.exercises.find((e) => e.exerciseId === r.exerciseId));
  if (rowsChanged || notes !== cur.notes || cur.templateVersion !== VERSION) changedIds.add(id);
  next.set(id, { ...cur, exercises: rows, notes, templateVersion: VERSION });

  // ── report ──
  say(`\n1. ${cur.name} (${id}) — ${rowsChanged ? 'CHANGES' : 'rows unchanged'} · templateVersion ${cur.templateVersion ?? '(none)'} → ${VERSION}${notes !== cur.notes ? ' · + dated notes line' : ''} (notes ${notes.length} chars)`);
  say('   BEFORE');
  cur.exercises.forEach((r, i) => say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(24)} ${shape(r).padEnd(14)} ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}`));
  say('   AFTER');
  rows.forEach((r, i) => {
    const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId);
    const d: string[] = [];
    if (!old) d.push('NEW');
    else {
      if (cur.exercises.indexOf(old) !== i) d.push(`pos ${cur.exercises.indexOf(old) + 1}→${i + 1}`);
      if (blockOf(old) !== blockOf(r)) d.push(`block ${blockOf(old)}→${blockOf(r)}`);
      if (shape(old) !== shape(r)) d.push(`${shape(old)}→${shape(r)}`);
      if (old.targetLoad !== r.targetLoad) d.push(`load ${old.targetLoad}→${r.targetLoad} (loadLog +prompt)`);
      if (JSON.stringify(old.cues) !== JSON.stringify(r.cues)) d.push('cues');
    }
    if (JSON.stringify(old?.baseline) !== JSON.stringify(r.baseline)) d.push(`BASELINE (${whyById.get(`${id}:${r.exerciseId}`) ?? '?'})`);
    const rest = [r.restMiniSec != null ? `mini ${r.restMiniSec}` : '', r.restClusterSec != null ? `cluster ${r.restClusterSec}` : '', r.restAfterSec != null ? `after ${r.restAfterSec}` : '', r.transitionRestSec != null ? `switch ${r.transitionRestSec}` : '', r.roundRestSec != null ? `round ${r.roundRestSec}` : ''].filter(Boolean).join(' ');
    say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(24)} ${shape(r).padEnd(14)} ${String(r.targetLoad ?? '—').padStart(5)}  base ${fmtBase(r.baseline)}${rest ? `  [${rest}]` : ''}${d.length ? `   ← ${d.join('; ')}` : ''}`);
    if (!old || JSON.stringify(old.cues) !== JSON.stringify(r.cues)) say(`         cues: ${JSON.stringify(r.cues ?? [])}`);
  });
  const ctxLine = [...ctx].map(([eid, c]) => `${rows.find((r) => r.exerciseId === eid)?.name}: ${c.join('/')}`);
  say(`   core contextChanges: ${ctxLine.length ? ctxLine.join('; ') : 'none'}`);
}

// ── 1c. catalog ──
say('\n1c. Catalog');
const catalogWrites: { id: string; patch: Record<string, unknown> }[] = [];
const rdlCat = catOf(RDL)!;
if (rdlCat.effortStandard !== 'rir2') {
  catalogWrites.push({ id: RDL, patch: { effortStandard: 'rir2' } });
  say(`   ${rdlCat.name}: effortStandard ${rdlCat.effortStandard ?? '(absent)'} → rir2`);
} else say(`   ${rdlCat.name}: effortStandard rir2 (already)`);
for (const [id, want] of [[SQUAT, 'rir1'], [EXT, 'failure'], [CURL, 'failure'], [KNEE, 'failure'], [LATERAL, 'failure']] as const) {
  const c = catOf(id)!;
  say(`   ${c.name}: effortStandard ${c.effortStandard ?? '(absent → failure)'}${(c.effortStandard ?? 'failure') === want ? ' ✓' : ` ≠ spec ${want} — NOT changed, reported`}`);
}
for (const t of liveBefore.filter((t) => t.id === PUSH)) for (const e of t.exercises) {
  if (['ud6fE363QklE3qXYxLw3', 'ngF9959fQPGTYUHXpigC', 'He4o7qVWRftiPneaXjiV'].includes(e.exerciseId)) say(`   ${e.name}: effortStandard ${catOf(e.exerciseId)?.effortStandard} (spec: rir1 on the activation)`);
}

// ── 2. superset flows ──
const after = TPL_IDS.map((id) => toWorkoutTemplate(id, next.get(id)!));
say('\n2. Superset blocks — performed sequence (core supersetFlow), with the rest after each step');
for (const t of after) {
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(flowRows);
  for (const g of [...new Set(flow.filter((s) => s.group).map((s) => s.group!))]) {
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
  say(`   ${t.name.padEnd(9)} ${eb.minutes} → ${ea.minutes} min   (work ${mmss(eb.clustersSec)} → ${mmss(ea.clustersSec)} · rest ${mmss(eb.restSec)} → ${mmss(ea.restSec)} · Zone 2 ${mmss(ea.cardioSec)})`);
}

// ── 4. volume ──
say('\n4. Planned per rotation (core plannedVolume — straight sets count 1 : 1 inside a cluster template, Program v2.2)');
const vb = new Map(plannedVolume(liveBefore, catalog).map((m) => [m.muscle, m]));
const va = new Map(plannedVolume(after, catalog).map((m) => [m.muscle, m]));
const hs = new Map(plannedHardSets(after, catalog).map((m) => [m.muscle, m]));
const rot = new Map(rotationVolume(sessions, catalog, TPL_IDS).week.map((m) => [m.muscle, m]));
say(`   ${'muscle'.padEnd(11)} ${'before'.padStart(7)} ${'after'.padStart(7)}   direct b→a   (of which straight sets)   last logged rotation`);
for (const m of ['chest', 'frontDelt', 'sideDelt', 'rearDelt', 'triceps', 'back', 'biceps', 'quads', 'hamstrings', 'glutes', 'calves', 'abs'] as const) {
  const b = vb.get(m)!; const a = va.get(m)!;
  say(`   ${m.padEnd(11)} ${String(b.fractional).padStart(7)} ${String(a.fractional).padStart(7)}${a.fractional !== b.fractional ? ' *' : '  '}  ${b.direct}→${a.direct}${''.padEnd(10)}${hs.get(m)!.fractional ? `(${hs.get(m)!.fractional})` : ''}${''.padEnd(16)}${rot.get(m)?.fractional ?? 0}`);
}
say('   credits used for the changed lifts:');
for (const id of [RDL, EXT, LATERAL, CURL]) {
  const c = catOf(id)!;
  say(`      ${c.name.padEnd(24)} [${c.muscles.join(',')}] → ${creditsFor(c.name, c.muscles).map((x) => `${x.muscle} ${x.weight}`).join(', ')}`);
}

// ── 5. engine ──
say('\n5. Engine — next call on each changed row (core sessionCall, with the v2.2 catalog)');
const catAfter = (eid: string) => { const c = engineCat(eid); return c && eid === RDL ? { ...c, effortStandard: 'rir2' as const } : c; };
for (const [i, t] of after.entries()) for (const r of t.exercises) {
  const old = liveBefore[i].exercises.find((e) => e.exerciseId === r.exerciseId);
  if (old && stable(old) === stable(r)) continue;
  const { rec, basedOn } = sessionCall(r, completed, catAfter(r.exerciseId));
  const kind = rec.reason && typeof rec.reason === 'object' && 'kind' in rec.reason ? (rec.reason as { kind: string }).kind : '?';
  say(`   ${t.name} · ${r.name}: ${rec.action} ${rec.load ?? '—'} (${kind})${basedOn ? ` from ${calendarDateKey(basedOn)}` : ' — no read yet under the v2.2 baseline'}`);
}

// ── 6. sample export ──
say('\n6. Sample export — the v2.2 Leg Day template rows (core buildCsv)');
const effortStandards = Object.fromEntries(catalog.map((c) => [c.id!, c.id === RDL ? 'rir2' as const : c.effortStandard]));
const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: [after[0]], effortStandards });
const [head, ...lines] = csv.split(/\r?\n/);
const cols = head.split(',');
const want = ['type', 'template', 'position', 'exercise', 'load', 'clusters', 'miniRestSec', 'restBetweenClustersSec', 'restToNextSec', 'effortStandard', 'rirTarget', 'supersetBlock', 'supersetOrder', 'transitionSec', 'roundRestSec', 'templateVersion', 'notes'];
const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
say(`   ${want.join(',')}`);
for (const l of lines.filter((x) => x.startsWith('template,'))) {
  const c = cells(l);
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
const backup = join(dir, `owner-data-2026-10-22-program-v2-2-${stamp.replace(/[:.]/g, '-')}.json`);
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
