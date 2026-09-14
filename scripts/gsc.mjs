#!/usr/bin/env node
/**
 * Google Search Console, from the command line.
 *
 * Auth is the user's own Application Default Credentials — the same ADC the
 * firebase-admin scripts use, so there is no password anywhere in this flow.
 * It needs scopes beyond the gcloud default:
 *
 *   gcloud auth application-default login --scopes=\
 *     https://www.googleapis.com/auth/cloud-platform,\
 *     https://www.googleapis.com/auth/webmasters,\
 *     https://www.googleapis.com/auth/siteverification
 *
 * Keep cloud-platform in that list or every firebase-admin script breaks.
 *
 * Commands:
 *   node scripts/gsc.mjs status                 which properties exist, and are they verified
 *   node scripts/gsc.mjs verify                 prove ownership of ignia.fit via the deployed HTML token
 *   node scripts/gsc.mjs submit-sitemap         (re)submit https://ignia.fit/sitemap.xml
 *   node scripts/gsc.mjs inspect [url …]        what Google actually thinks of a URL
 *
 * `inspect` is the one worth running regularly: it reports Google's OWN
 * chosen canonical, which is the only way to tell whether a page is indexed
 * on its own merits or was folded into another. Nine URLs on this site used
 * to ship canonical=https://ignia.fit/ and self-declare as homepage
 * duplicates; this is how we find out whether Google noticed the fix.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// The URL space, from the one module that defines it. Node 24 strips
// TypeScript types natively, so these `.ts` modules load here with no build
// step — the same mechanism scripts/prerender-seo.mjs uses, and the reason no
// URL below is spelled out by hand. A slug renamed in the manifest renames
// the URL inspected here; a slug DELETED there fails the assertion below
// loudly rather than reporting "URL is unknown to Google" forever.
import { CALC_VARIANTS, SITE_ORIGIN, VS_PAGES } from '../src/app/seo/seo-routes.ts';
import { ES_PATH_PREFIX } from '../src/app/i18n/locale-path.ts';

const SITE_URL = `${SITE_ORIGIN}/`;
const SITEMAP = `${SITE_ORIGIN}/sitemap.xml`;
const QUOTA_PROJECT = 'fitness-tracker-gb-1775407101';

/** `https://ignia.fit/es/vs/macrofactor` from `('/vs/macrofactor', 'es')`. */
const seoUrl = (path, lang = 'en') =>
  `${SITE_ORIGIN}${lang === 'es' ? ES_PATH_PREFIX : ''}${path}`;

/**
 * A curated sample, not the whole sitemap: `inspect` costs a quota unit per
 * URL and the point is a spot-check, not an audit.
 *
 * These are the calculator variants that used to ship
 * `canonical=https://ignia.fit/` and so self-declared as homepage duplicates
 * (docs/seo-status.md, 2026-07-29) — the URLs where a regression would be
 * invisible and expensive — plus /transformations and one page from each half
 * of the Spanish site, because the /es URLs have no inbound links of their own.
 *
 * Named by manifest KEY rather than by URL so the slugs stay in one place.
 */
const SAMPLE_VARIANT_KEYS = ['cutting', 'protein', 'tdeeWomen', 'weightLoss'];
const SAMPLE_VS_SLUG = 'macrofactor';

function defaultInspect() {
  const bySlug = new Map(CALC_VARIANTS.map((v) => [v.key, v.slug]));
  const missing = SAMPLE_VARIANT_KEYS.filter((k) => !bySlug.has(k));
  if (missing.length || !VS_PAGES.some((v) => v.slug === SAMPLE_VS_SLUG)) {
    throw new Error(
      `gsc.mjs inspect sample is stale: ${[...missing, ...(VS_PAGES.some((v) => v.slug === SAMPLE_VS_SLUG) ? [] : [SAMPLE_VS_SLUG])].join(', ')} ` +
        `no longer in src/app/seo/seo-routes.ts. Pick replacements there.`,
    );
  }
  return [
    ...SAMPLE_VARIANT_KEYS.map((k) => seoUrl(`/${bySlug.get(k)}`)),
    seoUrl('/transformations'),
    seoUrl('/calculator', 'es'),
    seoUrl(`/vs/${SAMPLE_VS_SLUG}`, 'es'),
  ];
}

const DEFAULT_INSPECT = defaultInspect();

function token() {
  // gcloud is a .cmd on Windows, which Node refuses to spawn directly
  // (EINVAL) since it hardened against argument injection. Go through cmd.exe
  // with fixed arguments rather than turning on `shell: true`, which would
  // concatenate them into a string.
  const [bin, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'gcloud', 'auth', 'application-default', 'print-access-token']]
      : ['gcloud', ['auth', 'application-default', 'print-access-token']];
  return execFileSync(bin, args, { encoding: 'utf8' }).trim();
}

async function call(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'x-goog-user-project': QUOTA_PROJECT,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = json?.error?.message ?? text.slice(0, 300);
    // The two failures worth naming, because the generic message is unhelpful.
    if (res.status === 403 && /sufficient permission for site/.test(msg)) {
      throw new Error(`${msg}\n→ the property exists but is unverified: run \`gsc verify\` first.`);
    }
    if (res.status === 403 && /insufficient authentication scopes/i.test(msg)) {
      throw new Error(`${msg}\n→ re-run the gcloud login at the top of this file with all three scopes.`);
    }
    throw new Error(`${method} ${url} → ${res.status}: ${msg}`);
  }
  return json;
}

const WM = 'https://www.googleapis.com/webmasters/v3';
const SV = 'https://www.googleapis.com/siteVerification/v1';

async function status() {
  const sites = await call(`${WM}/sites`);
  for (const s of sites.siteEntry ?? []) {
    console.log(`  ${s.siteUrl.padEnd(34)} ${s.permissionLevel}`);
  }
  const mine = (sites.siteEntry ?? []).find((s) => s.siteUrl === SITE_URL);
  if (!mine) console.log(`\n${SITE_URL} is not on the account.`);
  else if (mine.permissionLevel === 'siteUnverifiedUser') {
    console.log(`\n${SITE_URL} exists but ownership is unproven — run: node scripts/gsc.mjs verify`);
  }
}

/**
 * File-method verification. Google hands back a filename + contents, we write
 * it into public/ — it ships with the next hosting deploy — and then ask
 * Google to look. Requires a deploy in between, which is why this prints
 * instructions rather than pretending to be atomic.
 */
async function verify() {
  const tokenRes = await call(`${SV}/token`, {
    method: 'POST',
    body: {
      verificationMethod: 'FILE',
      site: { type: 'SITE', identifier: SITE_URL },
    },
  });

  const fileName = tokenRes.token;
  const path = `public/${fileName}`;
  writeFileSync(path, `google-site-verification: ${fileName}\n`, 'utf8');
  console.log(`wrote ${path}`);

  const live = await fetch(`${SITE_URL}${fileName}`);
  if (!live.ok) {
    console.log(
      `\n${fileName} is not live yet (HTTP ${live.status}).\n` +
        'Deploy first, then re-run this command:\n' +
        '  npm run build && firebase deploy --only hosting\n' +
        '  node scripts/gsc.mjs verify',
    );
    return;
  }

  await call(`${SV}/webResource?verificationMethod=FILE`, {
    method: 'POST',
    body: { site: { type: 'SITE', identifier: SITE_URL } },
  });
  console.log(`✓ verified ${SITE_URL}`);
}

async function submitSitemap() {
  await call(`${WM}/sites/${encodeURIComponent(SITE_URL)}/sitemaps/${encodeURIComponent(SITEMAP)}`, {
    method: 'PUT',
  });
  const info = await call(
    `${WM}/sites/${encodeURIComponent(SITE_URL)}/sitemaps/${encodeURIComponent(SITEMAP)}`,
  );
  console.log(`✓ submitted ${SITEMAP}`);
  console.log(`  last downloaded: ${info.lastDownloaded ?? 'not yet'}`);
  console.log(`  warnings: ${info.warnings ?? 0} · errors: ${info.errors ?? 0}`);
}

async function inspect(urls) {
  for (const url of urls) {
    try {
      const res = await call('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        method: 'POST',
        body: { inspectionUrl: url, siteUrl: SITE_URL },
      });
      const r = res.inspectionResult.indexStatusResult ?? {};
      console.log(url.replace('https://ignia.fit', ''));
      console.log(`   verdict          ${res.inspectionResult.indexStatusResult?.verdict ?? '—'}`);
      console.log(`   coverage         ${r.coverageState ?? '—'}`);
      // The payoff: if this is not the URL itself, Google folded the page
      // into another one and it earns nothing on its own.
      console.log(`   google canonical ${r.googleCanonical ?? '—'}`);
      console.log(`   declared         ${r.userCanonical ?? '—'}`);
    } catch (e) {
      console.log(`${url}\n   ✗ ${String(e.message).split('\n')[0]}`);
    }
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const run = {
  status,
  verify,
  'submit-sitemap': submitSitemap,
  inspect: () => inspect(rest.length ? rest : DEFAULT_INSPECT),
}[cmd];

if (!run) {
  console.error('Usage: node scripts/gsc.mjs <status|verify|submit-sitemap|inspect [url …]>');
  process.exit(1);
}
run().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
