/**
 * Stephanie's "Stephanie Split v1" (owner, 2026-11-26): three straight-set
 * templates run as a rotation Legs → Pull → Push on any three days, her four
 * S-v2 templates archived. Only stph.ctllo@gmail.com is opened; her targets,
 * meals, weights and sessions are read only. The owner's account is not opened.
 *
 * What the read found (2026-11-26, a full read of her templates, catalog,
 * sessions and profile):
 *
 *   Templates   S-v2 Day 1, Day 2, Day 2B (Haven), Day 3 active → archived
 *               (sessions keep their templateId). Day 1-3 (pre-S-v2) already
 *               archived. No template is named Legs / Pull / Push.
 *   Program     the app has no program record: the rotation is the unarchived
 *               templates (core `rotationTemplates`), and "next up" is the one
 *               gone longest unperformed, never-performed first, ties broken by
 *               list order = `updatedAt` desc (`subscribeTemplates`). So the
 *               three are stamped Legs newest, Pull, Push oldest: the first
 *               cycle runs Legs → Pull → Push, then the oldest comes round —
 *               the same order, on any day. Checked with `nextTemplateUp` below.
 *               The name rides as `tags: ["Stephanie Split v1"]`;
 *               `templateVersion` is "Split v1" (rules cap it at 16 characters).
 *               No home-plan card: it shows only with fixed weekdays or dated notes.
 *   Catalog     the library is per account; hers holds most of these lifts
 *               under her own names, so the same movement reuses her id (and
 *               history) and keeps her name: Dumbbell Romanian Deadlifts, Leg
 *               Curl, Leg Extension, Wide-Grip Lat Pulldown, Chest-Supported DB
 *               Row, Incline DB Press, Dumbbell Lateral Raises, Plank, DB Reverse
 *               Lunge, Seated Dumbbell Overhead Press (= DB shoulder press),
 *               Single-Dumbbell Tricep Extension (seated overhead, = overhead DB
 *               triceps extension), Smith Hip Thrust (pad) with Dumbbell Hip
 *               Thrust as its one-tap swap (Smith or dumbbell; two histories).
 *               New: Smith Squat, Seated Machine Row (her Seated Cable Row stays
 *               its own lift), Rear Delt DB Flye, Incline DB Curl 45°, DB Hammer
 *               Curl, Seated Chest Press Machine, Hanging Knee Raise, and
 *               Bulgarian Split Squat (the lunge row's swap).
 *   Effort      RIR 1–2 → `effortStandard: 'rir1'` on every loaded lift (core
 *               `bindingStraight`: the top of the range at RIR 1 or 2 holds, so
 *               the engine adds load exactly when the template note says). Her
 *               reused lifts were `rir2`; only her catalog changes, no session.
 *   Sets        straight `working` sets, `setStructure: 'straight'`, rep range
 *               in `reps`/`repsMax`, no supersets. The lunge is L/R labelled
 *               (counts per pair, `hardSetCount`). Plank: `time`, 30 s planned.
 *               Knee raise: bodyweight, no rep target.
 *   Loads       blank (no `targetLoad`, no set weight); `loadUnit: 'lb'` on every
 *               loaded row (her profile is metric). Progression: top of the range
 *               on every set → +5 lb dumbbells, +10 machines / Smith.
 *   Baseline    every row `baseline { since 2026-11-26 }`: the first session of
 *               each template sets the starting point. Sessions have no tag
 *               field, so nothing is written on a session.
 *   Volume      the app stores no per-muscle targets; its weekly sheet compares
 *               against the plan. Her targets are checked against core
 *               `plannedHardSets` below (direct = sets where the muscle is the
 *               lift's first tag). The sheet opens on Sets (no clusters).
 *
 * No targets, meals, weights, steps or sessions written (ADR-0024).
 * Dry run unless `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/user-data-2026-11-26-stephanie-split-v1.mts [--apply]
 */
import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import type { Exercise, MuscleGroup, PlannedSet, TemplateExercise, WorkoutSession, WorkoutTemplate } from '../packages/core/src/workout.ts';
import {
  defaultVolumeView,
  MIDNIGHT,
  nextTemplateUp,
  plannedHardSets,
  reentryFor,
  rotationTemplates,
  toExerciseDoc,
  toTemplateDoc,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelPeriodsOf,
} from '../packages/core/src/index.ts';
import { CODEC, open } from './lib/user-data.mts';

const STPH = 'stph.ctllo@gmail.com';
const DAY = '2026-11-26';
const PROGRAM = 'Stephanie Split v1';
const VERSION = 'Split v1';
const s = await open('user-data-2026-11-26-stephanie-split-v1');
const user = await s.user(STPH);
const now = new Date();
const stamp = now.toISOString();

const [profile, exSnap, sesSnap, tplSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutSessions').get(), user.collection('workoutTemplates').get(),
]);
const json = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ── catalog ──
type New = { id: string; name: string; muscles: MuscleGroup[]; logStyle: 'weight-reps' | 'bodyweight'; seedName?: string };
const NEW: New[] = [
  { id: 'stph-smith-squat', name: 'Smith Squat', muscles: ['quads', 'glutes'], logStyle: 'weight-reps' },
  { id: 'stph-bulgarian-split-squat', name: 'Bulgarian Split Squat', muscles: ['quads', 'glutes'], logStyle: 'weight-reps' },
  { id: 'stph-hanging-knee-raise', name: 'Hanging Knee Raise', muscles: ['core'], logStyle: 'bodyweight' },
  { id: 'stph-seated-machine-row', name: 'Seated Machine Row', muscles: ['back', 'biceps'], logStyle: 'weight-reps' },
  { id: 'stph-rear-delt-db-flye', name: 'Rear Delt DB Flye', muscles: ['shoulders'], logStyle: 'weight-reps' },
  { id: 'stph-incline-db-curl-45', name: 'Incline DB Curl 45°', muscles: ['biceps'], logStyle: 'weight-reps' },
  { id: 'stph-db-hammer-curl', name: 'DB Hammer Curl', muscles: ['biceps', 'forearms'], logStyle: 'weight-reps' },
  { id: 'stph-seated-chest-press-machine', name: 'Seated Chest Press Machine', muscles: ['chest', 'triceps', 'shoulders'], logStyle: 'weight-reps' },
];
const REUSE: Record<string, string> = {
  'stph-smith-hip-thrust': 'Smith Hip Thrust (pad)', 'stph-db-hip-thrust': 'Dumbbell Hip Thrust', 'stph-db-rdl': 'Dumbbell Romanian Deadlifts',
  'stph-db-reverse-lunge': 'DB Reverse Lunge', 'stph-leg-curl': 'Leg Curl', 'stph-leg-extension': 'Leg Extension', 'stph-plank': 'Plank',
  'stph-wide-lat-pulldown': 'Wide-Grip Lat Pulldown', 'stph-supported-db-row': 'Chest-Supported DB Row', 'stph-incline-db-press': 'Incline DB Press',
  'stph-seated-db-ohp': 'Seated Dumbbell Overhead Press', 'stph-db-lateral-raise': 'Dumbbell Lateral Raises', 'stph-single-db-tricep-ext': 'Single-Dumbbell Tricep Extension',
};
const exDoc = (id: string) => exSnap.docs.find((d) => d.id === id);
for (const [id, name] of Object.entries(REUSE)) {
  const d = exDoc(id);
  if (!d || d.get('name') !== name) s.problem(`her catalog ${id} is ${d ? `"${d.get('name')}"` : 'absent'}, not "${name}"`);
}
const created: Exercise[] = [];
for (const n of NEW) {
  const d = exDoc(n.id);
  if (d) { if (d.get('name') !== n.name) s.problem(`exercises/${n.id} exists as "${d.get('name')}"`); continue; }
  const clash = exSnap.docs.find((x) => String(x.get('name')).toLowerCase() === n.name.toLowerCase());
  if (clash) { s.problem(`her catalog already has "${clash.get('name')}" (${clash.id})`); continue; }
  const doc = toExerciseDoc({
    name: n.name, muscles: n.muscles, logStyle: n.logStyle,
    ...(n.logStyle === 'weight-reps' ? { effortStandard: 'rir1' as const } : {}),
  }, CODEC, now);
  s.set(user.collection('exercises').doc(n.id), doc as DocumentData, `CATALOG + "${n.name}" (${n.id}) · ${n.muscles.join(', ')}${n.logStyle === 'weight-reps' ? ' · RIR 1' : ' · bodyweight'}`);
  created.push(toWorkoutExercise(n.id, json(doc) as unknown as Record<string, unknown>));
}

// ── the templates ──
type Kind = 'db' | 'machine' | 'smith' | 'bw' | 'time';
type Spec = { id: string; sets: number; min?: number; max?: number; kind: Kind; sided?: boolean; rest?: number; cues?: string[]; alt?: { id: string; note: string }; durationSec?: number };
const INC: Partial<Record<Kind, number>> = { db: 5, machine: 10, smith: 10 };
const RIR_CUE = 'RIR 1–2: stop each set 1–2 reps before failure.';
const FIRST_CUE = 'First session: no load set — enter the weight you use; the app carries it forward.';
const TEMPLATES: { id: string; name: string; expectedMin: number; rows: Spec[] }[] = [
  {
    id: 'stph-split-v1-legs', name: 'Legs, Glutes & Core', expectedMin: 55, rows: [
      { id: 'stph-smith-hip-thrust', sets: 3, min: 8, max: 12, kind: 'smith', rest: 120, cues: ['Smith or dumbbell: swap the row to Dumbbell Hip Thrust on a dumbbell day (its own history).', 'Smith: log the plates total (per side × 2).'], alt: { id: 'stph-db-hip-thrust', note: 'dumbbell instead of the Smith' } },
      { id: 'stph-smith-squat', sets: 3, min: 8, max: 12, kind: 'smith', rest: 120, cues: ['Deep: hips below the knees.', 'Log the plates total (per side × 2).'] },
      { id: 'stph-db-rdl', sets: 3, min: 8, max: 12, kind: 'db', rest: 120, cues: ['Hips back, neutral back, stop at mid-shin. Load is per hand.'] },
      { id: 'stph-db-reverse-lunge', sets: 2, min: 10, max: 12, kind: 'db', sided: true, cues: ['2 sets per leg; log L and R separately. Load is per hand.'], alt: { id: 'stph-bulgarian-split-squat', note: 'alternative' } },
      { id: 'stph-leg-curl', sets: 2, min: 10, max: 15, kind: 'machine', cues: ['Seated leg curl.'] },
      { id: 'stph-leg-extension', sets: 2, min: 10, max: 15, kind: 'machine' },
      { id: 'stph-hanging-knee-raise', sets: 2, kind: 'bw', cues: ['Reps to RIR 1–2: stop 1–2 reps before failure. Log the reps.'] },
      { id: 'stph-plank', sets: 2, kind: 'time', durationSec: 30, cues: ['30–45 s. Log the time.'] },
    ],
  },
  {
    id: 'stph-split-v1-pull', name: 'Pull', expectedMin: 40, rows: [
      { id: 'stph-wide-lat-pulldown', sets: 3, min: 8, max: 12, kind: 'machine' },
      { id: 'stph-seated-machine-row', sets: 3, min: 8, max: 12, kind: 'machine' },
      { id: 'stph-supported-db-row', sets: 2, min: 10, max: 12, kind: 'db', cues: ['Load is per hand.'] },
      { id: 'stph-rear-delt-db-flye', sets: 2, min: 12, max: 15, kind: 'db', cues: ['Load is per hand.'] },
      { id: 'stph-incline-db-curl-45', sets: 2, min: 10, max: 12, kind: 'db', cues: ['Bench at 45°. Load is per hand.'] },
      { id: 'stph-db-hammer-curl', sets: 2, min: 10, max: 12, kind: 'db', cues: ['Load is per hand.'] },
    ],
  },
  {
    id: 'stph-split-v1-push', name: 'Push', expectedMin: 40, rows: [
      { id: 'stph-seated-chest-press-machine', sets: 3, min: 8, max: 12, kind: 'machine' },
      { id: 'stph-incline-db-press', sets: 2, min: 8, max: 12, kind: 'db', cues: ['Load is per hand.'] },
      { id: 'stph-seated-db-ohp', sets: 2, min: 8, max: 12, kind: 'db', cues: ['DB shoulder press, seated. Load is per hand.'] },
      { id: 'stph-db-lateral-raise', sets: 3, min: 12, max: 15, kind: 'db', cues: ['Load is per hand.'] },
      { id: 'stph-single-db-tricep-ext', sets: 3, min: 10, max: 12, kind: 'db', cues: ['Overhead, one dumbbell.'] },
    ],
  },
];
const NOTE = 'Add weight when you reach the top of the rep range on every set. Stop each set 1–2 reps before failure.';
const nameOf = (id: string) => NEW.find((n) => n.id === id)?.name ?? REUSE[id] ?? id;
const setsFor = (r: Spec): PlannedSet[] => {
  const one = (label?: string): PlannedSet => (r.kind === 'time'
    ? { kind: 'working', durationSec: r.durationSec }
    : { kind: 'working', ...(r.min != null ? { reps: r.min, repsMax: r.max } : {}), ...(label ? { label } : {}) }) as PlannedSet;
  return Array.from({ length: r.sets }, () => (r.sided ? [one('L'), one('R')] : [one()])).flat();
};
const rowFor = (r: Spec): TemplateExercise => {
  const loaded = r.kind !== 'bw' && r.kind !== 'time';
  return {
    exerciseId: r.id, name: nameOf(r.id),
    logStyle: r.kind === 'time' ? 'time' : r.kind === 'bw' ? 'bodyweight' : 'weight-reps',
    setStructure: 'straight',
    plannedSets: setsFor(r),
    ...(loaded ? { loadUnit: 'lb' as const, progression: { targetReps: r.max!, holdSessions: 1, incrementLb: INC[r.kind]! } } : {}),
    cues: [...(loaded ? [RIR_CUE] : []), ...(r.cues ?? []), ...(loaded ? [FIRST_CUE] : [])],
    ...(r.rest ? { restMiniSec: r.rest, restAfterSec: r.rest } : {}),
    ...(r.alt ? { alternatives: [{ exerciseId: r.alt.id, name: nameOf(r.alt.id), note: r.alt.note }] } : {}),
    baseline: { since: DAY, reason: `${PROGRAM}: the first session sets the starting weights` },
    lastModifiedAt: stamp, lastModifiedBy: 'prompt',
  };
};
// Legs newest, Push oldest: the app lists by updatedAt desc and "next up"
// breaks a never-performed tie by that order.
const planned: WorkoutTemplate[] = [];
TEMPLATES.forEach((t, i) => {
  const at = new Date(now.getTime() - i * 1000);
  const doc = {
    ...toTemplateDoc({ name: t.name, notes: NOTE, restMiniSec: 90, restClusterSec: 90, exercises: t.rows.map(rowFor) }, CODEC, at),
    templateVersion: VERSION, tags: [PROGRAM], expectedMin: t.expectedMin,
  };
  const have = tplSnap.docs.find((d) => d.id === t.id);
  const sameName = tplSnap.docs.filter((d) => d.id !== t.id && d.get('name') === t.name);
  if (sameName.length) s.problem(`a template named "${t.name}" already exists: ${sameName.map((d) => d.id).join(', ')}`);
  else if (have) {
    if (have.get('templateVersion') !== VERSION) s.problem(`${t.id} exists and is not ${VERSION}`);
    planned.push(toWorkoutTemplate(t.id, have.data()));
  } else {
    s.set(user.collection('workoutTemplates').doc(t.id), json(doc) as DocumentData,
      `TEMPLATE + "${t.name}" (${t.id}) ~${t.expectedMin} min · ${t.rows.map((r) => `${nameOf(r.id)} ${r.sets}${r.sided ? '/leg' : ''}×${r.kind === 'time' ? '30–45 s' : r.min != null ? `${r.min}–${r.max}` : 'RIR 1–2'}`).join(' · ')}`);
    planned.push(toWorkoutTemplate(t.id, { ...json(doc), createdAt: Timestamp.fromDate(at), updatedAt: Timestamp.fromDate(at) }));
  }
});

// effort standard on her reused loaded lifts
const loadedIds = new Set(TEMPLATES.flatMap((t) => t.rows.filter((r) => r.kind !== 'bw' && r.kind !== 'time').flatMap((r) => [r.id, ...(r.alt ? [r.alt.id] : [])])));
for (const id of Object.keys(REUSE)) {
  const d = exDoc(id);
  if (!d || !loadedIds.has(id) || d.get('effortStandard') === 'rir1') continue;
  s.update(d, { effortStandard: 'rir1' }, `catalog "${d.get('name')}": effortStandard ${d.get('effortStandard') ?? '(failure)'} → rir1`);
}

// ── archive the S-v2 templates ──
const ARCHIVE = ['stph-sv2-day-1', 'stph-sv2-day-2', 'stph-sv2-day-2b', 'stph-sv2-day-3'];
for (const id of ARCHIVE) {
  const d = tplSnap.docs.find((x) => x.id === id);
  if (!d) { s.problem(`${id} is gone`); continue; }
  if (d.get('archivedAt') != null) continue;
  const n = sesSnap.docs.filter((x) => x.get('templateId') === id).length;
  s.update(d, { archivedAt: Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now) }, `ARCHIVE "${d.get('name')}" · ${n} session(s) kept`);
}
const stillActive = tplSnap.docs.filter((d) => d.get('archivedAt') == null && !ARCHIVE.includes(d.id) && !TEMPLATES.some((t) => t.id === d.id));
if (stillActive.length) s.problem(`other active templates: ${stillActive.map((d) => d.get('name')).join(', ')}`);

// ── guards: what the app will do ──
const sessions: WorkoutSession[] = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data()));
const catalog: Exercise[] = [...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())), ...created];
const listOrder = [...planned].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
const periods = travelPeriodsOf(profile.data() ?? {});
const trip = { today: DAY, periods, boundary: MIDNIGHT };
const seq: string[] = [];
let sim = [...sessions];
for (let i = 0; i < 7; i++) {
  const next = nextTemplateUp(listOrder, sim, now.getTime() + i * 86_400_000, trip)?.template;
  if (!next) { s.problem('no next-up template'); break; }
  seq.push(next.name);
  sim = [...sim, { status: 'completed', templateId: next.id, templateName: next.name, date: new Date(now.getTime() + i * 86_400_000), exercises: [] } as WorkoutSession];
}
const want = ['Legs, Glutes & Core', 'Pull', 'Push', 'Legs, Glutes & Core', 'Pull', 'Push', 'Legs, Glutes & Core'];
if (seq.join('|') !== want.join('|')) s.problem(`next-up runs ${seq.join(' → ')}`);
else s.note(`(read only) next up, any day: ${seq.join(' → ')}`);
for (const t of planned) {
  const k = reentryFor({ templateId: t.id, today: DAY, sessions, periods, boundary: MIDNIGHT, templateCreatedAt: t.createdAt });
  if (k) s.problem(`${t.name} would open as a ${k} re-entry`);
}
const rot = rotationTemplates(listOrder, new Set(), sessions, now.getTime());
if (rot.map((t) => t.id).sort().join() !== planned.map((t) => t.id).sort().join()) s.problem(`the volume sheet's rotation would be ${rot.map((t) => t.name).join(', ')}`);
const vol = plannedHardSets(planned, catalog);
const TARGET: Record<string, number> = { glutes: 11, quads: 7, hamstrings: 5, back: 8, rearDelt: 2, biceps: 4, chest: 5, sideDelt: 3, frontDelt: 2, triceps: 3, abs: 4 };
const off: string[] = [];
const rowsV = Object.entries(TARGET).map(([m, n]) => {
  const v = vol.find((x) => x.muscle === m);
  if ((v?.direct ?? 0) !== n) off.push(m);
  return `${m} ${v?.direct ?? 0}/${n}${v && v.fractional !== v.direct ? ` (weighted ${v.fractional})` : ''}`;
});
s.note(`(read only) planned weekly sets, direct/her target: ${rowsV.join(' · ')}`);
if (off.some((m) => m !== 'glutes')) s.problem(`planned direct sets miss her target on: ${off.join(', ')}`);
const view = defaultVolumeView({ clusters: 0, sets: 0, plannedClusters: 0, plannedSets: vol.reduce((n, v) => n + v.direct, 0) });
if (view !== 'sets') s.problem(`the volume sheet would open on ${view}`);
s.note('left alone: targets, meals, weigh-ins, every session, travel periods, unitAsk, steps; the owner account is not opened');

await s.run({
  report: async () => {
    const all = (await user.collection('workoutTemplates').get()).docs;
    console.log(`\nactive templates: ${all.filter((d) => d.get('archivedAt') == null).map((d) => `${d.get('name')} [${d.get('templateVersion')}]`).join(' · ')}`);
    console.log(`archived: ${all.filter((d) => d.get('archivedAt') != null).length}`);
  },
});
