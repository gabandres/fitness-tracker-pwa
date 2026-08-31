#!/usr/bin/env node
/**
 * Build-time prerender for the public SEO routes, in both locales.
 *
 * The SPA shell ships one index.html with the homepage's <title>, <meta
 * description>, and <link rel="canonical">; without per-URL overrides,
 * Google sees dozens of duplicates of the homepage and indexes none of
 * them.
 *
 * For each programmatic URL we copy the shell, rewrite a small whitelist
 * of <head> tags (title, description, canonical, hreflang, og:*,
 * twitter:*), and write the result alongside the SPA in dist/. The
 * <body> is untouched so Angular hydration still works exactly as on
 * the homepage.
 *
 * `cleanUrls: true` in firebase.json maps `/macros/lose/180-lb` to the
 * generated `macros/lose/180-lb.html` (Firebase Hosting tries the file
 * extension before falling through to the SPA rewrite).
 *
 * ─── Spanish ───────────────────────────────────────────────────────
 * Every route is emitted twice: English at its bare path, Spanish under
 * an `/es` prefix, each declaring the other via `rel="alternate"
 * hreflang`. es-PR is one of the three stated wedges (docs/go-to-market.md
 * §1.3) and the app is fully translated, so shipping only English URLs
 * left the least-competitive market with nothing to index.
 *
 * The prefix is a *routing* concern too, not just a meta one — two
 * places in the app must agree with this file:
 *   - `detectRoute()` in src/app/app.ts strips the prefix before matching
 *   - `resolveInitial()` in src/app/services/translation.service.ts reads
 *     it so an /es/ URL actually renders Spanish
 *
 * hreflang is `es` (not `es-PR`): the copy is Puerto Rican, but the
 * competition is thin across all of Spanish and a region-locked tag
 * would exclude every other Spanish-speaking searcher.
 *
 * This script also emits `sitemap.xml`, which is why there is no longer
 * one in public/ — 120+ hand-maintained URLs across two locales drift
 * from the routes they describe within one release.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The comparison table's own source of truth, imported rather than restated.
// Node 24 strips TypeScript types natively, so a `.ts` data module is
// importable from a plain `.mjs` build script with no compile step — which is
// what keeps the prerendered table and the rendered table the same table.
// If this ever moves to a Node without type stripping, the fix is a build
// step, NOT a second copy of the data.
import { VS_PROFILES } from '../src/app/components/vs-page/vs-data.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist/fitness-tracker-pwa/browser');
const shell = readFileSync(resolve(dist, 'index.html'), 'utf8');
const readI18n = (f) => JSON.parse(readFileSync(resolve(root, 'src/app/i18n', f), 'utf8'));

const SITE = 'https://ignia.fit';

const KCAL = { lose: 11, maintain: 14, gain: 17 };
// Protein: g/kg standard, 1.6 g/kg default (muscle-retention floor on a cut).
// Keep in sync with src/app/utils/macro-heuristic.ts.
const PROTEIN_G_PER_KG = 1.6;
const computeKcal = (w, g) => Math.round((w * KCAL[g]) / 10) * 10;
const computeProtein = (w) => Math.round(((w / 2.20462) * PROTEIN_G_PER_KG) / 5) * 5;

const interp = (str, vars) =>
  str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));

/**
 * The locales this site is indexed in. `prefix` is the URL segment,
 * `htmlLang` goes on <html lang> (the app's own runtime value), and
 * `hreflang` is the broader search-targeting tag.
 */
const LOCALES = [
  { lang: 'en', prefix: '', htmlLang: 'en', hreflang: 'en', ogLocale: 'en_US', i18n: readI18n('en.json') },
  { lang: 'es', prefix: '/es', htmlLang: 'es-PR', hreflang: 'es', ogLocale: 'es_PR', i18n: readI18n('es-PR.json') },
];

/**
 * Meta descriptions, which are SEO copy rather than app copy and so do
 * not belong in the Transloco bundles the app ships to every user.
 * Titles DO come from i18n — they are the same strings the page shows.
 */
const COPY = {
  en: {
    home: 'A quiet, private log for the one question that matters — calories, protein, weight, fasting — with an AI coach that actually reads your data. Free on iPhone today; coming soon to Google Play. No ads. No selling. Ever.',
    calculator:
      'Free macro calculator: enter your weight, pick lose / maintain / gain, get a daily calorie + protein target you can act on today. No sign-up required.',
    vs: (name) =>
      `Honest, side-by-side comparison of Ignia and ${name}. Where each one wins, where it loses, and which to pick for which job.`,
    faq: 'Straight answers on macros, calorie targets, fat loss pace, and how Ignia works. No clickbait, no upsell.',
    home_title: 'Ignia — how many calories do I have left today?',
    crumbHome: 'Home',
    crumbCalculator: 'Macro calculator',
    crumbComparisons: 'Comparisons',
    crumbFaq: 'FAQ',
    macrosAbout: (weight, goal) => `Daily macro targets for ${weight} lb (${goal})`,
    privacy:
      'What Ignia stores, what it never collects, and how to delete your account and data. No ads, no data selling, no cross-site tracking.',
    terms: 'The terms you agree to when you use Ignia. Plain language, no dark patterns.',
    changelog: 'Every significant change to Ignia, newest first — what shipped and when.',
    status: "Live health of the services behind Ignia, refreshed automatically.",
    // Footer link graph.
    navCalculators: 'Calculators',
    navComparisons: 'Compare',
    navTargets: 'Macro targets',
    navProduct: 'Ignia',
    navLegal: 'Legal',
    navSiteMap: 'Site map',
    navHome: 'Home',
    navDownload: 'Get the iPhone app',
    navSupport: 'Support',
    navTransformations: 'Transformations',
    navAllWeights: 'All weights',
    goalLabel: { lose: 'Lose', maintain: 'Maintain', gain: 'Gain' },
    otherLang: 'English',
  },
  es: {
    home: 'Una bitácora tranquila y privada para la única pregunta que importa: calorías, proteína, peso y ayuno, con un coach de IA que de verdad lee tus datos. Gratis en iPhone hoy; pronto en Google Play. Sin anuncios. Sin vender datos. Nunca.',
    calculator:
      'Calculadora de macros gratis: pon tu peso, elige bajar / mantener / subir y recibe una meta diaria de calorías y proteína que puedes usar hoy. Sin registro.',
    vs: (name) =>
      `Comparación honesta y lado a lado entre Ignia y ${name}. En qué gana cada una, en qué pierde y cuál te conviene.`,
    faq: 'Respuestas directas sobre macros, metas de calorías, ritmo de pérdida de grasa y cómo funciona Ignia. Sin relleno y sin venta.',
    home_title: 'Ignia — ¿cuántas calorías me quedan hoy?',
    crumbHome: 'Inicio',
    crumbCalculator: 'Calculadora de macros',
    crumbComparisons: 'Comparaciones',
    crumbFaq: 'Preguntas frecuentes',
    macrosAbout: (weight, goal) => `Metas diarias de macros para ${weight} lb (${goal})`,
    privacy:
      'Qué guarda Ignia, qué nunca recoge y cómo borrar tu cuenta y tus datos. Sin anuncios, sin venta de datos, sin rastreo entre sitios.',
    terms: 'Los términos que aceptas al usar Ignia. En lenguaje claro y sin trampas.',
    changelog: 'Cada cambio importante en Ignia, del más reciente al más viejo.',
    status: 'Estado en vivo de los servicios detrás de Ignia, actualizado automáticamente.',
    // Footer link graph.
    navCalculators: 'Calculadoras',
    navComparisons: 'Comparar',
    navTargets: 'Metas de macros',
    navProduct: 'Ignia',
    navLegal: 'Legal',
    navSiteMap: 'Mapa del sitio',
    navHome: 'Inicio',
    navDownload: 'Consigue la app de iPhone',
    navSupport: 'Soporte',
    navTransformations: 'Transformaciones',
    navAllWeights: 'Todos los pesos',
    goalLabel: { lose: 'Bajar', maintain: 'Mantener', gain: 'Subir' },
    otherLang: 'Español',
  },
};

/**
 * Calculator variants — the same component under intent-specific URLs.
 * `key` indexes `calcVariants.<key>` in the i18n bundles; `slug` must match
 * VARIANT_PATHS in src/app/components/calculator/calculator.component.ts.
 *
 * These were in the sitemap but NOT prerendered, which was worse than being
 * absent: they served the shell, so every one of them declared
 * `canonical=https://ignia.fit/` and told Google it was a duplicate of the
 * homepage. Nothing repairs that at runtime — the app sets a title, but no
 * code anywhere writes a canonical tag.
 */
const CALC_VARIANTS = [
  { slug: 'tdee-calculator-women', key: 'tdeeWomen', priority: 0.9 },
  { slug: 'tdee-calculator-men', key: 'tdeeMen', priority: 0.9 },
  { slug: 'cutting-calculator', key: 'cutting', priority: 0.85 },
  { slug: 'bulking-calculator', key: 'bulking', priority: 0.85 },
  { slug: 'maintenance-calculator', key: 'maintenance', priority: 0.7 },
  { slug: 'keto-macro-calculator', key: 'keto', priority: 0.85 },
  { slug: 'weight-loss-calculator', key: 'weightLoss', priority: 0.9 },
  { slug: 'protein-calculator', key: 'protein', priority: 0.85 },
];

/** Comparison landings. Mirrors the slug list in
 *  src/app/components/vs-page/vs-data.ts — keep them in sync. */
const VS = [
  { slug: 'myfitnesspal', name: 'MyFitnessPal', priority: 0.8 },
  { slug: 'loseit', name: 'Lose It!', priority: 0.8 },
  { slug: 'cronometer', name: 'Cronometer', priority: 0.7 },
  { slug: 'macrofactor', name: 'MacroFactor', priority: 0.8 },
  { slug: 'calai', name: 'Cal AI', priority: 0.7 },
];

/** /macros/<goal>/<weight>-lb — enumerated, one page per bracket. */
const RANGES = {
  lose:     [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260],
  maintain: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230],
  gain:     [120, 130, 140, 150, 160, 170, 180, 190, 200],
};
const MACROS_PRIORITY = { lose: 0.7, maintain: 0.6, gain: 0.6 };

/** hreflang pair for a page that exists as two hand-written files rather than
 *  two generated routes. Same shape the route table produces, so the sitemap
 *  can't tell the difference. */
const staticPair = (enPath, esPath) => [
  { hreflang: 'en', url: `${SITE}${enPath}` },
  { hreflang: 'es', url: `${SITE}${esPath}` },
];

/**
 * URLs that belong in the sitemap but are not prerendered here: static files
 * served straight from public/ (`/download`, `/support`) and SPA views with
 * nothing to say per-URL (`/privacy`, `/status`, …).
 *
 * `/download` and `/support` are the two **conversion** pages, and they are
 * hand-written HTML rather than shell rewrites — the pipeline above only
 * rewrites <head>, it cannot produce their bodies. They are bilingual as of
 * 2026-07-29: `public/es/{download,support}.html` are the Spanish versions,
 * and the pairs are declared here so a Spanish visitor is not handed an
 * English page at the one step that matters. The `<link rel="alternate">`
 * tags in those four files must agree with these pairs.
 *
 * Anything with per-URL copy belongs in the route table above instead, or it
 * ships the shell's canonical and self-declares as a homepage duplicate.
 */
const SITEMAP_ONLY = [
  {
    path: '/download',
    changefreq: 'monthly',
    priority: 0.9,
    alternates: staticPair('/download', '/es/download'),
  },
  {
    path: '/es/download',
    changefreq: 'monthly',
    priority: 0.9,
    alternates: staticPair('/download', '/es/download'),
  },
  {
    path: '/support',
    changefreq: 'monthly',
    priority: 0.5,
    alternates: staticPair('/support', '/es/support'),
  },
  {
    path: '/es/support',
    changefreq: 'monthly',
    priority: 0.5,
    alternates: staticPair('/support', '/es/support'),
  },
];

/**
 * SPA views that have per-URL copy and now get a prerendered file each, in
 * both locales, instead of the shell.
 *
 * They used to sit in `SITEMAP_ONLY` above — which is precisely the failure
 * that block's own comment warns about. Measured 2026-08-17: `/privacy`,
 * `/terms`, `/changelog` and `/status` each served the homepage's `<title>`
 * and `canonical=https://ignia.fit/`, so all four told Google they were
 * duplicates of the homepage and none could ever be indexed on its own. That
 * is the same defect `docs/seo-status.md` records as fixed for nine other
 * URLs on 2026-07-29; these four were missed because they were listed as
 * having "nothing to say per-URL", and they do. `/privacy` is also the URL
 * Apple requires and `/terms` the one the App Store listing points at.
 *
 * The Spanish halves were not in the sitemap at all before this.
 */
const SHELL_PAGES = [
  { key: '/privacy', i18nKey: 'privacy', copyKey: 'privacy', changefreq: 'monthly', priority: 0.5 },
  { key: '/terms', i18nKey: 'terms', copyKey: 'terms', changefreq: 'monthly', priority: 0.5 },
  { key: '/changelog', i18nKey: 'changelog', copyKey: 'changelog', changefreq: 'weekly', priority: 0.6 },
  { key: '/status', i18nKey: 'status', copyKey: 'status', changefreq: 'always', priority: 0.4 },
];

// ─── Head rewriting ────────────────────────────────────────────────────

/** Replace, or insert before </head> if no match. Robust to attribute
 *  order. The shell uses double-quoted attributes throughout. */
function replaceHeadTag(html, regex, replacement) {
  if (regex.test(html)) return html.replace(regex, replacement);
  return html.replace('</head>', `    ${replacement}\n  </head>`);
}

function rewrite(html, route, alternates) {
  const { title, description, canonical, ogImage, jsonLd, locale } = route;
  let out = html;

  // <html lang> — the app resets this at runtime, but a crawler that
  // never executes the bundle reads whatever the served file says.
  out = out.replace(/<html\s+lang="[^"]*"/, `<html lang="${locale.htmlLang}"`);

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

  // Reciprocal hreflang. Both language versions must list BOTH URLs or
  // Google ignores the pair entirely; x-default points at English.
  //
  // The shell carries the HOMEPAGE's alternates (index.html is itself the
  // English `/`), so they are dropped before this page's are added —
  // otherwise every generated file would claim two conflicting sets.
  out = out.replace(/\s*<link\s+rel="alternate"\s+hreflang="[^"]*"[^>]*>/g, '');
  if (alternates?.length) {
    const links = alternates
      .map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.url}" />`)
      .concat(
        alternates
          .filter((a) => a.hreflang === 'en')
          .map((a) => `<link rel="alternate" hreflang="x-default" href="${a.url}" />`),
      )
      .join('\n    ');
    out = out.replace('</head>', `    ${links}\n  </head>`);
  }

  out = replaceHeadTag(
    out,
    /<meta\s+property="og:locale"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:locale" content="${locale.ogLocale}" />`,
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

// ─── Body injection ────────────────────────────────────────────────────
//
// WHY. Measured 2026-08-17: 110 of 114 sitemap URLs were *unknown to Google*
// and the sitemap had never been downloaded. The cause is that "prerendered"
// here means the <head> only — the body a first-pass crawler receives is
// literally `<app-root></app-root>`, with no heading, no copy and no links.
// Nothing on the site was crawlable without executing the bundle, and a
// domain with 4 impressions in 90 days gets no render budget to spend.
//
// This is the floor, not real prerendering: it puts a genuine link graph and
// a genuine text fallback into the served HTML without SSR and without any
// runtime risk to the app. Two pieces, deliberately different:
//
//   - a VISIBLE <footer> of links. Outside <app-root>, so Angular never
//     touches it and it survives hydration — which is what makes the link
//     graph permanent rather than a first-pass artefact. These marketing
//     pages render one or two links of their own today, so it is also the
//     navigation they were missing.
//   - a <noscript> heading + description. Honest fallback: without JS these
//     pages say nothing but "Please enable JavaScript", so this is a real
//     improvement for a real reader. It is not hidden text — it renders for
//     anyone who has JS off, and it says exactly what the page says.
//
// The shell (`index.html`) takes the same link graph, but ONLY inside
// <noscript> (see the injection after the route loop below). It also serves
// `/admin` and the retired SPA routes through the hosting catch-all, so
// nothing VISIBLE may be injected into it — but since ADR-0036 there is no
// logged-in app behind that catch-all, and leaving `/` linkless meant the
// crawl had no entry point at all: measured 2026-08-30, 117 of 118 sitemap
// URLs were unreachable by <a href> from `/`, because every prerendered page
// links out but nothing linked INTO the graph from the root.

const FOOTER_STYLE = `<style>
  .ig-sm{border-top:1px solid #e7e5e2;background:#faf9f6;color:#57534e;
    font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    padding:40px 24px 48px}
  .ig-sm__in{max-width:1040px;margin:0 auto;display:flex;flex-wrap:wrap;gap:32px}
  .ig-sm h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#57534e;
    margin:0 0 10px;font-weight:700}
  .ig-sm ul{list-style:none;margin:0;padding:0;min-width:150px}
  .ig-sm li{margin:0 0 6px}
  .ig-sm a{color:#57534e;text-decoration:none}
  .ig-sm a:hover{color:#c62f27;text-decoration:underline}
  .ig-sm__foot{max-width:1040px;margin:28px auto 0;padding-top:16px;
    border-top:1px solid #e7e5e2;font-size:12px}
  @media (prefers-color-scheme:dark){
    .ig-sm{background:#131210;border-color:#2b2822;color:#b3ada3}
    .ig-sm h2{color:#b3ada3}
    .ig-sm a{color:#b3ada3}
    .ig-sm a:hover{color:#ff8a5c}
    .ig-sm__foot{border-color:#2b2822}
  }
</style>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const li = (href, label) => `<li><a href="${href}">${esc(label)}</a></li>`;

/** "Privacy — Ignia" → "Privacy". The i18n `pageTitle` values do not agree on
 *  a separator — some use `·`, some an em dash, `/faq` uses `|` — so match
 *  all of them rather than the one that happened to be checked first. */
const stripBrand = (t) => String(t).replace(/\s*[|·—–-]\s*Ignia\s*$/, '').trim();

// ─── Page CONTENT for the no-JS/first-pass body ────────────────────────
//
// WHY THIS EXISTS, and why it is not the same job as the footer above.
//
// The 2026-08-17 measurement found the link graph missing AND the copy
// missing. The footer fixed the first: 1 internal link per page became 32, so
// the 118 URLs form a graph. It did nothing about the second — what a
// first-pass crawler read was still a title, a one-line description and a list
// of links, on every page, with the actual content of the page reachable only
// by executing the bundle.
//
// A page whose crawlable text is its own <title> restated is a thin page, and
// thin is a worse verdict than unknown: unknown gets recrawled, thin gets
// dropped. So each content route now ships its REAL copy in the served HTML.
//
// Two rules hold this honest, and both matter more than the markup:
//
//   1. **One source, never a copy.** Every string below is read from the same
//      place the component renders it from — the i18n bundles, and `vs-data.ts`
//      for the comparison table. Nothing here is retyped prose. A copy edit
//      lands in both surfaces or in neither, which is the only version of this
//      that survives contact with a translator.
//   2. **Inside <noscript>.** Anyone with JS gets the app, byte for byte as
//      before; nobody sees a flash of static copy under the SPA, and there is
//      no second visible body to keep in sync. It is the same text the page
//      renders, so it is a fallback, not a cloak.
//
// This is still not SSR. `/calculator` cannot compute in a <noscript> block and
// `/transformations` has nothing to say until Firestore answers. What it does
// is stop the content pages being empty, which is the half of the 2026-08-17
// finding the footer left open.

const h2 = (s) => `<h2 style="font-size:17px;margin:18px 0 6px">${esc(s)}</h2>`;
const para = (s) => `<p style="margin:0 0 8px">${esc(s)}</p>`;

/**
 * A paragraph whose source string is ALREADY HTML, emitted unescaped.
 *
 * `/privacy` and `/terms` are authored with inline markup — `<strong>`, `<em>`,
 * `<br>` and `mailto:` links — and the components render them through Angular's
 * `[innerHTML]`. Escaping them here would print `<strong>Export</strong>` as
 * visible text on the two pages Apple and Google require to be readable, and
 * would put raw tags into the indexed copy. So these strings pass through.
 *
 * That is safe for exactly one reason and it is worth stating: this is
 * build-time content from the repo's own i18n bundles, not user input. Nothing
 * reaches this function at runtime and nothing reaches it from Firestore. If a
 * future page ever renders user-supplied copy, it must use `para`, not this.
 */
const rawPara = (s) => `<p style="margin:0 0 8px">${s}</p>`;

/**
 * The ordered content sections of the two legal pages, as
 * `[headingKey, [bodyKey, ...]]`.
 *
 * Enumerated rather than pattern-matched. Both files interleave prose with
 * UI-control labels ("Export", "Cancel", `deleteButton`) that must not be
 * rendered as page copy, and no length or prefix rule separates the two
 * cleanly — `dontAds` is 17 characters of real content and `deleteButton` is
 * 17 characters of button. `assertLegalCoverage` below fails the build when a
 * new section is added to i18n and not to this table, so being explicit here
 * costs a line per section and cannot go quietly stale.
 *
 * These are the two URLs Apple and Google require to be live and readable
 * (`/privacy` for App Review, `/terms` for the listing), which is why they are
 * the first pages that had to stop being empty.
 */
const LEGAL_SECTIONS = {
  privacy: [
    ['storeHeading', ['storeBody1', 'storeBody2']],
    ['healthHeading', ['healthBody']],
    ['geminiHeading', ['geminiIntro', 'geminiPhoto', 'geminiCoach']],
    ['dontHeading', ['dontSell', 'dontAds', 'dontTrain', 'dontShare']],
    ['callHeading', ['callExport', 'callFullExport', 'callDelete', 'callQuestions']],
    ['deleteStepsHeading', [
      'deleteStepsIntro', 'deleteStepsApp', 'deleteStepsWeb', 'deleteStepsNoAccess',
      'deleteWhat', 'deleteRetention',
    ]],
    ['gdprHeading', [
      'gdprBody', 'gdprAccess', 'gdprRectify', 'gdprErase',
      'gdprPortable', 'gdprRestrict', 'gdprObject',
    ]],
    ['ccpaHeading', ['ccpaBody']],
    ['jurisdictionHeading', ['jurisdictionBody']],
    ['medicalHeading', ['medicalBody']],
  ],
  terms: [
    ['dealHeading', ['dealBody']],
    ['medHeading', ['medBody']],
    ['dataHeading', ['dataBody']],
    ['availHeading', ['availBody']],
    ['liabilityHeading', ['liabilityBody']],
    ['arbHeading', ['arbBody']],
    ['lawHeading', ['lawBody']],
    ['subsHeading', ['subsBody']],
    ['refundsHeading', ['refundsBody']],
    ['contactHeading', ['contactBody']],
  ],
};

/** Fail the build if i18n grew a legal section this table does not know about.
 *  A silently-dropped section on `/privacy` is a compliance page that is
 *  complete in the app and incomplete to a crawler — exactly the kind of drift
 *  nothing else here would report. */
function assertLegalCoverage(locale) {
  for (const [page, table] of Object.entries(LEGAL_SECTIONS)) {
    const known = new Set(table.map(([h]) => h));
    const missing = Object.keys(locale.i18n[page] ?? {})
      .filter((k) => k.endsWith('Heading') && !known.has(k));
    if (missing.length) {
      throw new Error(
        `prerender-seo: ${locale.lang} ${page} has section heading(s) not in ` +
        `LEGAL_SECTIONS: ${missing.join(', ')}. Add them (with their body keys) ` +
        `so the prerendered page carries the same sections the app renders.`,
      );
    }
  }
}

/** Legal page copy — headings + paragraphs, in the order the app renders. */
function legalContent(page, i18n) {
  const src = i18n[page];
  const stamp = src.lastUpdated ? rawPara(src.lastUpdated) : '';
  // Headings are plain text and stay escaped; bodies are authored HTML — see
  // `rawPara`. The two are not interchangeable here.
  return stamp + LEGAL_SECTIONS[page]
    .map(([hk, bodyKeys]) =>
      h2(src[hk]) + bodyKeys.filter((k) => src[k]).map((k) => rawPara(src[k])).join(''))
    .join('');
}

/** The 12 Q&A pairs — the same list the page renders and the same list the
 *  FAQPage JSON-LD already declares. Having the schema without the prose was
 *  the odd half: Google matches rich results against on-page text. */
function faqContent(i18n) {
  return i18n.faq.items.map((it) => h2(it.q) + para(it.a)).join('');
}

/**
 * The comparison page: tagline, the honest "when they win" paragraph, and the
 * feature table as a real <table>.
 *
 * `VS_PROFILES` is English-only and the Spanish page renders those same
 * English rows today, so the Spanish file carries them too. That is not an
 * oversight to fix here: the prerendered text must match what the page
 * actually shows, and emitting Spanish rows a visitor would never see is
 * cloaking. Translating `vs-data.ts` fixes both surfaces at once.
 */
function vsContent(slug, i18n) {
  const p = VS_PROFILES.find((x) => x.slug === slug);
  if (!p) return '';
  const rows = p.rows
    .map((r) =>
      `<tr><th scope="row" style="text-align:left;padding:4px 8px 4px 0">${esc(r.feature)}</th>` +
      `<td style="padding:4px 8px 4px 0">${esc(r.us)}</td>` +
      `<td style="padding:4px 0">${esc(r.them)}</td></tr>`)
    .join('');
  return (
    para(p.tagline) +
    h2(i18n.vs.honestTitle) + para(p.honestSummary) +
    // `vs.tableTitle` is "Feature-by-feature: Ignia vs {{name}}" — interpolate
    // it, or the page ships the placeholder as literal text.
    h2(interp(i18n.vs.tableTitle, { name: p.name })) +
    `<table style="border-collapse:collapse;font-size:14px"><thead><tr>` +
    `<th scope="col" style="text-align:left;padding:4px 8px 4px 0">${esc(i18n.vs.colFeature)}</th>` +
    `<th scope="col" style="text-align:left;padding:4px 8px 4px 0">Ignia</th>` +
    `<th scope="col" style="text-align:left;padding:4px 0">${esc(p.name)}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}

/** A macro bracket: the numbers, stated as text a crawler can read, plus the
 *  explainer. The JSON-LD already carries the same two figures — this is the
 *  on-page text it is supposed to be describing. */
function macrosContent(i18n, { goal, weight, kcal, protein }) {
  return (
    para(interp(i18n.macrosPage.subhead[goal], { weight })) +
    para(`${i18n.macrosPage.kcalLabel}: ${kcal} · ` +
         `${i18n.macrosPage.proteinLabel}: ${protein}${i18n.macrosPage.gramSuffix}`) +
    para(interp(i18n.macrosPage.explainer[goal], { weight, kcal, protein }))
  );
}

/** Link groups for one page. Localised, and macros pages get their siblings
 *  so all 36 brackets are reachable in two hops from any one of them. */
function footerGroups(route, locale) {
  const { prefix, i18n, lang } = locale;
  const copy = COPY[lang];
  const p = (path) => `${prefix}${path}`;

  const calculators = [
    li(p('/calculator'), copy.crumbCalculator),
    ...CALC_VARIANTS.map((v) =>
      li(p(`/${v.slug}`), i18n.calcVariants[v.key].title.replace(/ · Ignia$/, ''))),
  ];

  const comparisons = VS.map((v) => li(p(`/vs/${v.slug}`), `vs ${v.name}`));

  // Macro brackets. On a bracket page: every weight for that goal, plus the
  // same weight under the other two goals. Anywhere else: a seed per goal.
  const m = /^\/macros\/(lose|maintain|gain)\/(\d+)-lb$/.exec(route.key);
  const targets = [];
  if (m) {
    const [, goal, weight] = m;
    for (const w of RANGES[goal]) {
      if (String(w) !== weight) {
        targets.push(li(p(`/macros/${goal}/${w}-lb`), `${copy.goalLabel[goal]} · ${w} lb`));
      }
    }
    for (const g of Object.keys(RANGES)) {
      if (g !== goal && RANGES[g].includes(Number(weight))) {
        targets.push(li(p(`/macros/${g}/${weight}-lb`), `${copy.goalLabel[g]} · ${weight} lb`));
      }
    }
  } else {
    for (const g of Object.keys(RANGES)) {
      for (const w of [150, 180, 200].filter((x) => RANGES[g].includes(x))) {
        targets.push(li(p(`/macros/${g}/${w}-lb`), `${copy.goalLabel[g]} · ${w} lb`));
      }
    }
  }
  targets.push(li(p('/calculator'), copy.navAllWeights));

  const product = [
    li(p('/') || '/', copy.navHome),
    li(p('/download'), copy.navDownload),
    li(p('/faq'), copy.crumbFaq),
    li(p('/support'), copy.navSupport),
    li(p('/transformations'), copy.navTransformations),
    li(p('/changelog'), stripBrand(i18n.changelog.pageTitle)),
    li(p('/status'), stripBrand(i18n.status.pageTitle)),
  ];

  const legal = [
    li(p('/privacy'), stripBrand(i18n.privacy.pageTitle)),
    li(p('/terms'), stripBrand(i18n.terms.pageTitle)),
  ];

  return [
    [copy.navCalculators, calculators],
    [copy.navComparisons, comparisons],
    [copy.navTargets, targets],
    [copy.navProduct, product],
    [copy.navLegal, legal],
  ];
}

function bodyBlocks(route, alternates, { footer = true } = {}) {
  const { locale, title, description } = route;
  const copy = COPY[locale.lang];

  // The other locale's URL for this same page — a crawlable hreflang partner,
  // not just a <head> declaration.
  const other = (alternates ?? []).find((a) => a.hreflang !== locale.hreflang);
  const langLink = other
    ? `<p class="ig-sm__foot"><a href="${other.url}" hreflang="${other.hreflang}">` +
      `${esc(COPY[locale.lang === 'en' ? 'es' : 'en'].otherLang)}</a></p>`
    : '';

  const groups = footerGroups(route, locale)
    .map(([heading, items]) => `<ul><li><h2>${esc(heading)}</h2></li>${items.join('')}</ul>`)
    .join('');

  // The heading a crawler's first pass reads, and what a no-JS reader gets
  // instead of nothing but "Please enable JavaScript".
  // `route.content` is the page's real copy, read from the same i18n/data the
  // component renders (see the CONTENT block above). Absent for the routes that
  // genuinely have nothing static to say — `/transformations` waits on
  // Firestore, `/status` on a heartbeat — which keep the heading-only fallback.
  const heading =
    `<div class="ig-sm" style="border:0"><div class="ig-sm__in" style="display:block">` +
    `<h1 style="font-size:24px;margin:0 0 8px">${esc(stripBrand(title))}</h1>` +
    `<p style="margin:0">${esc(description)}</p>` +
    (route.content ?? '') +
    `</div></div>`;

  const nav =
    `<footer class="ig-sm" aria-label="${esc(copy.navSiteMap)}">` +
    `<div class="ig-sm__in">${groups}</div>${langLink}</footer>`;

  // A landing page already renders its own footer inside the app, so a second
  // visible one below it would read as a mistake. It still needs the link
  // graph, so there the whole block goes inside <noscript>: invisible to
  // anyone with JS, present in the HTML a first-pass crawler reads.
  return footer
    ? `\n<noscript>${heading}</noscript>\n${nav}\n`
    : `\n<noscript>${heading}${nav}</noscript>\n`;
}

/** Insert the fallback + footer before </body>, and the footer's CSS before
 *  </head>. Both are self-contained; nothing here depends on the app's
 *  stylesheet, which may not have loaded when a crawler reads the file. */
function injectBody(html, route, alternates, opts) {
  return html
    .replace('</head>', `    ${FOOTER_STYLE}\n  </head>`)
    .replace('</body>', `${bodyBlocks(route, alternates, opts)}</body>`);
}

// ─── Route table ───────────────────────────────────────────────────────

/**
 * Every prerendered page for one locale. `key` is the locale-independent
 * identity of the page — it is what pairs the English and Spanish
 * versions together into hreflang alternates.
 */
function buildRoutes(locale) {
  const { prefix, i18n, lang } = locale;
  const copy = COPY[lang];
  const url = (path) => `${SITE}${prefix}${path}`;
  const file = (rel) => `${prefix ? `${prefix.slice(1)}/` : ''}${rel}`;
  const routes = [];
  const home = { name: copy.crumbHome, url: url('/') };

  // The locale landing page. English is the shell itself (already correct,
  // and rewriting index.html would break the SPA fallback), so only
  // Spanish needs a file here.
  if (prefix) {
    routes.push({
      key: '/',
      locale,
      file: file('index.html'),
      path: `${prefix}/`,
      title: copy.home_title,
      description: copy.home,
      canonical: `${SITE}${prefix}/`,
      changefreq: 'weekly',
      priority: 1.0,
    });
  }

  assertLegalCoverage(locale);

  for (const p of SHELL_PAGES) {
    const slug = p.key.slice(1);
    routes.push({
      key: p.key,
      locale,
      file: file(`${slug}.html`),
      path: `${prefix}${p.key}`,
      title: i18n[p.i18nKey].pageTitle,
      description: copy[p.copyKey],
      // /privacy and /terms carry their full text; /changelog and /status are
      // generated at runtime and have no static copy to lift.
      content: LEGAL_SECTIONS[p.i18nKey] ? legalContent(p.i18nKey, i18n) : undefined,
      canonical: url(p.key),
      changefreq: p.changefreq,
      priority: p.priority,
      jsonLd: breadcrumb([
        home,
        { name: stripBrand(i18n[p.i18nKey].pageTitle), url: url(p.key) },
      ]),
    });
  }

  routes.push({
    key: '/calculator',
    locale,
    file: file('calculator.html'),
    path: `${prefix}/calculator`,
    title: i18n.calculator.pageTitle,
    description: copy.calculator,
    canonical: url('/calculator'),
    changefreq: 'monthly',
    priority: 0.9,
    content: para(i18n.calculator.intro),
    jsonLd: breadcrumb([home, { name: copy.crumbCalculator, url: url('/calculator') }]),
  });

  for (const v of CALC_VARIANTS) {
    const variant = i18n.calcVariants[v.key];
    routes.push({
      key: `/${v.slug}`,
      locale,
      file: file(`${v.slug}.html`),
      path: `${prefix}/${v.slug}`,
      title: variant.title,
      // The description is truncated to 320 for the meta tag; the body copy in
      // full is what the page itself says, so that is what ships here.
      content: para(variant.body),
      description: variant.body.slice(0, 320),
      canonical: url(`/${v.slug}`),
      changefreq: 'monthly',
      priority: v.priority,
      jsonLd: breadcrumb([
        home,
        { name: copy.crumbCalculator, url: url('/calculator') },
        { name: variant.title.replace(/ · Ignia$/, ''), url: url(`/${v.slug}`) },
      ]),
    });
  }

  // /transformations has no pageTitle key of its own — the page's own lead and
  // subtitle are the copy, so the title is composed from them.
  routes.push({
    key: '/transformations',
    locale,
    file: file('transformations.html'),
    path: `${prefix}/transformations`,
    title: `${i18n.transformations.titleLead} ${i18n.transformations.titleEm} | Ignia`,
    description: i18n.transformations.subtitle.slice(0, 320),
    canonical: url('/transformations'),
    changefreq: 'weekly',
    priority: 0.8,
    jsonLd: breadcrumb([home, { name: i18n.transformations.section, url: url('/transformations') }]),
  });

  for (const v of VS) {
    const pageUrl = url(`/vs/${v.slug}`);
    const title = interp(i18n.vs.pageTitle, { name: v.name });
    const description = copy.vs(v.name);
    routes.push({
      key: `/vs/${v.slug}`,
      locale,
      file: file(`vs/${v.slug}.html`),
      path: `${prefix}/vs/${v.slug}`,
      title,
      description,
      content: vsContent(v.slug, i18n),
      canonical: pageUrl,
      changefreq: 'monthly',
      priority: v.priority,
      jsonLd: [
        breadcrumb([
          home,
          { name: copy.crumbComparisons, url: url('/vs/myfitnesspal') },
          { name: `vs ${v.name}`, url: pageUrl },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description,
          url: pageUrl,
          inLanguage: locale.htmlLang,
          author: { '@type': 'Organization', name: 'Ignia' },
          publisher: { '@type': 'Organization', name: 'Ignia' },
          about: [
            { '@type': 'SoftwareApplication', name: 'Ignia' },
            { '@type': 'SoftwareApplication', name: v.name },
          ],
        },
      ],
    });
  }

  // /faq — structured FAQPage. Each Q/A becomes a `Question` schema
  // node so Google can promote answers into the People-Also-Ask box
  // and the FAQ rich-result strip below the main listing. The user-
  // visible page renders the same Q/A list from i18n; keeping the
  // schema in sync is the entire point of this prerender entry.
  routes.push({
    key: '/faq',
    locale,
    file: file('faq.html'),
    path: `${prefix}/faq`,
    title: i18n.faq.pageTitle,
    description: copy.faq,
    content: para(i18n.faq.intro) + faqContent(i18n),
    canonical: url('/faq'),
    changefreq: 'monthly',
    priority: 0.7,
    jsonLd: [
      breadcrumb([home, { name: copy.crumbFaq, url: url('/faq') }]),
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: i18n.faq.items.map((it) => ({
          '@type': 'Question',
          name: it.q,
          acceptedAnswer: { '@type': 'Answer', text: it.a },
        })),
      },
    ],
  });

  for (const goal of Object.keys(RANGES)) {
    for (const weight of RANGES[goal]) {
      const kcal = computeKcal(weight, goal);
      const protein = computeProtein(weight);
      const title = interp(i18n.macrosPage.title[goal], { weight });
      const description = interp(i18n.macrosPage.explainer[goal], { weight, kcal, protein }).slice(0, 320);
      const pageUrl = url(`/macros/${goal}/${weight}-lb`);
      routes.push({
        key: `/macros/${goal}/${weight}-lb`,
        locale,
        file: file(`macros/${goal}/${weight}-lb.html`),
        path: `${prefix}/macros/${goal}/${weight}-lb`,
        title,
        description,
        content: macrosContent(i18n, { goal, weight, kcal, protein }),
        canonical: pageUrl,
        priority: MACROS_PRIORITY[goal],
        jsonLd: [
          breadcrumb([
            home,
            { name: copy.crumbCalculator, url: url('/calculator') },
            { name: title.replace(' | Ignia', ''), url: pageUrl },
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
            url: pageUrl,
            inLanguage: locale.htmlLang,
            isPartOf: { '@type': 'WebSite', name: 'Ignia', url: `${SITE}/` },
            about: {
              '@type': 'Thing',
              name: copy.macrosAbout(weight, goal),
              description: `${kcal} kcal/day, ${protein} g protein/day`,
            },
          },
        ],
      });
    }
  }

  return routes;
}

// ─── Emit ──────────────────────────────────────────────────────────────

const routes = LOCALES.flatMap(buildRoutes);

// Pair the locales by page identity so each file can declare the other.
const alternatesByKey = new Map();
for (const r of routes) {
  const list = alternatesByKey.get(r.key) ?? [];
  list.push({ hreflang: r.locale.hreflang, url: r.canonical });
  alternatesByKey.set(r.key, list);
}
// The English homepage is the shell at `/`, which is not in `routes` —
// add it by hand so `/es/` has something to point at and vice versa.
alternatesByKey.get('/')?.push({ hreflang: 'en', url: `${SITE}/` });

let written = 0;
for (const r of routes) {
  const alternates = alternatesByKey.get(r.key);
  let out = rewrite(shell, r, alternates);
  // Landing pages take the link graph inside <noscript>; every other page
  // takes it visibly.
  out = injectBody(out, r, alternates, { footer: r.key !== '/' });
  writeRoute(r.file, out);
  written++;
}

// The ENGLISH landing page is the shell itself and is deliberately not in
// `routes` (see buildRoutes — rewriting its <head> would break the SPA
// fallback, and it is already correct for `/`). But it IS the crawl root,
// and until 2026-08-30 it got no body injection either, which orphaned
// 117 of 118 sitemap URLs: every prerendered page links out, nothing linked
// in from `/`. So the shell now takes the same <noscript> link-graph block
// as the /es/ landing — head untouched, invisible to JS visitors (including
// `/admin`, which the catch-all also serves), present for a first-pass
// crawler. The visible counterpart for humans is the landing component's own
// footer directory (src/app/components/landing/landing.component.ts).
{
  const en = LOCALES.find((l) => l.lang === 'en');
  const homeRoute = {
    key: '/',
    locale: en,
    title: COPY.en.home_title,
    description: COPY.en.home,
  };
  writeRoute(
    'index.html',
    injectBody(shell, homeRoute, alternatesByKey.get('/'), { footer: false }),
  );
}

// Sitemap, generated from the same table so it cannot drift from what
// was actually emitted. Alternates are declared here too — belt and
// braces with the <head> tags, and the form Search Console reports on.
const XHTML_NS = 'xmlns:xhtml="http://www.w3.org/1999/xhtml"';
const sitemapEntry = ({ path, changefreq, priority, alternates }) => {
  const links = (alternates ?? [])
    .map((a) => `\n    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.url}" />`)
    .join('');
  return (
    `  <url>\n    <loc>${SITE}${path}</loc>` +
    (changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : '') +
    (priority != null ? `\n    <priority>${priority}</priority>` : '') +
    links +
    '\n  </url>'
  );
};

const sitemapUrls = [
  // English homepage — the shell, so it is not part of `routes`.
  sitemapEntry({
    path: '/',
    changefreq: 'weekly',
    priority: 1.0,
    alternates: alternatesByKey.get('/'),
  }),
  ...routes.map((r) =>
    sitemapEntry({
      path: r.path,
      changefreq: r.changefreq,
      priority: r.priority,
      alternates: alternatesByKey.get(r.key),
    }),
  ),
  ...SITEMAP_ONLY.map(sitemapEntry),
];

writeFileSync(
  resolve(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ${XHTML_NS}>\n` +
    `${sitemapUrls.join('\n')}\n</urlset>\n`,
  'utf8',
);

const perLocale = LOCALES.map(
  (l) => `${l.lang}=${routes.filter((r) => r.locale.lang === l.lang).length}`,
).join(' ');
console.log(
  `prerender-seo: wrote ${written} static SEO pages (${perLocale}) + sitemap.xml ` +
    `(${sitemapUrls.length} urls)`,
);
