#!/usr/bin/env node
/**
 * Create (or reuse) an App Store version, attach a processed build, set
 * What's New, and submit it for review — the four ASC steps a binary release
 * needs after `eas submit` has delivered the .ipa.
 *
 *   node scripts/asc-release-version.mjs --version 1.2.2 --build 62            # dry run: prints the plan
 *   node scripts/asc-release-version.mjs --version 1.2.2 --build 62 --submit   # does it
 *
 * Rules learned the hard way (STATUS/AGENTS, 2026-08):
 * - An App Store version only accepts builds whose CFBundleShortVersionString
 *   matches its versionString. `--build` is the buildNumber; the script checks
 *   the build's `version` (the marketing string) is the one asked for.
 * - `PROCESSING` is not terminal — refuses anything but `VALID`.
 * - Never touch an IN_REVIEW submission; refuses if one is open.
 * - A review submission is a basket: this opens its own and adds exactly one
 *   item, the app version.
 * - Release type is AFTER_APPROVAL (goes live when Apple approves) unless
 *   `--manual` is passed — the owner asked for nothing left pending.
 */
import { api, APP_ID } from './asc-client.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const versionString = arg('--version');
const buildNumber = arg('--build');
const submit = argv.includes('--submit');
const manual = argv.includes('--manual');
if (!versionString || !buildNumber) {
  console.error('usage: node scripts/asc-release-version.mjs --version 1.2.2 --build 62 [--submit] [--manual]');
  process.exit(2);
}

// 1.2.3 — the wording lives in docs/app-store-metadata.md ("What's New — 1.2.3");
// this copy must match it. 1.2.2's text is in git history (48ab27cc..).
const WHATS_NEW = {
  'en-US':
    '• Reached your goal? One tap on Body switches Ignia to maintenance: your target moves to the calories you have been measured to burn, and the streak nudges go quiet.\n' +
    '• Your calorie target now follows Ignia\'s measured estimate from the first day of measured mode, instead of waiting behind a confidence bar.\n' +
    '• Fixed: the sign-in screen could flash once after an update, even though you were still signed in.\n' +
    '• Fixed: the day still in progress no longer counts as evidence in your maintenance estimate.\n' +
    '• Fixed: redoing onboarding no longer overwrites a measured target.\n' +
    '• Fixed: the Today header could clip at larger text sizes, and a column header in Train wrapped in Spanish.',
  'es-MX':
    '• ¿Llegaste a tu meta? Un toque en Cuerpo cambia Ignia a mantenimiento: tu objetivo pasa a las calorías que se ha medido que quemas, y los recordatorios de racha se callan.\n' +
    '• Tu objetivo de calorías ahora sigue la estimación medida de Ignia desde el primer día del modo medido, en vez de esperar detrás de una barra de confianza.\n' +
    '• Arreglado: la pantalla de inicio de sesión podía aparecer un momento después de una actualización, aunque seguías con la sesión iniciada.\n' +
    '• Arreglado: el día en curso ya no cuenta como evidencia en tu estimación de mantenimiento.\n' +
    '• Arreglado: repetir el onboarding ya no sobrescribe un objetivo medido.\n' +
    '• Arreglado: el encabezado de Hoy podía recortarse con texto grande, y un encabezado de columna en Entrenar se partía en dos líneas en español.',
};

const OPEN = ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES'];

// 1. The build, and it must be VALID and carry the right marketing version.
const builds = await api(
  'GET',
  `/v1/builds?filter[app]=${APP_ID}&filter[version]=${buildNumber}&fields[builds]=version,processingState,uploadedDate&limit=5`,
);
const build = builds.data[0];
if (!build) { console.error(`✗ build ${buildNumber} not found on ASC yet (Apple takes 5–15 min after upload)`); process.exit(1); }
console.log(`build ${buildNumber}: id ${build.id}, ${build.attributes.processingState}, uploaded ${build.attributes.uploadedDate}`);
if (build.attributes.processingState !== 'VALID') { console.error('✗ not VALID yet — wait'); process.exit(1); }
const pre = await api('GET', `/v1/builds/${build.id}/preReleaseVersion?fields[preReleaseVersions]=version`);
const marketing = pre.data?.attributes?.version;
console.log(`build ${buildNumber} marketing version: ${marketing}`);
if (marketing !== versionString) { console.error(`✗ build carries ${marketing}, not ${versionString} — an App Store version only accepts a matching build`); process.exit(1); }

// 2. The version: reuse an editable one with this string, else create it.
const versions = await api(
  'GET',
  `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10&fields[appStoreVersions]=versionString,appStoreState,releaseType`,
);
for (const v of versions.data) console.log(`  version ${v.attributes.versionString}: ${v.attributes.appStoreState} (${v.attributes.releaseType})`);
let version = versions.data.find((v) => v.attributes.versionString === versionString);
if (version && !['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED'].includes(version.attributes.appStoreState)) {
  console.error(`✗ ${versionString} exists in state ${version.attributes.appStoreState} — not editable`); process.exit(1);
}

// 3. Open submissions block everything.
const subs = await api('GET', `/v1/apps/${APP_ID}/reviewSubmissions?limit=20`);
const open = subs.data.filter((s) => OPEN.includes(s.attributes.state));
if (open.length) { console.error(`✗ open review submission(s): ${open.map((s) => `${s.id} ${s.attributes.state}`).join(', ')}`); process.exit(1); }

const releaseType = manual ? 'MANUAL' : 'AFTER_APPROVAL';
console.log(`\nplan: ${version ? 'reuse' : 'create'} ${versionString} (${releaseType}) ← build ${buildNumber}, What's New in ${Object.keys(WHATS_NEW).join(', ')}, then ${submit ? 'SUBMIT' : 'stop (dry run)'}`);
if (!submit) process.exit(0);

if (!version) {
  const created = await api('POST', '/v1/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString, releaseType },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  });
  version = created.data;
  console.log(`created version ${version.id}`);
}
// releaseType, and `usesIdfa: false` set explicitly — 1.2.0 shipped with it
// `null` and ASC did not gate on it (app-store-metadata.md §usesIdfa asked for
// this on the next version). The app has no ad identifier use.
await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
  data: { type: 'appStoreVersions', id: version.id, attributes: { releaseType, usesIdfa: false } },
});

await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
console.log('build attached');

// The cloud derives the live iOS version from Apple's public lookup, which has
// no build number; binaries before 2026-09-05 compare on the build number. This
// is the one moment a machine with the ASC key knows both, so record the
// mapping now (`public/appVersion.iosBuilds`) and the hourly sync promotes it
// when the version goes live. Best-effort: a missing ADC login must not stop a
// submission — the fix is one command, printed below.
try {
  const { recordIosBuild } = await import('./app-version-sync.mjs');
  const r = await recordIosBuild(versionString, buildNumber);
  console.log(`recorded iosBuilds["${r.version}"] = ${r.build}`);
} catch (e) {
  console.warn(`could not record the version→build map (${e.message}); run later:\n  node scripts/app-version-sync.mjs --record-ios-build ${versionString} ${buildNumber}`);
}

// What's New — ASC copies the description etc. from the previous version but
// leaves whatsNew empty, and an empty What's New fails submission.
const locs = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=10`);
for (const l of locs.data) {
  const text = WHATS_NEW[l.attributes.locale];
  if (!text) { console.log(`  ${l.attributes.locale}: no copy in this script — leaving as is`); continue; }
  await api('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, {
    data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: text } },
  });
  console.log(`  ${l.attributes.locale}: What's New set`);
}

const sub = await api('POST', '/v1/reviewSubmissions', {
  data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
});
await api('POST', '/v1/reviewSubmissionItems', {
  data: {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.data.id } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
    },
  },
});
const done = await api('PATCH', `/v1/reviewSubmissions/${sub.data.id}`, {
  data: { type: 'reviewSubmissions', id: sub.data.id, attributes: { submitted: true } },
});
console.log(`SUBMITTED: review submission ${sub.data.id} → ${done.data.attributes.state}`);
