#!/usr/bin/env node
/**
 * perf-breakdown — answer "what IS the 13 MB?", so a budget breach is actionable.
 *
 *   npm run perf:breakdown                       # exports, then attributes
 *   npm run perf:breakdown -- --platform ios
 *   npm run perf:breakdown -- --export-dir <dir> # reuse an existing map export
 *   npm run perf:breakdown -- --top 40           # rows to print (default 25)
 *   npm run perf:breakdown -- --depth 3          # group node_modules deeper
 *   npm run perf:breakdown -- --json
 *
 * `perf-budget.mjs` is the tripwire; this is the thing you run when it trips.
 * A gate that only says "it grew 400 KB" sends you reading commit diffs. This
 * says WHICH module grew, which is the difference between a budget that gets
 * used and one that gets muted.
 *
 * HOW IT ATTRIBUTES
 *
 * It needs a bundle whose bytes can be traced back to source, and Hermes
 * bytecode cannot be — so it exports with `--no-bytecode --source-maps` and
 * walks the map: every span of generated JS between consecutive mappings is
 * charged to the source file the earlier mapping names. This is the same
 * algorithm source-map-explorer uses.
 *
 * THE NUMBER IS A SHARE, NOT A SIZE. The measured artifact here is the ~9.5 MB
 * minified JS, while what ships is ~13.3 MB of Hermes bytecode compiled from
 * it. The two are not the same bytes and the ratio is not uniform across
 * modules, so treat a row as "this module is X% of the bundle", never as "this
 * module costs X bytes on the device". `perf-budget.mjs` owns the shipped
 * number; this owns the proportions. Do not put a threshold on these values.
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = resolve(root, 'apps/mobile');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const flag = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const PLATFORM = flag('--platform') || 'android';
const EXPORT_DIR = flag('--export-dir');
const TOP = Number(flag('--top') || 25);
const DEPTH = Number(flag('--depth') || 1);

// ─── VLQ / source map decoding ─────────────────────────────────────────

const B64 = new Map([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));

/** Decode one comma-separated VLQ segment into its integer fields. */
function decodeSegment(str) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of str) {
    const digit = B64.get(ch);
    if (digit === undefined) return out;
    const cont = digit & 32;
    value += (digit & 31) << shift;
    if (cont) {
      shift += 5;
    } else {
      const neg = value & 1;
      value >>= 1;
      out.push(neg ? (value === 0 ? -0x80000000 : -value) : value);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/**
 * Charge every byte of the generated file to a source.
 *
 * Walked as (line, column) against the real line lengths rather than a flat
 * offset: a minified RN bundle is a handful of enormous lines, and getting this
 * wrong silently mis-attributes most of the bundle instead of erroring.
 */
function attribute(code, map) {
  const lines = code.split('\n');
  const lineStart = [];
  let acc = 0;
  for (const l of lines) {
    lineStart.push(acc);
    acc += l.length + 1; // +1 for the \n
  }
  const total = code.length;
  const offsetOf = (line, col) => (line >= lines.length ? total : Math.min(lineStart[line] + col, total));

  // Decode mappings into a flat, ordered list of (offset, sourceIndex).
  const points = [];
  let srcIdx = 0;
  const groups = map.mappings.split(';');
  for (let line = 0; line < groups.length; line++) {
    if (!groups[line]) continue;
    let col = 0;
    for (const seg of groups[line].split(',')) {
      if (!seg) continue;
      const f = decodeSegment(seg);
      if (f.length === 0) continue;
      col += f[0];
      if (f.length >= 4) {
        srcIdx += f[1];
        points.push([offsetOf(line, col), srcIdx]);
      } else {
        // A 1-field segment names no source — the span belongs to the bundler
        // itself (module wrappers, the require polyfill, the runtime shim).
        points.push([offsetOf(line, col), -1]);
      }
    }
  }
  points.sort((a, b) => a[0] - b[0]);

  const bySource = new Map();
  const add = (key, n) => bySource.set(key, (bySource.get(key) || 0) + n);
  for (let i = 0; i < points.length; i++) {
    const [start, si] = points[i];
    const end = i + 1 < points.length ? points[i + 1][0] : total;
    const size = end - start;
    if (size <= 0) continue;
    add(si === -1 ? '(bundler runtime)' : map.sources[si] || '(unknown)', size);
  }
  // Anything before the first mapping is preamble, not a module.
  if (points.length && points[0][0] > 0) add('(bundler runtime)', points[0][0]);

  // ── Inlined data modules, which the walk above CANNOT see ──
  //
  // Metro emits a JSON module's body as a literal and gives it NO mapping
  // segments at all, while still listing the file in `sources` with its full
  // `sourcesContent`. So every byte of it lands in `(bundler runtime)` and the
  // largest single thing in this bundle becomes invisible under a label that
  // reads like unavoidable bundler overhead.
  //
  // That is not hypothetical: `apps/mobile/assets/food-index.json` is 1.42 MB —
  // 15% of the bundle — and it had exactly 0 of the map's 8,549 lines of
  // mappings pointing at it. Charging it by `sourcesContent` length is an
  // estimate (Metro minifies the JSON on the way in), which is why these rows
  // are marked, but an approximate row beats a 1.42 MB blind spot.
  const runtimeKey = '(bundler runtime)';
  if (map.sourcesContent) {
    for (let i = 0; i < map.sources.length; i++) {
      const name = map.sources[i];
      const content = map.sourcesContent[i];
      if (!name || !content || bySource.has(name)) continue;
      const budget = bySource.get(runtimeKey) || 0;
      if (budget <= 0) break;
      const charged = Math.min(content.length, budget);
      if (charged < 1024) continue; // ignore noise-sized modules
      add(`${name} (inlined data, estimated)`, charged);
      bySource.set(runtimeKey, budget - charged);
    }
  }
  return { bySource, total };
}

// ─── Grouping ──────────────────────────────────────────────────────────

/**
 * Collapse a source path to the thing you would actually act on.
 *
 * A dependency is charged to its package (scoped names kept whole, so
 * `@react-navigation/native` does not collapse into `@react-navigation`), and
 * OUR code is kept at file granularity — the whole point is to see which of our
 * own modules grew, and `apps/mobile/src` as one 2 MB row says nothing.
 */
function group(source) {
  const p = source.replace(/\\/g, '/').replace(/^(\.\.\/)+/, '');
  if (p.startsWith('(')) return p;
  const nm = p.lastIndexOf('node_modules/');
  if (nm >= 0) {
    const rest = p.slice(nm + 'node_modules/'.length).split('/');
    const pkg = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
    const extra = rest[0].startsWith('@') ? rest.slice(2) : rest.slice(1);
    return DEPTH > 1 ? ['node_modules', pkg, ...extra.slice(0, DEPTH - 1)].join('/') : `node_modules/${pkg}`;
  }
  return p;
}

// ─── Run ───────────────────────────────────────────────────────────────

let dir = EXPORT_DIR;
let temp = null;
try {
  if (!dir) {
    dir = temp = mkdtempSync(join(tmpdir(), `ignia-breakdown-${PLATFORM}-`));
    if (!AS_JSON) console.log(`exporting ${PLATFORM} with source maps (a few minutes)…`);
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['expo', 'export', '--platform', PLATFORM, '--no-bytecode', '--source-maps', '--output-dir', dir],
      { cwd: MOBILE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (r.status !== 0) throw new Error(`expo export failed:\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }

  const jsDir = join(dir, '_expo', 'static', 'js', PLATFORM);
  const files = readdirSync(jsDir);
  const jsName = files.find((f) => f.endsWith('.js'));
  const mapName = files.find((f) => f.endsWith('.js.map'));
  if (!jsName || !mapName) {
    throw new Error(
      `need a .js AND a .js.map under ${jsDir}, found [${files.join(', ')}]. ` +
        `Export with --no-bytecode --source-maps.`,
    );
  }

  const code = readFileSync(join(jsDir, jsName), 'utf8');
  const map = JSON.parse(readFileSync(join(jsDir, mapName), 'utf8'));
  const { bySource, total } = attribute(code, map);

  const grouped = new Map();
  for (const [src, size] of bySource) {
    const k = group(src);
    grouped.set(k, (grouped.get(k) || 0) + size);
  }
  const rows = [...grouped].sort((a, b) => b[1] - a[1]);
  const attributed = rows.reduce((s, [, n]) => s + n, 0);

  if (AS_JSON) {
    console.log(JSON.stringify({ platform: PLATFORM, totalBytes: total, rows: rows.map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100 })) }, null, 2));
  } else {
    const fmt = (n) => n.toLocaleString('en-US');
    console.log(`\n${PLATFORM} — ${fmt(total)} bytes of minified JS (ships as Hermes bytecode; these are SHARES, not device bytes)\n`);
    let shown = 0;
    for (const [name, bytes] of rows.slice(0, TOP)) {
      shown += bytes;
      console.log(`  ${((bytes / total) * 100).toFixed(2).padStart(6)}%  ${fmt(bytes).padStart(10)}  ${name}`);
    }
    if (rows.length > TOP) {
      console.log(`  ${(((attributed - shown) / total) * 100).toFixed(2).padStart(6)}%  ${fmt(attributed - shown).padStart(10)}  (${rows.length - TOP} more rows)`);
    }
    console.log(`\n  attributed ${((attributed / total) * 100).toFixed(1)}% of the bundle across ${rows.length} groups`);
    console.log(`  --top N for more rows · --depth 2 to split inside a package · --json to diff two runs`);
  }
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}
