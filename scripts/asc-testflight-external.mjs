#!/usr/bin/env node
// Put a TestFlight build in front of EXTERNAL testers: add it to the
// "Public Beta Testers" group and open its Beta App Review submission.
//
//   node scripts/asc-testflight-external.mjs --build 64            # dry run: prints state
//   node scripts/asc-testflight-external.mjs --build 64 --commit   # does it
//
// Facts this encodes (learned 2026-09-05, build 63):
// - Adding a build to an external group does NOT ship it. externalBuildState
//   stays READY_FOR_BETA_SUBMISSION until a betaAppReviewSubmission exists,
//   and only IN_BETA_TESTING means a tester can install.
// - A build of a RELEASED App Store version can never go external: ASC answers
//   422 "This version and prior versions are closed for beta review
//   submission". Only the newest unreleased version's build can be added.
// - Beta review is separate from App Store review; a build can be both
//   WAITING_FOR_REVIEW (store) and WAITING_FOR_BETA_REVIEW (TestFlight).
import { api, APP_ID } from './asc-client.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const buildNumber = arg('--build');
const commit = argv.includes('--commit');
if (!buildNumber) { console.error('usage: node scripts/asc-testflight-external.mjs --build <number> [--commit]'); process.exit(2); }

const groups = await api('GET', `/v1/betaGroups?filter[app]=${APP_ID}&fields[betaGroups]=name,isInternalGroup`);
const group = groups.data.find((g) => !g.attributes.isInternalGroup);
if (!group) { console.error('no external beta group on this app'); process.exit(1); }

const builds = await api('GET', `/v1/builds?filter[app]=${APP_ID}&filter[version]=${buildNumber}&fields[builds]=version,processingState&limit=2`);
const build = builds.data[0];
if (!build) { console.error(`build ${buildNumber} not on ASC`); process.exit(1); }
if (build.attributes.processingState !== 'VALID') { console.error(`build ${buildNumber} is ${build.attributes.processingState}, not VALID`); process.exit(1); }

const state = async () => {
  const d = await api('GET', `/v1/builds/${build.id}/buildBetaDetail`);
  const g = await api('GET', `/v1/betaGroups/${group.id}/builds?fields[builds]=version&limit=30`);
  return { external: d.data.attributes.externalBuildState, group: g.data.map((b) => b.attributes.version).join(',') };
};
console.log(`group "${group.attributes.name}" (${group.id}); build ${buildNumber} = ${build.id}`);
let s = await state();
console.log('before', s);
if (!commit) { console.log('dry run — pass --commit'); process.exit(0); }

if (!s.group.split(',').includes(buildNumber)) {
  await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
  console.log('added to group');
}
if (s.external === 'READY_FOR_BETA_SUBMISSION') {
  const r = await api('POST', '/v1/betaAppReviewSubmissions', {
    data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } },
  });
  console.log('beta review submitted:', r.data.attributes.betaReviewState);
}
console.log('after', await state());
