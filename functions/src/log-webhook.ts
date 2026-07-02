import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { db } from "./init";

// Per-IP fixed-window throttle. The endpoint authenticates by scanning
// `users` for a matching `webhookApiKey`, so an unthrottled caller could
// brute-force keys one request at a time. Cap requests per IP per minute.
// Backed by Firestore (survives instance recycling); the bucket key embeds
// the minute so old docs are inert (add a TTL policy on `expiresAt` to prune).
const RL_WINDOW_MS = 60_000;
const RL_MAX_PER_WINDOW = 30;

async function throttled(ip: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / RL_WINDOW_MS);
  const ref = db.collection("webhookRateLimits").doc(`${ip}_${bucket}`);
  try {
    await ref.set(
      {
        count: FieldValue.increment(1),
        expiresAt: Timestamp.fromMillis((bucket + 2) * RL_WINDOW_MS),
      },
      { merge: true },
    );
    const snap = await ref.get();
    return ((snap.data()?.count as number) ?? 0) > RL_MAX_PER_WINDOW;
  } catch {
    // Fail OPEN on rate-limiter infra errors — never drop a legitimate log
    // because the throttle store hiccuped.
    return false;
  }
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

// ─── Apple Shortcuts Webhook ────────────────────────────────────────

export const logWebhook = onRequest(
  { cors: false },
  async (req, res) => {
    // POST only
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    // Rate-limit by client IP before the key lookup (brute-force defense).
    const ip = ((req.headers["x-forwarded-for"] as string) || req.ip || "unknown")
      .split(",")[0]
      .trim();
    if (await throttled(ip)) {
      res.status(429).json({ error: "Too many requests. Slow down." });
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
