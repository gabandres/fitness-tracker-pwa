import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";
import { getResend, baseSendOptions, resendApiKey } from "./resend-client";
import { welcomeEmail } from "./email-templates";

initializeApp();
const db = getFirestore();
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// ─── Admin bypass list ────────────────────────────────────────────
// Emails listed here skip all per-user quotas (consultations, photos)
// and behave like paid subscribers server-side. Keep this in sync
// with ADMIN_EMAILS in src/app/services/subscription.service.ts —
// the two projects can't share code, so it's a deliberate duplicate.
const ADMIN_EMAILS = new Set([
  "gabrielandresbermudez@gmail.com",
]);

function isAdmin(email: string | undefined | null): boolean {
  return !!email && ADMIN_EMAILS.has(email);
}

// ─── Comped friends (server-read Firestore config) ────────────────
// Friends the owner has comped for free access. Lives at
//   /config/accessList  { compedEmails: string[] }
// Edit via the Firebase console — no redeploy needed.
//
// Cached in memory for 60s per function instance to avoid hammering
// Firestore on every quota check. Newly-added friends take up to 60s
// to pick up; that's an acceptable tradeoff for simpler code.
const ACCESS_CACHE_TTL_MS = 60_000;
let accessCache: { emails: Set<string>; fetchedAt: number } | null = null;

async function loadCompedEmails(): Promise<Set<string>> {
  const now = Date.now();
  if (accessCache && now - accessCache.fetchedAt < ACCESS_CACHE_TTL_MS) {
    return accessCache.emails;
  }
  const snap = await db.doc("config/accessList").get();
  const emails = new Set<string>(
    ((snap.data()?.compedEmails as string[] | undefined) ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter((e) => !!e),
  );
  accessCache = { emails, fetchedAt: now };
  return emails;
}

async function isComped(email: string | undefined | null): Promise<boolean> {
  if (!email) return false;
  const set = await loadCompedEmails();
  return set.has(email.toLowerCase());
}

async function hasUnlimitedAccess(email: string | undefined | null): Promise<boolean> {
  if (isAdmin(email)) return true;
  return isComped(email);
}

// ─── Shared validation (mirrors Firestore rules isValidLog) ────────

interface ValidatedEntry {
  calories: number;
  timestamp: Timestamp;
  weight?: number;
  protein?: number;
  exerciseCompleted?: boolean;
  mealLabel?: string;
}

function validateLogEntry(body: unknown): ValidatedEntry | string {
  if (typeof body !== "object" || body === null) return "Body must be a JSON object.";
  const b = body as Record<string, unknown>;

  // calories: required, number, 0–19999
  if (typeof b.calories !== "number" || !isFinite(b.calories) || b.calories < 0 || b.calories >= 20000) {
    return "calories is required and must be a number between 0 and 19999.";
  }

  const entry: ValidatedEntry = {
    calories: b.calories,
    timestamp: Timestamp.now(),
  };

  // weight: optional, number, >0 <1000
  if (b.weight !== undefined) {
    if (typeof b.weight !== "number" || !isFinite(b.weight) || b.weight <= 0 || b.weight >= 1000) {
      return "weight must be a number between 0 and 1000.";
    }
    entry.weight = b.weight;
  }

  // protein: optional, number, >=0 <1000
  if (b.protein !== undefined) {
    if (typeof b.protein !== "number" || !isFinite(b.protein) || b.protein < 0 || b.protein >= 1000) {
      return "protein must be a number between 0 and 1000.";
    }
    entry.protein = b.protein;
  }

  // exerciseCompleted: optional, boolean
  if (b.exerciseCompleted !== undefined) {
    if (typeof b.exerciseCompleted !== "boolean") return "exerciseCompleted must be a boolean.";
    entry.exerciseCompleted = b.exerciseCompleted;
  }

  // liftCompleted: optional, boolean (legacy — mapped to exerciseCompleted)
  if (b.liftCompleted !== undefined) {
    if (typeof b.liftCompleted !== "boolean") return "liftCompleted must be a boolean.";
    if (b.liftCompleted) entry.exerciseCompleted = true;
  }

  // cardioCompleted: optional, boolean (legacy — mapped to exerciseCompleted)
  if (b.cardioCompleted !== undefined) {
    if (typeof b.cardioCompleted !== "boolean") return "cardioCompleted must be a boolean.";
    if (b.cardioCompleted) entry.exerciseCompleted = true;
  }

  // mealLabel: optional, string, <=100 chars
  if (b.mealLabel !== undefined) {
    if (typeof b.mealLabel !== "string" || b.mealLabel.length > 100) {
      return "mealLabel must be a string of at most 100 characters.";
    }
    entry.mealLabel = b.mealLabel;
  }

  return entry;
}

// ─── Feature 1: Apple Shortcuts Webhook ────────────────────────────

export const logWebhook = onRequest(
  { cors: false },
  async (req, res) => {
    // POST only
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    // Extract API key from header
    const raw = req.headers["x-api-key"];
    const apiKey =
      (typeof raw === "string" ? raw : null) ??
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);

    if (!apiKey) {
      res.status(401).json({ error: "Missing API key. Send x-api-key header." });
      return;
    }

    // Look up the API key across all user profiles
    try {
      const snap = await db
        .collection("users")
        .where("webhookApiKey", "==", apiKey)
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(401).json({ error: "Invalid API key." });
        return;
      }

      const uid = snap.docs[0].id;

      // Validate the request body
      const result = validateLogEntry(req.body);
      if (typeof result === "string") {
        res.status(400).json({ error: result });
        return;
      }

      // Write to Firestore
      const docRef = await db
        .collection("users")
        .doc(uid)
        .collection("dailyLogs")
        .add(result);

      res.status(201).json({ success: true, logId: docRef.id });
    } catch (err) {
      console.error("logWebhook error:", err);
      res.status(500).json({ error: "Internal server error." });
    }
  },
);

// ─── Feature 2: Photo-to-Macros ───────────────────────────────────

// Tiered per-user daily caps (UTC). Admins + comped friends still
// bypass entirely — they get unlimited access. The freemium table
// in the UX plan promises 3/day free, 30/day paid.
const PHOTO_LIMIT_FREE = 3;
const PHOTO_LIMIT_PAID = 30;
// Minimum interval between photo analyses per uid. Prevents a malicious
// client from burning the daily quota (and our Gemini budget) in a few
// seconds. 3s is long enough to defeat scripted spam, short enough that
// a legitimate "accidentally tapped twice" user isn't locked out for long.
const PHOTO_MIN_INTERVAL_MS = 3_000;

/**
 * Enforce a per-uid minimum interval on the given rate-limit collection.
 * Reads the last-call timestamp, throws if too recent, writes the new one.
 * Used by analyzePhoto and the consultation endpoints.
 */
async function enforceRateLimit(
  collectionName: string,
  uid: string,
  minIntervalMs: number,
  errorCode: ErrorCode,
): Promise<void> {
  const ref = db.collection(collectionName).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const last = (snap.data()?.lastCallAt as Timestamp | undefined)?.toMillis() ?? 0;
    const now = Date.now();
    if (last && now - last < minIntervalMs) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many requests. Please slow down.",
        { code: errorCode, retryAfterMs: minIntervalMs - (now - last) },
      );
    }
    tx.set(ref, { lastCallAt: Timestamp.now(), uid }, { merge: true });
  });
}

export const analyzePhoto = onCall(
  { secrets: [geminiApiKey], maxInstances: 10 },
  async (request) => {
    // Auth required (callable protocol auto-verifies ID token)
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email;
    const role = (request.auth.token as { stripeRole?: string }).stripeRole;
    const unlimited = await hasUnlimitedAccess(email);
    const effectiveLimit = role === "paid" ? PHOTO_LIMIT_PAID : PHOTO_LIMIT_FREE;

    // Per-uid rate limit — independent of daily quota. Runs BEFORE the
    // quota increment so a throttled call doesn't consume a slot.
    await enforceRateLimit("photoRateLimit", uid, PHOTO_MIN_INTERVAL_MS, ErrorCode.PHOTO_RATE_LIMITED);

    // ── Daily quota check (per user, resets at UTC midnight) ───────
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const quotaRef = db.collection("photoQuota").doc(`${uid}_${today}`);
    let photosUsedAfter = 1;
    // Admins + comped friends skip the quota entirely.
    if (!unlimited) {
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(quotaRef);
        const used: number = doc.exists ? (doc.data()!.count as number) : 0;
        if (used >= effectiveLimit) {
          throw new HttpsError(
            "resource-exhausted",
            `Daily limit of ${effectiveLimit} photo analyses reached. Resets at midnight UTC.`,
            { code: ErrorCode.PHOTO_QUOTA_EXCEEDED, limit: effectiveLimit },
          );
        }
        photosUsedAfter = used + 1;
        tx.set(quotaRef, { count: photosUsedAfter, uid, date: today }, { merge: true });
      });
    }

    const { photoBase64, locale } = request.data as { photoBase64?: string; locale?: string };
    if (!photoBase64 || typeof photoBase64 !== "string") {
      throw new HttpsError("invalid-argument", "photoBase64 is required.", { code: ErrorCode.PHOTO_MISSING });
    }

    // Defense-in-depth against direct API callers that bypass the client
    // resize. The client caps raw uploads at 15 MB and resizes to 1920px
    // before base64 encoding, so legitimate payloads are well under 3 MB.
    // Threshold here (~20 MB base64 = ~15 MB raw) matches the client
    // precheck so the user-facing number is consistent.
    if (photoBase64.length > 20_000_000) {
      throw new HttpsError(
        "invalid-argument",
        "Image too large after processing.",
        { code: ErrorCode.PHOTO_TOO_LARGE },
      );
    }

    // Locale-aware description. The calories/protein numbers are
    // locale-agnostic; only the `description` field flips language.
    const descriptionLangSuffix = locale === "es-PR"
      ? "\n\nReturn the `description` field in Puerto Rican Spanish (e.g. 'pollo con arroz')."
      : "\n\nReturn the `description` field in English.";

    try {
      const client = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      const result = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: photoBase64 } },
              {
                text: `Analyze this meal photo and estimate total calories and protein in grams.

Estimation rules:
- Include ALL visible and implied fats: cooking oil, butter, dressings, sauces, pan drippings.
- Fried or sautéed items: assume oil was used unless clearly baked or grilled.
- Pressed sandwiches (cubano, Pan de Agua, medialunas): assume butter was applied.
- When fat content is ambiguous, lean toward the higher estimate.
- Set confidence to "low" if the image is blurry, portions are obscured, or the dish is unfamiliar.

Reasoning requirement:
- Before outputting calories and protein, populate the "reasoning" field with a concise
  chain-of-thought that (a) identifies each item and its visual portion cues
  (plate size, utensil scale, pile height, fill level), (b) estimates the volume or
  mass of each item, (c) applies a density/caloric-density assumption per item, and
  (d) sums to the final totals. The reasoning must justify the numbers — do not
  guess the totals blindly and backfill the reasoning.

Common Puerto Rican / Latin staples for reference:
- White rice (1 cup cooked with sofrito/oil): ~290 cal, 4g protein
- Habichuelas/beans (½ cup): ~115 cal, 6g protein
- Pernil / lechón (3 oz): ~260 cal, 20g protein
- Tostones (2 pieces): ~160 cal, 1g protein
- Mofongo (1 serving): ~380 cal, 4g protein
- Pan de Bono (1 piece): ~185 cal, 6g protein
- Arroz con pollo (1 plate): ~550 cal, 35g protein
- Pan Sobao (1 medium slice, ~55g): ~170 cal, 5g protein — soft, lard-enriched PR bread, denser than French bread
- Ground Turkey (1 cup packed / 8oz cooked): ~340 cal, 44g protein — 93/7 lean, browned crumbles
- NaturalSlim Shake (1 scoop, ~28g powder, prepared with water): ~105 cal, 15g protein` + descriptionLangSuffix,
              },
            ],
          },
        ],
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            // Property order matters for JSON mode: Gemini emits fields in
            // schema order, so `reasoning` is listed FIRST to force the model
            // to commit to its volume/density logic before producing the
            // final integers. Swapping the order would let it guess first
            // and rationalize after.
            properties: {
              reasoning:   { type: "string",  description:
                "Chain-of-thought: identify each item, estimate its volume/mass from visual cues " +
                "(plate size, utensil scale, pile height), apply a caloric-density assumption, " +
                "and sum. Must precede and justify the calorie/protein totals." },
              calories:    { type: "integer", description: "Total estimated calories (must follow from reasoning)" },
              protein:     { type: "integer", description: "Total protein in grams (must follow from reasoning)" },
              description: { type: "string",  description: "Brief 3-5 word description of the meal" },
              confidence:  { type: "string",  enum: ["low", "medium", "high"],
                             description: "Estimation confidence based on image clarity and portion visibility" },
            },
            required: ["reasoning", "calories", "protein", "description", "confidence"],
          },
        },
      });

      // response.text is guaranteed valid JSON matching the schema
      const parsed = JSON.parse(result.text ?? "{}") as {
        reasoning?: string;
        calories?: number;
        protein?: number;
        description?: string;
        confidence?: string;
      };

      // Log the chain-of-thought so we can audit estimation quality without
      // surfacing it in the client response (keeps the client contract stable).
      if (parsed.reasoning) {
        console.log(`analyzePhoto reasoning uid=${uid}:`, parsed.reasoning);
      }

      const calories = typeof parsed.calories === "number" ? Math.round(parsed.calories) : null;
      const protein = typeof parsed.protein === "number" ? Math.round(parsed.protein) : null;
      const description = typeof parsed.description === "string" ? parsed.description.slice(0, 100) : "Meal";
      const confidence = (parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high")
        ? parsed.confidence : "medium";

      if (calories == null) {
        throw new HttpsError(
          "internal",
          "Gemini could not estimate calories from this image.",
          { code: ErrorCode.PHOTO_ESTIMATE_FAILED },
        );
      }

      return {
        calories,
        protein: protein ?? 0,
        description,
        confidence,
        // Admins + comped users report "unlimited" by returning the
        // paid cap. The client treats this as decorative since nothing
        // blocks them.
        photosRemaining: unlimited ? PHOTO_LIMIT_PAID : effectiveLimit - photosUsedAfter,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("analyzePhoto error:", err);
      throw new HttpsError("internal", "Photo analysis failed.", { code: ErrorCode.PHOTO_ANALYZE_FAILED });
    }
  },
);

// ─── Feature 3: Consultation quota (AI coach rate limit) ─────────
//
// The AI coach (Gemini consultations) is free-tier on the client side
// but shared across all users on the project's Gemini API quota. One
// power user could monopolize it. This callable:
//   1. Verifies auth
//   2. Gives admins + comped friends unlimited access
//   3. Caps paid subscribers at CONSULTATION_LIMIT_PAID per UTC day
//   4. Caps free users at CONSULTATION_LIMIT_FREE per UTC day
//      (atomic Firestore counter; over-limit throws 'resource-exhausted').
//
// Client calls this BEFORE streaming the Gemini response. On success
// the client proceeds with the direct Gemini SDK call. On failure the
// client shows an upgrade pitch (free) or a generic limit notice (paid).

const CONSULTATION_LIMIT_FREE = 3;
const CONSULTATION_LIMIT_PAID = 30;
// Per-uid min interval for reserve + release. Covers both reserve spam
// (which would burn Firestore writes on the quota doc) and release spam
// (which can't build credit past zero but still wastes writes).
const CONSULTATION_MIN_INTERVAL_MS = 1_500;
const ACCESS_STATUS_MIN_INTERVAL_MS = 300;
const DELETE_ACCOUNT_MIN_INTERVAL_MS = 5_000;
const EXPORT_DATA_MIN_INTERVAL_MS = 30_000;

export const reserveConsultation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
  }
  const uid = request.auth.uid;
  const email = request.auth.token.email;
  const role = (request.auth.token as { stripeRole?: string }).stripeRole;

  await enforceRateLimit(
    "consultationRateLimit",
    uid,
    CONSULTATION_MIN_INTERVAL_MS,
    ErrorCode.CONSULTATION_RATE_LIMITED,
  );

  // Admins + comped friends bypass the quota entirely.
  if (await hasUnlimitedAccess(email)) {
    return { capped: false, remaining: -1, limit: CONSULTATION_LIMIT_PAID };
  }

  const effectiveLimit = role === "paid" ? CONSULTATION_LIMIT_PAID : CONSULTATION_LIMIT_FREE;
  const today = new Date().toISOString().split("T")[0];
  const quotaRef = db.collection("consultationQuota").doc(`${uid}_${today}`);

  let remaining = 0;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(quotaRef);
    const used: number = doc.exists ? (doc.data()!.count as number) : 0;
    if (used >= effectiveLimit) {
      throw new HttpsError(
        "resource-exhausted",
        `Daily limit of ${effectiveLimit} consultations reached. Resets at midnight UTC.`,
        { code: ErrorCode.CONSULTATION_QUOTA_EXCEEDED, limit: effectiveLimit },
      );
    }
    const newCount = used + 1;
    tx.set(quotaRef, { count: newCount, uid, date: today }, { merge: true });
    remaining = effectiveLimit - newCount;
  });

  return { capped: false, remaining, limit: effectiveLimit };
});

/**
 * Refund a previously-reserved consultation slot. Called by the client
 * when the streaming Gemini call fails AFTER reservation (network blip,
 * Gemini 5xx, safety block). Without this, a transient failure silently
 * consumes one of the user's daily slots.
 *
 * Decrements the current-day counter but will not go below zero — so
 * a bad client can't build up credit by spam-calling release.
 */
export const releaseConsultation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
  }
  const uid = request.auth.uid;
  const email = request.auth.token.email;

  await enforceRateLimit(
    "consultationRateLimit",
    uid,
    CONSULTATION_MIN_INTERVAL_MS,
    ErrorCode.CONSULTATION_RATE_LIMITED,
  );

  // Admins + comped friends never had a slot reserved. Paid users DO
  // have a capped slot (30/day) — refund them too.
  if (await hasUnlimitedAccess(email)) return { released: false };

  const today = new Date().toISOString().split("T")[0];
  const quotaRef = db.collection("consultationQuota").doc(`${uid}_${today}`);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(quotaRef);
    if (!doc.exists) return;
    const used: number = doc.data()!.count as number;
    if (used <= 0) return;
    tx.set(quotaRef, { count: used - 1 }, { merge: true });
  });

  return { released: true };
});

/**
 * Tells the client whether the signed-in user has unlimited access
 * (admin or comped friend). Client uses this on sign-in to adjust the
 * Subscribe card UI — show the friend/admin badge instead of the
 * $3/mo pitch. Server enforcement is still independent in the
 * quota-reserve functions above; this endpoint only shapes UI.
 */
export const checkAccessStatus = onCall(async (request) => {
  if (!request.auth) {
    return {
      admin: false, comped: false,
      photosRemaining: null, consultationsRemaining: null,
      photoLimit: PHOTO_LIMIT_FREE, consultationLimit: CONSULTATION_LIMIT_FREE,
    };
  }
  const uid = request.auth.uid;
  await enforceRateLimit(
    "accessStatusRateLimit",
    uid,
    ACCESS_STATUS_MIN_INTERVAL_MS,
    ErrorCode.RATE_LIMITED,
  );
  const email = request.auth.token.email;
  const admin = isAdmin(email);
  const comped = await isComped(email);
  const role = (request.auth.token as { stripeRole?: string }).stripeRole;
  const unlimitedAccess = admin || comped;
  const paid = role === "paid";
  const photoLimit = paid ? PHOTO_LIMIT_PAID : PHOTO_LIMIT_FREE;
  const consultationLimit = paid ? CONSULTATION_LIMIT_PAID : CONSULTATION_LIMIT_FREE;

  // Admin/comped users hide the "N left" caption entirely (null signal).
  // Paid users DO see a remaining count against the 30/day cap.
  if (unlimitedAccess) {
    return {
      admin, comped,
      photosRemaining: null, consultationsRemaining: null,
      photoLimit, consultationLimit,
    };
  }

  const today = new Date().toISOString().split("T")[0];
  const [photoSnap, consultSnap] = await Promise.all([
    db.collection("photoQuota").doc(`${uid}_${today}`).get(),
    db.collection("consultationQuota").doc(`${uid}_${today}`).get(),
  ]);
  const photosUsed = photoSnap.exists ? (photoSnap.data()!.count as number) : 0;
  const consultUsed = consultSnap.exists ? (consultSnap.data()!.count as number) : 0;
  return {
    admin, comped,
    photosRemaining: Math.max(0, photoLimit - photosUsed),
    consultationsRemaining: Math.max(0, consultationLimit - consultUsed),
    photoLimit,
    consultationLimit,
  };
});

// ─── Feature 4: Account deletion (GDPR right to erasure) ──────────

/**
 * Recursively delete all documents in a subcollection in batches of 500
 * (Firestore's max batch size). Firestore doesn't cascade on user or doc
 * deletion, so we have to walk each subcollection manually.
 */
async function deleteSubcollection(
  parentPath: string,
  subPath: string,
): Promise<void> {
  const collRef = db.collection(`${parentPath}/${subPath}`);
  const pageSize = 500;
  while (true) {
    const snap = await collRef.limit(pageSize).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) return;
  }
}

/**
 * Best-effort cancellation of any active Stripe subscriptions before the
 * Firebase Auth user is deleted. Writes `cancel_at_period_end: true` onto
 * the extension-managed subscription doc — the firestore-stripe-payments
 * extension picks up the write and mirrors it to Stripe, which is the
 * safe path that doesn't require us to hold the Stripe secret key here.
 *
 * Never throws: account deletion is a GDPR right-to-erasure path and
 * should not be blocked on a Stripe API blip. Any failure is logged so
 * operators can reconcile manually.
 */
async function cancelStripeSubscriptions(uid: string): Promise<void> {
  try {
    // Fetch all subscription docs and filter in memory. A `.where("status",
    // "in", [...])` would require a composite index on the subscriptions
    // subcollection that the Stripe extension doesn't create — without it
    // the query throws FAILED_PRECONDITION on first run. Subscription lists
    // per user are tiny (usually 0-2 docs), so the in-memory filter is free.
    const snap = await db
      .collection("customers")
      .doc(uid)
      .collection("subscriptions")
      .get();
    if (snap.empty) return;
    const ACTIVE = new Set(["trialing", "active", "past_due"]);
    const toCancel = snap.docs.filter((d) => ACTIVE.has(d.data()?.status as string));
    if (toCancel.length === 0) return;
    const batch = db.batch();
    toCancel.forEach((d) => {
      batch.set(d.ref, { cancel_at_period_end: true }, { merge: true });
    });
    await batch.commit();
    console.log(`cancelStripeSubscriptions: marked ${toCancel.length} sub(s) cancel_at_period_end for uid=${uid}`);
  } catch (err) {
    console.warn(
      `cancelStripeSubscriptions failed for uid=${uid} — Stripe customer may need manual cleanup in the dashboard.`,
      err,
    );
  }
}

// ─── GDPR Art. 20 data export ──────────────────────────────────────
// Returns a full JSON snapshot of everything we hold for the caller
// across `users/{uid}` + quota docs. CSV export in the dashboard covers
// daily logs only — this closes the "portability of all personal data"
// requirement. Response is inline JSON; the heaviest real-world account
// fits comfortably under the 10 MB callable response cap.
export const exportUserData = onCall({ maxInstances: 5 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to export your data.", { code: ErrorCode.UNAUTHENTICATED });
  }
  const uid = request.auth.uid;
  await enforceRateLimit(
    "exportRateLimit",
    uid,
    EXPORT_DATA_MIN_INTERVAL_MS,
    ErrorCode.RATE_LIMITED,
  );
  const userRef = db.doc(`users/${uid}`);

  const dumpCollection = async (name: string) => {
    const snap = await userRef.collection(name).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  const dumpQuota = async (coll: string) => {
    const snap = await db.collection(coll).where("uid", "==", uid).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  const [profileSnap, dailyLogs, presets, reports, dailyWeights, measurements, photoQuota, consultationQuota] =
    await Promise.all([
      userRef.get(),
      dumpCollection("dailyLogs"),
      dumpCollection("presets"),
      dumpCollection("reports"),
      dumpCollection("dailyWeights"),
      dumpCollection("measurements"),
      dumpQuota("photoQuota"),
      dumpQuota("consultationQuota"),
    ]);

  // Redact credentials — GDPR Art. 20 scope is personal data, not bearer
  // tokens. `webhookApiKey` is a long-lived shared secret for Apple
  // Shortcuts and the `fcmToken` binds a device's push channel; including
  // them in a downloadable JSON widens their blast radius beyond the
  // server-side stores that originally held them.
  let profile: Record<string, unknown> | null = null;
  if (profileSnap.exists) {
    const { webhookApiKey: _wk, fcmToken: _ft, ...safe } = profileSnap.data() as Record<string, unknown>;
    profile = safe;
  }

  const payload = {
    exportedAt: Timestamp.now().toDate().toISOString(),
    uid,
    profile,
    dailyLogs,
    presets,
    reports,
    dailyWeights,
    measurements,
    photoQuota,
    consultationQuota,
  };

  // Callable response cap is ~10 MB. Reject early with a typed error so
  // the client can tell the user why — the default overflow surfaces as
  // a generic internal error that's impossible to act on.
  const serialized = JSON.stringify(payload);
  if (serialized.length > 9_000_000) {
    throw new HttpsError(
      "resource-exhausted",
      "Your data is too large for an inline export. Contact support to receive a download link.",
      { code: ErrorCode.RATE_LIMITED, sizeBytes: serialized.length },
    );
  }
  return payload;
});

export const deleteAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to delete your account.", { code: ErrorCode.UNAUTHENTICATED });
  }
  const uid = request.auth.uid;
  await enforceRateLimit(
    "deleteRateLimit",
    uid,
    DELETE_ACCOUNT_MIN_INTERVAL_MS,
    ErrorCode.RATE_LIMITED,
  );
  const userPath = `users/${uid}`;

  try {
    // 0. Flag any active Stripe subscriptions to cancel at period end so
    //    a deleted user doesn't keep getting billed. The extension's own
    //    auto-delete trigger handles the Stripe customer doc when the
    //    Auth user is deleted, but doesn't cancel live subscriptions —
    //    that's what this step is for.
    await cancelStripeSubscriptions(uid);

    // 1. Delete all subcollections under users/{uid}.
    //    Subcollections known to exist: dailyLogs, presets, reports,
    //    dailyWeights, measurements. Add new ones here when introduced.
    await Promise.all([
      deleteSubcollection(userPath, "dailyLogs"),
      deleteSubcollection(userPath, "presets"),
      deleteSubcollection(userPath, "reports"),
      deleteSubcollection(userPath, "dailyWeights"),
      deleteSubcollection(userPath, "measurements"),
    ]);

    // 2. Delete quota docs (photo + consultation). Doc IDs are
    //    `${uid}_${date}` and carry a `uid` field for query filtering.
    for (const coll of ["photoQuota", "consultationQuota"]) {
      const quotaSnap = await db.collection(coll)
        .where("uid", "==", uid)
        .get();
      if (!quotaSnap.empty) {
        const batch = db.batch();
        quotaSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }

    // 3. Delete the user profile doc itself.
    await db.doc(userPath).delete();

    // 4. Delete the Firebase Auth user. This signs them out of all
    //    sessions and prevents future logins. After this point the
    //    client's ID token is invalid.
    await getAuth().deleteUser(uid);

    console.log(`Account deleted for uid=${uid}`);
    return { success: true };
  } catch (err) {
    console.error(`deleteAccount failed for uid=${uid}:`, err);
    throw new HttpsError("internal", "Account deletion failed. Please contact support.", { code: ErrorCode.ACCOUNT_DELETE_FAILED });
  }
});

// ─── Feature 4: Daily Push Reminder ───────────────────────────────

export const sendDailyReminders = onSchedule(
  { schedule: "every 1 hours", timeZone: "UTC" },
  async () => {
    const messaging = getMessaging();

    // Find all users with an FCM token.
    const usersSnap = await db
      .collection("users")
      .where("fcmToken", "!=", null)
      .get();

    if (usersSnap.empty) return;

    const nowUtc = new Date();

    // Process all users in parallel (not sequentially) to avoid
    // timeout at scale. allSettled so one failure doesn't block others.
    await Promise.allSettled(
      usersSnap.docs.map(async (userDoc) => {
        const data = userDoc.data();
        const token = data.fcmToken as string;
        const reminderHour = (data.reminderHour as number) ?? 20;
        const tzOffsetMin = (data.timezoneOffsetMin as number) ?? 0;

        // Compute the user's local hour.
        // getTimezoneOffset() returns positive for west of UTC (e.g., +300 for UTC-5,
        // meaning UTC = local + offset). So local = UTC - offset.
        const userLocalHour = (nowUtc.getUTCHours() - Math.round(tzOffsetMin / 60) + 24) % 24;

        // Only send if within the reminder window (reminderHour to reminderHour+1).
        if (userLocalHour < reminderHour || userLocalHour > reminderHour + 1) return;

        // Check if they logged today (in their local timezone).
        const userNow = new Date(nowUtc.getTime() - tzOffsetMin * 60 * 1000);
        const startOfDay = new Date(userNow);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const startOfDayUtc = new Date(startOfDay.getTime() + tzOffsetMin * 60 * 1000);

        const logsSnap = await db
          .collection("users")
          .doc(userDoc.id)
          .collection("dailyLogs")
          .where("timestamp", ">=", Timestamp.fromDate(startOfDayUtc))
          .limit(1)
          .get();

        if (!logsSnap.empty) return; // Already logged today.

        try {
          await messaging.send({
            token,
            notification: {
              title: "Macro Log",
              body: "You haven't logged today yet.",
            },
            webpush: {
              fcmOptions: { link: "https://macrolog.web.app" },
            },
          });
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            await userDoc.ref.update({ fcmToken: null });
            console.log(`Cleaned stale FCM token for user ${userDoc.id}`);
          } else {
            console.error(`FCM send failed for user ${userDoc.id}:`, err);
          }
        }
      }),
    );
  },
);

// ─── Day-3 ask-coach push ──────────────────────────────────────────
//
// Once a user has ≥3 days of data the consultation panel becomes
// actually useful (before that, Gemini has nothing to ground its
// answers in). This push nudges them into their first AI conversation
// exactly when the data is ready, deep-linking to the body tab where
// the consultation lives. One-shot per user — latched via the
// `dayThreeCoachPushSent` flag on the user doc so we never spam.
//
// Ride the same hourly cadence as sendDailyReminders so we reuse the
// timezone / reminder-hour logic and stay within the user's explicit
// reminder window.

const DAY_MS = 24 * 60 * 60 * 1000;

export const sendDayThreeCoachPush = onSchedule(
  { schedule: "every 1 hours", timeZone: "UTC" },
  async () => {
    const messaging = getMessaging();

    const usersSnap = await db
      .collection("users")
      .where("fcmToken", "!=", null)
      .get();

    if (usersSnap.empty) return;

    const nowUtc = new Date();

    await Promise.allSettled(
      usersSnap.docs.map(async (userDoc) => {
        const data = userDoc.data();
        if (data.dayThreeCoachPushSent) return; // already nudged.

        const token = data.fcmToken as string;
        const reminderHour = (data.reminderHour as number) ?? 20;
        const tzOffsetMin = (data.timezoneOffsetMin as number) ?? 0;
        const userLocalHour = (nowUtc.getUTCHours() - Math.round(tzOffsetMin / 60) + 24) % 24;
        if (userLocalHour < reminderHour || userLocalHour > reminderHour + 1) return;

        // Oldest log — single read, no aggregate needed. If the oldest
        // log is ≥3 days old the user has been around long enough for
        // the consultation panel to say something useful.
        const oldestSnap = await db
          .collection("users")
          .doc(userDoc.id)
          .collection("dailyLogs")
          .orderBy("timestamp", "asc")
          .limit(1)
          .get();
        if (oldestSnap.empty) return;

        const oldestTs = oldestSnap.docs[0].data().timestamp as Timestamp | undefined;
        if (!oldestTs) return;
        const ageMs = nowUtc.getTime() - oldestTs.toMillis();
        if (ageMs < 3 * DAY_MS) return;

        try {
          await messaging.send({
            token,
            notification: {
              title: "Macro Log",
              body: "You have data now — ask your coach what to adjust.",
            },
            webpush: {
              fcmOptions: { link: "https://macrolog.web.app/?tab=body" },
            },
          });
          await userDoc.ref.update({ dayThreeCoachPushSent: true });
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            await userDoc.ref.update({ fcmToken: null });
          } else {
            console.error(`Day-3 coach push failed for user ${userDoc.id}:`, err);
          }
        }
      }),
    );
  },
);

// ─── Feature 5: Weekly AI report generation ───────────────────────
//
// Generates the markdown weekly report via Gemini and writes it to
// Firestore. Previously the client called Gemini directly and wrote
// the doc itself — which meant:
//   1. Free users could bypass the Pro gate by calling the client code.
//   2. Token cost was uncapped; a malicious user could spam generations.
//
// This callable fixes both: firestore.rules blocks client writes to
// `users/{uid}/reports`, so the only path to a new report is through
// this function. Gate is paid OR admin OR comped. Rate limit: at most
// one new report every 6 days (the UI only surfaces a fresh report
// weekly anyway, so this is the real usage pattern).

const REPORT_MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
const REPORT_SYSTEM_MAX_CHARS = 20_000;
const REPORT_PROMPT_MAX_CHARS = 2_000;
const REPORT_OUTPUT_MAX_CHARS = 10_000; // matches firestore.rules size cap

interface GenerateReportInput {
  systemInstruction?: unknown;
  prompt?: unknown;
}

export const generateWeeklyReport = onCall(
  { secrets: [geminiApiKey], maxInstances: 5 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email;
    const role = (request.auth.token as { stripeRole?: string }).stripeRole;
    const entitled = role === "paid" || (await hasUnlimitedAccess(email));
    if (!entitled) {
      throw new HttpsError(
        "permission-denied",
        "Weekly report is a Pro feature.",
        { code: ErrorCode.REPORT_NOT_ENTITLED },
      );
    }

    const { systemInstruction, prompt } = (request.data ?? {}) as GenerateReportInput;
    if (typeof systemInstruction !== "string" || systemInstruction.length === 0 ||
        systemInstruction.length > REPORT_SYSTEM_MAX_CHARS) {
      throw new HttpsError("invalid-argument", "systemInstruction missing or too large.", { code: ErrorCode.REPORT_PAYLOAD_INVALID });
    }
    if (typeof prompt !== "string" || prompt.length === 0 ||
        prompt.length > REPORT_PROMPT_MAX_CHARS) {
      throw new HttpsError("invalid-argument", "prompt missing or too large.", { code: ErrorCode.REPORT_PAYLOAD_INVALID });
    }

    // Rate limit: reject if the latest existing report is < 6 days old.
    // Read the newest report doc and compare generatedAt.
    const reportsRef = db.collection("users").doc(uid).collection("reports");
    const latestSnap = await reportsRef.orderBy("generatedAt", "desc").limit(1).get();
    if (!latestSnap.empty) {
      const generatedAt = latestSnap.docs[0].data().generatedAt as Timestamp | undefined;
      if (generatedAt && Date.now() - generatedAt.toMillis() < REPORT_MIN_INTERVAL_MS) {
        throw new HttpsError(
          "resource-exhausted",
          "A weekly report was generated recently. Try again later.",
          { code: ErrorCode.REPORT_TOO_SOON },
        );
      }
    }

    try {
      const client = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      const result = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { systemInstruction, temperature: 0.3 },
      });
      const markdown = (result.text ?? "").slice(0, REPORT_OUTPUT_MAX_CHARS);
      if (!markdown) {
        throw new HttpsError("internal", "Empty response from Gemini.", { code: ErrorCode.REPORT_GENERATE_FAILED });
      }

      const generatedAt = Timestamp.now();
      const docRef = await reportsRef.add({ markdown, generatedAt });

      return {
        id: docRef.id,
        markdown,
        generatedAt: generatedAt.toMillis(),
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("generateWeeklyReport error:", err);
      throw new HttpsError("internal", "Report generation failed.", { code: ErrorCode.REPORT_GENERATE_FAILED });
    }
  },
);

// ─── Feature 6: Status heartbeat ──────────────────────────────────
//
// Writes a heartbeat doc every 5 minutes so the public /status page
// can show whether the scheduler + Firestore admin write path are
// healthy. If the last pulse is >10 min old, the page renders
// "degraded". >30 min ⇒ "down". The fact that /status loads at all
// proves hosting + client fetch to Firestore work, so this signal
// covers the Cloud Functions scheduler side specifically.

export const statusPulse = onSchedule(
  { schedule: "every 5 minutes", timeZone: "UTC" },
  async () => {
    await db.doc("status/heartbeat").set({
      lastPulseAt: Timestamp.now(),
    });
  },
);

// ─── Public stats: user count for landing social proof ─────────────
//
// Tallies the `users/` collection once an hour and writes the count
// to a public `public/stats` doc. The landing page reads this and
// only renders the "join N+ quiet loggers" line when N >= 100, so
// early adopters don't see "join 3+ quiet loggers" (anti-social-proof).
// Using count() aggregation keeps the read cost a single billed unit
// regardless of collection size.
export const publishUserCount = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC" },
  async () => {
    const snap = await db.collection("users").count().get();
    const total = snap.data().count;
    await db.doc("public/stats").set({
      totalUsers: total,
      updatedAt: Timestamp.now(),
    }, { merge: true });
  },
);

// ─── Feature 7: Weekly Firestore backup ───────────────────────────
//
// Scheduled export of all Firestore collections to a GCS bucket so a
// bad rules deploy or accidental mass-delete is recoverable. Lifecycle
// pruning (30-day retention) is handled GCS-side — see README operator
// checklist for the one-time bucket setup.
//
// We import the admin client lazily so the cold-start cost is paid only
// by the weekly schedule, not by every HTTP function.

const BACKUP_BUCKET = process.env.GCLOUD_PROJECT
  ? `gs://${process.env.GCLOUD_PROJECT}-backups`
  : "";

// ─── Feature 7: Welcome email on profile completion ───────────────
//
// Fires the first time `profileCompleted` flips false → true on a user
// doc. That's the moment we know a real human finished onboarding and
// has consented to be contacted — legally safer than sending on sign-up
// (which is just auth, no affirmative consent). Latched via
// `welcomeEmailSentAt` on the profile so reconfigurations never
// re-trigger. Resend delivery failures are logged, not thrown: a
// welcome email is not mission-critical and a transient Resend 5xx
// must never block onboarding.
//
// Deliverability note: until a custom domain is verified in Resend we
// ship from `onboarding@resend.dev` (Resend's sandbox). Real Day-7
// retention lift needs macrolog.app (or similar) verified — at that
// point set the `MACROLOG_EMAIL_FROM` env to the verified from-address.

export const sendWelcomeEmail = onDocumentUpdated(
  {
    document: "users/{uid}",
    secrets: [resendApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const flippedToCompleted =
      before.profileCompleted !== true && after.profileCompleted === true;
    if (!flippedToCompleted) return;
    if (after.welcomeEmailSentAt) return; // already sent

    const uid = event.params.uid;
    const email = after.email as string | undefined;
    if (!email) {
      console.warn(`sendWelcomeEmail: user ${uid} has no email — skipping.`);
      return;
    }

    // Pull a locale hint from the Firebase Auth user record (if present).
    // Clients write Transloco's active language to `preferredLocale` on the
    // profile when it changes; fall back to English otherwise.
    const preferredLocale = after.preferredLocale as string | undefined;
    const locale: "en" | "es-PR" = preferredLocale === "es-PR" ? "es-PR" : "en";

    const displayName =
      (after.displayName as string | undefined) ??
      (await getAuth().getUser(uid).then((u) => u.displayName).catch(() => null));

    const { subject, html } = welcomeEmail({ locale, displayName });

    // Never log email addresses — Cloud Logging is 30d-retained and
    // visible to any project collaborator. Stick to uid; an operator
    // can join to the email via Firestore console if needed.
    try {
      const resend = getResend();
      const { error } = await resend.emails.send({
        ...baseSendOptions(),
        to: email,
        subject,
        html,
      });
      if (error) {
        console.error(`sendWelcomeEmail: Resend error for uid=${uid}`, error);
        return;
      }
      await db.doc(`users/${uid}`).set(
        { welcomeEmailSentAt: Timestamp.now() },
        { merge: true },
      );
      console.log(`sendWelcomeEmail: sent welcome email uid=${uid} locale=${locale}`);
    } catch (err) {
      console.error(`sendWelcomeEmail: unexpected failure for uid=${uid}`, err);
    }
  },
);

export const weeklyFirestoreBackup = onSchedule(
  { schedule: "0 6 * * 0", timeZone: "UTC" },
  async () => {
    if (!BACKUP_BUCKET) {
      console.warn("weeklyFirestoreBackup: GCLOUD_PROJECT env not set — skipping.");
      return;
    }
    // Dynamic import — @google-cloud/firestore is a transitive of
    // firebase-admin, no direct dep needed.
    const { v1 } = await import("@google-cloud/firestore");
    const client = new v1.FirestoreAdminClient();
    const databaseName = client.databasePath(
      process.env.GCLOUD_PROJECT!,
      "(default)",
    );
    const outputUri = `${BACKUP_BUCKET}/firestore/${new Date().toISOString().split("T")[0]}`;
    try {
      const [operation] = await client.exportDocuments({
        name: databaseName,
        outputUriPrefix: outputUri,
        collectionIds: [], // empty = export all
      });
      console.log(
        `weeklyFirestoreBackup: export started → ${outputUri}. operation=${operation.name}`,
      );
    } catch (err) {
      // Typical first-run failure: bucket doesn't exist yet. Log and
      // continue — this function is opt-in infrastructure.
      console.error(
        `weeklyFirestoreBackup: export failed. Ensure ${BACKUP_BUCKET} exists and ` +
        "Firebase service account has roles/datastore.importExportAdmin. Error:",
        err,
      );
    }
  },
);
