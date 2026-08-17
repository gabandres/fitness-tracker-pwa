#!/usr/bin/env node
/**
 * Measure how long a real local mobile build takes on THIS machine.
 *
 * `docs/build-infrastructure.md` quotes four numbers — iOS 15m57s cold / ~11m
 * warm, Android 10m36s cold / 1m51s incremental — and every one was measured on
 * the **MacBook Air M1**. Nothing in the repo records which machine a build time
 * came from, so the moment a second Mac exists those numbers stop meaning
 * anything: a reader cannot tell a regression from a faster laptop. That is why
 * this prints the chip, cores and RAM beside every timing and emits a
 * paste-ready line keyed on the machine.
 *
 * ## What "cold" actually means here — the thing that is easy to get wrong
 *
 * `eas build --local` does NOT build in `apps/mobile/{ios,android}`; it stages
 * the prebuild elsewhere, and on `ignia-mac` neither directory exists even
 * though both platforms have shipped from it. So deleting them proves nothing
 * and a build is not made cold that way. **Warmth lives in the caches outside
 * the project** — `~/.gradle`, `~/Library/Caches/CocoaPods`,
 * `~/Library/Android`, Metro's cache. That is why `DEV_ENVIRONMENT.md:617`
 * describes losing `~/.gradle` as "the price of a much slower next Android
 * build".
 *
 * Consequence worth planning around: **a genuinely cold number can only be
 * measured ONCE per machine**, before anything warms those caches. On a new
 * laptop, run this first. This script therefore does not pretend to
 * manufacture cold — it reports which caches were present and labels the runs
 * `first` and `repeat`, which is what it can actually stand behind.
 *
 * ## Why it never runs the two platforms concurrently
 *
 * Both builds share ONE working tree, one `node_modules` and one Metro cache,
 * and each runs its own prebuild. Concurrently in the same clone the failure is
 * corrupted output or an incoherent error, not a slow build — a correctness
 * problem no amount of CPU fixes. For real parallelism use a second clone or a
 * `git worktree`, and expect the limits to bite anyway: a Gradle JVM daemon
 * beside parallel `clang` jobs on a fanless Air that throttles under sustained
 * all-core load.
 *
 * Usage (run ON the Mac — see the darwin guard):
 *   node scripts/time-mobile-builds.mjs                  # both platforms, 2 runs each
 *   node scripts/time-mobile-builds.mjs --ios            # one platform only
 *   node scripts/time-mobile-builds.mjs --once           # one run per platform
 *   node scripts/time-mobile-builds.mjs --json           # machine-readable
 *   node scripts/time-mobile-builds.mjs --dry-run        # print machine + plan, build nothing
 *
 * From Windows:
 *   ssh ignia-mac "cd ~/fitness-tracker-pwa && git pull && node scripts/time-mobile-builds.mjs"
 *
 * `--dry-run` exists because a real run costs ~40 minutes on an M1: it is how
 * you confirm the machine is detected, the disk is sufficient and the paths
 * resolve BEFORE spending them.
 *
 * Every build is wrapped in `caffeinate -dims`. An SSH-driven build that loses
 * the machine to sleep does not report an error, it reports a wrong duration —
 * and a hung build already looked exactly like slow compilation for 19 minutes
 * (`DEV_ENVIRONMENT.md:735`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const MOBILE = join(REPO, 'apps', 'mobile');

/** §3.11: Android wants 20 GB free, iOS ~17. Below this a build dies mid-CMake
 *  on `No space left on device` — which is what cost `vc 28`. */
const MIN_FREE_GB = 20;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const JSON_OUT = has('--json');
const ONCE = has('--once');
const DRY = has('--dry-run');
const FORCE = has('--force');
// Neither platform flag means both. Order is fixed; never concurrent.
const PLATFORMS =
  has('--ios') || has('--android')
    ? ['ios', 'android'].filter((p) => has(`--${p}`))
    : ['ios', 'android'];

/** stdout of a command, trimmed, or null. Never throws. */
function capture(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? '').trim() || null;
}

/**
 * Who is this machine? Without it the timings are unattributable — the exact
 * defect in the numbers currently sitting in the docs.
 */
function machine() {
  const memBytes = Number(capture('sysctl -n hw.memsize') ?? 0);
  return {
    chip: capture('sysctl -n machdep.cpu.brand_string') ?? 'unknown',
    cores: Number(capture('sysctl -n hw.ncpu') ?? 0) || null,
    ramGb: memBytes ? Math.round(memBytes / 1024 ** 3) : null,
    model: capture('sysctl -n hw.model'),
    macos: capture('sw_vers -productVersion'),
    xcode: (capture('xcodebuild -version') ?? '').split('\n')[0] || null,
  };
}

/**
 * Free space on the **Data** volume. `df -h /` is the sealed System snapshot and
 * reads as nearly empty on a full disk (`DEV_ENVIRONMENT.md:553`), so asking the
 * wrong path here would defeat the whole preflight.
 */
function freeGb() {
  const out = capture('df -k /System/Volumes/Data | tail -1');
  const kb = Number((out ?? '').split(/\s+/)[3] ?? 0);
  return kb ? Math.round((kb * 1024) / 1024 ** 3) : null;
}

/** Which caches are present — this is what makes a build warm, so it is recorded
 *  alongside the durations rather than left to memory. */
function caches() {
  const home = process.env.HOME ?? '';
  const paths = {
    gradle: join(home, '.gradle'),
    cocoapods: join(home, 'Library', 'Caches', 'CocoaPods'),
    androidSdk: join(home, 'Library', 'Android'),
  };
  const out = {};
  for (const [k, p] of Object.entries(paths)) {
    out[k] = existsSync(p) ? (capture(`du -sh "${p}" 2>/dev/null | cut -f1`) ?? 'present') : null;
  }
  return out;
}

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** Time one command. A failure is reported, not thrown, so a broken iOS
 *  toolchain still leaves the Android numbers usable. */
function timed(label, cmd, cwd) {
  if (!JSON_OUT) console.log(`\n▶ ${label}\n  ${cmd}`);
  if (DRY) {
    if (!JSON_OUT) console.log(`  (dry run — not executed, cwd ${cwd})`);
    return { label, ms: 0, ok: true, dry: true };
  }
  const started = process.hrtime.bigint();
  const r = spawnSync(`caffeinate -dims ${cmd}`, {
    cwd,
    shell: true,
    stdio: JSON_OUT ? 'ignore' : 'inherit',
    env: process.env,
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const ok = r.status === 0;
  if (!JSON_OUT) console.log(`  ${ok ? '✓' : '✗ FAILED'} ${label} — ${fmt(ms)}`);
  return { label, ms, ok };
}

/**
 * Both platforms go through `eas build --local` — the actual ship path
 * (`build-infrastructure.md` for iOS, `DEV_ENVIRONMENT.md:662` for Android), not
 * a proxy for it. It matters for Android: raw `./gradlew bundleRelease` needs an
 * `android/` that already exists plus local signing config, so it cannot run on
 * a fresh machine at all. `eas --local` prebuilds and signs with the real upload
 * key from `credentials.json`. For iOS it also sidesteps the ASC 401 that breaks
 * non-interactive cloud builds.
 */
const BUILD = {
  ios: 'npx eas build -p ios --profile production --local --non-interactive',
  android: 'npx eas build -p android --profile production --local --non-interactive',
};

// ---------------------------------------------------------------------------

if (process.platform !== 'darwin') {
  console.error(
    `\n✗ This measures LOCAL builds and must run on macOS — this is ${process.platform}.\n` +
      '  iOS cannot build here at all (SDK 54 refuses `expo prebuild` off macOS), and\n' +
      '  Android AABs cannot either: RN New Architecture C++ hits the 260-char MAX_PATH\n' +
      '  wall, and WSL2 is no escape on an ARM64 box against an x86_64-only NDK.\n' +
      '  See DEV_ENVIRONMENT.md §3.11 — this is structural, not a setup gap.\n\n' +
      '  Run it on the Mac:\n' +
      '    ssh ignia-mac "cd ~/fitness-tracker-pwa && git pull && node scripts/time-mobile-builds.mjs"\n',
  );
  process.exit(1);
}

const box = machine();
const free = freeGb();
const cache = caches();

if (!JSON_OUT) {
  console.log(
    `\nMachine: ${box.chip} · ${box.cores} cores · ${box.ramGb}GB RAM` +
      `${box.model ? ` · ${box.model}` : ''}\n` +
      `macOS ${box.macos ?? '?'}${box.xcode ? ` · ${box.xcode}` : ''}\n` +
      `Free on Data volume: ${free ?? '?'}GB\n` +
      `Caches: gradle ${cache.gradle ?? 'ABSENT'} · cocoapods ${cache.cocoapods ?? 'ABSENT'} · androidSdk ${cache.androidSdk ?? 'ABSENT'}\n` +
      `Platforms: ${PLATFORMS.join(', ')} — sequentially, never concurrently (see header).\n`,
  );
  if (!cache.gradle || !cache.cocoapods) {
    console.log('→ A cache is absent, so the FIRST run below is a genuine cold number. It is\n' +
      '  measurable exactly once on this machine; record it.\n');
  }
}

if (free != null && free < MIN_FREE_GB && !FORCE) {
  console.error(
    `✗ Only ${free}GB free on the Data volume; §3.11 needs ~${MIN_FREE_GB}GB (Android 20, iOS ~17).\n` +
      '  A build started here dies mid-CMake on `No space left on device` after burning\n' +
      '  the wall-clock — that is how `vc 28` was lost. Free space first;\n' +
      '  DEV_ENVIRONMENT.md §3.9 has the measured teardown of where it goes.\n' +
      '  Override with --force if you know better.\n',
  );
  process.exit(1);
}

const results = [];
for (const platform of PLATFORMS) {
  const cmd = BUILD[platform];
  if (!existsSync(MOBILE)) {
    if (!JSON_OUT) console.log(`\n⚠ skipping ${platform}: ${MOBILE} does not exist`);
    continue;
  }
  const first = timed(`${platform} build (first run)`, cmd, MOBILE);
  results.push({ platform, run: 'first', ms: first.ms, ok: first.ok });
  if (!ONCE) {
    const repeat = timed(`${platform} build (repeat, caches warm)`, cmd, MOBILE);
    results.push({ platform, run: 'repeat', ms: repeat.ms, ok: repeat.ok });
  }
}

const total = results.reduce((a, r) => a + r.ms, 0);
const name = `${box.chip}, ${box.ramGb}GB`;

if (JSON_OUT) {
  console.log(JSON.stringify({ machine: box, freeGb: free, caches: cache, results, totalMs: total }, null, 2));
} else if (DRY) {
  console.log(
    `\n${'─'.repeat(64)}\nDry run — nothing built. ${results.length} build(s) planned on ${name}.\n` +
      'Drop --dry-run to measure; budget ~40min on an M1, less on newer silicon.\n',
  );
} else {
  console.log(`\n${'─'.repeat(64)}\nResults — ${name}\n`);
  for (const r of results) {
    console.log(
      `  ${r.platform.padEnd(8)} ${r.run.padEnd(7)} ${fmt(r.ms).padStart(8)}` +
        `${r.ok ? '' : '   (FAILED — time not meaningful)'}`,
    );
  }
  console.log(`\n  sequential total: ${fmt(total)}`);
  console.log('\nPaste-ready for docs/build-infrastructure.md:\n');
  for (const p of [...new Set(results.map((r) => r.platform))]) {
    const f = results.find((r) => r.platform === p && r.run === 'first');
    const w = results.find((r) => r.platform === p && r.run === 'repeat');
    const coldish = !cache.gradle || !cache.cocoapods ? 'cold' : 'first run';
    console.log(
      `- **${p}** on ${name}: ${f ? `${fmt(f.ms)} ${coldish}` : ''}${w ? `, ${fmt(w.ms)} warm` : ''}`,
    );
  }
  console.log('');
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
