import type { WidgetView } from '@macrolog/core';

/**
 * The Android widget in protein-first mode (2026-11-20): protein is the big
 * number, calories are what was eaten beside the range, and the words "left"
 * and "over" never sit next to a calorie number.
 *
 * Read as plain JSX props, not mounted — see `widget-wide-face.test.tsx`.
 */
jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TodayWidget } = require('@/widgets/TodayWidget') as {
  TodayWidget: (p: { view: WidgetView; width?: number }) => unknown;
};

function texts(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const el = node as { props?: Record<string, unknown> };
  if (el.props) {
    if (typeof el.props.text === 'string') out.push(el.props.text);
    const kids = el.props.children;
    for (const k of Array.isArray(kids) ? kids : [kids]) texts(k, out);
  }
  return out;
}

const ready = (over: Partial<Extract<WidgetView, { state: 'ready' }>> = {}): WidgetView => ({
  state: 'ready',
  dateKey: '2026-11-20',
  kcal: { value: 430, over: false, progress: 0.77 },
  protein: { value: 48, over: false, progress: 0.66 },
  updatedMs: 1,
  locale: 'en',
  quickAdd: [],
  ...over,
});

const pf = { kcalConsumed: 1420, proteinConsumed: 92, kcalMin: 1850, kcalMax: 2150 };

describe('the widget, protein first', () => {
  it('leads with protein left and shows calories beside the range', () => {
    const t = texts(TodayWidget({ view: ready({ proteinFirst: pf }) }));
    expect(t.slice(0, 3)).toEqual(['48', 'g protein left', '1,420 kcal · 1,850–2,150']);
    expect(t.join(' ')).not.toMatch(/kcal (left|over)/);
  });

  it('shows the protein eaten, and says the target is met, once it is', () => {
    const t = texts(TodayWidget({ view: ready({ protein: { value: 11, over: true, progress: 1 }, proteinFirst: { ...pf, proteinConsumed: 151 } }) }));
    expect(t.slice(0, 2)).toEqual(['151', 'g protein · target met']);
  });

  it('shows one calorie number when the range has collapsed', () => {
    const t = texts(TodayWidget({ view: ready({ proteinFirst: { ...pf, kcalMin: 1850, kcalMax: 1850 } }) }));
    expect(t[2]).toBe('1,420 kcal · 1,850');
  });

  it('speaks the snapshot\'s language', () => {
    const t = texts(TodayWidget({ view: ready({ locale: 'es-PR', proteinFirst: pf }) }));
    expect(t[1]).toBe('g de proteína restantes');
  });

  it('without the mode, the face is the calorie-first one it always was', () => {
    const t = texts(TodayWidget({ view: ready() }));
    expect(t.slice(0, 3)).toEqual(['430', 'kcal left', '48g protein left']);
  });
});
