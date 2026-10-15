import { getAuth } from "firebase-admin/auth";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db } from "./init";
import {
  baseSendOptions,
  getResend,
  resendApiKey,
  transactionalSendOptions,
} from "./resend-client";

// ─── Owner ping on new in-app feedback ──────────────────────────────
//
// One email per report, sent the moment a user files one. Temporary by
// request: the owner wants to be pinged while the feedback surface is new,
// and this is meant to be easy to switch off again.
//
// **Why a Firestore trigger and not the hourly dispatcher.** Cloud
// Scheduler's free tier is 3 jobs and all 3 are spent (`hourlyTasks`,
// `statusPulse`, `weeklyFirestoreBackup`) — but a Firestore trigger is not a
// scheduled job, so it consumes none of that ceiling. It is also what was
// actually asked for: a ping, not a digest. At alpha volume this is a handful
// of invocations a week.
//
// **Why email and not push.** There is no push path in this project any more:
// the only one that existed was the PWA's web FCM (`push-reminders.ts`, deleted
// with the web logging app, ADR-0036 / #112), and the native app has none yet.
// Building one for an audience of one is not worth it, and email arrives on
// whatever device is in hand.
//
// Resend is already wired with a verified sender and a bound
// `RESEND_API_KEY`, so this costs no new Secret Manager version — the free
// tier there is 6 active versions against an audited floor of 7, and adding
// one would have been a real cost rather than a rounding error.

/**
 * The off switch, deliberately a single constant.
 *
 * Flip to `false` and the trigger no-ops — no rules change, no client
 * release, no redeploy of anything else. Delete this file and its export from
 * `index.ts` when the pings are permanently done.
 */
const FEEDBACK_NOTIFY = true;

/**
 * Where the ping goes. `MACROLOG_FEEDBACK_TO` overrides, matching how
 * `resend-client.ts` treats `FROM`/`REPLY_TO`.
 *
 * **This was `gabriel@bermudezsystems.com` and is not any more — changed
 * 2026-08-22 because the owner never received the first real one.** Resend
 * reported that message `delivered`, which is true and is also the end of what
 * Resend can see: `delivered` means Northwest's MX returned a 250, not that a
 * human read it. The LLC mailbox is supposed to forward to the Gmail below,
 * and `CLAUDE.local.md` records that forward as *"1 slot on the plan (owner to
 * configure)"* — i.e. it was never confirmed configured, and the evidence now
 * says it is not.
 *
 * So the ping goes straight to the inbox the owner actually reads. The LLC
 * address stays the ORG CONTACT on Apple/Google records — that is a different
 * job from an ops notification, and routing this through an unverified forward
 * bought nothing but a silent failure.
 *
 * Move it back only after sending a test to the LLC address and watching it
 * arrive in Gmail. Note also that the Northwest suite is free for year one and
 * lapses ~July 2027 with auto-renew off, so it is not a durable destination
 * for anything time-sensitive.
 */
const FALLBACK_TO = "gabrielandresbermudez@gmail.com";
const NOTIFY_TO = process.env["MACROLOG_FEEDBACK_TO"] || FALLBACK_TO;

const ADMIN_FEEDBACK_URL = "https://ignia.fit/admin?tab=feedback";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "Something is broken",
  idea: "An idea",
  confusing: "Confusing",
  other: "Something else",
  none: "No category",
};

/** Minimal escaping — the message is user-authored text going into an HTML
 *  mail body, so it must not be able to inject markup into the owner's
 *  inbox. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Send budget ────────────────────────────────────────────────────
//
// Every feedback doc used to become one email, and the Resend plan is 100
// mails a day SHARED with password-reset and verification mail — the account-
// recovery path. Feedback is the one collection any signed-in user can append
// to at will, so a script filing feedback in a loop could exhaust the day's
// allowance and lock real users out of resetting their passwords (2026-10-15
// audit). The rules now require a verified email; this caps what is left.
//
// Over budget, the FEEDBACK IS STILL KEPT — the doc is already written and the
// admin panel lists it. Only the ping is skipped, and logged.

/** Pings per reporter per UTC day. A real person rarely files more than one. */
export const FEEDBACK_NOTIFY_PER_USER_PER_DAY = 3;
/** Pings per UTC day across everyone — a fifth of the shared Resend plan. */
export const FEEDBACK_NOTIFY_GLOBAL_PER_DAY = 20;

/** `{ day, count }` as stored; anything else reads as an empty counter. */
interface DayCounter { day?: unknown; count?: unknown }

function countFor(c: DayCounter | undefined, day: string): number {
  return c && c.day === day && typeof c.count === "number" ? c.count : 0;
}

/**
 * Pure budget decision. Counters roll over by storing the day they belong to,
 * so no cleanup job is needed (Cloud Scheduler has no free slot left).
 */
export function decideFeedbackNotify(
  global: DayCounter | undefined,
  user: DayCounter | undefined,
  day: string,
  limits: { perUser: number; global: number } = {
    perUser: FEEDBACK_NOTIFY_PER_USER_PER_DAY,
    global: FEEDBACK_NOTIFY_GLOBAL_PER_DAY,
  },
): { allowed: boolean; reason?: "user" | "global"; globalCount: number; userCount: number } {
  const g = countFor(global, day);
  const u = countFor(user, day);
  if (u >= limits.perUser) return { allowed: false, reason: "user", globalCount: g, userCount: u };
  if (g >= limits.global) return { allowed: false, reason: "global", globalCount: g, userCount: u };
  return { allowed: true, globalCount: g + 1, userCount: u + 1 };
}

/**
 * Claim one ping from the budget, transactionally.
 *
 * The global counter sits in `opsBudget` (server-only, no personal data); the
 * per-user one under `users/{uid}/private/`, which no rule matches — so it is
 * client-invisible — and which account deletion already erases with the rest
 * of `private`. A uid-keyed top-level collection would have needed its own
 * erasure entry.
 *
 * Fails CLOSED: if the counter cannot be read the ping is skipped, because the
 * failure mode being defended against is spending a shared allowance, and the
 * feedback itself is safe in Firestore either way.
 */
export async function claimFeedbackNotify(
  firestore: Firestore,
  uid: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean; reason?: "user" | "global" | "error" }> {
  const day = now.toISOString().slice(0, 10);
  const globalRef = firestore.doc("opsBudget/feedbackNotify");
  const userRef = firestore.doc(`users/${uid}/private/feedbackNotify`);
  try {
    return await firestore.runTransaction(async (tx) => {
      const [g, u] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
      const d = decideFeedbackNotify(g.data() as DayCounter | undefined, u.data() as DayCounter | undefined, day);
      if (!d.allowed) return { allowed: false, reason: d.reason };
      const at = Timestamp.fromDate(now);
      tx.set(globalRef, { day, count: d.globalCount, updatedAt: at });
      tx.set(userRef, { day, count: d.userCount, updatedAt: at });
      return { allowed: true };
    });
  } catch (err) {
    console.error(`onFeedbackCreated: send budget unavailable uid=${uid} — ping skipped`, err);
    return { allowed: false, reason: "error" };
  }
}

export const onFeedbackCreated = onDocumentCreated(
  { document: "users/{uid}/feedback/{feedbackId}", secrets: [resendApiKey], maxInstances: 3 },
  async (event) => {
    if (!FEEDBACK_NOTIFY) return;
    const data = event.data?.data();
    if (!data) return;

    const uid = event.params["uid"] as string;
    const message = String(data["message"] ?? "").slice(0, 4000);
    if (message.length === 0) return;

    // Budget BEFORE any other work (the Auth read included): an over-budget
    // report is kept, just not emailed.
    const budget = await claimFeedbackNotify(db, uid);
    if (!budget.allowed) {
      console.warn(`onFeedbackCreated: ping skipped uid=${uid} reason=${budget.reason} (feedback kept)`);
      return;
    }

    const category = String(data["category"] ?? "none");
    const appVersion = String(data["appVersion"] ?? "unknown");
    const platform = String(data["platform"] ?? "unknown");
    const locale = String(data["locale"] ?? "unknown");

    // The reporter's email, so a reply is one click rather than a uid lookup
    // in the console. Best-effort: a deleted user must not stop the ping.
    let who = uid;
    try {
      const user = await getAuth().getUser(uid);
      who = user.email ? `${user.email} (${uid})` : uid;
    } catch {
      // Leave `who` as the uid.
    }

    const label = CATEGORY_LABELS[category] ?? category;
    // The full report goes INLINE. The point of a ping is not having to go
    // and look; the admin link is for replying or reading the surrounding
    // history, not for finding out what was said.
    const subject = `Ignia feedback — ${label}`;
    const text = [
      message,
      "",
      `From: ${who}`,
      `Category: ${label}`,
      `App: ${appVersion} on ${platform} (${locale})`,
      "",
      ADMIN_FEEDBACK_URL,
    ].join("\n");
    const html = [
      `<p style="white-space:pre-wrap;font-size:16px;line-height:1.5">${escapeHtml(message)}</p>`,
      `<p style="font-size:13px;color:#666">`,
      `From: ${escapeHtml(who)}<br>`,
      `Category: ${escapeHtml(label)}<br>`,
      `App: ${escapeHtml(appVersion)} on ${escapeHtml(platform)} (${escapeHtml(locale)})`,
      `</p>`,
      `<p><a href="${ADMIN_FEEDBACK_URL}">Open the admin feedback tab</a></p>`,
    ].join("");

    try {
      const resend = getResend();
      // `transactionalSendOptions()` drops the unsubscribe headers on
      // purpose: this is an ops notification to the operator, not a
      // user-facing send, and an unsubscribe link on it would be misleading.
      const { error } = await resend.emails.send({
        ...baseSendOptions(),
        ...transactionalSendOptions(),
        to: NOTIFY_TO,
        subject,
        html,
        text,
      });
      if (error) {
        console.error("onFeedbackCreated: Resend error", error);
        return;
      }
      console.log(`onFeedbackCreated: notified uid=${uid} category=${category}`);
    } catch (err) {
      // A failed ping must never fail the write that triggered it — the
      // report itself is already safely in Firestore and readable in the
      // admin panel. Losing the email is an inconvenience; retrying forever
      // against a bad key is a bill.
      console.error("onFeedbackCreated: send threw", err);
    }
  },
);
