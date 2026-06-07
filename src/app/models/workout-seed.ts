// Shipped starter content for the Train tab. This is read-only catalog
// data baked into the bundle (not per-user). When a user taps "use this
// template" or "add exercise", the clone flow copies the relevant entries
// into their own editable `users/{uid}/exercises` + `workoutTemplates`
// collections (see WorkoutStore.cloneStarterTemplate). Seed entries are
// keyed by a stable slug so a starter template can reference library
// exercises before any Firestore ids exist.
//
// English-only for v1 (es-PR seed content is a later pass). User-created
// names/cues are data and never translated regardless.

import type { MuscleGroup, PlannedSet, ProgressionRule } from './workout';

export interface SeedExercise {
  /** Stable slug — referenced by SeedTemplateExercise.key. */
  key: string;
  name: string;
  muscles: MuscleGroup[];
  defaultCues: string[];
}

export interface SeedTemplateExercise {
  key: string; // references a SeedExercise.key
  targetLoad?: number;
  cues?: string[]; // overrides the library defaultCues for this template
  progression?: ProgressionRule;
  plannedSets: PlannedSet[];
}

export interface SeedTemplate {
  key: string;
  name: string;
  notes?: string;
  restMiniSec?: number;
  restClusterSec?: number;
  exercises: SeedTemplateExercise[];
}

// ─── Convenience scaffolds ──────────────────────────────────────
/** N plain working sets (the default straight-set scaffold). */
const straight = (n: number): PlannedSet[] =>
  Array.from({ length: n }, () => ({ kind: 'working' as const }));

/** One cluster = activation + `minis` mini-sets, tagged with a group. */
const cluster = (group: number, minis = 2): PlannedSet[] => [
  { kind: 'activation', group },
  ...Array.from({ length: minis }, () => ({ kind: 'mini' as const, group })),
];

// ─── Exercise library (~55 common lifts) ────────────────────────
export const EXERCISE_LIBRARY: readonly SeedExercise[] = [
  // Chest
  { key: 'barbell-bench-press', name: 'Barbell Bench Press', muscles: ['chest', 'triceps'], defaultCues: ['Retract scapula, slight arch', 'Bar to nipple line', 'Drive feet into floor'] },
  { key: 'incline-barbell-press', name: 'Incline Barbell Press', muscles: ['chest', 'shoulders'], defaultCues: ['30–45° bench', 'Targets upper chest'] },
  { key: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', muscles: ['chest', 'triceps'], defaultCues: ['Deep stretch at bottom', 'Squeeze at top'] },
  { key: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', muscles: ['chest', 'shoulders'], defaultCues: ['Clavicular head emphasis'] },
  { key: 'machine-chest-press', name: 'Machine Chest Press', muscles: ['chest', 'triceps'], defaultCues: ['Handles at mid-chest', 'Elbows ~45–60° from torso'] },
  { key: 'incline-machine-press', name: 'Incline Machine Press', muscles: ['chest', 'shoulders'], defaultCues: ['Upper-chest angle'] },
  { key: 'paramount-supine-chest-press', name: 'Paramount Supine Chest Press', muscles: ['chest', 'triceps'], defaultCues: ['Seat so handles align mid-chest (nipple line)', 'Elbows ~45–60° from torso', '3s eccentric, 1s squeeze at top, deep stretch'] },
  { key: 'paramount-incline-chest-press', name: 'Paramount Incline Chest Press', muscles: ['chest', 'shoulders'], defaultCues: ['Targets clavicular head', '3s eccentric, deep stretch'] },
  { key: 'cable-fly', name: 'Cable Fly', muscles: ['chest'], defaultCues: ['Slight elbow bend, hold it', 'Squeeze across midline'] },
  { key: 'pec-deck', name: 'Pec Deck', muscles: ['chest'], defaultCues: ['Control the stretch'] },
  { key: 'chest-dip', name: 'Chest Dip', muscles: ['chest', 'triceps'], defaultCues: ['Lean forward for chest bias'] },
  { key: 'push-up', name: 'Push-Up', muscles: ['chest', 'triceps', 'core'], defaultCues: ['Body in a straight line'] },

  // Back
  { key: 'deadlift', name: 'Deadlift', muscles: ['back', 'hamstrings', 'glutes'], defaultCues: ['Neutral spine', 'Push the floor away', 'Lock out with glutes'] },
  { key: 'barbell-row', name: 'Barbell Row', muscles: ['back', 'biceps'], defaultCues: ['Hinge ~45°', 'Pull to lower ribs'] },
  { key: 'pendlay-row', name: 'Pendlay Row', muscles: ['back'], defaultCues: ['Reset each rep on the floor', 'Explosive pull'] },
  { key: 'dumbbell-row', name: 'Dumbbell Row', muscles: ['back', 'biceps'], defaultCues: ['Brace on bench', 'Drive elbow to hip'] },
  { key: 'lat-pulldown', name: 'Lat Pulldown', muscles: ['back', 'biceps'], defaultCues: ['Bar to upper chest', 'Drive elbows down'] },
  { key: 'pull-up', name: 'Pull-Up', muscles: ['back', 'biceps'], defaultCues: ['Full hang to chin over bar'] },
  { key: 'chin-up', name: 'Chin-Up', muscles: ['back', 'biceps'], defaultCues: ['Supinated grip, biceps assist'] },
  { key: 'seated-cable-row', name: 'Seated Cable Row', muscles: ['back', 'biceps'], defaultCues: ['Tall chest, pull to navel'] },
  { key: 't-bar-row', name: 'T-Bar Row', muscles: ['back'], defaultCues: ['Chest supported if available'] },
  { key: 'straight-arm-pulldown', name: 'Straight-Arm Pulldown', muscles: ['back'], defaultCues: ['Lats only, fixed elbows'] },
  { key: 'face-pull', name: 'Face Pull', muscles: ['shoulders', 'back'], defaultCues: ['Pull to forehead, external rotate'] },

  // Shoulders
  { key: 'overhead-press', name: 'Overhead Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Brace core', 'Bar over mid-foot at lockout'] },
  { key: 'seated-db-shoulder-press', name: 'Seated DB Shoulder Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Press in a slight arc', 'Stop at ear-level on the way down'] },
  { key: 'machine-shoulder-press', name: 'Machine Shoulder Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Handles at shoulder height'] },
  { key: 'arnold-press', name: 'Arnold Press', muscles: ['shoulders'], defaultCues: ['Rotate palms through the press'] },
  { key: 'db-lateral-raise', name: 'DB Lateral Raise', muscles: ['shoulders'], defaultCues: ['Lead with elbows', 'Lighter load for 12–15 reps'] },
  { key: 'cable-lateral-raise', name: 'Cable Lateral Raise', muscles: ['shoulders'], defaultCues: ['Constant tension'] },
  { key: 'rear-delt-fly', name: 'Rear Delt Fly', muscles: ['shoulders'], defaultCues: ['Slight forward lean', 'Squeeze rear delts'] },
  { key: 'upright-row', name: 'Upright Row', muscles: ['shoulders'], defaultCues: ['Lead with elbows, stop at chest'] },

  // Biceps
  { key: 'barbell-curl', name: 'Barbell Curl', muscles: ['biceps'], defaultCues: ['Elbows pinned, no swing'] },
  { key: 'dumbbell-curl', name: 'Dumbbell Curl', muscles: ['biceps'], defaultCues: ['Supinate at the top'] },
  { key: 'hammer-curl', name: 'Hammer Curl', muscles: ['biceps', 'forearms'], defaultCues: ['Neutral grip, brachialis bias'] },
  { key: 'preacher-curl', name: 'Preacher Curl', muscles: ['biceps'], defaultCues: ['No bounce off the bottom'] },
  { key: 'cable-curl', name: 'Cable Curl', muscles: ['biceps'], defaultCues: ['Constant tension throughout'] },
  { key: 'incline-db-curl', name: 'Incline DB Curl', muscles: ['biceps'], defaultCues: ['Deep stretch on an incline bench'] },

  // Triceps
  { key: 'close-grip-bench', name: 'Close-Grip Bench', muscles: ['triceps', 'chest'], defaultCues: ['Shoulder-width grip', 'Elbows tucked'] },
  { key: 'machine-close-grip-press', name: 'Smith/Machine Close-Grip Press', muscles: ['triceps', 'chest'], defaultCues: ['Elbows tucked, triceps drive'] },
  { key: 'triceps-pushdown', name: 'Triceps Pushdown', muscles: ['triceps'], defaultCues: ['Elbows pinned, full lockout'] },
  { key: 'rope-pushdown', name: 'Rope Pushdown', muscles: ['triceps'], defaultCues: ['Spread the rope at the bottom'] },
  { key: 'overhead-db-extension', name: 'Overhead DB Extension', muscles: ['triceps'], defaultCues: ['Deep stretch behind head', 'Drop set OK'] },
  { key: 'skullcrusher', name: 'Skullcrusher', muscles: ['triceps'], defaultCues: ['Lower to forehead, elbows steady'] },
  { key: 'triceps-dip', name: 'Triceps Dip', muscles: ['triceps'], defaultCues: ['Stay upright for triceps bias'] },

  // Quads / legs
  { key: 'back-squat', name: 'Back Squat', muscles: ['quads', 'glutes'], defaultCues: ['Brace, break at hips and knees', 'Hit depth, drive through mid-foot'] },
  { key: 'front-squat', name: 'Front Squat', muscles: ['quads'], defaultCues: ['Elbows high, upright torso'] },
  { key: 'leg-press', name: 'Leg Press', muscles: ['quads', 'glutes'], defaultCues: ['Feet shoulder-width', 'Don’t lock knees hard'] },
  { key: 'hack-squat', name: 'Hack Squat', muscles: ['quads'], defaultCues: ['Deep, controlled descent'] },
  { key: 'leg-extension', name: 'Leg Extension', muscles: ['quads'], defaultCues: ['Squeeze at the top'] },
  { key: 'walking-lunge', name: 'Walking Lunge', muscles: ['quads', 'glutes'], defaultCues: ['Long stride, knee tracks toes'] },
  { key: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', muscles: ['quads', 'glutes'], defaultCues: ['Rear foot elevated, stay tall'] },
  { key: 'goblet-squat', name: 'Goblet Squat', muscles: ['quads', 'glutes'], defaultCues: ['Elbows inside knees at the bottom'] },

  // Hamstrings / glutes
  { key: 'romanian-deadlift', name: 'Romanian Deadlift', muscles: ['hamstrings', 'glutes'], defaultCues: ['Soft knees, push hips back', 'Feel the hamstring stretch'] },
  { key: 'lying-leg-curl', name: 'Lying Leg Curl', muscles: ['hamstrings'], defaultCues: ['No hip rise, full curl'] },
  { key: 'seated-leg-curl', name: 'Seated Leg Curl', muscles: ['hamstrings'], defaultCues: ['Control the eccentric'] },
  { key: 'hip-thrust', name: 'Hip Thrust', muscles: ['glutes', 'hamstrings'], defaultCues: ['Chin tucked, full hip lockout'] },
  { key: 'good-morning', name: 'Good Morning', muscles: ['hamstrings', 'back'], defaultCues: ['Light load, hinge with neutral spine'] },

  // Calves
  { key: 'standing-calf-raise', name: 'Standing Calf Raise', muscles: ['calves'], defaultCues: ['Full stretch, pause at top'] },
  { key: 'seated-calf-raise', name: 'Seated Calf Raise', muscles: ['calves'], defaultCues: ['Soleus bias, slow tempo'] },

  // Core
  { key: 'plank', name: 'Plank', muscles: ['core'], defaultCues: ['Glutes tight, neutral spine'] },
  { key: 'hanging-leg-raise', name: 'Hanging Leg Raise', muscles: ['core'], defaultCues: ['No swing, curl pelvis up'] },
  { key: 'cable-crunch', name: 'Cable Crunch', muscles: ['core'], defaultCues: ['Crunch with abs, not hips'] },
  { key: 'ab-wheel', name: 'Ab Wheel', muscles: ['core'], defaultCues: ['Brace, don’t let hips sag'] },
] as const;

/** Lookup a seed exercise by key. */
export function findSeedExercise(key: string): SeedExercise | undefined {
  return EXERCISE_LIBRARY.find((e) => e.key === key);
}

// ─── Starter templates ──────────────────────────────────────────
const DOUBLE_PROG: ProgressionRule = { targetReps: 12, holdSessions: 2, incrementLb: 5 };

export const STARTER_TEMPLATES: readonly SeedTemplate[] = [
  // The user's own cluster split, shipped as a starter.
  {
    key: 'chest-tri-sh-cluster',
    name: 'Chest / Triceps / Shoulders (Cluster)',
    notes:
      '60-min cap. Cluster format: activation / mini / mini.\nActivation: 9–12 reps @ RIR 1–2. Mini-sets: 3–5 reps @ RIR 0–1.\nRest 15–20s between mini-sets, 2–3 min between clusters.\nPROGRESSION: activation hits 12 reps × 2 sessions → +2.5–5 lb.',
    restMiniSec: 20,
    restClusterSec: 150,
    exercises: [
      {
        key: 'paramount-supine-chest-press',
        cues: ['Seat so handles align mid-chest (nipple line)', 'Elbows ~45–60° from torso', '3s eccentric, 1s squeeze at top, deep stretch', 'This REPLACES vertical Smith bench'],
        progression: DOUBLE_PROG,
        plannedSets: [...cluster(1), ...cluster(2)],
      },
      {
        key: 'paramount-incline-chest-press',
        cues: ['Same cues, targets clavicular head'],
        progression: DOUBLE_PROG,
        plannedSets: [...cluster(1)],
      },
      {
        key: 'seated-db-shoulder-press',
        targetLoad: 50,
        progression: DOUBLE_PROG,
        plannedSets: [...cluster(1), ...cluster(2)],
      },
      {
        key: 'db-lateral-raise',
        targetLoad: 8,
        cues: ['Lighter load to hit 12–15 reps (dropped from 10 lb)'],
        progression: { targetReps: 15, holdSessions: 2, incrementLb: 2.5 },
        plannedSets: [...cluster(1)],
      },
      {
        key: 'machine-close-grip-press',
        targetLoad: 15,
        cues: ['1 CLUSTER ONLY — do NOT add a 2nd cluster'],
        progression: DOUBLE_PROG,
        plannedSets: [...cluster(1)],
      },
      {
        key: 'overhead-db-extension',
        targetLoad: 32.5,
        cues: ['Drop set OK'],
        plannedSets: [...cluster(1)],
      },
    ],
  },

  // Classic Push / Pull / Legs trio (straight sets).
  {
    key: 'push-day',
    name: 'Push Day',
    notes: 'Chest, shoulders, triceps. 3 working sets each, ~8–12 reps @ RIR 1–2.',
    restMiniSec: 90,
    restClusterSec: 120,
    exercises: [
      { key: 'barbell-bench-press', progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 }, plannedSets: straight(3) },
      { key: 'incline-dumbbell-press', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'seated-db-shoulder-press', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'db-lateral-raise', progression: { targetReps: 15, holdSessions: 2, incrementLb: 2.5 }, plannedSets: straight(3) },
      { key: 'rope-pushdown', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'overhead-db-extension', progression: DOUBLE_PROG, plannedSets: straight(2) },
    ],
  },
  {
    key: 'pull-day',
    name: 'Pull Day',
    notes: 'Back and biceps. 3 working sets each, ~8–12 reps @ RIR 1–2.',
    restMiniSec: 90,
    restClusterSec: 120,
    exercises: [
      { key: 'barbell-row', progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 }, plannedSets: straight(3) },
      { key: 'lat-pulldown', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'seated-cable-row', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'face-pull', progression: { targetReps: 15, holdSessions: 2, incrementLb: 2.5 }, plannedSets: straight(3) },
      { key: 'dumbbell-curl', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'hammer-curl', progression: DOUBLE_PROG, plannedSets: straight(2) },
    ],
  },
  {
    key: 'leg-day',
    name: 'Leg Day',
    notes: 'Quads, hamstrings, glutes, calves. 3 working sets each, ~8–12 reps @ RIR 1–2.',
    restMiniSec: 120,
    restClusterSec: 180,
    exercises: [
      { key: 'back-squat', progression: { targetReps: 8, holdSessions: 2, incrementLb: 10 }, plannedSets: straight(3) },
      { key: 'romanian-deadlift', progression: { targetReps: 8, holdSessions: 2, incrementLb: 10 }, plannedSets: straight(3) },
      { key: 'leg-press', progression: { targetReps: 12, holdSessions: 2, incrementLb: 10 }, plannedSets: straight(3) },
      { key: 'lying-leg-curl', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'leg-extension', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'standing-calf-raise', progression: { targetReps: 15, holdSessions: 2, incrementLb: 5 }, plannedSets: straight(4) },
    ],
  },
] as const;
