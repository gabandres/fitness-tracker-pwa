import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { getOuraAccessToken, integrationDoc, ouraClientSecret } from "./oura-link";
import { collectRange } from "./oura-workouts";

// ─── Oura Cloud API — daily sleep and activity (ADR-0026, `daily` scope) ──
//
// A sibling of `oura-workouts.ts` and the same THIN AUTHENTICATED PROXY: it
// holds the credential, walks the pagination, and returns Oura's records
// untouched. It does not know what a sleep record is — `parseOuraDaily` in
// `packages/core` does, where it is pure and testable without a ring, and
// `functions/` cannot import that package anyway.
//
// WHY A SEPARATE CALLABLE from `fetchOuraWorkouts`. Two collections, two
// scopes' worth of failure, and one of them can 403 while the other succeeds —
// folding them into one response would mean a partial failure had nowhere to
// go except an exception that loses the half that worked.

/** Daily activity totals: `steps`, `active_calories`. */
const ACTIVITY_URL = "https://api.ouraring.com/v2/usercollection/daily_activity";
/** Sleep PERIODS, which is where `total_sleep_duration` lives.
 *
 *  Deliberately NOT `daily_sleep`: that endpoint returns a sleep *score* and its
 *  contributors, not a duration, and Ignia stores hours. Checked against Oura's
 *  published v2 schema — `total_sleep_duration` is seconds on a sleep period. */
const SLEEP_URL = "https://api.ouraring.com/v2/usercollection/sleep";

export interface OuraDailyFetch {
  linked: boolean;
  activity: unknown[];
  sleep: unknown[];
  truncated: boolean;
  /** Set when Oura accepted the token but refused a collection — which is what
   *  a missing scope looks like from here. The client turns this into
   *  "reconnect to include sleep" rather than a generic failure. */
  scopeDenied: boolean;
}

/**
 * Fetch the caller's daily sleep and activity for the last N days.
 *
 * **Each collection is fetched independently and a failure in one does not
 * lose the other.** That is the whole reason this is not a single `Promise.all`
 * that rejects: `daily_activity` and `sleep` are separate endpoints, and if
 * Oura's scope mapping refuses one of them, importing the other is still worth
 * doing — and telling the user *which* half is missing is worth more than a
 * blanket error.
 *
 * A `linked: false` from either half means the grant is gone at Oura's end;
 * that propagates, because nothing can be imported without a token.
 */
export const fetchOuraDaily = onCall(
  { secrets: [ouraClientSecret], maxInstances: 3 },
  async (request): Promise<OuraDailyFetch> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const raw = (request.data as { days?: unknown } | undefined)?.days;
    const days = raw == null || raw === "" ? 14 : Math.min(60, Math.max(1, Math.floor(Number(raw) || 14)));

    const token = await getOuraAccessToken(uid, ouraClientSecret.value());
    if (!token) return { linked: false, activity: [], sleep: [], truncated: false, scopeDenied: false };

    // `allSettled`, not `all`: a rejection in one collection must not discard a
    // successful other. `collectRange` throws only on transient Oura faults.
    const [act, slp] = await Promise.allSettled([
      collectRange(ACTIVITY_URL, token, days, uid),
      collectRange(SLEEP_URL, token, days, uid),
    ]);

    const activity = act.status === "fulfilled" ? act.value : null;
    const sleep = slp.status === "fulfilled" ? slp.value : null;

    // Both halves reporting `linked: false` is a revoked grant. ONE half saying
    // so is the signature of a scope the user never granted — Oura answers 403
    // for that, which `collectRange` maps to `linked: false`.
    const bothUnlinked = activity?.linked === false && sleep?.linked === false;
    const oneUnlinked = activity?.linked === false || sleep?.linked === false;

    if (bothUnlinked) {
      return { linked: false, activity: [], sleep: [], truncated: false, scopeDenied: false };
    }

    const out: OuraDailyFetch = {
      linked: true,
      activity: activity?.linked ? activity.data : [],
      sleep: sleep?.linked ? sleep.data : [],
      truncated: activity?.truncated === true || sleep?.truncated === true,
      scopeDenied: oneUnlinked,
    };

    console.log(
      `fetchOuraDaily: uid=${uid} days=${days} activity=${out.activity.length} sleep=${out.sleep.length} scopeDenied=${out.scopeDenied}`,
    );

    // Same best-effort stamp as the workout fetch — the Connected apps screen
    // reads it, and a client cannot write it (`allow write: if false`).
    await integrationDoc(uid)
      .set({ lastSyncedAt: Timestamp.now() }, { merge: true })
      .catch((err) => console.warn(`fetchOuraDaily: last-sync stamp failed uid=${uid}:`, err));

    return out;
  },
);
