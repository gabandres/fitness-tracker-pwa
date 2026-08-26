import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  type WritableKind,
  type DayBoundary,
  importableWorkouts,
  isLoggedCardioBlock,
  calendarDateKey,
  dayKeyAt,
  latestSampleEndByDay,
  mergeImportedBlocks,
  parseYmd,
  reduceImportedSamples,
  toCardioBlockFromHealth,
  valuesToApply,
} from '@macrolog/core';
import type { CardioBlock } from '@macrolog/core/cardio';
import type { HealthWorkout } from '@macrolog/core/health-workouts';
import {
  getHealthScalarsOnce,
  getRecentSessions,
  markExercised,
  setDailyActiveEnergy,
  getDayBoundaryOnce,
  importDailySleep,
  setDailySteps,
  setDailyWater,
  setDailyWeight,
  startSession,
  updateSession,
} from './ledger';
import type { WorkoutSession } from './workout';
import { health, type NutritionExport, type ReadableKind, type WorkoutExport } from './health';

/**
 * Health sync orchestration — the glue between the pure `health-mapping` brain,
 * the native `health` adapter, and the Firestore `ledger`.
 *
 * Import (Health → app): read each two-way kind, fold to one value/day
 * (`reduceImportedSamples`), keep only days that differ from the app's current
 * value (`valuesToApply`), write those to Firestore. Idempotent — our own
 * exports are dropped on read (`fromUs`) and unchanged days are skipped.
 *
 * Export (app → Health): thin guarded wrappers the log/weight/workout paths
 * call fire-and-forget; a Health failure never fails the Firestore write.
 *
 * "Connected" is a device preference (AsyncStorage), not user data — it never
 * goes to Firestore. All native calls are `tsc`-verified only; QA needs a build.
 */

const CONNECTED_KEY = 'ignia.health.connected';

/**
 * Which set of scopes the stored grant covers.
 *
 * Bump this whenever a new read type is added. `connectHealth` re-prompts when
 * the stored number is older, and that re-prompt is the only thing standing
 * between an existing user and silence:
 *
 * **Neither platform errors on an unauthorized read.** HealthKit returns an
 * empty array by design; Health Connect refuses and our adapter converts that
 * to `[]` for the same reason. So a user who connected before cardio existed
 * would import nothing, forever, with no error anywhere to find it by — and
 * "no workouts" and "no permission" would be indistinguishable in the UI as
 * well as in the code.
 *
 * Version 2 adds the workout read (ADR-0026).
 */
const HEALTH_SCOPE_VERSION = 2;
const SCOPE_VERSION_KEY = 'ignia.health.scopeVersion';

/**
 * How far back workouts are imported, in DAYS.
 *
 * Deliberately far shorter than {@link IMPORT_DAYS}, and the asymmetry is the
 * point. Weight history is imported over 400 days because measured-mode TDEE
 * genuinely reads it. Cardio is NOT an input to any estimate (ADR-0024
 * decision 4), so its window is chosen for what a person wants to look at
 * rather than for what the math needs — and a shorter window bounds the
 * per-session aggregate calls Health Connect requires on a first import.
 */
const WORKOUT_IMPORT_DAYS = 90;

/** How many recent sessions the merge looks at. Comfortably more than
 *  {@link WORKOUT_IMPORT_DAYS} of daily training, so a same-day match is never
 *  missed for want of reading far enough back. */
const SESSION_SCAN_LIMIT = 200;
/** First-import history depth, in DAYS. Numerically equal to core's
 *  `LOG_WINDOW_ROWS` and deliberately not derived from it — that one counts
 *  ROWS, and conflating the two is the ADR-0004 footgun in miniature. Sized so
 *  measured-mode TDEE benefits from imported weight immediately. */
const IMPORT_DAYS = 400;

/** Per-kind "already equal" tolerance for `valuesToApply` — unit round-trips
 *  and the ledger's own rounding (½-hour sleep, whole fl oz) aren't exact. */
const EPSILON: Record<ReadableKind, number> = {
  weight: 0.05,
  sleep: 0.25,
  water: 1,
  // Both store as whole numbers, so anything below 1 is the same value. Health
  // keeps revising the current day's activity as the watch syncs, and a
  // sub-unit epsilon would rewrite the same doc all day for no visible change.
  steps: 1,
  activeEnergy: 1,
};

/**
 * What one import RUN knows that a single day-value does not.
 *
 * Only the sleep writer reads it, and only because of issue #80: the guard that
 * protects a hand-typed night has to look at the key the user would have typed
 * under, which is a function of the account's day boundary and of when the
 * sleeper woke. Both are per-run facts — one profile read and one pass over the
 * samples — so they are gathered once and threaded, never fetched per night.
 */
interface ImportRun {
  boundary: DayBoundary;
  /** `dateKey → epoch ms` of the day's latest sleep sample end. Empty for
   *  every other kind, which is why the writer signature can stay uniform. */
  wokeAt: Record<string, number>;
}

/** Firestore writer per readable kind (all share the
 *  `(uid, dateKey, value, run)` shape; each clamps/rounds to its own canonical
 *  unit). */
const WRITER: Record<
  ReadableKind,
  (uid: string, dateKey: string, value: number, run: ImportRun) => Promise<void>
> = {
  weight: setDailyWeight,
  // Guarded: an OS-store night must not overwrite one the user typed. Same
  // rule the Oura importer follows — see `importDailySleep`. The boolean it
  // returns is unused here because this map's contract returns void.
  sleep: async (uid: string, dateKey: string, value: number, run: ImportRun) => {
    await importDailySleep(uid, dateKey, value, {
      wakeAt: run.wokeAt[dateKey],
      boundary: run.boundary,
    });
  },
  water: setDailyWater,
  steps: setDailySteps,
  activeEnergy: setDailyActiveEnergy,
};

/** Every kind the importer pulls, in the order it pulls them. */
const IMPORT_KINDS: ReadableKind[] = ['weight', 'sleep', 'water', 'steps', 'activeEnergy'];

let connectedCache: boolean | null = null;

export async function isHealthConnected(): Promise<boolean> {
  if (connectedCache != null) return connectedCache;
  connectedCache = (await AsyncStorage.getItem(CONNECTED_KEY)) === '1';
  return connectedCache;
}

async function setConnectedFlag(v: boolean): Promise<void> {
  connectedCache = v;
  await AsyncStorage.setItem(CONNECTED_KEY, v ? '1' : '0');
}

/**
 * True when the user connected under an OLDER scope set, so the app is asking
 * for something the stored grant does not cover.
 *
 * Only meaningful while connected — a disconnected user needs a connect, not a
 * re-prompt.
 */
export async function needsHealthReauth(): Promise<boolean> {
  if (!(await isHealthConnected())) return false;
  const stored = Number(await AsyncStorage.getItem(SCOPE_VERSION_KEY) ?? 0);
  return !Number.isFinite(stored) || stored < HEALTH_SCOPE_VERSION;
}

/** Prompt for OS health permissions; persist "connected" only if granted. */
export async function connectHealth(): Promise<boolean> {
  const ok = await health.requestPermissions();
  if (ok) {
    await setConnectedFlag(true);
    // Stamped only on success. A declined prompt must leave the stored version
    // behind so the next connect asks again rather than assuming.
    await AsyncStorage.setItem(SCOPE_VERSION_KEY, String(HEALTH_SCOPE_VERSION));
  }
  return ok;
}

export async function disconnectHealth(): Promise<void> {
  await setConnectedFlag(false);
}

let importing = false;

/**
 * Pull every readable kind from the OS health store into Firestore. Returns the
 * number of day-values written. No-op (returns 0) when disconnected or when an
 * import is already in flight (guard against overlapping app-open + Sync-now).
 */
export async function importHealth(uid: string): Promise<number> {
  if (importing || !uid || !(await isHealthConnected())) return 0;
  importing = true;
  try {
    return await importScalars(uid);
  } finally {
    importing = false;
  }
}

/** The scalar import itself, WITHOUT the in-flight guard, so {@link importAll}
 *  can hold one guard across both halves instead of two that can interleave. */
async function importScalars(uid: string): Promise<number> {
  {
    const [current, boundary] = await Promise.all([
      getHealthScalarsOnce(uid),
      // One profile read per run, for the sleep guard alone (#80). It falls
      // back to MIDNIGHT on failure, under which the guard is exactly what it
      // was before — so this cannot block an import.
      getDayBoundaryOnce(uid),
    ]);
    let applied = 0;
    for (const kind of IMPORT_KINDS) {
      const samples = await health.readSamples(kind, IMPORT_DAYS, boundary);
      const reduced = reduceImportedSamples(samples);
      // `reduceImportedSamples` folds sleep by SUM and throws the sample times
      // away with it. The wake instant is not part of the value and is not
      // stored — it only tells the guard which document could hold the manual
      // twin of this night.
      const run: ImportRun = {
        boundary,
        wokeAt: kind === 'sleep' ? latestSampleEndByDay(samples) : {},
      };
      const toApply = valuesToApply(reduced, current[kind], EPSILON[kind]);
      for (const [dateKey, value] of Object.entries(toApply)) {
        await WRITER[kind](uid, dateKey, value, run);
        applied++;
      }
    }
    return applied;
  }
}

/**
 * Pull workouts from the OS health store and fold them into Train history
 * (ADR-0025 / ADR-0026).
 *
 * Shape of the result: an imported workout becomes a `WorkoutSession` with
 * `exercises: []` and one `CardioBlock`, unless a session already exists on
 * that local day — in which case the block joins it, so a lifting day with a
 * ring-detected finisher stays ONE history row.
 *
 * Idempotent by `sourceId`: re-importing the same run updates its block instead
 * of adding a second copy. A block that merely OVERLAPS a hand-logged one is
 * still added, deliberately — that is a question for the user, and
 * `looksLikeSameEffort` is what the UI asks it with. Silently collapsing them
 * here is the merge ADR-0026 decision 4 refuses, because a false positive
 * destroys a real training record.
 *
 * Returns the number of sessions written.
 */
export async function importHealthWorkouts(uid: string): Promise<number> {
  if (!uid || !(await isHealthConnected())) return 0;

  const raw = await health.readWorkouts(WORKOUT_IMPORT_DAYS);
  return writeImportedBlocks(uid, toImportableBlocks(raw));
}

/**
 * The shared tail of both import transports: raw workout records → the blocks
 * worth storing.
 *
 * Split out when the Oura Cloud API became a second reader (issue #72). Both
 * transports produce `HealthWorkout`, so both filter identically — and they
 * must, or "what counts as importable" quietly forks per road and the same run
 * is kept by one path and dropped by the other.
 */
export function toImportableBlocks(raw: readonly HealthWorkout[]): CardioBlock[] {
  return partitionImportable(raw).blocks;
}

/**
 * The same pipeline as {@link toImportableBlocks}, but it also says how many
 * records were **deliberately declined for not being cardio**.
 *
 * That count exists because of #102, and the bug there was a reporting one
 * rather than a logic one. The one real Oura ring on this project was
 * connected, syncing, and returning two workouts on every call — and nothing
 * appeared in Train. Both records were `strengthTraining` and `other`, so the
 * filter below dropped them, exactly as intended. The system was working.
 *
 * **What was wrong is that it looked identical to a broken integration.** The
 * screen said "no workouts", the same words it would use for a ring that had
 * recorded nothing, and the user has no way to tell those apart. That is the
 * empty-state rule ADR-0026 sets for this integration, failing in a case
 * nobody had anticipated: not "connected vs no data", but "declined vs no
 * data".
 *
 * `nonCardio` is counted BEFORE `isLoggedCardioBlock` so it means what it says
 * — a strength session, not a prescription nobody performed.
 */
export function partitionImportable(raw: readonly HealthWorkout[]): {
  blocks: CardioBlock[];
  nonCardio: number;
} {
  const mapped = importableWorkouts(raw).map(toCardioBlockFromHealth);
  // Anything the modality table could not place is NOT imported. Oura and
  // the Watch both record strength training, and importing those as cardio
  // would duplicate the sessions the user logs in Train by hand — with no
  // way to tell the copies apart afterwards. A missed import is recoverable;
  // a duplicated history is not.
  const nonCardio = mapped.filter((b) => b.modality === 'other').length;
  return {
    blocks: mapped.filter((b) => b.modality !== 'other').filter(isLoggedCardioBlock),
    nonCardio,
  };
}

/**
 * Fold imported blocks into Train history — the write half, shared by both
 * transports.
 *
 * See {@link importHealthWorkouts} for the shape and the idempotency rules;
 * this is that function's body from the grouping step down, given a name so
 * the Oura Cloud path (`importOuraWorkouts` in `./oura`) reaches the same
 * writes rather than growing a parallel set of them.
 *
 * The one thing worth restating here: matching is by `sourceId`, and the two
 * transports have DIFFERENT id namespaces for the same run. That is not this
 * function's problem to solve — `mergeImportedBlocks` correctly adds both, and
 * `looksLikeSameEffort` is what surfaces the pair to the user, on screen,
 * where a person can answer. Collapsing them here would be the silent merge
 * ADR-0026 decision 4 refuses.
 */
export async function writeImportedBlocks(uid: string, blocks: CardioBlock[]): Promise<number> {
  if (!blocks.length) return 0;

  // ADR-0030 Q5. These two keys are MATCHED AGAINST EACH OTHER to decide
  // whether an imported run folds into a session the user already logged, so
  // they move together or not at all — converting one and not the other would
  // stop a 00:30 run finding the session it belongs to and write a duplicate
  // day instead. That coupling is why this was left until the decision existed.
  const boundary = await getDayBoundaryOnce(uid);

  const sessions = await getRecentSessions(uid, SESSION_SCAN_LIMIT);
  const byDay = new Map<string, WorkoutSession>();
  for (const s of sessions) {
    const key = dayKeyAt(s.date, boundary);
    // Sessions come back newest-first; keep the newest per day.
    if (!byDay.has(key)) byDay.set(key, s);
  }

  // Group by day first so two runs on one day become one write, not two.
  const perDay = new Map<string, CardioBlock[]>();
  for (const b of blocks) {
    const key = dayKeyAt(b.startedAt ?? new Date(), boundary);
    const list = perDay.get(key);
    if (list) list.push(b);
    else perDay.set(key, [b]);
  }

  let written = 0;
  for (const [dayKey, incoming] of perDay) {
    const existing = byDay.get(dayKey);
    if (existing?.id) {
      const { blocks: merged, changed } = mergeImportedBlocks(existing.cardio ?? [], incoming);
      if (!changed) continue;
      await updateSession(uid, existing.id, { cardio: merged });
      written++;
      continue;
    }
    const date = incoming[0].startedAt ?? parseYmd(dayKey);
    await startSession(uid, { status: 'completed', date, exercises: [], cardio: incoming });
    // Same cross-cutting finish a hand-logged session gets: the day counts
    // toward the streak and shows its History dot. The marker is 0 kcal —
    // see `workoutMarkerEntry`.
    await markExercised(uid, date);
    written++;
  }
  return written;
}

/**
 * Both halves of the import, under ONE in-flight guard.
 *
 * The guard has to wrap the pair rather than each half: `useHealthAutoImport`
 * fires on every foreground and Settings offers a manual *Sync now*, so two
 * runs can overlap — and two concurrent workout imports would each read the
 * same sessions, find no `sourceId` match, and write the same run twice. The
 * scalar half has been guarded since it shipped; the workout half needs it
 * more, because its writes create documents rather than overwrite them.
 *
 * Workouts run second on purpose. The scalar import is the one a user is
 * waiting on (a fresh scale reading on Today), and a slow per-session
 * aggregate on Android must not hold it up.
 */
export async function importAll(uid: string): Promise<number> {
  if (importing || !uid || !(await isHealthConnected())) return 0;
  importing = true;
  try {
    const scalars = await importScalars(uid);
    const workouts = await importHealthWorkouts(uid);
    return scalars + workouts;
  } finally {
    importing = false;
  }
}

// ── Export wrappers — guarded + swallow (never fail the Firestore write) ──

export async function exportDaily(kind: WritableKind, dateKey: string, value: number): Promise<void> {
  try {
    if (await isHealthConnected()) await health.writeDaily(kind, dateKey, value);
  } catch {
    /* Health write is best-effort; the Firestore write already succeeded. */
  }
}

export async function exportNutrition(entry: NutritionExport): Promise<void> {
  try {
    if (await isHealthConnected()) await health.writeNutrition(entry);
  } catch {
    /* best-effort */
  }
}

export async function exportWorkout(w: WorkoutExport): Promise<void> {
  try {
    if (await isHealthConnected()) await health.writeWorkout(w);
  } catch {
    /* best-effort */
  }
}

// ── Hooks ──

/**
 * Settings control surface: availability + connection state, connect/disconnect,
 * and a manual "Sync now". Connecting runs an immediate import so the user sees
 * their Health weight land right away.
 */
export function useHealthSync(uid: string | undefined) {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  /** Connected, but under a scope set that predates cardio import. The UI has
   *  to state this, because an unauthorized read returns an empty list on both
   *  platforms — so "reconnect to import workouts" cannot be inferred from the
   *  data and must be tracked here. */
  const [needsReauth, setNeedsReauth] = useState(false);

  useEffect(() => {
    let alive = true;
    void health.isAvailable().then((a) => alive && setAvailable(a));
    void isHealthConnected().then((c) => alive && setConnected(c));
    void needsHealthReauth().then((n) => alive && setNeedsReauth(n));
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    const ok = await connectHealth();
    setConnected(ok);
    if (ok && uid) {
      setSyncing(true);
      try {
        await importAll(uid);
      } finally {
        setSyncing(false);
      }
    }
    setNeedsReauth(await needsHealthReauth());
    return ok;
  }, [uid]);

  const disconnect = useCallback(async () => {
    await disconnectHealth();
    setConnected(false);
    setNeedsReauth(false);
  }, []);

  const syncNow = useCallback(async () => {
    if (!uid) return 0;
    setSyncing(true);
    try {
      return await importAll(uid);
    } finally {
      setSyncing(false);
    }
  }, [uid]);

  return { available, connected, syncing, needsReauth, connect, disconnect, syncNow };
}

/**
 * App-shell auto-import: pull from Health once on mount and whenever the app
 * returns to the foreground (guarded/no-op when disconnected). Mount once high
 * in the authed tree so a fresh scale reading shows up without opening Settings.
 */
/**
 * HealthKit refuses every read while the device is locked, and says so with
 * `com.apple.healthkit Code=6 "Protected health data is inaccessible"`. That
 * is documented Apple behaviour, not a failure — the encryption key for the
 * health store is derived from the passcode and simply is not in memory.
 *
 * It reached Sentry anyway, from a real user's phone (build 60, 2026-08-23),
 * because `void promise` DISCARDS THE VALUE WITHOUT CATCHING THE REJECTION.
 * The two read the same at a glance and they are not the same thing: an
 * unhandled rejection in React Native is reported exactly like a crash.
 *
 * So this swallows the locked-device case by name and lets anything else
 * through to Sentry, where a real HealthKit fault still belongs.
 */
function isLockedDeviceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('Protected health data is inaccessible')
    || msg.includes('com.apple.healthkit Code=6');
}

export function useHealthAutoImport(uid: string | undefined): void {
  useEffect(() => {
    if (!uid) return;
    const run = (): void => {
      importAll(uid).catch((err: unknown) => {
        if (isLockedDeviceError(err)) return;
        throw err;
      });
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      // Only on the way back IN. A read fired as the app backgrounds is the
      // one guaranteed to hit a locked store.
      if (state === 'active') run();
    });
    return () => sub.remove();
  }, [uid]);
}
