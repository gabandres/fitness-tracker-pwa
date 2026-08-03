#!/usr/bin/env node
/**
 * validate-photo-itemiser — run ADR-0015's photo validation gate.
 *
 *   node scripts/validate-photo-itemiser.mjs --dir <folder of meal photos>
 *
 * ## What this is measuring, and what it deliberately is NOT
 *
 * ADR-0015 §1 decided the vision model does **recognition + portion only**;
 * the USDA/`customFoods` data produces the macros. Its validation gate is
 * therefore explicit: judge the **item list and the portion**, NOT the macros.
 * This script never asks the model for a calorie or a gram of protein, and the
 * grading sheet it emits has no column for them. If you find yourself scoring
 * "were the calories right", you are running the wrong experiment — that is the
 * Cal-AI-naive design the ADR rejected on >60% protein error.
 *
 * What the gate answers is a single question: **is this model good enough at
 * naming the foods and sizing the portions to be worth wiring to the food
 * database?** A model that says "white rice, ~1 cup" and is right is useful even
 * though it emitted no numbers, because `functions/src/food-search.ts` turns
 * that into macros deterministically.
 *
 * ## Why the model is a parameter
 *
 * The itemiser's job is far easier than emitting four macro numbers, so it
 * should be tested on the cheapest model first and escalated only on failure.
 * Default is Haiku 4.5. Per-scan cost at 896px is roughly 5x lower than Opus 5,
 * which is the difference between a viable free tier and one that is not.
 *
 * ## Ground truth is yours
 *
 * There is no automated scorer here, and that is not laziness — "was the plate
 * really 180g of chicken" is only knowable by the person who ate it. The script
 * produces a filled-in-by-hand markdown sheet. Photograph meals you can weigh
 * or reasonably estimate, and prefer the food you actually eat: a model that
 * nails a stock photo of a Caesar salad and misses mofongo is not validated for
 * this app.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(join(root, '.env.local'));
} catch {
  /* optional */
}

// ─── Args ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const DIR = arg('dir');
const MODEL = arg('model', 'claude-haiku-4-5');
const LONG_EDGE = Number(arg('px', 896));
const LIMIT = Number(arg('limit', 100));
const THINK = flag('think');

if (!DIR || flag('help')) {
  console.log(`
Usage: node scripts/validate-photo-itemiser.mjs --dir <folder> [options]

  --dir <path>      Folder of meal photos (.jpg/.jpeg/.png/.webp). Required.
  --model <id>      Default: claude-haiku-4-5. Try claude-sonnet-5 if Haiku fails.
  --px <n>          Long-edge resize before upload. Default 896.
                    Images are billed as ceil(w/28)*ceil(h/28) visual tokens, so
                    this is the single biggest cost lever. 896 square = 1024
                    tokens; the app's current 1080px resize = ~2028.
  --limit <n>       Stop after n photos (for a cheap first look).
  --think           Enable extended thinking (Haiku 4.5 only supports the
                    budget_tokens form). Off by default: it roughly doubles
                    output tokens, and portion estimation may not need it.
                    Worth one run each way if the no-think numbers are close.

Needs ANTHROPIC_API_KEY in .env.local or the environment.
`);
  process.exit(DIR ? 0 : 1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    'ANTHROPIC_API_KEY is not set. Add it to .env.local (git-ignored) — the same\n' +
      'file that already holds ASC_ISSUER_ID and SENTRY_AUTH_TOKEN.',
  );
  process.exit(1);
}

// ─── Pricing (per million tokens, read from the docs 2026-08-03) ───────
//
// Re-check before quoting these anywhere that matters; model prices move and
// Sonnet 5 in particular is on introductory pricing that expires 2026-08-31.

const PRICING = {
  'claude-haiku-4-5': { in: 1, out: 5, tier: 'standard' },
  'claude-sonnet-5': { in: 3, out: 15, tier: 'high-res' },
  'claude-opus-5': { in: 5, out: 25, tier: 'high-res' },
  'claude-opus-4-8': { in: 5, out: 25, tier: 'high-res' },
};

// ─── The itemiser prompt ───────────────────────────────────────────────
//
// This is the product artifact, not scaffolding — if the gate passes, this text
// is what `scanMeal` ships with. Three things in it are load-bearing:
//
// 1. It forbids macro numbers outright. That is the ADR-0015 split.
// 2. It asks for cooking fat as its own LINE ITEM rather than folding it
//    invisibly into a total. The hidden-oil problem cannot be solved by a
//    photo — but it can be made VISIBLE and editable, which is the honest
//    product answer. A user who can see "cooking oil ~1 tbsp" can delete it;
//    a user handed one number cannot.
// 3. It asks for a `usdaQuery` per item. That is the actual handoff to
//    `functions/src/food-search.ts`, so the gate tests the string we will
//    really search with, not a display name we would have to re-derive.

const SYSTEM = `You identify foods in a meal photograph and estimate their portions.

You do NOT estimate calories, protein, carbohydrates, or fat. Those are looked up
from a food database afterwards using the item names and portions you return.
Never output a macro number, and never let one influence your portion estimate.

For each distinct food you can see, return:
  - name: what a person would call it, in the photo's apparent cuisine
  - usdaQuery: a short search string for a food database — generic, unbranded,
    and preparation-aware ("chicken breast, grilled" not "the chicken")
  - grams: your best estimate of the edible portion in grams
  - portionBasis: the visual cue you used (plate diameter, utensil, fill level,
    pile height, a known package size, hand/finger scale)
  - confidence: high | medium | low

Rules that matter:
  - Cooking fat is a separate item. If a dish was fried, sauteed, dressed, or
    buttered, add an explicit line for the fat with your gram estimate. Do not
    fold it silently into another item. If you cannot tell, say so with low
    confidence rather than omitting it.
  - Sauces, dressings and syrups are separate items for the same reason.
  - Split composite dishes into components ONLY when they are separable on the
    plate. A stew is one item; rice next to beans is two.
  - If the same food appears in two places, return one item with the combined
    portion.
  - Use low confidence freely. A low-confidence item the user can correct is
    more useful than a confident guess. Confidence describes THIS photo — how
    clearly you can see the item and judge its size — not how well you know the
    food in general.
  - If the image contains no food, return an empty items array.

Portion estimation: reason from visible scale references before committing to a
number. A dinner plate is about 27 cm across; a fork is about 19 cm; a standard
can is 12 cm tall. State which reference you used in portionBasis.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          usdaQuery: { type: 'string' },
          grams: { type: 'integer' },
          portionBasis: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['name', 'usdaQuery', 'grams', 'portionBasis', 'confidence'],
        additionalProperties: false,
      },
    },
    imageQuality: {
      type: 'string',
      enum: ['clear', 'usable', 'poor'],
      description: 'Whether the photo itself supports a portion estimate at all.',
    },
  },
  required: ['items', 'imageQuality'],
  additionalProperties: false,
};

// ─── Run ───────────────────────────────────────────────────────────────

const client = new Anthropic();
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const dirPath = resolve(process.cwd(), DIR);
if (!existsSync(dirPath)) {
  console.error(`No such folder: ${dirPath}`);
  process.exit(1);
}

const files = (await readdir(dirPath))
  .filter((f) => PHOTO_EXT.has(extname(f).toLowerCase()))
  .sort()
  .slice(0, LIMIT);

if (!files.length) {
  console.error(`No .jpg/.jpeg/.png/.webp files in ${dirPath}`);
  process.exit(1);
}

const price = PRICING[MODEL];
if (!price) {
  console.warn(`No cached price for ${MODEL} — cost columns will read 0.`);
}

console.log(`Model    ${MODEL}`);
console.log(`Photos   ${files.length} from ${dirPath}`);
console.log(`Resize   long edge ${LONG_EDGE}px${THINK ? ' · thinking ON' : ''}\n`);

const results = [];
let totals = { in: 0, out: 0, ms: 0, failed: 0 };

for (const [i, file] of files.entries()) {
  const label = `[${String(i + 1).padStart(2)}/${files.length}] ${file}`;
  try {
    const raw = await readFile(join(dirPath, file));
    // `inside` never enlarges, so a photo already under the cap is untouched.
    const buf = await sharp(raw)
      .rotate() // honour EXIF orientation — a sideways plate reads as a different dish
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const meta = await sharp(buf).metadata();
    // The billing formula from the vision docs: 28x28-pixel patches.
    const visualTokens = Math.ceil(meta.width / 28) * Math.ceil(meta.height / 28);

    const started = Date.now();
    const req = {
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            // Image before text: the docs note Claude does best in that order.
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } },
            { type: 'text', text: 'Identify the foods and estimate portions.' },
          ],
        },
      ],
    };
    // Haiku 4.5 predates adaptive thinking — it only takes the budget_tokens
    // form, and budget_tokens must be < max_tokens.
    if (THINK) req.thinking = { type: 'enabled', budget_tokens: 1024 };

    const res = await client.messages.create(req);
    const ms = Date.now() - started;

    const text = res.content.find((b) => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text);

    totals.in += res.usage.input_tokens;
    totals.out += res.usage.output_tokens;
    totals.ms += ms;

    results.push({
      file,
      px: `${meta.width}x${meta.height}`,
      visualTokens,
      usage: { in: res.usage.input_tokens, out: res.usage.output_tokens },
      ms,
      imageQuality: parsed.imageQuality,
      items: parsed.items ?? [],
    });

    const names = (parsed.items ?? []).map((it) => `${it.name} ~${it.grams}g`).join(', ');
    console.log(`${label}  ${ms}ms  ${res.usage.input_tokens}in/${res.usage.output_tokens}out`);
    console.log(`         ${names || '(no food found)'}`);
  } catch (err) {
    totals.failed += 1;
    results.push({ file, error: String(err.message ?? err) });
    console.log(`${label}  FAILED: ${err.message ?? err}`);
  }
}

// ─── Report ────────────────────────────────────────────────────────────

const costIn = price ? (totals.in / 1e6) * price.in : 0;
const costOut = price ? (totals.out / 1e6) * price.out : 0;
const ok = results.length - totals.failed;
const perScan = ok ? (costIn + costOut) / ok : 0;

console.log('\n─── Run totals ───');
console.log(`Scans        ${ok} ok, ${totals.failed} failed`);
console.log(`Tokens       ${totals.in} in / ${totals.out} out`);
console.log(`Cost         $${(costIn + costOut).toFixed(4)} total · $${perScan.toFixed(5)}/scan`);
console.log(`             → $${(perScan * 1000).toFixed(2)} per 1,000 scans`);
console.log(`             → $${(perScan * 90).toFixed(2)}/user/month at 3 scans a day`);
console.log(`Latency      ${ok ? Math.round(totals.ms / ok) : 0}ms mean`);

const outDir = join(root, 'scratch');
await mkdir(outDir, { recursive: true });
const stamp = MODEL.replace(/[^a-z0-9]/gi, '-');

await writeFile(
  join(outDir, `itemiser-${stamp}.json`),
  JSON.stringify({ model: MODEL, longEdge: LONG_EDGE, thinking: THINK, totals, perScan, results }, null, 2),
);

// The grading sheet. Deliberately has no macro column — see the header.
const sheet = [
  `# Photo itemiser validation — ${MODEL}`,
  '',
  `Run at long edge ${LONG_EDGE}px${THINK ? ', thinking on' : ''}. ${ok} photos.`,
  `Measured cost: **$${perScan.toFixed(5)}/scan** ($${(perScan * 1000).toFixed(2)} per 1,000).`,
  '',
  '**Score the item list and the portions. There is no macro column on purpose**',
  "— macros come from the food database, so they are not this model's to get wrong",
  '(ADR-0015 §1).',
  '',
  '| # | photo | items returned | all real? | any missed? | portions ±25%? | verdict |',
  '|---|---|---|---|---|---|---|',
  ...results.map((r, i) =>
    r.error
      ? `| ${i + 1} | \`${r.file}\` | ERROR: ${r.error} | | | | fail |`
      : `| ${i + 1} | \`${r.file}\` | ${r.items.map((it) => `${it.name} ~${it.grams}g (${it.confidence})`).join('<br>') || '(none)'} | | | | |`,
  ),
  '',
  '## How to score',
  '',
  '- **all real?** — did it invent a food that is not on the plate? One hallucinated',
  '  item is worse than one missed item: the user has to notice it to delete it.',
  '- **any missed?** — a food on the plate it did not list. Cooking oil and sauces',
  '  count; they are the ones that matter, and the prompt asks for them explicitly.',
  '- **portions ±25%?** — the honest bar. Tighter than that is not achievable from a',
  '  single photo and the review screen exists so the user can fix it.',
  '',
  '## The bar',
  '',
  'Pass if, across the set: **no hallucinated items**, **≥80% of items identified**,',
  'and **≥60% of portions within ±25%**. That is enough to pre-fill a review screen',
  'the user corrects — which is the whole product claim. It is NOT enough to emit a',
  'number and call it a calorie count, and it was never meant to be.',
  '',
  'If Haiku fails on identification, escalate to `--model claude-sonnet-5` and re-run.',
  'If it fails on portions only, try `--think` before escalating — portion estimation',
  'is the part most likely to benefit from reasoning, and it is far cheaper than a',
  'model jump.',
].join('\n');

await writeFile(join(outDir, `itemiser-${stamp}.md`), sheet);

console.log(`\nWrote scratch/itemiser-${stamp}.json`);
console.log(`      scratch/itemiser-${stamp}.md   ← grading sheet, fill this in`);
