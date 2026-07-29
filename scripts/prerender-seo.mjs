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
    home: 'A quiet, private calorie + protein log with AI coaching and a real lifting log. Measured TDEE from your own data. Free on iPhone and in any browser.',
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
  },
  es: {
    home: 'Un registro de calorías y proteína privado y sin ruido, con entrenador de IA y registro de pesas de verdad. TDEE medido con tus propios datos. Gratis en iPhone y en cualquier navegador.',
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
  { path: '/privacy', changefreq: 'monthly', priority: 0.5 },
  { path: '/terms', changefreq: 'monthly', priority: 0.5 },
  { path: '/changelog', changefreq: 'weekly', priority: 0.6 },
  { path: '/status', changefreq: 'always', priority: 0.4 },
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
  writeRoute(r.file, rewrite(shell, r, alternatesByKey.get(r.key)));
  written++;
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
