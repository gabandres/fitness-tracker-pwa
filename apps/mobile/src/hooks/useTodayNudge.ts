import { useRecalibrationVisible } from '@/components/RecalibrationCard';
import { useUpdateVisible } from '@/components/UpdateBanner';
import { useWhatsNewVisible } from '@/components/WhatsNewBanner';

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
 * 2. **recalibration** — a real change to their targets that the app has
 *    already applied. It is the only Nudge carrying information the user would
 *    want even if they never act on it.
 * 3. **whatsNew** — marketing about a release they are already running. It
 *    waits, and losing it entirely costs nothing.
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
export type TodayNudge = 'update' | 'recalibration' | 'whatsNew' | null;

export function useTodayNudge(): TodayNudge {
  // All three are called unconditionally — they are hooks, and skipping one
  // behind an early return would break the rules of hooks the moment the
  // higher-priority Nudge appeared.
  const update = useUpdateVisible();
  const recalibration = useRecalibrationVisible();
  const whatsNew = useWhatsNewVisible();

  if (update) return 'update';
  if (recalibration) return 'recalibration';
  if (whatsNew) return 'whatsNew';
  return null;
}
