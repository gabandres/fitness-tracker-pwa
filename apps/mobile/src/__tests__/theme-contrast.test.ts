import { palettes } from '@/theme';

/**
 * The palette's AA claim, computed instead of asserted.
 *
 * `theme.ts` said every text token was WCAG-AA on its canvas while light
 * `faint` measured 2.40:1 on paper (UX_AUDIT S18-2) — and `faint` is the
 * inactive tab colour, every chart axis and legend, and the Coach disclaimer.
 * Nothing in the build could see it: a hex string type-checks at any
 * luminance. This is the WCAG 2.x relative-luminance formula over the tokens
 * that render as text, against BOTH surfaces they render on.
 */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;

/** sRGB hex → CIELAB (D65). */
function lab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE76(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe.each(['light', 'dark'] as const)('%s palette contrast', (scheme) => {
  const c = palettes[scheme].colors;

  it.each(['ink', 'muted', 'faint', 'teal', 'accent'] as const)(
    '%s is AA text on paper and on card',
    (token) => {
      expect(contrastRatio(c[token], c.paper)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(c[token], c.card)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  // The semantic-state tokens are AA on paper and on card. `good`/`warn` were
  // 4.4:1 on paper until 2026-09-28; light `info`/`danger` measured 4.26/4.32
  // on card until 2026-10-04, when both were darkened a step and this floor
  // was raised from 4.2 to AA.
  it.each(['good', 'warn', 'info', 'danger'] as const)('%s is AA text on paper and on card', (token) => {
    expect(contrastRatio(c[token], c.paper)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c[token], c.card)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // A benign accent CTA ("Got it", "+ Add") read as destructive in light mode,
  // where `accent` #c62f27 and `danger` #c42020 were ΔE76 4.2 apart — the
  // same red to an eye (S21 simulator review). ≥ 20 is the floor; both
  // palettes measure ~26.
  it('danger is told apart from accent (CIELAB ΔE76 ≥ 20)', () => {
    expect(deltaE76(c.danger, c.accent)).toBeGreaterThanOrEqual(20);
  });

  it('lineStrong is a visible control boundary on the input fill and on card (1.4.11)', () => {
    expect(contrastRatio(c.lineStrong, c.inputBg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.lineStrong, c.card)).toBeGreaterThanOrEqual(3);
  });

  it('faint is AA on the input/chip fill too (placeholders live there)', () => {
    expect(contrastRatio(c.faint, c.inputBg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('teal text passes on the teal wash (the water pills)', () => {
    expect(contrastRatio(c.teal, c.tealSoft)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('tealSolid passes as text on the teal wash (connected-apps pills)', () => {
    expect(contrastRatio(c.tealSolid, c.tealSoft)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // White on dark mode's light-toned fills measured 2.32 (accent), 3.07
  // (tealSolid) and 3.37 (danger) until 2026-10-05 (Impeccable audit).
  it.each(['accent', 'danger', 'tealSolid'] as const)('onFill is AA text on the %s fill', (fill) => {
    expect(contrastRatio(c.onFill, c[fill])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('onInk reads on ink; hero text and hero muted read on the hero panel', () => {
    expect(contrastRatio(c.onInk, c.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.heroText, c.heroPanel)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.heroMuted, c.heroPanel)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference points', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // The number that started this: the old light `faint` on paper.
    expect(contrastRatio('#a8a29e', '#faf9f6')).toBeCloseTo(2.4, 1);
  });
});

/**
 * The iOS 26 glass tab bar's selected capsule (S21 simulator QA): in light mode
 * the glass went dark over the hero card and the focused `ink` glyph vanished.
 * The capsule is `paper` at `TAB_PILL_ALPHA` — composited here over the two
 * extremes the glass can show, the focused glyph must keep ≥ 3:1 (1.4.11).
 */
describe('glass tab bar selected capsule', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TAB_PILL_ALPHA, withAlpha } = require('@/lib/glass') as typeof import('@/lib/glass');

  function over(hex: string, alpha: number, backdrop: string): string {
    const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const mix = [0, 1, 2].map((i) => Math.round(ch(hex, i) * alpha + ch(backdrop, i) * (1 - alpha)));
    return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  it.each(['light', 'dark'] as const)('%s: the focused glyph reads on the capsule over any backdrop', (scheme) => {
    const c = palettes[scheme].colors;
    for (const backdrop of ['#000000', '#ffffff']) {
      expect(contrastRatio(c.ink, over(c.paper, TAB_PILL_ALPHA, backdrop))).toBeGreaterThanOrEqual(3);
    }
  });

  it('withAlpha writes rgba()', () => {
    expect(withAlpha('#faf9f6', 0.9)).toBe('rgba(250, 249, 246, 0.9)');
  });
});
