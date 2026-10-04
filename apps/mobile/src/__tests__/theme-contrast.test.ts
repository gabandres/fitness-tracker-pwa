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
