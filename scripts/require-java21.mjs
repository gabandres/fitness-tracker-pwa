#!/usr/bin/env node
/**
 * Java 21+ launcher for the emulator-backed suites (`test:rules`, `test:ledger`).
 *
 * `firebase-tools` dropped Java < 21, so both suites die with
 *
 *     firebase-tools no longer supports Java version before 21
 *
 * which reads like a broken toolchain rather than a PATH problem. On 2026-08-09
 * it was misdiagnosed as "the rules suite cannot run on this machine" and a
 * wrong test count was recorded off the back of it. On 2026-08-13 the same
 * machine was still shipping `JAVA_HOME` pointed at 17 while JDK 21.0.11 sat
 * installed beside it, and 349 emulator-backed tests were being skipped as
 * "environment-blocked" — they all pass.
 *
 * ## Why this now runs the command instead of printing advice
 *
 * It used to only warn, on the reasoning that guessing an install path in
 * committed config is how a script starts working on one machine and lying on
 * every other. That objection is right and is preserved here — **nothing in
 * the candidate list is trusted.** Every path is a place to *look*; a JDK is
 * only used after `<candidate>/bin/java -version` has been executed and has
 * reported 21 or higher. Discovery-then-verification is not guessing, and it
 * cannot lie: if the path is wrong or the JDK is too old, the candidate is
 * discarded and the next is tried.
 *
 * The other half of the reason is mechanical. As a preflight in
 * `node require-java21.mjs && firebase …` it could not have fixed anything
 * even in principle — a child process cannot change its parent's PATH. Advice
 * was the only thing it was structurally capable of producing.
 *
 * Usage:
 *   node scripts/require-java21.mjs <command> [args...]   run with a good JDK
 *   node scripts/require-java21.mjs                        preflight only (warn)
 *
 * If no JDK 21+ is found it warns and runs the command anyway, so the real
 * firebase-tools error still surfaces rather than being masked by ours.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 21;

function parse(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  // Java 8 and earlier report as 1.8.x — the second group is the real major.
  return major === 1 ? Number(m[2] ?? 0) : major;
}

/**
 * Major version reported by a specific java binary.
 *
 * `java -version` writes to **stderr**, including on success — reading only
 * stdout returns an empty string and reports "no Java" on a machine that has
 * it, which is exactly the false negative this script exists to prevent.
 */
function majorOf(javaBin) {
  const r = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  if (r.error) return null;
  return parse(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}

/** Directories that commonly *contain* JDK homes, per platform. Places to look,
 *  never things to believe — each hit is verified by running its java. */
function candidateHomes() {
  const homes = [];
  if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);

  if (process.platform === 'darwin') {
    // The supported way to enumerate JDKs on macOS. Ask it for a 21+ home.
    const r = spawnSync('/usr/libexec/java_home', ['-v', `${MIN}+`], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && r.stdout.trim()) homes.push(r.stdout.trim());
  }

  const parents =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Microsoft', 'C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Zulu']
      : process.platform === 'darwin'
        ? ['/Library/Java/JavaVirtualMachines', '/opt/homebrew/opt']
        : ['/usr/lib/jvm'];

  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    let entries = [];
    try {
      entries = readdirSync(parent);
    } catch {
      continue;
    }
    for (const e of entries) {
      const base = join(parent, e);
      // JDK homes nest differently: bare on Windows/Linux, inside
      // Contents/Home on macOS bundles, and one deeper again for Homebrew.
      homes.push(
        base,
        join(base, 'Contents', 'Home'),
        join(base, 'libexec', 'openjdk.jdk', 'Contents', 'Home'),
      );
    }
  }
  return homes;
}

/** First candidate whose own java actually reports >= MIN. */
function findJava21() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const seen = new Set();
  for (const home of candidateHomes()) {
    if (seen.has(home)) continue;
    seen.add(home);
    const bin = join(home, 'bin', exe);
    if (!existsSync(bin)) continue;
    const major = majorOf(bin);
    if (major != null && major >= MIN) return { home, bin, major };
  }
  return null;
}

const argv = process.argv.slice(2);
const pathMajor = majorOf('java');

// Already good: nothing to do but get out of the way.
if (pathMajor != null && pathMajor >= MIN) {
  if (argv.length === 0) process.exit(0);
  process.exit(run(argv, process.env));
}

const found = findJava21();

if (!found) {
  console.warn(
    `\n⚠  PATH java is ${pathMajor ?? 'unreadable'} and no JDK ${MIN}+ was found in the usual places.\n` +
      `   The Firestore emulator needs ${MIN}+. Install one, or set JAVA_HOME to it.\n` +
      '   STATUS.md §7 carries this, and also: run test:rules and test:ledger\n' +
      "   SEPARATELY — back to back, the second inherits the first's emulator port.\n",
  );
  // Run anyway so firebase-tools' own error is what the developer sees.
  process.exit(argv.length === 0 ? 0 : run(argv, process.env));
}

console.log(
  `[require-java21] PATH java is ${pathMajor ?? 'unreadable'}; using JDK ${found.major} at ${found.home}`,
);

if (argv.length === 0) process.exit(0);

const sep = process.platform === 'win32' ? ';' : ':';
process.exit(
  run(argv, {
    ...process.env,
    JAVA_HOME: found.home,
    PATH: `${join(found.home, 'bin')}${sep}${process.env.PATH ?? ''}`,
  }),
);

/**
 * Re-quote and spawn. The shell already stripped the quotes around composite
 * args like `"vitest run --config …"`, so any arg containing whitespace has to
 * get them back or it arrives as several arguments.
 */
function run(args, env) {
  const cmd = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  return r.status ?? 1;
}
