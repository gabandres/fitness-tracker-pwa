// `motion.tsx` reaches `@/i18n` for the locale, which reaches `@/lib/auth`,
// which imports Firebase's ESM build through a transform jest cannot handle.
// Every screen test in this repo mocks it the same way; done here so the pure
// function under test does not need a module of its own — and specifically so
// `formatNumber` stays a worklet IN `motion.tsx`, where Reanimated's babel
// plugin already handles it. Moving it out to win a test seam would put the
// UI-thread formatting of the Today hero at risk to make an assertion easier.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

import { widestCountUpText } from '@/lib/motion';

// `CountUpText` renders through an animated TextInput, and Yoga measures that
// box ONCE, on the JS pass, from React-visible props. `animatedProps` then
// writes the text on the UI thread, where layout never re-runs — so the width
// is frozen at whatever string React last rendered, and every wider string the
// animation passes through gets CLIPPED.
//
// Reported 2026-08-28 from the Today hero: the ring read "1,14" with the last
// glyph gone, because the box had been measured for a 3-digit remaining while
// the number animated through 4 digits.
//
// `AGENTS.md` records that RNTL never runs a Yoga layout pass, which is why no
// render test in this repo can see clipping — the same blind spot that let the
// F-series layout defects and OTA 74's unflexed row reach devices with green
// suites. So the sizing input is a pure function and this is what pins it.

describe('widestCountUpText', () => {
  const en = { group: ',', decimal: '.' };

  it('takes the LANDING value when the number grows', () => {
    // 461 -> 1141 is the reported case: the box must be sized for "1,141",
    // not for "461", or the animation clips on the way up.
    expect(widestCountUpText(461, 1141, 0, en.group, en.decimal, '')).toBe('1,141');
  });

  it('takes the STARTING value when the number shrinks', () => {
    // The other direction matters just as much: counting 2,003 -> 461 renders
    // 5-glyph strings for most of the animation and lands on 3.
    expect(widestCountUpText(2003, 461, 0, en.group, en.decimal, '')).toBe('2,003');
  });

  it('never returns something narrower than either end', () => {
    for (const [a, b] of [
      [0, 0],
      [9, 10],
      [999, 1000],
      [1000, 999],
      [12345, 7],
    ] as const) {
      const w = widestCountUpText(a, b, 0, en.group, en.decimal, '');
      const from = widestCountUpText(a, a, 0, en.group, en.decimal, '');
      const to = widestCountUpText(b, b, 0, en.group, en.decimal, '');
      expect(w.length).toBeGreaterThanOrEqual(from.length);
      expect(w.length).toBeGreaterThanOrEqual(to.length);
    }
  });

  it('counts the separators, which is where the digit count alone would lie', () => {
    // "1,000" is FIVE glyphs against "999"'s three — a 66% jump in width for a
    // one-digit change. Crossing a thousands boundary is exactly when the
    // frozen-width bug becomes visible, and exactly what a digit count misses.
    expect(widestCountUpText(999, 1000, 0, en.group, en.decimal, '')).toHaveLength(5);
  });

  it('honours the locale separators rather than assuming a comma', () => {
    // pt-BR writes 1.974. The big number on Today is rendered through here and
    // grouped with a comma for every locale until 2026-08-23; do not regress it.
    expect(widestCountUpText(461, 1974, 0, '.', ',', '')).toBe('1.974');
  });

  it('includes the suffix, which is part of the rendered width', () => {
    expect(widestCountUpText(9, 120, 0, en.group, en.decimal, 'g')).toBe('120g');
  });

  it('includes decimals', () => {
    expect(widestCountUpText(9.5, 120.25, 2, en.group, en.decimal, '')).toBe('120.25');
  });

  it('handles a negative crossing, where the minus sign adds a glyph', () => {
    // `formatNumber` prefixes U+2212 for a negative. HeroRings passes
    // Math.abs(), but nothing stops another caller from not doing so.
    const w = widestCountUpText(-1200, 5, 0, en.group, en.decimal, '');
    expect(w).toHaveLength(6);
  });
});
