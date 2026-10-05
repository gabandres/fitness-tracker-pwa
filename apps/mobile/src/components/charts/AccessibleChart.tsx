import { View, type ViewProps } from 'react-native';
import { type ChartDescriptor, NativeAccessibleChart } from '../../../modules/chart-accessibility';

export type { ChartDescriptor } from '../../../modules/chart-accessibility';

/**
 * A chart's accessible element, with an audio graph on iOS.
 *
 * Drop-in for the `<View>` that already carries a chart's screen-reader props
 * (`accessible`, the summary label, `accessibilityRole="adjustable"`, the
 * increment/decrement actions): every prop goes through unchanged, so VoiceOver
 * lands on the same element and says the same words. What it adds, on iOS 15+,
 * is an `AXChartDescriptor` — VoiceOver's rotor then offers "Audio Graph" (the
 * series played as rising and falling pitch) and "Chart Details" (axes, series,
 * a point-by-point walk). The adjustable stepper stays the primary way in; the
 * audio graph is the "show me the shape" that one-day-at-a-time cannot give.
 *
 * Why it REPLACES the accessible `<View>` rather than wrapping it: VoiceOver
 * reads the descriptor off the element it focused, and a wrapper around an
 * accessible child is never focused itself. `modules/chart-accessibility`'s
 * header has the Fabric detail.
 *
 * Everywhere the native view is absent — Android, Expo Go, web, jest, and any
 * iOS binary older than the one that introduced it (an OTA can reach those) —
 * this is a plain `View` with the same props, and `descriptor` is ignored.
 * TalkBack has no audio-graph equivalent, so Android loses nothing it had.
 */
export function AccessibleChart({
  descriptor,
  ...rest
}: ViewProps & {
  /** `null` while there is nothing honest to describe (an empty range). */
  descriptor: ChartDescriptor | null;
}) {
  if (NativeAccessibleChart) return <NativeAccessibleChart {...rest} descriptor={descriptor} />;
  return <View {...rest} />;
}
