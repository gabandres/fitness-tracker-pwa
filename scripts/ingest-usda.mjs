#!/usr/bin/env node
/**
 * Curated USDA food-DB ingest (see docs/usda-food-db-scoping.md).
 *
 * Turns the USDA FoodData Central bulk CSVs into one compact JSON the
 * `searchFoods` / `getFoodDetail` Cloud Functions load in memory — killing the
 * live FDC API dependency (and its API key, and its rate ceiling). CC0 data, $0
 * runtime. Deterministic: same inputs → byte-identical output.
 *
 * ── Run ──
 *   node scripts/ingest-usda.mjs
 *
 * That is the whole procedure. The script downloads and unzips the three source
 * datasets itself (~13 MB total, cached under .cache/usda so a re-run is
 * offline). An earlier revision of this file required the owner to hand-download
 * "multi-GB" archives; that figure was the Branded/full download, which we do
 * not use. The three we DO use are 6.1 MB + 3.4 MB + 3.3 MB compressed.
 *
 * Flags:
 *   --out <path>   output JSON (default functions/data/usda-foods.json)
 *   --cache <dir>  zip cache directory (default .cache/usda)
 *   --offline      fail instead of downloading; use only the cache
 *   --no-survey    exclude FNDDS (see the dataset table below)
 *
 * ── Datasets ──
 * | Set        | Foods | Why in |
 * |------------|-------|--------|
 * | SR Legacy  | ~7.8k | broad generic-food coverage with household portions   |
 * | Foundation | ~400  | lab-analyzed; best macros, overrides SR on a clash    |
 * | FNDDS      | ~7.7k | "as eaten" dishes, and by far the most natural names  |
 *
 * Branded (~2M) is deliberately OUT — label-quality and huge; the barcode path
 * already covers packaged goods via Open Food Facts.
 *
 * Output: an array of
 *   { id, desc, dataType, per100: {kcal, protein, carb, fat}, portions: [{label, grams}] }
 * sorted by description, so a diff of two ingests is readable.
 *
 * No external deps — a CSV parser and a minimal ZIP reader are inlined.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The three source archives. `priority` breaks description clashes: a lower
 * number wins the macros. Foundation is lab-analyzed so it outranks SR, and SR's
 * curated reference values outrank FNDDS's survey-derived ones — but FNDDS still
 * contributes every food the other two lack, which is most of the mixed dishes.
 */
const DATASETS = [
  {
    key: 'foundation',
    priority: 0,
    dataType: 'foundation_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2025-04-24.zip',
  },
  {
    key: 'sr_legacy',
    priority: 1,
    dataType: 'sr_legacy_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip',
  },
  {
    key: 'survey',
    priority: 2,
    dataType: 'survey_fndds_food',
    url: 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip',
    optional: true, // --no-survey
  },
];

/**
 * The nutrients we keep, by FDC nutrient id, mapped to the field they populate.
 * Amounts are per 100 g of food.
 *
 * Energy is ranked rather than single-valued. Foundation mostly does NOT carry
 * 1008: of its 411 foods only 135 do, while 322 carry an Atwater figure. Taking
 * 1008 alone (as an earlier revision did) silently dropped two thirds of the
 * highest-quality dataset in the whole ingest. Specific factors are food-derived,
 * so they beat the general 4/9/4.
 */
const NUTRIENT_ROLES = {
  '1008': { field: 'kcal', rank: 0 },
  '2048': { field: 'kcal', rank: 1 },
  '2047': { field: 'kcal', rank: 2 },
  '1003': { field: 'protein', rank: 0 },
  '1004': { field: 'fat', rank: 0 },
  '1005': { field: 'carb', rank: 0 },
};

/** FDC's sentinel for "the measure text is in another column, not a unit id". */
const UNITLESS_MEASURE_ID = '9999';
/** FNDDS marks unmeasurable portions with this and a 0 g weight. */
const UNSPECIFIED_PORTION = 'quantity not specified';

// ─────────────────────────── ZIP (read-only, minimal) ───────────────────────────

/**
 * Extract a ZIP buffer to { basename → Buffer }. Handles the two methods FDC
 * uses (stored + deflate). Not a general ZIP implementation: no zip64, no
 * encryption, no directory nesting beyond taking the basename — which is all
 * these archives need, and keeps the script dependency-free.
 */
function unzip(buf) {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  let eocd = -1;
  // The EOCD sits at the end, after an optional comment (<= 64 KB).
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    // The local header repeats the name and carries its own extra field, whose
    // length routinely differs from the central one — always re-read it here.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    const data = method === 0 ? raw : inflateRawSync(raw);
    out.set(name.split('/').pop(), data);
  }
  return out;
}

async function fetchDataset(ds, cacheDir, offline) {
  const zipPath = join(cacheDir, `${ds.key}.zip`);
  if (!existsSync(zipPath)) {
    if (offline) throw new Error(`--offline set but ${zipPath} is missing`);
    process.stderr.write(`  downloading ${ds.key}…`);
    const resp = await fetch(ds.url);
    if (!resp.ok) throw new Error(`${ds.url} → HTTP ${resp.status}`);
    mkdirSync(cacheDir, { recursive: true });
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(zipPath));
    process.stderr.write(' ok\n');
  }
  return unzip(readFileSync(zipPath));
}

// ─────────────────────────────────── CSV ───────────────────────────────────

/**
 * Minimal RFC-4180 parser: quoted fields with embedded commas, newlines and
 * doubled quotes. FDC quotes every field, so this is not optional.
 */
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
      // ignore; \n ends the row
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

/** Read one CSV from the extracted entries into { colIndex, rows }. */
function readTable(entries, file) {
  const buf = entries.get(file);
  if (!buf) return { colIndex: {}, rows: [] };
  const rows = parseCsv(buf.toString('utf8'));
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
/**
 * Round, and never emit a negative macro. USDA derives carbohydrate "by
 * difference" (100 − water − protein − fat − ash), which lands slightly below
 * zero on eight meat rows. That is faithful to the source and still nonsense to
 * show a user, so it is clamped here rather than in every consumer.
 */
const macro = (n) => Math.max(0, round1(n));
const normalizeDesc = (d) => d.trim().toLowerCase().replace(/\s+/g, ' ');

// ───────────────────────────────── Ingest ─────────────────────────────────

/**
 * Compose the display label for one `food_portion` row. The two dataset
 * families disagree on where the text lives, and reading the wrong column
 * yields labels like "10205":
 *   SR/Foundation → amount + measure unit name, or `modifier` ("cup, diced").
 *   FNDDS         → `portion_description` already reads "1 cup"; its `modifier`
 *                   is an internal numeric code, never display text.
 */
function portionLabel(row, pc, unitName, grams) {
  const amount = num(row[pc.amount]);
  const measureId = row[pc.measure_unit_id];
  const described = (row[pc.portion_description] ?? '').trim();

  if (described && described.toLowerCase() !== UNSPECIFIED_PORTION) {
    return described;
  }

  const measure = measureId && measureId !== UNITLESS_MEASURE_ID ? unitName.get(measureId) : null;
  const modifier = (row[pc.modifier] ?? '').trim();
  // A purely numeric modifier is an FNDDS code, not a household measure.
  const unit = measure ?? (/^\d+$/.test(modifier) ? '' : modifier);
  if (!unit) return `${round1(grams)} g`;
  return `${amount && amount !== 1 ? `${amount} ` : amount === 1 ? '1 ' : ''}${unit}`.trim();
}

/**
 * Map every key that can appear in `food_nutrient.nutrient_id` to the field it
 * populates, resolved through the dataset's OWN `nutrient.csv`.
 *
 * This indirection is load-bearing. Foundation and SR reference nutrients by FDC
 * id ("1008"), but the FNDDS export references them by the legacy `nutrient_nbr`
 * ("208") in the very same column — so a hardcoded id list matches zero FNDDS
 * rows and silently yields an empty dataset rather than an error. Ids are
 * registered first and never overwritten, so a legacy number can't shadow one.
 */
function nutrientRoles(nutrient) {
  const { colIndex: c, rows } = nutrient;
  const roles = new Map();
  for (const r of rows) {
    const role = NUTRIENT_ROLES[r[c.id]];
    if (role) roles.set(r[c.id], role);
  }
  for (const r of rows) {
    const role = NUTRIENT_ROLES[r[c.id]];
    const nbr = (r[c.nutrient_nbr] ?? '').trim();
    if (role && nbr && !roles.has(nbr)) roles.set(nbr, role);
  }
  return roles;
}

/** Build per-food records for one extracted dataset. */
function ingestDataset(entries, ds) {
  const food = readTable(entries, 'food.csv');
  const fnut = readTable(entries, 'food_nutrient.csv');
  const portion = readTable(entries, 'food_portion.csv');
  const units = readTable(entries, 'measure_unit.csv');

  const unitName = new Map();
  for (const r of units.rows) unitName.set(r[units.colIndex.id], r[units.colIndex.name]);

  // Only real foods. Foundation's food.csv also carries 62k sub_sample_food,
  // 7k market_acquisition and 3.7k sample_food rows — lab plumbing, not things
  // a user should ever see in a typeahead.
  const foods = new Map();
  const fc = food.colIndex;
  for (const r of food.rows) {
    const id = r[fc.fdc_id];
    if (!id || r[fc.data_type] !== ds.dataType) continue;
    foods.set(id, {
      id,
      desc: (r[fc.description] ?? '').trim(),
      dataType: ds.dataType,
      priority: ds.priority,
      best: {}, // field → rank of the source nutrient currently held
      per100: { kcal: 0, protein: 0, carb: 0, fat: 0 },
      portions: [],
    });
  }

  const roleOf = nutrientRoles(readTable(entries, 'nutrient.csv'));
  const nc = fnut.colIndex;
  for (const r of fnut.rows) {
    const role = roleOf.get(r[nc.nutrient_id]);
    if (!role) continue;
    const f = foods.get(r[nc.fdc_id]);
    if (!f) continue;
    const amount = num(r[nc.amount]);
    if (amount == null) continue;
    // Lower rank wins, so a food carrying both 1008 and an Atwater figure keeps
    // the measured one.
    const held = f.best[role.field];
    if (held == null || role.rank < held) {
      f.best[role.field] = role.rank;
      f.per100[role.field] = amount;
    }
  }
  for (const f of foods.values()) delete f.best;

  const pc = portion.colIndex;
  for (const r of portion.rows) {
    const f = foods.get(r[pc.fdc_id]);
    if (!f) continue;
    const grams = num(r[pc.gram_weight]);
    if (grams == null || grams <= 0) continue;
    f.portions.push({ label: portionLabel(r, pc, unitName, grams), grams: round1(grams) });
  }

  // A food with no calories can't be logged, so it has no business in search.
  return [...foods.values()].filter((f) => f.per100.kcal > 0);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const out = flag('--out', join(REPO_ROOT, 'functions/data/usda-foods.json'));
  const cacheDir = flag('--cache', join(REPO_ROOT, '.cache/usda'));
  const offline = argv.includes('--offline');
  const sets = DATASETS.filter((d) => !(d.optional && argv.includes('--no-survey')));

  // Later-priority records never displace earlier ones, so the merge result
  // does not depend on the order datasets happen to be processed in.
  const byNorm = new Map();
  for (const ds of sets) {
    const entries = await fetchDataset(ds, cacheDir, offline);
    const recs = ingestDataset(entries, ds);
    process.stderr.write(`  ${ds.key}: ${recs.length} foods with macros\n`);
    for (const rec of recs) {
      const key = normalizeDesc(rec.desc);
      const prev = byNorm.get(key);
      if (!prev) {
        byNorm.set(key, rec);
      } else if (rec.priority < prev.priority) {
        // Better macros win, but keep whichever record actually has household
        // portions — Foundation is portion-poor and would otherwise strip them.
        byNorm.set(key, { ...rec, portions: rec.portions.length ? rec.portions : prev.portions });
      } else if (prev.portions.length === 0 && rec.portions.length > 0) {
        prev.portions = rec.portions;
      }
    }
  }

  const foods = [...byNorm.values()].map((f) => ({
    id: f.id,
    desc: f.desc,
    dataType: f.dataType,
    per100: {
      kcal: macro(f.per100.kcal),
      protein: macro(f.per100.protein),
      carb: macro(f.per100.carb),
      fat: macro(f.per100.fat),
    },
    portions: f.portions.slice(0, 12),
  }));
  foods.sort((a, b) => a.desc.localeCompare(b.desc) || a.id.localeCompare(b.id));

  mkdirSync(dirname(out), { recursive: true });
  const json = JSON.stringify(foods);
  writeFileSync(out, json);
  const byType = {};
  for (const f of foods) byType[f.dataType] = (byType[f.dataType] ?? 0) + 1;
  process.stderr.write(
    `Wrote ${foods.length} foods → ${out} (${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB)\n` +
      `  ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')}\n` +
      '  Data: USDA FoodData Central (CC0 1.0).\n',
  );
}

await main();
