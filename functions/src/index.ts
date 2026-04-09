import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI } from "@google/genai";

initializeApp();
const db = getFirestore();
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// ─── Shared validation (mirrors Firestore rules isValidLog) ────────

interface ValidatedEntry {
  calories: number;
  timestamp: Timestamp;
  weight?: number;
  protein?: number;
  liftCompleted?: boolean;
  cardioCompleted?: boolean;
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

  // liftCompleted: optional, boolean
  if (b.liftCompleted !== undefined) {
    if (typeof b.liftCompleted !== "boolean") return "liftCompleted must be a boolean.";
    entry.liftCompleted = b.liftCompleted;
  }

  // cardioCompleted: optional, boolean
  if (b.cardioCompleted !== undefined) {
    if (typeof b.cardioCompleted !== "boolean") return "cardioCompleted must be a boolean.";
    entry.cardioCompleted = b.cardioCompleted;
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
      throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const uid = request.auth.uid;

    // ── Daily quota check (per user, resets at UTC midnight) ───────
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const quotaRef = db.collection("photoQuota").doc(`${uid}_${today}`);
    let photosUsedAfter = 1;
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(quotaRef);
      const used: number = doc.exists ? (doc.data()!.count as number) : 0;
      if (used >= DAILY_PHOTO_LIMIT) {
        throw new HttpsError(
          "resource-exhausted",
          `Daily limit of ${DAILY_PHOTO_LIMIT} photo analyses reached. Resets at midnight UTC.`,
        );
      }
      photosUsedAfter = used + 1;
      tx.set(quotaRef, { count: photosUsedAfter, uid, date: today }, { merge: true });
    });

    const { photoBase64 } = request.data as { photoBase64?: string };
    if (!photoBase64 || typeof photoBase64 !== "string") {
      throw new HttpsError("invalid-argument", "photoBase64 is required.");
    }

    // Rough size check: base64 is ~4/3 of raw bytes. 5MB raw = ~6.7MB base64.
    if (photoBase64.length > 7_000_000) {
      throw new HttpsError("invalid-argument", "Image too large. Max 5MB.");
    }

    try {
      const client = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      const result = await client.models.generateContent({
        model: "gemini-flash-latest",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: photoBase64,
                },
              },
              {
                text: `Analyze this meal photo and estimate total calories and protein in grams.

Estimation rules:
- Include ALL visible and implied fats: cooking oil, butter, dressings, sauces, pan drippings.
- Fried or sautéed items: assume oil was used unless clearly baked or grilled.
- Pressed sandwiches (cubano, Pan de Agua, medialunas): assume butter was applied.
- When fat content is ambiguous, lean toward the higher estimate.

Common Puerto Rican / Latin staples for reference:
- White rice (1 cup cooked with sofrito/oil): ~290 cal, 4g protein
- Habichuelas/beans (½ cup): ~115 cal, 6g protein
- Pernil / lechón (3 oz): ~260 cal, 20g protein
- Tostones (2 pieces): ~160 cal, 1g protein
- Mofongo (1 serving): ~380 cal, 4g protein
- Pan de Bono (1 piece): ~185 cal, 6g protein
- Arroz con pollo (1 plate): ~550 cal, 35g protein

Return ONLY valid JSON with no markdown formatting, no code fences, no explanation:
{"calories": <integer>, "protein": <integer>, "description": "<brief 3-5 word description>"}`,
              },
            ],
          },
        ],
        config: { temperature: 0.2 },
      });

      // Extract text from response
      const raw = result.text?.trim() ?? "";
      // Strip markdown code fences if present
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      let parsed: { calories?: number; protein?: number; description?: string };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("Gemini returned unparseable response:", cleaned.slice(0, 500));
        throw new HttpsError(
          "internal",
          "Could not parse the meal analysis. Please try again with a clearer photo.",
        );
      }

      const calories = typeof parsed.calories === "number" ? Math.round(parsed.calories) : null;
      const protein = typeof parsed.protein === "number" ? Math.round(parsed.protein) : null;
      const description = typeof parsed.description === "string" ? parsed.description.slice(0, 100) : "Meal";

      if (calories == null) {
        throw new HttpsError("internal", "Gemini could not estimate calories from this image.");
      }

      return {
        calories,
        protein: protein ?? 0,
        description,
        photosRemaining: DAILY_PHOTO_LIMIT - photosUsedAfter,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("analyzePhoto error:", err);
      throw new HttpsError("internal", "Photo analysis failed.");
    }
  },
);

// ─── Feature 3: Daily Push Reminder ───────────────────────────────

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
