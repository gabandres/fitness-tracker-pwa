/**
 * Nutrition-label scan, the app's half (2026-11-20): a photo of a packaged
 * food's label → the numbers printed on it → the review form, prefilled, with
 * "Save to My Foods" ready. Server half: `functions/src/label-scan.ts`.
 *
 * It rides the meal photo scan's callable (`analyzePhoto`, `mode: 'label'`), so
 * it spends the same daily scans and obeys the same kill switch
 * (`FEATURES.photoScan`). The model TRANSCRIBES; nothing it returns is saved
 * until the person has looked at the form.
 *
 * `scanLabel` is the whole flow as one module-level function that never
 * throws: the entry sheet awaits it and switches on the answer. A `try` with a
 * `finally` inside the component would make React Compiler skip all of
 * `EntrySheet`.
 */
import { httpsCallable } from 'firebase/functions';
import type { BarcodeEstimate } from '@/components/BarcodeScanner';
import { functions } from '@/lib/firebase';
import { type ScanErrorMessage, encodeMealPhoto, isPickDenied, pickMealPhoto, scanErrorMessage } from '@/lib/mealScan';

/** What the server read off the panel (`LabelFacts` in `label-scan.ts`). */
export interface LabelFacts {
  name: string;
  brand?: string;
  servingText?: string;
  servingGrams?: number;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  /** The calories and the macros on the read do not add up. */
  check?: true;
}

export type LabelScanOutcome =
  /** The picker was closed without a photo. Nothing to say. */
  | { kind: 'cancelled' }
  /** Camera permission is off. */
  | { kind: 'denied' }
  | { kind: 'label'; facts: LabelFacts }
  /** The provider answered and found no legible panel. A scan was spent. */
  | { kind: 'none' }
  | { kind: 'error'; message: ScanErrorMessage };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

/** The wire answer → facts, or null. The server sanitises; this only refuses
 *  a shape it does not recognise (an older or newer server). */
export function labelFactsOf(raw: unknown): LabelFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const calories = num(r.calories);
  if (calories === undefined) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const grams = num(r.servingGrams);
  return {
    name: str(r.name) ?? '',
    calories,
    ...(str(r.brand) ? { brand: str(r.brand) } : {}),
    ...(str(r.servingText) ? { servingText: str(r.servingText) } : {}),
    ...(grams !== undefined && grams > 0 ? { servingGrams: grams } : {}),
    ...(num(r.protein) !== undefined ? { protein: num(r.protein) } : {}),
    ...(num(r.carbs) !== undefined ? { carbs: num(r.carbs) } : {}),
    ...(num(r.fat) !== undefined ? { fat: num(r.fat) } : {}),
    ...(r.check === true ? { check: true as const } : {}),
  };
}

/** Send one encoded photo to be read as a label. Throws what the callable throws. */
export async function readNutritionLabel(photoBase64: string, locale: string): Promise<LabelFacts | null> {
  const call = httpsCallable<{ photoBase64: string; mode: 'label'; locale: string }, { label?: unknown }>(functions, 'analyzePhoto');
  const { data } = await call({ photoBase64, mode: 'label', locale });
  return labelFactsOf(data?.label);
}

/**
 * The facts as the review form takes a scanned product (`openBarcodeReview`):
 * `source: 'label'`, the gram weight when the label printed one, and the
 * barcode when the scan started from a barcode the database did not have —
 * so the next scan of that barcode finds this food in My Foods.
 */
export function labelEstimate(facts: LabelFacts, fallbackName: string, barcode?: string): BarcodeEstimate {
  const name = facts.name || fallbackName;
  return {
    calories: facts.calories,
    ...(facts.protein !== undefined ? { protein: facts.protein } : {}),
    ...(facts.carbs !== undefined ? { carbs: facts.carbs } : {}),
    ...(facts.fat !== undefined ? { fat: facts.fat } : {}),
    mealLabel: name,
    serving: {
      source: 'label',
      name,
      ...(facts.servingGrams ? { grams: facts.servingGrams } : {}),
      ...(facts.brand ? { brand: facts.brand } : {}),
      ...(barcode ? { barcode } : {}),
    },
  };
}

/** A failed LABEL read is not "try another angle of your meal". */
function labelError(e: unknown): ScanErrorMessage {
  const message = scanErrorMessage(e);
  return message.key === 'scan.failed' ? { key: 'label.failed' } : message;
}

/**
 * Camera → encode → read. Never throws; `onReading` fires once a photo is in
 * hand, for the "Reading the label…" line.
 */
export async function scanLabel(locale: string, onReading: () => void): Promise<LabelScanOutcome> {
  let uri: string | null = null;
  try {
    const picked = await pickMealPhoto('camera');
    if (isPickDenied(picked)) return { kind: 'denied' };
    uri = picked;
  } catch (e) {
    return { kind: 'error', message: labelError(e) };
  }
  if (!uri) return { kind: 'cancelled' };
  onReading();
  try {
    const encoded = await encodeMealPhoto(uri);
    if (!encoded) return { kind: 'error', message: { key: 'label.failed' } };
    const facts = await readNutritionLabel(encoded, locale);
    return facts ? { kind: 'label', facts } : { kind: 'none' };
  } catch (e) {
    return { kind: 'error', message: labelError(e) };
  }
}
