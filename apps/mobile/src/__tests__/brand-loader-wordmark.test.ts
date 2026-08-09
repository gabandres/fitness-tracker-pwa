import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The splash wordmark must not depend on RN measuring it correctly.
 *
 * `letterSpacing` on the custom display font makes React Native under-measure
 * the text width, and the view clips whatever overflows its bounds. On Android
 * that removed the trailing "a" outright: every cold start showed the brand as
 * **"Igni"**, on every build, until the Maestro regression suite collected its
 * first Android launch capture on 2026-08-09. An iOS-era `paddingHorizontal`
 * mitigation was already in the file and did not cover it.
 *
 * Nothing else can catch this. jest/RNTL renders the element tree with no Yoga
 * layout pass and no glyph rasterisation, so a component test sees the string
 * "Ignia" and passes while the screen shows four letters. A snapshot test would
 * too. The only real detectors are a device screenshot and this: a source
 * assertion that the measurement-independent guard is still present.
 *
 * If the wordmark's styling is reworked, keep a guard that gives the glyphs
 * room regardless of measured width (an explicit/min width, or a wider parent
 * the text is centered in) and update this test to assert THAT — do not simply
 * delete it.
 */
const SRC = readFileSync(join(__dirname, '..', 'components', 'BrandLoader.tsx'), 'utf8');

function wordStyleBlock(): string {
  // The `word:` entry of the StyleSheet, up to its closing brace.
  const start = SRC.indexOf('word: {');
  expect(start).toBeGreaterThan(-1);
  return SRC.slice(start, SRC.indexOf('},', start));
}

describe('BrandLoader wordmark', () => {
  it('renders the full brand name, not a truncation of it', () => {
    expect(SRC).toContain('>Ignia<');
  });

  it('reserves horizontal room independent of measured text width', () => {
    const block = wordStyleBlock();
    const min = block.match(/minWidth:\s*(\d+)/);
    const fixed = block.match(/\bwidth:\s*(\d+)/);
    const reserved = Number(min?.[1] ?? fixed?.[1] ?? 0);

    // The word is ~150pt at font.h1 with letterSpacing; anything at or above
    // 200 clears it with margin on both sides once centered.
    expect(reserved).toBeGreaterThanOrEqual(200);
  });

  it('centers the text, so the reserved width cannot shift the wordmark', () => {
    expect(wordStyleBlock()).toContain("textAlign: 'center'");
  });

  it('gives the descender vertical room too — the "g" tail clipped the same way', () => {
    const block = wordStyleBlock();
    expect(block).toMatch(/lineHeight:/);
    expect(block).toMatch(/paddingVertical:/);
  });
});
