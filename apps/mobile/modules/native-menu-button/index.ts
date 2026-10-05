import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

/**
 * NativeMenuButton — the bridge behind `src/components/MenuButton.tsx`. iOS: a
 * `UIButton` whose primary action is its `UIMenu`; Android: an anchored
 * `PopupMenu`. Screens use the component, not this file.
 *
 * Looked up only when the module is present — absent (Expo Go, web, a binary
 * older than this module that an OTA reached) the view is `null` and the
 * component falls back to the caller's own sheet. See
 * `modules/chart-accessibility/index.ts` for why `requireNativeView` must not
 * be called on a binary that lacks the view.
 */

export interface NativeMenuAction {
  key: string;
  title: string;
  /** iOS 15+: a second line under the title. */
  subtitle?: string;
  /** iOS: SF Symbol name. Ignored on Android. */
  sfSymbol?: string;
  destructive?: boolean;
  disabled?: boolean;
}

export interface NativeMenuButtonViewProps extends ViewProps {
  actions: NativeMenuAction[];
  /** iOS: the menu's header line. */
  title?: string;
  /** iOS: draw an SF Symbol as the face (no RN children). */
  showsIcon?: boolean;
  iconName?: string;
  iconSize?: number;
  iconColor?: string;
  enabled?: boolean;
  /** iOS: on the button, which is the one accessible element. */
  buttonAccessibilityLabel?: string;
  buttonAccessibilityHint?: string;
  buttonTestID?: string;
  onAction?: (event: { nativeEvent: { key: string } }) => void;
}

const present = requireOptionalNativeModule('NativeMenuButton') != null;

let view: ComponentType<NativeMenuButtonViewProps> | null = null;
if (present) {
  try {
    view = requireNativeView<NativeMenuButtonViewProps>('NativeMenuButton');
  } catch {
    view = null;
  }
}

/** The native view, or `null` where it does not exist. */
export const NativeMenuButtonView = view;
