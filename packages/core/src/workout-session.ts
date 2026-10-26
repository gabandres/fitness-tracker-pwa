import type { CardioBlock, CardioModality } from './cardio';
import { normalizeClusterGroups } from './cluster-groups';
import type { SessionExercise, SetKind, WorkoutSession, WorkoutSet } from './workout';

/**
 * Every structural edit an in-progress workout accepts, as data.
 *
 * This exists because the mobile Train hook exposed **22 mutation callbacks**
 * whose semantics differed only in prose. Three of them — `editSet`,
 * `applySetPatch` and `setSetKind` — produced set edits that were
 * indistinguishable at the call site (`(i, j, patch) => …`) while their doc
 * comments said one wrote locally and needed a later `commitActive`, one
 * persisted atomically, and one also re-derived cluster groups. Picking the
 * wrong one silently failed to save a user's set. `editSet` and `applySetPatch`
 * in fact computed the **identical** next state; they differed only in whether
 * the write happened, which is a caller's concern and not a domain one — so
 * here they are one `patchSet` action and the write policy rides beside it.
 *
 * Out-of-range indices are a no-op returning the session unchanged, which is
 * what the callbacks did (a `.map` that matches nothing, a `.filter` that
 * removes nothing). It is now stated rather than emergent.
 */
export type SessionAction =
  /** Append an exercise, already resolved against the catalog by the caller. */
  | { type: 'addExercise'; exercise: SessionExercise }
  | { type: 'removeExercise'; exerciseIndex: number }
  /** Run a superset as straight sets for THIS workout only: its members lose
   *  their group here, never on the template. The session then records what
   *  was done, so the superset report counts it as unpaired. */
  | { type: 'unpairGroup'; group: string }
  /** Undo `unpairGroup`: put each member's superset fields back, by exercise id. */
  | { type: 'restoreSuperset'; fields: Record<string, { supersetGroup?: string; pairPosition?: 1 | 2 | 3; transitionRestSec?: number; roundRestSec?: number }> }
  /** Append one empty working set. Does NOT re-derive cluster groups — a
   *  working set appended after a cluster starts a new plain row. */
  | { type: 'addSet'; exerciseIndex: number }
  /** Append a cluster — one activation plus two mini sets — and renumber. */
  | { type: 'addCluster'; exerciseIndex: number }
  /** Append a rest-pause / cluster-set block (ADR-0040) and renumber: one
   *  PRESCRIBED continuation, plus the activation to hang it off when the
   *  exercise has none yet. The template editor could scaffold this and the
   *  live session could not, so a lift PROGRAMMED as rest-pause had no way to
   *  gain another block mid-workout — the user had to pick `continuation`
   *  out of the set-kind list by hand and know that it was the right one. */
  | { type: 'addBlock'; exerciseIndex: number }
  /** Patch one set's fields. Does NOT re-derive cluster groups; use
   *  `setSetKind` for a change that can form or dissolve a cluster. */
  | { type: 'patchSet'; exerciseIndex: number; setIndex: number; patch: Partial<WorkoutSet> }
  /** Change a set's kind and renumber — a kind change can form or dissolve a
   *  cluster, which is the whole reason this is not a `patchSet`. */
  | { type: 'setSetKind'; exerciseIndex: number; setIndex: number; kind: SetKind }
  | { type: 'removeSet'; exerciseIndex: number; setIndex: number }
  // ── Cardio (ADR-0025) ──
  // Cardio edits live in the SAME reducer as set edits, deliberately. The whole
  // reason this module exists is that the alternative — a callback per edit on
  // the hook — produced three mutations that were indistinguishable at the call
  // site. Giving cardio its own set of callbacks would rebuild exactly that.
  /** Append one empty block of `modality`, ready to be filled in. */
  | { type: 'addCardio'; modality: CardioModality }
  /** Patch one block's fields, by index into `session.cardio`. */
  | { type: 'patchCardio'; blockIndex: number; patch: Partial<CardioBlock> }
  | { type: 'removeCardio'; blockIndex: number }
  // ── Travel mode (2026-10-26) ──
  /** "Different equipment — not comparable": out of the engine's reads and
   *  out of e1RM / PRs (`WorkoutSession.notComparable`). */
  | { type: 'setNotComparable'; value: boolean };

/** One empty working set — the row every "add set" produces. */
export function newWorkoutSet(kind: SetKind = 'working'): WorkoutSet {
  return { kind, done: false };
}

/**
 * A cluster: one activation set followed by two mini sets.
 *
 * The shape is the domain rule, not a UI choice — `normalizeClusterGroups`
 * opens a new group at each `activation` and closes it at the next non-`mini`,
 * so activation-then-minis is what makes the rows render and persist as one
 * cluster. Callers append it through `addCluster`, which renumbers.
 */
export function newCluster(): WorkoutSet[] {
  return [
    { kind: 'activation', done: false },
    { kind: 'mini', done: false },
    { kind: 'mini', done: false },
  ];
}

/**
 * One empty manual block — what "add cardio" produces.
 *
 * `durationSec: 0` is load-bearing rather than a placeholder: `isLoggedCardioBlock`
 * reads a positive duration as proof the work happened, so a block sits invisible
 * to every roll-up, and is dropped on finish, until the user actually fills it in.
 */
export function newCardioBlock(modality: CardioModality): CardioBlock {
  return { modality, durationSec: 0, source: 'manual' };
}

/** Replace one exercise by index, leaving the session untouched if the index
 *  is out of range. */
function mapExercise(
  session: WorkoutSession,
  index: number,
  fn: (ex: SessionExercise) => SessionExercise,
): WorkoutSession {
  if (index < 0 || index >= session.exercises.length) return session;
  return { ...session, exercises: session.exercises.map((ex, i) => (i === index ? fn(ex) : ex)) };
}

/** Replace one set by index within an exercise, leaving it untouched if the
 *  index is out of range. */
function mapSets(
  ex: SessionExercise,
  fn: (sets: WorkoutSet[]) => WorkoutSet[],
): SessionExercise {
  return { ...ex, sets: fn(ex.sets) };
}

/**
 * Apply one {@link SessionAction} to a workout session, purely.
 *
 * Returns a new session; never mutates. Returns the SAME session reference when
 * the action changes nothing (an out-of-range index), so a caller can skip a
 * write on identity if it wants to.
 *
 * Deliberately non-generic. Both frontends declare structurally identical
 * `WorkoutSession`/`SessionExercise`/`WorkoutSet` shapes — the PWA in
 * `models/workout.ts`, the Expo app in `lib/workout.ts`, both mirroring
 * `firestore.rules` — so structural typing carries each app's own value in and
 * its own type back out without a cast, exactly as it already does for
 * {@link fillMissingClusterLoads}. The types stay un-barreled (see index.ts);
 * this function and {@link SessionAction} are exported function-only.
 */
export function applySessionAction(
  session: WorkoutSession,
  action: SessionAction,
): WorkoutSession {
  switch (action.type) {
    case 'setNotComparable':
      if ((session.notComparable === true) === action.value) return session;
      return { ...session, notComparable: action.value };

    case 'addExercise':
      return { ...session, exercises: [...session.exercises, action.exercise] };

    case 'removeExercise':
      if (action.exerciseIndex < 0 || action.exerciseIndex >= session.exercises.length) {
        return session;
      }
      return {
        ...session,
        exercises: session.exercises.filter((_, i) => i !== action.exerciseIndex),
      };

    case 'unpairGroup': {
      if (!session.exercises.some((e) => e.supersetGroup === action.group)) return session;
      return {
        ...session,
        exercises: session.exercises.map((e) => {
          if (e.supersetGroup !== action.group) return e;
          const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...rest } = e;
          return rest;
        }),
      };
    }

    case 'restoreSuperset': {
      const ids = new Set(Object.keys(action.fields));
      if (!session.exercises.some((e) => ids.has(e.exerciseId))) return session;
      return {
        ...session,
        exercises: session.exercises.map((e) => (ids.has(e.exerciseId) ? { ...e, ...action.fields[e.exerciseId] } : e)),
      };
    }

    case 'addSet':
      return mapExercise(session, action.exerciseIndex, (ex) =>
        mapSets(ex, (sets) => [...sets, newWorkoutSet()]),
      );

    case 'addCluster':
      return mapExercise(session, action.exerciseIndex, (ex) =>
        mapSets(ex, (sets) => normalizeClusterGroups([...sets, ...newCluster()])),
      );

    case 'addBlock':
      return mapExercise(session, action.exerciseIndex, (ex) =>
        mapSets(ex, (sets) =>
          normalizeClusterGroups(
            sets.some((x) => x.kind === 'activation')
              ? [...sets, newWorkoutSet('continuation')]
              : [...sets, newWorkoutSet('activation'), newWorkoutSet('continuation')],
          ),
        ),
      );

    case 'patchSet':
      return mapExercise(session, action.exerciseIndex, (ex) =>
        mapSets(ex, (sets) =>
          sets.map((s, j) => (j === action.setIndex ? { ...s, ...action.patch } : s)),
        ),
      );

    case 'setSetKind':
      return mapExercise(session, action.exerciseIndex, (ex) =>
        mapSets(ex, (sets) =>
          normalizeClusterGroups(
            sets.map((s, j) => (j === action.setIndex ? { ...s, kind: action.kind } : s)),
          ),
        ),
      );

    case 'removeSet':
      return mapExercise(session, action.exerciseIndex, (ex) =>
        mapSets(ex, (sets) => normalizeClusterGroups(sets.filter((_, j) => j !== action.setIndex))),
      );

    case 'addCardio':
      return { ...session, cardio: [...(session.cardio ?? []), newCardioBlock(action.modality)] };

    case 'patchCardio': {
      const cardio = session.cardio ?? [];
      if (action.blockIndex < 0 || action.blockIndex >= cardio.length) return session;
      return {
        ...session,
        cardio: cardio.map((b, i) => (i === action.blockIndex ? { ...b, ...action.patch } : b)),
      };
    }

    case 'removeCardio': {
      const cardio = session.cardio ?? [];
      if (action.blockIndex < 0 || action.blockIndex >= cardio.length) return session;
      // An IMPORTED block remembers it was removed, or the next Health / Oura
      // import (matched by `sourceId`) puts it straight back.
      const sourceId = cardio[action.blockIndex].sourceId;
      return {
        ...session,
        cardio: cardio.filter((_, i) => i !== action.blockIndex),
        ...(sourceId ? { dismissedSourceIds: [...(session.dismissedSourceIds ?? []), sourceId] } : {}),
      };
    }
  }
}
