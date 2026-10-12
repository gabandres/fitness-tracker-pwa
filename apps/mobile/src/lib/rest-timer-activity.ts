import { Platform } from 'react-native';
import {
  CLUSTER_ESTIMATE_SEC,
  DEFAULT_TRANSITION_REST_SEC,
  countToAccept,
  exerciseHistory,
  formatLoad,
  previousSets,
  previousToAccept,
  restAfterSetInFlow,
  roundRestWithFloor,
  setRowLabels,
  supersetFlow,
  type UnitSystem,
} from '@macrolog/core';
import {
  endAllRestActivities,
  endRestActivity,
  getRestActivityStatus,
  isRestActivityWorkoutAvailable,
  startRestActivity,
  syncRestActivityWorkout,
  updateRestActivity,
} from '../../modules/rest-timer-activity';
import {
  endRestNotification,
  getRestNotificationStatus,
  isRestNotificationWorkoutAvailable,
  startRestNotification,
  syncRestNotificationWorkout,
  updateRestNotification,
} from '../../modules/rest-timer-notification';
import type { IntentInboxAction, SetDoneAction } from '../../modules/intent-inbox';
import { pluralKeyFor } from '@/i18n/grammar';
import { DEFAULT_LOCALE, LOCALE_DEFS, normalizeLocale } from '@/i18n/registry';
import { clearLockScreenAccepted } from '@/lib/lock-screen-ticks';
import { DEFAULT_LOG_STYLE, type SessionExercise, type WorkoutSession, type WorkoutSet } from '@/lib/workout';

/**
 * The rest countdown on the lock screen and in the Dynamic Island (Train review
 * item 20).
 *
 * A lifter locks the phone between sets. The local "rest over" notification
 * (`useRestTimer`) covers the END of a rest; what it cannot show is the time
 * LEFT, which is what Strong and Hevy put on the lock screen through a Live
 * Activity. On iOS that is `modules/rest-timer-activity` →
 * `targets/_shared/RestActivity.swift` → `targets/widget/RestActivityWidget.swift`.
 * Android has no Live Activity; there the same calls drive an ongoing
 * notification whose header counts down (`modules/rest-timer-notification`,
 * vc 48+). Each module is absent on the other platform, in Expo Go, on web and
 * in binaries older than the one that introduced it (an OTA can still reach
 * them), and an absent module is a silent no-op — so every call goes to both.
 *
 * Called from the right places in `ActiveSession`:
 *
 * - {@link start} when a rest begins (a set is ticked),
 * - {@link update} when it moves (+30 s, −30 s in the app),
 * - {@link end} when it stops (skipped, run out, or the workout closes),
 *
 * and {@link reconcileWithNative} once on mount, for an Activity that outlived
 * a JS restart.
 *
 * `endsAt` is an absolute epoch-ms deadline rather than a duration on purpose:
 * a Live Activity renders a system timer counting down to a DATE, so it keeps
 * ticking while the JS runtime is suspended — the same reason `useRestTimer`
 * redraws from a deadline instead of counting ticks.
 *
 * ## The other direction: the Lock Screen's own buttons
 *
 * "+30 s" and "Skip" on the Activity run natively (`LiveActivityIntents.swift`)
 * and move the Activity and the pending notification themselves. What they
 * cannot move is the in-app rest bar, so each leaves a `rest` entry in the
 * intent inbox. {@link applyRestInboxAction} turns that entry into what
 * `ActiveSession` should do to its own timer; `ActiveSession` drains on mount,
 * on foreground and on the inbox's doorbell. See `IntentInbox.swift` for the
 * whole hand-off.
 *
 * ## The whole workout on the Lock Screen (S23-8, Hevy parity)
 *
 * On a binary whose module has `workout` (checked, never assumed — an OTA
 * reaches older binaries), `ActiveSession` also arms the seam with the session
 * and its next planned sets ({@link armWorkout}, {@link planUpcomingSets}), and
 * from then on every start / update / end goes to native as ONE picture
 * ({@link syncNative}): the rest if one is running, and the queue. The face
 * then stays up for the whole workout — a countdown during a rest, "Up next ·
 * Bench · Set 3 of 4 · 80 kg × 8" with **Done set** between rests — and is
 * removed only by {@link endWorkout}. Done set is handled natively (the queue
 * advances, the set's rest starts, a "rest over" is scheduled) and leaves a
 * `set` entry that {@link applySetInboxAction} turns into the exact tick.
 * Android's notification gains −30 s / +30 s / Skip the same way, through the
 * same inbox (`RestNotifier.kt`). Without the function every path below is the
 * vc 48 / build 70 behaviour, unchanged.
 *
 * Fire-and-forget throughout: a rest timer that throws is worse than one that
 * is only on screen, and the module's functions never reject.
 */

export interface RestActivityState {
  /** When the rest is over, epoch ms. */
  endsAt: number;
  /** The exercise the rest follows — the Live Activity's title. */
  exerciseName: string;
  /** When this rest began, epoch ms. Lock Screen actions older than this
   *  belong to an earlier rest and are ignored. */
  startedAt: number;
  /** The profile locale the Activity was armed with. */
  locale: string;
}

let current: RestActivityState | null = null;
/** The last exercise a rest followed, kept after `end` — what a `resume`
 *  re-arms the Activity with (see `applyRestInboxAction`). */
let lastExercise: { name: string; locale: string } | null = null;

/** The workout armed by `ActiveSession` (S23-8); null outside one. */
let workout: { sessionId: string; locale: string; upcoming: PlannedSet[] } | null = null;
/** The last picture sent to native, for the dedupe in {@link syncNative}. */
let lastSent: string | null = null;
/** Syncs wait until this instant while {@link reconcileWithNative} reads
 *  native (bounded, so a status call that never answers cannot mute them). */
let holdSyncUntil = 0;
const SYNC_HOLD_MS = 2000;
/** A picture handed to native and not yet answered — not re-sent meanwhile. */
let inFlight: string | null = null;
/** Monotonic across JS reloads (it starts from the clock), so native can drop
 *  a picture that arrives — or is applied — after a newer one (review P2-10). */
let seq = 0;
/** The "Rest over" text for the running rest ("Next: A2 · Leg Curls") — what
 *  native's own alert says on Android, where it owns the buzz (P1-2). */
let currentAlertBody: string | undefined;
/** Inbox entries already applied this JS session (`kind:atMs`): the drain
 *  peeks, applies, then removes (review P2-11), so a doorbell drain and a
 *  foreground drain can both see one entry — it must act once. */
const appliedInbox = new Set<string>();
/** Lock Screen rest actions tapped in this window were taken on a rest that
 *  belonged to a REJECTED "Done set" (review P2-7): from that tap until the app
 *  re-sent its own picture. They must not revive or retarget anything. */
let ignoreRestActions: { from: number; to: number } | null = null;

/** The Android notification's copy, in the profile's locale. Pure — tested. */
export function restNotificationCopy(
  exerciseName: string,
  locale: string,
): { title: string; body: string; channel: string } {
  const dict = LOCALE_DEFS[normalizeLocale(locale) ?? DEFAULT_LOCALE].dict;
  return {
    title: dict['train.restOngoing.title'].replace('{name}', exerciseName),
    body: dict['train.restOngoing.body'],
    channel: dict['train.restOngoing.channel'],
  };
}

/** What native reports is showing: the Live Activity on iOS, the ongoing
 *  notification on Android. */
function nativeStatus(): Promise<string> {
  return Platform.OS === 'android' ? getRestNotificationStatus() : getRestActivityStatus();
}

/** Start (or retarget) the lock-screen countdown. `alertBody` is the "Rest
 *  over" text when it is not the default (a superset's next station). */
export function start(endsAt: number, exerciseName: string, locale = 'en', now = Date.now(), alertBody?: string): void {
  current = { endsAt, exerciseName, startedAt: now, locale };
  currentAlertBody = alertBody;
  lastExercise = { name: exerciseName, locale };
  if (inWorkoutMode()) {
    syncNative();
    return;
  }
  void startRestActivity(endsAt, exerciseName, locale);
  if (Platform.OS === 'android') {
    const copy = restNotificationCopy(exerciseName, locale);
    void startRestNotification(endsAt, copy.title, copy.body, copy.channel);
  }
}

/** Move the deadline of the countdown already showing. No-op when none is. */
export function update(endsAt: number): void {
  if (!current) return;
  current = { ...current, endsAt };
  if (inWorkoutMode()) {
    syncNative();
    return;
  }
  void updateRestActivity(endsAt);
  void updateRestNotification(endsAt);
}

/**
 * Remove the countdown. Idempotent.
 *
 * ALWAYS reaches native, even when this seam believes nothing is showing.
 * `current` is module state and does not survive an iOS memory kill or a
 * reload while the phone is locked — the Activity does. Returning early on a
 * null `current` left a stale "Rest over" face on the Lock Screen through the
 * Finish and every later rest, until iOS's 8-hour ceiling (Train re-score
 * bug 2). Native `end` with nothing to end is a no-op, so the call is cheap.
 *
 * Inside an armed workout the face does not go: it turns to the next set
 * (S23-8). Forced past the dedupe for the same reason as above.
 */
export function end(): void {
  current = null;
  if (inWorkoutMode()) {
    syncNative(true);
    return;
  }
  void endRestActivity();
  void endRestNotification();
}

/** What {@link reconcileWithNative} found on the Lock Screen. */
export type RestReconcileOutcome = { type: 'restore'; endsAt: number; seconds: number } | null;

/**
 * Re-adopt a rest the Lock Screen is still counting after the JS runtime
 * restarted (Train re-score bug 2).
 *
 * The Activity outlives the runtime; this seam's memory does not. So on mount
 * `ActiveSession` asks native what is showing:
 *
 * - `running:<ms>` with time left → adopt it as `current` (so +30 s / Skip on
 *   the Lock Screen apply again, and Finish ends it) and tell the caller to
 *   put the rest bar back, for the seconds that are really left;
 * - `running:<ms>` already past → a stale "Rest over" face nobody will clear;
 *   end it;
 * - anything else, or a rest this seam already knows about → nothing.
 *
 * `exerciseName` is the Activity's title if a later `resume` has to re-arm it;
 * native does not report the one it is showing. `now` is injectable for tests.
 */
export async function reconcileWithNative(
  exerciseName: string,
  locale = 'en',
  now = Date.now(),
): Promise<RestReconcileOutcome> {
  if (current) return null;
  // Hold workout syncs until native has been read: the session arms the seam
  // on the same mount, and a "no rest" picture sent first would end the very
  // countdown this is about to adopt.
  holdSyncUntil = Date.now() + SYNC_HOLD_MS;
  const out = await readNativeRest(exerciseName, locale, now);
  holdSyncUntil = 0;
  syncNative(true);
  return out;
}

async function readNativeRest(exerciseName: string, locale: string, now: number): Promise<RestReconcileOutcome> {
  const status = await nativeStatus();
  const m = /^running:(\d+(?:\.\d+)?)$/.exec(status);
  if (!m) return null;
  const endsAt = Math.round(Number(m[1]));
  // A start that raced this read already owns the Lock Screen.
  if (current) return null;
  const seconds = Math.round((endsAt - now) / 1000);
  if (seconds <= 0) {
    // In a workout the sync that follows turns the face to the next set.
    if (!inWorkoutMode()) {
      void endRestActivity();
      void endRestNotification();
    }
    return null;
  }
  current = { endsAt, exerciseName, startedAt: now, locale };
  lastExercise = { name: exerciseName, locale };
  return { type: 'restore', endsAt, seconds };
}

/**
 * End rest activities nobody owns. `current` lives in JS memory, so after an
 * iOS memory kill or a reload mid-rest the Lock Screen kept a countdown the app
 * no longer knew about — and `end()` returns early with nothing to end.
 *
 * Called once from the tab layout on mount, which is BEFORE any live session
 * can have restored its rest: Train is a lazy tab, and `ActiveSession` mounts
 * only after `useTrain`'s journal read. So `current` is always null here after
 * a cold start, and ending on that alone killed every live rest before
 * {@link reconcileWithNative} could adopt it — the restore path never ran
 * (Train re-score 3, bug 1). It now asks native first and leaves a deadline
 * still in the FUTURE for the session to reclaim; a past one is a stale
 * "Rest over" face and goes. A kept rest is looked at again just after its
 * deadline (or on the first foreground past it — JS timers wait out a
 * suspension), so one that no session reclaimed does not leave its "Rest over"
 * face up until iOS's eight-hour ceiling.
 *
 * `now` is injectable for tests. Resolves once the decision is made; never
 * rejects (the module's calls never do).
 */
export async function sweepOrphans(now = Date.now()): Promise<void> {
  if (current || inWorkoutMode()) return;
  const status = await nativeStatus();
  // A rest started — or a workout armed — while the status was being read
  // owns the Lock Screen.
  if (current || inWorkoutMode()) return;
  const m = /^running:(\d+(?:\.\d+)?)$/.exec(status);
  const endsAt = m ? Math.round(Number(m[1])) : 0;
  // An `idle` face is a workout between sets (S23-8). The app may have opened
  // on Today, or been woken in the background by the Lock Screen's own Done
  // set — the session reclaims it when Train mounts (review P2-4). Looked at
  // again later; only a face still unclaimed then goes.
  if (status === 'idle') {
    if (recheck) clearTimeout(recheck);
    recheck = setTimeout(() => {
      recheck = null;
      if (!current && !inWorkoutMode()) void endUnclaimedIdle();
    }, SWEEP_IDLE_GRACE_MS);
    return;
  }
  if (endsAt > now) {
    if (recheck) clearTimeout(recheck);
    recheck = setTimeout(() => {
      recheck = null;
      // Reclaimed (a restored session set `current`) or replaced: not ours.
      if (!current) void sweepOrphans();
    }, endsAt - now + SWEEP_RECHECK_GRACE_MS);
    return;
  }
  void endAllRestActivities();
  void endRestNotification();
}

/** How long past a kept rest's deadline the sweep looks again. */
const SWEEP_RECHECK_GRACE_MS = 2000;
/** How long an unclaimed `idle` workout face is kept after a cold start. */
export const SWEEP_IDLE_GRACE_MS = 30 * 60 * 1000;

async function endUnclaimedIdle(): Promise<void> {
  if ((await nativeStatus()) !== 'idle' || current || inWorkoutMode()) return;
  void endAllRestActivities();
  void endRestNotification();
}
let recheck: ReturnType<typeof setTimeout> | null = null;

/** What the seam believes is on the lock screen — for tests. */
export function __currentRestActivity(): RestActivityState | null {
  return current;
}

/** How old a Lock Screen action may be and still revive a rest the app had
 *  already closed. Past this it belongs to some earlier workout. */
export const REST_ACTION_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * What the in-app timer should do about one Lock Screen action.
 *
 * - `skip` — the lifter tapped Skip: stop the rest bar silently (a skip never
 *   buzzes or announces, same as the in-app skip).
 * - `retarget` — +30 s on a rest the app is still showing: run the bar to the
 *   new deadline.
 * - `resume` — +30 s on a rest the app had ALREADY closed. This is the race
 *   where the phone sat locked past the deadline, the lifter tapped +30 s on
 *   the "Rest over" face, and the app's own tick ended the rest (and the
 *   Activity) on unlock a beat before this drain ran. The lifter asked for 30 s
 *   more; `ActiveSession` restarts the bar AND re-arms the Activity.
 * - `null` — nothing to do: an action from an earlier rest, a skip with no rest
 *   running, or a deadline already in the past.
 *
 * Updates this seam's own `current` to match, WITHOUT calling native — the
 * button already changed the Activity, and echoing it back would be a second
 * update racing the first.
 *
 * Pure apart from that bookkeeping; `now` is injectable for tests.
 */
export type RestInboxOutcome =
  | { type: 'skip' }
  | { type: 'retarget'; endsAt: number; seconds: number }
  | { type: 'resume'; endsAt: number; seconds: number; exerciseName: string; locale: string }
  | null;

export function applyRestInboxAction(
  action: Extract<IntentInboxAction, { kind: 'rest' }>,
  now = Date.now(),
): RestInboxOutcome {
  // Native moved the face: whatever was last sent is no longer what it shows.
  lastSent = null;
  if (!firstApplication(action)) return null;
  if (ignoreRestActions && action.atMs >= ignoreRestActions.from && action.atMs <= ignoreRestActions.to) {
    // On the rest of a Done set the app refused — already put right natively.
    syncNative(true);
    return null;
  }
  if (action.endsAtMs === 0) {
    if (!current || action.atMs < current.startedAt) return null;
    current = null;
    return { type: 'skip' };
  }

  const seconds = Math.round((action.endsAtMs - now) / 1000);
  if (seconds <= 0) return null;

  if (current) {
    if (action.atMs < current.startedAt) return null;
    current = { ...current, endsAt: action.endsAtMs };
    return { type: 'retarget', endsAt: action.endsAtMs, seconds };
  }

  if (now - action.atMs > REST_ACTION_MAX_AGE_MS || !lastExercise) return null;
  return {
    type: 'resume',
    endsAt: action.endsAtMs,
    seconds,
    exerciseName: lastExercise.name,
    locale: lastExercise.locale,
  };
}

/** Test-only: forget all seam state between cases. */
export function __resetRestActivity(): void {
  current = null;
  lastExercise = null;
  workout = null;
  lastSent = null;
  inFlight = null;
  seq = 0;
  currentAlertBody = undefined;
  appliedInbox.clear();
  ignoreRestActions = null;
  holdSyncUntil = 0;
  if (recheck) clearTimeout(recheck);
  recheck = null;
}

// ─── S23-8: the workout on the Lock Screen ──────────────────────

/**
 * One set the Lock Screen can confirm with "Done set": where it is, what the
 * face says, and the numbers a tick in the app would log — so the set that is
 * logged is exactly the set the lifter read. Native shows it and hands it back
 * untouched (`RestPlannedSet` in `RestActivity.swift`; the `upcoming` array in
 * `RestNotifier.kt`).
 */
export interface PlannedSet {
  exerciseId: string;
  exerciseIndex: number;
  setIndex: number;
  /** The exercise — what the rest that follows this set is titled with. */
  name: string;
  /** "Bench · Set 3 of 4 · 80 kg × 8", in the profile locale. */
  label: string;
  /** The rest that follows this set, seconds (core `restAfterSetInFlow`). */
  restSec: number;
  /** Stored unit (lb). */
  weight?: number;
  reps?: number;
  durationSec?: number;
  /** The set's identity beyond its index (review JS-P2-6): its kind, its
   *  cluster group, and how many sets the exercise had when planned. An add
   *  or a removal in between moves indices; any mismatch is ignored. */
  setKind: string;
  group?: number;
  setCount: number;
}

/** How many sets ahead the face carries — enough to tick a few in a row with
 *  the app suspended, small enough for ActivityKit's 4 KB state. */
export const MAX_PLANNED_SETS = 4;
const MAX_LABEL = 90;

export interface PlanInput {
  /** The session's exercises AS THE FLOW READS THEM — `ActiveSession`'s
   *  `flowRows`, superset rests chosen for this workout already applied. */
  exercises: readonly SessionExercise[];
  /** One exercise's ordinary rests, every override applied (`restSecondsFor`). */
  restFor: Parameters<typeof restAfterSetInFlow>[3];
  /** For last time's numbers, which a tick accepts on an empty row. */
  recentSessions: readonly WorkoutSession[];
  unitSystem: UnitSystem | undefined;
  locale: string;
  /** When each lift's last set was ticked (exercise id → ms) — the Program v2
   *  minimum cluster rest measures from it, as `ActiveSession.startRest` does. */
  lastSetAt?: Readonly<Record<string, number>>;
  /** The planning instant; defaults to now. */
  now?: number;
  max?: number;
}

type Dict = (typeof LOCALE_DEFS)[keyof typeof LOCALE_DEFS]['dict'];

const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));

function dictFor(locale: string) {
  const loc = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  return { loc, dict: LOCALE_DEFS[loc].dict as Dict };
}

/**
 * What ticking this row in the app would log, or `null` when the tick would
 * stop and ask instead — the same rules `SetRow`'s tick follows: a typed (or
 * stored) count wins, else core `countToAccept` (prescription → last time's
 * same-kind row → the lift's target reps); a weighted lift takes its stored
 * load, else last time's; nothing to offer → not plannable (the app would
 * focus the field, so the Lock Screen must not guess).
 */
function valuesFor(ex: SessionExercise, setIndex: number, previous: readonly WorkoutSet[]) {
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
  const set = ex.sets[setIndex];
  if (!set) return null;
  const prev = previousToAccept(previous[setIndex], set);
  const count = (style === 'time' ? set.durationSec : set.reps)
    ?? countToAccept(set, prev, style, ex.progression?.targetReps);
  if (count == null) return null;
  if (style === 'time') return { durationSec: count };
  if (style === 'bodyweight') return { reps: count };
  const weight = set.weight ?? prev?.weight;
  if (weight == null) return null;
  return { weight, reps: count };
}

function labelFor(
  ex: SessionExercise,
  setIndex: number,
  values: { weight?: number; reps?: number; durationSec?: number },
  unitSystem: UnitSystem | undefined,
  locale: string,
): string {
  const { loc, dict } = dictFor(locale);
  const value = values.durationSec != null
    ? fill(dict['train.lockSet.seconds'], { n: values.durationSec })
    : values.weight != null
      ? fill(dict['train.lockSet.weightReps'], { weight: formatLoad(values.weight, unitSystem), reps: values.reps ?? 0 })
      : fill(dict[pluralKeyFor('train.repsCount', loc, values.reps ?? 0)], { n: values.reps ?? 0 });
  const n = setRowLabels(ex.sets)[setIndex] ?? String(setIndex + 1);
  // "of 4" only when the rows are plain numbers; "Set 1b of 7" is no count.
  const plain = ex.sets.every((x) => x.group == null && !x.label);
  const label = plain
    ? fill(dict['train.lockSet.labelOf'], { name: ex.name, n, total: ex.sets.length, value })
    : fill(dict['train.lockSet.label'], { name: ex.name, n, value });
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/**
 * The next sets the lifter is expected to do, in the order the app itself
 * would walk them, each with what a tick would log and the rest that follows.
 *
 * "Next" is the session's performing order (core `supersetFlow` — supersets
 * interleaved), picking up after the LAST ticked set (so a lifter who skipped
 * ahead is followed, not sent back), wrapping to anything left open behind.
 * After each planned set the flow's own `next` wins when it is open, exactly
 * as `ActiveSession.startRest` names the next station. Stops at the first set
 * a tick could not log without asking. Pure.
 */
export function planUpcomingSets(input: PlanInput): PlannedSet[] {
  const { exercises, restFor } = input;
  const max = input.max ?? MAX_PLANNED_SETS;
  const order = supersetFlow(exercises).flatMap((step) => step.setIndices.map((i) => [step.exerciseIndex, i] as const));
  if (order.length === 0 || max <= 0) return [];
  const planned = new Set<string>();
  const isDone = (e: number, i: number) => planned.has(`${e}:${i}`) || exercises[e]?.sets[i]?.done === true;
  const posOf = (e: number, i: number) => order.findIndex(([a, b]) => a === e && b === i);
  const firstOpenFrom = (from: number) => {
    for (let k = 0; k < order.length; k++) {
      const p = (from + k) % order.length;
      if (!isDone(order[p][0], order[p][1])) return p;
    }
    return -1;
  };
  let lastDone = -1;
  order.forEach(([e, i], p) => {
    if (isDone(e, i)) lastDone = p;
  });
  const now = input.now ?? Date.now();
  // A planned set's tick time is unknown, so a lift planned here falls back to
  // the app's own estimate for "since its last set" (below).
  const lastAt: Record<string, number | undefined> = { ...input.lastSetAt };
  const previous = new Map<number, readonly WorkoutSet[]>();
  const previousFor = (e: number) => {
    let prev = previous.get(e);
    if (!prev) {
      prev = previousSets(exerciseHistory(input.recentSessions as WorkoutSession[], exercises[e].exerciseId));
      previous.set(e, prev);
    }
    return prev;
  };

  const out: PlannedSet[] = [];
  let at = firstOpenFrom(lastDone + 1);
  while (at >= 0 && out.length < max) {
    const [e, i] = order[at];
    const ex = exercises[e];
    const values = ex ? valuesFor(ex, i, previousFor(e)) : null;
    if (!ex || !values) break;
    planned.add(`${e}:${i}`);
    const flow = restAfterSetInFlow(exercises, e, i, restFor, isDone);
    // Program v2's minimum rest between a superset member's own clusters,
    // stretched exactly as `ActiveSession.startRest` stretches it (review P2-6).
    let seconds = flow.seconds;
    const back = flow.kind === 'round' && flow.next ? exercises[flow.next.exerciseIndex] : undefined;
    if (back?.minClusterRestSec != null) {
      const at = lastAt[back.exerciseId];
      const since = at != null
        ? (now - at) / 1000
        : (exercises[e].transitionRestSec ?? DEFAULT_TRANSITION_REST_SEC) + CLUSTER_ESTIMATE_SEC;
      seconds = roundRestWithFloor(flow.seconds, back.minClusterRestSec, since);
    }
    lastAt[ex.exerciseId] = undefined;
    const set = ex.sets[i];
    out.push({
      exerciseId: ex.exerciseId,
      exerciseIndex: e,
      setIndex: i,
      name: ex.name,
      label: labelFor(ex, i, values, input.unitSystem, input.locale),
      restSec: Math.max(0, Math.round(seconds)),
      ...values,
      setKind: set.kind ?? 'working',
      ...(set.group != null ? { group: set.group } : {}),
      setCount: ex.sets.length,
    });
    const viaFlow = flow.next && !isDone(flow.next.exerciseIndex, flow.next.setIndex)
      ? posOf(flow.next.exerciseIndex, flow.next.setIndex)
      : -1;
    at = viaFlow >= 0 ? viaFlow : firstOpenFrom(at + 1);
  }
  return out;
}

/** The words native draws with (Android) or keeps for a native "rest over"
 *  (iOS), in the profile locale. Pure — tested. */
export function workoutCopy(locale: string): Record<string, string> {
  const { dict } = dictFor(locale);
  return {
    restTitle: dict['train.restOngoing.title'],
    body: dict['train.restOngoing.body'],
    channel: dict['train.restOngoing.channel'],
    upNext: dict['train.lockSet.upNext'],
    nextLine: dict['train.lockSet.nextLine'],
    doneSet: dict['train.lockSet.doneSet'],
    add30: dict['train.lockSet.add30'],
    sub30: dict['train.lockSet.sub30'],
    skip: dict['train.lockSet.skip'],
    restOverTitle: dict['train.restDoneTitle'],
    restOverBody: dict['train.restDoneBody'],
    alertChannel: dict['train.lockSet.alertChannel'],
  };
}

/** This binary can show the workout (S23-8) on this platform. */
function workoutApi(): boolean {
  return Platform.OS === 'android' ? isRestNotificationWorkoutAvailable === true : isRestActivityWorkoutAvailable === true;
}

function inWorkoutMode(): boolean {
  return workout != null && workoutApi();
}

/**
 * Send native the whole picture — the rest (if any) and the queue — when it
 * differs from what was last sent (`force` skips that check). One JSON string,
 * so the shape can grow without a new native signature.
 */
function syncNative(force = false): void {
  if (!workout || !workoutApi() || Date.now() < holdSyncUntil) return;
  const json = JSON.stringify({
    v: 1,
    sessionId: workout.sessionId,
    locale: workout.locale,
    rest: current
      ? {
        startedAtMs: current.startedAt,
        endsAtMs: current.endsAt,
        title: current.exerciseName,
        ...(currentAlertBody ? { alertBody: currentAlertBody } : {}),
      }
      : null,
    upcoming: workout.upcoming,
    copy: workoutCopy(workout.locale),
  });
  if (!force && (json === lastSent || json === inFlight)) return;
  inFlight = json;
  seq = Math.max(Date.now(), seq + 1);
  // `seq` rides outside the dedupe key: native drops a picture older than
  // one it already drew.
  const payload = `${json.slice(0, -1)},"seq":${seq}}`;
  const send = Platform.OS === 'android' ? syncRestNotificationWorkout(payload) : syncRestActivityWorkout(payload);
  void send.then((result) => {
    if (inFlight === json) inFlight = null;
    // Marked sent only once native drew it (review P2-5): a refused picture —
    // an Activity requested from the background, notifications still off — is
    // sent again on the next change or the next foreground.
    lastSent = isDrawn(result) ? json : null;
  });
}

/** Native's answer to `workout(json)` that means "it is on screen" (or
 *  correctly removed because nothing is left to show). */
function isDrawn(result: string | null | undefined): boolean {
  return result == null || result === 'nothing-next' || result === 'stale';
}

/** Send the current picture again whatever was sent before — on foreground,
 *  where a refused or lost one is put right. */
export function resyncNative(): void {
  lastSent = null;
  syncNative(true);
}

/**
 * True when native — not `useRestTimer`'s expo-notifications schedule — owns
 * the "Rest over" buzz: Android inside an armed workout on a binary with
 * `workout` (review P1-2). The notification's own receiver moves it for the
 * lock-screen −30 s / +30 s / Skip with the process dead, which a JS-owned
 * AlarmManager request cannot follow; one owner means no double buzz.
 */
export function nativeOwnsRestAlert(): boolean {
  return Platform.OS === 'android' && inWorkoutMode();
}

/**
 * Arm (or refresh) the workout on the Lock Screen: the session and its next
 * planned sets ({@link planUpcomingSets}). Cheap to call on every render —
 * native hears only changes. A no-op on binaries without the function, where
 * the face stays the rest-only countdown it was.
 */
export function armWorkout(sessionId: string, upcoming: PlannedSet[], locale: string): void {
  workout = { sessionId, locale, upcoming };
  syncNative();
}

/** The workout closed (finish, discard, unmount): remove the face entirely,
 *  whatever this seam believes is showing. */
export function endWorkout(): void {
  workout = null;
  lastSent = null;
  inFlight = null;
  current = null;
  currentAlertBody = undefined;
  ignoreRestActions = null;
  clearLockScreenAccepted();
  void endRestActivity();
  void endRestNotification();
}

/** How old a Lock Screen "Done set" may be and still tick. Past this it is
 *  from some earlier workout, or a phone left in a bag. */
export const SET_ACTION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** What `ActiveSession` does with one "Done set": tick THIS set with these
 *  values, and run the bar for the rest native already started (if it is
 *  still running). */
export type SetInboxOutcome = {
  type: 'tick';
  exerciseIndex: number;
  setIndex: number;
  patch: Partial<WorkoutSet>;
  /** What the tick put into EMPTY fields — an untick takes exactly these back
   *  out, as it does for an in-app tick (`SetRow.untick`, review JS-P2-3). */
  accepted: { count?: number; weight?: number } | null;
  rest: { endsAt: number; seconds: number; total: number } | null;
} | null;

/** True the first time an inbox entry is seen this JS session. */
function firstApplication(action: { kind: string; atMs: number }): boolean {
  const key = `${action.kind}:${action.atMs}`;
  if (appliedInbox.has(key)) return false;
  appliedInbox.add(key);
  if (appliedInbox.size > 200) appliedInbox.delete(appliedInbox.values().next().value as string);
  return true;
}

/**
 * Turn a Lock Screen "Done set" into the exact tick — or nothing.
 *
 * Ignored (null), safely, when it no longer names a set the lifter could
 * mean: a different session; too old; the exercise is not where it was and
 * cannot be found by id unambiguously (a reorder in between is followed; a lift
 * added twice is not guessed at); the set index is out of range; or the set is
 * already ticked (the lifter did it in the app first). A rejected entry
 * re-sends the app's truth to native at once, because native has already moved
 * its face on and started a rest the app is not running.
 *
 * Accepted: the values are the face's — what the lifter read is what is
 * logged — and the rest native started is adopted as `current` WITHOUT a
 * native call (same reasoning as {@link applyRestInboxAction}).
 */
export function applySetInboxAction(
  action: SetDoneAction,
  exercises: readonly SessionExercise[],
  sessionId: string | undefined,
  now = Date.now(),
): SetInboxOutcome {
  lastSent = null;
  if (!firstApplication(action)) return null;
  const reject = (): SetInboxOutcome => {
    // Rest buttons tapped on the rest this set started — before the app could
    // put its own picture back — belong to nothing (review P2-7).
    ignoreRestActions = { from: action.atMs, to: now };
    syncNative(true);
    return null;
  };
  if (action.sessionId && sessionId && action.sessionId !== sessionId) return reject();
  if (now - action.atMs > SET_ACTION_MAX_AGE_MS) return reject();
  let e = action.exerciseIndex;
  if (exercises[e]?.exerciseId !== action.exerciseId) {
    const at = exercises.flatMap((x, k) => (x.exerciseId === action.exerciseId ? [k] : []));
    if (at.length !== 1) return reject();
    e = at[0];
  }
  const ex = exercises[e];
  const set = ex.sets[action.setIndex];
  if (!set || set.done) return reject();
  // The same set, not just the same slot (review JS-P2-6).
  if (action.setKind != null && (set.kind ?? 'working') !== action.setKind) return reject();
  if (action.setKind != null && (set.group ?? null) !== (action.group ?? null)) return reject();
  if (action.setCount != null && ex.sets.length !== action.setCount) return reject();
  ignoreRestActions = null;

  const patch: Partial<WorkoutSet> = {
    done: true,
    ...(action.weight != null ? { weight: action.weight } : {}),
    ...(action.reps != null ? { reps: action.reps } : {}),
    ...(action.durationSec != null ? { durationSec: action.durationSec } : {}),
  };
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
  const storedCount = style === 'time' ? set.durationSec : set.reps;
  const tickCount = style === 'time' ? action.durationSec : action.reps;
  const accepted = {
    ...(storedCount == null && tickCount != null ? { count: tickCount } : {}),
    ...(set.weight == null && action.weight != null ? { weight: action.weight } : {}),
  };
  const seconds = action.endsAtMs > 0 ? Math.round((action.endsAtMs - now) / 1000) : 0;
  let rest: { endsAt: number; seconds: number; total: number } | null = null;
  if (seconds > 0) {
    const locale = workout?.locale ?? lastExercise?.locale ?? 'en';
    current = { endsAt: action.endsAtMs, exerciseName: ex.name, startedAt: action.atMs, locale };
    lastExercise = { name: ex.name, locale };
    rest = { endsAt: action.endsAtMs, seconds, total: Math.max(seconds, Math.round((action.endsAtMs - action.atMs) / 1000)) };
  }
  return {
    type: 'tick',
    exerciseIndex: e,
    setIndex: action.setIndex,
    patch,
    accepted: accepted.count != null || accepted.weight != null ? accepted : null,
    rest,
  };
}
