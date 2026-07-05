/**
 * Comparison-page data. Each entry powers /vs/<slug>. Honesty is the
 * brand here: comparison-intent traffic ("Macronaut vs MFP") converts
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
  /** What Macronaut does. Ideally one sentence. */
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
    tagline: 'The default tracker most people start with — and most people quit.',
    honestSummary:
      'MyFitnessPal has the largest food database on the planet. If you eat a lot of restaurant or packaged food and want one-tap barcode logging across millions of items, MFP wins on coverage. The trade-off is everything else: ad-laden free tier, paywalled basic features (rest day calorie targets, recipes), and a UI that has accumulated fifteen years of dark patterns.',
    rows: [
      { feature: 'Free tier', us: 'Full daily logging, history, weight tracking, calculator. No ads, ever.', them: 'Free with ads. Many basics (recipe importer, custom goals, rest day calories) are paywalled.', winner: 'us' },
      { feature: 'Sign-up', us: 'Two questions. Logging in 30 seconds.', them: 'Multi-screen onboarding asking for goals, activity, weight, height, and dietary preferences before you can log.', winner: 'us' },
      { feature: 'Food database', us: 'Manual entry + photo-AI (Pro). No barcode scanner yet.', them: 'Massive — millions of items, barcode scanner included, restaurant chain coverage.', winner: 'them' },
      { feature: 'Macro tracking', us: 'Calories + protein. Carbs/fat skipped on purpose — focus over features.', them: 'All four macros tracked, with optional micronutrients.', winner: 'them' },
      { feature: 'Adaptive TDEE', us: 'After 14 days, switches from formula estimate to a measured TDEE based on your actual weight trend.', them: 'Static target — you change it manually when the scale plateaus.', winner: 'us' },
      { feature: 'AI weekly coach', us: 'Pro: a weekly write-up that reads your real data and tells you what to adjust.', them: 'No equivalent.', winner: 'us' },
      { feature: 'Privacy', us: 'No ads. No data sold. AI does not train on your logs.', them: 'Owned by Francisco Partners (PE). Sells anonymized data to advertisers per ToS.', winner: 'us' },
      { feature: 'Pricing', us: 'Free, or Pro at $3/mo or $24/yr.', them: 'Free with ads, or Premium at ~$20/mo / $80/yr.', winner: 'us' },
    ],
  },
  {
    slug: 'loseit',
    name: 'Lose It!',
    tagline: 'Cleaner than MyFitnessPal, focused squarely on weight loss.',
    honestSummary:
      'Lose It! is what MyFitnessPal would be if it had been redesigned in the last decade — a focused, weight-loss-first app with a polished UX. If you want barcode scanning, a curated food database, and a single goal-setting flow, Lose It is solid. Macronaut skips features they have (barcode, multi-macro tracking) in exchange for a simpler daily flow and adaptive coaching.',
    rows: [
      { feature: 'Free tier', us: 'Full daily logging + history + weight + calculator. No ads.', them: 'Free with ads. Premium ($40/yr) for goals beyond weight loss, meal planning, exercise sync.', winner: 'us' },
      { feature: 'Sign-up', us: 'Two questions then you are logging.', them: 'Goal flow: target weight, weekly pace, height, activity. Five+ screens.', winner: 'us' },
      { feature: 'Food database', us: 'Manual + photo-AI (Pro).', them: 'Curated (cleaner than MFP), barcode scanner, recipe builder.', winner: 'them' },
      { feature: 'Adaptive TDEE', us: 'Measured TDEE after 14 days based on your weight trend.', them: 'Static target. Adjustments are manual.', winner: 'us' },
      { feature: 'AI coach', us: 'Weekly write-up that reads your data (Pro).', them: 'No equivalent.', winner: 'us' },
      { feature: 'Pricing', us: '$3/mo or $24/yr for Pro.', them: '$40/yr for Premium.', winner: 'us' },
    ],
  },
  {
    slug: 'cronometer',
    name: 'Cronometer',
    tagline: 'The micronutrient nerd\'s tracker.',
    honestSummary:
      'Cronometer is the gold standard if you care about micronutrients — vitamins, minerals, omega ratios, fiber. It pulls from USDA + NCCDB databases and calculates over 80 nutrients per food. If your goal is a complete nutritional picture (including for clinical reasons), Cronometer is the right tool. Macronaut deliberately ignores micros so the daily flow stays under 30 seconds; we built for cutters and lifters, not nutrition science.',
    rows: [
      { feature: 'Free tier', us: 'Full kcal + protein logging + history + adaptive TDEE.', them: 'Full nutrition tracking, but ads on the free tier.', winner: 'tie' },
      { feature: 'Micronutrients', us: 'Not tracked. Out of scope by design.', them: '80+ nutrients per food entry from USDA/NCCDB.', winner: 'them' },
      { feature: 'Daily logging speed', us: 'Two fields (kcal + protein), 30 seconds.', them: 'Multi-field per item, slower but more complete.', winner: 'us' },
      { feature: 'Adaptive TDEE', us: 'Yes — measured from 14-day weight trend.', them: 'No — static target.', winner: 'us' },
      { feature: 'AI weekly coach', us: 'Pro feature.', them: 'No equivalent.', winner: 'us' },
      { feature: 'Pricing', us: '$3/mo or $24/yr.', them: '$50/yr for Gold (Cronometer Pro).', winner: 'us' },
    ],
  },
  {
    slug: 'macrofactor',
    name: 'MacroFactor',
    tagline: 'The most accurate adaptive TDEE on the market — and they charge for it.',
    honestSummary:
      'MacroFactor is the closest competitor on adaptive TDEE — built by Stronger By Science, it has the most rigorous algorithm in the category and is widely considered the best paid coaching app for serious lifters. They are not free, and they do not have a no-signup calculator or photo-AI. Macronaut is what you reach for when you want most of MacroFactor\'s value at a fraction of the cost, with photo logging and a free tier good enough for daily use.',
    rows: [
      { feature: 'Free tier', us: 'Full daily logging + adaptive TDEE + 14-day history.', them: 'No free tier — paid only after a 7-day trial.', winner: 'us' },
      { feature: 'Adaptive TDEE algorithm', us: 'Measured TDEE from 14-day weight + intake trend. Solid.', them: 'Best-in-class — built by exercise scientists, peer-reviewed methodology.', winner: 'them' },
      { feature: 'No-signup calculator', us: 'Yes — /calculator gives you a starting target instantly.', them: 'No.', winner: 'us' },
      { feature: 'Photo → macros', us: 'Pro — Gemini analyzes a food photo into kcal + protein.', them: 'Manual entry only.', winner: 'us' },
      { feature: 'Coaching content', us: 'AI weekly write-up that reads your data.', them: 'In-app expert articles + algorithmic feedback.', winner: 'them' },
      { feature: 'Pricing', us: '$3/mo or $24/yr.', them: '~$12/mo or $72/yr.', winner: 'us' },
    ],
  },
  {
    slug: 'calai',
    name: 'Cal AI',
    tagline: 'The viral photo-AI tracker that put one feature on the map.',
    honestSummary:
      'Cal AI made photo-based macro logging mainstream. Their photo recognition is the category leader. If photo-only logging is the entire feature you want and you do not care about adaptive coaching, weekly trends, or a free tier, Cal AI is fine. Macronaut ships photo-AI too (on Pro), but bundles it with TDEE coaching, weight trend tracking, and a daily ring view that Cal AI does not have.',
    rows: [
      { feature: 'Free tier', us: 'Full daily flow free.', them: 'Limited free scans then paywalled.', winner: 'us' },
      { feature: 'Photo macro recognition', us: 'Gemini-backed, accurate for whole foods + composed plates (Pro).', them: 'Best-in-class — they specialized in this single feature.', winner: 'them' },
      { feature: 'Adaptive TDEE', us: 'Measured TDEE after 14 days.', them: 'No — static targets only.', winner: 'us' },
      { feature: 'Weight + body trend', us: 'Daily weight log, sparkline, goal progress bar.', them: 'Minimal — focus is on per-meal logging.', winner: 'us' },
      { feature: 'AI weekly coach', us: 'Reads your data, writes a weekly readout.', them: 'No equivalent.', winner: 'us' },
      { feature: 'Pricing', us: '$3/mo or $24/yr.', them: '$10/mo / $30/yr (varies by region).', winner: 'us' },
    ],
  },
];

export function vsProfileFor(slug: string): VsProfile | null {
  return VS_PROFILES.find((p) => p.slug === slug) ?? null;
}
