// Data export — gather every tracked dataset, serialize to the shared
// long-format CSV (@macrolog/core buildCsv, same output as the PWA), then hand
// it to the OS share sheet on device. On web (Expo web / Playwright) it falls
// back to a browser download so the flow is verifiable off-device.

import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { buildCsv } from '@macrolog/core';
import {
  getAllDailySleep,
  getAllDailyWater,
  getAllDailyWeights,
  getAllLogs,
  getAllMeasurements,
  getAllSessions,
} from './ledger';

/** Local timestamp (no colons — invalid in filenames) so repeat same-day
 *  exports get distinct names instead of colliding. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface ExportResult {
  /** Approximate row count (logs + measurements + sessions) for a toast. */
  rows: number;
  /** True when the OS share sheet was actually opened (native only). */
  shared: boolean;
}

/**
 * Read all of the user's data one-shot, build the CSV, and either open the
 * native share sheet (device) or trigger a browser download (web). A UTF-8 BOM
 * is prepended so Excel renders accented meal labels correctly.
 */
export async function exportDataCsv(uid: string): Promise<ExportResult> {
  const [logs, measurements, dailyWeights, dailyWater, dailySleep, workoutSessions] =
    await Promise.all([
      getAllLogs(uid),
      getAllMeasurements(uid),
      getAllDailyWeights(uid),
      getAllDailyWater(uid),
      getAllDailySleep(uid),
      getAllSessions(uid),
    ]);

  const csv = '﻿' + buildCsv({
    logs,
    measurements,
    dailyWeights,
    dailyWater,
    dailySleep,
    workoutSessions,
  });
  const rows = logs.length + measurements.length + workoutSessions.length;
  const filename = `macrolog-export-${stamp()}.csv`;

  if (Platform.OS === 'web') {
    // Expo web / Playwright: browser download (no native FS/share module).
    const g = globalThis as any;
    const blob = new g.Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement('a');
    a.href = url;
    a.download = filename;
    g.document.body.appendChild(a);
    a.click();
    g.document.body.removeChild(a);
    setTimeout(() => g.URL.revokeObjectURL(url), 1000);
    return { rows, shared: false };
  }

  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(csv);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export Macro Log data',
      UTI: 'public.comma-separated-values-text',
    });
    return { rows, shared: true };
  }
  return { rows, shared: false };
}
