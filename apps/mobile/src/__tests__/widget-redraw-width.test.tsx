import type { WidgetSnapshot } from '@macrolog/core';
import { Platform } from 'react-native';

/**
 * 2026-10-15 audit, item 16: Android redraws ignored the instance's width.
 *
 * The OS hands every redraw a `WidgetInfo` carrying the placed instance's
 * size, and the width picks the face (`WIDE_MIN_DP`). Two paths dropped it —
 * `requestWidgetUpdate`'s `renderWidget` (every live update from the app) and
 * the quick-add click handler — so a WIDE widget was redrawn as the narrow
 * column after every log and every chip tap. Invisible to everything but a
 * home screen.
 */

const mockRender = jest.fn((snapshot: unknown, width?: number) => ({ snapshot, width }));
jest.mock('@/widgets/render', () => ({
  renderTodayWidget: (s: unknown, w?: number) => mockRender(s, w),
}));

const mockRequest = jest.fn();
jest.mock('react-native-android-widget', () => ({
  requestWidgetUpdate: (props: unknown) => mockRequest(props),
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
}));

jest.mock('@/lib/widget', () => ({
  ...jest.requireActual('@/lib/widget'),
  readWidgetSnapshot: () => Promise.resolve(mockSnap),
}));
jest.mock('@/lib/quick-add', () => ({ performQuickAdd: jest.fn() }));

const mockSnap = { v: 1, dateKey: '2026-10-15', kcalConsumed: 1, kcalTarget: 2, proteinConsumed: 1, proteinTarget: 2, updatedMs: 1, locale: 'en' } as WidgetSnapshot;
const SNAP = mockSnap;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
});

it('a live redraw renders each instance at the width the OS reports', async () => {
  const { requestWidgetRedraw } = require('@/lib/widget') as typeof import('@/lib/widget');
  await requestWidgetRedraw(SNAP);
  const { renderWidget } = mockRequest.mock.calls[0][0] as { renderWidget: (info: { width: number }) => unknown };
  renderWidget({ width: 320 });
  expect(mockRender).toHaveBeenLastCalledWith(SNAP, 320);
});

it('an unknown click redraws at the instance width too', async () => {
  const handler = (require('@/widgets/widget-task-handler') as typeof import('@/widgets/widget-task-handler')).widgetTaskHandler;
  const renderWidget = jest.fn();
  await handler({
    widgetAction: 'WIDGET_CLICK',
    widgetInfo: { widgetName: 'Today', width: 320 },
    clickAction: 'SOMETHING_ELSE',
    renderWidget,
  } as never);
  expect(mockRender).toHaveBeenLastCalledWith(SNAP, 320);
});
