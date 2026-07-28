#!/usr/bin/env node
/**
 * Uploads the composited App Store screenshots through the App Store Connect
 * API, so the set can be regenerated and re-pushed without a browser.
 *
 * Uploading an asset to ASC is a three-step reservation, not a POST of bytes:
 *   1. POST /v1/appScreenshots  — declares fileName + fileSize, and Apple
 *      answers with one or more pre-signed `uploadOperations`
 *   2. PUT each operation's byte range to ITS url (not the API host, and
 *      without the JWT — these are signed URLs and a stray Authorization
 *      header makes them fail)
 *   3. PATCH the screenshot with `uploaded: true` + the MD5 of the whole
 *      file, which is what actually commits it
 * Apple then processes asynchronously; `assetDeliveryState` reaching COMPLETE
 * is the only proof it worked, so this polls rather than assuming.
 *
 * Usage:
 *   node scripts/asc-upload-screenshots.mjs --locale en
 *   node scripts/asc-upload-screenshots.mjs --locale en --dry-run
 *   node scripts/asc-upload-screenshots.mjs --locale en --replace
 *
 * `--replace` deletes the screenshots already in the set first. Without it,
 * uploads are ADDITIVE — a set that already holds the old artwork ends up
 * with both, in an order nobody chose. Apple caps a set at 10.
 *
 * The 6.9" display slot is `APP_IPHONE_67` in the API. That is not a typo:
 * the 6.7" enum absorbed the 6.9" sizes rather than gaining an APP_IPHONE_69,
 * verified against the live listing.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, uploadChunk, APP_ID } from './asc-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DISPLAY_TYPE = 'APP_IPHONE_67';
/** Our locale directory names → App Store Connect locale codes. ASC has no
 *  es-PR, so the Spanish listing is filed as es-MX (see go-to-market.md §5). */
const ASC_LOCALE = { en: 'en-US', es: 'es-MX' };

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const locale = arg('locale');
const dryRun = has('dry-run');
const replace = has('replace');

if (!locale || !ASC_LOCALE[locale]) {
  console.error(`Usage: --locale <${Object.keys(ASC_LOCALE).join('|')}> [--dry-run] [--replace]`);
  process.exit(1);
}

const dir = resolve(root, 'store-assets/out', locale);
if (!existsSync(dir)) {
  console.error(`No composited frames at store-assets/out/${locale}/ — run store-screenshots.mjs first.`);
  process.exit(1);
}
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
if (!files.length) {
  console.error(`store-assets/out/${locale}/ is empty.`);
  process.exit(1);
}

/** The version being edited: the one that is not already on sale. */
async function targetVersion() {
  const res = await api('GET', `/v1/apps/${APP_ID}/appStoreVersions?limit=10`);
  const editable = res.data.find((v) => v.attributes.appStoreState !== 'READY_FOR_SALE');
  if (!editable) throw new Error('No editable version — every version is READY_FOR_SALE.');
  return editable;
}

async function screenshotSet(versionId, ascLocale) {
  const locs = await api(
    'GET',
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=20`,
  );
  const loc = locs.data.find((l) => l.attributes.locale === ascLocale);
  if (!loc) throw new Error(`Version has no ${ascLocale} localization.`);

  const sets = await api(
    'GET',
    `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=20`,
  );
  const existing = sets.data.find((s) => s.attributes.screenshotDisplayType === DISPLAY_TYPE);
  if (existing) return existing.id;

  const created = await api('POST', '/v1/appScreenshotSets', {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: DISPLAY_TYPE },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: loc.id },
        },
      },
    },
  });
  return created.data.id;
}

async function upload(setId, file) {
  const buffer = readFileSync(join(dir, file));
  const fileName = `ignia_${locale}_${file}`;

  const reservation = await api('POST', '/v1/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileSize: buffer.length, fileName },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
    },
  });

  const id = reservation.data.id;
  for (const op of reservation.data.attributes.uploadOperations) {
    await uploadChunk(op, buffer.subarray(op.offset, op.offset + op.length));
  }

  await api('PATCH', `/v1/appScreenshots/${id}`, {
    data: {
      type: 'appScreenshots',
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: createHash('md5').update(buffer).digest('hex'),
      },
    },
  });
  return { id, fileName };
}

/** Apple processes asynchronously; anything other than COMPLETE means the
 *  frame will not appear, so failing loudly here beats a silent gap. */
async function waitForDelivery(id, fileName) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await api('GET', `/v1/appScreenshots/${id}`);
    const state = res.data.attributes.assetDeliveryState;
    if (state?.state === 'COMPLETE') return true;
    if (state?.errors?.length) {
      console.error(`  ✗ ${fileName}: ${state.errors.map((e) => e.description).join('; ')}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.warn(`  ! ${fileName}: still processing after 60s — check App Store Connect`);
  return false;
}

async function main() {
  const version = await targetVersion();
  const ascLocale = ASC_LOCALE[locale];
  console.log(
    `version ${version.attributes.versionString} (${version.attributes.appStoreState}) · ${ascLocale}`,
  );

  const setId = await screenshotSet(version.id, ascLocale);
  const current = await api('GET', `/v1/appScreenshotSets/${setId}/appScreenshots?limit=20`);

  console.log(`set ${setId} holds ${current.data.length} screenshot(s)`);
  for (const s of current.data) console.log(`  existing: ${s.attributes.fileName}`);
  console.log(`uploading ${files.length}: ${files.join(', ')}`);

  if (current.data.length + files.length > 10 && !replace) {
    console.error(
      `\nRefusing: ${current.data.length} existing + ${files.length} new exceeds Apple's cap of 10.\n` +
        'Pass --replace to delete the existing ones first.',
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n(dry run) nothing was uploaded.');
    return;
  }

  if (replace) {
    for (const s of current.data) {
      await api('DELETE', `/v1/appScreenshots/${s.id}`);
      console.log(`  deleted ${s.attributes.fileName}`);
    }
  }

  const uploaded = [];
  for (const file of files) {
    const { id, fileName } = await upload(setId, file);
    const ok = await waitForDelivery(id, fileName);
    console.log(`  ${ok ? '✓' : '✗'} ${file} → ${fileName}`);
    if (ok) uploaded.push(id);
  }

  // Display order is the set's relationship order, not upload order or file
  // name — without this the pitch can land shuffled.
  if (uploaded.length) {
    await api('PATCH', `/v1/appScreenshotSets/${setId}/relationships/appScreenshots`, {
      data: uploaded.map((id) => ({ type: 'appScreenshots', id })),
    });
    console.log(`\n✓ ${uploaded.length} screenshot(s) live on the ${ascLocale} listing, in order`);
  }
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
