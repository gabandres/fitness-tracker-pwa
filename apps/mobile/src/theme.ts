import { Platform, type ViewStyle } from 'react-native';

/**
 * Ignia design tokens — DUAL THEME as of ADR-0014: **dark leads** (the
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
  // Habit identity accents (user-requested, 2026-08-30): one hue per habit so
  // the three metric rows on Today and their Trends faces read as the same
  // thing across screens. Identity, never urgency — these are calm accents
  // (icon tints, chart bars, tab dots), not repaints. Hues reuse families the
  // palette already vetted: water keeps the teal it has always had, sleep
  // takes the violet the fat macro uses (night), fasting takes the amber/ember
  // family (amber-600 in light — carbs' #f59e0b is a large-fill hue and falls
  // under 3:1 as a small glyph on white; warn's #ab6400 reads brown as a bar).
  habitSleep: '#8b5cf6', // violet — shares `fat`'s vetted hue
  habitFasting: '#d97706', // ember amber — between `carbs` and `warn`, ≥3:1 on canvas
  habitWater: '#0f766e', // teal — same as `teal`, the row's existing colour
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
  habitSleep: '#a78bfa', // violet — shares `fat`'s dark hue
  habitFasting: '#fbbf24', // ember amber — shares `carbs`' dark hue (bright enough on near-black)
  habitWater: '#3fd6c0', // teal — same as `teal`
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
export type ShadowTokens = Record<'e1' | 'e2' | 'e3', ViewStyle>;

// react-native-web deprecated the `shadow*` props in favour of `boxShadow`;
// native still wants `shadow*`/`elevation`. One helper keeps each elevation a
// single source that emits the right form per platform (silences the web warn).
function hexRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function elev(color: string, opacity: number, radius: number, height: number, e: number): ViewStyle {
  return Platform.select<ViewStyle>({
    web: { boxShadow: `0px ${height}px ${radius}px ${hexRgba(color, opacity)}` } as ViewStyle,
    default: { shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height }, elevation: e },
  })!;
}

const lightShadow: ShadowTokens = {
  e1: elev('#1c1917', 0.05, 8, 2, 1),
  e2: elev('#1c1917', 0.09, 14, 4, 3),
  e3: elev('#1c1917', 0.16, 20, 6, 6),
};

const darkShadow: ShadowTokens = {
  e1: elev('#000000', 0.35, 8, 2, 1),
  e2: elev('#000000', 0.45, 14, 4, 3),
  e3: elev('#000000', 0.55, 20, 6, 6),
};

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

/**
 * Bottom padding a scrolling tab must reserve for the floating **+** button.
 *
 * `LogSpeedDial` is 58 dp and sits raised above the tab bar, so it overhangs the
 * scroll area — every tab's last element ends up underneath it unless the
 * content stops short. `space.xl` (24) is nowhere near enough, and the failure
 * is silent: the content renders, it is simply unreachable.
 *
 * **It lives here because it was a local constant in `index.tsx` and the other
 * three tabs did not have it.** Today fixed this in UX_AUDIT F5 and the fix did
 * not generalise, so Trends shipped a Coach row that could not be tapped (#96),
 * and then a fasting card whose footer sat under the button. One exported
 * constant is what makes the next tab correct by default.
 *
 * Not derived from `space`: it is the height of a specific control plus its
 * clearance, so it tracks `LogSpeedDial`, not the type scale. If that button
 * ever changes size, change this.
 */
export const FAB_BAND = 96;

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
  /**
   * The hero moment (the welcome intro): slower and more spaced than a list
   * entrance, because the eye is meant to be LED — mark, then what the app is,
   * then the way in. `lead` is the pause after the splash lifts before the
   * first line arrives; ~100 ms between items is small enough that nobody
   * waits and large enough to read as a sequence rather than a slide.
   *
   * `lead` was 120 and is 300 because a 30 fps recording on the LG VS988
   * (2026-09-02) showed the title drawn at its resting place while the
   * flame was still travelling up through it — the mark's spring needs
   * ~250 ms to clear that band, and the copy must not arrive before it has.
   */
  hero: { dur: 520, stagger: 110, lead: 300 },
  spring: {
    press: { damping: 18, stiffness: 350, mass: 0.6 },
    gentle: { damping: 18, stiffness: 120, mass: 1 },
    /** The welcome mark's travel: `gentle`'s damping (one settle, no bounce)
     *  with more stiffness, so it clears the copy's band before the copy
     *  arrives — see `hero.lead`. */
    hero: { damping: 18, stiffness: 190, mass: 1 },
  },
} as const;
