import type { WidgetSnapshot, WidgetView } from '@macrolog/core';
import { QUICK_ADD_ACTION, quickAddSlotFrom } from '@/widgets/actions';

/**
 * The Android widget's tap path (ADR-0020).
 *
 * This is the one seam in quick-add that nothing else can check. The task
 * handler runs headless, its only output is a `renderWidget` call, and every
 * failure in it is *invisible*: a dead button and an unchanged face look exactly
 * like a user who never tapped. The `useMemoCache` defect shipped in three
 * Android builds for the same reason.
 *
 * The rendered tree is read as plain JSX props rather than through a renderer —
 * `react-native-android-widget` builds `RemoteViews` from a raw function call,
 * not a React render, so there is no tree to mount here anyway.
 */

jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
}));

const mockWidget: { snapshot: WidgetSnapshot | null; saved: WidgetSnapshot[] } = {
  snapshot: null,
  saved: [],
};
const mockAddLogWithId = jest.fn<Promise<void>, [string, string, unknown]>();
const mockAuth: { user: { uid: string } | null } = { user: { uid: 'u1' } };

const mockRedraw = jest.fn<Promise<void>, [WidgetSnapshot]>();
const mockWatchPush = jest.fn<void, [WidgetSnapshot]>();

jest.mock('@/lib/widget', () => ({
  readWidgetSnapshot: () => Promise.resolve(mockWidget.snapshot),
  saveWidgetSnapshot: (s: WidgetSnapshot) => {
    mockWidget.saved.push(s);
    return Promise.resolve();
  },
  requestWidgetRedraw: (s: WidgetSnapshot) => mockRedraw(s),
  // The watch half of the same tap. Android never reaches it (the real
  // implementation is iOS-gated), but the module has to export it or the
  // shared `performQuickAdd` throws on the way past.
  assertWatchSnapshot: (s: WidgetSnapshot) => mockWatchPush(s),
}));

// `quick-add.ts` itself is REAL here. The tap path is the handler plus the
// shared `performQuickAdd`, and mocking the middle of it would leave the one
// decision that matters — whether a tap writes — untested on this path.
jest.mock('@/lib/ledger', () => ({
  addLogWithId: (...args: [string, string, unknown]) => mockAddLogWithId(...args),
}));
jest.mock('@/lib/health-sync', () => ({ exportNutrition: () => Promise.resolve() }));
jest.mock('@/lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() {
      return mockAuth.user;
    },
    // Fires immediately with the current value, which is what the real SDK does
    // once persistence has resolved. The cold-start race has its own test in
    // `quick-add.test.ts`.
    onAuthStateChanged: (cb: (u: { uid: string } | null) => void) => {
      cb(mockAuth.user);
      return () => {};
    },
  },
}));

import { widgetTaskHandler } from '@/widgets/widget-task-handler';

const shake = { presetId: 'p1', name: 'Protein shake', calories: 180, protein: 32 };

function snapshot(over: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    v: 1,
    dateKey: today(),
    kcalConsumed: 1200,
    kcalTarget: 2000,
    proteinConsumed: 90,
    proteinTarget: 160,
    updatedMs: 1_700_000_000_000,
    locale: 'en',
    quickAdd: [shake],
    ...over,
  };
}

/** The handler compares against the widget's own clock, so the fixture has to
 *  be "today" or every render collapses to the stale empty state. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function click(data: Record<string, unknown> = { slot: 0 }, action = QUICK_ADD_ACTION) {
  const renderWidget = jest.fn();
  return {
    renderWidget,
    props: {
      widgetAction: 'WIDGET_CLICK' as const,
      widgetInfo: { widgetName: 'Today' },
      clickAction: action,
      clickActionData: data,
      renderWidget,
    },
  };
}

/** What the face is actually drawing. */
function viewOf(renderWidget: jest.Mock): WidgetView {
  return renderWidget.mock.calls[0][0].props.view as WidgetView;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWidget.snapshot = snapshot();
  mockWidget.saved = [];
  mockAuth.user = { uid: 'u1' };
  mockAddLogWithId.mockResolvedValue(undefined);
  mockRedraw.mockResolvedValue(undefined);
});

describe('quick-add button tap', () => {
  it('logs the tapped slot', async () => {
    const { props } = click();
    await widgetTaskHandler(props as never);
    expect(mockAddLogWithId).toHaveBeenCalledTimes(1);
    expect(mockAddLogWithId.mock.calls[0][2]).toMatchObject({
      calories: 180,
      protein: 32,
      mealLabel: 'Protein shake',
    });
  });

  it('redraws with the new totals — the redraw IS the receipt', async () => {
    const { props, renderWidget } = click();
    await widgetTaskHandler(props as never);
    const view = viewOf(renderWidget);
    // 2000 - (1200 + 180) = 620 kcal left, 160 - (90 + 32) = 38g protein left.
    expect(view.state === 'ready' && view.kcal.value).toBe(620);
    expect(view.state === 'ready' && view.protein.value).toBe(38);
  });

  it('persists the optimistic snapshot, so an OS-driven redraw agrees', async () => {
    const { props } = click();
    await widgetTaskHandler(props as never);
    expect(mockWidget.saved).toHaveLength(1);
    expect(mockWidget.saved[0].kcalConsumed).toBe(1380);
  });

  it('writes before it redraws — a moved number means a row that exists', async () => {
    const order: string[] = [];
    mockAddLogWithId.mockImplementation(async () => {
      order.push('log');
    });
    const { props, renderWidget } = click();
    renderWidget.mockImplementation(() => order.push('render'));
    await widgetTaskHandler(props as never);
    expect(order).toEqual(['log', 'render']);
  });

  it('keeps the buttons on the redrawn face', async () => {
    const { props, renderWidget } = click();
    await widgetTaskHandler(props as never);
    const view = viewOf(renderWidget);
    expect(view.state === 'ready' && view.quickAdd).toEqual([shake]);
  });

  it('moves the numbers for a QUEUED write too — it will land', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    const { props, renderWidget } = click();
    await widgetTaskHandler(props as never);
    expect(viewOf(renderWidget)).toMatchObject({ state: 'ready' });
    expect(mockWidget.saved[0].kcalConsumed).toBe(1380);
  });

  it('does NOT move the numbers when signed out — nothing was written', async () => {
    mockAuth.user = null;
    const { props, renderWidget } = click();
    await widgetTaskHandler(props as never);
    const view = viewOf(renderWidget);
    expect(view.state === 'ready' && view.kcal.value).toBe(800);
    expect(mockWidget.saved).toEqual([]);
  });
});

describe('taps that must not write', () => {
  it('ignores a slot with no preset behind it', async () => {
    const { props, renderWidget } = click({ slot: 2 });
    await widgetTaskHandler(props as never);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(mockWidget.saved).toEqual([]);
  });

  it('ignores an unknown click action', async () => {
    const { props } = click({ slot: 0 }, 'SOMETHING_ELSE');
    await widgetTaskHandler(props as never);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
  });

  it('ignores a tap on a snapshot that carries no slots at all', async () => {
    mockWidget.snapshot = snapshot({ quickAdd: undefined });
    const { props } = click();
    await widgetTaskHandler(props as never);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
  });

  it('ignores a tap with nothing on disk yet', async () => {
    mockWidget.snapshot = null;
    const { props, renderWidget } = click();
    await widgetTaskHandler(props as never);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
    expect(viewOf(renderWidget).state).toBe('empty');
  });

  it('still redraws on a dead tap, so a stale button disappears', async () => {
    const { props, renderWidget } = click({ slot: 9 });
    await widgetTaskHandler(props as never);
    expect(renderWidget).toHaveBeenCalled();
  });
});

describe('quickAddSlotFrom', () => {
  // The payload survived a PendingIntent extras bundle and may have been minted
  // by a widget instance placed before this version existed.
  it('reads a numeric slot', () => {
    expect(quickAddSlotFrom({ slot: 2 })).toBe(2);
  });

  it('reads a stringified slot', () => {
    expect(quickAddSlotFrom({ slot: '1' })).toBe(1);
  });

  it.each([
    ['absent data', undefined],
    ['no slot key', {}],
    ['a negative index', { slot: -1 }],
    ['a fraction', { slot: 1.5 }],
    ['a word', { slot: 'first' }],
    ['a null', { slot: null }],
  ])('is null for %s', (_label, data) => {
    expect(quickAddSlotFrom(data as Record<string, unknown> | undefined)).toBeNull();
  });
});

describe('the other widget actions still work', () => {
  it.each(['WIDGET_ADDED', 'WIDGET_UPDATE', 'WIDGET_RESIZED'])('%s draws the snapshot', async (action) => {
    const renderWidget = jest.fn();
    await widgetTaskHandler({
      widgetAction: action,
      widgetInfo: { widgetName: 'Today' },
      renderWidget,
    } as never);
    expect(viewOf(renderWidget).state).toBe('ready');
    expect(mockAddLogWithId).not.toHaveBeenCalled();
  });

  it('WIDGET_DELETED neither draws nor writes', async () => {
    const renderWidget = jest.fn();
    await widgetTaskHandler({
      widgetAction: 'WIDGET_DELETED',
      widgetInfo: { widgetName: 'Today' },
      renderWidget,
    } as never);
    expect(renderWidget).not.toHaveBeenCalled();
    expect(mockWidget.saved).toEqual([]);
  });
});

// ─── The Quick Settings tile's headless task ────────────────────
// Same shared action, one difference: a tile is not a widget, so any placed
// widget has to be asked to redraw rather than handed a `renderWidget`.

describe('quickAddTileTask', () => {
  it('logs slot 1 and asks the widget to redraw', async () => {
    const { quickAddTileTask } = require('@/widgets/quick-add-tile-task');
    await quickAddTileTask({ slot: 0 });
    expect(mockAddLogWithId).toHaveBeenCalledTimes(1);
    expect(mockWidget.saved[0].kcalConsumed).toBe(1380);
    expect(mockRedraw).toHaveBeenCalledTimes(1);
  });

  it('defaults to slot 1 when the intent carried no extra', async () => {
    const { quickAddTileTask } = require('@/widgets/quick-add-tile-task');
    await quickAddTileTask(undefined);
    expect(mockAddLogWithId).toHaveBeenCalledTimes(1);
  });

  it('spends no widget update when signed out', async () => {
    mockAuth.user = null;
    const { quickAddTileTask } = require('@/widgets/quick-add-tile-task');
    await quickAddTileTask({ slot: 0 });
    expect(mockAddLogWithId).not.toHaveBeenCalled();
    expect(mockRedraw).not.toHaveBeenCalled();
  });

  it('spends no widget update on a dead slot', async () => {
    const { quickAddTileTask } = require('@/widgets/quick-add-tile-task');
    await quickAddTileTask({ slot: 7 });
    expect(mockRedraw).not.toHaveBeenCalled();
  });

  it('never rejects — Android reports a thrown headless task as a crash', async () => {
    mockWidget.snapshot = snapshot();
    mockRedraw.mockRejectedValueOnce(new Error('no widget host'));
    const { quickAddTileTask } = require('@/widgets/quick-add-tile-task');
    await expect(quickAddTileTask({ slot: 0 })).resolves.toBeUndefined();
  });
});
