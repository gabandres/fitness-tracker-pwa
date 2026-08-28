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

/** Tracks that can actually put a build on a stranger's phone.
 *
 * `internal` is deliberately absent, and that is not a simplification.
 * Publishing to internal testing is used HERE as a MECHANISM, not as a
 * distribution channel: it is the only way to make Play re-scan a bundle and
 * detect a new `android.permission.health.*` so the Health-apps declaration
 * becomes fillable (a `draft` commits but is never scanned; the same call as
 * `completed` returns 403). vc 39 went to internal on 2026-08-27 for exactly
 * that reason, with an empty audience, reaching nobody.
 *
 * Revisit this the day internal testing gains real testers.
 */
const DISTRIBUTING_TRACKS = new Set(['production', 'beta', 'alpha']);

/**
 * The highest versionCode rolled out on a track that has a real audience.
 *
 * Not just alpha: a tester on the closed track and a user on production are
 * both "someone running an old build", and the banner exists for both.
 *
 * TWO exclusions, and they are the same rule reached by different doors —
 * never point the banner at a build the user cannot install:
 *
 *   1. `draft` releases. Uploaded but not distributed.
 *   2. Any track outside {@link DISTRIBUTING_TRACKS}. A `completed` release on
 *      a track with no audience is just as unreachable as a draft, and it
 *      reads as distributed to every API field there is.
 *
 * Exclusion 2 was added 2026-08-27 after `npm run doctor` FAILED demanding a
 * sync from 37 to 39 — which would have told all 15 alpha testers, on vc 37,
 * that an update existed, sent them to a store page offering nothing, and
 * burned the banner's credibility. The deployed file was right and the check
 * was wrong. **The audience cannot be read from the API**: `edits.testers`
 * returns `googleGroups: null, googleEmails: null` for alpha AND internal
 * alike, because this app's testers come from a Play *email list*, which that
 * endpoint does not report. So the track name is the only signal available.
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
    if (!DISTRIBUTING_TRACKS.has(t.track)) continue;
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
