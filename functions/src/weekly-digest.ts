import { FieldPath, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getResend, baseSendOptions, resendApiKey } from "./resend-client";
import { weeklyDigestEmail } from "./email-templates";
import { unsubscribeUrl } from "./unsubscribe";

// ─── Weekly digest scheduler ────────────────────────────────────
//
// Runs hourly (dispatched by `hourly-tasks.ts`). Picks users where:
//   - `weeklyDigestOptIn === true`
//   - `lastWeeklyDigestSentAt` is missing OR > 6.5 days ago
//   - the current tick falls inside local hour 10 on a Sunday, per the
//     profile's `timezoneOffsetMin`.
//
// Why hourly + per-tz rather than a single Sunday-10am-UTC fire: users
// span several timezones and "Sunday morning" is the high-engagement
// window for a recap. Firing in their local Sunday-10am dodges the
// "Saturday evening UTC" shifted send for west-coast users.
//
// Aggregates the last 7 days of dailyLogs + dailyWeights server-side
// and renders the digest via the shared template. Stamps
// `lastWeeklyDigestSentAt` to suppress duplicates the next tick.
//
// ─── The window is 7 LOCAL DAYS, not 7×24 hours ─────────────────
//
// This distinction is the whole reason for the day-key helpers below, and
// getting it wrong shipped a real email: a rolling `now - 7×24h` cutoff
// spans EIGHT calendar days for anyone whose send hour is not midnight, so
// the digest printed "Days logged 8 / 7" — a metric out of its own range,
// on the one line of the mail a reader is most likely to check.
//
// The same window silently capped the streak. Every date key came from that
// one 7-day query, so a 60-day streak could only ever be reported as 8.
// `computeStreak` therefore pages BACKWARDS past the window, and stops the
// moment it finds a real gap — which for most users is zero extra reads.

const SEND_GUARD_MS = 6.5 * 24 * 60 * 60 * 1000;
const TARGET_LOCAL_HOUR = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;

/** How far back a pre-window weigh-in may sit and still serve as the delta
 *  baseline. Beyond this it stops being "this week's change". */
const WEIGHT_BASELINE_LOOKBACK_MS = 14 * DAY_MS;

/** Docs per backwards page when walking a streak, and the ceiling on pages.
 *  300 docs is ~2–3 months for a typical logger; 5 pages is the backstop that
 *  keeps one pathological account from reading its whole history. */
const STREAK_PAGE_SIZE = 300;
const STREAK_MAX_PAGES = 5;

// ─── Local-day arithmetic ───────────────────────────────────────
//
// `timezoneOffsetMin` is `Date.prototype.getTimezoneOffset()` — minutes WEST
// of UTC, so UTC-5 is +300. Shifting an instant by it puts us in a space
// where UTC calendar arithmetic *is* local calendar arithmetic, which is why
// every helper here works on "shifted ms" and only converts back at the
// query boundary. It is a fixed offset, not a real zone, so day boundaries
// stay exactly DAY_MS apart across a DST change — the client re-reports its
// offset whenever it writes the profile.

function toShifted(ms: number, tzOffsetMin: number): number {
  return ms - tzOffsetMin * 60 * 1000;
}

function fromShifted(shiftedMs: number, tzOffsetMin: number): number {
  return shiftedMs + tzOffsetMin * 60 * 1000;
}

/** `YYYY-MM-DD` for an instant already in shifted space. Keys are
 *  lexicographically ordered, which the streak walk relies on. */
export function dayKeyOfShifted(shiftedMs: number): string {
  return new Date(shiftedMs).toISOString().slice(0, 10);
}

export interface DigestWindow {
  /** Carried so every consumer keys days the same way the window was built. */
  tzOffsetMin: number;
  /** Real (unshifted) ms of the window's first instant — the Firestore cutoff. */
  startMs: number;
  /** Shifted ms of local midnight today; the streak walk starts here. */
  todayShiftedMs: number;
  /** Exactly 7 keys, oldest first, ending on today's local date. */
  keys: string[];
}

/** The 7 local days ending today. Structurally 7 — `daysLogged` cannot
 *  exceed its own denominator because it counts members of this set. */
export function digestWindow(nowMs: number, tzOffsetMin: number): DigestWindow {
  const todayShiftedMs = Math.floor(toShifted(nowMs, tzOffsetMin) / DAY_MS) * DAY_MS;
  const startShiftedMs = todayShiftedMs - (WINDOW_DAYS - 1) * DAY_MS;
  return {
    tzOffsetMin,
    startMs: fromShifted(startShiftedMs, tzOffsetMin),
    todayShiftedMs,
    keys: Array.from({ length: WINDOW_DAYS }, (_, i) =>
      dayKeyOfShifted(startShiftedMs + i * DAY_MS)),
  };
}

/**
 * Consecutive-day streak over the day keys loaded so far, counting back from
 * today (or yesterday, so it doesn't visibly drop to 0 until a full day is
 * missed). Mirrors `computeStreak` in `packages/core/src/streak.ts` with
 * `freezeMaxGap = 0` — the digest always reports the raw walked streak, never
 * a freeze-forgiven one, so the number in the mail can only understate.
 *
 * `needMore` is the honest half: it says the walk ran off the oldest day we
 * have loaded, so the "gap" that stopped it may be missing data rather than a
 * missed day. The caller pages further back and re-walks.
 */
export function walkStreak(
  dates: Set<string>,
  todayShiftedMs: number,
  oldestLoadedKey: string | null,
): { streak: number; needMore: boolean } {
  let cursor = todayShiftedMs;
  if (!dates.has(dayKeyOfShifted(cursor))) {
    cursor -= DAY_MS;
    if (!dates.has(dayKeyOfShifted(cursor))) return { streak: 0, needMore: false };
  }
  let streak = 0;
  while (dates.has(dayKeyOfShifted(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }
  const brokeAtKey = dayKeyOfShifted(cursor);
  return {
    streak,
    needMore: oldestLoadedKey != null && brokeAtKey < oldestLoadedKey,
  };
}

interface DailyLogDoc {
  timestamp: Timestamp;
  calories?: number;
  protein?: number;
  weight?: number;
}

interface DailyWeightDoc {
  date?: Timestamp;
  weight?: number;
}

/**
 * Rebuild the `date` a dailyWeights doc does not store.
 *
 * The doc ID IS the date, as a LOCAL day key — so it is resolved back through
 * the same shift the day-key helpers use, not `Date.parse` of a bare key, which
 * would place it at UTC midnight and mis-sort a weigh-in against the window
 * edge by up to a day. A malformed ID yields no date, and `computeWeightDelta`
 * already treats a doc without one as invalid.
 */
export function weightDocFromId(
  id: string,
  data: FirebaseFirestore.DocumentData,
  tzOffsetMin: number,
): DailyWeightDoc {
  const weight = (data as DailyWeightDoc).weight;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return { weight };
  return {
    date: Timestamp.fromMillis(fromShifted(Date.parse(`${id}T00:00:00Z`), tzOffsetMin)),
    weight,
  };
}

function isSundayLocalHour(timezoneOffsetMin: number | undefined, nowMs: number): boolean {
  // Profile's `timezoneOffsetMin` is `Date.prototype.getTimezoneOffset()`
  // (minutes WEST of UTC, so a +5 offset means UTC-5). Convert to local
  // ms by subtracting the offset.
  const offsetMs = (timezoneOffsetMin ?? 0) * 60 * 1000;
  const localMs = nowMs - offsetMs;
  const local = new Date(localMs);
  const day = local.getUTCDay(); // 0 = Sunday
  if (day !== 0) return false;
  const hour = local.getUTCHours();
  return hour === TARGET_LOCAL_HOUR;
}

interface DigestStats {
  avgCalories: number | null;
  avgProtein: number | null;
  weightDeltaLbs: number | null;
  daysLogged: number;
  streak: number;
}

/**
 * Streak, continued backwards past the digest window.
 *
 * `seedDates` already holds every day key inside the window, so the common
 * case — a streak of 7 or fewer — resolves with **no extra reads at all**.
 * Only a streak that runs to the window's edge pages further back, and each
 * page stops the moment a real gap appears.
 */
async function computeStreak(
  uid: string,
  seedDates: Set<string>,
  window: DigestWindow,
): Promise<number> {
  const db = getFirestore();
  const dates = new Set(seedDates);
  // Everything from the window start onwards is loaded, so that is the
  // oldest day we can reason about until we read further back.
  let oldestLoadedKey: string | null = window.keys[0];
  let cursorTs = Timestamp.fromMillis(window.startMs);

  let result = walkStreak(dates, window.todayShiftedMs, oldestLoadedKey);

  for (let page = 0; result.needMore && page < STREAK_MAX_PAGES; page++) {
    const snap = await db.collection(`users/${uid}/dailyLogs`)
      .where("timestamp", "<", cursorTs)
      .orderBy("timestamp", "desc")
      .limit(STREAK_PAGE_SIZE)
      .select("timestamp")
      .get();
    if (snap.empty) break; // No older logs: the gap the walk found is real.

    let oldestTs = cursorTs;
    for (const d of snap.docs) {
      const ts = d.get("timestamp");
      if (!(ts instanceof Timestamp)) continue;
      dates.add(dayKeyOfShifted(toShifted(ts.toMillis(), window.tzOffsetMin)));
      oldestTs = ts; // desc order — the last valid one is the oldest.
    }
    oldestLoadedKey = dayKeyOfShifted(toShifted(oldestTs.toMillis(), window.tzOffsetMin));
    // Strictly-less paging can skip a sibling written in the same
    // millisecond, which is harmless: it shares its day key with the doc we
    // did read, and day keys are all this walk consumes.
    cursorTs = oldestTs;
    result = walkStreak(dates, window.todayShiftedMs, oldestLoadedKey);

    if (page === STREAK_MAX_PAGES - 1 && result.needMore) {
      // Understate rather than guess. Visible in logs so a genuinely
      // enormous history is distinguishable from a bug.
      console.warn(`sendWeeklyDigest: streak walk hit the page ceiling uid=${uid}`);
    }
  }

  return result.streak;
}

async function computeStatsForUser(
  uid: string,
  nowMs: number,
  tzOffsetMin: number,
): Promise<DigestStats> {
  const db = getFirestore();
  const window = digestWindow(nowMs, tzOffsetMin);
  const windowKeys = new Set(window.keys);
  const startTs = Timestamp.fromMillis(window.startMs);

  const [logsSnap, inWindowWeights, priorWeight] = await Promise.all([
    db.collection(`users/${uid}/dailyLogs`)
      .where("timestamp", ">=", startTs)
      .get(),
    // Keyed by DOCUMENT ID, which is the whole point: a dailyWeights doc is
    // `users/{uid}/dailyWeights/{YYYY-MM-DD} -> { weight }` and carries NO
    // `date` field. Both queries here used to filter and order on `date`, and
    // Firestore silently omits documents that lack the ordered field — so they
    // matched ZERO docs for every user, forever. `computeWeightDelta` then got
    // an empty list, correctly returned null, and the mail printed an em dash
    // that read as "you did not weigh in" rather than "this query is broken".
    // Measured 2026-08-23: an account with 126 weigh-ins reported "—".
    // Ordering by `__name__` DESCENDING needs the explicit index that
    // firestore.indexes.json already carries for this collection.
    db.collection(`users/${uid}/dailyWeights`)
      .where(FieldPath.documentId(), ">=", window.keys[0])
      .where(FieldPath.documentId(), "<=", window.keys[window.keys.length - 1])
      .orderBy(FieldPath.documentId(), "asc")
      .get(),
    // One reading from just before the window, so a user who weighs in
    // weekly still gets a number instead of an em dash.
    db.collection(`users/${uid}/dailyWeights`)
      .where(FieldPath.documentId(), "<", window.keys[0])
      .orderBy(FieldPath.documentId(), "desc")
      .limit(1)
      .get(),
  ]);

  // Group by the user's LOCAL day. Keys outside the window are dropped —
  // a log stamped in the future (client clock skew) must not invent an
  // eighth day.
  const byDay = new Map<string, { kcal: number; protein: number; hadProtein: boolean }>();
  for (const d of logsSnap.docs) {
    const data = d.data() as DailyLogDoc;
    if (!(data.timestamp instanceof Timestamp)) continue;
    const key = dayKeyOfShifted(toShifted(data.timestamp.toMillis(), tzOffsetMin));
    if (!windowKeys.has(key)) continue;
    const entry = byDay.get(key) ?? { kcal: 0, protein: 0, hadProtein: false };
    entry.kcal += data.calories ?? 0;
    if (typeof data.protein === "number") {
      entry.protein += data.protein;
      entry.hadProtein = true;
    }
    byDay.set(key, entry);
  }

  const days = [...byDay.values()];
  const daysLogged = days.length; // ≤ 7 by construction of `windowKeys`.
  const avgCalories = daysLogged > 0
    ? Math.round(days.reduce((a, b) => a + b.kcal, 0) / daysLogged)
    : null;
  const proteinDays = days.filter((d) => d.hadProtein);
  const avgProtein = proteinDays.length > 0
    ? Math.round(proteinDays.reduce((a, b) => a + b.protein, 0) / proteinDays.length)
    : null;

  const weightDeltaLbs = computeWeightDelta(
    inWindowWeights.docs.map((d) => weightDocFromId(d.id, d.data(), tzOffsetMin)),
    priorWeight.docs[0]
      ? weightDocFromId(priorWeight.docs[0].id, priorWeight.docs[0].data(), tzOffsetMin)
      : undefined,
    window.startMs,
  );

  const streak = await computeStreak(uid, new Set(byDay.keys()), window);

  return { avgCalories, avgProtein, weightDeltaLbs, daysLogged, streak };
}

/** Latest weigh-in minus a baseline. The baseline is the last reading BEFORE
 *  the window when there is a recent one (that is the true "start of week"
 *  weight), else the first reading inside it. Returns null rather than a
 *  fabricated 0.0 when there is only one data point. */
export function computeWeightDelta(
  inWindow: DailyWeightDoc[],
  prior: DailyWeightDoc | undefined,
  windowStartMs: number,
): number | null {
  const valid = (d: DailyWeightDoc | undefined): d is DailyWeightDoc & { date: Timestamp; weight: number } =>
    !!d && d.date instanceof Timestamp && typeof d.weight === "number";

  const points = inWindow.filter(valid);
  if (points.length === 0) return null;

  const latest = points[points.length - 1].weight;
  let baseline: number | null = null;
  if (valid(prior) && prior.date.toMillis() >= windowStartMs - WEIGHT_BASELINE_LOOKBACK_MS) {
    baseline = prior.weight;
  } else if (points.length >= 2) {
    baseline = points[0].weight;
  }
  if (baseline == null) return null;

  return Math.round((latest - baseline) * 10) / 10;
}

// Plain async task run by the hourly dispatcher (`hourly-tasks.ts`).
// The dispatcher owns the schedule, the resend secret binding, and the
// 512MiB / 540s config that this per-user aggregation needs.
export async function runWeeklyDigest(): Promise<void> {
    const db = getFirestore();
    const nowMs = Date.now();

    const optInSnap = await db.collection("users")
      .where("weeklyDigestOptIn", "==", true)
      .get();

    if (optInSnap.empty) {
      console.log("sendWeeklyDigest: no opt-in users");
      return;
    }

    let attempted = 0;
    let sent = 0;
    let skipped = 0;

    for (const doc of optInSnap.docs) {
      const uid = doc.id;
      const data = doc.data();
      const lastSent = data["lastWeeklyDigestSentAt"] as Timestamp | undefined;
      if (lastSent && nowMs - lastSent.toMillis() < SEND_GUARD_MS) {
        skipped++;
        continue;
      }
      const tzOffset = data["timezoneOffsetMin"] as number | undefined;
      if (!isSundayLocalHour(tzOffset, nowMs)) {
        skipped++;
        continue;
      }
      // Email is no longer on the profile doc (PII minimization) — fetch
      // from Auth by uid. Legacy docs may still carry it (preferred, saves
      // an Auth read). Skip if the account has no email at all.
      const email =
        (data["email"] as string | undefined) ??
        (await getAuth().getUser(uid).then((u) => u.email).catch(() => undefined));
      if (!email) {
        skipped++;
        continue;
      }

      attempted++;
      const stats = await computeStatsForUser(uid, nowMs, tzOffset ?? 0);
      // Skip users who haven't logged anything this week. Sending a
      // "0 / 7 days · 0 kcal" email to a lapsed user reads as nagging.
      if (stats.daysLogged === 0) {
        skipped++;
        continue;
      }

      // At-most-once: claim the send by transactionally stamping
      // `lastWeeklyDigestSentAt` BEFORE calling Resend. If a second
      // scheduler tick races us (overlapping invocations on a slow
      // run), it'll see the stamp and skip the user. Trade-off: a
      // Resend failure after the stamp means the user misses this
      // week's digest. That's the right trade — duplicate weekly
      // digests are spam-flag bait; a missed week is invisible.
      const userRef = db.doc(`users/${uid}`);
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return false;
        const last = snap.data()?.["lastWeeklyDigestSentAt"] as Timestamp | undefined;
        if (last && nowMs - last.toMillis() < SEND_GUARD_MS) return false;
        tx.set(userRef, { lastWeeklyDigestSentAt: Timestamp.fromMillis(nowMs) }, { merge: true });
        return true;
      });
      if (!claimed) {
        skipped++;
        continue;
      }

      const locale: "en" | "es-PR" = data["preferredLocale"] === "es-PR" ? "es-PR" : "en";
      const displayName = (data["displayName"] as string | undefined)
        || (await getAuth().getUser(uid).then((u) => u.displayName).catch(() => null));

      // Per-recipient one-click opt-out. Goes in both the RFC 8058 header
      // and the visible footer — a recipient who wants out and cannot find
      // the affordance reports spam instead, which is the one signal that
      // costs the sending domain real reputation.
      const unsubUrl = unsubscribeUrl(uid, resendApiKey.value());

      const { subject, html, text } = weeklyDigestEmail({
        locale,
        displayName,
        ...stats,
        unsubscribeUrl: unsubUrl,
      });

      try {
        const resend = getResend();
        const { error } = await resend.emails.send({
          ...baseSendOptions(unsubUrl),
          to: email,
          subject,
          html,
          text,
        });
        if (error) {
          // Stamp already claimed above; we deliberately do NOT roll it
          // back. See comment on the transaction.
          console.error(`sendWeeklyDigest: Resend error uid=${uid}`, error);
          continue;
        }
        sent++;
      } catch (err) {
        console.error(`sendWeeklyDigest: unexpected failure uid=${uid}`, err);
      }
    }

    console.log(`sendWeeklyDigest: attempted=${attempted} sent=${sent} skipped=${skipped}`);
}
