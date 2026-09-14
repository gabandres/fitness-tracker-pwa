/**
 * The SEO route table — ONE source for every programmatic URL ignia.fit
 * publishes: the calculator variant slugs, the /vs comparison slugs, and the
 * /macros goal × weight brackets.
 *
 * ─── WHY this file exists ──────────────────────────────────────────────
 *
 * This table used to live in FIVE hand-synced copies (`detectRoute()` in
 * app.ts, `VARIANT_PATHS` in calculator.component.ts, a link list in
 * landing.component.ts, `CALC_VARIANTS`/`VS`/`RANGES` in
 * scripts/prerender-seo.mjs, and a URL list in scripts/gsc.mjs), each
 * carrying a comment telling the next reader to update the other four.
 *
 * The failure that costs something is not the tedium, it is asymmetric drift.
 * From scripts/prerender-seo.mjs: a route that reaches the sitemap but not
 * the prerender list serves the bare shell, which declares
 * `canonical=https://ignia.fit/` — so the page tells Google it is a duplicate
 * of the homepage and can never be indexed on its own merits. Nothing repairs
 * that at runtime; no code anywhere writes a canonical tag in the browser.
 * Measured 2026-08-17, nine live URLs were in exactly that state.
 *
 * ─── WHY it is a .ts file imported by plain .mjs build scripts ─────────
 *
 * Node 24 (pinned in .nvmrc / root `engines`) strips TypeScript types
 * natively, so `scripts/*.mjs` can `import … from '…/seo-routes.ts'` — with
 * the explicit `.ts` extension — and get the same module object the Angular
 * bundle gets. scripts/prerender-seo.mjs already relied on this for
 * `vs-data.ts`; this file follows that established precedent rather than
 * inventing a generated copy, which would just be the sixth hand-synced list
 * wearing a build step.
 *
 * Two constraints follow from that and are load-bearing:
 *
 *   1. **No imports, ever.** Node resolves this file on its own, with no
 *      tsconfig `paths`, so `@macrolog/core` and every other alias is
 *      unresolvable here. `MacroGoal` below is therefore re-declared rather
 *      than imported from core — see the note on it.
 *   2. **Erasable syntax only.** Types, `as const` and `satisfies` are
 *      stripped; `enum`, `namespace` and parameter properties are not
 *      erasable and would make the module unloadable from Node.
 */

/**
 * Goal direction for the macro pages. Structurally identical to
 * `GoalDirection` in `@macrolog/core` and deliberately NOT imported (see
 * constraint 1 above): the two are tied together at compile time instead, by
 * calculator.component.ts assigning this manifest's `goal` into a
 * `Record<string, { goal: GoalDirection }>`. If core's union ever changes,
 * that assignment stops typechecking.
 */
export type MacroGoal = 'lose' | 'maintain' | 'gain';

/** Origin of the indexed site. Used to build canonical URLs and the sitemap. */
export const SITE_ORIGIN = 'https://ignia.fit';

interface CalcVariant {
  /** Path segment, without the leading slash. */
  readonly slug: string;
  /** Indexes `calcVariants.<key>` in the Transloco bundles. */
  readonly key: string;
  /** Prefilled goal, so the result block matches the searcher's intent. */
  readonly goal: MacroGoal;
  /** `<priority>` in sitemap.xml. */
  readonly priority: number;
}

/**
 * Programmatic calculator variants — the same component under
 * intent-specific URLs ("tdee calculator women", "cutting calculator", …).
 *
 * Adding one is a single row here plus the `calcVariants.<key>` i18n keys in
 * BOTH locale bundles. Routing, the landing-page directory, the prerendered
 * file and the sitemap entry all follow automatically.
 *
 * `/calculator` itself is NOT in this list: it is the canonical calculator
 * page, it draws its title from `calculator.pageTitle` rather than
 * `calcVariants.*`, and it carries its own sitemap priority. Consumers that
 * need the base page add it explicitly.
 */
export const CALC_VARIANTS = [
  { slug: 'tdee-calculator-women', key: 'tdeeWomen', goal: 'maintain', priority: 0.9 },
  { slug: 'tdee-calculator-men', key: 'tdeeMen', goal: 'maintain', priority: 0.9 },
  { slug: 'cutting-calculator', key: 'cutting', goal: 'lose', priority: 0.85 },
  { slug: 'bulking-calculator', key: 'bulking', goal: 'gain', priority: 0.85 },
  { slug: 'maintenance-calculator', key: 'maintenance', goal: 'maintain', priority: 0.7 },
  { slug: 'keto-macro-calculator', key: 'keto', goal: 'lose', priority: 0.85 },
  { slug: 'weight-loss-calculator', key: 'weightLoss', goal: 'lose', priority: 0.9 },
  { slug: 'protein-calculator', key: 'protein', goal: 'maintain', priority: 0.85 },
] as const satisfies readonly CalcVariant[];

/** Every calculator variant key, plus the base page's `default`. */
export type CalcVariantKey = 'default' | (typeof CALC_VARIANTS)[number]['key'];

interface VsPage {
  readonly slug: string;
  readonly priority: number;
}

/**
 * Comparison landings at /vs/<slug>.
 *
 * Slugs and sitemap priority live here; the comparison CONTENT (name,
 * tagline, the honest summary, the table rows) lives in
 * `src/app/components/vs-page/vs-data.ts`, whose `slug` field is typed as
 * `VsSlug` below — so a profile whose slug is not in this list is a compile
 * error, and a slug here with no profile is a build-time throw in
 * scripts/prerender-seo.mjs. Order is the order the footer link graph and the
 * sitemap list them in.
 */
export const VS_PAGES = [
  { slug: 'myfitnesspal', priority: 0.8 },
  { slug: 'loseit', priority: 0.8 },
  { slug: 'cronometer', priority: 0.7 },
  { slug: 'macrofactor', priority: 0.8 },
  { slug: 'calai', priority: 0.7 },
] as const satisfies readonly VsPage[];

/** The comparison slugs, as a union — `vs-data.ts` types its rows with it. */
export type VsSlug = (typeof VS_PAGES)[number]['slug'];

interface MacroBracketGroup {
  readonly goal: MacroGoal;
  readonly priority: number;
  /** Bracket weights in pounds, ascending. One prerendered page each. */
  readonly weightsLb: readonly number[];
}

/**
 * /macros/<goal>/<weight>-lb — enumerated, one page per bracket, 36 in all.
 *
 * An array rather than a keyed object because the emission order is the order
 * of the sitemap and of the footer's cross-links, and object key order is a
 * property of the literal rather than of the intent.
 */
export const MACRO_BRACKETS = [
  {
    goal: 'lose',
    priority: 0.7,
    weightsLb: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260],
  },
  {
    goal: 'maintain',
    priority: 0.6,
    weightsLb: [120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230],
  },
  {
    goal: 'gain',
    priority: 0.6,
    weightsLb: [120, 130, 140, 150, 160, 170, 180, 190, 200],
  },
] as const satisfies readonly MacroBracketGroup[];

/** The bracket weights published for one goal, or `[]` for an unknown goal. */
export function macroWeightsFor(goal: string): readonly number[] {
  return MACRO_BRACKETS.find((g) => g.goal === goal)?.weightsLb ?? [];
}

// ─── Route matching ────────────────────────────────────────────────────
//
// `detectRoute()` in app.ts matches against these, so a slug added above is
// routable without touching the router. The patterns are built from the
// manifest where the manifest is the exact authority, and left deliberately
// permissive where it is not — see each note.

/** `/cutting-calculator`, `/protein-calculator`, … — the exact published set. */
export const CALC_VARIANT_PATH_RE = new RegExp(
  `^/(${CALC_VARIANTS.map((v) => v.slug).join('|')})$`,
);

/**
 * `/vs/<slug>` — deliberately ANY slug shape, not just `VS_PAGES`.
 *
 * VsPageComponent resolves the slug itself and renders its own not-found
 * state for one it does not know, and an inbound link to a retired comparison
 * should reach that state rather than the shell's 404. Narrowing this to the
 * published set would be a behaviour change, not a tightening.
 */
export const VS_PATH_RE = /^\/vs\/[a-z0-9-]+$/;

/**
 * `/macros/<goal>/<weight>-lb`. The goal alternation is authoritative; the
 * weight stays a loose 2-3 digit match because MacrosPageComponent computes
 * targets for any weight it is handed — the enumerated brackets above are
 * what gets PRERENDERED, not the limit of what the component can render.
 */
export const MACROS_PATH_RE = new RegExp(
  `^/macros/(${MACRO_BRACKETS.map((g) => g.goal).join('|')})/\\d{2,3}-lb$`,
);
