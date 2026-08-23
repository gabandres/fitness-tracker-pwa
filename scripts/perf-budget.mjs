#!/usr/bin/env node
/**
 * perf-budget — give "faster" a number, and fail when it stops being true.
 *
 *   npm run perf:budget                        # both platforms, exports first
 *   npm run perf:budget -- --platform android  # one platform
 *   npm run perf:budget -- --export-dir <dir>  # measure an export that exists
 *   npm run perf:budget -- --update            # re-baseline (a deliberate act)
 *   npm run perf:budget -- --json              # machine-readable
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-21 the on-device food index shipped and the Android JS bundle went
 * 11,095,849 → 13,140,531 bytes: +2.0 MB, +18%, in one OTA. That number was
 * measured by hand, written into a docs row, and then never checked again — by
 * 2026-08-22 it had drifted to 13,282,872 (+142,341 more) and nothing in this
 * repo noticed or could have.
 *
 * That is the whole problem. `tsc`, 340 jest tests, Maestro and the fingerprint
 * gate all pass while the bundle doubles. Bundle size is invisible to every
 * gate this project owns, it is paid by users on every OTA download and every
 * cold start, and it only ever goes up — so the absence of a detector is not a
 * missing nicety, it is the reason nobody can say whether a release got faster.
 *
 * WHAT IT MEASURES, AND WHY EACH ONE
 *
 *   bundleRaw   the Hermes bytecode (.hbc) as shipped. Hermes mmaps this file
 *               at launch, so it is the number cold start pays.
 *   bundleGzip  what the OTA actually transfers. EAS serves gzipped, so this is
 *               the number a tester on cellular waits for — and it moves
 *               independently of raw (334 KB gzipped bought 1,385 KB raw for
 *               the food index, which is why both are tracked, not one).
 *   assetBytes  fonts, icons and images Metro copies alongside the bundle.
 *               Included in the binary and in the OTA; excluded from the two
 *               numbers above, so a regression here would otherwise hide.
 *
 * WHY A CEILING AND NOT AN EXACT MATCH
 *
 * A budget that fails on +1 byte fires on the happy path, and this repo's own
 * rule is that a guard which fires on the happy path is a guard that gets
 * deleted. So each metric carries a baseline plus `headroomPct`: ordinary
 * feature work fits underneath, and a breach means either a real regression or
 * a growth someone should have to justify out loud by re-baselining.
 *
 * Re-baselining is `--update`, and it rewrites a COMMITTED file on purpose. The
 * diff is the record of who accepted the growth and in which commit — the thing
 * the hand-written docs row could not give.
 *
 * WHAT IT DELIBERATELY DOES NOT MEASURE
 *
 * Cold start and time-to-interactive. Both need a device, the only one here is
 * the LG G6 over adb, and a number that can only be produced by a physical
 * phone someone has to unlock is not a gate — it is a chore. Bundle bytes are
 * the part that can be gated for free on every publish, and they are upstream
 * of both. See STATUS.md for the device-QA gap; this does not close it.
 *
 * NOT WIRED INTO `npm run doctor` ON PURPOSE. A Metro export takes minutes and
 * doctor is run constantly. Instead the OTA gate already runs `expo export`
 * before every publish (`build-android`/`build-ios` skills, step 2) — point
 * `--export-dir` at that export and the measurement costs nothing extra.
 *
 * NOT WIRED INTO CI ON PURPOSE EITHER, AND THIS ONE IS A TRAP — READ IT BEFORE
 * "FIXING" IT. CI is ubuntu/Node 22; the machines that publish are Windows/Node
 * 24 (Android) and `ignia-mac` (iOS). This repo has ALREADY paid for assuming
 * two hosts produce the same bytes: `@expo/fingerprint` demonstrably does not,
 * three OTAs once published under the wrong host's runtime and reached nobody,
 * and a session was spent trying to align Node and re-run `npm ci` to chase it
 * before the conclusion was written down — the hosts cannot be made to agree
 * and do not need to, because each platform is gated on the machine that builds
 * it (see CLAUDE.md and STATUS.md §1). Metro's module ordering depends on a
 * filesystem walk, so there is every reason to expect the same split here and
 * no measurement yet showing otherwise.
 *
 * A CI baseline would therefore drift against the publish-host baseline and the
 * gate would fire on the happy path — which is how a guard gets deleted. If you
 * want CI coverage, do NOT reuse these absolute baselines: measure the PR's
 * merge-base in the same CI job and compare the two numbers to each other. Same
 * rule as the fingerprint gate, for the same reason.
 *
 * Exit code is 1 if any tracked metric is over its ceiling, or if a platform
 * has no baseline and --update was not passed.
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = resolve(root, 'apps/mobile');
const BASELINE = resolve(root, 'scripts/perf-budget.json');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const UPDATE = argv.includes('--update');
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const EXPORT_DIR = flag('--export-dir');
const ONLY = flag('--platform');
const PLATFORMS = ONLY ? [ONLY] : ['android', 'ios'];

if (ONLY && !['android', 'ios'].includes(ONLY)) {
  console.error(`--platform must be android or ios, got "${ONLY}"`);
  process.exit(2);
}
if (EXPORT_DIR && PLATFORMS.length !== 1) {
  console.error('--export-dir measures one export, so it needs --platform too.');
  process.exit(2);
}

// ─── Measurement ───────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

/**
 * Read the three numbers out of a finished `expo export`.
 *
 * The bundle is found by path shape (`_expo/static/js/<platform>/…`) rather
 * than by extension: Hermes writes `.hbc` and a non-Hermes export writes `.js`,
 * and a measurement that silently matched neither would report 0 bytes and
 * PASS — the worst possible failure for a gate.
 */
function measure(exportDir, platform) {
  const files = walk(exportDir);
  const jsDir = join('static', 'js', platform);
  const bundles = files.filter((f) => f.includes(jsDir) && /\.(hbc|js)$/.test(f));
  if (bundles.length !== 1) {
    throw new Error(
      `expected exactly 1 ${platform} bundle under _expo/${jsDir}, found ${bundles.length}. ` +
        `Was the export run with --platform ${platform}?`,
    );
  }
  const bundle = bundles[0];
  const bundleRaw = statSync(bundle).size;
  const bundleGzip = gzipSync(readFileSync(bundle), { level: 9 }).length;

  // Everything Metro emitted that is neither the bundle nor its own manifest.
  // `metadata.json` describes the export; it is not shipped to a device.
  let assetBytes = 0;
  let assetCount = 0;
  for (const f of files) {
    if (f === bundle) continue;
    if (f.endsWith('metadata.json')) continue;
    if (/\.(hbc|js)\.map$/.test(f)) continue; // source maps never ship
    assetBytes += statSync(f).size;
    assetCount += 1;
  }
  return { bundleRaw, bundleGzip, assetBytes, assetCount, bundleFile: bundle.split(sep).pop() };
}

/** Run the Metro export ourselves when the caller has no export to hand. */
function runExport(platform) {
  const dir = mkdtempSync(join(tmpdir(), `ignia-perf-${platform}-`));
  if (!AS_JSON) console.log(`  exporting ${platform} (this takes a few minutes)…`);
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['expo', 'export', '--platform', platform, '--output-dir', dir],
    { cwd: MOBILE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`expo export --platform ${platform} failed:\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  return dir;
}

// ─── Baseline ──────────────────────────────────────────────────────────

const METRICS = [
  ['bundleRaw', 'bundle (raw .hbc)', 'cold start mmaps this'],
  ['bundleGzip', 'bundle (gzipped)', 'what the OTA transfers'],
  ['assetBytes', 'assets', 'fonts, icons, images'],
];

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { platforms: {} };

const gitSha = () => {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
};

const fmt = (n) => n.toLocaleString('en-US');
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// ─── Run ───────────────────────────────────────────────────────────────

const report = [];
let failed = false;

for (const platform of PLATFORMS) {
  let dir = EXPORT_DIR;
  let temp = null;
  try {
    if (!dir) dir = temp = runExport(platform);
    const now = measure(dir, platform);
    const base = baseline.platforms[platform];

    const entry = { platform, measured: now, checks: [] };

    if (!base) {
      if (!UPDATE) {
        failed = true;
        entry.error = `no baseline for ${platform}. Run with --update to record one.`;
      }
    } else {
      for (const [key, label] of METRICS) {
        const before = base[key];
        const after = now[key];
        const headroom = base.headroomPct ?? 5;
        const ceiling = Math.round(before * (1 + headroom / 100));
        const delta = after - before;
        const deltaPct = before === 0 ? 0 : (delta / before) * 100;
        const over = after > ceiling;
        if (over) failed = true;
        entry.checks.push({ key, label, before, after, ceiling, delta, deltaPct, over });
      }
    }
    report.push(entry);

    if (UPDATE) {
      baseline.platforms[platform] = {
        bundleRaw: now.bundleRaw,
        bundleGzip: now.bundleGzip,
        assetBytes: now.assetBytes,
        headroomPct: base?.headroomPct ?? 5,
        measuredAt: new Date().toISOString().slice(0, 10),
        measuredAtCommit: gitSha(),
      };
    }
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

if (UPDATE) {
  baseline.note =
    'Baselines for scripts/perf-budget.mjs. Regenerate with `npm run perf:budget -- --update`. ' +
    'A change here is someone accepting the growth on the record — say why in the commit message.';
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
}

// ─── Output ────────────────────────────────────────────────────────────

if (AS_JSON) {
  console.log(JSON.stringify({ ok: !failed, updated: UPDATE, report }, null, 2));
} else {
  for (const e of report) {
    console.log(`\n${e.platform}  (${e.measured.bundleFile})`);
    if (e.error) {
      console.log(`  ✗ ${e.error}`);
      continue;
    }
    if (!e.checks.length) {
      for (const [key, label] of METRICS) console.log(`  · ${label.padEnd(20)} ${fmt(e.measured[key]).padStart(12)}`);
      continue;
    }
    for (const c of e.checks) {
      const mark = c.over ? '✗' : '·';
      console.log(
        `  ${mark} ${c.label.padEnd(20)} ${fmt(c.after).padStart(12)}  ` +
          `${pct(c.deltaPct).padStart(8)} vs baseline ${fmt(c.before)}` +
          (c.over ? `  OVER CEILING ${fmt(c.ceiling)}` : ''),
      );
    }
    console.log(`    assets span ${e.measured.assetCount} files`);
  }
  if (UPDATE) {
    console.log(`\nBaseline rewritten → scripts/perf-budget.json  (commit it)`);
  } else if (failed) {
    console.log(
      `\nOver budget. Either the growth is a regression — find it — or it is ` +
        `intended,\nin which case re-baseline with \`npm run perf:budget -- --update\` ` +
        `and say why\nin the commit message. Do not raise headroomPct to make this pass.`,
    );
  } else if (report.length) {
    console.log(`\nWithin budget.`);
  }
}

process.exit(failed && !UPDATE ? 1 : 0);
