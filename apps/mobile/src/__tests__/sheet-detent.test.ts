import { hiddenBelowDetent } from '@/lib/sheet-detent';

/**
 * F12 (R33): on Android the Finish sheet opens at a partial detent. A Material
 * formSheet lays its content out at the TALLEST detent's height and shows only
 * the top of it at a lower one (react-native-screens `SheetDetents`), so the
 * band below the fold is what a pinned footer must clear.
 */
describe('hiddenBelowDetent', () => {
  it('at the lower of [0.6, 1]: the bottom 40 % of the content is below the fold', () => {
    expect(hiddenBelowDetent([0.6, 1], 0, 800)).toBeCloseTo(320);
  });
  it('at the top detent nothing is hidden', () => {
    expect(hiddenBelowDetent([0.6, 1], 1, 800)).toBe(0);
  });
  it('relative to the tallest detent, which is the content height', () => {
    expect(hiddenBelowDetent([0.45, 0.9], 0, 900)).toBeCloseTo(450);
  });
  it('one detent, fit, an unmeasured layout or a bad index → 0', () => {
    expect(hiddenBelowDetent([1], 0, 800)).toBe(0);
    expect(hiddenBelowDetent('fit', 0, 800)).toBe(0);
    expect(hiddenBelowDetent([0.6, 1], 0, 0)).toBe(0);
    expect(hiddenBelowDetent([0.6, 1], -1, 800)).toBe(0);
    expect(hiddenBelowDetent([0.6, 1], 5, 800)).toBe(0);
  });
});
