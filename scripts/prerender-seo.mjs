#!/usr/bin/env node
/**
 * Build-time prerender for the public SEO routes. The SPA shell ships
 * one index.html with the homepage's <title>, <meta description>, and
 * <link rel="canonical">; without per-URL overrides, Google sees 38
 * duplicates of the homepage and indexes none of them.
 *
 * For each programmatic URL we copy the shell, rewrite a small
 * whitelist of <head> tags (title, description, canonical, og:*,
 * twitter:*), and write the result alongside the SPA in dist/. The
 * <body> is untouched so Angular hydration still works exactly as on
 * the homepage.
 *
 * `cleanUrls: true` in firebase.json maps `/macros/lose/180-lb` to the
 * generated `macros/lose/180-lb.html` (Firebase Hosting tries the file
 * extension before falling through to the SPA rewrite).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist/fitness-tracker-pwa/browser');
const shell = readFileSync(resolve(dist, 'index.html'), 'utf8');
const i18n = JSON.parse(readFileSync(resolve(root, 'src/app/i18n/en.json'), 'utf8'));

const SITE = 'https://macrolog.web.app';

const KCAL = { lose: 11, maintain: 14, gain: 17 };
const PROT = { lose: 1.0, maintain: 0.9, gain: 0.8 };
const computeKcal = (w, g) => Math.round((w * KCAL[g]) / 10) * 10;
const computeProtein = (w, g) => Math.round((w * PROT[g]) / 5) * 5;

const interp = (str, vars) =>
  str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));

/** Replace, or insert before </head> if no match. Robust to attribute
 *  order. The shell uses double-quoted attributes throughout. */
function replaceHeadTag(html, regex, replacement) {
  if (regex.test(html)) return html.replace(regex, replacement);
  return html.replace('</head>', `    ${replacement}\n  </head>`);
}

function rewrite(html, { title, description, canonical, ogImage, jsonLd }) {
  let out = html;
  out = replaceHeadTag(out, /<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`);
  out = replaceHeadTag(
    out,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${escape(description)}" />`,
  );
  out = replaceHeadTag(
    out,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${canonical}" />`,
  );
  out = replaceHeadTag(
    out,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${escape(title)}" />`,
  );
  out = replaceHeadTag(
    out,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${escape(description)}" />`,
  );
  out = replaceHeadTag(
    out,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${canonical}" />`,
  );
  if (ogImage) {
    out = replaceHeadTag(
      out,
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${ogImage}" />`,
    );
  }
  out = replaceHeadTag(
    out,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${escape(title)}" />`,
  );
  out = replaceHeadTag(
    out,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${escape(description)}" />`,
  );
  // Insert per-page JSON-LD just before </head>. Kept as an extra
  // script alongside the SPA's existing SoftwareApplication block,
  // not a replacement — Google merges multiple JSON-LD blobs per page.
  if (jsonLd) {
    const blobs = (Array.isArray(jsonLd) ? jsonLd : [jsonLd])
      .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
      .join('\n    ');
    out = out.replace('</head>', `    ${blobs}\n  </head>`);
  }
  return out;
}

function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

function escape(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function writeRoute(relPath, html) {
  const out = resolve(dist, relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
}

const routes = [];

// /calculator
routes.push({
  file: 'calculator.html',
  title: i18n.calculator.pageTitle,
  description:
    'Free macro calculator: enter your weight, pick lose / maintain / gain, get a daily calorie + protein target you can act on today. No sign-up required.',
  canonical: `${SITE}/calculator`,
  jsonLd: breadcrumb([
    { name: 'Home', url: `${SITE}/` },
    { name: 'Macro calculator', url: `${SITE}/calculator` },
  ]),
});

// /macros/<goal>/<weight>-lb — enumerate from sitemap-aligned ranges
const RANGES = {
  lose:     [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260],
  maintain: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230],
  gain:     [120, 130, 140, 150, 160, 170, 180, 190, 200],
};

for (const goal of Object.keys(RANGES)) {
  for (const weight of RANGES[goal]) {
    const kcal = computeKcal(weight, goal);
    const protein = computeProtein(weight, goal);
    const title = interp(i18n.macrosPage.title[goal], { weight });
    const description = interp(i18n.macrosPage.explainer[goal], { weight, kcal, protein }).slice(0, 320);
    const url = `${SITE}/macros/${goal}/${weight}-lb`;
    routes.push({
      file: `macros/${goal}/${weight}-lb.html`,
      title,
      description,
      canonical: url,
      jsonLd: [
        breadcrumb([
          { name: 'Home', url: `${SITE}/` },
          { name: 'Macro calculator', url: `${SITE}/calculator` },
          { name: title.replace(' | Macro Log', ''), url },
        ]),
        // Lightweight WebPage signal so the URL is recognised as a
        // standalone page, not a homepage duplicate. Includes the
        // computed kcal/protein targets as structured facts so future
        // featured-snippet / answer-box eligibility has data to match
        // against the page's user-visible numbers.
        {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          description,
          url,
          inLanguage: 'en',
          isPartOf: { '@type': 'WebSite', name: 'Macro Log', url: `${SITE}/` },
          about: {
            '@type': 'Thing',
            name: `Daily macro targets for ${weight} lb (${goal})`,
            description: `${kcal} kcal/day, ${protein} g protein/day`,
          },
        },
      ],
    });
  }
}

let written = 0;
for (const r of routes) {
  writeRoute(r.file, rewrite(shell, r));
  written++;
}
console.log(`prerender-seo: wrote ${written} static SEO pages`);
