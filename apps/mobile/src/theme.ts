/**
 * Macro Log "Frost" design tokens — a clean, modern LIGHT theme. v2 (2026-07)
 * warms the neutrals off pure white (which read clinical) and adds a calm TEAL
 * secondary accent alongside the coral hero — the "coastal-premium" palette,
 * research-backed (Radix Tomato/Teal/Sand ramps; MacroFactor/Oura/Gentler
 * Streak north stars). Discipline: coral = the calorie hero + primary CTAs;
 * teal = secondary interactive (links, toggles, secondary surfaces); saturation
 * is reserved for data + semantic state. Central palette so a theme swap stays
 * a one-file change.
 *
 * Contrast: text tokens are WCAG-AA on the warm canvas (accent ~4.6:1, teal
 * ~4.9:1, good/warn/info all ≥4.5:1). `ring` is intentionally brighter — it's a
 * large fill, not text.
 *
 * NOTE: v1 styles with React Native StyleSheet rather than NativeWind.
 * NativeWind v4 requires Tailwind v3, which conflicts with the PWA's
 * Tailwind v4 hoisted at the monorepo root; NativeWind v5 (Tailwind v4)
 * is still preview-only. Revisit once v5 stabilises — see docs/adr/0012.
 */
export const colors = {
  paper: '#faf9f6', // screen background — warm off-white (was true white)
  card: '#f4f2ee', // warm-gray surface (temperature-matched to the canvas)
  ink: '#1c1917', // primary text + strong CTAs/FAB — warm near-black
  muted: '#57534e', // warm secondary text
  faint: '#a8a29e', // warm tertiary text / placeholders
  line: '#e7e5e2', // warm hairline border
  accent: '#c62f27', // coral HERO — accent text/links, AA on canvas (~4.6:1)
  accentSoft: '#faf3f1', // coral section wash (tinted surface)
  ring: '#ff6a3d', // bright coral-orange calorie ring — "energy", large fill
  teal: '#0f766e', // SECONDARY accent — links/toggles, AA text (~4.9:1)
  tealSolid: '#12a594', // teal fill — switch tracks, indicators
  tealSoft: '#e6f2f0', // teal section wash (tinted surface)
  protein: '#0fa968', // green (macro data)
  carbs: '#f59e0b', // amber (macro data)
  fat: '#8b5cf6', // violet (macro data)
  good: '#208368', // success text (jade, AA)
  warn: '#ab6400', // warning text (amber, AA — bright amber fails on white)
  info: '#0d74ce', // info text (blue, AA)
  danger: '#dc2626', // danger red — distinct from the coral brand
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
