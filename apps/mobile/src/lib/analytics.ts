import { AppState, type AppStateStatus, Platform } from 'react-native';
import {
  type UsageCounts,
  type UsageEvent,
  type UsagePlatform,
  addUsageCount,
  hasUsageCounts,
  localDateKey,
} from '@macrolog/core';
/**
 * The ledger is required lazily, inside {@link flush}, and that is not
 * cosmetic.
 *
 * `track()` is called from components — `MicButton`, `BarcodeScanner`, the tab
 * layout — so a static `import './ledger'` puts the Firestore SDK in the import
 * graph of every one of them. Under jest that is immediate breakage
 * (`@firebase/util` ships untranspiled ESM, so any component test rendering a
 * tracked component fails to parse), and in the app it drags the SDK into
 * bundles that had no reason to hold it.
 *
 * Deferring it means the only thing that touches Firestore is the write itself,
 * which by then is already on an async path.
 */
type RecordUsage = typeof import('./ledger').recordUsage;
function ledgerRecordUsage(): RecordUsage {
  return (require('./ledger') as { recordUsage: RecordUsage }).recordUsage;
}

/**
 * Product analytics for the Expo app — buffer here, flush rarely.
 *
 * See `@macrolog/core/usage-events` for what this collects and why it is
 * counters rather than events. This file is the adapter: a batch in memory, a
 * flush on the moments that matter, and nothing on the hot path.
 *
 * ## Why buffered
 *
 * The obvious shape — one write per event — is the wrong one twice over. It
 * puts a network call on the path of every tap the app has, and it turns a
 * user who logs six meals into six billable writes. Buffering makes a heavy
 * day one or two, which is what makes this affordable enough to be worth having
 * at all (`CLAUDE.md` cost discipline).
 *
 * ## When it flushes
 *
 *   - **Backgrounding**, which is the reliable end-of-session on both
 *     platforms and the only one that catches a user who opens the app, logs,
 *     and swipes away inside a minute.
 *   - **Every {@link FLUSH_INTERVAL_MS}** while active, so a long session is not
 *     one all-or-nothing write at the end.
 *   - **On sign-out**, before the uid it is addressed to goes away.
 *
 * A flush that fails keeps its counts and retries on the next one. A flush that
 * fails forever loses counts, and that is the correct trade: analytics must
 * never be the reason a user sees an error, and must never be the reason a
 * queue grows without bound.
 */

/** Long enough that an active session costs one or two writes an hour; short
 *  enough that a crash mid-session does not lose the whole thing. */
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

const platform: UsagePlatform = Platform.OS === 'ios' ? 'ios' : 'android';

let buffer: UsageCounts = {};
/** The day the buffer belongs to. A session that crosses local midnight must
 *  not fold yesterday's counts into today's document — it flushes first. */
let bufferDay: string = localDateKey(new Date());
let uid: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;

/**
 * Record one event. Cheap, synchronous, and safe to call from anywhere
 * including a render path — it touches an object and returns.
 *
 * A call while signed out is dropped rather than buffered: a count is addressed
 * to an account, and holding one for whoever signs in next would attribute a
 * stranger's session to them. `signup` is therefore recorded *after* the
 * account exists, not at form submission.
 */
export function track(event: UsageEvent, n = 1): void {
  if (!uid) return;
  const today = localDateKey(new Date());
  if (today !== bufferDay) {
    // Flush yesterday under yesterday's key before the buffer rolls over.
    void flush();
    bufferDay = today;
  }
  buffer = addUsageCount(buffer, event, n);
}

/**
 * Write whatever is buffered. Never throws.
 *
 * The buffer is swapped out *before* the await so events recorded during the
 * write are not silently dropped by the reset that follows it; on failure the
 * two are merged back together.
 */
export async function flush(): Promise<void> {
  if (!uid || !hasUsageCounts(buffer)) return;
  const sending = buffer;
  const day = bufferDay;
  const account = uid;
  buffer = {};
  try {
    await ledgerRecordUsage()(account, day, platform, sending);
  } catch {
    // Put them back, unless the day has since rolled — a stale day's counts are
    // not worth carrying into a document they do not belong to.
    if (day === bufferDay) {
      for (const [event, count] of Object.entries(sending)) {
        buffer = addUsageCount(buffer, event as UsageEvent, count);
      }
    }
  }
}

/**
 * Bind analytics to a session. Called when auth resolves; call again with
 * `null` on sign-out.
 *
 * Flushes the previous account's buffer before switching, which is the one
 * ordering that matters here: the counts belong to whoever was signed in when
 * they happened.
 */
export function setAnalyticsUser(nextUid: string | null): void {
  if (nextUid === uid) return;
  void flush();
  uid = nextUid;
  bufferDay = localDateKey(new Date());
  if (nextUid) start();
  else stop();
}

function start(): void {
  if (timer == null) timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  if (appStateSub == null) {
    appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      // 'inactive' is the iOS transitional state (app switcher, incoming call)
      // and is deliberately included: it is often the last callback before the
      // process is frozen, and a flush there costs nothing if the user returns.
      if (state === 'background' || state === 'inactive') void flush();
    });
  }
}

function stop(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  appStateSub?.remove();
  appStateSub = null;
  buffer = {};
}

/** Test seam — drop all state without touching the network. */
export function resetAnalytics(): void {
  uid = null;
  buffer = {};
  bufferDay = localDateKey(new Date());
  stop();
}
