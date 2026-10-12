import { createContext, useContext } from 'react';

/**
 * How much of a native sheet's content sits BELOW the visible fold right now —
 * Android only (train-ux F12, R33, 2026-10-12).
 *
 * react-native-screens lays an Android formSheet's content out at the height
 * of its TALLEST detent and, at a lower detent, shows only the top of it
 * (`SheetDetents.maxAllowedHeight` vs `peekHeight`). A sheet that pins a
 * footer to its bottom (Finish) therefore had to open full height — the M3
 * rule is a partial first height — or its one action sat off screen. The sheet
 * route (`app/sheet.tsx`) tracks the detent and measures the content, and
 * publishes the hidden band here; a sheet that wants its footer on screen at
 * the lower detent pads by it. Every other sheet ignores it and is unchanged.
 * iOS resizes its sheet's content per detent, so the value there is always 0.
 */
export function hiddenBelowDetent(
  detents: readonly number[] | 'fit',
  index: number,
  contentHeight: number,
): number {
  if (detents === 'fit' || detents.length < 2 || contentHeight <= 0) return 0;
  if (index < 0 || index >= detents.length - 1) return 0;
  const top = detents[detents.length - 1];
  if (!(top > 0)) return 0;
  return Math.max(0, contentHeight * (1 - detents[index] / top));
}

/** The hidden band under the current detent, px (0 off Android / at the top). */
export const SheetHiddenBelowContext = createContext(0);

/** Read inside a native sheet's content (it renders under the sheet route). */
export function useSheetHiddenBelow(): number {
  return useContext(SheetHiddenBelowContext);
}
