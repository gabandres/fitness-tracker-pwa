// The long-format serializer now lives in @macrolog/core (shared with the
// Expo app — see docs/adr/0012). This file keeps the DOM download wrapper and
// re-exports buildCsv/ExportData so existing `utils/csv-export` imports work.
export { buildCsv, type ExportData } from '@macrolog/core';

/** Trigger a browser download for the given CSV string. UTF-8 BOM
 *  prepended so Excel detects the encoding and renders non-ASCII
 *  meal labels (e.g. Spanish accents) correctly. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
