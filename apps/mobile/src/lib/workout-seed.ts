// Shipped starter content for the Train tab (mobile). Read-only catalog data
// baked into the bundle; cloning copies the relevant entries into the user's
// own users/{uid}/exercises + workoutTemplates (see useTrain.cloneStarter).
// Mirrors src/app/models/workout-seed.ts. English-only for v1 (matches the
// PWA); user-created names/cues are data and never translated.

import type { MuscleGroup, PlannedSet, ProgressionRule } from './workout';

export interface SeedExercise {
  key: string;
  name: string;
  muscles: MuscleGroup[];
  defaultCues: string[];
}

export interface SeedTemplateExercise {
  key: string;
  targetLoad?: number;
  cues?: string[];
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

const straight = (n: number): PlannedSet[] =>
  Array.from({ length: n }, () => ({ kind: 'working' as const }));

// ─── Exercise library (~55 common lifts) ────────────────────────
export const EXERCISE_LIBRARY: readonly SeedExercise[] = [
  // Chest
  { key: 'barbell-bench-press', name: 'Barbell Bench Press', muscles: ['chest', 'triceps'], defaultCues: ['Retract scapula, slight arch', 'Bar to nipple line', 'Drive feet into floor'] },
  { key: 'incline-barbell-press', name: 'Incline Barbell Press', muscles: ['chest', 'shoulders'], defaultCues: ['30–45° bench', 'Targets upper chest'] },
  { key: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', muscles: ['chest', 'triceps'], defaultCues: ['Deep stretch at bottom', 'Squeeze at top'] },
  { key: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', muscles: ['chest', 'shoulders'], defaultCues: ['Clavicular head emphasis'] },
  { key: 'machine-chest-press', name: 'Machine Chest Press', muscles: ['chest', 'triceps'], defaultCues: ['Handles at mid-chest', 'Elbows ~45–60° from torso'] },
  { key: 'incline-machine-press', name: 'Incline Machine Press', muscles: ['chest', 'shoulders'], defaultCues: ['Upper-chest angle'] },
  { key: 'cable-fly', name: 'Cable Fly', muscles: ['chest'], defaultCues: ['Slight elbow bend, hold it', 'Squeeze across midline'] },
  { key: 'pec-deck', name: 'Pec Deck', muscles: ['chest'], defaultCues: ['Control the stretch'] },
  { key: 'chest-dip', name: 'Chest Dip', muscles: ['chest', 'triceps'], defaultCues: ['Lean forward for chest bias'] },

  // Back
  { key: 'deadlift', name: 'Deadlift', muscles: ['back', 'hamstrings', 'glutes'], defaultCues: ['Neutral spine', 'Push the floor away', 'Lock out with glutes'] },
  { key: 'barbell-row', name: 'Barbell Row', muscles: ['back', 'biceps'], defaultCues: ['Hinge ~45°', 'Pull to lower ribs'] },
  { key: 'dumbbell-row', name: 'Dumbbell Row', muscles: ['back', 'biceps'], defaultCues: ['Brace on bench', 'Drive elbow to hip'] },
  { key: 'lat-pulldown', name: 'Lat Pulldown', muscles: ['back', 'biceps'], defaultCues: ['Bar to upper chest', 'Drive elbows down'] },
  { key: 'pull-up', name: 'Pull-Up', muscles: ['back', 'biceps'], defaultCues: ['Full hang to chin over bar'] },
  { key: 'seated-cable-row', name: 'Seated Cable Row', muscles: ['back', 'biceps'], defaultCues: ['Tall chest, pull to navel'] },
  { key: 't-bar-row', name: 'T-Bar Row', muscles: ['back'], defaultCues: ['Chest supported if available'] },
  { key: 'face-pull', name: 'Face Pull', muscles: ['shoulders', 'back'], defaultCues: ['Pull to forehead, external rotate'] },

  // Shoulders
  { key: 'overhead-press', name: 'Overhead Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Brace core', 'Bar over mid-foot at lockout'] },
  { key: 'seated-db-shoulder-press', name: 'Seated DB Shoulder Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Press in a slight arc', 'Stop at ear-level on the way down'] },
  { key: 'machine-shoulder-press', name: 'Machine Shoulder Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Handles at shoulder height'] },
  { key: 'arnold-press', name: 'Arnold Press', muscles: ['shoulders'], defaultCues: ['Rotate palms through the press'] },
  { key: 'db-lateral-raise', name: 'DB Lateral Raise', muscles: ['shoulders'], defaultCues: ['Lead with elbows', 'Lighter load for 12–15 reps'] },
  { key: 'rear-delt-fly', name: 'Rear Delt Fly', muscles: ['shoulders'], defaultCues: ['Slight forward lean', 'Squeeze rear delts'] },

  // Biceps
  { key: 'barbell-curl', name: 'Barbell Curl', muscles: ['biceps'], defaultCues: ['Elbows pinned, no swing'] },
  { key: 'dumbbell-curl', name: 'Dumbbell Curl', muscles: ['biceps'], defaultCues: ['Supinate at the top'] },
  { key: 'hammer-curl', name: 'Hammer Curl', muscles: ['biceps', 'forearms'], defaultCues: ['Neutral grip, brachialis bias'] },
  { key: 'preacher-curl', name: 'Preacher Curl', muscles: ['biceps'], defaultCues: ['No bounce off the bottom'] },
  { key: 'cable-curl', name: 'Cable Curl', muscles: ['biceps'], defaultCues: ['Constant tension throughout'] },

  // Triceps
  { key: 'close-grip-bench', name: 'Close-Grip Bench', muscles: ['triceps', 'chest'], defaultCues: ['Shoulder-width grip', 'Elbows tucked'] },
  { key: 'triceps-pushdown', name: 'Triceps Pushdown', muscles: ['triceps'], defaultCues: ['Elbows pinned, full lockout'] },
  { key: 'rope-pushdown', name: 'Rope Pushdown', muscles: ['triceps'], defaultCues: ['Spread the rope at the bottom'] },
  { key: 'overhead-db-extension', name: 'Overhead DB Extension', muscles: ['triceps'], defaultCues: ['Deep stretch behind head', 'Drop set OK'] },
  { key: 'skullcrusher', name: 'Skullcrusher', muscles: ['triceps'], defaultCues: ['Lower to forehead, elbows steady'] },

  // Quads / legs
  { key: 'back-squat', name: 'Back Squat', muscles: ['quads', 'glutes'], defaultCues: ['Brace, break at hips and knees', 'Hit depth, drive through mid-foot'] },
  { key: 'front-squat', name: 'Front Squat', muscles: ['quads'], defaultCues: ['Elbows high, upright torso'] },
  { key: 'leg-press', name: 'Leg Press', muscles: ['quads', 'glutes'], defaultCues: ['Feet shoulder-width', 'Don’t lock knees hard'] },
  { key: 'hack-squat', name: 'Hack Squat', muscles: ['quads'], defaultCues: ['Deep, controlled descent'] },
  { key: 'leg-extension', name: 'Leg Extension', muscles: ['quads'], defaultCues: ['Squeeze at the top'] },
  { key: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', muscles: ['quads', 'glutes'], defaultCues: ['Rear foot elevated, stay tall'] },

  // Hamstrings / glutes
  { key: 'romanian-deadlift', name: 'Romanian Deadlift', muscles: ['hamstrings', 'glutes'], defaultCues: ['Soft knees, push hips back', 'Feel the hamstring stretch'] },
  { key: 'lying-leg-curl', name: 'Lying Leg Curl', muscles: ['hamstrings'], defaultCues: ['No hip rise, full curl'] },
  { key: 'seated-leg-curl', name: 'Seated Leg Curl', muscles: ['hamstrings'], defaultCues: ['Control the eccentric'] },
  { key: 'hip-thrust', name: 'Hip Thrust', muscles: ['glutes', 'hamstrings'], defaultCues: ['Chin tucked, full hip lockout'] },

  // Calves / core
  { key: 'standing-calf-raise', name: 'Standing Calf Raise', muscles: ['calves'], defaultCues: ['Full stretch, pause at top'] },
  { key: 'seated-calf-raise', name: 'Seated Calf Raise', muscles: ['calves'], defaultCues: ['Soleus bias, slow tempo'] },
  { key: 'cable-crunch', name: 'Cable Crunch', muscles: ['core'], defaultCues: ['Crunch with abs, not hips'] },
] as const;

export function findSeedExercise(key: string): SeedExercise | undefined {
  return EXERCISE_LIBRARY.find((e) => e.key === key);
}

// ─── Starter templates ──────────────────────────────────────────
const DOUBLE_PROG: ProgressionRule = { targetReps: 12, holdSessions: 2, incrementLb: 5 };

export const STARTER_TEMPLATES: readonly SeedTemplate[] = [
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
  {
    key: 'full-body',
    name: 'Full Body',
    notes: 'One big lift per pattern. 3 working sets each, ~8–12 reps @ RIR 1–2.',
    restMiniSec: 90,
    restClusterSec: 150,
    exercises: [
      { key: 'back-squat', progression: { targetReps: 8, holdSessions: 2, incrementLb: 10 }, plannedSets: straight(3) },
      { key: 'barbell-bench-press', progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 }, plannedSets: straight(3) },
      { key: 'barbell-row', progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 }, plannedSets: straight(3) },
      { key: 'seated-db-shoulder-press', progression: DOUBLE_PROG, plannedSets: straight(3) },
      { key: 'romanian-deadlift', progression: { targetReps: 8, holdSessions: 2, incrementLb: 10 }, plannedSets: straight(3) },
    ],
  },
] as const;
