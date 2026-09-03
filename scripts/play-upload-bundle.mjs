// Upload a signed `.aab` to a Play testing track through androidpublisher
// directly — the same JWT + service account `play-production-release.mjs`
// uses, so nothing new is granted.
//
// Exists because `eas submit` is the documented path and it has now failed in
// three distinct ways that exit 0 (`build-android/REFERENCE.md`), and on
// 2026-09-03 could not be invoked from an agent session at all. This does the
// same four calls fastlane does — edits.insert → bundles.upload →
// tracks.update → edits.commit — and prints what Play actually recorded,
// re-read from a FRESH edit, which is the only honest answer.
//
//   node scripts/play-upload-bundle.mjs <path.aab> [--track alpha] [--commit]
//
// Without --commit the edit is discarded after the upload (a dry run that
// still costs the 60 MB transfer, so it proves auth + the bundle parse).
//
// Retry policy, measured 2026-08-25: `edits` answers a transient 503
// `backendError` under load — the upload itself succeeded and the very next
// small call got one. The SMALL calls are retried here; the upload is not.
import { JWT } from 'file:///Z:/macro-app/node_modules/google-auth-library/build/src/index.js';
import { readFileSync, statSync } from 'node:fs';

const PKG = 'fit.ignia.app';
const KEY_PATH = 'Z:/macro-app/apps/mobile/credentials/play-service-account.json';

const args = process.argv.slice(2);
const aabPath = args.find((a) => !a.startsWith('--'));
const trackIdx = args.indexOf('--track');
const track = trackIdx >= 0 ? args[trackIdx + 1] : 'alpha';
const commit = args.includes('--commit');
if (!aabPath) {
  console.error('usage: node scripts/play-upload-bundle.mjs <path.aab> [--track alpha] [--commit]');
  process.exit(2);
}

const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const client = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const uploadBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}`;

async function small(opts, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return (await client.request(opts)).data;
    } catch (e) {
      last = e;
      const status = e?.response?.status;
      if (status !== 503 && status !== 500) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}


/**
 * Commit, and if Play refuses to auto-submit for review (it does while the app
 * carries a rejection — 2026-09-03: "Changes cannot be sent for review
 * automatically. Please set the query parameter changesNotSentForReview to
 * true"), commit WITHOUT sending for review and say so: the owner then presses
 * "Send for review" on Publishing overview in the Console.
 */
async function commitEdit(editId) {
  try {
    await small({ url: `${base}/edits/${editId}:commit`, method: 'POST' });
    console.log('COMMITTED (sent for review).');
  } catch (e) {
    const msg = JSON.stringify(e?.response?.data ?? '');
    if (!msg.includes('changesNotSentForReview')) throw e;
    await small({ url: `${base}/edits/${editId}:commit?changesNotSentForReview=true`, method: 'POST' });
    console.log('COMMITTED, NOT sent for review — Play requires the Console for that while a rejection stands.');
    console.log('→ Play Console → Publishing overview → "Send changes for review".');
  }
}

const bytes = statSync(aabPath).size;
console.log(`bundle: ${aabPath} (${(bytes / 1e6).toFixed(1)} MB) → track "${track}" ${commit ? 'COMMIT' : 'dry run'}`);

const edit = await small({ url: `${base}/edits`, method: 'POST', data: {} });
console.log('edit', edit.id);
try {
  const body = readFileSync(aabPath);
  const up = (
    await client.request({
      url: `${uploadBase}/edits/${edit.id}/bundles?uploadType=media`,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length) },
      body,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })
  ).data;
  console.log(`uploaded: versionCode ${up.versionCode}, sha256 ${up.sha256}`);

  const tracks = await small({ url: `${base}/edits/${edit.id}/tracks` });
  const current = (tracks.tracks ?? []).find((t) => t.track === track);
  const priorName = current?.releases?.[0]?.name;
  const release = {
    name: `${up.versionCode} (${JSON.parse(readFileSync('Z:/macro-app/apps/mobile/app.json','utf8')).expo.version})`,
    versionCodes: [String(up.versionCode)],
    status: 'completed',
  };
  console.log(`track "${track}" currently: ${priorName ?? '(empty)'} → release`, JSON.stringify(release));

  if (!commit) {
    console.log('DRY RUN — discarding the edit.');
    await client.request({ url: `${base}/edits/${edit.id}`, method: 'DELETE' }).catch(() => {});
    process.exit(0);
  }

  await small({
    url: `${base}/edits/${edit.id}/tracks/${track}`,
    method: 'PUT',
    data: { track, releases: [release] },
  });
  await commitEdit(edit.id);

  // Re-read from a fresh edit — an in-edit read reflects committed state only.
  const e2 = await small({ url: `${base}/edits`, method: 'POST', data: {} });
  const after = await small({ url: `${base}/edits/${e2.id}/tracks/${track}` });
  await client.request({ url: `${base}/edits/${e2.id}`, method: 'DELETE' }).catch(() => {});
  console.log(`track "${track}" now:`, JSON.stringify(after.releases?.map((r) => ({ name: r.name, status: r.status, versionCodes: r.versionCodes }))));
} catch (e) {
  const detail = e?.response?.data ?? e?.message ?? e;
  console.error('FAILED:', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  await client.request({ url: `${base}/edits/${edit.id}`, method: 'DELETE' }).catch(() => {});
  process.exit(1);
}
