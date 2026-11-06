import { AppState, Platform } from 'react-native';

/**
 * Daily steps without opening the app (2026-11-06, iOS).
 *
 * Three ways in, one import (`importRecentSteps`, today + the two days
 * before):
 *
 * 1. **HealthKit background delivery.** `setStepsBackground(true)` asks iOS to
 *    wake the app about hourly when steps change. In a binary built with the
 *    HealthKit plugin's `background: true` (build 75 on), the module's
 *    `BackgroundDeliveryManager` re-registers the observer in
 *    `didFinishLaunching` on every launch — including the background launch
 *    iOS makes for a delivery. That launch runs this bundle (`index.js` calls
 *    {@link startStepsBackgroundSync} before React mounts), sees the app is
 *    not active, and imports. **The module's native observer never forwards
 *    its event to JS** (14.0.2: `setCallback` has no caller), which is why
 *    the launch itself is the signal here, not the event.
 * 2. **The JS observer** (`watchSteps`): a delivery that resumes a SUSPENDED
 *    app reaches this runtime's own `HKObserverQuery`, and while the app is
 *    open it fires as the watch syncs.
 * 3. **Today appearing** ({@link refreshStepsSoon}) — on top of the full
 *    import that app open and foreground already run (`useHealthAutoImport`).
 *
 * Limits, stated rather than hidden: iOS decides when to deliver (hourly is a
 * ceiling, not a promise), a background launch gets a few seconds, and while
 * the phone is LOCKED Health data is encrypted and cannot be read — a delivery
 * then fails quietly and the next one after unlock catches up. Yesterday is
 * re-read on every run, so it is final once a run lands after 03:00.
 */

/** Runs closer together than this are skipped, unless iOS launched us. */
const MIN_GAP_MS = 5 * 60_000;
/** How long a background launch waits for the restored Firebase session. */
const AUTH_WAIT_MS = 15_000;

let started = false;
let running = false;
let lastRunAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function signedInUid(): Promise<string | undefined> {
  const { auth, onSessionTokenChanged } = await import('./firebase');
  if (auth.currentUser) return auth.currentUser.uid;
  return new Promise((resolve) => {
    let unsub: () => void = () => {};
    const done = (uid?: string) => {
      clearTimeout(t);
      unsub();
      resolve(uid);
    };
    const t = setTimeout(() => done(auth.currentUser?.uid), AUTH_WAIT_MS);
    unsub = onSessionTokenChanged(() => {
      if (auth.currentUser) done(auth.currentUser.uid);
    });
  });
}

async function runOnce(force: boolean): Promise<void> {
  if (running || (!force && Date.now() - lastRunAt < MIN_GAP_MS)) return;
  running = true;
  try {
    const uid = await signedInUid();
    if (!uid) return;
    const { importRecentSteps } = await import('./health-sync');
    await importRecentSteps(uid);
    lastRunAt = Date.now();
  } catch (err) {
    // A locked phone (Health data encrypted) is the expected failure here.
    const { isExpectedHealthState } = await import('./health-errors');
    if (!isExpectedHealthState(err)) {
      const { captureError } = await import('./sentry');
      captureError(err, { where: 'steps.background' });
    }
  } finally {
    running = false;
  }
}

function schedule(delayMs: number, force = false): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void runOnce(force);
  }, delayMs);
}

/** Called once from `index.js`, before React mounts. iOS only; a no-op on a
 *  second call and when Health is not connected. */
export function startStepsBackgroundSync(): void {
  if (Platform.OS !== 'ios' || started) return;
  started = true;
  const launchedInBackground = AppState.currentState === 'background';
  void (async () => {
    const { isHealthConnected } = await import('./health-sync');
    if (!(await isHealthConnected())) return;
    const { health } = await import('./health');
    // Re-asserted every launch: cheap, and it re-registers the native
    // observers if an earlier call ran before the grant existed.
    await health.setStepsBackground?.(true).catch(() => false);
    await health.watchSteps?.(() => schedule(3_000));
    if (launchedInBackground) schedule(0, true);
  })().catch(() => {
    /* No Health on this device, or the module is missing: nothing to watch. */
  });
}

/** Today appearing: refresh today's steps unless a run landed recently. */
export function refreshStepsSoon(): void {
  if (Platform.OS !== 'ios') return;
  schedule(1_000);
}
