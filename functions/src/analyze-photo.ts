import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";
import { callerAccess, dailyQuota, geminiApiKey } from "./init";

// ─── Photo-to-Macros ────────────────────────────────────────────────

// Minimum interval between photo analyses per uid. Prevents a malicious
// client from burning the daily quota (and our Gemini budget) in a few
// seconds. 3s is long enough to defeat scripted spam, short enough that
// a legitimate "accidentally tapped twice" user isn't locked out for long.
const PHOTO_MIN_INTERVAL_MS = 3_000;

export const analyzePhoto = onCall(
  { secrets: [geminiApiKey], maxInstances: 10 },
  async (request) => {
    // Auth + rate limit (BEFORE the quota reserve, so a throttled call
    // doesn't consume a slot) + tier, all in one preamble.
    const caller = await callerAccess.resolveCaller(request, {
      collection: "photoRateLimit",
      minIntervalMs: PHOTO_MIN_INTERVAL_MS,
      errorCode: ErrorCode.PHOTO_RATE_LIMITED,
    });
    const uid = caller.uid;

    // Daily quota (per user, resets at UTC midnight). Admins + comped
    // users skip it entirely.
    let photosRemaining = dailyQuota.limitFor("photo", true);
    if (!caller.unlimited) {
      const reserved = await dailyQuota.reserve(uid, "photo", caller.tier === "paid");
      photosRemaining = reserved.remaining;
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
                text: `Analyze this meal photo and estimate total calories, protein, carbs, and fat in grams.

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
              carbs:       { type: "integer", description: "Total carbohydrates in grams (must follow from reasoning)" },
              fat:         { type: "integer", description: "Total fat in grams, including cooking fats (must follow from reasoning)" },
              description: { type: "string",  description: "Brief 3-5 word description of the meal" },
              confidence:  { type: "string",  enum: ["low", "medium", "high"],
                             description: "Estimation confidence based on image clarity and portion visibility" },
            },
            required: ["reasoning", "calories", "protein", "carbs", "fat", "description", "confidence"],
          },
        },
      });

      // response.text is guaranteed valid JSON matching the schema
      const parsed = JSON.parse(result.text ?? "{}") as {
        reasoning?: string;
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
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
      const carbs = typeof parsed.carbs === "number" ? Math.round(parsed.carbs) : null;
      const fat = typeof parsed.fat === "number" ? Math.round(parsed.fat) : null;
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
        carbs,
        fat,
        description,
        confidence,
        // Admins + comped users report "unlimited" by returning the
        // paid cap. The client treats this as decorative since nothing
        // blocks them.
        photosRemaining,
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("analyzePhoto error:", err);
      throw new HttpsError("internal", "Photo analysis failed.", { code: ErrorCode.PHOTO_ANALYZE_FAILED });
    }
  },
);
