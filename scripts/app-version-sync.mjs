#!/usr/bin/env node
// Keep public/app-version.json in step with what Play actually ships.
//
// That file is what tells an installed Android app that a newer binary
// exists — `UpdateBanner` on Today fetches it and compares it to the running
// versionCode. It started life as a number a human bumped after every release,
// which is a step that fails silently: forget it and there is no error and no
// warning, every install simply goes on believing it is current, and the
// feature is indistinguishable from one that was never built.
//
// So the number is DERIVED here instead, from the androidpublisher tracks API —
// the same authority `doctor.mjs` uses to check signing certs, and the same one
// STATUS.md cites for "what is live on alpha".
//
//   node scripts/app-version-sync.mjs          # write the file
//   node scripts/app-version-sync.mjs --check   # report drift, write nothing (exit 1)
//
// `--check` is what `npm run doctor` runs, so drift is loud rather than silent.

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = resolve(root, 'public/app-version.json');
const KEY_PATH = resolve(root, 'apps/mobile/credentials/play-service-account.json');
const PACKAGE = 'fit.ignia.app';

/**
 * The highest versionCode rolled out on ANY track.
 *
 * Any track, not just alpha: a tester on the closed track and a user on
 * production are both "someone running an old build", and the banner exists for
 * both. Draft releases are excluded — a draft is uploaded but not distributed,
 * so telling anyone to go install it would send them to a store page that
 * offers nothing.
 *
 * @returns {Promise<{ versionCode: number, tracks: string[] }>}
 */
export async function readLivePlayVersionCode() {
  const { JWT } = await import('google-auth-library');
  const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
  const client = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
  const edit = await client.request({ url: `${base}/edits`, method: 'POST' });
  const editId = edit.data.id;
  let tracks;
  try {
    const res = await client.request({ url: `${base}/edits/${editId}/tracks` });
    tracks = res.data.tracks ?? [];
  } finally {
    // Edits expire on their own, but leaving them open accumulates garbage on
    // the app and a stale edit can block the next `eas submit`.
    await client.request({ url: `${base}/edits/${editId}`, method: 'DELETE' }).catch(() => {});
  }

  let best = 0;
  const where = [];
  for (const t of tracks) {
    for (const r of t.releases ?? []) {
      if (r.status === 'draft') continue;
      for (const vc of r.versionCodes ?? []) {
        const n = Number(vc);
        if (!Number.isFinite(n)) continue;
        if (n > best) best = n;
        where.push(`${t.track} vc ${n}`);
      }
    }
  }
  return { versionCode: best, tracks: where };
}

/**
 * The build attached to the version that is LIVE on the App Store.
 *
 * iOS used to be hand-held here, with a comment in the manifest explaining that
 * it "must name the live APP STORE build, never a TestFlight one". That is a
 * rule a human has to remember at exactly the moment they are busy shipping,
 * and it points the wrong way by default: TestFlight always runs ahead, so the
 * newest build number anyone can see is nearly always the wrong answer.
 *
 * Deriving it removes the choice. `READY_FOR_SALE` is by definition what the
 * public can download, so its attached build cannot be a TestFlight-only one —
 * the structural property the comment was asking a person to enforce.
 *
 * Returns null when no version is live (a brand-new app, or credentials that
 * cannot reach ASC). Null means "leave iOS alone", never "write 0" — 0 disables
 * the update prompt entirely, and silently disabling a shipped feature because
 * an API call failed is the same class of bug this script exists to prevent.
 *
 * @returns {Promise<{ build: number, version: string } | null>}
 */
export async function readLiveAppStoreBuild() {
  const { api, APP_ID } = await import('./asc-client.mjs');

  const versions = await api(
    'GET',
    `/v1/apps/${APP_ID}/appStoreVersions?limit=10` +
      '&fields[appStoreVersions]=versionString,appStoreState',
  );

  // READY_FOR_SALE is the live state. There is normally exactly one; if a
  // release is mid-phased-rollout there can be more, and the newest wins.
  const live = (versions.data ?? []).filter(
    (v) => v.attributes?.appStoreState === 'READY_FOR_SALE',
  );
  if (!live.length) return null;

  let best = null;
  for (const v of live) {
    const res = await api('GET', `/v1/appStoreVersions/${v.id}/build`);
    const build = Number(res.data?.attributes?.version);
    if (!Number.isFinite(build)) continue;
    if (!best || build > best.build) {
      best = { build, version: v.attributes.versionString };
    }
  }
  return best;
}

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

function writeManifest(manifest, { versionCode, iosBuild }) {
  const next = { ...manifest };
  if (versionCode != null) {
    next.android = { ...manifest.android, latestVersionCode: versionCode };
  }
  if (iosBuild != null) {
    next.ios = { ...manifest.ios, latestBuild: iosBuild };
  }
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
}

// ─── CLI ───────────────────────────────────────────────────────────────
// Only when run directly; `doctor.mjs` imports readLivePlayVersionCode instead.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const checkOnly = process.argv.includes('--check');
  const manifest = readManifest();
  const curAndroid = manifest.android?.latestVersionCode ?? 0;
  const curIos = manifest.ios?.latestBuild ?? 0;

  const { versionCode, tracks } = await readLivePlayVersionCode();
  if (!versionCode) {
    console.error('No rolled-out release on any Play track — nothing to sync.');
    process.exit(1);
  }

  // iOS is best-effort: a machine without the ASC key still syncs Android
  // rather than failing the whole run.
  let ios = null;
  let iosWhy = '';
  try {
    ios = await readLiveAppStoreBuild();
    if (!ios) iosWhy = 'no READY_FOR_SALE version on the App Store';
  } catch (e) {
    iosWhy = `could not reach App Store Connect (${e.message})`;
  }

  const drift = [];
  if (versionCode !== curAndroid) {
    drift.push(
      `android.latestVersionCode says ${curAndroid}, Play is shipping ${versionCode} (${tracks.join(', ')})`,
    );
  }
  if (ios && ios.build !== curIos) {
    drift.push(
      `ios.latestBuild says ${curIos}, the App Store is serving ${ios.version} build ${ios.build}`,
    );
  }

  if (!drift.length) {
    console.log(
      `app-version.json is current: android ${curAndroid} (${tracks.join(', ')})` +
        (ios ? `, ios ${curIos} (${ios.version} build ${ios.build})` : `, ios unchecked — ${iosWhy}`),
    );
    process.exit(0);
  }

  if (checkOnly) {
    console.error(
      `DRIFT:\n  ${drift.join('\n  ')}\n` +
        'Anyone below those numbers is being told they are up to date.\n' +
        'Fix: node scripts/app-version-sync.mjs && npm run build && firebase deploy --only hosting',
    );
    process.exit(1);
  }

  writeManifest(manifest, { versionCode, iosBuild: ios?.build });
  console.log(
    `app-version.json updated:\n  ${drift.join('\n  ')}\n` +
      (iosWhy ? `  ios left at ${curIos} — ${iosWhy}\n` : '') +
      'Deploy it or the change reaches nobody: npm run build && firebase deploy --only hosting',
  );
}
