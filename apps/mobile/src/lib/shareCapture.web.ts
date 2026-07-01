import type { RefObject } from 'react';
import type { View } from 'react-native';

// Share-card capture is native-only: react-native-view-shot's web build pulls
// html2canvas (not bundled for web export), so this is a no-op on web.
export async function captureAndShare(_ref: RefObject<View | null>, _dialogTitle: string): Promise<void> {
  /* no-op on web */
}
