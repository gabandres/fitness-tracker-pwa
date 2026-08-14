import type { WidgetView } from '@macrolog/core';
import { QUICK_ADD_ACTION } from '@/widgets/actions';

/**
 * The wide (rectangular) Android widget face — N4b.
 *
 * Two properties are worth locking, and neither is observable on a device
 * without a home screen and a drag handle:
 *
 *  1. **Width picks the face.** The widget was `resizeMode: none` until
 *     2026-08-13, so `width` had no consumer and every instance drew the narrow
 *     column. A regression here is silent: a wide widget drawing the narrow face
 *     looks like a widget, just an empty one.
 *
 *  2. **Each chip logs its OWN slot.** The narrow face drew index 0 only, so the
 *     hardcoded `slot: 0` it shipped with was indistinguishable from correct.
 *     On the wide face that same constant logs the first preset three times —
 *     wrong food, silently, with the numbers moving so it looks like it worked.
 *     That is the worst failure this widget can have, and it arrives in the same
 *     commit as the feature that exposes it.
 *
 * The tree is read as plain JSX props rather than mounted: this library builds
 * `RemoteViews` from a raw function call, not a React render, so there is no
 * tree to mount — the same reason `widget-quick-add-click.test.tsx` does it.
 */

jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TodayWidget } = require('@/widgets/TodayWidget') as {
  TodayWidget: (p: { view: WidgetView; width?: number }) => unknown;
};

/** Every node in the returned tree, depth-first. */
function flatten(node: unknown, out: Record<string, unknown>[] = []) {
  if (!node || typeof node !== 'object') return out;
  const el = node as { props?: Record<string, unknown> };
  if (el.props) {
    out.push(el.props);
    const kids = el.props.children;
    for (const k of Array.isArray(kids) ? kids : [kids]) flatten(k, out);
  }
  return out;
}

/** The quick-add chips, in render order. */
function chips(view: WidgetView, width?: number) {
  return flatten(TodayWidget({ view, width })).filter(
    (p) => p.clickAction === QUICK_ADD_ACTION,
  );
}

/**
 * The `MacroBar` elements, one per macro.
 *
 * Matched on props, not on rendered output. `buildWidgetTree` calls components
 * as plain functions rather than rendering them (the reason `'use no memo'` is
 * load-bearing in `TodayWidget.tsx`), so a nested `<MacroBar/>` stays an
 * uninvoked element here and its inner rails do not exist to find.
 */
function bars(view: WidgetView, width?: number) {
  return flatten(TodayWidget({ view, width })).filter((p) => 'track' in p && 'progress' in p);
}

const SLOTS = {
  state: 'ready' as const,
  locale: 'en',
  kcal: { value: 1200, over: false, progress: 0.84 },
  protein: { value: 90, over: false, progress: 1.07 },
  quickAdd: [
    { presetId: 'p1', name: 'Oats', calories: 300, protein: 10 },
    { presetId: 'p2', name: 'Chicken', calories: 400, protein: 40 },
    { presetId: 'p3', name: 'Shake', calories: 200, protein: 25 },
  ],
};
const READY = SLOTS as unknown as WidgetView;

describe('Android widget — wide face', () => {
  it('draws one chip when narrow', () => {
    expect(chips(READY, 160)).toHaveLength(1);
  });

  it('draws up to three chips when wide', () => {
    expect(chips(READY, 320)).toHaveLength(3);
  });

  it('treats a missing width as narrow', () => {
    // `src/lib/widget.ts` renders without knowing any instance's size. Falling
    // back to the wide face there would draw three chips into a 2x2 cell.
    expect(chips(READY, undefined)).toHaveLength(1);
  });

  it('gives every chip its own slot index — not a hardcoded 0', () => {
    expect(chips(READY, 320).map((p) => (p.clickActionData as { slot: number }).slot)).toEqual([
      0, 1, 2,
    ]);
  });

  it('never offers more chips than the user has slots', () => {
    const one = { ...SLOTS, quickAdd: SLOTS.quickAdd.slice(0, 1) } as unknown as WidgetView;
    expect(chips(one, 320)).toHaveLength(1);
  });

  it('draws a progress bar per macro only when wide', () => {
    // `WidgetMetric.progress` has been computed for every view since the
    // snapshot shipped and drawn by nothing. A 2x2 cell has no room, so the
    // narrow face must stay bar-free — the same call iOS `systemSmall` makes.
    expect(bars(READY, 320)).toHaveLength(2);
    expect(bars(READY, 160)).toHaveLength(0);
  });

  it('gives each bar its own macro, not the same one twice', () => {
    // Both bars take a `progress` and a colour pair; crossing them would draw
    // calories twice and look entirely plausible on a home screen.
    const [kcalBar, proteinBar] = bars(READY, 320);
    expect(kcalBar.progress).toBe(0.84);
    expect(proteinBar.progress).toBe(1.07);
    expect(kcalBar.fill).not.toBe(proteinBar.fill);
    expect(kcalBar.track).not.toBe(proteinBar.track);
  });

  it('offers no chips on the empty face, at any width', () => {
    // An empty face is declining to describe the day; a button on it would log
    // into a day the widget will not show.
    const empty = { state: 'empty', locale: 'en' } as WidgetView;
    expect(chips(empty, 320)).toHaveLength(0);
    expect(chips(empty, 160)).toHaveLength(0);
  });
});
