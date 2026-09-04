import { font, headerTitle, type } from '@/theme';

/**
 * The Today header title must not be able to outgrow its own floor.
 *
 * The block carries a fixed `minWidth` in dp. The text inside it scales with
 * the OS font setting and deliberately carries no `numberOfLines` — the
 * screen's own name is the last thing that should be abbreviated — so when it
 * exceeds the floor it does not ellipsize, it HARD-CLIPS.
 *
 * That was live. Reproduced on the LG VS988 at `font_scale 1.15` on
 * 2026-09-04: the block stayed pinned at 384px/density 4 = 96dp while "Today"
 * needed ~100dp, and the header rendered "Toda" — the same failure as publish 4
 * of that day's header thrash, through a door that fix did not cover. Two
 * notches of iOS *Larger Text* (xxLarge ~1.12) reaches it, so it landed on
 * users who had turned on an accessibility setting.
 *
 * `advanceHint` is measured, not guessed: CoreText, the iOS text engine, on the
 * bundled Manrope_800ExtraBold TTF at 30pt. The Android screenshot measurement
 * that produced `minWidth` read 86.7dp — 0.5% apart, because the face is
 * bundled and both platforms read advances from the same file.
 *
 * This test exists so the floor and the cap cannot drift apart again. Raise
 * `font.h1`, widen the title, or lift the cap without re-measuring, and it
 * fails here rather than on a user's phone.
 */
describe('Today header title fit', () => {
  it('the cap keeps the scaled title inside the floor', () => {
    const widest = headerTitle.advanceHint * headerTitle.maxFontScale;
    expect(widest).toBeLessThanOrEqual(headerTitle.minWidth);
  });

  it('the cap is not needlessly tight — it is the largest the floor allows', () => {
    // Derived, not chosen: 96 / 87.15 = 1.1015. If someone lowers the cap for
    // no reason they cost users font scaling they could have had; if they raise
    // it past this, the case above fails.
    const maxAllowed = headerTitle.minWidth / headerTitle.advanceHint;
    expect(headerTitle.maxFontScale).toBeLessThanOrEqual(maxAllowed);
    expect(headerTitle.maxFontScale).toBeGreaterThan(maxAllowed - 0.05);
  });

  it('the measurement it rests on still describes the rendered title', () => {
    // `advanceHint` was measured at this family and size. If either moves the
    // number is stale and the two cases above are guarding nothing.
    expect(type.display).toBe('Manrope_800ExtraBold');
    expect(font.h1).toBe(30);
  });
});
