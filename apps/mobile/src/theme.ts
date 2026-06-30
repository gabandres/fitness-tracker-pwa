/**
 * Macro Log "Frost" design tokens — a clean, modern LIGHT theme (true-white
 * canvas, cool-gray cards, big bold numerals, a single blue accent for
 * rings/CTAs). Replaces the old warm "paper" look (#f2ead7), which read as
 * dated next to current trackers (Cal AI / Apple Health north star). Central
 * palette so screens stay consistent and a theme swap is a one-file change.
 *
 * NOTE: v1 styles with React Native StyleSheet rather than NativeWind.
 * NativeWind v4 requires Tailwind v3, which conflicts with the PWA's
 * Tailwind v4 hoisted at the monorepo root; NativeWind v5 (Tailwind v4)
 * is still preview-only. Revisit once v5 stabilises — see docs/adr/0012.
 */
export const colors = {
  paper: '#ffffff', // screen background — true white
  card: '#f6f7f9', // cool-gray surface
  ink: '#14161b', // primary text + CTAs/FAB — near-black mono base (≈17:1)
  muted: '#5b6472',
  faint: '#9aa2ae',
  line: '#e4e7ec',
  accent: '#d63a2f', // coral — the "energy" pop on the calorie ring + links
  protein: '#0fa968', // green
  carbs: '#f59e0b', // amber
  fat: '#8b5cf6', // violet
  good: '#0fa968',
  danger: '#e0463e',
  white: '#ffffff',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  h1: 30,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
  tiny: 11,
} as const;
