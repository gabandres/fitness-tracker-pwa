/**
 * Owner data, requested 2026-11-04 evening (America/La_Paz), for Thu 11/5:
 *
 *   SESSION   11/4 Travel D (`9G254bQLXwo1B9IePk1K`) → completed + `partial`.
 *             It was resumed at 20:21Z and nothing was logged in part 2, so the
 *             empty part is dropped: one part, 37 min. Skipped = the six steps
 *             not reached (Kneeling Cable Crunch, Deficit Push-up, Skull
 *             Crusher, Lateral c1, Lateral c2 + drop, Rope Face Pull), named by
 *             core `remainingSteps`. Nothing else is flagged.
 *             Its kg sets get `unit: 'kg'` and full-precision pounds of the kg
 *             value (12 kg = kgToLb(12)); a value already exact is unchanged,
 *             so a re-run converts nothing twice.
 *   CATALOG   + One-arm DB Row, + Lying DB Leg Curl (Haven alternatives).
 *   TEMPLATES Travel C / D: one-tap DB alternatives (core `row-options.ts`):
 *             Rope OH Ext → Overhead DB Extension; Behind-body Cable Curl →
 *             Incline DB Curl 45°; Rope Face Pull → Rear Delt DB Flye; Kneeling
 *             Cable Crunch → Weighted Floor Crunch (plate); Lat Pulldown →
 *             One-arm DB Row (1 cluster per arm); Seated Leg Curl → Lying DB Leg
 *             Curl. Single-leg calf → optional.
 *             NEW one-off `travel-cd-carryover-2026-11-05` "Travel C + D
 *             carryover (equipment-adjusted)", kg, Haven Gym, time cap 65 min.
 *   PLAN      11/4 D closed partial · 11/5 the one-off · Mon 11/9 Travel D
 *             (full) · Wed 11/11 Travel C · Santa Cruz from 11/13 (no gym;
 *             skipped ≠ missed) · travel mode ends 11/19.
 *
 * DRY RUN unless `--apply`; everything it touches is backed up first; re-runs
 * plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-05-carryover.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { PlannedSet, SessionExercise, TemplateExercise, WorkoutSet } from '../packages/core/src/workout.ts';
import {
  type RowAlternative,
  type TravelPlanEntry,
  buildCsv,
  calibrationRanHotOn,
  dayBoundaryOf,
  isBackToBackGymDay,
  kgOf,
  kgToLb,
  lbToKg,
  remainingStepText,
  remainingSteps,
  toDomainProfile,
  toWorkoutSession,
  travelWeek,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = '9G254bQLXwo1B9IePk1K';
const SEG_START = '2026-11-04T10:40:32.075Z';
const SEG_END = '2026-11-04T11:17:33.729Z';
const C_ID = 'travel-gym-c';
const D_ID = 'travel-gym-d';
const ONE_OFF = 'travel-cd-carryover-2026-11-05';
const GYM = 'Haven Gym';
const kg = (v: number) => kgToLb(v);

// Exercise ids (read 2026-11-04).
const ID = {
  legPress: 'haven-45-leg-press', flat: 'ud6fE363QklE3qXYxLw3', floorCrunch: 'x3G0Speg04GclIOdKHAl', cableCrunch: 'haven-kneeling-cable-crunch',
  pulldown: 'haven-lat-pulldown-wide', dbRow: 'haven-one-arm-db-row', legCurl: 'haven-seated-leg-curl', lyingCurl: 'haven-lying-db-leg-curl',
  incline: 'haven-30-incline-db-press', deficit: 'Zqb1sTIfs0olSLeDFlx1', ohDb: 'AAHHWXTA7UtbNWZbcf7z', ropeOh: 'haven-rope-overhead-triceps',
  skull: 'EyDTWnfO4WrbYDbDkxrk', inclineCurl: 'MVC1wLKBkRz7XYyKp79e', cableCurl: 'haven-behind-body-cable-curl', rearDelt: 'v2uqmVt1K4fJd0d6t4De',
  facePull: 'haven-rope-face-pull', lateral: 'haven-db-lateral-raise', calf: 'm5E72J63gVXltnQ0zC8f',
};
const NEW_CATALOG: Record<string, { name: string; muscles: string[]; category: string }> = {
  [ID.dbRow]: { name: 'One-arm DB Row', muscles: ['back', 'biceps'], category: 'compound' },
  [ID.lyingCurl]: { name: 'Lying DB Leg Curl', muscles: ['hamstrings'], category: 'isolation' },
};

/** activation → mini → mini, `n` clusters (+ a drop on the last). */
const clusters = (n: number, drop?: number): PlannedSet[] => [
  ...Array.from({ length: n }, (_, i) => [
    { kind: 'activation' as const, group: i + 1 }, { kind: 'mini' as const, group: i + 1 }, { kind: 'mini' as const, group: i + 1 },
  ]).flat(),
  ...(drop != null ? [{ kind: 'drop' as const, group: n, weight: kg(drop) }] : []),
];
const perArm: PlannedSet[] = [
  { kind: 'activation', group: 1, label: 'L' }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 },
  { kind: 'activation', group: 2, label: 'R' }, { kind: 'mini', group: 2 }, { kind: 'mini', group: 2 },
];
const HAVEN_NOTE = 'Haven Gym — new baseline; different equipment, not comparable to home e1RM';
const ALTS: Record<string, RowAlternative> = {
  [ID.ropeOh]: { exerciseId: ID.ohDb, name: 'Overhead DB Extension', targetLoad: kg(10), linkedHome: true, cues: ['Strict, elbows in.', 'Same lift as home — one history.'], note: 'no rope / cable busy' },
  [ID.cableCurl]: { exerciseId: ID.inclineCurl, name: 'Incline DB Curl 45°', targetLoad: kg(8), linkedHome: true, cues: ['Bench at 45°. Same lift as home — one history.'], note: 'cable busy' },
  [ID.facePull]: { exerciseId: ID.rearDelt, name: 'Rear Delt DB Flye', targetLoad: kg(8), linkedHome: true, cues: ['Same lift as home — one history.'], note: 'no rope / cable busy' },
  [ID.cableCrunch]: { exerciseId: ID.floorCrunch, name: 'Weighted Floor Crunch (plate)', targetLoad: kg(10), linkedHome: true, cues: ['Plate on the chest. Shares history with the home crunch.'], note: 'cable busy' },
  [ID.pulldown]: { exerciseId: ID.dbRow, name: 'One-arm DB Row', targetLoad: kg(16), plannedSets: perArm, cues: ['1 cluster per arm (L then R).'], note: 'if the pulldown is busy' },
  [ID.legCurl]: { exerciseId: ID.lyingCurl, name: 'Lying DB Leg Curl', cues: ['DB between the feet, face down on a flat bench.'], note: 'if the machine is busy' },
};

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const [profileSnap, exSnap, tplSnap, sesSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(200).get(),
]);
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);
const exIds = new Set(exSnap.docs.map((d) => d.id));
for (const id of Object.values(ID)) if (!exIds.has(id) && !NEW_CATALOG[id]) throw new Error(`catalog is missing ${id}`);

// ── 1. the 11/4 session ──
const sesDoc = sesSnap.docs.find((d) => d.id === SESSION_ID);
if (!sesDoc) throw new Error('the 11/4 session is not there');
const raw = sesDoc.data();
const session = toWorkoutSession(sesDoc.id, raw);
if (session.templateId !== D_ID || session.date.toISOString() !== SEG_START) throw new Error('not the 11/4 Travel D session');
const alreadyClosed = session.status === 'completed' && session.partial != null;
if (!alreadyClosed) {
  if (session.status !== 'active' && session.status !== 'paused') throw new Error(`session is ${session.status}`);
  const late = session.exercises.flatMap((e) => e.sets).filter((s) => (s.segment ?? 1) > 1 && (s.reps != null || s.durationSec != null));
  if (late.length) throw new Error(`${late.length} sets were logged in part 2 — read again before closing`);
}
/** A kg set: its kg value to 0.1, as exact pounds, labelled kg. */
const kgSet = (s: WorkoutSet, unit: SessionExercise['loadUnit']): WorkoutSet => {
  if (unit !== 'kg' || s.weight == null || s.weight === 0) return s;
  const v = Math.round(lbToKg(s.weight) * 10) / 10;
  // Already the exact pounds of a 0.1-kg value (to 1e-6 lb): kept, so a re-run
  // converts nothing twice.
  const weight = Math.abs(s.weight - kgToLb(v)) < 1e-6 ? s.weight : kgToLb(v);
  return s.unit === 'kg' && weight === s.weight ? s : { ...s, weight, unit: 'kg' };
};
const closedExercises = session.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => kgSet(s, e.loadUnit)) }));
const skipped = remainingSteps(session).map(remainingStepText);
const sessionWrite = !alreadyClosed || JSON.stringify(closedExercises) !== JSON.stringify(session.exercises);

// ── 2. templates ──
type Row = TemplateExercise & Record<string, unknown>;
const tplRaw = new Map(tplSnap.docs.map((d) => [d.id, d.data()]));
const cRaw = tplRaw.get(C_ID);
const dRaw = tplRaw.get(D_ID);
if (!cRaw || !dRaw) throw new Error('Travel C / D missing');
const withOptions = (rows: Row[]): Row[] => rows.map((r) => {
  let x = r;
  const alt = ALTS[r.exerciseId];
  if (alt && !(r.alternatives ?? []).some((a) => a.exerciseId === alt.exerciseId)) x = { ...x, alternatives: [...(r.alternatives ?? []), alt] };
  if (r.exerciseId === ID.calf && !r.optional) x = { ...x, optional: true };
  return x === r ? r : { ...x, lastModifiedAt: stamp, lastModifiedBy: 'prompt' };
});
const cRows = withOptions(cRaw.exercises as Row[]);
const dRows = withOptions(dRaw.exercises as Row[]);
const changed = (a: Row[], b: Row[]) => a.some((r, i) => r !== b[i]);
const cWrite = changed(cRows, cRaw.exercises as Row[]);
const dWrite = changed(dRows, dRaw.exercises as Row[]);

// The one-off. Rows copy the source row (progression, rests, cues) and set
// their own clusters, load and labels.
const src = (id: string): Row => {
  const r = [...(cRaw.exercises as Row[]), ...(dRaw.exercises as Row[])].find((x) => x.exerciseId === id);
  return r ? { ...r } : ({ exerciseId: id, name: '', plannedSets: [], cues: [], logStyle: 'weight-reps', progression: { targetReps: 15, holdSessions: 1, incrementLb: 5.51 } } as Row);
};
const catName = (id: string) => (exSnap.docs.find((d) => d.id === id)?.data().name as string | undefined) ?? NEW_CATALOG[id]?.name ?? id;
const COMPOUND = 'RIR 1–2 — back-to-back day; you logged RIR 0 on 11/4.';
const ISO = 'RIR 1 — back-to-back day.';
const CARRY = 'Carryover from 2026-11-04.';
const row = (id: string, o: {
  name?: string; sets: PlannedSet[]; kgLoad?: number; cues: string[]; ss?: [string, 1 | 2 | 3]; linkedHome?: boolean;
  carry?: number; alternatives?: RowAlternative[]; restClusterSec?: number;
}): Row => {
  const s = src(id);
  const r: Row = {
    exerciseId: id,
    name: o.name ?? (s.name || catName(id)),
    plannedSets: o.sets,
    cues: [...o.cues, ...(o.carry ? [CARRY] : []), HAVEN_NOTE],
    logStyle: s.logStyle ?? 'weight-reps',
    ...(s.progression ? { progression: s.progression } : {}),
    ...(o.kgLoad != null ? { targetLoad: kg(o.kgLoad) } : {}),
    loadUnit: 'kg',
    awayGym: GYM,
    ...(o.linkedHome ? { linkedHome: true } : {}),
    ...(o.ss ? { supersetGroup: o.ss[0], pairPosition: o.ss[1] } : {}),
    ...(o.ss?.[1] === 1 ? { transitionRestSec: 30, roundRestSec: 90 } : {}),
    ...(o.restClusterSec != null ? { restClusterSec: o.restClusterSec } : {}),
    ...(o.carry ? { carryover: { from: '2026-11-04', clusters: o.carry } } : {}),
    ...(o.alternatives ? { alternatives: o.alternatives } : {}),
    lastModifiedAt: stamp,
    lastModifiedBy: 'prompt',
  };
  return r;
};
const oneOffRows: Row[] = [
  row(ID.legPress, { sets: clusters(2), cues: ['Calibrate: first Haven session — activation RIR 2; ≥ 3 reps over target → raise load now.', COMPOUND], restClusterSec: 105 }),
  row(ID.flat, { sets: clusters(2), kgLoad: 10, cues: [COMPOUND], ss: ['A', 1], linkedHome: true }),
  row(ID.floorCrunch, { name: 'Weighted Floor Crunch (plate)', sets: clusters(3), kgLoad: 10, cues: ['10 kg plate on the chest. Shares history with the home crunch.', ISO, '3 clusters = 2 from C + 1 carried from D.'], ss: ['A', 2], linkedHome: true, carry: 1 }),
  row(ID.pulldown, { sets: clusters(2), kgLoad: 37, cues: [COMPOUND], ss: ['B', 1], alternatives: [ALTS[ID.pulldown]], restClusterSec: 105 }),
  row(ID.legCurl, { sets: clusters(2), kgLoad: 40, cues: [ISO], ss: ['B', 2], alternatives: [ALTS[ID.legCurl]] }),
  row(ID.incline, { sets: clusters(1), kgLoad: 10, cues: ['10 kg = last Haven load (11/4: 10 kg × 9).', COMPOUND], ss: ['C', 1] }),
  row(ID.deficit, { sets: clusters(1), cues: [ISO], ss: ['C', 2], linkedHome: true, carry: 1 }),
  row(ID.ohDb, { name: 'Overhead DB Extension (strict, elbows in)', sets: clusters(1), kgLoad: 10, cues: ['Strict, elbows in. Same lift as home — one history.', ISO], ss: ['D', 1], linkedHome: true }),
  row(ID.skull, { sets: clusters(1), kgLoad: 6, cues: [ISO], ss: ['D', 2], linkedHome: true, carry: 1 }),
  row(ID.inclineCurl, { sets: clusters(1), kgLoad: 8, cues: ['Bench at 45°.', ISO], ss: ['D', 3], linkedHome: true }),
  row(ID.rearDelt, { name: 'Rear Delt DB Flye', sets: clusters(2), kgLoad: 8, cues: ['D4: last of block D, 30 s after the incline curl.', ISO], linkedHome: true }),
  row(ID.lateral, { sets: clusters(3, 4), kgLoad: 6, cues: ['6 kg; drop to 4 kg on the last cluster.', '3 clusters = 1 from C + 2 carried from D.', ISO], carry: 2, restClusterSec: 60 }),
];
const ONE_OFF_NOTES = [
  '2026-11-05 — Travel C + D carryover (equipment-adjusted). ONE-OFF: Travel C and D templates unchanged. Haven Gym, Cochabamba, 2,577 m. Loads in kg.',
  'Back-to-back with 11/4 D: compounds RIR 1–2 (you logged RIR 0 on 11/4), isolations RIR 1.',
  'Carried from 11/4 (counted once in weekly volume — 11/4 logged none of them): 1 crunch cluster, deficit push-up, skull crusher, 2 lateral clusters + drop.',
  'Removed this session: single-leg calf, rope OH extension, behind-body cable curl, rope face pull.',
  'Time cap: past 65 min drop the 3rd lateral cluster, then the 2nd rear delt cluster, then the leg curl.',
  'ORDER: 1 leg press · A1/A2 · B1/B2 · C1/C2 · D1 → D2 → D3 → D4 · E lateral.',
].join('\n');
const oneOffDoc = {
  name: 'Travel C + D carryover (equipment-adjusted)',
  notes: ONE_OFF_NOTES,
  templateVersion: cRaw.templateVersion ?? 'travel-gym-v3',
  restMiniSec: 10,
  restClusterSec: 90,
  exercises: oneOffRows,
  timeCap: { minutes: 65, drop: ['3rd lateral cluster', '2nd rear delt cluster', 'leg curl'] },
};
const oneOffExists = tplRaw.has(ONE_OFF);

// ── 3. plan ──
const prof = profileSnap.data()!;
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip is not on the profile');
const planBefore = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
const NEW_PLAN: TravelPlanEntry[] = [
  { from: '2026-11-04', to: '2026-11-04', kind: 'session', label: 'Travel D', templateId: D_ID, note: 'partial: 37 min; the rest carried to 11/5' },
  { from: '2026-11-05', to: '2026-11-05', kind: 'session', label: 'Travel C + D carryover', templateId: ONE_OFF, note: 'equipment-adjusted, one-off; back-to-back: compounds RIR 1–2, isolations RIR 1' },
  { from: '2026-11-09', to: '2026-11-09', kind: 'session', label: 'Travel D (full)', templateId: D_ID },
  { from: '2026-11-11', to: '2026-11-11', kind: 'session', label: 'Travel C', templateId: C_ID },
  { from: '2026-11-13', to: '2026-11-13', kind: 'note', label: 'Santa Cruz', note: '~400 m, no gym: sessions optional; skipped is not missed' },
];
const replaced = (e: TravelPlanEntry) =>
  (e.kind === 'session' && (e.templateId === C_ID || e.templateId === D_ID || e.templateId === ONE_OFF) && e.from >= '2026-11-03' && e.from <= '2026-11-12')
  || (e.kind === 'note' && e.label === 'Santa Cruz');
const byDate = (a: TravelPlanEntry, b: TravelPlanEntry) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.kind < b.kind ? -1 : 1);
const plan = [...planBefore.filter((e) => !replaced(e)), ...NEW_PLAN].sort(byDate);
const planWrite = JSON.stringify(plan) !== JSON.stringify([...planBefore].sort(byDate));
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const boundary = dayBoundaryOf(toDomainProfile(prof));
say(`Session ${SESSION_ID}: ${session.status} → completed, partial · 1 part (${SEG_START.slice(11, 19)}Z → ${SEG_END.slice(11, 19)}Z) · 37 min${alreadyClosed ? ' (already closed)' : ''}`);
say(`  skipped: ${skipped.join(' · ')}`);
for (const e of closedExercises) {
  const w = e.sets.find((s) => s.weight)?.weight;
  const before = session.exercises.find((x) => x.exerciseId === e.exerciseId)?.sets.find((s) => s.weight)?.weight;
  if (w) say(`  ${e.name.padEnd(30)} ${before} → ${w} lb = ${kgOf(w)} kg${e.sets.some((s) => s.unit === 'kg') ? ', unit kg' : ''}`);
}
say(`\nCatalog: ${Object.entries(NEW_CATALOG).map(([id, c]) => `${exIds.has(id) ? '=' : '+'} ${c.name} (${id})`).join(' · ')}`);
say(`Travel C ${cWrite ? 'WRITE' : 'unchanged'} · Travel D ${dWrite ? 'WRITE' : 'unchanged'}`);
for (const [n, rows] of [['C', cRows], ['D', dRows]] as const) {
  for (const r of rows) {
    if (r.alternatives?.length || r.optional) say(`  ${n} ${r.name}${r.optional ? ' [optional]' : ''}${r.alternatives?.length ? ` → ${r.alternatives.map((a) => a.name).join(', ')}` : ''}`);
  }
}
say(`\nOne-off ${ONE_OFF} ${oneOffExists ? 'OVERWRITE' : 'CREATE'}: "${oneOffDoc.name}", cap ${oneOffDoc.timeCap.minutes} min`);
for (const r of oneOffRows) {
  const acts = r.plannedSets.filter((p) => p.kind === 'activation').length;
  say(`  ${(r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—').padEnd(3)} ${r.name.padEnd(42)} ${acts} cl${r.plannedSets.some((p) => p.kind === 'drop') ? ' + drop' : ''}  ${r.targetLoad != null ? `${kgOf(r.targetLoad)} kg` : 'calibrate'}${r.carryover ? `  carry ${r.carryover.clusters}` : ''}${r.alternatives ? `  alt: ${r.alternatives.map((a) => a.name).join(', ')}` : ''}${r.linkedHome ? '  linked' : ''}`);
}
say(`\nPlan ${planWrite ? 'WRITE' : 'unchanged'}:`);
for (const e of plan.filter((x) => x.from >= '2026-11-02')) say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''} ${e.kind.padEnd(7)} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
const closedSession = { ...session, status: 'completed' as const, exercises: closedExercises };
const completed = [closedSession, ...sesSnap.docs.filter((d) => d.id !== SESSION_ID).map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.status === 'completed')];
const week = travelWeek(plan, '2026-11-05', completed, boundary);
say(`  Today 11/5: ${week.rows.map((r) => `${r.from} ${r.label} [${r.status}]`).join(' · ')} · next: ${week.next?.label}`);
const start = { id: 'x', date: new Date('2026-11-05T07:00:00-04:00'), exercises: oneOffRows.map((r) => ({ awayGym: r.awayGym })) };
say(`  11/5 notes: ran hot on ${calibrationRanHotOn(start, completed)?.toISOString().slice(0, 10) ?? '—'} · back-to-back ${isBackToBackGymDay(start, completed, boundary)}`);
{
  const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, workoutSessions: [{ ...closedSession, partial: { closedAt: now, skipped }, segments: [{ start: new Date(SEG_START), end: new Date(SEG_END) }], durationMin: 37 }] });
  const [head, ...lines] = csv.split(/\r?\n/);
  const cols = head.split(',');
  const want = ['type', 'exercise', 'setKind', 'setWeight', 'setWeightKg', 'unit', 'setReps', 'setRir', 'sessionStatus'];
  say(`\nExport sample: ${want.join(',')}`);
  for (const l of lines.filter((x) => /Romanian|Cable Row|Hammer/.test(x)).slice(0, 4)) {
    const c = l.split(',');
    say(`  ${want.map((w) => c[cols.indexOf(w)] ?? '').join(',')}`);
  }
}

const catWrites = Object.entries(NEW_CATALOG).filter(([id]) => !exIds.has(id));
say(`\nPLAN: session ${sessionWrite ? 'WRITE' : '—'}, catalog +${catWrites.length}, C ${cWrite ? 'WRITE' : '—'}, D ${dWrite ? 'WRITE' : '—'}, one-off ${oneOffExists ? 'overwrite' : 'create'}, plan ${planWrite ? 'WRITE' : '—'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-05-carryover-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, session: { id: SESSION_ID, ...raw }, travelPeriods: prof.travelPeriods, templates: { [C_ID]: cRaw, [D_ID]: dRaw, [ONE_OFF]: tplRaw.get(ONE_OFF) ?? null } }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const prune = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const batch = db.batch();
if (sessionWrite) {
  batch.update(sesDoc.ref, {
    status: 'completed',
    exercises: prune(closedExercises),
    segments: [{ start: Timestamp.fromDate(new Date(SEG_START)), end: Timestamp.fromDate(new Date(SEG_END)) }],
    durationMin: 37,
    partial: { closedAt: alreadyClosed ? raw.partial.closedAt : Timestamp.fromDate(now), skipped },
    updatedAt: FieldValue.serverTimestamp(),
  });
}
for (const [id, c] of catWrites) {
  batch.set(user.collection('exercises').doc(id), { name: c.name, muscles: c.muscles, defaultCues: [], logStyle: 'weight-reps', category: c.category, createdAt: Timestamp.fromDate(now) });
}
if (cWrite) batch.update(user.collection('workoutTemplates').doc(C_ID), { exercises: prune(cRows), updatedAt: FieldValue.serverTimestamp() });
if (dWrite) batch.update(user.collection('workoutTemplates').doc(D_ID), { exercises: prune(dRows), updatedAt: FieldValue.serverTimestamp() });
batch.set(user.collection('workoutTemplates').doc(ONE_OFF), {
  ...(prune(oneOffDoc) as object),
  createdAt: oneOffExists ? tplRaw.get(ONE_OFF)!.createdAt : Timestamp.fromDate(now),
  updatedAt: FieldValue.serverTimestamp(),
});
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();
const after = toWorkoutSession(SESSION_ID, (await sesDoc.ref.get()).data()!);
say(`written. 11/4 now ${after.status}${after.partial ? ', partial' : ''}, ${after.durationMin} min, ${after.segments?.length} part(s).`);
process.exit(0);
