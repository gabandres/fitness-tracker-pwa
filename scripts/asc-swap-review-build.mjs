#!/usr/bin/env node
// Swap the build attached to an App Store version that is already in review.
//
//   node scripts/asc-swap-review-build.mjs --build 24            # dry run
//   node scripts/asc-swap-review-build.mjs --build 24 --commit   # actually do it
//   ... --notes store-assets/whats-new-1.1.0.json                # also set release notes
//
// `--notes` exists because of a sequencing trap: version metadata is only
// editable while the version is NOT submitted, and that window is the few
// seconds between the cancel and the re-submit below. Uploading notes as a
// separate step afterwards fails — the version is locked again by then.
//
// WHY THIS EXISTS
//
// A version sitting in WAITING_FOR_REVIEW has its build frozen. Changing it is
// not an edit — it is: cancel the submission, re-point the build, submit again.
// There is no in-place swap, and the cancel is irreversible.
//
// THE COST, STATED PLAINLY: cancelling forfeits the queue position. A
// submission that has been waiting a day goes back to the end. Apple does not
// publish queue mechanics, so nobody can tell you how much time that is. Run
// this only when the attached build is wrong enough to be worth restarting the
// wait — for example when it predates `expo-updates` and would ship users a
// binary that cannot receive an over-the-air fix.
//
// Everything is verified between steps, and the script stops on the first
// surprise rather than pressing on with a half-applied change. The dangerous
// window is between the cancel and the re-submit: if it dies in there, the
// version is left unsubmitted (recoverable by hand in App Store Connect, but it
// will not ship until someone does).

import { readFileSync } from 'node:fs';
import { api, APP_ID } from './asc-client.mjs';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const wantIdx = args.indexOf('--build');
const wantBuild = wantIdx >= 0 ? args[wantIdx + 1] : null;
const notesIdx = args.indexOf('--notes');
const notesPath = notesIdx >= 0 ? args[notesIdx + 1] : null;

/** `{ "en-US": "…", "es-MX": "…" }`; `_`-prefixed keys are commentary. */
const notes = notesPath
  ? Object.fromEntries(
      Object.entries(JSON.parse(readFileSync(notesPath, 'utf8'))).filter(
        ([k]) => !k.startsWith('_'),
      ),
    )
  : null;

if (!wantBuild) {
  console.error('Usage: node scripts/asc-swap-review-build.mjs --build <versionNumber> [--commit]');
  process.exit(1);
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const plan = (msg) => console.log(`      ${commit ? '→' : 'would'} ${msg}`);

// ─── 1. The version under review ───────────────────────────────────────
step(1, 'Finding the version under review');
const versions = await api(
  'GET',
  `/v1/apps/${APP_ID}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appStoreState,releaseType`,
);
const version = versions.data.find((v) =>
  ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'READY_FOR_REVIEW'].includes(
    v.attributes.appStoreState,
  ),
);
if (!version) {
  console.error('No version is awaiting or in review. Nothing to swap.');
  process.exit(1);
}
console.log(`      ${version.attributes.versionString} — ${version.attributes.appStoreState}`);

if (version.attributes.appStoreState === 'IN_REVIEW') {
  // Apple is actively looking at it. Cancelling now throws away real reviewer
  // progress and is far more likely to cost days than a WAITING_FOR_REVIEW swap.
  console.error(
    '\nREFUSING: the version is IN_REVIEW — a reviewer already has it. Wait for the outcome.',
  );
  process.exit(1);
}

// ─── 2. Current vs desired build ───────────────────────────────────────
step(2, 'Comparing attached build against the requested one');
const attached = await api(
  'GET',
  `/v1/appStoreVersions/${version.id}/build?fields[builds]=version,processingState`,
).catch(() => ({ data: null }));
console.log(`      attached: ${attached.data ? 'build ' + attached.data.attributes.version : '(none)'}`);

const builds = await api(
  'GET',
  `/v1/builds?filter[app]=${APP_ID}&limit=20&sort=-version&fields[builds]=version,processingState,expired`,
);
const target = builds.data.find((b) => b.attributes.version === String(wantBuild));
if (!target) {
  console.error(`Build ${wantBuild} not found on this app.`);
  process.exit(1);
}
if (target.attributes.processingState !== 'VALID' || target.attributes.expired) {
  console.error(
    `Build ${wantBuild} is ${target.attributes.processingState}, expired=${target.attributes.expired} — not submittable.`,
  );
  process.exit(1);
}
console.log(`      requested: build ${wantBuild} — VALID`);

if (attached.data && attached.data.attributes.version === String(wantBuild)) {
  console.log('\nAlready attached. Nothing to do.');
  process.exit(0);
}

// ─── 3. The open submission ────────────────────────────────────────────
step(3, 'Locating the open review submission');
const subs = await api(
  'GET',
  `/v1/apps/${APP_ID}/reviewSubmissions?filter[state]=WAITING_FOR_REVIEW,READY_FOR_REVIEW&limit=5`,
);
const open = subs.data[0];
console.log(`      ${open ? open.id + ' — ' + open.attributes.state : '(none open)'}`);

if (!commit) {
  console.log('\n─── DRY RUN — nothing was changed ───');
  if (open) plan(`cancel submission ${open.id} (FORFEITS QUEUE POSITION, IRREVERSIBLE)`);
  plan(`re-point ${version.attributes.versionString} to build ${wantBuild}`);
  if (notes) plan(`set release notes for ${Object.keys(notes).join(', ')} from ${notesPath}`);
  plan('create a new submission and submit it');
  console.log('\nRe-run with --commit to apply.');
  process.exit(0);
}

// ─── 4. Cancel ─────────────────────────────────────────────────────────
if (open) {
  step(4, `Cancelling submission ${open.id}`);
  await api('PATCH', `/v1/reviewSubmissions/${open.id}`, {
    data: { type: 'reviewSubmissions', id: open.id, attributes: { canceled: true } },
  });
  console.log('      cancelled');
}

// ─── 5. Re-point the build ─────────────────────────────────────────────
step(5, `Attaching build ${wantBuild}`);
await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, {
  data: { type: 'builds', id: target.id },
});
const recheck = await api(
  'GET',
  `/v1/appStoreVersions/${version.id}/build?fields[builds]=version`,
).catch(() => ({ data: null }));
if (!recheck.data || recheck.data.attributes.version !== String(wantBuild)) {
  console.error(
    `\nSTOPPED: build did not attach (now: ${recheck.data?.attributes.version ?? 'none'}). ` +
      'The submission is cancelled — finish in App Store Connect by hand.',
  );
  process.exit(1);
}
console.log(`      confirmed: build ${wantBuild} attached`);

// ─── 5b. Release notes, while the version is still editable ────────────
// This is the ONLY moment this can happen: submitted versions reject metadata
// writes, and the window closes again at step 6.
if (notes) {
  step('5b', 'Setting release notes');
  const locs = await api(
    'GET',
    `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale`,
  );
  const byLocale = new Map(locs.data.map((l) => [l.attributes.locale, l.id]));

  const unknown = Object.keys(notes).filter((l) => !byLocale.has(l));
  if (unknown.length) {
    // Better to stop than to ship a release where one language silently kept
    // the old copy — a locale typo looks identical to a successful run.
    console.error(
      `\nSTOPPED: no such locale on this version: ${unknown.join(', ')}. ` +
        `Available: ${[...byLocale.keys()].join(', ')}. ` +
        'The submission is cancelled and build ' + wantBuild + ' is attached — ' +
        'fix the notes file and re-run, or submit by hand.',
    );
    process.exit(1);
  }

  for (const [locale, whatsNew] of Object.entries(notes)) {
    const id = byLocale.get(locale);
    await api('PATCH', `/v1/appStoreVersionLocalizations/${id}`, {
      data: { type: 'appStoreVersionLocalizations', id, attributes: { whatsNew } },
    });
    console.log(`      ${locale}: ${whatsNew.split('\n').length} line(s)`);
  }
}

// ─── 6. Resubmit ───────────────────────────────────────────────────────
step(6, 'Creating and submitting a new review submission');
const created = await api('POST', '/v1/reviewSubmissions', {
  data: {
    type: 'reviewSubmissions',
    attributes: { platform: 'IOS' },
    relationships: { app: { data: { type: 'apps', id: APP_ID } } },
  },
});
const newId = created.data.id;

await api('POST', '/v1/reviewSubmissionItems', {
  data: {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: newId } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
    },
  },
});

const submitted = await api('PATCH', `/v1/reviewSubmissions/${newId}`, {
  data: { type: 'reviewSubmissions', id: newId, attributes: { submitted: true } },
});
console.log(`      submission ${newId} — ${submitted.data.attributes.state}`);

console.log(
  `\nDone. ${version.attributes.versionString} is submitted with build ${wantBuild}.` +
    '\nUpdate STATUS.md §1 — the build under review has changed.',
);
