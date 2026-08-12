/**
 * Product analytics — the smallest thing that answers the questions this
 * project keeps deferring.
 *
 * ## Why it exists
 *
 * Three roadmap items are blocked on data nobody collects. `UX_AUDIT.md` N5
 * (guest mode) says "revisit against real retention data, not intuition";
 * §S13's guest-mode row says the same; Play asks what closed testers actually
 * did with the app. The honest answer to all three has been a hand-run script
 * that counts Firestore subcollections, which measures *writes* and cannot see
 * an open, a scan, a coach question, or a session that logged nothing.
 *
 * ## What it is, and what it deliberately is not
 *
 * One document per user per day holding integer counts:
 *
 *     usageEvents/{uid}_{YYYY-MM-DD}
 *
 * No third party, no new secret, no SDK, no Cloud Function, and no per-event
 * network call — the client accumulates in memory and flushes a merge with
 * `increment()`, so a heavy day costs a handful of writes rather than one per
 * tap. Both frontends write the identical shape, the way they already do for
 * every other document (`firestore-writers.ts`).
 *
 * It records **that** a thing happened and never **what**: no meal names, no
 * macros, no photos, no free text, no device identifiers beyond the platform
 * bucket. The doc lives under the same uid the rest of the account does and is
 * covered by the existing account-deletion purge, because it is keyed by uid
 * like every quota doc already is.
 *
 * The event list is closed on purpose. `firestore.rules` enumerates it field by
 * field, so adding an event means adding it in three places — here, in the
 * rules, and in the rules test — and that friction is the feature: it is what
 * stops this from quietly becoming a behavioural log.
 */

/**
 * The catalogue.
 *
 * Chosen to answer exactly four questions and nothing else:
 *   - **Does anyone come back?** `app_open`, one per cold start, counted by
 *     distinct days.
 *   - **Do they get through the door?** `signup` → `onboarding_complete` →
 *     `log_added`, the funnel that N5 (guest mode) turns on.
 *   - **Which logging paths carry the weight?** the `log_*` family plus
 *     `photo_scan`, `barcode_scan`, `voice_log`, `quick_add`, `repeat_yesterday`
 *     — this is what says whether a surface earns its maintenance.
 *   - **Is anything failing quietly?** `log_queued_offline`, the one event that
 *     is a health signal rather than a usage one.
 */
export const USAGE_EVENTS = [
  'app_open',
  'signup',
  'onboarding_complete',
  'log_added',
  'log_queued_offline',
  'repeat_yesterday',
  'quick_add',
  'photo_scan',
  'barcode_scan',
  'voice_log',
  'coach_ask',
  'weight_logged',
  'workout_finished',
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

/** Which build wrote the doc. Coarse by design — a bucket, not a device. */
export type UsagePlatform = 'web' | 'ios' | 'android';

export const USAGE_PLATFORMS: readonly UsagePlatform[] = ['web', 'ios', 'android'];

/**
 * Upper bound on any single counter, enforced in `firestore.rules`.
 *
 * A real user does not log two thousand meals in a day; a loop does. The cap
 * turns a runaway client — or a bored one with a REST client — into a write
 * that is simply rejected, rather than an unbounded integer nobody notices
 * until it skews a chart. It is deliberately far above any honest usage.
 */
export const USAGE_COUNT_MAX = 2000;

/** Doc id for one user's day. Matches the `<uid>_<YYYY-MM-DD>` convention the
 *  quota collections already use, so the uid prefix is the tenant key and the
 *  rules can authorize on `id.split('_')[0]`. */
export function usageDocId(uid: string, dayKey: string): string {
  return `${uid}_${dayKey}`;
}

/** A batch of counts waiting to be flushed. */
export type UsageCounts = Partial<Record<UsageEvent, number>>;

/** Fold one event into a pending batch. Pure, so the buffering logic is
 *  testable without a clock or a network. */
export function addUsageCount(
  counts: UsageCounts,
  event: UsageEvent,
  n = 1,
): UsageCounts {
  return { ...counts, [event]: (counts[event] ?? 0) + n };
}

/** Whether a batch is worth a write. Guards the flush against the common case
 *  of a background/foreground cycle with nothing in between. */
export function hasUsageCounts(counts: UsageCounts): boolean {
  return Object.keys(counts).length > 0;
}

/**
 * Clamp a batch to what the rules will accept.
 *
 * Applied client-side so an over-count is dropped to the cap rather than
 * rejected whole — losing the last few of two thousand identical events is
 * strictly better than losing the day's document because one counter ran away.
 * Non-finite and negative values are dropped entirely: they are always a bug,
 * never a measurement, and `increment(NaN)` corrupts the stored total.
 */
export function clampUsageCounts(counts: UsageCounts): UsageCounts {
  const out: UsageCounts = {};
  for (const event of USAGE_EVENTS) {
    const n = counts[event];
    if (n == null || !Number.isFinite(n) || n <= 0) continue;
    out[event] = Math.min(Math.round(n), USAGE_COUNT_MAX);
  }
  return out;
}
