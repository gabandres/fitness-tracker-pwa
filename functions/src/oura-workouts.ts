import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getOuraAccessToken, ouraClientSecret } from "./oura-link";

// ─── Oura Cloud API — the workout fetch (issue #72) ──────────────────
//
// WHY THIS IS A SERVER FUNCTION AT ALL. Only because of the credential.
// The refresh token lives at `users/{uid}/private/oura`, which matches no
// rule in `firestore.rules` and is therefore denied to every client by the
// `match /{document=**}` catch-all — that denial IS the access control, and
// two rules specs pin it. So a client cannot hold an Oura access token, and
// the one thing that must happen server-side is *making the authenticated
// request*. Nothing else here needs to be.
//
// WHY IT DOES NOT UNDERSTAND THE PAYLOAD. `functions/` is not an npm
// workspace and cannot import `@macrolog/core` — the constraint `locales.ts`
// and `food-plausibility.ts` already record. The parser therefore lives in
// core (`packages/core/src/oura-workouts.ts`), where it is pure, unit-tested
// without a ring, and shared with the importer that consumes it. Duplicating
// it here would create the second copy `usda-search` already pays a golden
// fixture to keep honest, for no gain: this endpoint has no reason to know
// what a workout is.
//
// So this is a THIN AUTHENTICATED PROXY. It holds the credential, walks the
// pagination, and returns Oura's records untouched. That is deliberately the
// least it can do, and the least it can get wrong.

/** `GET /v2/usercollection/workout`. */
const WORKOUT_URL = "https://api.ouraring.com/v2/usercollection/workout";

/**
 * How far back a fetch may look, and the default.
 *
 * The default matches `WORKOUT_IMPORT_DAYS` on the client's health-store
 * path, so the two transports cover the same window and neither quietly sees
 * further than the other. The ceiling is a bound on how much one call can ask
 * Oura for, not a product limit.
 */
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

/**
 * Pagination stops here.
 *
 * Oura returns `next_token` and there is no documented ceiling on how many
 * pages a range can produce, so an unbounded `while` is a loop whose exit
 * condition is a third party's. Six pages is far past any real training log
 * for a 60-day window; hitting it means something is wrong, and the response
 * SAYS SO (`truncated`) rather than silently returning a prefix that looks
 * like a complete answer.
 */
const MAX_PAGES = 6;

/** A hung endpoint would otherwise hold a function instance for the full
 *  request timeout. Matches `postToken`'s budget in `oura-link.ts`. */
const FETCH_TIMEOUT_MS = 15_000;

/** `YYYY-MM-DD` in UTC — the format `start_date` / `end_date` take. UTC on
 *  purpose: this only bounds the REQUEST, and which local day a workout is
 *  filed under is decided on the client from the workout's own start time.
 *  Mirrors `ouraDateParam` in core, which is where the client's copy lives;
 *  four lines is a cheaper duplicate than a workspace dependency. */
export function dateParam(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A caller-supplied window, bounded — or the default when there isn't one.
 *
 * **Emptiness is checked BEFORE coercion**, which is the whole of this
 * function's difficulty: `Number(null)` and `Number("")` are both `0`, so a
 * naive coerce-then-clamp turns "the client sent no `days`" into a 1-day
 * window and imports one day of workouts where 14 were meant. Nothing errors
 * and the result looks like a quiet ring. `clampRpe` in `@macrolog/core`
 * documents the identical trap; this is the same guard for the same reason.
 */
export function clampDays(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_DAYS;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, Math.floor(n)));
}

/** What a fetch returns, whatever happened. `linked: false` is an ordinary
 *  state, not an error — see {@link collectWorkouts}. */
export interface OuraWorkoutFetch {
  linked: boolean;
  data: unknown[];
  truncated: boolean;
}

/** Just enough of `fetch` to be substitutable in a test. */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Walk Oura's pagination and return the raw records.
 *
 * Separated from the callable, and taking its `fetch` as an argument, because
 * this loop is the part that can actually be wrong — an exit condition owned
 * by a third party, a status code that means "reconnect" rather than "retry",
 * and a truncation that must not look like a complete answer. Testing it
 * needs a stub response and nothing else: no emulator, no secret, no ring.
 *
 * Returns `linked: false` when Oura rejects the token. That is not an error
 * the user should see as a failure: it means the grant is gone at Oura's end
 * and the honest UI is "reconnect". The stored credential is deliberately left
 * in place — deleting it here would turn a transient Oura fault into a silent
 * disconnection the user never asked for.
 *
 * Throws only when Oura fails in a way that IS transient (5xx, network), so
 * the caller can say "try again" and mean it.
 */
export async function collectWorkouts(
  token: string,
  days: number,
  uid: string,
  fetchImpl: Fetcher = fetch,
  nowMs: number = Date.now(),
): Promise<OuraWorkoutFetch> {
  const params = new URLSearchParams({
    start_date: dateParam(nowMs - days * 86_400_000),
    // Tomorrow, not today: `end_date` is a calendar day in the user's own
    // timezone as Oura sees it, and a workout finished this evening east of
    // UTC already falls on tomorrow's date there. Asking for one extra day
    // costs nothing and is the difference between importing today's run and
    // importing it once tomorrow arrives.
    end_date: dateParam(nowMs + 86_400_000),
  });

  const data: unknown[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchImpl(`${WORKOUT_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 401 || res.status === 403) {
      console.warn(`fetchOuraWorkouts: oura rejected the token uid=${uid} status=${res.status}`);
      return { linked: false, data: [], truncated: false };
    }
    if (!res.ok) {
      // Never echo the body — an error payload from an authenticated endpoint
      // can carry back more than the error.
      console.error(`fetchOuraWorkouts: oura returned ${res.status} uid=${uid}`);
      throw new HttpsError("unavailable", "Could not reach Oura.");
    }

    const body = (await res.json()) as { data?: unknown; next_token?: unknown };
    if (Array.isArray(body?.data)) data.push(...body.data);

    const next = typeof body?.next_token === "string" ? body.next_token : "";
    if (!next) return { linked: true, data, truncated: false };
    params.set("next_token", next);
  }

  // The loop ran its whole budget and Oura still had more. SAY SO — a silent
  // prefix is indistinguishable from a complete answer, and the client shows
  // the user a partial history that looks total.
  console.warn(`fetchOuraWorkouts: hit MAX_PAGES uid=${uid}`);
  return { linked: true, data, truncated: true };
}

/**
 * Fetch the caller's Oura workouts for the last N days.
 *
 * Returns Oura's own record objects, unparsed. The client runs them through
 * `parseOuraWorkouts` and then the SAME import pipeline the health store
 * feeds — `importableWorkouts` → `toCardioBlockFromHealth` →
 * `mergeImportedBlocks` — so a run that arrives by both roads is one code
 * path from here on.
 *
 * ## Not behind `dailyQuota` / `spendCeiling`, and why
 *
 * Those two guards exist for **AI-cost** callables (CLAUDE.md → cost
 * discipline): a per-user fairness cap and a whole-project solvency cap on
 * money that leaves the account per call. Nothing here spends money. The real
 * exposure is Oura's own rate limit and function-instance time, which
 * `maxInstances`, `MAX_PAGES` and the fetch timeout bound directly. Adding a
 * spend ceiling to a call that spends nothing would dilute what that guard
 * means everywhere else it appears.
 *
 * ## No scheduler job
 *
 * This is pulled on demand — app foreground and a manual *Sync now* — exactly
 * like the health-store import. Cloud Scheduler's free tier is 3 jobs and all
 * 3 are spent; if this ever becomes recurring it folds into `hourlyTasks`,
 * never a fourth `onSchedule`.
 */
export const fetchOuraWorkouts = onCall(
  { secrets: [ouraClientSecret], maxInstances: 3 },
  async (request): Promise<OuraWorkoutFetch> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const days = clampDays((request.data as { days?: unknown } | undefined)?.days);

    const token = await getOuraAccessToken(uid, ouraClientSecret.value());
    // No credential is an ordinary state — the user never connected, or
    // revoked at Oura's end — and the client renders it as "not connected",
    // not as a failure. It is also what a refresh that could not complete
    // returns, deliberately: `getOuraAccessToken` cannot tell a revoked grant
    // from an Oura outage without parsing an error body it has chosen not to
    // read, so it leaves the link in place and yields no token this time.
    if (!token) return { linked: false, data: [], truncated: false };

    const out = await collectWorkouts(token, days, uid);
    console.log(`fetchOuraWorkouts: uid=${uid} days=${days} records=${out.data.length}`);
    return out;
  },
);
