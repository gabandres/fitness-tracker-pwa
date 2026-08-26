import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every scrolling tab reserves room for the floating **+** button (#96).
 *
 * ## The failure, and why it recurred
 *
 * `LogSpeedDial` is 58 dp and sits raised above the tab bar, so it overhangs the
 * scroll area. A tab whose content stops at `space.xl` (24 dp) leaves its last
 * element underneath the button — rendered, and unreachable.
 *
 * Today hit this in UX_AUDIT F5 and fixed it with a `FAB_BAND` constant defined
 * **inside `index.tsx`**. That is precisely why it recurred: the other three
 * tabs could not see it. Trends then shipped a Coach row nobody could tap, and
 * later a fasting card whose footer sat under the button once #98 added a sixth
 * element below Coach.
 *
 * So the constant moved to `@/theme` and this asserts every tab uses it. The
 * point is the FIFTH tab, and the person adding it who has never read #96.
 *
 * ## Why a source scan
 *
 * RNTL runs no Yoga layout pass — a view under the FAB still "renders" and every
 * assertion against it passes, which is how this class shipped twice already.
 * Only a device or a source rule can see it, and a device cannot run in CI.
 * This is the cheap half; the device screenshot is the other half.
 */

const TABS: { label: string; file: string }[] = [
  { label: 'Today', file: 'app/(app)/index.tsx' },
  { label: 'Trends', file: 'app/(app)/trends.tsx' },
  { label: 'Body', file: 'app/(app)/body.tsx' },
  // Train's styles are extracted to a component module rather than living in
  // the route file, so the scan follows the styles, not the screen.
  { label: 'Train', file: 'components/train/train-styles.ts' },
];

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the floating + button does not cover the bottom of a tab', () => {
  it.each(TABS)('$label reserves FAB_BAND at the bottom of its scroll content', ({ file }) => {
    const src = read(file);
    expect(src).toMatch(/FAB_BAND/);
    // Imported from the shared module, never redeclared. A local copy is the
    // original defect: it cannot be found by the next tab.
    expect(src).not.toMatch(/const\s+FAB_BAND\s*=/);
  });

  it('defines FAB_BAND once, in the theme, at least as tall as the button', () => {
    const theme = read('theme.ts');
    const m = /export const FAB_BAND = (\d+);/.exec(theme);
    // jest's `expect` takes no message argument (that is vitest); the assertion
    // is named by the `it` instead.
    expect(m).not.toBeNull();
    const band = Number(m![1]);

    // Read the button's real size out of the component rather than hard-coding
    // it here — a second copy of that number is how this drifts back.
    const dial = read('components/LogSpeedDial.tsx');
    const size = /width:\s*(\d+),\s*\n\s*height:\s*\1,/.exec(dial);
    expect(size).not.toBeNull();
    expect(band).toBeGreaterThanOrEqual(Number(size![1]));
  });

  it('no tab still stops its scroll content at space.xl', () => {
    // The exact shape that shipped #96: `padding: space.xl` with no
    // `paddingBottom` override, so the bottom inherits 24 dp.
    const offenders = TABS.filter(({ file }) =>
      /body:\s*\{\s*padding:\s*space\.xl,\s*gap:/.test(read(file)),
    ).map((t) => t.label);
    // Reported as a LIST rather than one failing assertion per tab, so a
    // regression names every screen it broke in one run.
    expect(offenders).toEqual([]);
  });
});
