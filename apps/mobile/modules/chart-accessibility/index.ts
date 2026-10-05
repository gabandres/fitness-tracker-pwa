import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { ViewProps } from 'react-native';

/**
 * ChartAccessibility — the native view behind `AccessibleChart` (audio graphs,
 * `AXChartDescriptor`, iOS 15+). The component screens use is
 * `src/components/charts/AccessibleChart.tsx`; this file is only the bridge.
 *
 * The view is looked up ONLY when the module is present. `requireNativeView`
 * on a binary that lacks it would hand back a component that renders an
 * "unimplemented" box, which an OTA reaching an older binary would put in the
 * middle of Trends. So: module present → native view; absent (Android, Expo Go,
 * web, an older iOS binary) → `null`, and the wrapper renders a plain `View`.
 */

/** The JSON the Swift parser reads. Mirrors the shape documented at the top of
 *  `ios/ChartAccessibilityModule.swift`. */
export interface ChartDescriptor {
  title: string;
  summary?: string;
  /** `labels` → a categorical x axis (dates, here); otherwise numeric over `range`. */
  xAxis: { title: string; labels?: readonly string[]; range?: { min: number; max: number } };
  yAxis: { title: string; range: { min: number; max: number }; unit?: string; decimals?: number };
  series: readonly {
    name: string;
    /** A line (true) or separate readings (false). */
    continuous?: boolean;
    /** `x` is a label from `xAxis.labels` on a categorical axis, else a number.
     *  `y: null` is a gap — silence in the audio graph, never a zero. */
    values: readonly { x: string | number; y: number | null; label?: string }[];
  }[];
}

export type NativeAccessibleChartProps = ViewProps & { descriptor?: ChartDescriptor | null };

const present = requireOptionalNativeModule('ChartAccessibility') != null;

let view: ComponentType<NativeAccessibleChartProps> | null = null;
if (present) {
  try {
    view = requireNativeView<NativeAccessibleChartProps>('ChartAccessibility');
  } catch {
    view = null;
  }
}

/** The native view, or `null` where it does not exist. */
export const NativeAccessibleChart = view;
