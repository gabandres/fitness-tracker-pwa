import type { LogSource } from '@macrolog/core';
import { recordMilestone } from './ledger';
import { recordPositiveMoment } from './reviewPrompt';

/**
 * Award `first-scan` at the write that earned it (#109).
 *
 * ## Why this lives at the write and not on a screen
 *
 * #109's rule: each of these has exactly one place it can be detected honestly,
 * and that is the write path that creates the thing. Detecting on render means
 * the award fires when a user happens to open a tab, which makes `earnedAt` a
 * lie. A photo scan IS an event, so unlike the streak milestones it can — and
 * therefore must — be caught where it happens. `useToday`'s evidence path is a
 * fallback for the one case this cannot cover (see below), never the primary.
 *
 * ## Fire-and-forget, and NEVER batched
 *
 * The caller does not await this and must not. `recordMilestone` swallows its
 * own failures, and the milestone write is a separate commit from the meal for
 * the reason #97's fix documents: a document the rules refuse fails the WHOLE
 * batch, so an award the rules reject would roll back the meal that earned it.
 * A missed milestone is a non-event; a lost meal is a bug report.
 *
 * ## The latch, and what it deliberately gives up
 *
 * One attempt per account per process, whatever the outcome — the same shape as
 * `useMilestones`' `probed` ref, and for the same reason: after the first scan
 * the milestone exists, `firestore.rules` denies the update, and every later
 * scan would issue a write that can only be refused. Latching on the ATTEMPT
 * rather than on success means a scan logged as the signal drops does not retry
 * this process. That is covered rather than ignored: the log row carries
 * `source: 'photo'`, so Today's evidence path re-offers the candidate on the
 * next mount.
 *
 * ## Why `recordPositiveMoment` fires HERE and not on the recovery path
 *
 * The review prompt is spent at a moment the user is present for — they just
 * watched a photograph turn into a logged meal. The recovery path can fire days
 * later, on a launch that has nothing to do with a win, which is exactly the
 * "requests spent at a bad moment" `reviewPrompt.ts` exists to avoid.
 */
const attempted = new Set<string>();

export async function recordScanMilestone(
  uid: string | null | undefined,
  source: LogSource | undefined,
): Promise<void> {
  if (!uid || source !== 'photo') return;
  if (attempted.has(uid)) return;
  attempted.add(uid);

  try {
    // True only when THIS call created the document — the milestones collection
    // has no `update` rule, so a second attempt is denied rather than merged.
    const newlyEarned = await recordMilestone(uid, 'first-scan');
    if (newlyEarned) await recordPositiveMoment();
  } catch {
    // Belt and braces over `recordMilestone`'s own catch. The caller does
    // `void recordScanMilestone(...)`, and a rejected floating promise is
    // reported by Sentry exactly like a crash — the failure mode `openExternal`
    // and `useHealthAutoImport` were both fixed for. A badge is never worth an
    // error report.
  }
}

/** Test hook — the latch is module state and would otherwise leak between
 *  cases. Not called by the app. */
export function resetFirstScanLatch(): void {
  attempted.clear();
}
