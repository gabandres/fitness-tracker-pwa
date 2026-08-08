import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";
import { callerAccess, dailyQuota, geminiApiKey, spendCeiling } from "./init";
import { loadFoods } from "./usda-db";
import { resolveItems, totalsOf, type DraftItem, type ResolvedItem } from "./photo-resolve";

// ─── Photo-to-Macros ────────────────────────────────────────────────

// Minimum interval between photo analyses per uid. Prevents a malicious
// client from burning the daily quota (and our model budget) in a few
// seconds. 3s is long enough to defeat scripted spam, short enough that
// a legitimate "accidentally tapped twice" user isn't locked out for long.
const PHOTO_MIN_INTERVAL_MS = 3_000;

/** Beyond this many items the model is describing a buffet, not a meal. */
const MAX_ITEMS = 12;

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
 * Which vision model does the recognition. **This is a cost decision, not a
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
 * Both providers implement the same `ScanDraft` contract below, so the
 * resolution path and the client response shape do not vary by provider.
 *
 * ADR-0015 §1's whole point is that the model's numeric weakness stopped
 * mattering here: since 2026-08-07 the model is asked to *identify and size*
 * food and the bundled USDA database produces the macros, so the choice between
 * these two is about recognition quality, not arithmetic.
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
 * cacheable prefix is 4096 tokens and the static prompt below is ~700, so a
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

/**
 * ## What this prompt does NOT ask for, and why that is the point
 *
 * It does not ask for the meal's calories or protein. ADR-0015 §1 rejected that
 * design ("Cal-AI-naive") on the research finding that general LLM vision shows
 * **>60% error on protein** — this app's core metric — while being genuinely
 * good at *identifying* food and *sizing* portions. So the model is asked for a
 * list of foods, each with a weight and whether it was cooked, and
 * `photo-resolve.ts` looks the macros up in the bundled USDA database.
 *
 * The portion-cue reasoning is kept and is doing more work than before: the
 * grams are now the ONLY number the model contributes, so every macro scales
 * linearly off them. Plate diameter, utensil scale and fill level are the cues
 * that make that number defensible.
 *
 * `state` is asked of the model rather than inferred server-side because it is a
 * fact about the photograph. USDA files staples raw, and raw rice is
 * ~369 kcal/100 g against ~130 cooked, so getting this wrong overstates a plate
 * of rice threefold. No lexicon can tell a banana (raw is correct) from rice
 * (raw is a 3x error) without encoding a food taxonomy; the model can just look.
 *
 * The per-item `kcal`/`protein`/`carbs`/`fat` are a **fallback**, used only for
 * items the database cannot resolve — mofongo, pernil, pan sobao. They are last
 * in the schema on purpose so the model commits to identification first.
 */
const ESTIMATION_PROMPT = `Identify every distinct food in this meal photo and estimate the weight of each.

Your job is RECOGNITION and PORTION SIZE. A nutrition database supplies the
calories and macros from the food name and weight you provide, so naming the food
precisely and sizing it well matters far more than any number you output.

For each item:
- "name": a short, specific food name a nutrition database would carry
  ("grilled chicken breast", "white rice", "black beans"). Prefer the plain food
  name over a recipe name. Name each component separately rather than describing
  the plate as one dish, unless it genuinely is one mixed dish.
- "grams": the edible weight on the plate, in grams. Use visual cues — plate
  diameter (a dinner plate is ~27 cm), utensil scale, pile height, how full the
  bowl is, thickness of a cut of meat.
- "state": "cooked" for anything cooked, baked, fried, boiled or grilled;
  "raw" for salad, fruit, nuts, cheese, milk, sashimi and anything else served
  uncooked. Judge what you SEE on the plate, not how the food is usually sold.
- "confidence": "low" if that item is blurry, buried, or you are unsure what it is.

Portion reasoning requirement:
- Before listing items, populate "reasoning" with a concise chain-of-thought that
  identifies each item and justifies its weight from the visual cues above.
  The weights must follow from that reasoning, not be guessed and backfilled.

Include cooking fats as their own item when clearly present (oil, butter,
dressing, sauce) — fried or sautéed items imply oil; pressed sandwiches
(cubano, medialunas) imply butter.

Fallback macros: also give kcal/protein/carbs/fat for each item, for the whole
portion. These are used ONLY for foods a USDA database will not carry — regional
dishes like mofongo, tostones, pernil or pan sobao. For common foods they are
ignored, so do not spend effort on them.

Reference weights for Puerto Rican / Latin staples:
- White rice, 1 cup cooked: ~160 g · Habichuelas/beans, 1/2 cup: ~90 g
- Pernil / lechón, 3 oz: ~85 g (~260 cal, 20g protein)
- Tostones, 2 pieces: ~50 g (~160 cal, 1g protein)
- Mofongo, 1 serving: ~200 g (~380 cal, 4g protein)
- Pan Sobao, 1 medium slice: ~55 g (~170 cal, 5g protein)
- Pan de Bono, 1 piece: ~40 g (~185 cal, 6g protein)
- Arroz con pollo, 1 plate: ~350 g (~550 cal, 35g protein)`;

/**
 * Property order matters and is shared by both providers: each emits fields
 * in schema order, so listing the chain-of-thought FIRST makes the model
 * commit to portion logic before producing the numbers instead of guessing and
 * rationalizing after. Within an item, identification (`name`, `grams`,
 * `state`) precedes the fallback macros for the same reason. Swapping either
 * order would quietly degrade estimate quality on either provider.
 *
 * Claude additionally requires `additionalProperties: false` on every object
 * (a 400, not a silent downgrade). Gemini's JSON mode does not accept it, so
 * it is added per-provider below rather than baked in here.
 */
const SCAN_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description:
        "Chain-of-thought: identify each food and justify its weight from visual cues " +
        "(plate diameter, utensil scale, pile height, bowl fill). Must precede and " +
        "justify the per-item grams.",
    },
    items: {
      type: "array",
      description: "Every distinct food on the plate, one entry each.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short specific food name a nutrition database would carry" },
          grams: { type: "number", description: "Edible weight of this item on the plate, in grams" },
          state: {
            type: "string",
            enum: ["cooked", "raw"],
            description: "How this food appears in the photo, not how it is usually sold",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Confidence in identifying and sizing THIS item",
          },
          kcal: { type: "number", description: "Fallback only: calories for this portion" },
          protein: { type: "number", description: "Fallback only: protein in grams for this portion" },
          carbs: { type: "number", description: "Fallback only: carbohydrate in grams for this portion" },
          fat: { type: "number", description: "Fallback only: fat in grams for this portion" },
        },
        required: ["name", "grams", "state", "confidence", "kcal", "protein", "carbs", "fat"],
      },
    },
    description: { type: "string", description: "Brief 3-5 word description of the whole meal" },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Overall confidence based on image clarity and portion visibility",
    },
  },
  required: ["reasoning", "items", "description", "confidence"],
} as const;

/**
 * What both providers return. Every field is optional on purpose — this is
 * the RAW model output, before resolution and clamping. Neither adapter may
 * round, default, or reject; keeping all of that downstream in one place is
 * what stops the two paths from drifting into different numbers for the same
 * photo.
 */
interface ScanDraft {
  reasoning?: string;
  items?: DraftItem[];
  description?: string;
  confidence?: string;
}

/** Gemini path — the free-tier default. */
async function estimateWithGemini(photoBase64: string, prompt: string): Promise<ScanDraft> {
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
      responseJsonSchema: SCAN_SCHEMA,
    },
  });
  // response.text is guaranteed valid JSON matching the schema.
  return JSON.parse(result.text ?? "{}") as ScanDraft;
}

/** Claude path — metered, better structured-output and refusal semantics.
 *
 * NOT deployable as-is. `ANTHROPIC_API_KEY` was removed from this function's
 * `secrets: []` on 2026-08-07 (see init.ts for why), so the key is not mounted
 * and this reads an env var that is absent in production. Flipping
 * `PHOTO_PROVIDER` to "anthropic" without first restoring the secret binding
 * therefore fails HERE, loudly and on the first call — which is the point. The
 * alternative was an empty API key producing a 401 from Anthropic that reads
 * like a bad key rather than a missing deployment step.
 */
async function estimateWithAnthropic(photoBase64: string, prompt: string): Promise<ScanDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not mounted. PHOTO_PROVIDER is set to \"anthropic\" but the " +
        "secret was removed from analyzePhoto's `secrets: []` (2026-08-07). Re-create the " +
        "secret, restore defineSecret in init.ts, and re-add it here before flipping.",
    );
  }
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: PHOTO_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    output_config: {
      // Claude requires this on every object; Gemini rejects it. Added here
      // rather than in SCAN_SCHEMA so one schema serves both providers.
      format: { type: "json_schema", schema: withAdditionalPropsFalse(SCAN_SCHEMA) },
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
  return JSON.parse(textBlock.text) as ScanDraft;
}

/**
 * Claude wants `additionalProperties: false` on EVERY object, including the one
 * nested inside `items`. A shallow spread only reaches the top level, which
 * fails with a 400 naming the nested object — an easy thing to miss now that the
 * schema has depth.
 */
function withAdditionalPropsFalse(schema: unknown): Record<string, unknown> {
  return walkSchema(schema) as Record<string, unknown>;
}

function walkSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walkSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = walkSchema(v);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

export const analyzePhoto = onCall(
  // Only the ACTIVE provider's secret is declared. This used to bind both, so
  // that flipping PHOTO_PROVIDER was a one-word change — a genuinely nice
  // property, given up on 2026-08-07 because an unused secret costs one of the
  // 6 free ACTIVE versions per BILLING ACCOUNT (this account was at 14) and the
  // Anthropic key had leaked in plaintext. Flipping providers is now a
  // three-step change; estimateWithAnthropic throws with those steps if you
  // forget. See init.ts.
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

    // Locale-aware naming. The macros are locale-agnostic — they come from the
    // database — so only the human-readable text flips language.
    const descriptionLangSuffix = locale === "es-PR"
      ? "\n\nReturn `description` and each item's `name` in Puerto Rican Spanish (e.g. 'pollo con arroz')."
      : "\n\nReturn `description` and each item's `name` in English.";

    const prompt = ESTIMATION_PROMPT + descriptionLangSuffix;

    try {
      // The only place the provider choice is read. Everything below this
      // line is provider-agnostic, which is what makes flipping the constant
      // safe: resolution and the client response shape are shared, so the two
      // paths cannot drift into different numbers.
      const parsed = PHOTO_PROVIDER === "anthropic"
        ? await estimateWithAnthropic(photoBase64, prompt)
        : await estimateWithGemini(photoBase64, prompt);

      // Log the chain-of-thought so we can audit estimation quality without
      // surfacing it in the client response (keeps the client contract stable).
      if (parsed.reasoning) {
        console.log(`analyzePhoto reasoning uid=${uid}:`, parsed.reasoning);
      }

      const drafts = Array.isArray(parsed.items) ? parsed.items.slice(0, MAX_ITEMS) : [];
      if (drafts.length === 0) {
        throw new HttpsError(
          "internal",
          "Could not identify any food in this image.",
          { code: ErrorCode.PHOTO_ESTIMATE_FAILED },
        );
      }

      // The substitution ADR-0015 §1 called for: the model said WHAT and HOW
      // MUCH, the bundled USDA database says how many calories that is.
      const items = resolveItems(loadFoods(), drafts);
      const totals = totalsOf(items);

      const description = typeof parsed.description === "string" ? parsed.description.slice(0, 100) : "Meal";
      const confidence = (parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high")
        ? parsed.confidence : "medium";

      // Audit trail for how well resolution is doing on real photos. This is
      // the number that says whether the USDA path is actually being used, and
      // it is not visible anywhere else.
      const grounded = items.filter((i) => i.source === "usda").length;
      console.log(
        `analyzePhoto resolved uid=${uid}: ${grounded}/${items.length} from USDA · ` +
          items.map((i) => `${i.name}→${i.matchedDescription ?? "(model)"}`).join(" | "),
      );

      return {
        // ── The itemized result (ADR-0015 §1). New clients render these rows.
        items: items.map(toWireItem),
        source: grounded > 0 ? ("usda" as const) : ("model" as const),

        // ── The flat whole-meal total, KEPT DELIBERATELY.
        // Every binary in users' hands — iOS build 24/25, Android vc 11/13, and
        // the deployed web app — reads only these fields. Dropping them would
        // break photo-scan for every installed client the moment this deploys,
        // and mobile fixes take a store release. So the response is ADDITIVE:
        // old clients keep working and immediately get USDA-grounded totals
        // instead of model-guessed ones, without shipping anything.
        calories: totals.calories,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
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

/** Drop the server-only fields; `ResolvedItem` is a superset of the wire shape. */
function toWireItem(i: ResolvedItem) {
  return {
    name: i.name,
    grams: i.grams,
    calories: i.calories,
    protein: i.protein,
    carbs: i.carbs,
    fat: i.fat,
    confidence: i.confidence,
    source: i.source,
    fdcId: i.fdcId ?? null,
    matchedDescription: i.matchedDescription ?? null,
  };
}
