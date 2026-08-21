import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { httpsCallable } from 'firebase/functions';
import { type ScannedFoodItem, type ScannedItemSource } from '@macrolog/core';
import { functions } from '@/lib/firebase';

/**
 * Meal photo → itemized macros (ADR-0015 §1). Mirrors the PWA's photo path:
 * pick → downscale to a 768px JPEG (keeps the base64 well under the CF's ~15 MB
 * cap) → base64 → the `analyzePhoto` Cloud Function.
 *
 * The function does **recognition + portion** with a vision model and resolves
 * the macros from the bundled USDA database server-side, so what arrives here is
 * already a list of foods with grounded numbers — never a black-box total.
 *
 * ## Why the flat-total path below still exists
 *
 * `analyzePhoto`'s response is additive: it returns `items[]` AND the old
 * whole-meal `calories`/`protein`/… fields. This adapter prefers `items` and
 * falls back to synthesising a single item from the totals. That fallback is not
 * dead code — it is what runs if this build is ever pointed at an older
 * deployment, and it costs four lines to keep the screen from rendering empty.
 */

export type ScanSource = 'camera' | 'library';

export interface MealScan {
  items: ScannedFoodItem[];
  /** 'low' triggers the "double-check this" hint in review. */
  confidence: 'low' | 'medium' | 'high';
  /** Scans left today (decorative for unlimited tiers). */
  photosRemaining: number;
}

interface AnalyzePhotoItem {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: ScannedItemSource;
  fdcId: string | null;
  matchedDescription: string | null;
}

interface AnalyzePhotoResult {
  items?: AnalyzePhotoItem[];
  source?: ScannedItemSource;
  calories: number;
  protein: number;
  carbs: number | null;
  fat: number | null;
  description: string;
  confidence: 'low' | 'medium' | 'high';
  photosRemaining: number;
}

const CONFIDENCE_SCORE: Record<AnalyzePhotoResult['confidence'], number> = {
  low: 0.4,
  medium: 0.7,
  high: 0.9,
};

/**
 * Long edge the photo is downscaled to before upload.
 *
 * **768, lowered from 1080 on 2026-08-21, and it is free.** Measured on the
 * same photo with the production prompt and schema: item detection identical,
 * and Gemini billed *exactly* the same 1,009 input tokens either way — the API
 * tiles both resolutions into the same image-token budget, so the extra pixels
 * never reached the model in the first place. What they did do is travel:
 * base64 bytes fell 33.9 KB → 21.4 KB on that (simple) test image, and on a
 * real photograph the ratio tracks the pixel ratio, so roughly half the upload.
 *
 * That upload is the one leg of a scan that scales with the user's connection
 * rather than with our infrastructure, which makes it the leg worth shrinking:
 * server-side latency is measured and bounded, cellular uplink is neither.
 *
 * Do not raise this to buy accuracy without re-measuring. The model's weak
 * number is the PORTION, not the identification (ADR-0015 §1), and portion
 * comes from plate-scale cues that survive downscaling fine.
 */
const UPLOAD_MAX_EDGE = 768;

/**
 * Acquire a meal photo — the picker half only. Returns the local URI, or null
 * if permission is denied or the user cancels. `camera` opens the OS camera on
 * device; on web both sources fall back to the file picker.
 *
 * Split from {@link encodeMealPhoto} on purpose. Together they used to be one
 * `captureMealPhoto`, which the scan screen awaited *before* it switched to its
 * analyzing state — so the resize and base64 encode (half a second to a second
 * and a half on a mid device) ran with the intro screen still up and nothing
 * moving. Two functions let the caller show the captured frame the instant the
 * picker returns and encode behind it. Nothing got faster; the dead air went
 * away, which is the part the user experiences.
 */
export async function pickMealPhoto(source: ScanSource): Promise<string | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const picker = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await picker({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
  if (result.canceled || !result.assets?.length) return null;

  return result.assets[0].uri;
}

/** Downscale a picked photo and return it as JPEG base64, ready for upload. */
export async function encodeMealPhoto(uri: string): Promise<string | null> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: UPLOAD_MAX_EDGE }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  image.release();
  return saved.base64 ?? null;
}

const nonNeg = (n: number | null | undefined) => Math.max(0, Number(n) || 0);

/** Send a base64 meal photo to `analyzePhoto` and normalize to a MealScan. */
export async function analyzeMealPhoto(photoBase64: string, locale: string): Promise<MealScan> {
  const call = httpsCallable<{ photoBase64: string; locale: string }, AnalyzePhotoResult>(functions, 'analyzePhoto');
  const { data } = await call({ photoBase64, locale });

  const items: ScannedFoodItem[] = data.items?.length
    ? data.items.map((i) => ({
        name: i.name,
        grams: nonNeg(i.grams),
        calories: nonNeg(i.calories),
        protein: nonNeg(i.protein),
        carbs: nonNeg(i.carbs),
        fat: nonNeg(i.fat),
        confidence: i.confidence ?? 0.7,
        source: i.source,
        fdcId: i.fdcId,
        matchedDescription: i.matchedDescription,
      }))
    : [
        {
          // Older deployment: one whole-meal total, no per-item breakdown.
          name: data.description || 'Meal',
          grams: 0,
          calories: nonNeg(data.calories),
          protein: nonNeg(data.protein),
          carbs: nonNeg(data.carbs),
          fat: nonNeg(data.fat),
          confidence: CONFIDENCE_SCORE[data.confidence] ?? 0.7,
        },
      ];

  return { items, confidence: data.confidence, photosRemaining: data.photosRemaining };
}
