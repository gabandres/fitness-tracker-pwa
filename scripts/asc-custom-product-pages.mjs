#!/usr/bin/env node
/**
 * Creates Custom Product Pages — alternate App Store listings, each at its own
 * URL, with their own screenshots and promotional text.
 *
 * Why bother: ignia.fit already segments traffic by intent (`/vs/macrofactor`
 * is read by someone shopping for an alternative; `/calculator` by someone
 * sizing a target), and today every one of those hands off to the same generic
 * listing. A CPP lets the first frame answer the search that produced the tap.
 * Apple reports referred CPP traffic converting ~2.5 points above the ~1.6%
 * default-page average.
 *
 * What a CPP can and cannot change: screenshots, previews and promotional
 * text, yes; name, subtitle, keywords, description and icon, no — those stay
 * the app's. So the lever here is ORDER and emphasis, which is why each page
 * below is the same five frames rearranged, not new artwork.
 *
 * Usage:
 *   node scripts/asc-custom-product-pages.mjs --dry-run
 *   node scripts/asc-custom-product-pages.mjs
 *
 * Idempotent by page name: an existing page is reported and skipped rather
 * than duplicated. Note that DELETING a page does not release its name —
 * Apple keeps it reserved while the list endpoint stops returning the page,
 * so a name can be both 'unused' and rejected as taken. Pages are left as DRAFTS — submitting them for review is a
 * publishing decision and stays manual.
 *
 * Every line of promo text has to survive the same rule as the main listing:
 * never claim what the build can't back (go-to-market.md §0). No photo scan,
 * no Pro, no trial.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, uploadScreenshot, APP_ID } from './asc-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DISPLAY_TYPE = 'APP_IPHONE_67';

/**
 * `shots` are filenames in store-assets/out/en, in the order they should
 * appear. Order IS the pitch: whichever frame is first has to answer the
 * search that sent the visitor.
 */
const PAGES = [
  {
    name: 'EN · Lifters',
    locale: 'en-US',
    // Leads with the training log because the traffic this serves already
    // knows it wants to lift; the adaptive target is the surprise, second.
    shots: ['02.png', '01.png', '04.png', '03.png', '05.png'],
    promotionalText:
      'Log your sets and your macros in one app. Double progression, plate math and RIR — plus a calorie target that adapts to your real weight trend. Free, no subscription.',
  },
  {
    name: 'EN · Switchers',
    locale: 'en-US',
    // For "[competitor] alternative" traffic: lead with the adaptive maths
    // they are shopping for, then the price, which is the actual differentiator.
    shots: ['01.png', '05.png', '02.png', '04.png', '03.png'],
    promotionalText:
      'Adaptive calorie targets from your own weight trend — the maths you pay for elsewhere, free. Plus a real lifting log and CSV import. No ads, no subscription.',
  },
];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

async function findPage(name) {
  const res = await api('GET', `/v1/apps/${APP_ID}/appCustomProductPages?limit=70`);
  return res.data.find((p) => p.attributes.name === name) ?? null;
}

/**
 * Create page → version → localization in ONE request.
 *
 * Building this up in three sequential POSTs does not work: the page create
 * rejects with "missing a required relationship: appCustomProductPageVersions"
 * because a page cannot exist without a version, and a version cannot be
 * POSTed on its own beforehand. The graph goes up together, with the nested
 * resources declared in `included` and referenced by placeholder ids.
 *
 * (The 409s are also contradictory on the way: the first names
 * appCustomProductPageLocalizations as required, the second says it is not a
 * relationship on the page at all. It belongs to the VERSION, not the page.)
 */
async function createPage(page) {
  const V = '${new-version}';
  const L = '${new-localization}';

  const created = await api('POST', '/v1/appCustomProductPages', {
    data: {
      type: 'appCustomProductPages',
      attributes: { name: page.name },
      relationships: {
        app: { data: { type: 'apps', id: APP_ID } },
        appCustomProductPageVersions: {
          data: [{ type: 'appCustomProductPageVersions', id: V }],
        },
      },
    },
    included: [
      {
        type: 'appCustomProductPageVersions',
        id: V,
        relationships: {
          appCustomProductPageLocalizations: {
            data: [{ type: 'appCustomProductPageLocalizations', id: L }],
          },
        },
      },
      {
        type: 'appCustomProductPageLocalizations',
        id: L,
        attributes: { locale: page.locale },
      },
    ],
  });

  const pageId = created.data.id;

  // Promotional text is set in a follow-up PATCH: the inline create accepts
  // only `locale`, and rejects the whole graph if the localization carries
  // more than that.
  const versions = await api(
    'GET',
    `/v1/appCustomProductPages/${pageId}/appCustomProductPageVersions?limit=1`,
  );
  const locs = await api(
    'GET',
    `/v1/appCustomProductPageVersions/${versions.data[0].id}/appCustomProductPageLocalizations?limit=5`,
  );
  const localizationId = locs.data.find((l) => l.attributes.locale === page.locale).id;

  await api('PATCH', `/v1/appCustomProductPageLocalizations/${localizationId}`, {
    data: {
      type: 'appCustomProductPageLocalizations',
      id: localizationId,
      attributes: { promotionalText: page.promotionalText },
    },
  });

  return { pageId, localizationId };
}

async function screenshotSet(localizationId) {
  const sets = await api(
    'GET',
    `/v1/appCustomProductPageLocalizations/${localizationId}/appScreenshotSets?limit=20`,
  );
  const existing = sets.data.find((s) => s.attributes.screenshotDisplayType === DISPLAY_TYPE);
  if (existing) return existing.id;

  const created = await api('POST', '/v1/appScreenshotSets', {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: DISPLAY_TYPE },
      relationships: {
        appCustomProductPageLocalization: {
          data: { type: 'appCustomProductPageLocalizations', id: localizationId },
        },
      },
    },
  });
  return created.data.id;
}

async function main() {
  const dir = resolve(root, 'store-assets/out/en');

  for (const page of PAGES) {
    const missing = page.shots.filter((s) => !existsSync(join(dir, s)));
    if (missing.length) {
      console.error(`✗ ${page.name}: missing ${missing.join(', ')} — run store-screenshots.mjs`);
      continue;
    }

    console.log(`\n${page.name} (${page.locale})`);
    console.log(`  order: ${page.shots.join(' → ')}`);
    console.log(`  promo: ${page.promotionalText.length}/170 chars`);

    if (dryRun) continue;

    const existing = await findPage(page.name);
    if (existing) {
      console.log(`  already exists (${existing.id}) — skipped`);
      continue;
    }

    let pageId, localizationId;
    try {
      ({ pageId, localizationId } = await createPage(page));
    } catch (e) {
      // A name freed by a delete stays reserved, so this is reachable even
      // when the list endpoint reports no pages at all.
      if (String(e.message).includes('already been used')) {
        console.error(`  ✗ the name "${page.name}" is reserved — pick another`);
        continue;
      }
      throw e;
    }
    const setId = await screenshotSet(localizationId);

    const ids = [];
    for (const [i, shot] of page.shots.entries()) {
      const buffer = readFileSync(join(dir, shot));
      const slug = page.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const fileName = `ignia_${slug}_${String(i + 1).padStart(2, '0')}.png`;
      ids.push(await uploadScreenshot(setId, buffer, fileName));
      console.log(`  ✓ ${shot} → ${fileName}`);
    }

    // Display order is the set relationship order, not upload order.
    await api('PATCH', `/v1/appScreenshotSets/${setId}/relationships/appScreenshots`, {
      data: ids.map((id) => ({ type: 'appScreenshots', id })),
    });
    console.log(`  created ${pageId} — DRAFT, not submitted for review`);
  }

  if (dryRun) console.log('\n(dry run) nothing was created.');
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
