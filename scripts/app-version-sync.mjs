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

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

/** Rewrite only the Android number. iOS is intentionally hand-held — see the
 *  note in the manifest and in apps/mobile/AGENTS.md. */
function writeAndroidVersionCode(manifest, versionCode) {
  const next = { ...manifest, android: { ...manifest.android, latestVersionCode: versionCode } };
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
}

// ─── CLI ───────────────────────────────────────────────────────────────
// Only when run directly; `doctor.mjs` imports readLivePlayVersionCode instead.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const checkOnly = process.argv.includes('--check');
  const manifest = readManifest();
  const current = manifest.android?.latestVersionCode ?? 0;

  const { versionCode, tracks } = await readLivePlayVersionCode();
  if (!versionCode) {
    console.error('No rolled-out release on any Play track — nothing to sync.');
    process.exit(1);
  }

  if (versionCode === current) {
    console.log(`app-version.json is current: android.latestVersionCode = ${current} (${tracks.join(', ')})`);
    process.exit(0);
  }

  if (checkOnly) {
    console.error(
      `DRIFT: app-version.json says ${current}, Play is shipping ${versionCode} (${tracks.join(', ')}).\n` +
        'Every install below ' + versionCode + ' is being told it is up to date.\n' +
        'Fix: node scripts/app-version-sync.mjs && firebase deploy --only hosting',
    );
    process.exit(1);
  }

  writeAndroidVersionCode(manifest, versionCode);
  console.log(
    `app-version.json: android.latestVersionCode ${current} → ${versionCode} (${tracks.join(', ')})\n` +
      'Deploy it or the change reaches nobody: firebase deploy --only hosting',
  );
}
