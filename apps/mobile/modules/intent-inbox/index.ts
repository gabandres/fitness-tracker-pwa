import { requireOptionalNativeModule } from 'expo';

/**
 * IntentInbox — what Live Activity buttons and Siri intents left for the app.
 *
 * The writer is `targets/_shared/IntentInbox.swift` (read its header for why
 * these actions are handed to JS instead of finished natively). This is the
 * reader: `take` removes and returns entries of the kinds asked for, `peek`
 * returns them without removing, and `subscribeIntentInbox` rings whenever a
 * writer appended — immediately when the intent ran in this app's process,
 * which a `LiveActivityIntent` always does.
 *
 * Optional native module, like every bridge here: absent in Expo Go, on web,
 * in iOS binaries older than the one that introduced it and in Android
 * binaries older than the S23-8 one (its Android half — a SharedPreferences
 * list written by `RestActionReceiver.kt`, `modules/intent-inbox/android` —
 * landed with the notification's lock-screen actions). Every function then
 * resolves to "nothing pending" and the subscription is a no-op.
 */

/** Every kind a writer can post. Keep in step with the `post(...)` calls in
 *  `targets/_shared/LiveActivityIntents.swift` and `AppActionIntents.swift`. */
export type IntentInboxKind = 'rest' | 'fastEnd' | 'fastStart' | 'fastStop' | 'weight';

export type IntentInboxAction =
  /** Rest timer +30 s (`endsAtMs` > 0) or Skip (`endsAtMs` === 0). */
  | { kind: 'rest'; atMs: number; endsAtMs: number }
  /** "End" on the fasting Live Activity. `startedAtMs` names the fast it ended. */
  | { kind: 'fastEnd'; atMs: number; startedAtMs: number; endedAtMs: number }
  /** Siri "Start fast". */
  | { kind: 'fastStart'; atMs: number }
  /** Siri "End fast". */
  | { kind: 'fastStop'; atMs: number }
  /** Siri "Log weight", in the unit the app displays. */
  | { kind: 'weight'; atMs: number; value?: number };

interface IntentInboxNativeModule {
  take(kinds: string[]): Promise<string>;
  peek(kinds: string[]): Promise<string>;
  /** S23-8 round 2b; absent from older binaries. Removes the entries of these
   *  kinds stamped with exactly these `atMs`. */
  remove?(kinds: string[], atMs: number[]): Promise<string>;
  addListener(event: 'onChange', listener: () => void): { remove(): void };
}

const native = requireOptionalNativeModule<IntentInboxNativeModule>('IntentInbox');

export const isIntentInboxAvailable = native != null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * The native JSON array → typed actions. Anything malformed is DROPPED rather
 * than guessed at: an entry with no usable instant cannot be safely applied to
 * a fast or a timer, and dropping one costs a tap, not a wrong write.
 *
 * Exported for `src/__tests__/` — the one piece with logic, testable without a
 * device.
 */
export function parseIntentInbox(raw: string): IntentInboxAction[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: IntentInboxAction[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const atMs = num(o.atMs);
    if (atMs == null || atMs <= 0) continue;
    switch (o.kind) {
      case 'rest': {
        const endsAtMs = num(o.endsAtMs);
        if (endsAtMs != null && endsAtMs >= 0) out.push({ kind: 'rest', atMs, endsAtMs });
        break;
      }
      case 'fastEnd': {
        const startedAtMs = num(o.startedAtMs);
        const endedAtMs = num(o.endedAtMs);
        if (startedAtMs != null && startedAtMs > 0 && endedAtMs != null && endedAtMs > 0) {
          out.push({ kind: 'fastEnd', atMs, startedAtMs, endedAtMs });
        }
        break;
      }
      case 'fastStart':
      case 'fastStop':
        out.push({ kind: o.kind, atMs });
        break;
      case 'weight': {
        const value = num(o.value);
        out.push(value != null && value > 0 ? { kind: 'weight', atMs, value } : { kind: 'weight', atMs });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Remove and return the pending actions of these kinds. Never rejects. */
export async function takeIntentInbox(kinds: readonly IntentInboxKind[]): Promise<IntentInboxAction[]> {
  try {
    const raw = await native?.take([...kinds]);
    return raw ? parseIntentInbox(raw) : [];
  } catch {
    return [];
  }
}

/** The pending actions of these kinds, left in place. Never rejects. */
export async function peekIntentInbox(kinds: readonly IntentInboxKind[]): Promise<IntentInboxAction[]> {
  try {
    const raw = await native?.peek([...kinds]);
    return raw ? parseIntentInbox(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Call `onChange` whenever a writer appends. Returns the unsubscribe.
 *
 * A doorbell only — it carries nothing. The caller drains with `take`, and must
 * ALSO drain on foreground and on mount, because a doorbell rung while the app
 * was suspended or not yet listening is simply lost.
 */
export function subscribeIntentInbox(onChange: () => void): () => void {
  try {
    const sub = native?.addListener('onChange', onChange);
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}

/**
 * "Done set" from the Lock Screen (S23-8, Hevy parity): the rest Live Activity's
 * button on iOS (`SetDoneIntent` in `LiveActivityIntents.swift`), the ongoing
 * notification's action on Android (`RestActionReceiver.kt`). Native ticked
 * nothing in the workout — it only moved the face on to the next set and
 * started the rest; this tells the app WHICH planned set the lifter confirmed,
 * with the numbers the face showed, so `ActiveSession` can tick that exact one
 * (`applySetInboxAction` in `src/lib/rest-timer-activity.ts`).
 *
 * Its own type, outside {@link IntentInboxAction}, for the reason
 * {@link WorkoutStartAction} gives: Today's reader narrows that union by
 * elimination. Train reads it together with `rest` through
 * {@link takeTrainInbox}, in ONE take, because the two interleave (Done set →
 * +30 s on the rest it started) and must be applied in the order they were
 * tapped.
 */
export interface SetDoneAction {
  kind: 'set';
  atMs: number;
  /** The session the face was armed for; `''` when it had no id yet. */
  sessionId: string;
  exerciseId: string;
  exerciseIndex: number;
  setIndex: number;
  /** What the face showed — logged as-is. Weight in the stored unit (lb). */
  weight?: number;
  reps?: number;
  durationSec?: number;
  /** When the rest the tap started ends, epoch ms; 0 = no rest followed. */
  endsAtMs: number;
  /** The set's identity beyond its index, as planned (absent from entries a
   *  build before round 2b wrote): kind, cluster group, the lift's set count. */
  setKind?: string;
  group?: number;
  setCount?: number;
}

export type TrainInboxAction = Extract<IntentInboxAction, { kind: 'rest' }> | SetDoneAction;

const nonNegInt = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 && Number.isInteger(n) ? n : null;
};

/** The `rest` and `set` entries of a native JSON array, in order; anything
 *  else (or malformed) dropped. */
export function parseTrainInbox(raw: string): TrainInboxAction[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: TrainInboxAction[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const atMs = num(o.atMs);
    if (atMs == null || atMs <= 0) continue;
    switch (o.kind) {
      case 'rest': {
        const endsAtMs = num(o.endsAtMs);
        if (endsAtMs != null && endsAtMs >= 0) out.push({ kind: 'rest', atMs, endsAtMs });
        break;
      }
      case 'set': {
        const exerciseIndex = nonNegInt(o.exerciseIndex);
        const setIndex = nonNegInt(o.setIndex);
        const endsAtMs = num(o.endsAtMs);
        if (exerciseIndex == null || setIndex == null || typeof o.exerciseId !== 'string' || !o.exerciseId) break;
        const weight = num(o.weight);
        const reps = num(o.reps);
        const durationSec = num(o.durationSec);
        const group = num(o.group);
        const setCount = nonNegInt(o.setCount);
        out.push({
          kind: 'set',
          atMs,
          sessionId: typeof o.sessionId === 'string' ? o.sessionId : '',
          exerciseId: o.exerciseId,
          exerciseIndex,
          setIndex,
          endsAtMs: endsAtMs != null && endsAtMs > 0 ? endsAtMs : 0,
          ...(weight != null && weight >= 0 ? { weight } : {}),
          ...(reps != null && reps >= 0 ? { reps } : {}),
          ...(durationSec != null && durationSec >= 0 ? { durationSec } : {}),
          ...(typeof o.setKind === 'string' && o.setKind ? { setKind: o.setKind } : {}),
          ...(group != null ? { group } : {}),
          ...(setCount != null ? { setCount } : {}),
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** True when this binary can remove entries by instant — the drain then
 *  reads, applies, and only then removes (review P2-11). */
export const canAckIntentInbox = typeof native?.remove === 'function';

/** The pending rest-timer and Done-set actions, left in place. Never rejects. */
export async function peekTrainInbox(): Promise<TrainInboxAction[]> {
  try {
    const raw = await native?.peek(['rest', 'set']);
    return raw ? parseTrainInbox(raw) : [];
  } catch {
    return [];
  }
}

/** Remove these entries (matched by kind and `atMs`) once applied. Never
 *  rejects; a no-op on a binary without `remove`. */
export async function ackTrainInbox(actions: readonly { kind: string; atMs: number }[]): Promise<void> {
  if (actions.length === 0 || typeof native?.remove !== 'function') return;
  try {
    await native.remove([...new Set(actions.map((a) => a.kind))], actions.map((a) => a.atMs));
  } catch {
    // Left in place: the next drain sees it again and the seam's own
    // once-per-entry guard (and "already ticked") keeps it from acting twice.
  }
}

/** Remove and return the pending rest-timer and Done-set actions, in the order
 *  they were tapped. Never rejects. */
export async function takeTrainInbox(): Promise<TrainInboxAction[]> {
  try {
    const raw = await native?.take(['rest', 'set']);
    return raw ? parseTrainInbox(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Siri "Start my next workout" (`StartNextWorkoutIntent`, posted as
 * `workoutStart`). Train's to apply — `src/hooks/useStartNextWorkoutIntent.ts`.
 *
 * Deliberately NOT a member of {@link IntentInboxAction}: Today's reader
 * (`useIntentInbox`) narrows that union by elimination and hands the remainder
 * to `planFastInboxAction`, so a sixth member there is a type error in a file
 * that has no business knowing about workouts. Its own kind, its own reader;
 * `take(['workoutStart'])` never touches the other five, and their readers
 * never take this one.
 */
export interface WorkoutStartAction {
  kind: 'workoutStart';
  atMs: number;
}

const WORKOUT_START = 'workoutStart';

/** The `workoutStart` entries of a native JSON array; anything else dropped. */
export function parseWorkoutStartActions(raw: string): WorkoutStartAction[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: WorkoutStartAction[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const atMs = num(o.atMs);
    if (atMs == null || atMs <= 0) continue;
    switch (o.kind) {
      case 'workoutStart':
        out.push({ kind: 'workoutStart', atMs });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Remove and return pending "start my next workout" actions. Never rejects. */
export async function takeWorkoutStartActions(): Promise<WorkoutStartAction[]> {
  try {
    const raw = await native?.take([WORKOUT_START]);
    return raw ? parseWorkoutStartActions(raw) : [];
  } catch {
    return [];
  }
}

/** Whether one is pending, left in place — for a router that must send the
 *  user to Train before Train (the consumer) has mounted. Never rejects. */
export async function peekWorkoutStartActions(): Promise<WorkoutStartAction[]> {
  try {
    const raw = await native?.peek([WORKOUT_START]);
    return raw ? parseWorkoutStartActions(raw) : [];
  } catch {
    return [];
  }
}
