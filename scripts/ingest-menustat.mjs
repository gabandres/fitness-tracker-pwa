#!/usr/bin/env node
/**
 * MenuStat chain-restaurant ingest (ADR-0027).
 *
 * Turns MenuStat's 2022 annual dataset into one compact JSON the `searchFoods`
 * / `getFoodDetail` Cloud Functions load in memory — the exact shape ADR-0018
 * established for USDA, for the same reasons: no API key, no rate ceiling, no
 * upstream to go down. Deterministic: same input → byte-identical output.
 *
 * ── Run ──
 *   node scripts/ingest-menustat.mjs
 *
 * The script downloads the source itself and caches it under .cache/menustat,
 * so a re-run is offline.
 *
 * Flags:
 *   --out <path>   output JSON (default functions/data/restaurant-foods.json)
 *   --cache <dir>  download cache directory (default .cache/menustat)
 *   --offline      fail instead of downloading; use only the cache
 *   --stats        print the per-chain breakdown and exit non-zero on regression
 *
 * ── Where the data comes from, and why from there ──
 *
 * MenuStat was built by the NYC Dept of Health and Mental Hygiene. Three copies
 * of it exist and they do NOT carry the same terms — the full argument is in
 * `docs/research/restaurant-foods-menustat.md` §1. In short:
 *
 *   - Harvard Dataverse (doi:10.7910/DVN/K4NYTR) is **CC0 1.0**, but stops at
 *     2018 and was deposited by a researcher, not by DOHMH.
 *   - NYC Open Data's copy carries **no licence field** and stops at 2018.
 *   - menustat.org itself published through **2022** and said only
 *     "© 2016 MenuStat. All rights reserved."
 *
 * **menustat.org is GONE** — it stopped resolving between 2026-06-12 (the last
 * Internet Archive 200) and 2026-08-24, and collection had already stopped
 * after 2022 (its own FAQ: data was collected "in January of each year through
 * 2020"). So there is no live upstream and no annual refresh to inherit; this
 * is a terminal snapshot and the app renders its year for exactly that reason.
 *
 * We ingest the **2022** file from the Internet Archive because it is the best
 * data that exists: 25,217 items with calories AND protein at 96.1%
 * completeness, across 92 chains, including all 15 the owner named. The 2018
 * CC0 file is the documented fallback if the licence question resolves against
 * us — `--year 2018` is deliberately NOT implemented, because the 2018 schema
 * differs (it carries `year` and `*_100g` columns and repeats each item per
 * customizable build) and a half-working second path is worse than a documented
 * one-file script.
 *
 * Output: an array of
 *   { id, chain, desc, cat, kcal, protein, carb, fat, grams, label }
 * sorted by (chain, desc) so a diff of two ingests is readable. `grams` is 0
 * when MenuStat published no weight — 47% of the corpus, and dropping those
 * would delete IHOP, The Cheesecake Factory, Wendy's, Taco Bell, Chili's and
 * Olive Garden outright. The clients already treat a non-positive `grams` as
 * "one serving, weight unknown" (see menustat-db.ts).
 *
 * No external deps — a minimal ZIP reader and an XLSX reader are inlined.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The exact Internet Archive capture, pinned by timestamp. The `id_` infix asks
 * Wayback for the ORIGINAL bytes rather than its rewritten wrapper — without it
 * the download is an HTML page with a 200 status, which parses as a corrupt ZIP
 * a hundred lines later instead of failing here.
 *
 * There is exactly one 200 capture of this file (CDX, checked 2026-08-24), so
 * pinning the timestamp costs nothing and makes the ingest reproducible after
 * Wayback adds more.
 */
const SOURCE_URL =
  'https://web.archive.org/web/20241007092450id_/https://www.menustat.org/uploads/1/4/1/6/141624194/ms_annual_data_2022.xlsx';

/** SHA-256 of the source workbook, verified on download. A silent substitution
 *  upstream would otherwise reach `functions/data/` as a normal-looking diff. */
const SOURCE_SHA256 = 'f06635e68368a47468f94a550fedc2c44591f657eb19028ccf03cb8b616e5ddb';

/** The snapshot year. Stored on every item and rendered by the clients — a 2026
 *  figure for a 2022 menu is not a bug if it says 2022 on it. */
const SNAPSHOT_YEAR = 2022;

/**
 * Floor for the item count, so a source or parser change that silently guts the
 * dataset fails the ingest instead of shipping. The measured figure is 25,217;
 * a 5% band absorbs nothing real, because the input is a frozen file.
 */
const MIN_ITEMS = 24000;

/** Serving-size units MenuStat uses that convert to grams. `fl oz` and `ml` are
 *  treated as grams (water density) — the error on a beverage is under 5% and
 *  the alternative is discarding every drink's weight. */
const GRAMS_PER_UNIT = { g: 1, ml: 1, oz: 28.3495, 'fl oz': 29.5735 };

// ─────────────────────────── ZIP (read-only, minimal) ───────────────────────────

/**
 * Extract a ZIP buffer to { name → Buffer }. Same shape as the reader in
 * `ingest-usda.mjs`, but keyed on the FULL path rather than the basename — an
 * XLSX has `xl/worksheets/sheet1.xml` and taking basenames would collide.
 */
function unzip(buf) {
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  let eocd = -1;
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
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    out.set(name, method === 0 ? raw : inflateRawSync(raw));
  }
  return out;
}

// ─────────────────────────────────── XLSX ───────────────────────────────────

const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function unescapeXml(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[ent] ?? m;
  });
}

/**
 * Read `xl/sharedStrings.xml` into an array. Excel stores every distinct string
 * once and cells reference it by index; a shared string can be split across
 * several `<t>` runs when it carries formatting, so the runs are concatenated.
 */
function readSharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let si;
  while ((si = siRe.exec(xml))) {
    let text = '';
    let t;
    tRe.lastIndex = 0;
    while ((t = tRe.exec(si[1]))) text += t[1];
    out.push(unescapeXml(text));
  }
  return out;
}

/** "BC12" → 54 (0-based column index). */
function colIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * Read a worksheet into an array of string arrays.
 *
 * Cells are addressed by their `r` attribute rather than by position, because
 * Excel OMITS empty cells entirely — a positional read silently shifts every
 * value after the first blank into the wrong column, which for this file means
 * reading protein out of the carbohydrate column.
 */
function readSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    let cell;
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(rowMatch[1]))) {
      const attrs = cell[1];
      const body = cell[2] ?? '';
      const refMatch = /r="([A-Z]+)/.exec(attrs);
      const idx = refMatch ? colIndex(refMatch[1]) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 'inlineStr') {
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        value = t ? unescapeXml(t[1]) : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        const rawValue = v ? unescapeXml(v[1]) : '';
        value = type === 's' ? (shared[Number(rawValue)] ?? '') : rawValue;
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// ─────────────────────────────────── ingest ───────────────────────────────────

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(name);

async function fetchSource(cacheDir, offline) {
  const path = join(cacheDir, 'ms_annual_data_2022.xlsx');
  if (!existsSync(path)) {
    if (offline) throw new Error(`--offline set but ${path} is missing`);
    process.stderr.write('  downloading ms_annual_data_2022.xlsx…');
    const resp = await fetch(SOURCE_URL);
    if (!resp.ok) throw new Error(`${SOURCE_URL} → HTTP ${resp.status}`);
    mkdirSync(cacheDir, { recursive: true });
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(path));
    process.stderr.write(' ok\n');
  }
  const buf = readFileSync(path);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== SOURCE_SHA256) {
    throw new Error(
      `source workbook hash mismatch\n  expected ${SOURCE_SHA256}\n  got      ${sha}\n` +
        `  delete ${path} and re-run, or update SOURCE_SHA256 if the change is intended`,
    );
  }
  return buf;
}

/** Parse a MenuStat numeric cell. Blank, "." and ranges like "430-560" are all
 *  "no value" — a range is a real MenuStat convention for build-your-own items
 *  and averaging one would invent a number nobody published. */
function num(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^-?[0-9]*\.?[0-9]+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build the display label for the one serving MenuStat publishes.
 *
 * Preference order is deliberate: a household measure ("1 Bowl") is what a
 * person recognises, a gram weight is what the math wants, and "1 serving" is
 * the honest fallback. All three are truthful; none invents a weight.
 */
function servingLabel(householdText, grams) {
  const hh = titleCase(String(householdText ?? ''));
  if (hh && hh !== '.') return hh.slice(0, 40);
  if (grams > 0) return `${Math.round(grams)} g`;
  return '1 serving';
}

/**
 * Emit the chain-name list into `@macrolog/core` as a generated module.
 *
 * The mobile app searches food ON DEVICE and never calls `searchFoods` for text
 * (Tier D, `apps/mobile/src/lib/localFoodSearch.ts`), so the restaurant corpus
 * on the server would reach nobody on the platform that matters. Bundling the
 * whole 4.3 MB corpus into the phone was the obvious fix and it is the wrong
 * one — the compacted USDA index is already 1.4 MB and MenuStat would roughly
 * triple it.
 *
 * So the phone bundles the CHAIN NAMES only (~2 KB) and uses them as a router:
 * a query that names a chain goes to `searchFoods`, everything else stays
 * local. Restaurant search is exactly the case where a user has asked for
 * something specific and a round trip is acceptable; generic food search — the
 * common case, and the one that has to work with the radio off — is untouched.
 */
function writeChainList(chains) {
  const target = join(REPO_ROOT, 'packages/core/src/restaurant-chains.data.ts');
  const body = chains.map((c) => `  ${JSON.stringify(c)},`).join('\n');
  writeFileSync(
    target,
    `// GENERATED by scripts/ingest-menustat.mjs — do not edit by hand.\n` +
      `// Source: MenuStat ${SNAPSHOT_YEAR} annual snapshot (ADR-0027).\n` +
      `//\n` +
      `// Why this list is in the bundle but the corpus is not: see writeChainList()\n` +
      `// in the ingest, and \`restaurant-chains.ts\` next door.\n` +
      `export const RESTAURANT_CHAINS: readonly string[] = [\n${body}\n];\n\n` +
      `/** The snapshot these chains were read from. Rendered, never assumed current. */\n` +
      `export const RESTAURANT_SNAPSHOT_YEAR = ${SNAPSHOT_YEAR};\n`,
  );
  return target;
}

async function main() {
  const outPath = arg('--out', join(REPO_ROOT, 'functions/data/restaurant-foods.json'));
  const cacheDir = arg('--cache', join(REPO_ROOT, '.cache/menustat'));

  const zip = unzip(await fetchSource(cacheDir, has('--offline')));
  const sharedXml = zip.get('xl/sharedStrings.xml');
  const sheetXml = zip.get('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('workbook has no xl/worksheets/sheet1.xml');
  const shared = sharedXml ? readSharedStrings(sharedXml.toString('utf8')) : [];
  const rows = readSheet(sheetXml.toString('utf8'), shared);
  if (rows.length < 2) throw new Error('worksheet is empty');

  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`column "${name}" missing — the source schema changed`);
    return i;
  };
  const cId = col('menu_item_id');
  const cChain = col('restaurant');
  const cName = col('item_name');
  const cDesc = col('item_description');
  const cCat = col('food_category');
  const cKcal = col('calories');
  const cProt = col('protein');
  const cCarb = col('carbohydrates');
  const cFat = col('total_fat');
  const cSize = col('serving_size');
  const cUnit = col('serving_size_unit');
  const cHh = col('serving_size_household');

  const seen = new Set();
  const byDescription = new Map();
  const items = [];
  let dropped = 0;
  let noWeight = 0;
  let duplicates = 0;

  for (const r of rows.slice(1)) {
    const kcal = num(r[cKcal]);
    const protein = num(r[cProt]);
    // The ADR's filter: an item with no calories or no protein cannot answer
    // the question this app exists to answer, so it is not shipped.
    if (kcal === null || protein === null) {
      dropped++;
      continue;
    }
    const chain = titleCase(String(r[cChain] ?? ''));
    const name = titleCase(String(r[cName] ?? ''));
    if (!chain || !name) {
      dropped++;
      continue;
    }
    const id = String(r[cId] ?? '').trim();
    // MenuStat's own id is the stable key across years (ADR-0027). Fall back to
    // a content hash only if a row lacks one, so the output stays keyable.
    const key = id || createHash('sha1').update(`${chain}|${name}`).digest('hex').slice(0, 12);
    if (seen.has(key)) continue;
    seen.add(key);

    // ── Deduplicate on the DESCRIPTION, not the name ──
    //
    // `item_name` is a short menu label and MenuStat reuses it freely: 857
    // (chain, name) groups hold more than one row, 1,424 rows in total, and
    // their macros genuinely differ — Applebee's "Fries Basket" is 640 kcal as
    // a kids' side and 50 kcal under Sides & Extras. Showing both, identically
    // labelled, asks the user to pick between two numbers with nothing to pick
    // on; picking one for them would mean choosing which figure to hide.
    //
    // `item_description` is the disambiguator MenuStat already ships — it
    // appends the menu section and any qualifier. Keying on it drops the group
    // count to 84 and the duplicate rows to 94, and those remainders ARE true
    // duplicates.
    const description = titleCase(String(r[cDesc] ?? '')) || name;
    const dedupeKey = `${chain}|${description.toLowerCase()}`;
    if (byDescription.has(dedupeKey)) {
      duplicates++;
      continue;
    }
    byDescription.set(dedupeKey, true);

    // The qualifier is what `item_description` adds beyond the name. It is kept
    // separately rather than folded into the display text because it is menu
    // metadata ("Available In: Boneless Wings, Limited Time Offers"), useful to
    // MATCH on and noisy to READ. Only a name collision promotes it into the
    // visible description, below.
    const note = description.toLowerCase().startsWith(name.toLowerCase())
      ? description.slice(name.length).replace(/^[\s,]+/, '')
      : description;

    const rawSize = num(r[cSize]);
    const unit = String(r[cUnit] ?? '').trim().toLowerCase();
    const factor = GRAMS_PER_UNIT[unit];
    const grams = rawSize !== null && factor ? Math.round(rawSize * factor * 10) / 10 : 0;
    if (grams <= 0) noWeight++;

    items.push({
      id: key,
      chain,
      desc: name.slice(0, 140),
      ...(note ? { note: note.slice(0, 140) } : {}),
      cat: titleCase(String(r[cCat] ?? '')),
      kcal: Math.round(kcal),
      protein: Math.round(protein),
      carb: num(r[cCarb]) !== null ? Math.round(num(r[cCarb])) : undefined,
      fat: num(r[cFat]) !== null ? Math.round(num(r[cFat])) : undefined,
      grams,
      label: servingLabel(r[cHh], grams),
    });
  }

  // ── Promote the qualifier for names that still collide ──
  //
  // Deduping on the description leaves items that share a NAME but are genuinely
  // different (Applebee's "Fries Basket", kids' side vs Sides & Extras). Those
  // must stay — both are real menu items — but a picker showing the same words
  // twice with different calories is unusable. So for a colliding name only,
  // the qualifier is folded into the visible text. Everything else keeps its
  // clean menu name, which is the reason this is a targeted pass and not a
  // blanket concatenation.
  const nameGroups = new Map();
  for (const item of items) {
    const k = `${item.chain}|${item.desc.toLowerCase()}`;
    const group = nameGroups.get(k);
    if (group) group.push(item);
    else nameGroups.set(k, [item]);
  }
  let disambiguated = 0;
  for (const group of nameGroups.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      // The first segment of the qualifier is the menu section ("Kids Sides"),
      // which is the part that actually tells two same-named items apart. The
      // rest is marketing copy.
      const qualifier = (item.note ?? '').split(',')[0].trim();
      if (!qualifier) continue;
      item.desc = `${item.desc} (${qualifier})`.slice(0, 140);
      disambiguated++;
    }
  }

  items.sort((a, b) => a.chain.localeCompare(b.chain) || a.desc.localeCompare(b.desc) || a.id.localeCompare(b.id));

  if (items.length < MIN_ITEMS) {
    throw new Error(`only ${items.length} items survived (floor ${MIN_ITEMS}) — refusing to ship a gutted dataset`);
  }

  const payload = { year: SNAPSHOT_YEAR, source: 'MenuStat', items };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload)}\n`);

  const chains = new Set(items.map((i) => i.chain));
  writeChainList([...chains].sort());
  process.stderr.write(
    `  ${items.length} items · ${chains.size} chains · ${noWeight} without a gram weight\n` +
      `  ${dropped} rows dropped (no calories or no protein) · ${duplicates} duplicate descriptions · ` +
      `${disambiguated} names disambiguated\n  → ${outPath}\n`,
  );

  if (has('--stats')) {
    const byChain = new Map();
    for (const i of items) byChain.set(i.chain, (byChain.get(i.chain) ?? 0) + 1);
    for (const [c, n] of [...byChain].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`${String(n).padStart(6)} ${c}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`ingest-menustat: ${err.message}\n`);
  process.exit(1);
});
