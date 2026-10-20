/**
 * Owner data, 2026-10-19: Leg Day v2.1 drops the DB Romanian Deadlift (owner
 * preference; low-back concern), plus two fixes to that morning's Leg session.
 * DRY RUN unless `--apply`; re-runs are no-ops; every document it would touch
 * is backed up first (on `--apply`).
 *
 *   LEG   Smith squat ×2 (35)
 *         superset: Leg Extension ×1 (90 → 100) → Leg Curl ×2 → 3 (100)
 *                   → Hanging Knee Raise ×1 (BW)
 *         sequence: EXT → CURL c1 → KNEE → CURL c2 → CURL c3; Zone 2 unchanged.
 *
 * Baselines: every superset row moves up a slot (core `contextChanges`:
 * position), the curl grows a cluster and the extension's load changes, so
 * each gets `{ since: <next day the lift is not yet logged>, reason }` —
 * PENDING until the first Leg Day without the RDL. 10/19's Leg Day is the
 * first v2.1 read and stays history. The extension's 90 → 100 is also a
 * `loadLog` entry by `prompt`, so `honourLifterLoad` holds the owner's load.
 *
 * Session 2026-10-19 (Leg Day, `VCDFNBcanHZAQihSSic5`):
 *   - Leg Curls: RIR → 0 on all three sets (they were blank).
 *   - The Apple Watch walk the Health import attached (started 12:13 UTC,
 *     1,234 s, no HR, no RPE) is the same walk as the manual 20-min Zone 2, so
 *     it is removed and its `sourceId` recorded in `dismissedSourceIds`, so
 *     the import does not put it back. The manual Zone 2 is kept.
 *
 * Template drafts (`templateDrafts`) and the catalog are not touched.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-10-19-leg-no-rdl.mts --email gabrielandresbermudez@gmail.com [--apply]
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
  baselineSince,
  calendarDateKey,
  clusterCount,
  contextBaseline,
  contextChanges,
  dumbbellStepLb,
  estimateTemplateDuration,
  normalizeSupersets,
  plannedVolume,
  restAfterSetInFlow,
  rotationVolume,
  sameMuscleVerdict,
  sessionCall,
  supersetFlow,
  supersetWarnings,
  templateRestFor,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DAY = '2026-10-19';
const REASON = 'context changed: v2.1, RDL removed';
const LOAD_REASON = `Leg Day v2.1, RDL removed (owner, ${DAY})`;

const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const PULL = 'aliWJBD2FND6mU9foLdC';
const LEG = 'quxwARQlCnItzpLJgcr4';
const TPL_IDS = [PUSH, PULL, LEG];
const SESSION = 'VCDFNBcanHZAQihSSic5'; // 2026-10-19 Leg Day

const SQUAT = 'eKW1qiIDpvfnSECIxSUn';
const RDL = 'vtSvqglnBZdM1f3qOJi4';
const EXT = 'hXvPQM7Dv6YvScYW7h2l';
const CURL = 'jZWYnikrGcdRG1adHXJ0';
const KNEE = '8WVjS3nPucY5nQUC6lHM';
const WATCH_WALK = '4FF99EBD-483E-49DB-9DD2-3F526E3A36B0';

interface Spec { spec: string; id: string; clusters: number; load: number; block?: true }
const ROWS: Spec[] = [
  { spec: 'Smith Squat', id: SQUAT, clusters: 2, load: 35 },
  { spec: 'Leg Extension', id: EXT, clusters: 1, load: 100, block: true },
  { spec: 'Leg Curl', id: CURL, clusters: 3, load: 100, block: true },
  { spec: 'Hanging Knee Raise', id: KNEE, clusters: 1, load: 0, block: true },
];
const NOTE = `${DAY} - Leg Day v2.1, RDL removed (owner preference; low-back concern): Smith squat ×2 (35) · superset Leg Extension ×1 (100, was 90) → Leg Curl ×3 (100, was 2) → Hanging Knee Raise ×1 (BW): EXT → CURL c1 → KNEE → CURL c2 → CURL c3; Zone 2. Baseline "${REASON}" from the first Leg Day without the RDL (after ${DAY}). The 10/19 RDL read stays history.`;

const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const APPLY = args.includes('--apply');
if (!email || email.startsWith('--')) throw new Error('--email is required');
if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Puerto_Rico') {
  throw new Error('run with TZ=America/Puerto_Rico (baseline days are calendar days)');
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();

const [profileSnap, exSnap, sesSnap, ...tplSnaps] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutSessions').get(),
  ...TPL_IDS.map((id) => user.collection('workoutTemplates').doc(id).get()),
]);
for (const s of tplSnaps) if (!s.exists) throw new Error(`template ${s.id} not found`);
const sessionSnap = sesSnap.docs.find((d) => d.id === SESSION);
if (!sessionSnap) throw new Error(`session ${SESSION} not found`);

type Row = TemplateExercise & Record<string, unknown>;
type RawTpl = { name: string; notes?: string; exercises: Row[] } & Record<string, unknown>;
const raw = new Map(tplSnaps.map((s) => [s.id, s.data() as RawTpl]));
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const musclesOf = (id: string) => catOf(id)?.muscles;
const dbStep = dumbbellStepLb(profileSnap.get('dumbbellHalfSteps') as boolean | undefined);
const engineCat = (id: string) => { const c = catOf(id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const liveBefore: WorkoutTemplate[] = TPL_IDS.map((id) => toWorkoutTemplate(id, raw.get(id)!));

const out: string[] = [];
const say = (s = '') => out.push(s);
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — uid ${uid} — ${stamp}`);

// ── helpers (as in owner-data-2026-10-15-program-v2-1) ──
const activationGroups = (sets: readonly PlannedSet[]) =>
  [...new Set(sets.filter((s) => s.kind === 'activation').map((s) => s.group ?? 0))];
/** Grow to `n` clusters by repeating cluster 1's shape. Never shrinks. */
function withClusters(sets: readonly PlannedSet[], n: number): PlannedSet[] {
  const groups = activationGroups(sets);
  if (groups.length > n) throw new Error(`would shrink clusters ${groups.length} → ${n}`);
  if (groups.length === n) return sets as PlannedSet[];
  const first = sets.filter((s) => s.group === groups[0] && s.kind !== 'drop').map((s) => ({ ...s }));
  const drops = sets.filter((s) => s.kind === 'drop');
  const body = sets.filter((s) => s.kind !== 'drop').map((s) => ({ ...s }));
  for (let g = groups.length + 1; g <= n; g++) body.push(...first.map((s) => ({ ...s, group: g })));
  return [...body, ...drops.map((d) => ({ ...d, group: n }))];
}
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const strip = (r: Row) => { const { lastModifiedAt: _a, lastModifiedBy: _b, ...x } = r; return stable(x); };
const blockOf = (r: TemplateExercise) => (r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—');
const fmtBase = (b?: TemplateExercise['baseline']) => (b ? `${b.since} "${b.reason}"${b.dropBackTo != null ? ` drop→${b.dropBackTo} <${b.dropBackBelowReps}` : ''}` : '—');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ── 1. Leg Day ──
const cur = raw.get(LEG)!;
const liveIds = cur.exercises.map((r) => r.exerciseId);
const expected = [SQUAT, RDL, EXT, CURL, KNEE];
const already = liveIds.join() === ROWS.map((r) => r.id).join();
if (!already && liveIds.join() !== expected.join()) {
  throw new Error(`Leg Day rows are ${cur.exercises.map((r) => r.name).join(', ')} — not the v2.1 body this script expects; refusing`);
}
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());

const leader = cur.exercises.find((r) => r.supersetGroup && r.pairPosition === 1);
let rows: Row[] = ROWS.map((sp) => {
  const r = structuredClone(cur.exercises.find((e) => e.exerciseId === sp.id)!) as Row;
  r.plannedSets = withClusters(r.plannedSets, sp.clusters);
  if (r.targetLoad !== sp.load) {
    r.loadLog = [...(r.loadLog ?? []), { at: stamp, ...(r.targetLoad != null ? { from: r.targetLoad } : {}), to: sp.load, by: 'prompt', reason: LOAD_REASON }];
    r.targetLoad = sp.load;
  }
  if (!sp.block && r.supersetGroup) throw new Error(`${r.name} is in a superset — refusing`);
  if (sp.block && r.supersetGroup !== leader?.supersetGroup) throw new Error(`${r.name} is not in the leg superset — refusing`);
  return r;
});
rows = normalizeSupersets(rows);
const ctx = contextChanges(liveBefore, { id: LEG, exercises: rows });
rows = rows.map((r) => {
  const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId)!;
  const grew = clusterCount(r.plannedSets, false) > clusterCount(old.plannedSets, false);
  const loadMoved = r.targetLoad !== old.targetLoad;
  const why = [...(ctx.get(r.exerciseId) ?? []), ...(grew ? ['clusters'] : []), ...(loadMoved ? ['load'] : [])];
  if (why.length === 0 || r.baseline?.reason === REASON) return r;
  const since = baselineSince(r.exerciseId, completed, now);
  const b = contextBaseline(['superset'], { since, load: r.targetLoad, catalog: engineCat(r.exerciseId), row: r });
  (r as Row & { _why?: string })._why = why.join('+');
  return { ...r, baseline: { ...b, reason: REASON } };
});
const why = new Map(rows.map((r) => [r.exerciseId, (r as Row & { _why?: string })._why]));
rows = rows.map((r) => {
  const { _why: _w, ...clean } = r as Row & { _why?: string };
  const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId)!;
  return strip(clean as Row) === strip(old) ? old : ({ ...clean, lastModifiedAt: stamp, lastModifiedBy: 'prompt' } as Row);
});
const notes = cur.notes?.includes(`${DAY} - Leg Day v2.1, RDL removed`) ? cur.notes : `${cur.notes ?? ''}\n${NOTE}`.trim();
const tplChanged = !already || rows.some((r) => !cur.exercises.includes(r)) || notes !== cur.notes;
const legAfter = toWorkoutTemplate(LEG, { ...cur, exercises: rows, notes });
const after = liveBefore.map((t) => (t.id === LEG ? legAfter : t));

say(`\n1. Leg Day (${LEG}) — ${tplChanged ? 'CHANGES' : 'unchanged (already applied)'}`);
say('   BEFORE');
cur.exercises.forEach((r, i) => say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(22)} ×${clusterCount(r.plannedSets, false)}  ${String(r.targetLoad ?? '—').padStart(4)}  base ${fmtBase(r.baseline)}`));
say('   AFTER');
legAfter.exercises.forEach((r, i) => {
  const old = cur.exercises.find((e) => e.exerciseId === r.exerciseId)!;
  const d: string[] = [];
  if (cur.exercises.indexOf(old) !== i) d.push(`pos ${cur.exercises.indexOf(old) + 1}→${i + 1}`);
  if (blockOf(old) !== blockOf(r)) d.push(`block ${blockOf(old)}→${blockOf(r)}`);
  const [co, cn] = [clusterCount(old.plannedSets, false), clusterCount(r.plannedSets, false)];
  if (co !== cn) d.push(`clusters ${co}→${cn}`);
  if (old.targetLoad !== r.targetLoad) d.push(`load ${old.targetLoad}→${r.targetLoad} (loadLog +prompt)`);
  if (stable(old.baseline) !== stable(r.baseline)) d.push(`BASELINE (${why.get(r.exerciseId) ?? '?'})`);
  say(`   ${i + 1}. ${blockOf(r).padEnd(3)} ${r.name.padEnd(22)} ×${cn}  ${String(r.targetLoad ?? '—').padStart(4)}  base ${fmtBase(r.baseline)}${d.length ? `   ← ${d.join('; ')}` : ''}`);
});
if (!already) say(`   removed: DB Romanian deadlift (${RDL}) — its catalog entry and session history are kept`);
const ext = catOf(EXT);
say(`   Leg Extension stack on file: ${ext?.availableLoads ? ext.availableLoads.join('/') : 'none'}${ext?.availableLoads && !ext.availableLoads.includes(100) ? ' — 100 is NOT on it' : ''}`);

// ── 2. sequence + guardrails ──
say('\n2. Superset — performed sequence (core supersetFlow) and guardrails (core supersetWarnings)');
{
  const t = legAfter;
  const flowRows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(flowRows);
  say(`   sequence: ${flow.filter((s) => s.group).map((s) => `${t.exercises[s.exerciseIndex].name} c${s.unit + 1}`).join(' → ')}`);
  flow.forEach((s, k) => {
    const r = restAfterSetInFlow(flowRows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
    const nextName = flow[k + 1] ? `${t.exercises[flow[k + 1].exerciseIndex].name} c${flow[k + 1].unit + 1}` : 'Zone 2 / end';
    say(`      ${(s.label ?? '').padEnd(2)} ${t.exercises[s.exerciseIndex].name} cluster ${s.unit + 1}   → ${r.kind} ${r.seconds} s → ${nextName}`);
  });
  for (const w of supersetWarnings(flowRows, (id) => musclesOf(id) ?? [], undefined, restFor)) {
    for (const p of w.pairs) {
      const sp = p.spacing;
      const v = p.judgement.kind === 'same-muscle' ? ` → ${sameMuscleVerdict(sp)}` : '';
      say(`      guardrail ${t.exercises[p.a].name} + ${t.exercises[p.b].name}: ${p.judgement.kind}${p.judgement.muscle ? ` (${p.judgement.muscle})` : ''}${sp ? (sp.adjacent ? ' — adjacent' : ` — separated by ${sp.between.map((x) => t.exercises[x].name).join(', ')}, ~${sp.gapSec} s`) : ''}${v}`);
    }
    for (const n of w.neighbours ?? []) say(`      neighbour: ${t.exercises[n.neighbour].name} next to ${t.exercises[n.member].name} — same ${n.muscle}`);
    if (!(w.neighbours ?? []).length) say('      neighbours: no same-primary straight lift right before/after the block');
  }
}

// ── 3. session 10/19 ──
type Set_ = Record<string, unknown> & { rir?: number | null };
type Ex = Record<string, unknown> & { name: string; exerciseId: string; sets: Set_[] };
const sData = sessionSnap.data();
if (sData.templateId !== LEG || calendarDateKey((sData.timestamp as Timestamp).toDate()) !== DAY) throw new Error('session is not the 10/19 Leg Day — refusing');
const sPatch: Record<string, unknown> = {};
say(`\n3. Session ${DAY} Leg Day (${SESSION})`);
{
  const exercises = structuredClone(sData.exercises) as Ex[];
  const curl = exercises.find((e) => e.exerciseId === CURL);
  if (!curl) throw new Error('Leg Curls not in the 10/19 session');
  const rirs = curl.sets.map((s) => s.rir ?? null);
  if (rirs.every((r) => r === 0)) say('   Leg Curls RIR already 0 (skip)');
  else if (rirs.every((r) => r == null)) {
    curl.sets.forEach((s) => { s.rir = 0; });
    sPatch.exercises = exercises;
    say(`   Leg Curls RIR → 0 on all ${curl.sets.length} sets (${curl.sets.map((s) => `${s.kind} ${s.weight}×${s.reps}`).join(', ')})`);
  } else throw new Error(`Leg Curls RIR is partly set (${rirs.join(',')}) — refusing`);

  const cardio = (sData.cardio ?? []) as Record<string, unknown>[];
  const walk = cardio.find((b) => b.sourceId === WATCH_WALK);
  const dismissed = (sData.dismissedSourceIds as string[] | undefined) ?? [];
  if (walk) {
    const manual = cardio.find((b) => b.source === 'manual' && b.label === 'Zone 2' && b.durationSec === 1200);
    const dup = walk.source === 'health' && walk.provider === 'apple-watch' && walk.modality === 'walk'
      && walk.durationSec === 1234 && walk.avgHr == null && walk.rpe == null && walk.startedAt instanceof Timestamp && walk.startedAt.toDate().toISOString() === '2026-10-19T12:13:22.446Z';
    if (!dup || !manual) throw new Error(`cardio is not the expected watch walk + manual Zone 2 (${JSON.stringify(cardio)}) — refusing`);
    sPatch.cardio = cardio.filter((b) => b !== walk);
    say(`   cardio: removing the Apple Watch walk (started 12:13 UTC = 08:13 local, ${walk.durationSec} s, ${walk.distanceM} m, no HR/RPE) — the same walk as the manual Zone 2 (${manual.durationSec} s, ${manual.distanceM} m, HR ${manual.avgHr}), kept`);
  } else say('   cardio: watch walk already gone (skip)');
  if (!dismissed.includes(WATCH_WALK)) { sPatch.dismissedSourceIds = [...dismissed, WATCH_WALK]; say('   recorded its sourceId in dismissedSourceIds'); }
}

// ── 4. estimate ──
const msOf = (t: WorkoutTemplate) => estimateTemplateDuration(t, musclesOf);
const eb = msOf(liveBefore[2]);
const ea = msOf(legAfter);
say(`\n4. Leg Day estimate (core estimateTemplateDuration): ${eb.minutes} → ${ea.minutes} min   (clusters ${mmss(eb.clustersSec)} → ${mmss(ea.clustersSec)} · rest ${mmss(eb.restSec)} → ${mmss(ea.restSec)} · warm-up ${mmss(ea.warmupSec)} · Zone 2 ${mmss(ea.cardioSec)})`);

// ── 5. volume ──
const sessionsAfter = sessions.map((s) => (s.id === SESSION ? toWorkoutSession(SESSION, { ...sData, ...sPatch }) : s));
const tbl = (xs: { muscle: string; direct: number; fractional: number }[]) => new Map(xs.map((m) => [m.muscle, m]));
// Clusters only: every lift in the three templates is clustered, so the
// hard-set view (S23-13) reads 0 on both sides.
const [pcB, pcA] = [plannedVolume(liveBefore, catalog), plannedVolume(after, catalog)].map(tbl);
const rc = tbl(rotationVolume(sessionsAfter, catalog, TPL_IDS).week);
say('\n5. Weekly volume per rotation (Push + Pull + Leg once each, core plannedVolume) — planned clusters before → after; last rotation logged');
say(`   ${'muscle'.padEnd(11)} ${'fractional'.padEnd(12)} ${'direct'.padEnd(10)} logged (fractional)`);
for (const m of ['hamstrings', 'glutes', 'quads', 'abs'] as const) {
  say(`   ${m.padEnd(11)} ${`${pcB.get(m)!.fractional} → ${pcA.get(m)!.fractional}`.padEnd(12)} ${`${pcB.get(m)!.direct} → ${pcA.get(m)!.direct}`.padEnd(10)} ${rc.get(m)?.fractional ?? 0}`);
}

// ── 6. engine reads ──
say('\n6. Engine reads (next call, before → after)');
for (const r of legAfter.exercises) {
  const old = liveBefore[2].exercises.find((e) => e.exerciseId === r.exerciseId)!;
  const call = (row: TemplateExercise, ses: typeof completed) => {
    const { rec, basedOn } = sessionCall(row, ses, engineCat(row.exerciseId));
    return `${rec.action} ${rec.load ?? '—'}${rec.reason && typeof rec.reason === 'object' && 'kind' in rec.reason ? ` (${(rec.reason as { kind: string }).kind})` : ''}${basedOn ? ` from ${calendarDateKey(basedOn)}` : ''}`;
  };
  const completedAfter = sessionsAfter.filter((s) => s.status === 'completed').sort((a, b) => b.date.getTime() - a.date.getTime());
  say(`   ${r.name.padEnd(22)} ${call(old, completed)}  →  ${call(r, completedAfter)}`);
}

// ── backup + write ──
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-10-19-leg-no-rdl-${stamp.replace(/[:.]/g, '-')}.json`);
const writes = (tplChanged ? 1 : 0) + (Object.keys(sPatch).length ? 1 : 0);
say(`\n7. Backup: ${APPLY ? '' : '(would write) '}${backup}`);
say(`SUMMARY: ${tplChanged ? 'Leg Day template' : 'template unchanged'}; session ${Object.keys(sPatch).length ? Object.keys(sPatch).join(' + ') : 'unchanged'}. Drafts and catalog untouched.`);
console.log(out.join('\n'));

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (writes === 0) { console.log('\nNothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, template: { [LEG]: cur }, session: { [SESSION]: sData } }), null, 1));
if (!existsSync(backup)) throw new Error(`backup ${backup} not written — refusing to write`);
console.log(`backup written: ${backup}`);

const batch = db.batch();
if (tplChanged) batch.update(user.collection('workoutTemplates').doc(LEG), { exercises: JSON.parse(JSON.stringify(rows)), notes, updatedAt: Timestamp.fromDate(now) });
if (Object.keys(sPatch).length) batch.update(sessionSnap.ref, { ...sPatch, updatedAt: Timestamp.fromDate(now) });
await batch.commit();

const t = toWorkoutTemplate(LEG, (await user.collection('workoutTemplates').doc(LEG).get()).data()!);
console.log(`written Leg Day: ${t.exercises.map((r) => `${blockOf(r)} ${r.name}×${clusterCount(r.plannedSets, false)}@${r.targetLoad}`).join(' · ')} — ${estimateTemplateDuration(t, musclesOf).minutes} min`);
const s = (await sessionSnap.ref.get()).data()!;
console.log(`written session: Leg Curls RIR ${(s.exercises as Ex[]).find((e) => e.exerciseId === CURL)!.sets.map((x) => x.rir).join(',')}; cardio ${(s.cardio as Record<string, unknown>[]).map((b) => `${b.label ?? b.provider} ${b.durationSec}s`).join(', ')}; dismissed ${JSON.stringify(s.dismissedSourceIds)}`);
