#!/usr/bin/env node
// Check that what `https://ignia.fit/app-version.json` tells installed apps
// matches what the stores actually ship — and record the one value the cloud
// cannot derive on its own.
//
// HISTORY. Until 2026-09-05 this script WROTE `public/app-version.json`, a
// static file that then needed `npm run build && firebase deploy`. It drifted
// on every release (1.2.1, 1.2.2) because the sync was a step a person had to
// remember while shipping. The numbers now live in Firestore
// `public/appVersion`, refreshed hourly by `hourlyTasks` and on demand from
// `/admin` → System → "Sync now" (`functions/src/app-version.ts`), and the URL
// is a hosting rewrite. Nothing here deploys anything any more.
//
//   node scripts/app-version-sync.mjs --check                       # live URL vs Play + ASC (doctor runs this)
//   node scripts/app-version-sync.mjs --record-ios-build 1.2.3 64   # version → build, for legacy clients
//
// WHY --record-ios-build EXISTS. The cloud reads iOS from Apple's public
// lookup, which returns the marketing version but not the build number, and
// every iOS binary before 2026-09-05 compares on the build number. The
// workstation holds the ASC key, so the release script records the mapping at
// submission time (`asc-release-version.mjs` calls `recordIosBuild`), and the
// hourly sync promotes the build the hour the version goes live. Run it by
// hand only when a version was submitted some other way.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATH = resolve(root, 'apps/mobile/credentials/play-service-account.json');
const PACKAGE = 'fit.ignia.app';
export const MANIFEST_URL = 'https://ignia.fit/app-version.json';
const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const DOC_PATH = 'public/appVersion';

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
 * Mirrored in `functions/src/app-version.ts` (`DISTRIBUTING_TRACKS`); keep
 * the two in step. Revisit the day internal testing gains real testers.
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
 * `READY_FOR_SALE` is by definition what the public can download, so its
 * attached build cannot be a TestFlight-only one — TestFlight always runs
 * ahead, which is why "the newest build number anyone can see" is nearly
 * always the wrong answer for a store banner.
 *
 * Returns null when no version is live (a brand-new app, or credentials that
 * cannot reach ASC). Null means "unknown", never "0" — 0 disables the prompt.
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

/** What installed apps are being told right now — the live URL, bypassing
 *  the CDN's hour of cache so the check reads the current Firestore value. */
export async function readLiveManifest() {
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${MANIFEST_URL} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Record `version → build` in `public/appVersion.iosBuilds` through the Admin
 * SDK (ADC, `gcloud auth application-default login` — see CLAUDE.local.md).
 * Idempotent. The hourly sync promotes it once the lookup reports the version.
 */
export async function recordIosBuild(version, build) {
  const n = Number(build);
  if (!/^\d+\.\d+(\.\d+)?$/.test(String(version)) || !Number.isFinite(n) || n <= 0) {
    throw new Error(`recordIosBuild: refusing "${version}" → "${build}"`);
  }
  const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  await getFirestore().doc(DOC_PATH).set(
    { iosBuilds: { [version]: n }, iosBuildsUpdatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { version, build: n };
}

// ─── CLI ───────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const rec = argv.indexOf('--record-ios-build');
  if (rec >= 0) {
    const r = await recordIosBuild(argv[rec + 1], argv[rec + 2]);
    console.log(`recorded iosBuilds["${r.version}"] = ${r.build} — the hourly sync (or /admin → Sync now) promotes it once ${r.version} is live`);
    process.exit(0);
  }
  if (!argv.includes('--check')) {
    console.error('usage: node scripts/app-version-sync.mjs --check | --record-ios-build <version> <build>');
    process.exit(2);
  }

  const manifest = await readLiveManifest();
  const curAndroid = manifest.android?.latestVersionCode ?? null;
  const curIosBuild = manifest.ios?.latestBuild ?? null;
  const curIosVersion = manifest.ios?.latestVersion ?? null;

  const { versionCode, tracks } = await readLivePlayVersionCode();
  if (!versionCode) {
    console.error('No rolled-out release on any Play track — nothing to compare.');
    process.exit(1);
  }

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
    drift.push(`android.latestVersionCode serves ${curAndroid}, Play is shipping ${versionCode} (${tracks.join(', ')})`);
  }
  if (ios && ios.version !== curIosVersion) {
    drift.push(`ios.latestVersion serves ${curIosVersion}, the App Store is serving ${ios.version} (build ${ios.build})`);
  }
  if (ios && ios.build !== curIosBuild) {
    drift.push(
      `ios.latestBuild serves ${curIosBuild}, the App Store is serving build ${ios.build} — ` +
        `if the version matches, the version→build map is missing it: node scripts/app-version-sync.mjs --record-ios-build ${ios.version} ${ios.build}`,
    );
  }

  if (!drift.length) {
    console.log(
      `app-version.json is current: android ${curAndroid} (${tracks.join(', ')})` +
        (ios ? `, ios ${curIosVersion} build ${curIosBuild}` : `, ios unchecked — ${iosWhy}`) +
        (manifest.updatedAt ? `, synced ${manifest.updatedAt}` : ''),
    );
    process.exit(0);
  }
  console.error(
    `DRIFT:\n  ${drift.join('\n  ')}\n` +
      'Anyone below those numbers is being told they are up to date.\n' +
      'Fix: /admin → System → "Sync now" (or wait for the hourly pass); the URL updates within the hour of CDN cache.',
  );
  process.exit(1);
}
