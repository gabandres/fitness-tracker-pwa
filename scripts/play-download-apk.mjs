#!/usr/bin/env node
/**
 * Download the APK Google Play generated for a version code — the universal
 * one, signed with the Play app-signing key — so a test phone can run the
 * exact binary the store ships.
 *
 *   node scripts/play-download-apk.mjs --vc 53 [--out <file.apk>]
 *
 * Why it exists (2026-11-20): `winbox` cannot build Android (no SDK beyond
 * platform-tools, no Mac), and the OnePlus test phone held an adb-installed
 * vc 48 signed with the UPLOAD key — below the update-required minimum and on
 * a runtime no OTA is published to any more. Play's own APK is the one binary
 * guaranteed to carry the shipped runtime fingerprint.
 *
 * Installing it over an upload-key build fails (different signature): uninstall
 * first — `adb uninstall fit.ignia.app` — which clears the app's data on that
 * phone. From then on Play can update the phone like any other.
 *
 * Auth: the Play service account (`apps/mobile/credentials/play-service-account.json`),
 * the same one `play-upload-bundle.mjs` uses. Read, never printed.
 */
import { JWT } from 'google-auth-library';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'fit.ignia.app';
const KEY_PATH = resolve(ROOT, 'apps/mobile/credentials/play-service-account.json');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const vc = Number(arg('vc'));
if (!Number.isInteger(vc) || vc <= 0) {
  console.error('usage: node scripts/play-download-apk.mjs --vc <versionCode> [--out <file.apk>]');
  process.exit(64);
}
const out = resolve(arg('out') ?? `ignia-vc${vc}-play-universal.apk`);

const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const client = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/generatedApks/${vc}`;

const listing = (await client.request({ url: base })).data;
const sets = listing.generatedApks ?? [];
if (sets.length === 0) {
  console.error(`Play has no generated APKs for vc ${vc}`);
  process.exit(1);
}
for (const s of sets) {
  console.log(
    `signing cert ${String(s.certificateSha256Fingerprint).slice(0, 23)}… · universal: ${s.generatedUniversalApk ? 'yes' : 'no'} · ` +
      `standalone: ${(s.generatedStandaloneApks ?? []).length} · splits: ${(s.generatedSplitApks ?? []).length}`,
  );
}
const universal = sets.map((s) => s.generatedUniversalApk).find(Boolean);
if (!universal) {
  console.error('no universal APK in the listing: install from the Play Store on the phone instead');
  process.exit(1);
}
const res = await client.request({
  url: `${base}/downloads/${universal.downloadId}:download`,
  params: { alt: 'media' },
  responseType: 'arraybuffer',
});
const bytes = Buffer.from(res.data);
writeFileSync(out, bytes);
console.log(`written ${out} (${bytes.length.toLocaleString()} bytes)`);
