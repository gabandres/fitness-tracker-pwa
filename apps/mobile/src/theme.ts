/**
 * Macro Log design tokens — DUAL THEME as of ADR-0014: **dark leads** (the
 * brand/store identity), light "Frost" is the derived daytime variant.
 * Components never import `colors` statically anymore — they read the active
 * palette through `useTheme()` / `useThemedStyles()` in `lib/theme-context`.
 * The palette discipline is unchanged: a theme tweak stays a one-file change,
 * there are just two palettes in that file now.
 *
 * DARK ("Ember"): warm near-black canvas (true black reads cold) where the
 * coral hero ring and protein green glow — the Oura/Whoop premium read.
 * LIGHT ("Frost", v2 2026-07): warm off-whites + calm teal secondary —
 * research-backed (Radix Tomato/Teal/Sand ramps).
 * Discipline in both: coral = the calorie hero + primary CTAs; teal =
 * secondary interactive; saturation is reserved for data + semantic state.
 * All text tokens are WCAG-AA on their canvas (`ring` is intentionally
 * brighter — it's a large fill, not text).
 *
 * NOTE: v1 styles with React Native StyleSheet rather than NativeWind
 * (Tailwind v3/v4 monorepo conflict — see docs/adr/0012).
 */

const light = {
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
  onInk: '#ffffff', // text/icons on an `ink` surface (inverts with the theme)
  inputBg: '#ffffff', // text-field / chip fill (white in light, card in dark)
  /** The hero panel canvas — dark in BOTH themes so the rings always glow
   *  and the brand reads identically day or night (ADR-0014). */
  heroPanel: '#161412',
  heroTrack: '#2e2a25', // ring track on the hero panel
  heroText: '#f3f1ec', // primary text on the hero panel
  heroMuted: '#a39c91', // secondary text on the hero panel
} as const;

export type ColorTokens = { readonly [K in keyof typeof light]: string };

const dark: ColorTokens = {
  paper: '#131210', // warm near-black canvas (Sand-dark family)
  card: '#1d1b18', // elevated warm surface
  ink: '#f3f1ec', // primary text — warm off-white
  muted: '#b3ada3', // secondary text
  faint: '#7c766c', // tertiary text / placeholders
  line: '#2b2822', // warm hairline border
  accent: '#ff8a5c', // coral text/links — AA on the dark canvas
  accentSoft: '#2a1712', // coral wash (deep ember surface)
  ring: '#ff6a3d', // SAME hero coral — glows on near-black
  teal: '#3fd6c0', // secondary accent text — AA on canvas
  tealSolid: '#12a594', // teal fill — unchanged, reads on both
  tealSoft: '#11302b', // teal wash (deep sea surface)
  protein: '#34d399', // green (macro data) — brightened for dark
  carbs: '#fbbf24', // amber (macro data)
  fat: '#a78bfa', // violet (macro data)
  good: '#3dd68c', // success text
  warn: '#f0b100', // warning text
  info: '#70b8ff', // info text
  danger: '#f2555a', // danger red — distinct from the coral brand
  white: '#ffffff',
  onInk: '#131210', // `ink` is LIGHT here, so on-ink text is the dark canvas
  inputBg: '#1d1b18', // fields sit as card-toned wells, not glaring white
  heroPanel: '#161412', // hero canvas is shared across themes (brand anchor)
  heroTrack: '#2e2a25',
  heroText: '#f3f1ec',
  heroMuted: '#a39c91',
} as const;

/**
 * Elevation ramp, per scheme. Light: warm ink-tinted shadows (grey reads
 * dirty on the warm canvas). Dark: shadows must be near-black and stronger
 * to register at all. e1 = resting cards, e2 = raised chrome, e3 = floating
 * (FAB, sheets). Includes the Android `elevation` equivalent.
 */
const lightShadow = {
  e1: { shadowColor: '#1c1917', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  e2: { shadowColor: '#1c1917', shadowOpacity: 0.09, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  e3: { shadowColor: '#1c1917', shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
} as const;

export type ShadowTokens = {
  readonly [K in keyof typeof lightShadow]: {
    readonly shadowColor: string;
    readonly shadowOpacity: number;
    readonly shadowRadius: number;
    readonly shadowOffset: { readonly width: number; readonly height: number };
    readonly elevation: number;
  };
};

const darkShadow: ShadowTokens = {
  e1: { shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  e2: { shadowColor: '#000000', shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  e3: { shadowColor: '#000000', shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
} as const;

export const palettes = {
  light: { colors: light, shadow: lightShadow },
  dark: { colors: dark, shadow: darkShadow },
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
  xl: 24,
  pill: 999,
} as const;

/**
 * Type scale — sized to platform readability minimums, not shrunk to fit.
 * `body` is 17 (Apple's standard body size; also keeps text inputs at/above
 * the 16px floor so iOS never zoom-jumps a focused field), `small` is 14
 * (Material body-medium), and `tiny` (12) is reserved for uppercase eyebrow
 * labels only — never body copy. Apple's absolute floor is 11; we sit above it
 * everywhere a human reads a sentence. Bump the whole scale here, not per-screen.
 */
export const font = {
  hero: 44,
  h1: 30,
  h2: 24,
  h3: 20,
  body: 17,
  small: 14,
  tiny: 12,
} as const;

/**
 * Type families (ADR-0014): Manrope for numerals + headings (the display
 * voice), system for body. IMPORTANT: never pair `fontWeight` with these —
 * the weight is baked into the family name and Android would fake-bold it.
 */
export const type = {
  display: 'Manrope_800ExtraBold',
  heading: 'Manrope_700Bold',
} as const;

/**
 * Motion tokens — every animation in the app draws from these so timing feels
 * like one system. `spring.*` are Reanimated `withSpring` configs; `press` is
 * tight (micro-interaction), `gentle` settles slower (rings, sheets, heroes).
 * All motion must respect reduce-motion — use the helpers in `lib/motion.tsx`
 * rather than calling Reanimated directly in components.
 */
export const motion = {
  dur: { fast: 140, base: 240, slow: 450 },
  /** Per-item delay for staggered list/card entrances. */
  stagger: 55,
  spring: {
    press: { damping: 18, stiffness: 350, mass: 0.6 },
    gentle: { damping: 18, stiffness: 120, mass: 1 },
  },
} as const;
