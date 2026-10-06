import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The iOS 26 glass tab bar floats OVER each tab instead of taking layout space
 * below it, so anything pinned to a tab's bottom must add `tabBarOverlap`.
 * The rest bar did not, and sat under the capsule with Skip over the Body tab
 * (Impeccable native audit, 2026-10-05).
 */

function glassWith(available: boolean) {
  let mod: typeof import('@/lib/glass') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo-glass-effect', () => ({ isLiquidGlassAvailable: () => available }));
    mod = require('@/lib/glass');
  });
  return mod!;
}

describe('tabBarOverlap', () => {
  it('is the capsule plus its gap under glass', () => {
    const g = glassWith(true);
    expect(g.GLASS_TAB_BAR).toBe(true);
    // A home-indicator phone: the capsule tucks 8 pt into the 34 pt inset.
    expect(g.tabBarOverlap(34)).toBe(26 + g.GLASS_BAR_HEIGHT);
    // No inset: never closer to the edge than space.sm.
    expect(g.tabBarOverlap(0)).toBe(8 + g.GLASS_BAR_HEIGHT);
  });

  it('is 0 under the opaque bar, which takes its own space', () => {
    const g = glassWith(false);
    expect(g.GLASS_TAB_BAR).toBe(false);
    expect(g.tabBarOverlap(34)).toBe(0);
  });
});

it('the rest bar lifts itself by the overlap', () => {
  const src = readFileSync(join(__dirname, '..', 'components/train/ActiveSession.tsx'), 'utf8');
  expect(src).toMatch(/tabBarOverlap\(/);
  expect(src).toMatch(/styles\.restBarFloat, lift > 0 && \{ marginBottom: lift \}/);
});

it('floats only on the four tabs — the other routes in the navigator never padded for it', () => {
  const src = readFileSync(join(__dirname, '..', 'app/(app)/_layout.tsx'), 'utf8');
  // Settings, the targets screens and Feedback WERE routes here (hidden tabs)
  // until S21-1 moved them onto the root stack; the four-tab gate stays so a
  // route added here later gets the opaque bar until it pads for the capsule.
  expect(src).not.toMatch(/Tabs\.Screen name="settings"/);
  expect(src).toMatch(/const TAB_ROUTES = \[\.\.\.LEFT_TABS, \.\.\.RIGHT_TABS\]/);
  expect(src).toMatch(/const floating = GLASS_TAB_BAR && current != null && TAB_ROUTES\.includes\(current\)/);
  expect(src).toMatch(/style=\{floating \? styles\.floatWrap : undefined\}/);
  expect(src).not.toMatch(/GLASS_TAB_BAR \? styles\.floatWrap/);
});

it('marks the focused tab with an opaque capsule on glass only — the opaque bar is unchanged', () => {
  const src = readFileSync(join(__dirname, '..', 'app/(app)/_layout.tsx'), 'utf8');
  // S21 QA: light-mode glass over the dark hero card left the focused `ink`
  // glyph on near-black. The capsule (paper at TAB_PILL_ALPHA) is what keeps
  // it readable; `theme-contrast.test.ts` measures it.
  expect(src).toMatch(/floating \? \[styles\.glassItem, focused && styles\.glassItemOn\] : styles\.plainItem/);
  expect(src).toMatch(/glassItemOn: \{ backgroundColor: withAlpha\(colors\.paper, TAB_PILL_ALPHA\) \}/);
});
