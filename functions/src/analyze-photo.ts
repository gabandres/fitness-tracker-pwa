import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";
import { anthropicApiKey, callerAccess, dailyQuota, geminiApiKey, spendCeiling } from "./init";

// ─── Photo-to-Macros ────────────────────────────────────────────────

// Minimum interval between photo analyses per uid. Prevents a malicious
// client from burning the daily quota (and our model budget) in a few
// seconds. 3s is long enough to defeat scripted spam, short enough that
// a legitimate "accidentally tapped twice" user isn't locked out for long.
const PHOTO_MIN_INTERVAL_MS = 3_000;

/**
 * Whether photo-scan is paid-only, enforced HERE rather than on the client.
 * **It is not** — photo-scan is freemium: the daily caps in daily-quota.ts do
 * the tiering (3/day free, 30/day paid), which is what the freemium table
 * always promised. This flag exists to make the *other* choice reachable in
 * one word, and to record why the enforcement point is the server.
 *
 * The client cannot express "Pro" at all: `isPaid()` is forced `true` for
 * everyone while `PRO_ENABLED === false`, so a client-side paid check would
 * unlock the feature for the whole free tier — the opposite of the intent.
 * `caller.tier` reads the Stripe custom claim and ignores that flag, so if
 * this is ever flipped back to `true`, the server is the only place the
 * distinction survives.
 *
 * Costed before flipping (2026-08-04), on the active Gemini provider:
 * ~$0.0015/scan, so the free tier's 3/day is ~$0.14 per user per month even
 * if someone maxes it out every single day, and the `photo` spend ceiling
 * bounds the worst possible day at 2,000 scans ≈ $3. Photo-scan is the
 * strongest conversion lever the app has; that is cheap acquisition. On the
 * Anthropic provider the same math is ~2.7x, which is a reason to re-run it
 * before flipping PHOTO_PROVIDER, not a reason to close this gate.
 */
const PHOTO_REQUIRES_PAID = false;

/**
 * Which vision model estimates the macros. **This is a cost decision, not a
 * quality one, and it is the whole reason this is a constant rather than a
 * hardcoded call.**
 *
 * - `gemini`   — `gemini-2.5-flash`. Has a genuine free tier, which is why
 *                photo-scan has cost approximately nothing to date.
 * - `anthropic`— `claude-haiku-4-5`. No free tier: metered from the first
 *                request, ~$0.004/scan (~2.2k input = image ≈1.6k + prompt
 *                ≈600, and ~350 output, at $1/$5 per MTok). Better structured
 *                -output guarantees and explicit refusal/truncation handling.
 *
 * **Stays on `gemini` until Pro actually launches.** v1 is free, so every
 * scan today is unfunded; flipping to `anthropic` is the right move once
 * subscription revenue covers it, and at that point it is a one-word change.
 * Both providers implement the same `MacroDraft` contract below, so the
 * normalize/clamp path and the client response shape do not vary by provider.
 *
 * Whichever is active, the `photo` ceiling in spend-ceiling.ts is sized
 * against the Haiku rate — re-derive it if the model changes again.
 */
type PhotoProvider = "gemini" | "anthropic";
// The `as` is load-bearing, not noise: without it TypeScript narrows a const
// initialized with a literal down to that literal, and the dispatch below
// then fails to compile as an "unintentional comparison" — the type system
// deciding the other branch is unreachable is exactly what a switchable
// constant must not do.
const PHOTO_PROVIDER = "gemini" as PhotoProvider;

const GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Deliberately NOT prompt-cached on the Anthropic path: Haiku 4.5's minimum
 * cacheable prefix is 4096 tokens and the static prompt below is ~600, so a
 * `cache_control` breakpoint would silently never cache (no error, just
 * `cache_creation_input_tokens: 0`) while still costing the write premium.
 */
const ANTHROPIC_MODEL = "claude-haiku-4-5";

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
 * Property order matters and is shared by both providers: each emits fields
 * in schema order, so listing the chain-of-thought FIRST makes the model
 * commit to volume/density logic before producing the integers instead of
 * guessing and rationalizing after. Swapping the order would quietly degrade
 * estimate quality on either provider.
 *
 * Claude additionally requires `additionalProperties: false` on every object
 * (a 400, not a silent downgrade). Gemini's JSON mode does not accept it, so
 * it is added per-provider below rather than baked in here.
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
} as const;

/**
 * What both providers return. Every field is optional on purpose — this is
 * the RAW model output, before the normalize/clamp pass in the callable.
 * Neither adapter may round, default, or reject on values; keeping all of
 * that in one place downstream is what stops the two paths from drifting
 * into different numbers for the same photo.
 */
interface MacroDraft {
  reasoning?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  description?: string;
  confidence?: string;
}

/** Gemini path — the free-tier default. */
async function estimateWithGemini(photoBase64: string, prompt: string): Promise<MacroDraft> {
  const client = new GoogleGenAI({ apiKey: geminiApiKey.value() });
  const result = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: photoBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: {
      temperature: 0.2,
      responseMimeType: "application/json",
      // No `additionalProperties` here — Gemini's JSON mode rejects it.
      responseJsonSchema: MACRO_SCHEMA,
    },
  });
  // response.text is guaranteed valid JSON matching the schema.
  return JSON.parse(result.text ?? "{}") as MacroDraft;
}

/** Claude path — metered, better structured-output and refusal semantics. */
async function estimateWithAnthropic(photoBase64: string, prompt: string): Promise<MacroDraft> {
  const client = new Anthropic({ apiKey: anthropicApiKey.value() });
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: PHOTO_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    output_config: {
      // Claude requires this on every object; Gemini rejects it. Added here
      // rather than in MACRO_SCHEMA so one schema serves both providers.
      format: { type: "json_schema", schema: { ...MACRO_SCHEMA, additionalProperties: false } },
    },
    messages: [
      {
        role: "user",
        content: [
          // Image before text: the model reads the prompt against an image it
          // has already seen, which is the documented ordering for vision.
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photoBase64 } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  // A safety classifier can decline with HTTP 200 and an EMPTY content array
  // — reading content[0] first would throw a TypeError that reads like a
  // parse bug. Check the stop reason before touching content.
  if (response.stop_reason === "refusal") {
    throw new HttpsError(
      "internal",
      "The model declined to analyze this image.",
      { code: ErrorCode.PHOTO_ESTIMATE_FAILED },
    );
  }

  // Truncation is the other way to get structurally invalid JSON out of a
  // schema-constrained call: the constraint guarantees shape, not completion.
  if (response.stop_reason === "max_tokens") {
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
  return JSON.parse(textBlock.text) as MacroDraft;
}

export const analyzePhoto = onCall(
  // BOTH secrets are declared regardless of which provider is active, so
  // flipping PHOTO_PROVIDER is a one-word change and not a change to the
  // deployment contract. Both must exist in Secret Manager to deploy.
  { secrets: [geminiApiKey, anthropicApiKey], maxInstances: 10 },
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

    const prompt = ESTIMATION_PROMPT + descriptionLangSuffix;

    try {
      // The only place the provider choice is read. Everything below this
      // line is provider-agnostic, which is what makes flipping the constant
      // safe: the normalize/clamp pass and the client response shape are
      // shared, so the two paths cannot drift into different numbers.
      const parsed = PHOTO_PROVIDER === "anthropic"
        ? await estimateWithAnthropic(photoBase64, prompt)
        : await estimateWithGemini(photoBase64, prompt);

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
