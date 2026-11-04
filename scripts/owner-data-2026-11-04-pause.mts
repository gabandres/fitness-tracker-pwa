/**
 * Owner data, requested 2026-11-04 (America/La_Paz): the 11/4 Travel D session
 * becomes PAUSED (core `session-pause.ts`) so the rest is finished later today
 * in the same record; the Haven kg loads; Travel C/D template corrections; the
 * trip plan after D ran on Wed instead of C.
 *
 * What the read found (each value checked; any drift → refuse):
 *   - Session `9G254bQLXwo1B9IePk1K`, Travel D, 10:40:32Z → last write 11:17:33Z,
 *     37 min, `completed`, 8 lifts logged — the finish had dropped the 5 rows
 *     not reached. Every logged row is complete against its plan.
 *   - Loads: stored POUNDS with `loadUnit: 'kg'` on every row — 88.1848 = 40 kg,
 *     77.1617 = 35, 44.0924 = 20, 22.0462 = 10 exactly. Only the RDL's 26.46
 *     (12 kg rounded at 2 decimals, the template's) was off the exact value.
 *     The app's store is pounds by design (`load-units.ts`: every volume, e1RM
 *     and engine read is one scale), so the kg numbers are NOT written into
 *     `weight`: 12 there would read as 12 lb. What changes is display (history
 *     now reads a kg row in kg) and the RDL's value (exact 12 kg).
 *   - No `reentry` field on the session: the export's 'travel-re-entry' flag is
 *     derived from calibration + linked-home rows and stays as it is.
 *
 * Writes (each only if different; re-runs plan 0):
 *
 *   SESSION   status `paused`; one segment 10:40:32Z → 11:17:33Z (37 min);
 *             logged sets stamped segment 1; the 5 unreached rows restored from
 *             Travel D in template order (superset fields, calibration, kg).
 *   TEMPLATES Travel C/D: upper chest "30° Incline DB Press" (bench at Haven;
 *             cable-fly note removed) at 10 kg; Pull-up overhand note; next-D
 *             loads (RDL 12, row 40, leg ext 35, press 20, incline 10, hammer
 *             10 kg); C's flat press 10 and pulldown 37 kg at exact values.
 *   PLAN      11/3 C and 11/4–5 D → 11/4 D (part 1 done, paused) and
 *             11/5–6 C (Thu = back-to-back).
 *
 * DRY RUN unless `--apply`; everything it touches is backed up first.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-04-pause.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { isLoggedSet, type SessionExercise, type TemplateExercise, type WorkoutSession, type WorkoutSet } from '../packages/core/src/workout.ts';
import {
  type TravelPlanEntry,
  buildCsv,
  calibrationRanHot,
  canResume,
  dayBoundaryOf,
  isBackToBackGymDay,
  kgToLb,
  lbToKg,
  remainingStepText,
  remainingSteps,
  resumeDeadline,
  sessionCall,
  snapshotSupersets,
  toDomainProfile,
  toRecommendationSnapshot,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelWeek,
  zone2Check,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = '9G254bQLXwo1B9IePk1K';
const C_ID = 'travel-gym-c';
const D_ID = 'travel-gym-d';
const SEG_START = '2026-11-04T10:40:32.075Z';
const SEG_END = '2026-11-04T11:17:33.729Z';
/** Exact pounds for a kg value — 5 decimals round-trips to the kg exactly. */
const kg = (v: number) => +kgToLb(v).toFixed(5);

const INCLINE = 'haven-30-incline-db-press';
const PULL = 'GOGOcWJNC9q9aBmN3ENq';
const RDL = 'vtSvqglnBZdM1f3qOJi4';
/** Next Travel D loads, kg (owner item 11), and C's (item 7/8). */
const D_LOADS: Record<string, number> = { [RDL]: 12, 'haven-seated-cable-row': 40, 'haven-leg-extension': 35, 'haven-plate-shoulder-press': 20, [INCLINE]: 10, LvVitCaOS23MmPTKodlk: 10 };
const C_LOADS: Record<string, number> = { ud6fE363QklE3qXYxLw3: 10, 'haven-lat-pulldown-wide': 37, [INCLINE]: 10 };
/** What 11/4 logged per lift, as a check on the read (kg, sets with reps). */
const LOGGED: Record<string, { kg: number; sets: number }> = {
  [RDL]: { kg: 12, sets: 2 }, 'haven-seated-cable-row': { kg: 40, sets: 6 }, 'haven-leg-extension': { kg: 35, sets: 6 },
  'haven-plate-shoulder-press': { kg: 20, sets: 3 }, jMGQm6C9I6HNNPXPYYLM: { kg: 0, sets: 3 }, [PULL]: { kg: 0, sets: 3 },
  [INCLINE]: { kg: 10, sets: 3 }, LvVitCaOS23MmPTKodlk: { kg: 10, sets: 3 },
};
const INCLINE_CUE_C = 'Adjustable bench at Haven: 30° incline. Baseline 2026-11-04 (Travel D): 10 kg × 9.';
const INCLINE_CUE_D = 'Adjustable bench at Haven: 30° incline. Baseline 2026-11-04: 10 kg × 9.';
const PULL_CUE = 'Overhand / no neutral handles at Haven; new baseline 2026-11-04 (BW × 8). Not comparable to the home neutral-grip PR (12).';
const RDL_CUE = '2026-11-04: 12 kg, both sets 8 @ RIR 1. Progress only at 2 × 12 @ RIR 2.';
const PLAN_D: TravelPlanEntry = { from: '2026-11-04', to: '2026-11-04', kind: 'session', label: 'Travel D', templateId: D_ID, note: 'part 1 done (37 min), paused; finish the rest today' };
const PLAN_C: TravelPlanEntry = { from: '2026-11-05', to: '2026-11-06', kind: 'session', label: 'Travel C', templateId: C_ID, note: 'Thu or Fri; Thu = back-to-back: isolations at RIR 1' };

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const [profileSnap, exSnap, tplSnap, sesSnap] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(200).get(),
]);
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const sesDoc = sesSnap.docs.find((d) => d.id === SESSION_ID);
if (!sesDoc) throw new Error('the 11/4 session is not there');
const raw = sesDoc.data();
const session = toWorkoutSession(sesDoc.id, raw);
if (session.templateId !== D_ID) throw new Error(`session template ${session.templateId}`);
if (session.date.toISOString() !== SEG_START) throw new Error(`session start ${session.date.toISOString()}`);
const alreadyPaused = session.status === 'paused';
if (!alreadyPaused) {
  if (session.status !== 'completed' || session.durationMin !== 37) throw new Error(`session is ${session.status}, ${session.durationMin} min`);
  if (session.updatedAt.toISOString() !== SEG_END) throw new Error(`session last written ${session.updatedAt.toISOString()} — it changed since the read`);
}
for (const [id, want] of Object.entries(LOGGED)) {
  const ex = session.exercises.find((e) => e.exerciseId === id);
  const logged = ex?.sets.filter((s) => isLoggedSet(s, ex.logStyle)) ?? [];
  if (logged.length !== want.sets) throw new Error(`${id}: ${logged.length} logged sets, expected ${want.sets}`);
  if (logged.some((s) => Math.abs(lbToKg(s.weight ?? 0) - want.kg) > 0.01)) throw new Error(`${id}: a load is not ${want.kg} kg`);
}

const tplDoc = new Map(tplSnap.docs.map((d) => [d.id, d]));
const cRaw = tplDoc.get(C_ID)?.data();
const dRaw = tplDoc.get(D_ID)?.data();
if (!cRaw || !dRaw) throw new Error('Travel C / D templates missing');

// ── templates ──
type Row = TemplateExercise & Record<string, unknown>;
const withLoad = (r: Row, kgv: number, reason: string): Row => {
  const to = kgv === 0 ? 0 : kg(kgv);
  if (r.targetLoad === to) return r;
  return { ...r, targetLoad: to, loadLog: [...((r.loadLog as unknown[]) ?? []), { at: stamp, to, by: 'prompt', reason }], lastModifiedAt: stamp, lastModifiedBy: 'prompt' };
};
const swapCue = (r: Row, drop: (c: string) => boolean, add: string): Row => {
  const cues = [...r.cues.filter((c) => !drop(c) && c !== add)];
  // The new cue sits where the dropped one was (before the gym note, last).
  const at = r.cues.findIndex(drop);
  cues.splice(at >= 0 ? Math.min(at, cues.length) : Math.max(cues.length - 1, 0), 0, add);
  return JSON.stringify(cues) === JSON.stringify(r.cues) ? r : { ...r, cues, lastModifiedAt: stamp, lastModifiedBy: 'prompt' };
};
const cableFly = (c: string) => /No adjustable bench|Cable Fly/i.test(c);
function fixC(rows: Row[]): Row[] {
  return rows.map((r) => {
    let x = r;
    if (r.exerciseId === INCLINE) x = { ...swapCue(x, cableFly, INCLINE_CUE_C), name: '30° Incline DB Press' };
    if (C_LOADS[r.exerciseId] != null) x = withLoad(x, C_LOADS[r.exerciseId], r.exerciseId === INCLINE ? 'baseline 10 kg × 9, Travel D 2026-11-04 (owner, 2026-11-04)' : `Haven ${C_LOADS[r.exerciseId]} kg, exact (owner, 2026-11-04)`);
    return x;
  });
}
function fixD(rows: Row[]): Row[] {
  return rows.map((r) => {
    let x = r;
    if (r.exerciseId === INCLINE) x = { ...swapCue(x, cableFly, INCLINE_CUE_D), name: '30° Incline DB Press' };
    if (r.exerciseId === PULL) x = { ...swapCue(x, (c) => /Neutral grip if handles/i.test(c), PULL_CUE), name: 'Pull-up (overhand)' };
    if (r.exerciseId === RDL) x = swapCue(x, (c) => c.startsWith('2026-11-04: 12 kg'), RDL_CUE);
    if (D_LOADS[r.exerciseId] != null) x = withLoad(x, D_LOADS[r.exerciseId], `next Travel D ${D_LOADS[r.exerciseId]} kg (owner, 2026-11-04)`);
    return x;
  });
}
const cRows = fixC(cRaw.exercises as Row[]);
const dRows = fixD(dRaw.exercises as Row[]);
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => !['lastModifiedAt', 'at'].includes(k) && (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const cWrite = stable(cRows) !== stable(cRaw.exercises);
const dWrite = stable(dRows) !== stable(dRaw.exercises);

// ── the session ──
const catalog = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const completed = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.status === 'completed' && s.id !== SESSION_ID);
const dAfter = toWorkoutTemplate(D_ID, { ...dRaw, exercises: dRows });
const supersets = snapshotSupersets(dAfter.exercises);
/** A template row as a start scaffolds it (mobile `templateToSessionExercises`
 *  + the start's engine call, `useTrain.startFromTemplate`). */
function scaffold(row: TemplateExercise, i: number): SessionExercise {
  const style = row.logStyle ?? 'weight-reps';
  const planned = row.plannedSets.length ? row.plannedSets : [{ kind: 'working' as const }];
  const { rec, basedOn, history } = sessionCall(row, completed, catalog.find((c) => c.id === row.exerciseId) ?? null);
  const se: SessionExercise = {
    exerciseId: row.exerciseId,
    name: row.name,
    ...(row.targetLoad != null ? { targetLoad: row.targetLoad } : {}),
    cues: row.cues ?? [],
    logStyle: row.logStyle,
    ...(row.progression ? { progression: row.progression } : {}),
    sets: planned.map((ps) => ({
      kind: ps.kind,
      ...(ps.group != null ? { group: ps.group } : {}),
      ...(style !== 'time' && (ps.weight ?? row.targetLoad) != null ? { weight: ps.weight ?? row.targetLoad } : {}),
      ...(style !== 'time' && ps.reps != null ? { targetReps: ps.reps } : {}),
      ...(ps.label ? { label: ps.label } : {}),
      done: false,
    })),
    ...supersets[i],
    ...(row.restClusterSec != null ? { restClusterSec: row.restClusterSec } : {}),
    ...(row.minClusterRestSec != null ? { minClusterRestSec: row.minClusterRestSec } : {}),
    ...(row.loadUnit ? { loadUnit: row.loadUnit } : {}),
    ...(row.awayGym ? { awayGym: row.awayGym } : {}),
    ...(row.linkedHome ? { linkedHome: true } : {}),
    ...(row.awayGym && history.length === 0 ? { calibration: true } : {}),
  };
  return rec.action !== 'none' ? { ...se, recommendation: toRecommendationSnapshot(rec, basedOn) } : se;
}
const exact = (w: number | undefined) => (w == null || w === 0 ? w : kg(Math.round(lbToKg(w) * 100) / 100));
const fixSet = (s: WorkoutSet, style: SessionExercise['logStyle']): WorkoutSet => ({
  ...s,
  ...(s.weight != null ? { weight: exact(s.weight) } : {}),
  ...(isLoggedSet(s, style) && s.segment == null ? { segment: 1 } : {}),
});
const exercises: SessionExercise[] = alreadyPaused
  ? session.exercises
  : dAfter.exercises.map((row, i) => {
      const logged = session.exercises.find((e) => e.exerciseId === row.exerciseId);
      if (!logged) return scaffold(row, i);
      return { ...logged, ...(logged.targetLoad ? { targetLoad: exact(logged.targetLoad) } : {}), sets: logged.sets.map((s) => fixSet(s, logged.logStyle)) };
    });
const segments = [{ start: new Date(SEG_START), end: new Date(SEG_END) }];
const pausedSession: WorkoutSession = { ...session, status: 'paused', exercises, segments, durationMin: 37 };
const sessionWrite = !alreadyPaused;

// ── plan ──
const prof = profileSnap.data()!;
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip is not on the profile');
const planBefore = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
const moved = (e: TravelPlanEntry) => (e.from === '2026-11-03' && e.templateId === C_ID) || (e.from === '2026-11-04' && e.templateId === D_ID) || (e.from === '2026-11-05' && e.templateId === C_ID);
const plan = [...planBefore.filter((e) => !moved(e)), PLAN_D, PLAN_C].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
const planWrite = stable(plan) !== stable(planBefore);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const boundary = dayBoundaryOf(toDomainProfile(prof));
say(`Session ${SESSION_ID}: ${session.status} → paused · ${session.exercises.length} → ${exercises.length} rows · 37 min (one part ${SEG_START.slice(11, 19)}Z → ${SEG_END.slice(11, 19)}Z)`);
say(`  resumable until ${resumeDeadline(pausedSession, boundary).toString()} (now: ${canResume(pausedSession, now, boundary) ? 'yes' : 'NO'})`);
const left = remainingSteps(pausedSession);
say(`  ${left.length} left, in order: ${left.map(remainingStepText).join(' → ')}`);
say('  rows:');
for (const e of exercises) {
  const logged = e.sets.filter((s) => isLoggedSet(s, e.logStyle));
  const w = logged[0]?.weight ?? e.sets[0]?.weight;
  say(`    ${(e.supersetGroup ? `${e.supersetGroup}${e.pairPosition}` : '—').padEnd(3)} ${e.name.padEnd(32)} ${logged.length ? `${logged.length} logged @ ${w ? `${+lbToKg(w).toFixed(2)} kg (${w} lb)` : 'BW'} seg ${[...new Set(logged.map((s) => s.segment))].join(',')}` : `to do: ${e.sets.length} sets${e.calibration ? ', calibration' : ''}${e.recommendation ? `, call ${e.recommendation.action}` : ''}`}`);
}
say(`\nTravel C ${cWrite ? 'WRITE' : 'unchanged'} · Travel D ${dWrite ? 'WRITE' : 'unchanged'}`);
for (const [name, before, after] of [['C', cRaw.exercises as Row[], cRows], ['D', dRaw.exercises as Row[], dRows]] as const) {
  after.forEach((r, i) => {
    const b = before[i];
    if (stable(r) === stable(b)) return;
    const diffs: string[] = [];
    if (r.name !== b.name) diffs.push(`name "${b.name}" → "${r.name}"`);
    if (r.targetLoad !== b.targetLoad) diffs.push(`load ${b.targetLoad ?? '—'} → ${r.targetLoad} lb (${+lbToKg(r.targetLoad ?? 0).toFixed(3)} kg)`);
    const added = r.cues.filter((c) => !b.cues.includes(c));
    const removed = b.cues.filter((c) => !r.cues.includes(c));
    if (removed.length) diffs.push(`cue − "${removed.join('" / "')}"`);
    if (added.length) diffs.push(`cue + "${added.join('" / "')}"`);
    say(`  ${name} ${r.name}: ${diffs.join('; ')}`);
  });
}
say(`\nPlan ${planWrite ? 'WRITE' : 'unchanged'}:`);
for (const e of plan.filter((x) => x.from >= '2026-11-02' && x.from <= '2026-11-08')) say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
const week = travelWeek(plan, '2026-11-04', completed, boundary);
say(`  This week (Today): ${week.rows.map((r) => `${r.from} ${r.label} [${r.status}]`).join(' · ')}`);

say('\nNotes the next Travel C shows (Thu 11/5), with 11/4 D closed as it stands:');
{
  const d = { ...pausedSession, status: 'completed' as const };
  const cStart = { id: 'next-c', date: new Date('2026-11-05T07:00:00-04:00'), exercises: toWorkoutTemplate(C_ID, { ...cRaw, exercises: cRows }).exercises.map((r) => ({ awayGym: r.awayGym })) };
  say(`  calibration ran hot → "compounds at RIR 1–2 at altitude": ${calibrationRanHot(cStart, [...completed, d])}`);
  say(`  back-to-back → "isolations at RIR 1 today": ${isBackToBackGymDay(cStart, [...completed, d], boundary)} (Fri 11/6: ${isBackToBackGymDay({ ...cStart, date: new Date('2026-11-06T07:00:00-04:00') }, [...completed, d], boundary)})`);
}

say('\nWalks 11/2–11/3 (activity only):');
for (const s of sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.exercises.length === 0 && s.date >= new Date('2026-11-02T04:00:00Z') && s.date < new Date('2026-11-04T04:00:00Z'))) {
  for (const b of s.cardio ?? []) say(`  ${s.date.toISOString()} ${b.modality} "${b.label}" ${Math.round(b.durationSec / 60)} min, HR ${b.avgHr} → zone2 ${JSON.stringify(zone2Check(b))}`);
}

say('\nSample export rows (core buildCsv on the paused session):');
{
  const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, workoutSessions: [pausedSession] });
  const [head, ...lines] = csv.split(/\r?\n/);
  const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const cols = cells(head);
  const want = ['type', 'date', 'exercise', 'setKind', 'setGroup', 'setWeight', 'loadUnit', 'loadInUnit', 'setReps', 'setRir', 'sessionStatus', 'segmentIndex', 'notes'];
  say(`  ${want.join(',')}`);
  for (const l of lines.filter((x) => x.startsWith('workout,') || /Romanian|Seated Cable Row|Hammer/.test(x)).slice(0, 8)) {
    const c = cells(l);
    say(`  ${want.map((w) => { const v = c[cols.indexOf(w)] ?? ''; return v.includes(',') ? `"${v}"` : v; }).join(',')}`);
  }
}

say(`\nPLAN: session ${sessionWrite ? 'WRITE' : 'unchanged'}, Travel C ${cWrite ? 'WRITE' : '—'}, Travel D ${dWrite ? 'WRITE' : '—'}, plan ${planWrite ? 'WRITE' : '—'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!sessionWrite && !cWrite && !dWrite && !planWrite) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-04-pause-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, session: { id: SESSION_ID, ...raw }, travelPeriods: prof.travelPeriods, templates: { [C_ID]: cRaw, [D_ID]: dRaw } }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const prune = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const batch = db.batch();
if (sessionWrite) {
  batch.update(sesDoc.ref, {
    status: 'paused',
    exercises: prune(exercises),
    segments: segments.map((g) => ({ start: Timestamp.fromDate(g.start), end: Timestamp.fromDate(g.end) })),
    durationMin: 37,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
if (cWrite) batch.update(user.collection('workoutTemplates').doc(C_ID), { exercises: prune(cRows), updatedAt: FieldValue.serverTimestamp() });
if (dWrite) batch.update(user.collection('workoutTemplates').doc(D_ID), { exercises: prune(dRows), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();
const after = toWorkoutSession(SESSION_ID, (await sesDoc.ref.get()).data()!);
say(`written. session now ${after.status}, ${after.exercises.length} rows, ${after.segments?.length} part(s), ${after.durationMin} min.`);
process.exit(0);
