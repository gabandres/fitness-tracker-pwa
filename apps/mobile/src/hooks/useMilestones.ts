import { useEffect, useMemo, useRef, useState } from 'react';
import {
  dayKeyAt,
  newlyEarned,
  streakMilestonesReached,
  type DayBoundary,
  type MilestoneKey,
} from '@macrolog/core';
import {
  hasAnyCompletedFast,
  hasAnyCompletedWorkout,
  recordMilestone,
  subscribeMilestones,
} from '@/lib/ledger';

/**
 * The milestone record: what is on file, and what was recorded today.
 *
 * ## Where evaluation happens, and the honest cost of that
 *
 * #109 argued detection belongs at the WRITE that creates the thing, so
 * `earnedAt` is when it happened rather than when the app noticed. That holds
 * for events. It cannot hold for the derived milestones — a streak length is not
 * an event, and nothing writes when it ticks over — so those are evaluated where
 * the number already exists, which is Today.
 *
 * The consequence is stated rather than hidden: for a user who logs on Monday
 * and opens the app on Wednesday, a streak milestone is dated Wednesday. The
 * archive therefore says **Recorded**, never "Achieved on", and no surface in
 * this app quotes a milestone date as if it were the moment of the act.
 *
 * ## The probes are gated, so a settled account pays nothing
 *
 * `first-fast` and `first-workout` live in collections Today does not subscribe.
 * Each is one `limit(1)` read, attempted only while the milestone is unrecorded
 * and at most once per mount. Once earned, the gate closes permanently and the
 * hook issues no reads at all beyond its own listener.
 *
 * ## Not evaluated here, deliberately
 *
 * `first-scan`, `meals-100` and `goal-reached` are declared in the core union
 * and in `firestore.rules` — so shipping them later needs no rules deploy — but
 * are NOT awarded. Each is blocked on data this app does not have:
 *
 * - **`first-scan`** — `FoodSource` is `barcode | label | text | manual`. A
 *   photo-scanned log is indistinguishable from a typed one after the fact.
 * - **`meals-100`** — needs a lifetime count. `subscribeRecentLogs` is a bounded
 *   rolling window (ADR-0004), and reading it as a lifetime total is precisely
 *   the footgun `CONTEXT.md` "Time windows over logs" warns about.
 * - **`goal-reached`** — `users/{uid}/dailyWeights/{dateKey}` is `{ weight }`
 *   with **no `source`**, so a hand-typed weigh-in and an auto-imported one are
 *   the same document. `goalReached()` requires manual provenance for a reason
 *   this project has measured — one stray 158 lb import moved maintenance from
 *   2,741 to 1,619 kcal — and awarding off a purely imported trend is the exact
 *   failure the guard exists to prevent. The fix is a confirmation step, not a
 *   weaker predicate.
 */
export interface MilestonesState {
  /** Everything on file, key → when it was recorded. */
  earned: Record<string, Date>;
  /** Recorded today. Empty on almost every day, which is the intent. */
  todays: MilestoneKey[];
  /** False until the listener has answered — nothing may be written before. */
  ready: boolean;
}

export interface MilestoneEvidence {
  uid: string | null | undefined;
  /** Current consecutive-day streak, as Today already computes it. */
  streak: number;
  /** Whether any weigh-in exists at all. */
  hasWeighIn: boolean;
  boundary: DayBoundary;
}

/**
 * READ-ONLY view of the record. The archive screen uses this.
 *
 * Split from {@link useMilestones} deliberately rather than reusing it with
 * empty evidence: a read-only caller must be structurally incapable of writing,
 * not merely passing arguments that happen to evaluate to nothing. The archive
 * opening should never be able to record a milestone.
 */
export function useMilestoneRecord(uid: string | null | undefined): {
  earned: Record<string, Date>;
  ready: boolean;
} {
  const [earned, setEarned] = useState<Record<string, Date>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!uid) {
      setEarned({});
      setReady(false);
      return;
    }
    setReady(false);
    const unsub = subscribeMilestones(
      uid,
      (rows) => {
        setEarned(rows);
        setReady(true);
      },
      () => setReady(false),
    );
    return unsub;
  }, [uid]);

  return { earned, ready };
}

export function useMilestones(ev: MilestoneEvidence): MilestonesState {
  const { uid, streak, hasWeighIn, boundary } = ev;

  const [earned, setEarned] = useState<Record<string, Date>>({});
  const [ready, setReady] = useState(false);
  // One probe attempt per mount, per collection. A `useRef` rather than state:
  // flipping it must not schedule a render, and it must not re-run the effect.
  const probed = useRef({ fast: false, workout: false });

  useEffect(() => {
    if (!uid) {
      setEarned({});
      setReady(false);
      return;
    }
    setReady(false);
    const unsub = subscribeMilestones(
      uid,
      (rows) => {
        setEarned(rows);
        setReady(true);
      },
      // A record that cannot be read is not worth an error surface: the app
      // simply records nothing this session and tries again next launch.
      () => setReady(false),
    );
    return unsub;
  }, [uid]);

  // ── Evaluate and record ──────────────────────────────────────────────
  //
  // Gated on `ready` so nothing is written before the listener has said what is
  // already on file — without that, every cold start would re-attempt every
  // milestone the account has ever earned. The writes are still idempotent and
  // the rules would still deny them, but a burst of denied writes on every
  // launch is a cost with no upside.
  useEffect(() => {
    if (!uid || !ready) return;
    let alive = true;

    void (async () => {
      const candidates: MilestoneKey[] = [...streakMilestonesReached(streak)];
      if (hasWeighIn) candidates.push('first-weigh-in');

      // Probes, each gated on the milestone being unrecorded. `newlyEarned`
      // filters again below, so a probe answering true is not itself a write.
      if (!earned['first-fast'] && !probed.current.fast) {
        probed.current.fast = true;
        try {
          if (await hasAnyCompletedFast(uid)) candidates.push('first-fast');
        } catch {
          // Offline or denied — try again next mount.
          probed.current.fast = false;
        }
      }
      if (!earned['first-workout'] && !probed.current.workout) {
        probed.current.workout = true;
        try {
          if (await hasAnyCompletedWorkout(uid)) candidates.push('first-workout');
        } catch {
          probed.current.workout = false;
        }
      }

      if (!alive) return;
      const fresh = newlyEarned(Object.keys(earned), candidates);
      // Sequential rather than Promise.all: this is never more than a handful of
      // documents, it is entirely off the critical path, and a burst of parallel
      // writes on a cold start competes with the listeners Today is opening.
      for (const key of fresh) {
        if (!alive) return;
        await recordMilestone(uid, key);
      }
    })();

    return () => {
      alive = false;
    };
  }, [uid, ready, streak, hasWeighIn, earned]);

  const todays = useMemo(() => {
    const today = dayKeyAt(new Date(), boundary);
    return (Object.keys(earned) as MilestoneKey[]).filter(
      (k) => dayKeyAt(earned[k], boundary) === today,
    );
  }, [earned, boundary]);

  return { earned, todays, ready };
}
