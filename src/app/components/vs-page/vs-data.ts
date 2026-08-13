/**
 * Comparison-page data. Each entry powers /vs/<slug>. Honesty is the
 * brand here: comparison-intent traffic ("Ignia vs MFP") converts
 * 3-5x better than top-of-funnel queries, but only if the page reads
 * like an actual comparison rather than a one-sided pitch — Google's
 * helpful-content signals down-rank obvious puff and visitors bounce.
 *
 * Each row in `rows` is a single feature category with a short verdict
 * for both sides. `winner` decides which column gets the highlight.
 */

export type Verdict = 'us' | 'them' | 'tie';

export interface VsRow {
  /** Short feature label, sentence case. */
  feature: string;
  /** What Ignia does. Ideally one sentence. */
  us: string;
  /** What the competitor does. Same constraint — keep it sharp. */
  them: string;
  winner: Verdict;
}

export interface VsProfile {
  /** URL slug — must be lowercase, no spaces. */
  slug: string;
  /** Display name of the competitor (e.g. "MyFitnessPal"). */
  name: string;
  /** Short tagline — used in the sub-head. */
  tagline: string;
  /** One-paragraph honest framing — when their tool is the better pick. */
  honestSummary: string;
  /** The comparison rows. */
  rows: VsRow[];
}

export const VS_PROFILES: VsProfile[] = [
  {
    slug: 'myfitnesspal',
    name: 'MyFitnessPal',
    tagline: 'The category default — and, since 2025, the owner of Cal AI.',
    honestSummary:
      'MyFitnessPal has the largest food database in the category: over 20 million foods, 68,500 brands, and meals from more than 380 restaurant chains. If you eat out constantly and want the deepest chain coverage that exists, MFP wins that outright and it is not close. It also acquired Cal AI in December 2025, so the two best-known names in calorie tracking are now one company. The trade-offs are price and connectivity: Premium runs about $80/yr, barcode scanning sits behind it, and by their own documentation the food database is unavailable when your phone is offline.',
    rows: [
      { feature: 'Price', us: 'Free. All of it. No ads, no subscription, nothing held back.', them: 'Free tier with ads; Premium is about $80/yr.', winner: 'us' },
      { feature: 'Food database', us: 'USDA and FNDDS bundled into the app, plus Open Food Facts for branded items.', them: '20M+ foods, 68,500 brands, 380+ restaurant chains. The biggest there is.', winner: 'them' },
      { feature: 'Offline logging', us: 'Search and log with no connection. Your day is cached and writes queue durably until you reconnect.', them: 'Their help centre: "you will not be able to access the food database" without internet.', winner: 'us' },
      { feature: 'Barcode scanning', us: 'Included, free.', them: 'Premium.', winner: 'us' },
      { feature: 'Adaptive TDEE', us: 'After 14 days, switches from a formula estimate to a maintenance figure measured from your own weight and intake trend.', them: 'Static target you adjust by hand when the scale stalls.', winner: 'us' },
      { feature: 'Photo to macros', us: 'Included, free — 3 scans a day.', them: 'Premium.', winner: 'us' },
      { feature: 'Privacy', us: 'No ads and no data sold.', them: 'Private-equity owned, ad-supported free tier.', winner: 'us' },
    ],
  },
  {
    slug: 'loseit',
    name: 'Lose It!',
    tagline: 'Cleaner than MyFitnessPal, focused squarely on weight loss.',
    honestSummary:
      'Lose It! is what MyFitnessPal would be if it had been redesigned this decade — a focused, weight-loss-first app with a genuinely polished interface and a curated food database. If a single clear weight-loss flow is what you want, it is a good app. Ignia differs in scope rather than quality: it adds a training log, a fasting timer and adaptive maintenance calories, and charges nothing for any of it.',
    rows: [
      { feature: 'Price', us: 'Free, no ads.', them: 'Free with ads; Premium about $40/yr.', winner: 'us' },
      { feature: 'Food database', us: 'USDA and FNDDS bundled, plus Open Food Facts.', them: 'Curated and cleaner than MFP, with a recipe builder.', winner: 'them' },
      { feature: 'Offline logging', us: 'Full — cached day, durable write queue.', them: 'Requires a connection for database lookups.', winner: 'us' },
      { feature: 'Adaptive TDEE', us: 'Maintenance measured from your 14-day weight and intake trend.', them: 'Static target, adjusted manually.', winner: 'us' },
      { feature: 'Strength training', us: 'A real training tab — templates, sets, RIR, auto-progression.', them: 'Exercise calories, not a training log.', winner: 'us' },
      { feature: 'Fasting timer', us: 'Included, free.', them: 'Not offered.', winner: 'us' },
    ],
  },
  {
    slug: 'cronometer',
    name: 'Cronometer',
    tagline: 'The micronutrient nerd\'s tracker.',
    honestSummary:
      'Cronometer is the gold standard if you care about micronutrients — vitamins, minerals, omega ratios, fibre — tracking roughly 84 nutrients per food from USDA and NCCDB data. If you want a complete nutritional picture, including for clinical reasons, Cronometer is the right tool and Ignia is not trying to be. Ignia deliberately leaves micros out so the daily flow stays fast. One difference is worth knowing because it is structural rather than a missing feature: Cronometer licenses its databases, and those licence terms do not permit storing them on your device, so it has no offline mode. Ignia bundles public-domain USDA data, which is exactly why it can work with no signal.',
    rows: [
      { feature: 'Price', us: 'Free, no ads.', them: 'Free tier available; Gold is about $60/yr.', winner: 'us' },
      { feature: 'Micronutrients', us: 'Not tracked. Out of scope on purpose.', them: 'About 84 nutrients per entry. Best in the category.', winner: 'them' },
      { feature: 'Offline logging', us: 'Search and log with no connection — the food data ships inside the app.', them: 'No offline mode. Their database licences do not allow on-device storage.', winner: 'us' },
      { feature: 'Adaptive TDEE', us: 'Maintenance measured from your own 14-day trend.', them: 'Formula-based target that does not recalibrate on its own.', winner: 'us' },
      { feature: 'Fasting timer', us: 'Included, free.', them: 'Gold.', winner: 'us' },
      { feature: 'Strength training', us: 'Templates, sets, RIR and auto-progression in the app.', them: 'Exercise entries, not a training log.', winner: 'us' },
    ],
  },
  {
    slug: 'macrofactor',
    name: 'MacroFactor',
    tagline: 'The most accurate adaptive TDEE on the market — and they charge for it.',
    honestSummary:
      'MacroFactor is the closest thing to a direct competitor on adaptive TDEE. Built by the Stronger By Science team, its algorithm is the most rigorous in the category and it is widely considered the best paid coaching app for serious lifters. If you want the most sophisticated version of this one idea and are happy to pay for it, buy MacroFactor — it is genuinely excellent. The differences are price and breadth: it costs about $72 a year with no free tier beyond a 7-day trial, and it does not do photo logging, barcode-free offline use, or fasting.',
    rows: [
      { feature: 'Price', us: 'Free.', them: 'About $72/yr. No free tier — a 7-day trial, then it is paid.', winner: 'us' },
      { feature: 'Adaptive TDEE algorithm', us: 'Maintenance measured from your 14-day weight and intake trend.', them: 'Best in class. Built by exercise scientists and continuously recalibrated.', winner: 'them' },
      { feature: 'Offline logging', us: 'Full — search and log with no connection.', them: 'Requires a connection.', winner: 'us' },
      { feature: 'Photo to macros', us: 'Included, free — 3 scans a day.', them: 'Not offered.', winner: 'us' },
      { feature: 'No-signup calculator', us: 'Yes — the calculator gives you a starting target with no account.', them: 'No.', winner: 'us' },
      { feature: 'Coaching content', us: 'Targets adapt on their own; no written coaching.', them: 'In-app expert articles plus algorithmic feedback.', winner: 'them' },
    ],
  },
  {
    slug: 'calai',
    name: 'Cal AI',
    tagline: 'The viral photo tracker that made one feature famous — now owned by MyFitnessPal.',
    honestSummary:
      'Cal AI made photo-based logging mainstream and its recognition is still the best in the category — that is the one thing it set out to do and it did it well enough to reach 15 million downloads in under two years. MyFitnessPal acquired it in December 2025, and it now runs against MFP\'s 20-million-food database. If photo-only logging is the whole of what you want, it is a good app. Ignia ships photo scanning too, free, but treats it as one way in among several rather than the entire product.',
    rows: [
      { feature: 'Price', us: 'Free.', them: 'Limited free scans, then subscription.', winner: 'us' },
      { feature: 'Photo macro recognition', us: 'Gemini-backed, free, 3 scans a day.', them: 'Best in class — the single feature they specialised in.', winner: 'them' },
      { feature: 'Offline logging', us: 'Full — cached day, durable write queue.', them: 'Photo recognition runs server-side, so it needs a connection.', winner: 'us' },
      { feature: 'Adaptive TDEE', us: 'Maintenance measured from your 14-day trend.', them: 'Static targets.', winner: 'us' },
      { feature: 'Strength training', us: 'Templates, sets, RIR, auto-progression.', them: 'Not offered.', winner: 'us' },
      { feature: 'Independence', us: 'Independent, free, no ads, no data sold.', them: 'Owned by MyFitnessPal since December 2025.', winner: 'us' },
    ],
  },
];

export function vsProfileFor(slug: string): VsProfile | null {
  return VS_PROFILES.find((p) => p.slug === slug) ?? null;
}
