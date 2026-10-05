import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import type { Stack } from 'expo-router';

type ScreenOptions = NonNullable<ComponentProps<typeof Stack.Screen>['options']>;

/** Parses the `detents` param `BottomSheet native` pushes: `'fit'` or `'0.6,1'`. */
export function parseDetents(raw: unknown): number[] | 'fitToContents' {
  if (raw === 'fit') return 'fitToContents';
  const list = typeof raw === 'string'
    ? raw.split(',').map(Number).filter((n) => n > 0 && n <= 1).sort((a, b) => a - b)
    : [];
  return list.length ? list : [1];
}

/**
 * Root-stack options for the native `sheet` route (UX_AUDIT S20). The detents
 * ride in on the route params because each sheet asks for its own.
 */
export const sheetOptions: ScreenOptions = ({ route }: { route: { params?: object } }) => ({
  presentation: 'formSheet',
  animation: 'default',
  gestureEnabled: true,
  sheetGrabberVisible: true,
  sheetAllowedDetents: parseDetents((route.params as { detents?: unknown } | undefined)?.detents),
  sheetInitialDetentIndex: 0,
  sheetExpandsWhenScrolledToEdge: true,
  // Transparent so iOS 26 can draw its own material behind the content (and
  // on Android the route paints the rounded surface itself).
  contentStyle: { backgroundColor: 'transparent' },
  // Android: Material's modal sheet — 28 dp corners, a low elevation (the
  // scrim carries the depth), drawn below the status bar.
  sheetCornerRadius: Platform.OS === 'android' ? 28 : undefined,
  sheetElevation: 1,
  sheetShouldOverflowTopInset: false,
});
