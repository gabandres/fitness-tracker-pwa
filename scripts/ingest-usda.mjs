#!/usr/bin/env node
/**
 * Curated USDA food-DB ingest (see docs/usda-food-db-scoping.md).
 *
 * Turns the USDA FoodData Central bulk CSVs into one compact JSON the
 * `searchFoods` / `getFoodDetail` Cloud Functions can load in memory — killing
 * the live FDC API dependency. CC0 data ($0). Deterministic; run once, commit
 * the output (or wire it as a build step).
 *
 * ── Prep (owner, once) ──
 * From https://fdc.nal.usda.gov/download-datasets download the **Full Download
 * (CSV)** for each of:
 *   - SR Legacy
 *   - Foundation Foods
 * Unzip each into its OWN folder (they share filenames), e.g. ./usda/sr and
 * ./usda/foundation. Each folder must contain: food.csv, food_nutrient.csv,
 * food_portion.csv, measure_unit.csv.
 *
 * ── Run ──
 *   node scripts/ingest-usda.mjs functions/data/usda-foods.json ./usda/sr ./usda/foundation
 *
 * Output: an array of
 *   { id, desc, dataType, per100: {kcal, protein, carb, fat}, portions: [{label, grams}] }
 * Foundation entries override SR on a normalized-description clash for their
 * (higher-quality) macros, while keeping whichever has household portions.
 *
 * No external deps — a small correct CSV parser is inlined.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// FDC nutrient ids for the four macros (amounts are per 100 g of food).
const N = { kcal: '1008', protein: '1003', fat: '1004', carb: '1005' };
const UNITLESS_MEASURE_ID = '9999'; // SR/Foundation put the measure text in `modifier`

/** Minimal RFC-4180-ish CSV parser: handles quoted fields with embedded commas,
 *  newlines, and doubled quotes. Returns rows as string[]. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // ignore; \n handles the break
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Read a CSV into { colIndex, rows } indexed by header name (order-robust). */
function readTable(dir, file) {
  const text = readFileSync(join(dir, file), 'utf8');
  const rows = parseCsv(text);
  const header = rows.shift() ?? [];
  const colIndex = {};
  header.forEach((h, i) => (colIndex[h.trim()] = i));
  return { colIndex, rows };
}

const num = (s) => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const round1 = (n) => Math.round(n * 10) / 10;
const normalizeDesc = (d) => d.trim().toLowerCase().replace(/\s+/g, ' ');

/** Build the per-food records for one dataset directory. */
function ingestDir(dir) {
  const food = readTable(dir, 'food.csv');
  const fnut = readTable(dir, 'food_nutrient.csv');
  const portion = readTable(dir, 'food_portion.csv');
  let units;
  try {
    units = readTable(dir, 'measure_unit.csv');
  } catch {
    units = { colIndex: { id: 0, name: 1 }, rows: [] };
  }

  const unitName = new Map(); // measure_unit_id -> name
  for (const r of units.rows) unitName.set(r[units.colIndex.id], r[units.colIndex.name]);

  // fdc_id -> { desc, dataType, per100 }
  const foods = new Map();
  const fc = food.colIndex;
  for (const r of food.rows) {
    const id = r[fc.fdc_id];
    if (!id) continue;
    foods.set(id, {
      id,
      desc: (r[fc.description] ?? '').trim(),
      dataType: r[fc.data_type] ?? '',
      per100: { kcal: 0, protein: 0, carb: 0, fat: 0 },
      portions: [],
    });
  }

  // Macros: filter food_nutrient to the four ids we care about.
  const wanted = new Set(Object.values(N));
  const nc = fnut.colIndex;
  for (const r of fnut.rows) {
    const nid = r[nc.nutrient_id];
    if (!wanted.has(nid)) continue;
    const f = foods.get(r[nc.fdc_id]);
    if (!f) continue;
    const amount = num(r[nc.amount]);
    if (amount == null) continue;
    if (nid === N.kcal) f.per100.kcal = amount;
    else if (nid === N.protein) f.per100.protein = amount;
    else if (nid === N.fat) f.per100.fat = amount;
    else if (nid === N.carb) f.per100.carb = amount;
  }

  // Household portions with gram weights.
  const pc = portion.colIndex;
  for (const r of portion.rows) {
    const f = foods.get(r[pc.fdc_id]);
    if (!f) continue;
    const grams = num(r[pc.gram_weight]);
    if (grams == null || grams <= 0) continue;
    const amount = num(r[pc.amount]);
    const muId = r[pc.measure_unit_id];
    const measure =
      muId && muId !== UNITLESS_MEASURE_ID ? unitName.get(muId) : null;
    const modifier = (r[pc.modifier] ?? r[pc.portion_description] ?? '').trim();
    const unit = measure ?? modifier ?? '';
    const label = [amount && amount !== 1 ? amount : amount === 1 && unit ? '1' : '', unit]
      .filter(Boolean)
      .join(' ')
      .trim();
    f.portions.push({ label: label || `${round1(grams)} g`, grams: round1(grams) });
  }

  // Keep only foods with a real calorie value (drops incomplete rows).
  return [...foods.values()].filter((f) => f.per100.kcal > 0);
}

function main() {
  const [, , out, ...dirs] = process.argv;
  if (!out || dirs.length === 0) {
    console.error(
      'Usage: node scripts/ingest-usda.mjs <out.json> <dataset-dir> [more-dirs...]\n' +
        'See the header of this file for how to download the CSVs.',
    );
    process.exit(1);
  }

  // Later dirs override earlier ones on a normalized-description clash (pass
  // Foundation AFTER SR so its higher-quality macros win; SR portions are kept
  // when Foundation lacks them).
  const byNorm = new Map();
  for (const dir of dirs) {
    const recs = ingestDir(dir);
    console.error(`  ${dir}: ${recs.length} foods with macros`);
    for (const rec of recs) {
      const key = normalizeDesc(rec.desc);
      const prev = byNorm.get(key);
      if (prev && rec.portions.length === 0 && prev.portions.length > 0) {
        // Foundation override with no portions → take its macros, keep SR portions.
        byNorm.set(key, { ...rec, portions: prev.portions });
      } else {
        byNorm.set(key, rec);
      }
    }
  }

  const foods = [...byNorm.values()].map((f) => ({
    id: f.id,
    desc: f.desc,
    dataType: f.dataType,
    per100: {
      kcal: round1(f.per100.kcal),
      protein: round1(f.per100.protein),
      carb: round1(f.per100.carb),
      fat: round1(f.per100.fat),
    },
    portions: f.portions.slice(0, 12),
  }));
  foods.sort((a, b) => a.desc.localeCompare(b.desc));

  writeFileSync(out, JSON.stringify(foods));
  const mb = (Buffer.byteLength(JSON.stringify(foods)) / 1e6).toFixed(2);
  console.error(`Wrote ${foods.length} foods → ${out} (${mb} MB). Data: USDA FoodData Central (CC0).`);
}

main();
