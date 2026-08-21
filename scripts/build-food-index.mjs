#!/usr/bin/env node
/**
 * build-food-index — compact the bundled USDA dataset for ON-DEVICE search.
 *
 *   node scripts/build-food-index.mjs [--check]
 *
 * Reads `functions/data/usda-foods.json` (the committed ingest, ~3.5 MB, 13,272
 * foods — see ADR-0018) and writes the compact form the mobile app bundles and
 * searches locally, with no `searchFoods` round trip at all.
 *
 * ## Why a second format instead of shipping the ingest as-is
 *
 * The ingest is written for readability and for the Cloud Function, which pays
 * its parse once per instance and has a server's memory. On a phone the same
 * bytes are bundle weight and resident heap on the weakest supported device
 * (minSdk 26; the QA device is an LG G6 on Android 9). Three cheap
 * transformations do the work — none of them lossy:
 *
 *   1. **Objects → positional arrays.** Every record repeats the same five
 *      keys; at 13,272 records those key names alone are most of the file.
 *   2. **`dataType` interned.** Three distinct values across the whole set, so
 *      each becomes a small integer index into a header table.
 *   3. **Portion labels interned.** 35,594 portions share a few hundred labels
 *      ("1 cup", "1 tbsp", "85 g"), so each becomes an index too, and the
 *      label/gram pairs are flattened rather than nested in per-portion objects.
 *
 * `--check` regenerates in memory and exits non-zero if the committed output is
 * stale, without writing. That is what CI and `npm run doctor` can call: the
 * failure mode this guards against is a re-ingest that updates the source and
 * leaves the phone searching last month's food database, which nothing else
 * would notice.
 *
 * ## The invariant that matters
 *
 * The compact form must decode back to EXACTLY the ingest records — same ids,
 * same descriptions, same macros, same portions in the same order. Ranking
 * parity between this and the server is enforced separately, by the golden
 * fixture in `packages/core`; this script verifies the ROUND TRIP before it
 * writes, so a decode bug cannot reach a device.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'functions/data/usda-foods.json');
const OUT = join(ROOT, 'apps/mobile/assets/food-index.json');

const checkOnly = process.argv.includes('--check');

/** Current schema version. Bump when the positional layout changes — the
 *  reader in `@macrolog/core` refuses a version it does not know rather than
 *  silently misreading offsets. */
const FORMAT_VERSION = 1;

const foods = JSON.parse(readFileSync(SRC, 'utf8'));

// ── intern tables ────────────────────────────────────────────────────────
const dataTypes = [];
const dataTypeIx = new Map();
const labels = [];
const labelIx = new Map();

const intern = (list, ix, value) => {
  let i = ix.get(value);
  if (i === undefined) {
    i = list.length;
    list.push(value);
    ix.set(value, i);
  }
  return i;
};

const rows = foods.map((f) => {
  // Portions flatten to [labelIdx, grams, labelIdx, grams, …]. Nested pairs
  // cost two brackets each and there are 35,594 of them.
  const portions = [];
  for (const p of f.portions) {
    portions.push(intern(labels, labelIx, p.label), p.grams);
  }
  return [
    f.id,
    f.desc,
    intern(dataTypes, dataTypeIx, f.dataType),
    f.per100.kcal,
    f.per100.protein,
    f.per100.carb,
    f.per100.fat,
    portions,
  ];
});

const index = { v: FORMAT_VERSION, dataTypes, labels, foods: rows };
const json = JSON.stringify(index);

// ── round-trip proof, before anything is written ─────────────────────────
// Decode with the same offsets the reader uses and compare against the source.
// A positional format is exactly the kind that fails silently when a field is
// inserted, so this is asserted rather than trusted.
const decoded = rows.map((r) => ({
  id: r[0],
  desc: r[1],
  dataType: dataTypes[r[2]],
  per100: { kcal: r[3], protein: r[4], carb: r[5], fat: r[6] },
  portions: (() => {
    const out = [];
    for (let i = 0; i < r[7].length; i += 2) out.push({ label: labels[r[7][i]], grams: r[7][i + 1] });
    return out;
  })(),
}));

if (JSON.stringify(decoded) !== JSON.stringify(foods)) {
  // Narrow it down rather than printing two 3.5 MB blobs.
  for (let i = 0; i < foods.length; i++) {
    if (JSON.stringify(decoded[i]) !== JSON.stringify(foods[i])) {
      console.error(`round trip FAILED at record ${i} (id ${foods[i].id})`);
      console.error('  source :', JSON.stringify(foods[i]).slice(0, 300));
      console.error('  decoded:', JSON.stringify(decoded[i]).slice(0, 300));
      break;
    }
  }
  process.exit(1);
}

const srcBytes = readFileSync(SRC).length;
const outBytes = Buffer.byteLength(json);
const gzBytes = gzipSync(json, { level: 9 }).length;
const pct = (n) => `${((n / srcBytes) * 100).toFixed(0)}%`;

console.log(`foods         ${foods.length.toLocaleString()}`);
console.log(`dataTypes     ${dataTypes.length} interned`);
console.log(`labels        ${labels.length.toLocaleString()} interned (${rows.reduce((n, r) => n + r[7].length / 2, 0).toLocaleString()} portions)`);
console.log(`source        ${(srcBytes / 1024).toFixed(0)} KB`);
console.log(`compact       ${(outBytes / 1024).toFixed(0)} KB  (${pct(outBytes)} of source)`);
console.log(`compact.gz    ${(gzBytes / 1024).toFixed(0)} KB  (${pct(gzBytes)} of source)`);
console.log(`round trip    OK — decodes back to the ingest exactly`);

if (checkOnly) {
  if (!existsSync(OUT)) {
    console.error(`\nSTALE: ${OUT} does not exist. Run: node scripts/build-food-index.mjs`);
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== json) {
    console.error(`\nSTALE: ${OUT} does not match the current ingest.`);
    console.error('Run: node scripts/build-food-index.mjs');
    process.exit(1);
  }
  console.log(`\ncommitted index is up to date`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, json);
console.log(`\nwrote ${OUT}`);
