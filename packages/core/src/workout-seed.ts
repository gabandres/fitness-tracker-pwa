// Shipped starter content for the Train tab — the single shared source for
// BOTH apps (Angular PWA + Expo). Read-only catalog data baked into the
// bundle (not per-user). When a user taps "use this template" or "add
// exercise", the clone flow copies the relevant entries into their own
// editable `users/{uid}/exercises` + `workoutTemplates` collections. Seed
// entries are keyed by a stable slug so a starter template can reference
// library exercises before any Firestore ids exist.
//
// LOCALIZATION: the English content below is the source; every translation
// lives in a side-map at the bottom, keyed by the same stable `key`, and is
// reached through the SEED_L10N registry. Adding a language is ONE row
// there — the resolvers never grow a branch. The clone flow resolves name/cues/notes for
// the user's ACTIVE locale once (via the seed* helpers) and stores the result
// as plain user data — once cloned it's the user's own (never re-translated).
// The stable `key` is ALSO persisted as `seedKey` on the cloned exercise /
// template so re-cloning in a different locale reuses the same doc instead of
// creating a locale-named duplicate.

import type { LogStyle, MuscleGroup, PlannedSet, ProgressionRule } from './workout';

export interface SeedExercise {
  /** Stable slug — referenced by SeedTemplateExercise.key. */
  key: string;
  name: string;
  muscles: MuscleGroup[];
  defaultCues: string[];
  /** Omitted means `weight-reps`, which is what every lift here is. Mobility
   *  movements set `'time'` — the clone paths in both apps read this, and
   *  hardcoded `'weight-reps'` before ADR-0028 (a hold logged as load x reps
   *  has no field to put the hold in). */
  logStyle?: LogStyle;
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

/** N mobility holds at a fixed prescribed duration (ADR-0028). Kept at or
 *  under 45 s in a PRE position: Simic et al. found the pre-lift strength
 *  deficit smallest at <=45 s, with range of motion still improving. */
const holds = (n: number, durationSec: number): PlannedSet[] =>
  Array.from({ length: n }, () => ({ kind: 'mobility' as const, durationSec }));

/** One cluster = activation + `minis` mini-sets, tagged with a group. */
const cluster = (group: number, minis = 2): PlannedSet[] => [
  { kind: 'activation', group },
  ...Array.from({ length: minis }, () => ({ kind: 'mini' as const, group })),
];

// ─── Exercise library (~60 common lifts) ────────────────────────
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

  // Mobility (ADR-0028). Timed movements, no ProgressionRule anywhere — a
  // suggestion to hold it longer next time is a nudge in the direction the
  // evidence warns about. Cues describe the POSITION and nothing else: no cue
  // here, or anywhere, may claim soreness relief, recovery or injury
  // prevention. The Cochrane review (n=2,377 in one trial) tests that claim
  // and rejects it, so it is a decision rather than a matter of tone.
  { key: 'couch-stretch', name: 'Couch Stretch', muscles: ['quads'], defaultCues: ['Rear foot up on a bench or wall', 'Square the hips, ribs down'], logStyle: 'time' },
  { key: 'half-kneeling-hip-flexor', name: 'Half-Kneeling Hip Flexor', muscles: ['quads', 'glutes'], defaultCues: ['Tuck the pelvis before leaning', 'Squeeze the back glute'], logStyle: 'time' },
  { key: 'ninety-ninety-hip-switch', name: '90/90 Hip Switch', muscles: ['glutes'], defaultCues: ['Both knees at 90°', 'Rotate side to side, chest tall'], logStyle: 'time' },
  { key: 'worlds-greatest-stretch', name: "World's Greatest Stretch", muscles: ['hamstrings', 'glutes'], defaultCues: ['Deep lunge, elbow to instep', 'Open the chest to the ceiling'], logStyle: 'time' },
  { key: 'cat-cow', name: 'Cat-Cow', muscles: ['back', 'core'], defaultCues: ['Move one vertebra at a time', 'Breathe with the movement'], logStyle: 'time' },
  { key: 'thoracic-open-book', name: 'Open Book', muscles: ['back', 'shoulders'], defaultCues: ['Side-lying, knees stacked', 'Follow the top hand with your eyes'], logStyle: 'time' },
  { key: 'shoulder-pass-through', name: 'Shoulder Pass-Through', muscles: ['shoulders'], defaultCues: ['Wide grip on a band or stick', 'Straight arms, no shrug'], logStyle: 'time' },
  { key: 'ankle-rock', name: 'Ankle Rock', muscles: ['calves'], defaultCues: ['Knee travels over the toes', 'Heel stays down'], logStyle: 'time' },
] as const;

/**
 * The seed keys that are mobility movements (ADR-0028), derived from the
 * library rather than listed again — a second list is a second thing to forget.
 *
 * Exists so a client can re-add a seeded stretch FROM THE CATALOG and still get
 * `mobility` sets. Without it the creation chip fixes only the new-exercise
 * path, and typing "couch" to re-add Couch Stretch quietly produces `working`
 * sets again — the same defect, one door over.
 *
 * It classifies seeded movements ONLY, on purpose. A user-created stretch is
 * classified by the chip they picked, never by a guess about its name, which is
 * the same line ADR-0028 amendment 1A drew when it refused to put a
 * static/dynamic field on `Exercise`.
 */
export const MOBILITY_SEED_KEYS: ReadonlySet<string> = new Set(
  EXERCISE_LIBRARY.filter((e) => e.logStyle === 'time').map((e) => e.key),
);

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
  // ADR-0028's seeded mobility list, delivered as a template rather than as a
  // new picker: the clone path already creates catalog entries from seed keys,
  // resolves their names per locale and dedupes on `seedKey`, so this needs no
  // UI at all. The ADR names STARTER_TEMPLATES as the sanctioned home for
  // prescribed sequences.
  //
  // It is deliberately POST-position work — every hold sits after the lift it
  // follows would have gone, and the template prescribes no lift, so the dose
  // guardrail has nothing to fire on. 45 s is the ceiling the evidence is
  // quietest about, not a target: Simic et al. put the pre-lift deficit
  // smallest at <=45 s with range of motion still improving.
  //
  // The notes say what it IS and make no claim about what it does. No
  // soreness, no recovery, no injury prevention — see ADR-0028 decision 6.
  {
    key: 'mobility-reset',
    name: 'Mobility Reset',
    notes: 'Eight timed positions, 45 s each. Put them after a session, or run them on their own.',
    restMiniSec: 15,
    restClusterSec: 30,
    exercises: [
      { key: 'cat-cow', plannedSets: holds(1, 45) },
      { key: 'thoracic-open-book', plannedSets: holds(2, 45) },
      { key: 'shoulder-pass-through', plannedSets: holds(1, 45) },
      { key: 'ninety-ninety-hip-switch', plannedSets: holds(2, 45) },
      { key: 'half-kneeling-hip-flexor', plannedSets: holds(2, 45) },
      { key: 'couch-stretch', plannedSets: holds(2, 45) },
      { key: 'worlds-greatest-stretch', plannedSets: holds(2, 45) },
      { key: 'ankle-rock', plannedSets: holds(2, 45) },
    ],
  },
] as const;

// ─── Translation side-maps ────────────────────────────────────
// One set of maps per language, keyed by the stable seed `key`. Only entries
// present are localized; anything missing falls through to the English source
// above, so a partial translation is a valid one.
//
// ADDING A LANGUAGE: write the three maps, then add ONE row to SEED_L10N at
// the bottom of this file. Nothing else here — or in either app — changes.

/** Shape of a per-language exercise map. */
export type SeedExerciseL10n = Record<string, { name: string; defaultCues: string[] }>;
/** Shape of a per-language template map. */
export type SeedTemplateL10n = Record<string, { name: string; notes?: string }>;
/** Shape of a per-language `templateKey:exerciseKey` cue-override map. */
export type SeedCuesL10n = Record<string, string[]>;

// ─── es-PR (Puerto Rican Spanish) ─────────────────────
export const EXERCISE_ES: SeedExerciseL10n = {
  // Chest
  'barbell-bench-press': { name: 'Press de Banca con Barra', defaultCues: ['Retrae escápulas, arco leve', 'Barra a la línea del pezón', 'Empuja los pies contra el piso'] },
  'incline-barbell-press': { name: 'Press Inclinado con Barra', defaultCues: ['Banco a 30–45°', 'Enfoca pecho superior'] },
  'dumbbell-bench-press': { name: 'Press de Banca con Mancuernas', defaultCues: ['Estiramiento profundo abajo', 'Aprieta arriba'] },
  'incline-dumbbell-press': { name: 'Press Inclinado con Mancuernas', defaultCues: ['Énfasis en pecho superior'] },
  'machine-chest-press': { name: 'Press de Pecho en Máquina', defaultCues: ['Agarres a media altura del pecho', 'Codos ~45–60° del torso'] },
  'incline-machine-press': { name: 'Press Inclinado en Máquina', defaultCues: ['Ángulo de pecho superior'] },
  'paramount-supine-chest-press': { name: 'Press de Pecho Supino Paramount', defaultCues: ['Asiento para alinear agarres a media altura (línea del pezón)', 'Codos ~45–60° del torso', '3s bajando, 1s aprieta arriba, estiramiento profundo'] },
  'paramount-incline-chest-press': { name: 'Press de Pecho Inclinado Paramount', defaultCues: ['Enfoca pecho superior', '3s bajando, estiramiento profundo'] },
  'cable-fly': { name: 'Apertura en Polea', defaultCues: ['Codo doblado leve, mantenlo', 'Aprieta cruzando la línea media'] },
  'pec-deck': { name: 'Pec Deck', defaultCues: ['Controla el estiramiento'] },
  'chest-dip': { name: 'Fondos para Pecho', defaultCues: ['Inclínate al frente para enfocar pecho'] },
  'push-up': { name: 'Lagartija', defaultCues: ['Cuerpo en línea recta'] },
  // Back
  'deadlift': { name: 'Peso Muerto', defaultCues: ['Columna neutral', 'Empuja el piso lejos', 'Cierra con los glúteos'] },
  'barbell-row': { name: 'Remo con Barra', defaultCues: ['Bisagra ~45°', 'Jala a las costillas bajas'] },
  'pendlay-row': { name: 'Remo Pendlay', defaultCues: ['Reinicia cada rep en el piso', 'Jalón explosivo'] },
  'dumbbell-row': { name: 'Remo con Mancuerna', defaultCues: ['Apóyate en el banco', 'Lleva el codo a la cadera'] },
  'lat-pulldown': { name: 'Jalón al Pecho', defaultCues: ['Barra al pecho superior', 'Baja los codos'] },
  'pull-up': { name: 'Dominada', defaultCues: ['Cuelga completo, barbilla sobre la barra'] },
  'chin-up': { name: 'Dominada Supina', defaultCues: ['Agarre supinado, ayuda el bíceps'] },
  'seated-cable-row': { name: 'Remo Sentado en Polea', defaultCues: ['Pecho alto, jala al ombligo'] },
  't-bar-row': { name: 'Remo T-Bar', defaultCues: ['Con pecho apoyado si está disponible'] },
  'straight-arm-pulldown': { name: 'Jalón con Brazos Rectos', defaultCues: ['Solo dorsales, codos fijos'] },
  'face-pull': { name: 'Face Pull', defaultCues: ['Jala a la frente, rota externo'] },
  // Shoulders
  'overhead-press': { name: 'Press Militar', defaultCues: ['Aprieta el core', 'Barra sobre medio pie al cierre'] },
  'seated-db-shoulder-press': { name: 'Press de Hombros Sentado con Mancuernas', defaultCues: ['Empuja en arco leve', 'Baja hasta la altura de la oreja'] },
  'machine-shoulder-press': { name: 'Press de Hombros en Máquina', defaultCues: ['Agarres a la altura del hombro'] },
  'arnold-press': { name: 'Press Arnold', defaultCues: ['Rota las palmas durante el press'] },
  'db-lateral-raise': { name: 'Elevación Lateral con Mancuernas', defaultCues: ['Lidera con los codos', 'Peso liviano para 12–15 reps'] },
  'cable-lateral-raise': { name: 'Elevación Lateral en Polea', defaultCues: ['Tensión constante'] },
  'rear-delt-fly': { name: 'Apertura Posterior', defaultCues: ['Inclínate leve al frente', 'Aprieta los deltoides posteriores'] },
  'upright-row': { name: 'Remo al Mentón', defaultCues: ['Lidera con los codos, para al pecho'] },
  // Biceps
  'barbell-curl': { name: 'Curl con Barra', defaultCues: ['Codos fijos, sin impulso'] },
  'dumbbell-curl': { name: 'Curl con Mancuernas', defaultCues: ['Supina arriba'] },
  'hammer-curl': { name: 'Curl Martillo', defaultCues: ['Agarre neutral, enfoca braquial'] },
  'preacher-curl': { name: 'Curl Predicador', defaultCues: ['Sin rebote abajo'] },
  'cable-curl': { name: 'Curl en Polea', defaultCues: ['Tensión constante todo el recorrido'] },
  'incline-db-curl': { name: 'Curl Inclinado con Mancuernas', defaultCues: ['Estiramiento profundo en banco inclinado'] },
  // Triceps
  'close-grip-bench': { name: 'Press Cerrado', defaultCues: ['Agarre al ancho de hombros', 'Codos pegados'] },
  'machine-close-grip-press': { name: 'Press Cerrado en Smith/Máquina', defaultCues: ['Codos pegados, empuja con tríceps'] },
  'triceps-pushdown': { name: 'Extensión de Tríceps en Polea', defaultCues: ['Codos fijos, cierre completo'] },
  'rope-pushdown': { name: 'Extensión en Polea con Soga', defaultCues: ['Abre la soga abajo'] },
  'overhead-db-extension': { name: 'Extensión sobre la Cabeza con Mancuerna', defaultCues: ['Estiramiento profundo detrás de la cabeza', 'Drop set OK'] },
  'skullcrusher': { name: 'Rompecráneos', defaultCues: ['Baja a la frente, codos firmes'] },
  'triceps-dip': { name: 'Fondos para Tríceps', defaultCues: ['Mantente recto para enfocar tríceps'] },
  // Quads / legs
  'back-squat': { name: 'Sentadilla Trasera', defaultCues: ['Aprieta, dobla en cadera y rodillas', 'Llega a la profundidad, empuja por el medio pie'] },
  'front-squat': { name: 'Sentadilla Frontal', defaultCues: ['Codos altos, torso recto'] },
  'leg-press': { name: 'Prensa de Piernas', defaultCues: ['Pies al ancho de hombros', 'No cierres las rodillas fuerte'] },
  'hack-squat': { name: 'Hack Squat', defaultCues: ['Bajada profunda y controlada'] },
  'leg-extension': { name: 'Extensión de Piernas', defaultCues: ['Aprieta arriba'] },
  'walking-lunge': { name: 'Zancada Caminando', defaultCues: ['Paso largo, rodilla sigue los dedos'] },
  'bulgarian-split-squat': { name: 'Sentadilla Búlgara', defaultCues: ['Pie trasero elevado, mantente recto'] },
  'goblet-squat': { name: 'Sentadilla Goblet', defaultCues: ['Codos dentro de las rodillas abajo'] },
  // Hamstrings / glutes
  'romanian-deadlift': { name: 'Peso Muerto Rumano', defaultCues: ['Rodillas suaves, empuja la cadera atrás', 'Siente el estiramiento del femoral'] },
  'lying-leg-curl': { name: 'Curl Femoral Acostado', defaultCues: ['Sin levantar la cadera, curl completo'] },
  'seated-leg-curl': { name: 'Curl Femoral Sentado', defaultCues: ['Controla la bajada'] },
  'hip-thrust': { name: 'Hip Thrust', defaultCues: ['Barbilla recogida, cierre completo de cadera'] },
  'good-morning': { name: 'Buenos Días', defaultCues: ['Poco peso, bisagra con columna neutral'] },
  // Calves
  'standing-calf-raise': { name: 'Elevación de Pantorrilla de Pie', defaultCues: ['Estiramiento completo, pausa arriba'] },
  'seated-calf-raise': { name: 'Elevación de Pantorrilla Sentado', defaultCues: ['Enfoca el sóleo, tempo lento'] },
  // Core
  'plank': { name: 'Plancha', defaultCues: ['Glúteos firmes, columna neutral'] },
  'hanging-leg-raise': { name: 'Elevación de Piernas Colgado', defaultCues: ['Sin balanceo, enrolla la pelvis'] },
  'cable-crunch': { name: 'Crunch en Polea', defaultCues: ['Crunch con abdomen, no con cadera'] },
  'ab-wheel': { name: 'Rueda Abdominal', defaultCues: ['Aprieta, no dejes caer la cadera'] },
  // Mobility (ADR-0028)
  'couch-stretch': { name: 'Estiramiento de Sofá', defaultCues: ['Pie trasero en un banco o pared', 'Cuadra las caderas, costillas abajo'] },
  'half-kneeling-hip-flexor': { name: 'Flexor de Cadera de Rodillas', defaultCues: ['Mete la pelvis antes de inclinarte', 'Aprieta el glúteo de atrás'] },
  'ninety-ninety-hip-switch': { name: 'Cambio de Cadera 90/90', defaultCues: ['Ambas rodillas a 90°', 'Rota de lado a lado, pecho alto'] },
  'worlds-greatest-stretch': { name: 'El Mejor Estiramiento del Mundo', defaultCues: ['Zancada profunda, codo al empeine', 'Abre el pecho al techo'] },
  'cat-cow': { name: 'Gato-Camello', defaultCues: ['Mueve una vértebra a la vez', 'Respira con el movimiento'] },
  'thoracic-open-book': { name: 'Libro Abierto', defaultCues: ['De lado, rodillas alineadas', 'Sigue la mano de arriba con la vista'] },
  'shoulder-pass-through': { name: 'Pase de Hombros', defaultCues: ['Agarre ancho con banda o palo', 'Brazos rectos, sin encoger'] },
  'ankle-rock': { name: 'Balanceo de Tobillo', defaultCues: ['La rodilla pasa sobre los dedos', 'El talón se queda abajo'] },
};

export const TEMPLATE_ES: SeedTemplateL10n = {
  'chest-tri-sh-cluster': { name: 'Pecho / Tríceps / Hombros (Cluster)', notes: 'Tope de 60 min. Formato cluster: activación / mini / mini.\nActivación: 9–12 reps @ RIR 1–2. Mini-sets: 3–5 reps @ RIR 0–1.\nDescansa 15–20s entre mini-sets, 2–3 min entre clusters.\nPROGRESIÓN: la activación llega a 12 reps × 2 sesiones → +2.5–5 lb.' },
  'push-day': { name: 'Día de Empuje', notes: 'Pecho, hombros, tríceps. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'pull-day': { name: 'Día de Jalón', notes: 'Espalda y bíceps. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'leg-day': { name: 'Día de Piernas', notes: 'Cuádriceps, femorales, glúteos, pantorrillas. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'full-body': { name: 'Cuerpo Completo', notes: 'Un gran levantamiento por patrón. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'mobility-reset': { name: 'Reinicio de Movilidad', notes: 'Ocho posiciones cronometradas, 45 s cada una. Ponlas después de una sesión, o hazlas solas.' },
};

export const TEMPLATE_CUES_ES: SeedCuesL10n = {
  'chest-tri-sh-cluster:paramount-supine-chest-press': ['Asiento para alinear agarres a media altura (línea del pezón)', 'Codos ~45–60° del torso', '3s bajando, 1s aprieta arriba, estiramiento profundo', 'Esto REEMPLAZA el Smith vertical'],
  'chest-tri-sh-cluster:paramount-incline-chest-press': ['Mismos cues, enfoca pecho superior'],
  'chest-tri-sh-cluster:db-lateral-raise': ['Peso más liviano para llegar a 12–15 reps (bajado de 10 lb)'],
  'chest-tri-sh-cluster:machine-close-grip-press': ['SOLO 1 CLUSTER — NO añadas un 2do cluster'],
  'chest-tri-sh-cluster:overhead-db-extension': ['Drop set OK'],
};


// ─── pt-BR (Brazilian Portuguese) ─────────────────────
export const EXERCISE_PT: SeedExerciseL10n = {
  // Chest
  'barbell-bench-press': { name: 'Supino Reto com Barra', defaultCues: ['Escápulas retraídas, leve arco', 'Barra na linha do mamilo', 'Empurre os pés contra o chão'] },
  'incline-barbell-press': { name: 'Supino Inclinado com Barra', defaultCues: ['Banco a 30–45°', 'Foca a parte superior do peitoral'] },
  'dumbbell-bench-press': { name: 'Supino Reto com Halteres', defaultCues: ['Alongamento profundo embaixo', 'Contraia no topo'] },
  'incline-dumbbell-press': { name: 'Supino Inclinado com Halteres', defaultCues: ['Ênfase na parte superior do peitoral'] },
  'machine-chest-press': { name: 'Supino na Máquina', defaultCues: ['Pegadas na altura média do peito', 'Cotovelos a ~45–60° do tronco'] },
  'incline-machine-press': { name: 'Supino Inclinado na Máquina', defaultCues: ['Ângulo de peitoral superior'] },
  'paramount-supine-chest-press': { name: 'Supino Horizontal Paramount', defaultCues: ['Ajuste o banco para alinhar as pegadas na linha do mamilo', 'Cotovelos a ~45–60° do tronco', '3s descendo, 1s de contração no topo, alongamento profundo'] },
  'paramount-incline-chest-press': { name: 'Supino Inclinado Paramount', defaultCues: ['Foca a parte superior do peitoral', '3s descendo, alongamento profundo'] },
  'cable-fly': { name: 'Crucifixo na Polia', defaultCues: ['Cotovelo levemente flexionado, mantenha assim', 'Contraia cruzando a linha média'] },
  'pec-deck': { name: 'Peck Deck', defaultCues: ['Controle o alongamento'] },
  'chest-dip': { name: 'Mergulho para Peitoral', defaultCues: ['Incline o tronco à frente para focar o peitoral'] },
  'push-up': { name: 'Flexão de Braço', defaultCues: ['Corpo em linha reta'] },
  // Back
  'deadlift': { name: 'Levantamento Terra', defaultCues: ['Coluna neutra', 'Empurre o chão para longe', 'Finalize com os glúteos'] },
  'barbell-row': { name: 'Remada Curvada com Barra', defaultCues: ['Quadril flexionado a ~45°', 'Puxe até a costela inferior'] },
  'pendlay-row': { name: 'Remada Pendlay', defaultCues: ['Reinicie cada repetição no chão', 'Puxada explosiva'] },
  'dumbbell-row': { name: 'Remada Unilateral com Halter', defaultCues: ['Apoie-se no banco', 'Leve o cotovelo ao quadril'] },
  'lat-pulldown': { name: 'Puxada na Polia Alta', defaultCues: ['Barra até a parte alta do peito', 'Puxe os cotovelos para baixo'] },
  'pull-up': { name: 'Barra Fixa', defaultCues: ['Pendure-se por completo, queixo acima da barra'] },
  'chin-up': { name: 'Barra Fixa Supinada', defaultCues: ['Pegada supinada, o bíceps ajuda'] },
  'seated-cable-row': { name: 'Remada Sentada na Polia', defaultCues: ['Peito alto, puxe até o umbigo'] },
  't-bar-row': { name: 'Remada Cavalinho', defaultCues: ['Com apoio no peito, se houver'] },
  'straight-arm-pulldown': { name: 'Pulldown com Braços Estendidos', defaultCues: ['Só dorsais, cotovelos fixos'] },
  'face-pull': { name: 'Face Pull', defaultCues: ['Puxe até a testa, rotação externa'] },
  // Shoulders
  'overhead-press': { name: 'Desenvolvimento Militar', defaultCues: ['Contraia o core', 'Barra sobre o meio do pé ao final'] },
  'seated-db-shoulder-press': { name: 'Desenvolvimento Sentado com Halteres', defaultCues: ['Empurre em leve arco', 'Desça até a altura da orelha'] },
  'machine-shoulder-press': { name: 'Desenvolvimento na Máquina', defaultCues: ['Pegadas na altura dos ombros'] },
  'arnold-press': { name: 'Desenvolvimento Arnold', defaultCues: ['Gire as palmas durante o movimento'] },
  'db-lateral-raise': { name: 'Elevação Lateral com Halteres', defaultCues: ['Conduza pelos cotovelos', 'Peso leve para 12–15 repetições'] },
  'cable-lateral-raise': { name: 'Elevação Lateral na Polia', defaultCues: ['Tensão constante'] },
  'rear-delt-fly': { name: 'Crucifixo Inverso', defaultCues: ['Incline levemente o tronco à frente', 'Contraia os deltoides posteriores'] },
  'upright-row': { name: 'Remada Alta', defaultCues: ['Conduza pelos cotovelos, pare na altura do peito'] },
  // Biceps
  'barbell-curl': { name: 'Rosca Direta com Barra', defaultCues: ['Cotovelos fixos, sem impulso'] },
  'dumbbell-curl': { name: 'Rosca Alternada com Halteres', defaultCues: ['Supine no topo'] },
  'hammer-curl': { name: 'Rosca Martelo', defaultCues: ['Pegada neutra, foca o braquial'] },
  'preacher-curl': { name: 'Rosca Scott', defaultCues: ['Sem repique embaixo'] },
  'cable-curl': { name: 'Rosca na Polia', defaultCues: ['Tensão constante em toda a amplitude'] },
  'incline-db-curl': { name: 'Rosca Inclinada com Halteres', defaultCues: ['Alongamento profundo no banco inclinado'] },
  // Triceps
  'close-grip-bench': { name: 'Supino com Pegada Fechada', defaultCues: ['Pegada na largura dos ombros', 'Cotovelos junto ao corpo'] },
  'machine-close-grip-press': { name: 'Supino Fechado no Smith/Máquina', defaultCues: ['Cotovelos junto ao corpo, empurre com o tríceps'] },
  'triceps-pushdown': { name: 'Tríceps na Polia Alta', defaultCues: ['Cotovelos fixos, extensão completa'] },
  'rope-pushdown': { name: 'Tríceps Corda', defaultCues: ['Abra a corda embaixo'] },
  'overhead-db-extension': { name: 'Extensão de Tríceps acima da Cabeça', defaultCues: ['Alongamento profundo atrás da cabeça', 'Drop set liberado'] },
  'skullcrusher': { name: 'Tríceps Testa', defaultCues: ['Desça até a testa, cotovelos firmes'] },
  'triceps-dip': { name: 'Mergulho para Tríceps', defaultCues: ['Mantenha o tronco ereto para focar o tríceps'] },
  // Quads / legs
  'back-squat': { name: 'Agachamento Livre', defaultCues: ['Contraia, flexione quadril e joelhos', 'Alcance a profundidade, empurre pelo meio do pé'] },
  'front-squat': { name: 'Agachamento Frontal', defaultCues: ['Cotovelos altos, tronco ereto'] },
  'leg-press': { name: 'Leg Press', defaultCues: ['Pés na largura dos ombros', 'Não trave os joelhos com força'] },
  'hack-squat': { name: 'Hack Squat', defaultCues: ['Descida profunda e controlada'] },
  'leg-extension': { name: 'Cadeira Extensora', defaultCues: ['Contraia no topo'] },
  'walking-lunge': { name: 'Avanço Caminhando', defaultCues: ['Passo longo, joelho na linha dos dedos'] },
  'bulgarian-split-squat': { name: 'Agachamento Búlgaro', defaultCues: ['Pé de trás elevado, tronco ereto'] },
  'goblet-squat': { name: 'Agachamento Goblet', defaultCues: ['Cotovelos por dentro dos joelhos embaixo'] },
  // Hamstrings / glutes
  'romanian-deadlift': { name: 'Levantamento Terra Romeno', defaultCues: ['Joelhos levemente flexionados, quadril para trás', 'Sinta o alongamento do posterior'] },
  'lying-leg-curl': { name: 'Mesa Flexora', defaultCues: ['Sem levantar o quadril, flexão completa'] },
  'seated-leg-curl': { name: 'Cadeira Flexora', defaultCues: ['Controle a descida'] },
  'hip-thrust': { name: 'Elevação Pélvica', defaultCues: ['Queixo recolhido, extensão total do quadril'] },
  'good-morning': { name: 'Bom Dia', defaultCues: ['Pouca carga, flexione o quadril com a coluna neutra'] },
  // Calves
  'standing-calf-raise': { name: 'Panturrilha em Pé', defaultCues: ['Alongamento completo, pausa no topo'] },
  'seated-calf-raise': { name: 'Panturrilha Sentado', defaultCues: ['Foca o sóleo, cadência lenta'] },
  // Core
  'plank': { name: 'Prancha', defaultCues: ['Glúteos firmes, coluna neutra'] },
  'hanging-leg-raise': { name: 'Elevação de Pernas na Barra', defaultCues: ['Sem balanço, enrole a pelve'] },
  'cable-crunch': { name: 'Abdominal na Polia', defaultCues: ['Flexione com o abdômen, não com o quadril'] },
  'ab-wheel': { name: 'Roda Abdominal', defaultCues: ['Contraia, não deixe o quadril cair'] },
  // Mobility (ADR-0028)
  'couch-stretch': { name: 'Alongamento do Sofá', defaultCues: ['Pé de trás apoiado no banco ou parede', 'Alinhe os quadris, costelas para baixo'] },
  'half-kneeling-hip-flexor': { name: 'Flexor do Quadril Ajoelhado', defaultCues: ['Encaixe a pelve antes de inclinar', 'Aperte o glúteo de trás'] },
  'ninety-ninety-hip-switch': { name: 'Troca de Quadril 90/90', defaultCues: ['Ambos os joelhos a 90°', 'Gire de um lado ao outro, peito alto'] },
  'worlds-greatest-stretch': { name: 'O Maior Alongamento do Mundo', defaultCues: ['Afundo profundo, cotovelo até o pé', 'Abra o peito para o teto'] },
  'cat-cow': { name: 'Gato-Vaca', defaultCues: ['Mova uma vértebra por vez', 'Respire junto com o movimento'] },
  'thoracic-open-book': { name: 'Livro Aberto', defaultCues: ['De lado, joelhos alinhados', 'Siga a mão de cima com os olhos'] },
  'shoulder-pass-through': { name: 'Passagem de Ombros', defaultCues: ['Pegada larga na banda ou bastão', 'Braços retos, sem encolher'] },
  'ankle-rock': { name: 'Balanço de Tornozelo', defaultCues: ['O joelho passa sobre os dedos', 'O calcanhar fica no chão'] },
};

export const TEMPLATE_PT: SeedTemplateL10n = {
  'chest-tri-sh-cluster': { name: 'Peito / Tríceps / Ombros (Cluster)', notes: 'Limite de 60 min. Formato cluster: ativação / mini / mini.\nAtivação: 9–12 reps @ RIR 1–2. Mini-séries: 3–5 reps @ RIR 0–1.\nDescanse 15–20s entre mini-séries, 2–3 min entre clusters.\nPROGRESSÃO: quando a ativação chegar a 12 reps × 2 sessões → +2,5–5 lb.' },
  'push-day': { name: 'Treino de Empurrar', notes: 'Peito, ombros e tríceps. 3 séries de trabalho em cada, ~8–12 reps @ RIR 1–2.' },
  'pull-day': { name: 'Treino de Puxar', notes: 'Costas e bíceps. 3 séries de trabalho em cada, ~8–12 reps @ RIR 1–2.' },
  'leg-day': { name: 'Treino de Pernas', notes: 'Quadríceps, posteriores, glúteos e panturrilhas. 3 séries de trabalho em cada, ~8–12 reps @ RIR 1–2.' },
  'full-body': { name: 'Corpo Inteiro', notes: 'Um grande exercício por padrão de movimento. 3 séries de trabalho em cada, ~8–12 reps @ RIR 1–2.' },
  'mobility-reset': { name: 'Reset de Mobilidade', notes: 'Oito posições cronometradas, 45 s cada. Faça depois de uma sessão, ou sozinhas.' },
};

export const TEMPLATE_CUES_PT: SeedCuesL10n = {
  'chest-tri-sh-cluster:paramount-supine-chest-press': ['Ajuste o banco para alinhar as pegadas na linha do mamilo', 'Cotovelos a ~45–60° do tronco', '3s descendo, 1s de contração no topo, alongamento profundo', 'Isto SUBSTITUI o Smith vertical'],
  'chest-tri-sh-cluster:paramount-incline-chest-press': ['Mesmos pontos, foca a parte superior do peitoral'],
  'chest-tri-sh-cluster:db-lateral-raise': ['Peso mais leve para chegar a 12–15 reps (reduzido de 10 lb)'],
  'chest-tri-sh-cluster:machine-close-grip-press': ['APENAS 1 CLUSTER — NÃO acrescente um 2º cluster'],
  'chest-tri-sh-cluster:overhead-db-extension': ['Drop set liberado'],
};

// ─── The locale registry — the ONLY place a language is registered ──
/**
 * Every localized seed lookup goes through this one table.
 *
 * The five resolvers below used to take `es: boolean`, which is precisely why
 * a third language was a cross-cutting change: a boolean can only ever answer
 * "Spanish, or not". They take the app's locale tag now, and a tag with no row
 * here finds no side-map and falls through to the English source — the same
 * behaviour `es === false` produced, without the arity.
 *
 * **To add a language: write the three maps above, add one row here. Done.**
 */
export const SEED_L10N: Record<
  string,
  { exercises: SeedExerciseL10n; templates: SeedTemplateL10n; cues: SeedCuesL10n }
> = {
  'es-PR': { exercises: EXERCISE_ES, templates: TEMPLATE_ES, cues: TEMPLATE_CUES_ES },
  'pt-BR': { exercises: EXERCISE_PT, templates: TEMPLATE_PT, cues: TEMPLATE_CUES_PT },
};

/** Resolve a library exercise's display name for the active locale. */
export function seedExerciseName(ex: SeedExercise, locale: string): string {
  return SEED_L10N[locale]?.exercises[ex.key]?.name || ex.name;
}

/** Resolve a library exercise's default cues for the active locale. */
export function seedExerciseCues(ex: SeedExercise, locale: string): string[] {
  return SEED_L10N[locale]?.exercises[ex.key]?.defaultCues || ex.defaultCues;
}

/** Resolve a starter template's display name for the active locale. */
export function seedTemplateName(tpl: SeedTemplate, locale: string): string {
  return SEED_L10N[locale]?.templates[tpl.key]?.name || tpl.name;
}

/** Resolve a starter template's notes for the active locale. */
export function seedTemplateNotes(tpl: SeedTemplate, locale: string): string | undefined {
  return SEED_L10N[locale]?.templates[tpl.key]?.notes || tpl.notes;
}

/** Resolve the cues for one template-exercise: localized per-template override
 *  → English per-template override → localized library defaults. */
export function seedTemplateExerciseCues(
  tplKey: string,
  se: SeedTemplateExercise,
  lib: SeedExercise | undefined,
  locale: string,
): string[] | undefined {
  const ov = SEED_L10N[locale]?.cues[`${tplKey}:${se.key}`];
  if (ov) return ov;
  if (se.cues) return se.cues;
  return lib ? seedExerciseCues(lib, locale) : undefined;
}
