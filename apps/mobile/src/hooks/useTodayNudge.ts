import { useUpdateVisible } from '@/components/UpdateBanner';

/**
 * Which single Nudge Today is allowed to show (UX_AUDIT §S14 TD1).
 *
 * ## The rule
 *
 * A **Nudge** asks the user for something (`CONTEXT.md`). Today may show at
 * most one, ever. Before this, mobile could stack three at once — update
 * banner, what's-new banner and the recalibration card — above the rings,
 * which is the thing the screen exists for. The web app has had this gate
 * since `c824b99d` (`activeNudge()` in `today.component.ts`); this is the
 * mobile half of the same decision, and it mirrors that shape deliberately so
 * the two cannot drift into different priorities.
 *
 * ## Why this order
 *
 * 1. **update** — the only one whose value decays. A pending OTA is a fix the
 *    user already has on disk and is not running; a store update may be the
 *    reason something else is broken. Answering it takes one tap and it does
 *    not come back.
 * 2. **healthReconnect** — one tap that does not come back (see below).
 * 3. **recalibration** — a real change to their targets that the app has
 *    already applied. It is the only Nudge carrying information the user would
 *    want even if they never act on it.
 * 4. **reminderAsk** (2026-11-19) — "Want a nudge at meal times?", asked on
 *    Today once the user has logged at least once, instead of during
 *    onboarding (0 of 43 users turned reminders on there). LOWEST: it is a
 *    preference, it waits a day without costing anything, and it must never
 *    stack on top of another ask. It cannot coincide with the first-meal card
 *    either — that one is for accounts with no entry, this one needs one
 *    (`wantsReminderAsk` in `lib/today-gate.ts`).
 * What's-new used to be third here. Since 2026-09-15 it is a full screen
 * (`app/whats-new.tsx`) opened once per release from the tab layout, so it
 * never competes for the slot — a card at caption size under a dismiss cross
 * was the shape of something to swipe past.
 *
 * Web's list additionally ranks `refine`, `push` and `install` above
 * what's-new; none of those three exist as Today cards on mobile (targets are
 * refined from Settings, notifications are an OS permission prompt, and there
 * is nothing to install). Keep the relative order if any of them ever arrive.
 *
 * ## Not covered, on purpose
 *
 * `OfflineBanner` is a **state readout**, not a Nudge: it asks for nothing,
 * cannot be dismissed, and is true for exactly as long as it is true.
 * Repeat-yesterday is a **utility** for the same reason, which is what TD1
 * reclassified it as. Neither competes for this slot, so the worst-case Today
 * is rings + repeat-yesterday + one Nudge — the shape the audit specified.
 */
export type TodayNudge = 'update' | 'healthReconnect' | 'recalibration' | 'reminderAsk' | null;

/** `recalibration` is `digest.shouldSurface` from the screen's own
 *  `useRecalibration()`, passed in so the digest is subscribed once.
 *  `healthReconnect` (2026-10-20) ranks second: like `update` it is one tap
 *  that does not come back, and until it is answered every Watch workout
 *  arrives without its heart rate. `reminderAsk` is `wantsReminderAsk(...)`
 *  and ranks last. */
export function useTodayNudge(recalibration: boolean, healthReconnect = false, reminderAsk = false): TodayNudge {
  // Called before any return — it is a hook, and skipping it behind an early
  // return would break the rules of hooks the moment the priority changed.
  const update = useUpdateVisible();

  if (update) return 'update';
  if (healthReconnect) return 'healthReconnect';
  if (recalibration) return 'recalibration';
  if (reminderAsk) return 'reminderAsk';
  return null;
}
