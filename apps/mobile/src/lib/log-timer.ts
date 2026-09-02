/**
 * Seconds per log — the stopwatch behind the `log_secs` usage counter.
 *
 * ## Why it exists
 *
 * The retention research this project is working from (`STATUS.md` §3,
 * retention lever 3) puts the cliff at logging speed: under ~30 s a meal
 * retains about 78% at six months, over two minutes about 23%. Nothing here
 * measured where Ignia sits. This does, as one number per saved log: seconds
 * from opening a logging surface to the log landing, summed into `log_secs`
 * and divided by `log_added` server-side (`functions/src/retention.ts`).
 *
 * ## What it measures, exactly
 *
 * The timer starts when a logging surface opens for an ADD — the entry sheet
 * (`EntrySheet`, which also hosts search, barcode and voice) or the photo scan
 * screen — and every `addEntry` that lands while it runs takes the elapsed
 * seconds and restarts it. A photo scan that logs three items therefore
 * charges the whole wait to the first item and ~0 s to the other two, which
 * is the right aggregate: three logs, one stretch of time. Closing the surface
 * without a log clears it; an edit never touches it.
 *
 * Elapsed time is capped per log at {@link LOG_SECS_CAP}. A sheet left open
 * while the phone sits on a table measures a distraction, not the product,
 * and one such reading would dominate a day's total. The research threshold
 * is two minutes; the cap sits well above it, so the "slow" bucket keeps its
 * meaning.
 *
 * Module-level state on purpose: it is one stopwatch for one user on one
 * device, the surfaces that start it and the write that reads it are in
 * different modules, and threading a ref through `useLogWrites` would put a
 * measurement concern on an interface ADR-0016 keeps deliberately small.
 */

/** Longest a single log may be credited with, in seconds. */
export const LOG_SECS_CAP = 300;

let startedAt: number | null = null;

/** A logging surface opened for an add. Restarts if one was already running. */
export function startLogTimer(now: number = Date.now()): void {
  startedAt = now;
}

/** The surface closed without a log — or with one, after it was taken. */
export function clearLogTimer(): void {
  startedAt = null;
}

/**
 * Elapsed whole seconds since the timer started, capped, and the timer
 * restarted at `now` so the next log in the same session is charged only its
 * own increment. Returns 0 when no timer is running, which is the case for
 * every write that did not come through a timed surface (quick add, repeat
 * yesterday, the widget, the watch).
 */
export function takeLogTimerSecs(now: number = Date.now()): number {
  if (startedAt == null) return 0;
  const secs = Math.max(0, Math.round((now - startedAt) / 1000));
  startedAt = now;
  return Math.min(secs, LOG_SECS_CAP);
}

/** Test seam. */
export function resetLogTimer(): void {
  startedAt = null;
}
