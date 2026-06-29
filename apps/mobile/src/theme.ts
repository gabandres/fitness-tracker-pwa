/**
 * Macro Log "paper" design tokens — mirrors the PWA aesthetic
 * (theme-color #f2ead7). Central palette/spacing so screens stay
 * consistent and a future NativeWind migration is mechanical.
 *
 * NOTE: v1 styles with React Native StyleSheet rather than NativeWind.
 * NativeWind v4 requires Tailwind v3, which conflicts with the PWA's
 * Tailwind v4 hoisted at the monorepo root; NativeWind v5 (Tailwind v4)
 * is still preview-only. Revisit once v5 stabilises — see docs/adr/0012.
 */
export const colors = {
  paper: '#f2ead7',
  card: '#fbf7ee',
  ink: '#1c1917',
  muted: '#57534e',
  faint: '#a8a29e',
  line: '#e7ddc7',
  accent: '#b45309', // warm amber — calories
  protein: '#0e7490',
  carbs: '#b45309',
  fat: '#9333ea',
  good: '#15803d',
  danger: '#b91c1c',
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
