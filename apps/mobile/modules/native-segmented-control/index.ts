import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

/**
 * NativeSegmentedControl — the bridge behind `src/components/charts/
 * SegmentedControl.tsx`. iOS: a `UISegmentedControl`; Android: Material 3
 * segmented buttons (`MaterialButtonToggleGroup`). Screens use the component,
 * not this file.
 *
 * Looked up only when the module is present — absent (Expo Go, jest, a binary
 * older than this module that an OTA reached) the view is `null` and the
 * component draws its own JS control. See `modules/chart-accessibility/
 * index.ts` for why `requireNativeView` must not be called on a binary that
 * lacks the view.
 */

export interface NativeSegment {
  label: string;
  /** Spoken instead of `label` ("3 months" for "3M"). */
  a11yLabel?: string;
  /** iOS: the segment's accessibilityIdentifier; Android: its resource id —
   *  where Maestro looks. */
  testID?: string;
}

/** Android colours (iOS draws the system's own). `#rrggbb` strings. */
export interface NativeSegmentColors {
  text: string;
  selectedText: string;
  selectedBackground: string;
  border: string;
}

export interface NativeSegmentedControlViewProps extends ViewProps {
  segments: NativeSegment[];
  selectedIndex: number;
  enabled?: boolean;
  /** Points / dp, already scaled for the font size by the caller. */
  fontSize: number;
  /** iOS: draw the control dark whatever the theme (the hero panel). */
  forceDark?: boolean;
  colors: NativeSegmentColors;
  /** Android: the outer corners, dp. */
  cornerRadius?: number;
  onChange?: (event: { nativeEvent: { index: number } }) => void;
}

const present = requireOptionalNativeModule('NativeSegmentedControl') != null;

let view: ComponentType<NativeSegmentedControlViewProps> | null = null;
if (present) {
  try {
    view = requireNativeView<NativeSegmentedControlViewProps>('NativeSegmentedControl');
  } catch {
    view = null;
  }
}

/** The native view, or `null` where it does not exist. */
export const NativeSegmentedControlView = view;
