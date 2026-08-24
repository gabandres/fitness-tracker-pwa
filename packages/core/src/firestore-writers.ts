/**
 * Domain → Firestore doc serializers, single-sourced for BOTH frontends.
 *
 * The write-path twin of `./firestore-mappers` (doc → domain). Every stored
 * shape the Angular PWA and the Expo app both write is assembled here, so a
 * new field lands once and the two adapters cannot drift apart — or drift
 * past `firestore.rules`, which validates the shape they produce.
 *
 * Framework-free by design (ADR-0012): this module NEVER imports
 * `firebase/firestore`. The read path could match `Timestamp` structurally
 * ({@link TimestampLike}), but the write path has to *produce* SDK values —
 * a `Timestamp` and a `deleteField()` sentinel — so each edge injects them
 * through a {@link DocCodec}. That is the same injection `pruneUndefined`
 * already uses for its `isOpaque` predicate.
 *
 * Two conventions worth knowing before adding a writer:
 *
 * - **Create paths return a typed doc; patch paths return a loose record.**
 *   A patch field holds `number | <delete sentinel>`, which cannot be typed
 *   honestly without spreading an opaque generic through every call site, so
 *   patches are `Record<string, unknown>` on purpose.
 * - **`now` is a parameter, never a call to the SDK's `now()`.** Keeping the
 *   clock out of this module is what makes `createdAt` / `updatedAt`
 *   assertable in a unit test.
 *
 * What deliberately stayed in the adapters: every `addDoc` / `setDoc` /
 * `writeBatch` call, the `pruneUndefined` binding, the collection paths, and
 * `mergeExercises` (a rewrite rule over fetched docs, not a serializer).
 */
import { hasFormulaInputs } from './onboarding-seed';
import {
  type CustomFood,
  type LogEntry,
  type MealPreset,
  type MealType,
  type Measurement,
  type OnboardingV2Submission,
  clampCutPace,
} from './types';
import type { CardioBlock, PlannedCardioBlock } from './cardio';
import type {
  LogStyle,
  MuscleGroup,
  SessionExercise,
  SessionStatus,
  TemplateExercise,
} from './workout';

/**
 * The SDK values a doc needs that this module cannot construct. Each adapter
 * binds its own Firestore SDK once:
 * `{ timestamp: (d) => Timestamp.fromDate(d), remove: () => deleteField() }`.
 *
 * @typeParam TS the edge's timestamp type — `Timestamp` in both adapters,
 *   a plain stand-in under test.
 */
export interface DocCodec<TS = unknown> {
  /** Domain `Date` → the stored timestamp value. */
  timestamp(d: Date): TS;
  /** The "remove this field" sentinel, for patch writes only. */
  remove(): unknown;
}

/** Firestore's per-batch write cap is 500; chunk below it with headroom for
 *  the caller's own ops. Used by every bulk write in both adapters. */
export const BATCH_CHUNK = 450;

// ─── Daily logs ─────────────────────────────────────────────────

/** `users/{uid}/dailyLogs/{id}` — validated by `isValidLog` in firestore.rules.
 *  The legacy `liftCompleted` / `cardioCompleted` fields are absent by design:
 *  new docs never carry them, and {@link toLogPatch} deletes them on edit. */
export interface LogDoc<TS> {
  calories: number;
  timestamp: TS;
  weight?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  /** Only ever written as literal `true`; a false value is an absent key. */
  exerciseCompleted?: true;
  mealLabel?: string;
  mealType?: MealType;
}

/** Serialize a log for creation (`addLog`, and each row of `importLogs`).
 *  An entry with no timestamp is stamped `now` — the undo-restore path passes
 *  the original instant instead. */
export function toLogDoc<TS>(
  entry: LogEntry,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): LogDoc<TS> {
  return {
    calories: entry.calories,
    timestamp: codec.timestamp(entry.timestamp ?? now),
    ...(entry.weight != null ? { weight: entry.weight } : {}),
    ...(entry.protein != null ? { protein: entry.protein } : {}),
    ...(entry.carbs != null ? { carbs: entry.carbs } : {}),
    ...(entry.fat != null ? { fat: entry.fat } : {}),
    ...(entry.exerciseCompleted ? { exerciseCompleted: true as const } : {}),
    ...(entry.mealLabel ? { mealLabel: entry.mealLabel } : {}),
    ...(entry.mealType ? { mealType: entry.mealType } : {}),
  };
}

/**
 * Serialize a log edit. Unlike {@link toLogDoc} this names every optional
 * field explicitly — a cleared macro must be *removed* from the doc, not left
 * at its old value — and unconditionally removes the two legacy completion
 * fields, so every edit migrates the row forward.
 *
 * `weight` is the exception: absent means "leave whatever is stored", because
 * the weight is owned by the `dailyWeights` collection, not by this row.
 */
export function toLogPatch<TS>(entry: LogEntry, codec: DocCodec<TS>): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    calories: entry.calories,
    protein: entry.protein != null ? entry.protein : codec.remove(),
    carbs: entry.carbs != null ? entry.carbs : codec.remove(),
    fat: entry.fat != null ? entry.fat : codec.remove(),
    exerciseCompleted: entry.exerciseCompleted ? true : codec.remove(),
    liftCompleted: codec.remove(),
    cardioCompleted: codec.remove(),
    mealLabel: entry.mealLabel ? entry.mealLabel : codec.remove(),
    mealType: entry.mealType ? entry.mealType : codec.remove(),
  };
  if (entry.weight != null) patch['weight'] = entry.weight;
  if (entry.timestamp != null) patch['timestamp'] = codec.timestamp(entry.timestamp);
  return patch;
}

// ─── Profile: v2 2-question onboarding ──────────────────────────

/**
 * `users/{uid}` patch for the 2-question onboarding submission.
 *
 * Lives here because both adapters wrote this patch by hand, and they drifted:
 * neither cleared `targetsRefinedAt`. `saveRefinedTargets` deletes the manual
 * heuristic targets and stamps that field to hand control to formula-mode TDEE
 * — so re-running onboarding afterwards restored a manual target onto a profile
 * still marked "refined". Manual outranks formula in the target chain
 * (see `targets.ts`), so that user was pinned to a heuristic number derived
 * from a pace they had already replaced, with no way back except refining
 * again. Clearing the stamp is still correct: it re-shows the Refine Targets
 * prompt card (the stamp is that card's latch), and a user who just restated
 * their goal should be invited to refine into a pace that matches it.
 *
 * **The invariant that used to justify it is GONE as of 2026-08-21.** It read:
 *
 *   `targetsRefinedAt` present  ⟺  manual targets absent
 *
 * and it was enforced by `saveRefinedTargets` DELETING the manual values —
 * which also destroyed any number the user had chosen on purpose, with no way
 * back except re-running onboarding. `targetMode` replaces it: the mode alone
 * decides whether the manual values are honoured, so Refine can set `'auto'`
 * and leave them stored, and switching back to `'custom'` restores them
 * intact. `targetsRefinedAt` now means only "the Refine card has been filled".
 */
export function toOnboardingV2Patch<TS>(
  submission: OnboardingV2Submission,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): Record<string, unknown> {
  const stamp = codec.timestamp(now);
  const hasGoalWeight = submission.targetWeightLbs != null;
  // The Mifflin-St Jeor set, all-or-nothing. See OnboardingV2Submission: the
  // rules validate these as a group, `toProfileFields` needs the whole set,
  // and the steps that collect them are skippable — so half a set is a state
  // nothing downstream can represent. `hasFormulaInputs` also range-checks,
  // which matters here because this is the last gate before a write the server
  // would reject outright.
  const refined =
    hasFormulaInputs(submission) && submission.targetPaceLbsPerWeek != null
      ? {
          sex: submission.sex,
          heightIn: submission.heightIn,
          age: submission.age,
          activityLevel: submission.activityLevel,
          targetPaceLbsPerWeek: clampCutPace(submission.targetPaceLbsPerWeek),
        }
      : null;
  return {
    ...(refined ?? {}),
    goalDirection: submission.goalDirection,
    manualCaloriesTarget: submission.manualCaloriesTarget,
    manualProteinTarget: submission.manualProteinTarget,
    // Written on EVERY onboarding save, including the default 'auto', so a
    // user who re-runs onboarding and accepts the computed numbers is put
    // back on automatic rather than inheriting a stale 'custom' from a
    // previous run. An omitted mode would leave the old value in place.
    targetMode: submission.targetMode ?? 'auto',
    onboardingV2CompletedAt: stamp,
    // Mark the profile complete so the v1 gate doesn't re-trigger v1
    // onboarding for users who came in through the v2 path.
    profileCompleted: true,
    lastSeenAt: stamp,
    // Goal weight lives in TWO legacy fields (targetWeightLbs from onboarding,
    // goalWeightLbs read by the goal-progress bar). Keep them in sync, and
    // CLEAR both on "maintain" — otherwise a stale goalWeightLbs shadows the
    // new goal forever (the "redo onboarding didn't update it" bug).
    targetWeightLbs: hasGoalWeight ? submission.targetWeightLbs : codec.remove(),
    goalWeightLbs: hasGoalWeight ? submission.targetWeightLbs : codec.remove(),
    // See the doc comment: this is the field whose absence was the bug.
    //
    // Since F1/F2 it is CONDITIONAL. `targetsRefinedAt` means "the Refine card
    // has been filled" and is the latch that hides the Refine-targets prompt.
    // An onboarding run that collected sex/height/age/activity has collected
    // exactly what that card asks for, so clearing the stamp there would send
    // the user to a screen with nothing left to tell it. A run that SKIPPED
    // those steps still clears it — that user has genuinely not answered, and
    // the prompt is how they find out they can.
    targetsRefinedAt: refined ? stamp : codec.remove(),
  };
}

// ─── Meal presets ───────────────────────────────────────────────

/** `users/{uid}/presets/{id}`. No dates and no sentinels, so no codec. */
export interface PresetDoc {
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export function toPresetDoc(preset: Omit<MealPreset, 'id'>): PresetDoc {
  return {
    name: preset.name,
    calories: preset.calories,
    ...(preset.protein != null ? { protein: preset.protein } : {}),
    ...(preset.carbs != null ? { carbs: preset.carbs } : {}),
    ...(preset.fat != null ? { fat: preset.fat } : {}),
  };
}

// ─── Custom foods (My Foods library, ADR-0013) ──────────────────

/** `users/{uid}/customFoods/{id}` — `isValidCustomFood` in firestore.rules.
 *  Barcode-sourced foods are upserted at the barcode doc id (the adapter's
 *  concern); the doc shape is identical either way. */
export interface CustomFoodDoc<TS> {
  name: string;
  servingSize: number;
  servingUnit: CustomFood['servingUnit'];
  calories: number;
  source: CustomFood['source'];
  createdAt: TS;
  brand?: string;
  barcode?: string;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export function toCustomFoodDoc<TS>(
  food: Omit<CustomFood, 'id'>,
  codec: DocCodec<TS>,
): CustomFoodDoc<TS> {
  return {
    name: food.name,
    servingSize: food.servingSize,
    servingUnit: food.servingUnit,
    calories: food.calories,
    source: food.source,
    createdAt: codec.timestamp(food.createdAt),
    ...(food.brand != null ? { brand: food.brand } : {}),
    ...(food.barcode != null ? { barcode: food.barcode } : {}),
    ...(food.protein != null ? { protein: food.protein } : {}),
    ...(food.carbs != null ? { carbs: food.carbs } : {}),
    ...(food.fat != null ? { fat: food.fat } : {}),
  };
}

// ─── Body measurements ──────────────────────────────────────────

/** What the user submits: the row's date is the write instant, not an input. */
export type MeasurementInput = Omit<Measurement, 'id' | 'date'>;

/** `users/{uid}/measurements/{id}` — inches. */
export interface MeasurementDoc<TS> {
  timestamp: TS;
  waist?: number;
  chest?: number;
  bicep?: number;
  hip?: number;
  neck?: number;
}

export function toMeasurementDoc<TS>(
  entry: MeasurementInput,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): MeasurementDoc<TS> {
  return {
    timestamp: codec.timestamp(now),
    ...(entry.waist != null ? { waist: entry.waist } : {}),
    ...(entry.chest != null ? { chest: entry.chest } : {}),
    ...(entry.bicep != null ? { bicep: entry.bicep } : {}),
    ...(entry.hip != null ? { hip: entry.hip } : {}),
    ...(entry.neck != null ? { neck: entry.neck } : {}),
  };
}

/**
 * Serialize a measurement edit: set what was provided, remove what the user
 * cleared. `timestamp` is deliberately absent so the row keeps its original
 * date.
 *
 * Only the PWA edits measurements today; this lives here anyway, beside
 * {@link toMeasurementDoc}, because the two share a field list and splitting
 * them is exactly how a create path and an update path drift apart.
 */
export function toMeasurementPatch<TS>(
  entry: MeasurementInput,
  codec: DocCodec<TS>,
): Record<string, unknown> {
  return {
    waist: entry.waist != null ? entry.waist : codec.remove(),
    chest: entry.chest != null ? entry.chest : codec.remove(),
    bicep: entry.bicep != null ? entry.bicep : codec.remove(),
    hip: entry.hip != null ? entry.hip : codec.remove(),
    neck: entry.neck != null ? entry.neck : codec.remove(),
  };
}

// ─── Workout: exercise catalog ──────────────────────────────────
// The three workout drafts are declared structurally here rather than as
// `Omit<Exercise, …>` of the shared read-model: each frontend keeps its own
// richer copy of these types (see ./workout's header), and the array fields
// are optional here so a draft from either app satisfies the input.

export interface ExerciseDraftInput {
  name: string;
  muscles?: MuscleGroup[];
  defaultCues?: string[];
  logStyle?: LogStyle;
  seedKey?: string;
}

/** `users/{uid}/exercises/{id}` — `isValidExercise` in firestore.rules, which
 *  requires both arrays to be present (hence the `?? []` defaults). */
export interface ExerciseDoc<TS> {
  name: string;
  muscles: MuscleGroup[];
  defaultCues: string[];
  createdAt: TS;
  logStyle?: LogStyle;
  seedKey?: string;
}

export function toExerciseDoc<TS>(
  draft: ExerciseDraftInput,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): ExerciseDoc<TS> {
  return {
    name: draft.name,
    muscles: draft.muscles ?? [],
    defaultCues: draft.defaultCues ?? [],
    createdAt: codec.timestamp(now),
    ...(draft.logStyle !== undefined ? { logStyle: draft.logStyle } : {}),
    ...(draft.seedKey !== undefined ? { seedKey: draft.seedKey } : {}),
  };
}

// ─── Workout: cardio blocks (ADR-0025) ──────────────────────────

/**
 * Serialize cardio blocks for storage.
 *
 * The one thing this exists for: `CardioBlock.startedAt` is a `Date`, and it
 * is the only Date this codebase stores *inside an array element*. Every other
 * date on a workout doc is a top-level field that the writers pass through
 * `codec.timestamp` by hand, so a nested one would otherwise reach Firestore
 * as a raw `Date` on one adapter and a `Timestamp` on the other — the two
 * apps writing different types into the same field, which is precisely what
 * this module exists to prevent.
 *
 * `startedAt` is genuinely optional (a hand-logged block need not carry one),
 * so it is omitted rather than defaulted: stamping "now" would invent a start
 * time the user never gave, and `firestore.rules` cannot catch it because it
 * cannot iterate a list.
 */
function cardioFields<TS>(blocks: CardioBlock[], codec: DocCodec<TS>): Record<string, unknown>[] {
  return blocks.map((b) => {
    const { startedAt, ...rest } = b;
    return startedAt === undefined ? { ...rest } : { ...rest, startedAt: codec.timestamp(startedAt) };
  });
}

// ─── Workout: templates ─────────────────────────────────────────

export interface TemplateDraftInput {
  name: string;
  notes?: string;
  restMiniSec?: number;
  restClusterSec?: number;
  exercises?: TemplateExercise[];
  /** Prescribed cardio (ADR-0025). Carries no Date, so unlike
   *  {@link CardioBlock} it needs no codec pass. */
  cardioBlocks?: PlannedCardioBlock[];
  seedKey?: string;
}

/** `users/{uid}/workoutTemplates/{id}` — `isValidWorkoutTemplate`. */
export interface TemplateDoc<TS> {
  name: string;
  exercises: TemplateExercise[];
  createdAt: TS;
  updatedAt: TS;
  notes?: string;
  restMiniSec?: number;
  restClusterSec?: number;
  cardioBlocks?: PlannedCardioBlock[];
  seedKey?: string;
}

function templateFields(draft: TemplateDraftInput) {
  return {
    name: draft.name,
    exercises: draft.exercises ?? [],
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
    ...(draft.restMiniSec !== undefined ? { restMiniSec: draft.restMiniSec } : {}),
    ...(draft.restClusterSec !== undefined ? { restClusterSec: draft.restClusterSec } : {}),
    // Absent stays absent: a template that never prescribed cardio must not
    // gain an empty array, or every pre-ADR-0025 template rewrites on save.
    ...(draft.cardioBlocks !== undefined ? { cardioBlocks: draft.cardioBlocks } : {}),
    ...(draft.seedKey !== undefined ? { seedKey: draft.seedKey } : {}),
  };
}

export function toTemplateDoc<TS>(
  draft: TemplateDraftInput,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): TemplateDoc<TS> {
  const stamp = codec.timestamp(now);
  return { ...templateFields(draft), createdAt: stamp, updatedAt: stamp };
}

/**
 * Serialize a template edit. Same fields minus `createdAt`, which the write
 * must leave alone — the adapters apply this with `{ merge: true }`, and a
 * merge that carried `createdAt` would reset the row's age.
 *
 * Note this is a full overwrite of the mutable fields, not a sparse patch: a
 * merged `exercises` array would union with the stored one rather than
 * replace it, so every edit rewrites the whole list.
 */
export function toTemplatePatch<TS>(
  draft: TemplateDraftInput,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): Record<string, unknown> {
  return { ...templateFields(draft), updatedAt: codec.timestamp(now) };
}

// ─── Workout: sessions ──────────────────────────────────────────

export interface SessionDraftInput {
  status: SessionStatus;
  date: Date;
  templateId?: string;
  templateName?: string;
  bodyweight?: number;
  sleepHours?: number;
  durationMin?: number;
  exercises?: SessionExercise[];
  /** Logged cardio (ADR-0025). Blocks carry a Date, so they are serialized
   *  through {@link cardioFields} rather than passed straight down. */
  cardio?: CardioBlock[];
  nextNotes?: string;
}

/** `users/{uid}/workoutSessions/{id}` — `isValidWorkoutSession`. The domain
 *  calls it `date`; the stored field is `timestamp`, matching every other
 *  time-ordered collection. */
export interface SessionDoc<TS> {
  status: SessionStatus;
  timestamp: TS;
  exercises: SessionExercise[];
  createdAt: TS;
  updatedAt: TS;
  templateId?: string;
  templateName?: string;
  bodyweight?: number;
  sleepHours?: number;
  durationMin?: number;
  nextNotes?: string;
}

export function toSessionDoc<TS>(
  draft: SessionDraftInput,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): SessionDoc<TS> {
  const stamp = codec.timestamp(now);
  return {
    status: draft.status,
    timestamp: codec.timestamp(draft.date),
    exercises: draft.exercises ?? [],
    createdAt: stamp,
    updatedAt: stamp,
    ...(draft.templateId !== undefined ? { templateId: draft.templateId } : {}),
    ...(draft.templateName !== undefined ? { templateName: draft.templateName } : {}),
    ...(draft.bodyweight !== undefined ? { bodyweight: draft.bodyweight } : {}),
    ...(draft.sleepHours !== undefined ? { sleepHours: draft.sleepHours } : {}),
    ...(draft.durationMin !== undefined ? { durationMin: draft.durationMin } : {}),
    // Absent stays absent — a strength-only session must not gain an empty
    // array it never had, which would rewrite every session doc on next save.
    ...(draft.cardio !== undefined ? { cardio: cardioFields(draft.cardio, codec) } : {}),
    ...(draft.nextNotes !== undefined ? { nextNotes: draft.nextNotes } : {}),
  };
}

/**
 * Serialize a live-session update. Genuinely sparse — the logger writes one
 * field at a time as the user works — so a key absent from `patch` is left
 * untouched rather than removed. `updatedAt` always advances.
 */
export function toSessionPatch<TS>(
  patch: Partial<SessionDraftInput>,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): Record<string, unknown> {
  const data: Record<string, unknown> = { updatedAt: codec.timestamp(now) };
  if (patch.status !== undefined) data['status'] = patch.status;
  if (patch.templateId !== undefined) data['templateId'] = patch.templateId;
  if (patch.templateName !== undefined) data['templateName'] = patch.templateName;
  if (patch.date !== undefined) data['timestamp'] = codec.timestamp(patch.date);
  if (patch.bodyweight !== undefined) data['bodyweight'] = patch.bodyweight;
  if (patch.sleepHours !== undefined) data['sleepHours'] = patch.sleepHours;
  if (patch.durationMin !== undefined) data['durationMin'] = patch.durationMin;
  if (patch.exercises !== undefined) data['exercises'] = patch.exercises;
  // Like `exercises`, this is a whole-array overwrite rather than a merge:
  // Firestore unions arrays on merge, so a sparse patch would append blocks
  // instead of replacing them and a deleted block would come back.
  if (patch.cardio !== undefined) data['cardio'] = cardioFields(patch.cardio, codec);
  if (patch.nextNotes !== undefined) data['nextNotes'] = patch.nextNotes;
  return data;
}
