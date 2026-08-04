import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { ErrorCode } from "./error-codes";
import { anthropicApiKey, callerAccess, dailyQuota, spendCeiling } from "./init";

// ─── Photo-to-Macros ────────────────────────────────────────────────

// Minimum interval between photo analyses per uid. Prevents a malicious
// client from burning the daily quota (and our model budget) in a few
// seconds. 3s is long enough to defeat scripted spam, short enough that
// a legitimate "accidentally tapped twice" user isn't locked out for long.
const PHOTO_MIN_INTERVAL_MS = 3_000;

/**
 * Photo-scan is the one paid-tier AI feature, enforced HERE rather than on
 * the client. The client cannot express "Pro" today: `isPaid()` is forced
 * `true` for everyone while `PRO_ENABLED === false`, so a client-side check
 * would unlock this for the whole free tier. `caller.tier` comes from the
 * Stripe custom claim and is unaffected by that flag, which makes the server
 * the only honest gate.
 *
 * While `PRO_ENABLED` is false and nothing is purchasable, "paid" in practice
 * means admins and comped friends. That is intended: the feature is also
 * hidden client-side (web `FEATURES.photoScan`, mobile
 * `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0`), so this guard is the second lock on a
 * door that is already closed. Set to `false` to make photo-scan free again.
 */
const PHOTO_REQUIRES_PAID = true;

/**
 * Claude Haiku 4.5 — the cheapest model that does vision AND structured
 * outputs, which this callable needs both of. ~$0.004/scan at ~2.2k input
 * tokens (image ≈1.6k + prompt ≈600) and ~350 output; that is the rate the
 * `photo` spend ceiling in spend-ceiling.ts is sized against, so changing
 * this model is a budget decision — re-derive the ceiling if you do.
 *
 * Deliberately NOT prompt-cached: Haiku 4.5's minimum cacheable prefix is
 * 4096 tokens and the static prompt below is ~600, so a `cache_control`
 * breakpoint would silently never cache (no error, just
 * `cache_creation_input_tokens: 0`) while costing the write premium.
 */
const PHOTO_MODEL = "claude-haiku-4-5";

/**
 * Haiku 4.5 predates the high-resolution vision tier, so images are capped
 * at 1568px on the long edge and ~1600 tokens regardless of what we send.
 * The clients resize to 1920px; the API downscales the rest. Harmless, just
 * wasted upload bytes — lowering the client resize is a free win, not a fix.
 */
const PHOTO_MAX_OUTPUT_TOKENS = 1_024;

const ESTIMATION_PROMPT = `Analyze this meal photo and estimate total calories, protein, carbs, and fat in grams.

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
- NaturalSlim Shake (1 scoop, ~28g powder, prepared with water): ~105 cal, 15g protein`;

/**
 * `additionalProperties: false` is REQUIRED on every object by Claude's
 * structured outputs — Gemini's JSON mode did not need it, and omitting it
 * is a 400 rather than a silent downgrade.
 *
 * Property order is kept with `reasoning` FIRST for the same reason it was
 * under Gemini: the model emits fields in schema order, so listing the
 * chain-of-thought ahead of the integers makes it commit to volume/density
 * logic before producing totals instead of guessing and rationalizing after.
 */
const MACRO_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description:
        "Chain-of-thought: identify each item, estimate its volume/mass from visual cues " +
        "(plate size, utensil scale, pile height), apply a caloric-density assumption, " +
        "and sum. Must precede and justify the calorie/protein totals.",
    },
    calories: { type: "integer", description: "Total estimated calories (must follow from reasoning)" },
    protein: { type: "integer", description: "Total protein in grams (must follow from reasoning)" },
    carbs: { type: "integer", description: "Total carbohydrates in grams (must follow from reasoning)" },
    fat: { type: "integer", description: "Total fat in grams, including cooking fats (must follow from reasoning)" },
    description: { type: "string", description: "Brief 3-5 word description of the meal" },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Estimation confidence based on image clarity and portion visibility",
    },
  },
  required: ["reasoning", "calories", "protein", "carbs", "fat", "description", "confidence"],
  additionalProperties: false,
} as const;

export const analyzePhoto = onCall(
  { secrets: [anthropicApiKey], maxInstances: 10 },
  async (request) => {
    // Auth + rate limit (BEFORE the quota reserve, so a throttled call
    // doesn't consume a slot) + tier, all in one preamble.
    const caller = await callerAccess.resolveCaller(request, {
      collection: "photoRateLimit",
      minIntervalMs: PHOTO_MIN_INTERVAL_MS,
      errorCode: ErrorCode.PHOTO_RATE_LIMITED,
    });
    const uid = caller.uid;

    // Entitlement, checked before any spend guard: a free caller must not
    // consume a slot of the shared ceiling on a request we were never going
    // to serve. admin/comped are `unlimited` and outrank `paid`, so they pass.
    if (PHOTO_REQUIRES_PAID && !caller.unlimited && caller.tier !== "paid") {
      throw new HttpsError(
        "permission-denied",
        "Photo analysis is a paid feature.",
        { code: ErrorCode.PHOTO_NOT_ENTITLED },
      );
    }

    // Org-wide spend guard, checked BEFORE the per-user reserve so an
    // ordinary "you hit your own limit" rejection never consumes a slot of
    // the shared ceiling. A read, not a write — see spend-ceiling.ts.
    // Unlimited callers skip the check on purpose: their calls are still
    // metered below, but the owner must not be locked out of the feature he
    // needs in order to diagnose why the guard tripped.
    if (!caller.unlimited) {
      await spendCeiling.check("photo");
    }

    // Daily quota (per user, resets at UTC midnight). Admins + comped
    // users skip it entirely.
    let photosRemaining = dailyQuota.limitFor("photo", true);
    if (!caller.unlimited) {
      const reserved = await dailyQuota.reserve(uid, "photo", caller.tier === "paid");
      photosRemaining = reserved.remaining;
    }

    // Metered here rather than after the model call: the spend happens the
    // moment the request leaves, so a response that fails to parse still cost
    // money and still has to count. Records every tier, unlimited included.
    await spendCeiling.record("photo");

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
      const client = new Anthropic({ apiKey: anthropicApiKey.value() });
      const response = await client.messages.create({
        model: PHOTO_MODEL,
        max_tokens: PHOTO_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        output_config: { format: { type: "json_schema", schema: MACRO_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              // Image before text: the model reads the prompt against an
              // image it has already seen, which is the documented ordering
              // for vision prompts.
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: photoBase64 },
              },
              { type: "text", text: ESTIMATION_PROMPT + descriptionLangSuffix },
            ],
          },
        ],
      });

      // A safety classifier can decline with HTTP 200 and an EMPTY content
      // array — reading content[0] first would throw a TypeError that reads
      // like a parse bug. Check the stop reason before touching content.
      if (response.stop_reason === "refusal") {
        console.warn(`analyzePhoto refused uid=${uid}`);
        throw new HttpsError(
          "internal",
          "The model declined to analyze this image.",
          { code: ErrorCode.PHOTO_ESTIMATE_FAILED },
        );
      }

      // Truncation is the other way to get structurally invalid JSON out of
      // a schema-constrained call: the constraint guarantees shape, not
      // completion. Named separately so the logs distinguish the two.
      if (response.stop_reason === "max_tokens") {
        console.warn(`analyzePhoto truncated uid=${uid} — raise PHOTO_MAX_OUTPUT_TOKENS`);
        throw new HttpsError(
          "internal",
          "Photo analysis response was truncated.",
          { code: ErrorCode.PHOTO_ESTIMATE_FAILED },
        );
      }

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new HttpsError(
          "internal",
          "Model returned no text content.",
          { code: ErrorCode.PHOTO_ESTIMATE_FAILED },
        );
      }

      const parsed = JSON.parse(textBlock.text) as {
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
          "Could not estimate calories from this image.",
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
