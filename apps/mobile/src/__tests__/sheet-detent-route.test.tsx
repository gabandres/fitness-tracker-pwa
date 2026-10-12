import React from 'react';
import { Platform, Text } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * F12 (R33): the `sheet` route tracks an Android formSheet's detent and
 * publishes the band below the fold (`lib/sheet-detent.ts`). Driven with the
 * real route and a navigation object that emits `sheetDetentChange` the way
 * expo-router's native stack does.
 */
type DetentCb = (e: { data?: { index: number; stable: boolean } }) => void;
const mockNav = {
  cbs: new Set<DetentCb>(),
  goBack: jest.fn(),
  dispatch: jest.fn(),
  addListener(type: string, cb: DetentCb) {
    if (type === 'sheetDetentChange') mockNav.cbs.add(cb);
    return () => mockNav.cbs.delete(cb);
  },
};
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
  useNavigation: () => mockNav,
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

import SheetRoute from '@/app/sheet';
import { __resetSheetPortal, setSheetPortal } from '@/lib/sheet-portal';
import { useSheetHiddenBelow } from '@/lib/sheet-detent';

function Probe() {
  return <Text testID="probe">{String(Math.round(useSheetHiddenBelow()))}</Text>;
}

function publish(id: string) {
  setSheetPortal(id, {
    node: <Probe />, requestClose: () => true, guarded: false, overlays: false, visible: true, testID: 'route-surface',
  });
}
const emit = (index: number, stable: boolean) => act(() => { for (const cb of mockNav.cbs) cb({ data: { index, stable } }); });

beforeEach(() => {
  __resetSheetPortal();
  mockNav.cbs.clear();
});
afterEach(() => jest.restoreAllMocks());

describe('sheet route — Android detent band (F12)', () => {
  it('publishes the hidden band at the lower detent, 0 at the top, and ignores unstable mid-drag reports', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockParams = { id: 'sheet-d1', detents: '0.6,1' };
    publish('sheet-d1');
    const ui = await render(<SheetRoute />);
    await fireEvent(ui.getByTestId('route-surface'), 'layout', { nativeEvent: { layout: { height: 800, width: 400, x: 0, y: 0 } } });
    expect(ui.getByTestId('probe')).toHaveTextContent('320');
    await emit(1, true);
    expect(ui.getByTestId('probe')).toHaveTextContent('0');
    await emit(0, false);
    expect(ui.getByTestId('probe')).toHaveTextContent('0');
    await emit(0, true);
    expect(ui.getByTestId('probe')).toHaveTextContent('320');
  });

  it('a single-detent sheet and iOS publish nothing', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockParams = { id: 'sheet-d2', detents: '1' };
    publish('sheet-d2');
    const one = await render(<SheetRoute />);
    await fireEvent(one.getByTestId('route-surface'), 'layout', { nativeEvent: { layout: { height: 800, width: 400, x: 0, y: 0 } } });
    expect(one.getByTestId('probe')).toHaveTextContent('0');
    expect(mockNav.cbs.size).toBe(0);
  });

  it('iOS: no listener, no band', async () => {
    mockParams = { id: 'sheet-d3', detents: '0.6,1' };
    publish('sheet-d3');
    const ui = await render(<SheetRoute />);
    expect(mockNav.cbs.size).toBe(0);
    expect(ui.getByTestId('probe')).toHaveTextContent('0');
  });
});
