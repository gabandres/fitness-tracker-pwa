#!/usr/bin/env node
/**
 * Assert that a built mobile artifact contains what it must, and exit non-zero
 * when it does not.
 *
 * ## Why this exists
 *
 * The `build-ios` and `build-android` skills described these checks in prose —
 * "confirm all four targets nest", "read the fingerprint from the artifact",
 * "signer must be CN=Macro Log Dev". Prose is advice a tired operator skips.
 * On 2026-08-08 that produced, in one evening:
 *
 *   - build 34 shipped `en.lproj` and silently omitted `es-PR.lproj`;
 *   - builds 38 AND 39 shipped without `NSMicrophoneUsageDescription`, which
 *     makes iOS terminate the app the first time it asks for the microphone;
 *   - build 39 was **submitted to TestFlight before it was checked**, because
 *     verify and submit were run in one command.
 *
 * Every one of those was mechanically detectable from the artifact. None needed
 * judgement. So they are code now, and submission is gated on the exit code
 * rather than on remembering.
 *
 * ## What it deliberately does NOT do
 *
 * It proves **structure, never behaviour**. Build 27's `Metadata.appintents`
 * was flawless on a binary that registered no Siri shortcut at all, and build
 * 32's entitlements were valid on a binary that could not read its own
 * keychain. A green run here means "nothing known-missing"; it never means
 * "works". Device QA is still the only thing that proves a native surface.
 *
 * ## Usage
 *
 *     node scripts/verify-mobile-artifact.mjs <path-to.ipa|.aab>
 *
 * Runs on macOS (`ignia-mac`) — it shells out to PlistBuddy and codesign for
 * the iOS half. The Android half needs only unzip/keytool and runs anywhere.
 * Expectations live in `scripts/native-expectations.json` so that adding a
 * required plist key is a data change, not a code change — and so the list is
 * reviewable in a diff.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECT = JSON.parse(readFileSync(join(HERE, 'native-expectations.json'), 'utf8'));

const artifact = process.argv[2];
if (!artifact || !existsSync(artifact)) {
  console.error('usage: node scripts/verify-mobile-artifact.mjs <path-to.ipa|.aab>');
  process.exit(2);
}

const problems = [];
const notes = [];
const ok = (label, detail) => notes.push(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, detail) => problems.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

function verifyIpa(path) {
  const dir = mkdtempSync(join(tmpdir(), 'ignia-ipa-'));
  try {
    sh('unzip', ['-q', '-o', path, '-d', dir]);
    const app = join(dir, 'Payload', 'Ignia.app');
    if (!existsSync(app)) return bad('Payload/Ignia.app', 'not found — is this an Ignia .ipa?');

    // 1. Every nested target. A dropped watch app or widget still exits 0.
    const found = sh('find', [join(dir, 'Payload'), '-name', '*.app', '-o', '-name', '*.appex'])
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(join(dir, 'Payload') + '/', ''));
    for (const target of EXPECT.ios.targets) {
      if (found.includes(target)) ok(`target ${target}`);
      else bad(`target ${target}`, 'MISSING from the .ipa');
    }

    // 2. Info.plist keys the app cannot function without. iOS terminates on a
    //    missing usage string, so an absent key here is a crash, not a warning.
    const plist = join(app, 'Info.plist');
    for (const key of EXPECT.ios.requiredInfoPlistKeys) {
      try {
        const v = sh('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).trim();
        if (v) ok(`Info.plist ${key}`, v.length > 48 ? `${v.slice(0, 45)}…` : v.replace(/\n/g, ' '));
        else bad(`Info.plist ${key}`, 'present but empty');
      } catch {
        bad(`Info.plist ${key}`, 'MISSING — see the plugin-ordering trap in build-ios');
      }
    }

    // 2b. URL schemes. The iPhone widget's face tap is `ignia://?openAdd=1`,
    //     and build 29's "de-duplication" of the explicit CFBundleURLTypes
    //     deleted the `ignia` entry — the explicit infoPlist array REPLACES the
    //     one Expo generates from `scheme`, so every build from 29 to 40
    //     shipped with a widget face that opens nothing. Found by the Maestro
    //     regression suite failing to openLink on the simulator.
    let urlTypes = '';
    try {
      urlTypes = sh('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleURLTypes', plist]);
    } catch {
      /* handled below as missing schemes */
    }
    const schemeLines = urlTypes.split(String.fromCharCode(10)).map((l) => l.trim());
    for (const scheme of EXPECT.ios.requiredUrlSchemes ?? []) {
      // Whole-line equality, NOT includes(): "ignia" is a substring of
      // "fit.ignia.app", and the first version of this check passed a binary
      // that provably could not open ignia:// because of exactly that.
      if (schemeLines.includes(scheme)) ok(`URL scheme ${scheme}`);
      else bad(`URL scheme ${scheme}`, 'NOT REGISTERED — widget/tile deep links open nothing');
    }
    // 3. Localised resources. Build 34 shipped one .lproj and dropped the other,
    //    exit 0, no warning, Spanish phrases simply absent.
    for (const lproj of EXPECT.ios.requiredLproj) {
      if (existsSync(join(app, lproj))) ok(`bundle ${lproj}`);
      else bad(`bundle ${lproj}`, 'MISSING');
    }

    // 4. Entitlements on the extension, which is a different process from the
    //    app and needs its own grants — the widget-keychain bug in one check.
    for (const [target, keys] of Object.entries(EXPECT.ios.requiredEntitlements ?? {})) {
      let xml = '';
      try {
        xml = sh('codesign', ['-d', '--entitlements', '-', '--xml', join(app, target)], {
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        bad(`entitlements ${target}`, 'could not read');
        continue;
      }
      for (const key of keys) {
        if (xml.includes(key)) ok(`entitlement ${target} ${key}`);
        else bad(`entitlement ${target} ${key}`, 'MISSING');
      }
    }

    // 5. Version + the fingerprint, printed so it is copied from the artifact
    //    and never from a locally generated hash.
    for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
      try {
        ok(key, sh('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).trim());
      } catch {
        bad(key, 'MISSING');
      }
    }
    const fp = join(app, 'EXUpdates.bundle', 'fingerprint');
    if (existsSync(fp)) ok('runtime fingerprint', readFileSync(fp, 'utf8').trim());
    else bad('runtime fingerprint', 'no EXUpdates.bundle/fingerprint — cannot receive OTAs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function verifyAab(path) {
  // 1. Signer. `CN=Android Debug` is the wrong upload cert and Play rejects it.
  try {
    const rsa = sh('unzip', ['-Z1', path])
      .split('\n')
      .find((n) => /^META-INF\/.*\.(RSA|DSA|EC)$/.test(n));
    if (!rsa) bad('signature', 'no META-INF signature block');
    else {
      const cert = sh('sh', ['-c', `unzip -p '${path}' '${rsa}' | keytool -printcert`]);
      const owner = (cert.match(/Owner:.*/) ?? [''])[0].trim();
      if (owner.includes(EXPECT.android.signerCN)) ok('signer', owner);
      else bad('signer', `${owner} — expected ${EXPECT.android.signerCN}`);
    }
  } catch (e) {
    bad('signature', String(e.message).split('\n')[0]);
  }

  // 2. The OTA channel. Without it the binary is an update dead end, silently —
  //    that shipped once as vc 10 and is why vc 11 exists.
  try {
    // No `| strings`: it is absent from Git Bash on Windows, which silently made
    // this gate unrunnable on a machine that can build an AAB — and this is the
    // check that catches the missing-channel defect. The protobuf manifest
    // decodes with replacement chars around the binary framing, but ASCII runs
    // survive intact, which is all these substring tests need.
    const manifest = sh('sh', [
      '-c',
      `unzip -p '${path}' base/manifest/AndroidManifest.xml`,
    ]);
    if (manifest.includes(`"expo-channel-name":"${EXPECT.android.channel}"`)) {
      ok('expo-channel-name', EXPECT.android.channel);
    } else {
      bad('expo-channel-name', `not "${EXPECT.android.channel}" — this build cannot receive OTAs`);
    }
    for (const svc of EXPECT.android.requiredServices ?? []) {
      if (manifest.includes(svc)) ok(`service ${svc.split('.').pop()}`);
      else bad(`service ${svc}`, 'MISSING from the merged manifest');
    }
  } catch (e) {
    bad('manifest', String(e.message).split('\n')[0]);
  }

  // 3. Fingerprint from the artifact, never computed locally.
  try {
    ok('runtime fingerprint', sh('sh', ['-c', `unzip -p '${path}' base/assets/fingerprint`]).trim());
  } catch {
    bad('runtime fingerprint', 'no base/assets/fingerprint — cannot receive OTAs');
  }
}

const isIpa = artifact.endsWith('.ipa');
console.log(`\nVerifying ${isIpa ? 'iOS' : 'Android'} artifact: ${artifact}\n`);
if (isIpa) verifyIpa(artifact);
else verifyAab(artifact);

for (const n of notes) console.log(n);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(p);
  console.log(
    `\n${problems.length} problem(s). DO NOT SUBMIT.\n` +
      `This artifact is structurally incomplete; submitting it spends a build number\n` +
      `and puts a broken binary in front of testers.\n`,
  );
  process.exit(1);
}
console.log(
  '\nAll structural checks passed.\n' +
    'This proves nothing about BEHAVIOUR — build 27 had flawless App Intents metadata\n' +
    'and registered no shortcut. Device QA is still the only proof.\n',
);
