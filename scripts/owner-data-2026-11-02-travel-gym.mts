/**
 * The owner's Haven Gym plan (requested 2026-11-02, America/Puerto_Rico): gym
 * templates "Travel C" and "Travel D" (`travel-gym-v3`, Cochabamba, 2,577 m) and
 * the trip's planned sessions. Leg/Pull/Push v2.3 and Travel A/B are read and
 * must come out byte-identical; the script refuses if one would change.
 *
 * Writes, each only if absent or different (re-runs plan 0):
 *
 *   TEMPLATES `travel-gym-c`, `travel-gym-d`. An earlier template named
 *             "Travel C…" / "Travel D…" under another id is deleted.
 *   CATALOG   `haven-*` lifts: their own history, so no home comparison. The
 *             eight lifts the owner linked keep their home `exerciseId`.
 *   PROFILE   `travelPeriods[Bolivia].plan` (core `travel-plan.ts`): rules cap
 *             the list and do not read inside it, so no rules deploy.
 *
 * Structure, as the model holds it (`MAX_SUPERSET_SIZE` is 3):
 *   Travel C block D = tri-set D1–D3, then D4 as the next row at the same 30 s.
 *   Travel D block E = tri-set E1 skull, E2 lateral ×2 (cluster 2 + drop), E3
 *   hammer; supersetFlow runs E1 → E2c1 → E3 → E2c2+drop, then the face pull
 *   (the owner's E5) as the next row. Round rest is 30 in E because that round
 *   is the owner's E3 → E4 step.
 *
 * Kg: `targetLoad` stays pounds like every load in the app; `loadUnit: 'kg'` is
 * what the card shows and takes, and the export carries both.
 *
 * DRY RUN unless `--apply`; everything it would touch is backed up first.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/owner-data-2026-11-02-travel-gym.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Exercise, PlannedSet, TemplateExercise, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  activeTravel,
  buildCsv,
  calculateTdee,
  dayBoundaryOf,
  estimateTemplateDuration,
  isTravelTemplate,
  kgToLb,
  lbToKg,
  mergeDailyWeights,
  plannedVolume,
  reentryFor,
  restAfterSetInFlow,
  sessionCall,
  supersetFlow,
  templateRestFor,
  toDailyLog,
  toDomainProfile,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
  travelWeek,
  type TravelPlanEntry,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const VERSION = 'travel-gym-v3';
const GYM = 'Haven Gym';
const SINCE = '2026-11-03';
const TODAY = '2026-11-02';
const KG_STEP_LB = +kgToLb(2.5).toFixed(2);
const NOTE = 'Haven Gym — new baseline; different equipment, not comparable to home e1RM';
const ALTITUDE = 'Altitude: HR runs higher — extend rest if breathing hard; hydrate (bottled water).';
const C_ID = 'travel-gym-c';
const D_ID = 'travel-gym-d';
const kg = (v: number) => +kgToLb(v).toFixed(2);

const HOME = { flat: 'ud6fE363QklE3qXYxLw3', rdl: 'vtSvqglnBZdM1f3qOJi4', legRaise: 'jMGQm6C9I6HNNPXPYYLM', calf: 'm5E72J63gVXltnQ0zC8f', skull: 'EyDTWnfO4WrbYDbDkxrk', hammer: 'LvVitCaOS23MmPTKodlk', pushUp: 'Zqb1sTIfs0olSLeDFlx1', pullUp: 'GOGOcWJNC9q9aBmN3ENq' };
const HOME_EFFORT: Record<string, string> = { [HOME.flat]: 'rir1', [HOME.rdl]: 'rir2', [HOME.legRaise]: 'failure', [HOME.calf]: 'failure', [HOME.skull]: 'failure', [HOME.hammer]: 'failure', [HOME.pushUp]: 'failure', [HOME.pullUp]: 'rir1' };

type Effort = 'rir1' | 'failure';
const NEW_LIFTS: { id: string; name: string; muscles: string[]; effort: Effort; category: 'compound' | 'isolation' | 'core' }[] = [
  { id: 'haven-45-leg-press', name: '45° Leg Press', muscles: ['quads', 'glutes'], effort: 'rir1', category: 'compound' },
  { id: 'haven-kneeling-cable-crunch', name: 'Kneeling Cable Crunch (rope)', muscles: ['core'], effort: 'failure', category: 'core' },
  { id: 'haven-lat-pulldown-wide', name: 'Lat Pulldown (wide)', muscles: ['back', 'biceps'], effort: 'rir1', category: 'compound' },
  { id: 'haven-seated-leg-curl', name: 'Seated Leg Curl', muscles: ['hamstrings'], effort: 'failure', category: 'isolation' },
  { id: 'haven-30-incline-db-press', name: '30° Incline DB Press', muscles: ['chest', 'shoulders'], effort: 'failure', category: 'isolation' },
  { id: 'haven-low-to-high-cable-fly', name: 'Low-to-High Cable Fly', muscles: ['chest', 'shoulders'], effort: 'failure', category: 'isolation' },
  { id: 'haven-rope-overhead-triceps', name: 'Rope Overhead Triceps Extension', muscles: ['triceps'], effort: 'failure', category: 'isolation' },
  { id: 'haven-behind-body-cable-curl', name: 'Behind-body Cable Curl', muscles: ['biceps'], effort: 'failure', category: 'isolation' },
  { id: 'haven-rope-face-pull', name: 'Rope Face Pull', muscles: ['shoulders', 'back'], effort: 'failure', category: 'isolation' },
  { id: 'haven-cable-lateral-raise', name: 'Cable Lateral Raise (single arm)', muscles: ['shoulders'], effort: 'failure', category: 'isolation' },
  { id: 'haven-seated-cable-row', name: 'Seated Cable Row', muscles: ['back', 'biceps'], effort: 'rir1', category: 'compound' },
  { id: 'haven-leg-extension', name: 'Leg Extension', muscles: ['quads'], effort: 'failure', category: 'isolation' },
  { id: 'haven-plate-shoulder-press', name: 'Plate-loaded Shoulder Press', muscles: ['shoulders', 'triceps'], effort: 'rir1', category: 'compound' },
  { id: 'haven-db-lateral-raise', name: 'DB Lateral Raise (Haven)', muscles: ['shoulders'], effort: 'failure', category: 'isolation' },
];
const newLift = (id: string) => NEW_LIFTS.find((l) => l.id === id)!;

// ── the rows ──
const cluster = (group: number, label?: string): PlannedSet[] => (['activation', 'mini', 'mini'] as const).map((kind) => ({ kind, group, ...(label ? { label } : {}) }));
const clusters = (n: number, labels?: string[]) => Array.from({ length: n }, (_, i) => cluster(i + 1, labels?.[i])).flat();

interface RowSpec {
  id: string;
  name?: string;
  effort?: Effort | 'rir2';
  sets: PlannedSet[];
  group?: string;
  pos?: 1 | 2 | 3;
  startKg?: number;
  bodyweight?: boolean;
  cues?: string[];
  transition?: number;
  round?: number;
  /** Rest between this lift's own clusters, seconds. */
  ownRest?: number;
  /** Rest after the lift, before the next, seconds. */
  after?: number;
  straight?: boolean;
}
const isLinked = (id: string) => Object.values(HOME).includes(id);
const effortOf = (s: RowSpec) => (isLinked(s.id) ? HOME_EFFORT[s.id] : newLift(s.id).effort);
function row(s: RowSpec, stamp: string): TemplateExercise & Record<string, unknown> {
  const effort = effortOf(s);
  const top = effort === 'failure' ? 15 : 12;
  const name = s.name ?? (isLinked(s.id) ? '' : newLift(s.id).name);
  const load = s.bodyweight ? 0 : s.startKg != null ? kg(s.startKg) : undefined;
  return {
    exerciseId: s.id,
    name,
    ...(load != null ? { targetLoad: load } : {}),
    logStyle: 'weight-reps',
    ...(s.straight ? { setStructure: 'straight' } : {}),
    plannedSets: s.sets,
    progression: { targetReps: top, holdSessions: 1, incrementLb: KG_STEP_LB },
    cues: [
      effort === 'failure' ? 'RIR 0 — to failure' : effort === 'rir2' ? 'RIR 2 on every set' : 'RIR 1 — stop 1 rep before failure; minis RIR 0–1',
      'First Haven session: activation RIR 2 (calibration). Activation ≥ 3 reps over target → raise load now.',
      `Progression: activation ≥ ${top} at target effort → increase load next session.`,
      ...(s.cues ?? []),
      NOTE,
    ],
    baseline: { since: SINCE, reason: 'Haven Gym — new baseline' },
    loadUnit: 'kg',
    awayGym: GYM,
    ...(isLinked(s.id) ? { linkedHome: true } : {}),
    ...(s.group ? { supersetGroup: s.group, pairPosition: s.pos } : {}),
    ...(s.transition != null ? { transitionRestSec: s.transition } : {}),
    ...(s.round != null ? { roundRestSec: s.round } : {}),
    ...(s.ownRest != null ? { restClusterSec: s.ownRest, minClusterRestSec: s.group ? s.ownRest : undefined } : {}),
    ...(s.after != null ? { restAfterSec: s.after } : {}),
    ...(s.straight ? { restMiniSec: 120 } : {}),
    ...(load ? { loadLog: [{ at: stamp, to: load, by: 'prompt', reason: `Haven Gym start ${s.startKg} kg (owner, 2026-11-02)` }] } : {}),
    lastModifiedAt: stamp,
    lastModifiedBy: 'prompt',
  } as TemplateExercise & Record<string, unknown>;
}

const UPPER_CHEST = (other: string) => [`No adjustable bench: Low-to-High Cable Fly instead (swap it in). ${other}`];
const C_ROWS: RowSpec[] = [
  { id: 'haven-45-leg-press', sets: clusters(2), ownRest: 105, after: 105 },
  { id: HOME.flat, name: 'DB Flat Press', sets: clusters(2), group: 'A', pos: 1, transition: 30, round: 90, startKg: 10, ownRest: 90, cues: ['Start 10 kg per hand.'] },
  { id: 'haven-kneeling-cable-crunch', sets: clusters(2), group: 'A', pos: 2, after: 90 },
  { id: 'haven-lat-pulldown-wide', sets: clusters(2), group: 'B', pos: 1, transition: 30, round: 90, startKg: 37, ownRest: 105, cues: ['Start ~37 kg.'] },
  { id: 'haven-seated-leg-curl', sets: clusters(2), group: 'B', pos: 2, after: 90, cues: ['Alt: lying DB leg curl.'] },
  { id: 'haven-30-incline-db-press', sets: clusters(1), group: 'C', pos: 1, transition: 30, round: 90, cues: UPPER_CHEST('Use the same choice on Travel D.') },
  { id: HOME.calf, name: 'Single-leg DB calf raise', sets: clusters(2, ['L', 'R']), group: 'C', pos: 2, after: 90, cues: ['Alt: calf press on the leg press.'] },
  { id: 'haven-rope-overhead-triceps', sets: clusters(1), group: 'D', pos: 1, transition: 30, round: 90, cues: ['Elbows in.'] },
  { id: 'haven-behind-body-cable-curl', sets: clusters(1), group: 'D', pos: 2 },
  { id: 'haven-rope-face-pull', sets: clusters(1), group: 'D', pos: 3, after: 30 },
  { id: 'haven-cable-lateral-raise', sets: clusters(1), after: 90, cues: ['D4: last of block D, 30 s after the face pull.', '2–3 s lowering.'] },
];
const D_ROWS: RowSpec[] = [
  { id: HOME.rdl, name: 'DB Romanian deadlift', straight: true, startKg: 12, after: 90, sets: [{ kind: 'working', reps: 8, repsMax: 12 }, { kind: 'working', reps: 8, repsMax: 12 }], cues: ['Straight 2 × 8–12, 120 s rest, no minis. Start 12 kg per hand.', 'low-back rule: sharp pain or >3/10 → stop'] },
  { id: 'haven-seated-cable-row', sets: clusters(2), group: 'A', pos: 1, transition: 30, round: 90, ownRest: 105, cues: ['Alt: one-arm DB row on flat bench.'] },
  { id: 'haven-leg-extension', sets: clusters(2), group: 'A', pos: 2, after: 90, cues: ['Alt: 45° leg press 15–20.'] },
  { id: 'haven-plate-shoulder-press', sets: clusters(1), group: 'B', pos: 1, transition: 30, round: 90 },
  { id: HOME.legRaise, name: 'Hanging Leg Raise', bodyweight: true, sets: clusters(1), group: 'B', pos: 2, after: 90 },
  { id: HOME.pullUp, name: 'Pull-up (neutral / overhand)', bodyweight: true, sets: clusters(1), group: 'C', pos: 1, transition: 30, round: 90, cues: ['Neutral grip if handles exist, else overhand.'] },
  { id: 'haven-kneeling-cable-crunch', sets: clusters(1), group: 'C', pos: 2, after: 90 },
  { id: 'haven-30-incline-db-press', sets: clusters(1), after: 90, cues: UPPER_CHEST('Same choice as Travel C.') },
  { id: HOME.pushUp, name: 'Deficit Push-up', bodyweight: true, sets: clusters(1), after: 90 },
  { id: HOME.skull, name: 'Skull Crusher', sets: clusters(1), group: 'E', pos: 1, transition: 30, round: 30, cues: ['Flat bench.'] },
  { id: 'haven-db-lateral-raise', sets: [...cluster(1), ...cluster(2), { kind: 'drop', group: 2 }], group: 'E', pos: 2, after: 30, cues: ['E2 cluster 1, E4 cluster 2 + drop set.', '2–3 s lowering.'] },
  { id: HOME.hammer, name: 'DB Hammer Curl', sets: clusters(1), group: 'E', pos: 3 },
  { id: 'haven-rope-face-pull', sets: clusters(1), after: 90, cues: ['E5: last of block E, 30 s after the lateral raise.'] },
];
const notes = (title: string, order: string) => `2026-11-02 — ${title}. Haven Gym, Cochabamba, 2,577 m. Trip Bolivia, ${VERSION}. No Zone 2: walking at altitude covers it.
${ALTITUDE}
FORMAT: activation → 10 s → mini → 10 s → mini; 90 s between clusters (105 for leg press, pulldown, row). Supersets / tri-sets: 30 s between lifts, 90 s between rounds. Loads in kg.
EFFORT: first Haven session of a lift = activation RIR 2 (calibration); ≥ 3 reps over target → raise load now. After that compounds RIR 1 (minis 0–1), isolations to failure. C and D on consecutive days: isolations at RIR 1 on the second day.
PROGRESSION: activation ≥ 12 (compounds) / ≥ 15 (isolations) at target effort → increase load next session.
ORDER: ${order}`;

const PLAN: TravelPlanEntry[] = [
  { from: '2026-11-02', to: '2026-11-02', kind: 'rest', label: 'Rest', note: 'planned rest day' },
  { from: '2026-11-03', to: '2026-11-03', kind: 'session', label: 'Travel C', templateId: C_ID, note: 'calibration session' },
  { from: '2026-11-04', to: '2026-11-05', kind: 'session', label: 'Travel D', templateId: D_ID, note: 'Wed or Thu, your pick' },
  { from: '2026-11-09', to: '2026-11-09', kind: 'session', label: 'Travel C', templateId: C_ID },
  { from: '2026-11-11', to: '2026-11-11', kind: 'session', label: 'Travel D', templateId: D_ID },
  { from: '2026-11-13', to: '2026-11-18', kind: 'session', label: 'Travel A', templateId: 'travel-a-full-body', note: 'Santa Cruz, no gym; any day' },
  { from: '2026-11-13', to: '2026-11-18', kind: 'session', label: 'Travel B', templateId: 'travel-b-full-body', note: 'Santa Cruz, no gym; any day' },
  { from: '2026-11-19', to: '2026-11-19', kind: 'note', label: 'Travel mode ends', note: 'first Leg / Pull / Push back at −10% load, RIR 2, post-travel re-entry' },
];

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const [profileSnap, exSnap, tplSnap, sesSnap, logsSnap, weightsSnap, loggedSnap] = await Promise.all([
  user.get(),
  user.collection('exercises').get(),
  user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
  user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(400).get(),
  user.collection('dailyWeights').get(),
  user.collection('dailyLogged').get(),
]);
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const exById = new Map(exSnap.docs.map((d) => [d.id, d]));
for (const [key, id] of Object.entries(HOME)) {
  const d = exById.get(id);
  if (!d) throw new Error(`linked lift ${key} ${id} is not in the catalog`);
  if ((d.get('effortStandard') ?? 'failure') !== HOME_EFFORT[id]) throw new Error(`${d.get('name')}: catalog effort ${d.get('effortStandard')}, spec ${HOME_EFFORT[id]}`);
}
for (const l of NEW_LIFTS) if (exById.has(l.id) && exById.get(l.id)!.get('name') !== l.name) throw new Error(`catalog ${l.id} exists as "${exById.get(l.id)!.get('name')}"`);
const nameClash = exSnap.docs.filter((d) => !d.id.startsWith('haven-') && NEW_LIFTS.some((l) => l.name.toLowerCase() === String(d.get('name')).toLowerCase()));
if (nameClash.length) throw new Error(`name clash with the catalog: ${nameClash.map((d) => d.get('name')).join(', ')}`);

const stale = tplSnap.docs.filter((d) => /^Travel [CD]\b/.test(String(d.get('name'))) && d.id !== C_ID && d.id !== D_ID);
say(`Templates: ${tplSnap.docs.map((d) => `${d.get('name')} [${d.get('templateVersion') ?? ''}]`).join(' · ')}`);
say(`Earlier Travel C/D under other ids: ${stale.length ? stale.map((d) => d.id).join(', ') : 'none'}`);

// ── build ──
const buildBody = (name: string, order: string, rows: RowSpec[]) => ({
  name,
  notes: notes(name, order),
  templateVersion: VERSION,
  restMiniSec: 10,
  restClusterSec: 90,
  exercises: rows.map((s) => JSON.parse(JSON.stringify(row(s, stamp)))),
});
const docs = [
  { id: C_ID, body: buildBody('Travel C — Squat / Flat press / Pulldown / Calves', '1 leg press · A1/A2 · B1/B2 · C1/C2 · D1 → D2 → D3 → D4', C_ROWS) },
  { id: D_ID, body: buildBody('Travel D — Hinge / Row / Shoulders / Arms', '1 RDL · A1/A2 · B1/B2 · C1/C2 · upper chest · deficit push-up · E1 → E2 → E3 → E4 (E2 cluster 2 + drop) → E5', D_ROWS) },
];
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => !['lastModifiedAt', 'at'].includes(k) && (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const tplDoc = new Map(tplSnap.docs.map((d) => [d.id, d]));
const tplWrites = docs.filter((d) => {
  const cur = tplDoc.get(d.id)?.data();
  if (!cur) return true;
  const { createdAt: _c, updatedAt: _u, ...keep } = cur;
  return stable(keep) !== stable(d.body);
});
const catCreates = NEW_LIFTS.filter((l) => !exById.has(l.id)).map((l) => ({
  id: l.id,
  doc: { name: l.name, muscles: l.muscles, defaultCues: [], logStyle: 'weight-reps', effortStandard: l.effort, category: l.category, createdAt: Timestamp.fromDate(now) },
}));
const catalogAfter: Exercise[] = [...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())), ...catCreates.map((c) => toWorkoutExercise(c.id, c.doc))];
const musclesOf = (id: string) => catalogAfter.find((c) => c.id === id)?.muscles;

const prof = profileSnap.data()!;
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip is not on the profile');
const planWrite = stable(rawPeriods[iTrip].plan) !== stable(PLAN);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan: PLAN } : p));

// ── report ──
const after: WorkoutTemplate[] = docs.map((d) => toWorkoutTemplate(d.id, d.body));
const shape = (r: TemplateExercise) => {
  const a = r.plannedSets.filter((s) => s.kind === 'activation').length;
  const w = r.plannedSets.filter((s) => s.kind === 'working');
  const drop = r.plannedSets.some((s) => s.kind === 'drop');
  return w.length ? `straight ${w.length}×${w[0].reps}–${w[0].repsMax}` : `${a} cluster${a > 1 ? 's' : ''}${drop ? ' + drop' : ''}`;
};
const loadText = (r: TemplateExercise) => (r.targetLoad == null ? 'load blank' : r.targetLoad === 0 ? 'BW' : `${lbToKg(r.targetLoad).toFixed(1).replace('.0', '')} kg = ${r.targetLoad} lb`);
const effortText = (r: TemplateExercise) => (catalogAfter.find((c) => c.id === r.exerciseId)?.effortStandard ?? 'failure');
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const completed = sessions.filter((s) => s.status === 'completed');
for (const t of after) {
  say(`\n${t.name} [${t.id}] ${t.templateVersion} · ${estimateTemplateDuration(t, musclesOf).minutes} min est.`);
  t.exercises.forEach((r, i) => {
    const tag = r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—';
    say(`  ${String(i + 1).padStart(2)} ${tag.padEnd(3)} ${r.name.padEnd(34)} ${shape(r).padEnd(18)} ${effortText(r).padEnd(8)} ≥${String(r.progression?.targetReps).padEnd(3)} ${loadText(r).padEnd(20)} ${(r as { linkedHome?: boolean }).linkedHome ? 'LINKED' : 'own history'}`);
  });
  const rows = t.exercises.map((e) => ({ ...e, sets: e.plannedSets }));
  const restFor = templateRestFor(t);
  const flow = supersetFlow(rows);
  say('  performed sequence, rest after each:');
  say(`    ${flow.map((s) => {
    const r = restAfterSetInFlow(rows, s.exerciseIndex, s.setIndices[s.setIndices.length - 1], restFor);
    return `${s.label ?? '—'} ${t.exercises[s.exerciseIndex].name}${t.exercises[s.exerciseIndex].plannedSets.length > 3 ? ` c${s.unit + 1}` : ''} [${r.seconds}s]`;
  }).join(' → ')}`);
}

say('\nFirst call per row (core sessionCall, kg rows)');
for (const t of after) for (const r of t.exercises) {
  const { rec, history } = sessionCall(r, completed, catalogAfter.find((c) => c.id === r.exerciseId) ?? null);
  say(`  ${t.id.slice(-1).toUpperCase()} ${r.name.padEnd(34)} ${rec.action} (${(rec.reason as { kind: string }).kind}) · reads ${history.length}`);
}

const home = tplSnap.docs.filter((d) => ['Push Day', 'Pull Day', 'Leg Day'].includes(String(d.get('name')))).map((d) => toWorkoutTemplate(d.id, d.data()));
if (home.length !== 3 || home.some((t) => t.templateVersion !== 'v2.3')) throw new Error('home program is not Leg/Pull/Push v2.3');
const vHome = new Map(plannedVolume(home, catalogAfter).map((m) => [m.muscle, m]));
const vTrip = new Map(plannedVolume(after, catalogAfter).map((m) => [m.muscle, m]));
const EXPECT: Record<string, number> = { quads: 4, hamstrings: 4, back: 5, chest: 5, sideDelt: 3, rearDelt: 2, frontDelt: 1, biceps: 2, triceps: 2, abs: 4, calves: 2 };
say('\nVolume, core plannedVolume: muscle  C+D direct / fractional · owner expects · home v2.3 direct / fractional');
for (const m of [...new Set([...vHome.keys(), ...vTrip.keys()])]) {
  const a = vTrip.get(m); const b = vHome.get(m);
  say(`  ${m.padEnd(11)} ${String(a?.direct ?? 0).padStart(3)} / ${String(a?.fractional ?? 0).padEnd(5)} · ${String(EXPECT[m] ?? '—').padEnd(2)} · ${String(b?.direct ?? 0).padStart(3)} / ${b?.fractional ?? 0}`);
}

say('\nTravel mode');
const profileAfter = toDomainProfile({ ...prof, travelPeriods: periodsAfter });
const periods = travelPeriodsOf({ travelPeriods: periodsAfter });
const boundary = dayBoundaryOf(profileAfter);
const trip = activeTravel(TODAY, periods);
say(`  active today (${TODAY}): ${trip ? `${trip.label} ${trip.start} → ${trip.end}, ${trip.altitude?.place} ${trip.altitude?.meters} m from ${trip.altitude?.arrival}` : 'NO'}`);
{
  const weights: Record<string, number> = {};
  for (const d of weightsSnap.docs) if (typeof d.get('weight') === 'number') weights[d.id] = d.get('weight');
  const complete: Record<string, boolean> = {};
  for (const d of loggedSnap.docs) if (typeof d.get('complete') === 'boolean') complete[d.id] = d.get('complete');
  const merged = mergeDailyWeights(logsSnap.docs.map((d) => toDailyLog(d.id, d.data())), weights, boundary);
  const r = calculateTdee(merged, profileAfter, boundary, now, weights, complete) as { source: string; trueTdee: number; ci95Tdee?: number; travelHold?: unknown };
  say(`  maintenance now: ${r.source} ${r.trueTdee} ±${r.ci95Tdee}, hold ${JSON.stringify(r.travelHold)}`);
  const noTrip = calculateTdee(merged, toDomainProfile({ ...prof, travelPeriods: [] }), boundary, now, weights, complete) as { trueTdee: number };
  say(`  same data with no trip on file: ${noTrip.trueTdee}`);
}
const travelIds = new Set([...tplSnap.docs.map((d) => toWorkoutTemplate(d.id, d.data())), ...after].flatMap((t) => (t.id && isTravelTemplate(t) ? [t.id] : [])));
say(`  Travel C today: re-entry ${reentryFor({ templateId: C_ID, today: TODAY, sessions: completed, periods, travelTemplateIds: travelIds, boundary })} (start loads stand, no −10%)`);
for (const t of home) say(`  ${t.name} first session 2026-11-19: re-entry ${reentryFor({ templateId: t.id, today: '2026-11-19', sessions: completed, periods, travelTemplateIds: travelIds, templateCreatedAt: t.createdAt, boundary })}`);

say('\nThis week as Today computes it (core travelWeek):');
const week = travelWeek(PLAN, TODAY, completed, boundary);
for (const r of week.rows) say(`  ${r.from}${r.to !== r.from ? ` → ${r.to}` : ''} ${r.label}${r.note ? ` · ${r.note}` : ''} [${r.status}]`);
say(`  next: ${week.next?.label} ${week.next?.from}`);

say('\nSample export rows (core buildCsv)');
{
  const effortStandards = Object.fromEntries(catalogAfter.map((c) => [c.id!, c.effortStandard]));
  const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, templates: after, effortStandards, travelPeriods: periodsAfter });
  const [head, ...lines] = csv.split(/\r?\n/);
  const cols = head.split(',');
  const want = ['type', 'date', 'template', 'position', 'exercise', 'load', 'loadUnit', 'loadInUnit', 'clusters', 'effortStandard', 'rirTarget', 'supersetBlock', 'supersetOrder', 'transitionSec', 'roundRestSec', 'templateVersion'];
  const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  say(`  ${want.join(',')}`);
  for (const l of lines.filter((x) => x.startsWith('template,')).filter((x) => /DB Flat Press|Lat Pulldown|Romanian|DB Lateral Raise/.test(x))) {
    const c = cells(l);
    say(`  ${want.map((w) => c[cols.indexOf(w)] ?? '').join(',')}`);
  }
  for (const l of lines.filter((x) => x.startsWith('travel_plan,') || x.startsWith('travel,'))) {
    const c = cells(l);
    say(`  ${c[cols.indexOf('type')]},${c[cols.indexOf('date')]},${c[cols.indexOf('template')]},"${c[cols.indexOf('notes')]}"`);
  }
}

say(`\nPLAN: ${tplWrites.length} template(s) to write [${tplWrites.map((d) => d.body.name.slice(0, 8)).join(', ')}], ${stale.length} stale to delete, ${catCreates.length} catalog create(s), plan ${planWrite ? 'WRITE' : 'unchanged'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!tplWrites.length && !stale.length && !catCreates.length && !planWrite) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-02-travel-gym-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, travelPeriods: prof.travelPeriods, templates: Object.fromEntries(tplSnap.docs.map((d) => [d.id, d.data()])) }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const untouched = (await user.collection('workoutTemplates').get()).docs.filter((d) => d.id !== C_ID && d.id !== D_ID && !stale.some((s) => s.id === d.id));
const hashBefore = stable(untouched.map((d) => [d.id, conv(d.data())]));
const batch = db.batch();
for (const c of catCreates) batch.set(user.collection('exercises').doc(c.id), c.doc);
for (const d of stale) batch.delete(d.ref);
for (const d of tplWrites) batch.set(user.collection('workoutTemplates').doc(d.id), { ...d.body, createdAt: tplDoc.get(d.id)?.get('createdAt') ?? Timestamp.fromDate(now), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();

const check = (await user.collection('workoutTemplates').get()).docs.filter((d) => untouched.some((u) => u.id === d.id));
say(`Leg/Pull/Push + Travel A/B unchanged: ${stable(check.map((d) => [d.id, conv(d.data())])) === hashBefore}`);
say('written.');
process.exit(0);
