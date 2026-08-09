#!/usr/bin/env node
/**
 * Preflight for the emulator-backed suites (`test:rules`, `test:ledger`).
 *
 * `firebase-tools` dropped Java < 21, and this machine's PATH `java` is 17, so
 * both suites die with
 *
 *     firebase-tools no longer supports Java version before 21
 *
 * which reads like a broken toolchain rather than a PATH problem. JDK 21 IS
 * installed here; it is simply not first on PATH. That fix is written down in
 * `STATUS.md` §7 — and on 2026-08-09 it was still misdiagnosed as "the rules
 * suite cannot run on this machine", and a wrong test count was recorded off
 * the back of it. This script exists so the failure names its own fix.
 *
 * It only ever WARNS. It does not pick a JDK or mutate PATH: guessing an
 * install path in committed config is how a script starts working on one
 * machine and lying on every other (the same reason `withGradleJvmArgs.js`
 * must not hardcode `org.gradle.java.home`).
 */
import { spawnSync } from 'node:child_process';

/**
 * Major version from `java -version`.
 *
 * `java -version` writes to **stderr**, including on success — reading only
 * stdout returns an empty string and reports "no Java" on a machine that has
 * it, which is exactly the false negative this script exists to prevent.
 */
function javaMajor() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (r.error) return null;
  return parse(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}

function parse(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  // Java 8 and earlier report as 1.8.x — the second group is the real major.
  return major === 1 ? Number(m[2] ?? 0) : major;
}

const MIN = 21;
const major = javaMajor();

if (major == null) {
  console.warn('\n⚠  Could not read a Java version. The Firestore emulator needs JDK 21+.\n   See STATUS.md §7.\n');
} else if (major < MIN) {
  console.warn(
    `\n⚠  PATH java is ${major}; the Firestore emulator needs ${MIN}+.\n` +
      '   This is a PATH problem, not a broken suite — a newer JDK is very likely\n' +
      '   already installed. Put it first and re-run, e.g. on this Windows box:\n\n' +
      '     export PATH="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin:$PATH"\n\n' +
      '   (Check what you have: ls "/c/Program Files/Microsoft"; on ignia-mac the\n' +
      '   Homebrew openjdk@26 is at /opt/homebrew/opt/openjdk@26/libexec/openjdk.jdk/Contents/Home.)\n' +
      '   STATUS.md §7 carries this, and also: run test:rules and test:ledger\n' +
      '   SEPARATELY — back to back, the second inherits the first\'s emulator port.\n',
  );
}
