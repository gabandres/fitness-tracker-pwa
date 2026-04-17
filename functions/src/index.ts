import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";

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

const DAILY_PHOTO_LIMIT = 8;

export const analyzePhoto = onCall(
  { secrets: [geminiApiKey], maxInstances: 10 },
  async (request) => {
    // Auth required (callable protocol auto-verifies ID token)
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email;
    const unlimited = await hasUnlimitedAccess(email);

    // ── Daily quota check (per user, resets at UTC midnight) ───────
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const quotaRef = db.collection("photoQuota").doc(`${uid}_${today}`);
    let photosUsedAfter = 1;
    // Admins + comped friends skip the quota entirely.
    if (!unlimited) {
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(quotaRef);
        const used: number = doc.exists ? (doc.data()!.count as number) : 0;
        if (used >= DAILY_PHOTO_LIMIT) {
          throw new HttpsError(
            "resource-exhausted",
            `Daily limit of ${DAILY_PHOTO_LIMIT} photo analyses reached. Resets at midnight UTC.`,
            { code: ErrorCode.PHOTO_QUOTA_EXCEEDED, limit: DAILY_PHOTO_LIMIT },
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

    // Rough size check: base64 is ~4/3 of raw bytes. 5MB raw = ~6.7MB base64.
    if (photoBase64.length > 7_000_000) {
      throw new HttpsError("invalid-argument", "Image too large. Max 5MB.", { code: ErrorCode.PHOTO_TOO_LARGE });
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

Common Puerto Rican / Latin staples for reference:
- White rice (1 cup cooked with sofrito/oil): ~290 cal, 4g protein
- Habichuelas/beans (½ cup): ~115 cal, 6g protein
- Pernil / lechón (3 oz): ~260 cal, 20g protein
- Tostones (2 pieces): ~160 cal, 1g protein
- Mofongo (1 serving): ~380 cal, 4g protein
- Pan de Bono (1 piece): ~185 cal, 6g protein
- Arroz con pollo (1 plate): ~550 cal, 35g protein` + descriptionLangSuffix,
              },
            ],
          },
        ],
        config: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              calories:    { type: "integer", description: "Total estimated calories" },
              protein:     { type: "integer", description: "Total protein in grams" },
              description: { type: "string",  description: "Brief 3-5 word description of the meal" },
              confidence:  { type: "string",  enum: ["low", "medium", "high"],
                             description: "Estimation confidence based on image clarity and portion visibility" },
            },
            required: ["calories", "protein", "description", "confidence"],
          },
        },
      });

      // response.text is guaranteed valid JSON matching the schema
      const parsed = JSON.parse(result.text ?? "{}") as {
        calories?: number;
        protein?: number;
        description?: string;
        confidence?: string;
      };

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
        // full cap. The client treats this as decorative since nothing
        // blocks them.
        photosRemaining: unlimited ? DAILY_PHOTO_LIMIT : DAILY_PHOTO_LIMIT - photosUsedAfter,
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
//   2. Gives paid users (stripeRole=paid claim) unlimited access
//   3. Caps free users at CONSULTATION_DAILY_LIMIT per calendar day
//      (UTC), atomically incrementing a Firestore counter. Over-limit
//      throws HttpsError('resource-exhausted').
//
// Client calls this BEFORE streaming the Gemini response. On success
// the client proceeds with the direct Gemini SDK call. On failure the
// client shows an upgrade pitch.

const CONSULTATION_DAILY_LIMIT = 5;

export const reserveConsultation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
  }
  const uid = request.auth.uid;
  const email = request.auth.token.email;
  const role = (request.auth.token as { stripeRole?: string }).stripeRole;

  // Paid users, admins, and comped friends bypass the quota entirely.
  // We don't write a counter doc for them since it would never be read.
  if (role === "paid" || (await hasUnlimitedAccess(email))) {
    return { capped: false, remaining: -1, limit: CONSULTATION_DAILY_LIMIT };
  }

  const today = new Date().toISOString().split("T")[0];
  const quotaRef = db.collection("consultationQuota").doc(`${uid}_${today}`);

  let remaining = 0;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(quotaRef);
    const used: number = doc.exists ? (doc.data()!.count as number) : 0;
    if (used >= CONSULTATION_DAILY_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        `Daily free-tier limit of ${CONSULTATION_DAILY_LIMIT} consultations reached. Subscribe for unlimited.`,
        { code: ErrorCode.CONSULTATION_QUOTA_EXCEEDED, limit: CONSULTATION_DAILY_LIMIT },
      );
    }
    const newCount = used + 1;
    tx.set(quotaRef, { count: newCount, uid, date: today }, { merge: true });
    remaining = CONSULTATION_DAILY_LIMIT - newCount;
  });

  return { capped: false, remaining, limit: CONSULTATION_DAILY_LIMIT };
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
  const role = (request.auth.token as { stripeRole?: string }).stripeRole;

  // Paid users, admins, and comped friends never had a slot reserved.
  if (role === "paid" || (await hasUnlimitedAccess(email))) return { released: false };

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
      photoLimit: DAILY_PHOTO_LIMIT, consultationLimit: CONSULTATION_DAILY_LIMIT,
    };
  }
  const uid = request.auth.uid;
  const email = request.auth.token.email;
  const admin = isAdmin(email);
  const comped = await isComped(email);
  const role = (request.auth.token as { stripeRole?: string }).stripeRole;
  const unlimited = admin || comped || role === "paid";

  // Paid/admin/comped users don't need a remaining count — free tier
  // shows "N left", unlimited hides the caption entirely (null signal).
  if (unlimited) {
    return {
      admin, comped,
      photosRemaining: null, consultationsRemaining: null,
      photoLimit: DAILY_PHOTO_LIMIT, consultationLimit: CONSULTATION_DAILY_LIMIT,
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
    photosRemaining: Math.max(0, DAILY_PHOTO_LIMIT - photosUsed),
    consultationsRemaining: Math.max(0, CONSULTATION_DAILY_LIMIT - consultUsed),
    photoLimit: DAILY_PHOTO_LIMIT,
    consultationLimit: CONSULTATION_DAILY_LIMIT,
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

export const deleteAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in to delete your account.", { code: ErrorCode.UNAUTHENTICATED });
  }
  const uid = request.auth.uid;
  const userPath = `users/${uid}`;

  try {
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
