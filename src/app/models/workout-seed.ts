// Shipped starter content for the Train tab. This is read-only catalog
// data baked into the bundle (not per-user). When a user taps "use this
// template" or "add exercise", the clone flow copies the relevant entries
// into their own editable `users/{uid}/exercises` + `workoutTemplates`
// collections (see WorkoutStore.cloneStarterTemplate). Seed entries are
// keyed by a stable slug so a starter template can reference library
// exercises before any Firestore ids exist.
//
// LOCALIZATION: the English content below is the source; es-PR strings live in
// the side-maps at the bottom (EXERCISE_ES / TEMPLATE_ES / TEMPLATE_CUES_ES),
// keyed by the same stable `key`. The clone flow resolves name/cues/notes for
// the user's ACTIVE locale once (via the seed* helpers) and stores the result
// as plain user data — once cloned it's the user's own (never re-translated).
// Keep in parity with apps/mobile/src/lib/workout-seed.ts.

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

// ─── es-PR translations (Puerto Rican Spanish) ──────────────────
// Side-maps keyed by the stable seed `key`. Only entries present here are
// localized; anything missing falls back to the English source above. Keep in
// parity with apps/mobile/src/lib/workout-seed.ts.
export const EXERCISE_ES: Record<string, { nameEs: string; defaultCuesEs: string[] }> = {
  // Chest
  'barbell-bench-press': { nameEs: 'Press de Banca con Barra', defaultCuesEs: ['Retrae escápulas, arco leve', 'Barra a la línea del pezón', 'Empuja los pies contra el piso'] },
  'incline-barbell-press': { nameEs: 'Press Inclinado con Barra', defaultCuesEs: ['Banco a 30–45°', 'Enfoca pecho superior'] },
  'dumbbell-bench-press': { nameEs: 'Press de Banca con Mancuernas', defaultCuesEs: ['Estiramiento profundo abajo', 'Aprieta arriba'] },
  'incline-dumbbell-press': { nameEs: 'Press Inclinado con Mancuernas', defaultCuesEs: ['Énfasis en pecho superior'] },
  'machine-chest-press': { nameEs: 'Press de Pecho en Máquina', defaultCuesEs: ['Agarres a media altura del pecho', 'Codos ~45–60° del torso'] },
  'incline-machine-press': { nameEs: 'Press Inclinado en Máquina', defaultCuesEs: ['Ángulo de pecho superior'] },
  'paramount-supine-chest-press': { nameEs: 'Press de Pecho Supino Paramount', defaultCuesEs: ['Asiento para alinear agarres a media altura (línea del pezón)', 'Codos ~45–60° del torso', '3s bajando, 1s aprieta arriba, estiramiento profundo'] },
  'paramount-incline-chest-press': { nameEs: 'Press de Pecho Inclinado Paramount', defaultCuesEs: ['Enfoca pecho superior', '3s bajando, estiramiento profundo'] },
  'cable-fly': { nameEs: 'Apertura en Polea', defaultCuesEs: ['Codo doblado leve, mantenlo', 'Aprieta cruzando la línea media'] },
  'pec-deck': { nameEs: 'Pec Deck', defaultCuesEs: ['Controla el estiramiento'] },
  'chest-dip': { nameEs: 'Fondos para Pecho', defaultCuesEs: ['Inclínate al frente para enfocar pecho'] },
  'push-up': { nameEs: 'Lagartija', defaultCuesEs: ['Cuerpo en línea recta'] },
  // Back
  'deadlift': { nameEs: 'Peso Muerto', defaultCuesEs: ['Columna neutral', 'Empuja el piso lejos', 'Cierra con los glúteos'] },
  'barbell-row': { nameEs: 'Remo con Barra', defaultCuesEs: ['Bisagra ~45°', 'Jala a las costillas bajas'] },
  'pendlay-row': { nameEs: 'Remo Pendlay', defaultCuesEs: ['Reinicia cada rep en el piso', 'Jalón explosivo'] },
  'dumbbell-row': { nameEs: 'Remo con Mancuerna', defaultCuesEs: ['Apóyate en el banco', 'Lleva el codo a la cadera'] },
  'lat-pulldown': { nameEs: 'Jalón al Pecho', defaultCuesEs: ['Barra al pecho superior', 'Baja los codos'] },
  'pull-up': { nameEs: 'Dominada', defaultCuesEs: ['Cuelga completo, barbilla sobre la barra'] },
  'chin-up': { nameEs: 'Dominada Supina', defaultCuesEs: ['Agarre supinado, ayuda el bíceps'] },
  'seated-cable-row': { nameEs: 'Remo Sentado en Polea', defaultCuesEs: ['Pecho alto, jala al ombligo'] },
  't-bar-row': { nameEs: 'Remo T-Bar', defaultCuesEs: ['Con pecho apoyado si está disponible'] },
  'straight-arm-pulldown': { nameEs: 'Jalón con Brazos Rectos', defaultCuesEs: ['Solo dorsales, codos fijos'] },
  'face-pull': { nameEs: 'Face Pull', defaultCuesEs: ['Jala a la frente, rota externo'] },
  // Shoulders
  'overhead-press': { nameEs: 'Press Militar', defaultCuesEs: ['Aprieta el core', 'Barra sobre medio pie al cierre'] },
  'seated-db-shoulder-press': { nameEs: 'Press de Hombros Sentado con Mancuernas', defaultCuesEs: ['Empuja en arco leve', 'Baja hasta la altura de la oreja'] },
  'machine-shoulder-press': { nameEs: 'Press de Hombros en Máquina', defaultCuesEs: ['Agarres a la altura del hombro'] },
  'arnold-press': { nameEs: 'Press Arnold', defaultCuesEs: ['Rota las palmas durante el press'] },
  'db-lateral-raise': { nameEs: 'Elevación Lateral con Mancuernas', defaultCuesEs: ['Lidera con los codos', 'Peso liviano para 12–15 reps'] },
  'cable-lateral-raise': { nameEs: 'Elevación Lateral en Polea', defaultCuesEs: ['Tensión constante'] },
  'rear-delt-fly': { nameEs: 'Apertura Posterior', defaultCuesEs: ['Inclínate leve al frente', 'Aprieta los deltoides posteriores'] },
  'upright-row': { nameEs: 'Remo al Mentón', defaultCuesEs: ['Lidera con los codos, para al pecho'] },
  // Biceps
  'barbell-curl': { nameEs: 'Curl con Barra', defaultCuesEs: ['Codos fijos, sin impulso'] },
  'dumbbell-curl': { nameEs: 'Curl con Mancuernas', defaultCuesEs: ['Supina arriba'] },
  'hammer-curl': { nameEs: 'Curl Martillo', defaultCuesEs: ['Agarre neutral, enfoca braquial'] },
  'preacher-curl': { nameEs: 'Curl Predicador', defaultCuesEs: ['Sin rebote abajo'] },
  'cable-curl': { nameEs: 'Curl en Polea', defaultCuesEs: ['Tensión constante todo el recorrido'] },
  'incline-db-curl': { nameEs: 'Curl Inclinado con Mancuernas', defaultCuesEs: ['Estiramiento profundo en banco inclinado'] },
  // Triceps
  'close-grip-bench': { nameEs: 'Press Cerrado', defaultCuesEs: ['Agarre al ancho de hombros', 'Codos pegados'] },
  'machine-close-grip-press': { nameEs: 'Press Cerrado en Smith/Máquina', defaultCuesEs: ['Codos pegados, empuja con tríceps'] },
  'triceps-pushdown': { nameEs: 'Extensión de Tríceps en Polea', defaultCuesEs: ['Codos fijos, cierre completo'] },
  'rope-pushdown': { nameEs: 'Extensión en Polea con Soga', defaultCuesEs: ['Abre la soga abajo'] },
  'overhead-db-extension': { nameEs: 'Extensión sobre la Cabeza con Mancuerna', defaultCuesEs: ['Estiramiento profundo detrás de la cabeza', 'Drop set OK'] },
  'skullcrusher': { nameEs: 'Rompecráneos', defaultCuesEs: ['Baja a la frente, codos firmes'] },
  'triceps-dip': { nameEs: 'Fondos para Tríceps', defaultCuesEs: ['Mantente recto para enfocar tríceps'] },
  // Quads / legs
  'back-squat': { nameEs: 'Sentadilla Trasera', defaultCuesEs: ['Aprieta, dobla en cadera y rodillas', 'Llega a la profundidad, empuja por el medio pie'] },
  'front-squat': { nameEs: 'Sentadilla Frontal', defaultCuesEs: ['Codos altos, torso recto'] },
  'leg-press': { nameEs: 'Prensa de Piernas', defaultCuesEs: ['Pies al ancho de hombros', 'No cierres las rodillas fuerte'] },
  'hack-squat': { nameEs: 'Hack Squat', defaultCuesEs: ['Bajada profunda y controlada'] },
  'leg-extension': { nameEs: 'Extensión de Piernas', defaultCuesEs: ['Aprieta arriba'] },
  'walking-lunge': { nameEs: 'Zancada Caminando', defaultCuesEs: ['Paso largo, rodilla sigue los dedos'] },
  'bulgarian-split-squat': { nameEs: 'Sentadilla Búlgara', defaultCuesEs: ['Pie trasero elevado, mantente recto'] },
  'goblet-squat': { nameEs: 'Sentadilla Goblet', defaultCuesEs: ['Codos dentro de las rodillas abajo'] },
  // Hamstrings / glutes
  'romanian-deadlift': { nameEs: 'Peso Muerto Rumano', defaultCuesEs: ['Rodillas suaves, empuja la cadera atrás', 'Siente el estiramiento del femoral'] },
  'lying-leg-curl': { nameEs: 'Curl Femoral Acostado', defaultCuesEs: ['Sin levantar la cadera, curl completo'] },
  'seated-leg-curl': { nameEs: 'Curl Femoral Sentado', defaultCuesEs: ['Controla la bajada'] },
  'hip-thrust': { nameEs: 'Hip Thrust', defaultCuesEs: ['Barbilla recogida, cierre completo de cadera'] },
  'good-morning': { nameEs: 'Buenos Días', defaultCuesEs: ['Poco peso, bisagra con columna neutral'] },
  // Calves
  'standing-calf-raise': { nameEs: 'Elevación de Pantorrilla de Pie', defaultCuesEs: ['Estiramiento completo, pausa arriba'] },
  'seated-calf-raise': { nameEs: 'Elevación de Pantorrilla Sentado', defaultCuesEs: ['Enfoca el sóleo, tempo lento'] },
  // Core
  'plank': { nameEs: 'Plancha', defaultCuesEs: ['Glúteos firmes, columna neutral'] },
  'hanging-leg-raise': { nameEs: 'Elevación de Piernas Colgado', defaultCuesEs: ['Sin balanceo, enrolla la pelvis'] },
  'cable-crunch': { nameEs: 'Crunch en Polea', defaultCuesEs: ['Crunch con abdomen, no con cadera'] },
  'ab-wheel': { nameEs: 'Rueda Abdominal', defaultCuesEs: ['Aprieta, no dejes caer la cadera'] },
};

export const TEMPLATE_ES: Record<string, { nameEs: string; notesEs?: string }> = {
  'chest-tri-sh-cluster': { nameEs: 'Pecho / Tríceps / Hombros (Cluster)', notesEs: 'Tope de 60 min. Formato cluster: activación / mini / mini.\nActivación: 9–12 reps @ RIR 1–2. Mini-sets: 3–5 reps @ RIR 0–1.\nDescansa 15–20s entre mini-sets, 2–3 min entre clusters.\nPROGRESIÓN: la activación llega a 12 reps × 2 sesiones → +2.5–5 lb.' },
  'push-day': { nameEs: 'Día de Empuje', notesEs: 'Pecho, hombros, tríceps. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'pull-day': { nameEs: 'Día de Jalón', notesEs: 'Espalda y bíceps. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'leg-day': { nameEs: 'Día de Piernas', notesEs: 'Cuádriceps, femorales, glúteos, pantorrillas. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
  'full-body': { nameEs: 'Cuerpo Completo', notesEs: 'Un gran levantamiento por patrón. 3 sets de trabajo cada uno, ~8–12 reps @ RIR 1–2.' },
};

export const TEMPLATE_CUES_ES: Record<string, string[]> = {
  'chest-tri-sh-cluster:paramount-supine-chest-press': ['Asiento para alinear agarres a media altura (línea del pezón)', 'Codos ~45–60° del torso', '3s bajando, 1s aprieta arriba, estiramiento profundo', 'Esto REEMPLAZA el Smith vertical'],
  'chest-tri-sh-cluster:paramount-incline-chest-press': ['Mismos cues, enfoca pecho superior'],
  'chest-tri-sh-cluster:db-lateral-raise': ['Peso más liviano para llegar a 12–15 reps (bajado de 10 lb)'],
  'chest-tri-sh-cluster:machine-close-grip-press': ['SOLO 1 CLUSTER — NO añadas un 2do cluster'],
  'chest-tri-sh-cluster:overhead-db-extension': ['Drop set OK'],
};

/** Resolve a library exercise's display name for the active locale. */
export function seedExerciseName(ex: SeedExercise, es: boolean): string {
  return (es && EXERCISE_ES[ex.key]?.nameEs) || ex.name;
}

/** Resolve a library exercise's default cues for the active locale. */
export function seedExerciseCues(ex: SeedExercise, es: boolean): string[] {
  return (es && EXERCISE_ES[ex.key]?.defaultCuesEs) || ex.defaultCues;
}

/** Resolve a starter template's display name for the active locale. */
export function seedTemplateName(tpl: SeedTemplate, es: boolean): string {
  return (es && TEMPLATE_ES[tpl.key]?.nameEs) || tpl.name;
}

/** Resolve a starter template's notes for the active locale. */
export function seedTemplateNotes(tpl: SeedTemplate, es: boolean): string | undefined {
  return (es && TEMPLATE_ES[tpl.key]?.notesEs) || tpl.notes;
}

/** Resolve the cues for one template-exercise: localized per-template override
 *  → English per-template override → localized library defaults. */
export function seedTemplateExerciseCues(
  tplKey: string,
  se: SeedTemplateExercise,
  lib: SeedExercise | undefined,
  es: boolean,
): string[] | undefined {
  if (es) {
    const ov = TEMPLATE_CUES_ES[`${tplKey}:${se.key}`];
    if (ov) return ov;
  }
  if (se.cues) return se.cues;
  return lib ? seedExerciseCues(lib, es) : undefined;
}
