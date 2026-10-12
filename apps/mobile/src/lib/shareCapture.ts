import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

/** Capture the referenced view to a PNG and open the OS share sheet. Native
 *  only — the `.web` sibling is a no-op (react-native-view-shot's web build
 *  pulls html2canvas, which isn't bundled for web export). */
export async function captureAndShare(
  ref: RefObject<View | null>,
  dialogTitle: string,
  /** The file's name, no extension. Android only in view-shot 5.1 (it adds a
   *  random suffix); iOS keeps its UUID name. */
  fileName?: string,
): Promise<void> {
  const uri = await captureRef(ref, { format: 'png', quality: 1, ...(fileName ? { fileName: `${fileName}-` } : {}) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle });
  }
}
