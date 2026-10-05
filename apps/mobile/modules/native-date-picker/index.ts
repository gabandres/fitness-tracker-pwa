import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

/**
 * NativeDatePicker — the bridge behind `src/components/NativeDatePicker.tsx`
 * (`NativeDateField`). Screens use that component; this file only finds the
 * native halves:
 *
 * - **iOS**: a view, `UIDatePicker` in the `.compact` style
 *   (`ios/NativeDatePickerModule.swift`).
 * - **Android**: a function, `show(...)`, that puts up MaterialDatePicker /
 *   MaterialTimePicker and resolves the chosen instant
 *   (`android/.../NativeDatePickerModule.kt`).
 *
 * Optional on both, like every bridge here: absent in Expo Go, on web, and in
 * every binary older than the one that introduced it — which an OTA can still
 * reach. Absent means `NativeDatePickerView === null` and
 * `isNativeDatePickerAvailable === false`, and the component renders the JS
 * steppers it always had. `requireNativeView` is only called when the module is
 * present: on a binary without it, it returns a component that draws an
 * "unimplemented" box (the note in `modules/chart-accessibility/index.ts`).
 */

export type NativeDateMode = 'date' | 'time' | 'dateAndTime';

export interface NativeDatePickerViewProps extends ViewProps {
  mode?: NativeDateMode;
  /** Epoch ms. */
  value: number;
  minimumDate?: number | null;
  maximumDate?: number | null;
  minuteInterval?: number;
  /** BCP-47, e.g. `es-PR`. Also decides 12/24-hour. */
  locale?: string;
  tintColor?: string;
  enabled?: boolean;
  pickerAccessibilityLabel?: string;
  pickerTestID?: string;
  onChange?: (event: { nativeEvent: { timestamp: number } }) => void;
}

export interface ShowNativeDatePickerOptions {
  mode: NativeDateMode;
  /** Epoch ms. */
  value: number;
  min?: number | null;
  max?: number | null;
  /** Unset = the phone's own setting. */
  is24h?: boolean;
  /** `platform` = android.app dialogs — the OTA escape hatch the Kotlin header
   *  describes. Default `material`. */
  style?: 'material' | 'platform';
}

interface NativeDatePickerModule {
  show?(options: ShowNativeDatePickerOptions): Promise<number | null>;
}

const native = requireOptionalNativeModule<NativeDatePickerModule>('NativeDatePicker');

/** True when this binary carries the module (either platform). */
export const isNativeDatePickerAvailable = native != null;

let view: ComponentType<NativeDatePickerViewProps> | null = null;
if (native != null && Platform.OS === 'ios') {
  try {
    view = requireNativeView<NativeDatePickerViewProps>('NativeDatePicker');
  } catch {
    view = null;
  }
}

/** The iOS compact picker view, or `null` where it does not exist. */
export const NativeDatePickerView = view;

/** True where `showNativeDatePicker` can open a dialog (Android, new binary). */
export const canShowNativeDatePicker =
  Platform.OS === 'android' && typeof native?.show === 'function';

/**
 * Android: open the system picker. Resolves the chosen instant (epoch ms), or
 * `null` when dismissed, unavailable, or anything went wrong. Never rejects.
 */
export async function showNativeDatePicker(options: ShowNativeDatePickerOptions): Promise<number | null> {
  if (!canShowNativeDatePicker) return null;
  try {
    const out = await native!.show!({
      ...options,
      min: options.min ?? undefined,
      max: options.max ?? undefined,
    });
    return typeof out === 'number' && Number.isFinite(out) ? out : null;
  } catch {
    return null;
  }
}
