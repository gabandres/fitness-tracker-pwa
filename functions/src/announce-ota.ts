import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "./admin-guard";
import { writeAuditLog } from "./audit-log";

// ─── adminAnnounceOta (#112/#114) ──────────────────────────────────
//
// After an `eas update` publish, tell every device holding an Expo push token
// to pre-download the new bundle so the NEXT launch applies it immediately
// instead of fetching first. The push is SILENT — `_contentAvailable` with no
// title/body — because the app already auto-applies OTAs (`useAutoApplyOta`);
// the gain is a faster first paint, not a notification per publish.
//
// Expo's push API (https://exp.host/--/api/v2/push/send) needs NO credential
// for this: the ExponentPushToken itself is the capability. No new secret —
// the Secret Manager floor stays where it is.
//
// Note: until vc 41 / the next iOS build ship the native push config, no
// device can hold a token (registration throws client-side), so this sends to
// zero recipients. That is the expected pre-native state, not a failure.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo caps a single /push/send request at 100 messages. */
export const EXPO_PUSH_CHUNK = 100;

export type OtaPlatform = "ios" | "android";

/** One silent pre-download message. Deliberately NO title/body/sound — a
 *  visible notification per OTA publish is exactly what #112 rejected. */
export interface OtaPushMessage {
  to: string;
  priority: "normal";
  _contentAvailable: true;
  data: { type: "ota-published"; platform: OtaPlatform; message?: string };
}

/** A registered device: whose profile to clean when Expo says the token
 *  is dead. */
export interface PushRecipient {
  uid: string;
  token: string;
}

/**
 * Build the request bodies for Expo's push API: one silent message per token,
 * chunked at the API's 100-message cap. Pure — the unit tests own proving the
 * payload stays silent (no title/body) and the chunk math holds.
 *
 * A token does not encode its platform, so every registered device gets the
 * push; the payload's `platform` stamp lets each device filter itself out
 * (`shouldFetchOnPush` in the mobile app).
 */
export function buildOtaPushChunks(
  recipients: readonly PushRecipient[],
  platform: OtaPlatform,
  message?: string,
): OtaPushMessage[][] {
  const messages: OtaPushMessage[] = recipients.map((r) => ({
    to: r.token,
    priority: "normal",
    _contentAvailable: true,
    data: message ? { type: "ota-published", platform, message } : { type: "ota-published", platform },
  }));
  const chunks: OtaPushMessage[][] = [];
  for (let i = 0; i < messages.length; i += EXPO_PUSH_CHUNK) {
    chunks.push(messages.slice(i, i + EXPO_PUSH_CHUNK));
  }
  return chunks;
}

/** The slice of an Expo push ticket this function acts on. */
export interface ExpoPushTicket {
  status?: string;
  details?: { error?: string };
}

/**
 * Fold Expo's per-ticket results (aligned by index with the messages sent)
 * into counts plus the uids whose token Expo declared dead. Pure for the same
 * reason as the builder: DeviceNotRegistered handling is the one branch that
 * mutates user data, so it must be provable without a network.
 */
export function interpretPushTickets(
  tickets: readonly ExpoPushTicket[],
  recipients: readonly PushRecipient[],
): { sent: number; errors: number; clearUids: string[] } {
  let sent = 0;
  let errors = 0;
  const clearUids: string[] = [];
  tickets.forEach((ticket, i) => {
    if (ticket?.status === "ok") {
      sent++;
      return;
    }
    errors++;
    if (ticket?.details?.error === "DeviceNotRegistered" && recipients[i]) {
      clearUids.push(recipients[i].uid);
    }
  });
  return { sent, errors, clearUids };
}

/**
 * Admin-only: announce a just-published OTA to every registered device.
 * Invoked from the workstation by `scripts/announce-ota.mjs` right after
 * `eas update`. Returns counts so the caller can see the send actually
 * reached someone (or, pre-native-config, that recipients === 0).
 */
export const adminAnnounceOta = onCall({ timeoutSeconds: 120 }, async (request) => {
  const admin = requireAdmin(request);
  const { platform, message } = (request.data || {}) as {
    platform?: string;
    message?: string;
  };
  if (platform !== "ios" && platform !== "android") {
    throw new HttpsError("invalid-argument", "platform must be 'ios' or 'android'.");
  }
  if (message !== undefined && (typeof message !== "string" || message.length > 500)) {
    throw new HttpsError("invalid-argument", "message must be a string of at most 500 chars.");
  }

  const db = getFirestore();
  // Range filter rather than `!= null`: matches exactly "field exists and is a
  // non-empty string", which is the only shape the rules let a client write.
  const snap = await db
    .collection("users")
    .where("expoPushToken", ">", "")
    .select("expoPushToken")
    .get();
  const recipients: PushRecipient[] = snap.docs
    .map((d) => ({ uid: d.id, token: d.get("expoPushToken") as string }))
    .filter((r) => typeof r.token === "string" && r.token.length > 0);

  const chunks = buildOtaPushChunks(recipients, platform, message);
  let sent = 0;
  let errors = 0;
  const clearUids: string[] = [];

  let offset = 0;
  for (const chunk of chunks) {
    const chunkRecipients = recipients.slice(offset, offset + chunk.length);
    offset += chunk.length;
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      // Whole-chunk transport failure. Count and move on — a later chunk can
      // still land, and the caller sees the error count in the return value.
      errors += chunk.length;
      continue;
    }
    const body = (await res.json()) as { data?: ExpoPushTicket[] };
    const outcome = interpretPushTickets(body.data ?? [], chunkRecipients);
    sent += outcome.sent;
    errors += outcome.errors;
    clearUids.push(...outcome.clearUids);
  }

  // A DeviceNotRegistered ticket means the token is permanently dead (app
  // uninstalled, or token rotated). Clear it so the next announce stops
  // paying for it; the device re-registers on its next session.
  for (const uid of clearUids) {
    await db.doc(`users/${uid}`).update({ expoPushToken: FieldValue.delete() }).catch(() => {
      // Profile gone (account deleted between query and now). Nothing to clean.
    });
  }

  await writeAuditLog({
    action: "ota_announced",
    admin,
    details: { platform, recipients: recipients.length, sent, errors, cleared: clearUids.length },
  });

  return { recipients: recipients.length, sent, errors, cleared: clearUids.length };
});
