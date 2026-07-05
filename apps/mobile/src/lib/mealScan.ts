import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { httpsCallable } from 'firebase/functions';
import { type ScannedFoodItem } from '@macrolog/core';
import { functions } from '@/lib/firebase';

/**
 * Meal photo → macros (ADR-0015). Mirrors the PWA's photo path: capture/pick →
 * downscale to 1080px JPEG (keeps the base64 well under the CF's ~15 MB cap) →
 * base64 → the live `analyzePhoto` Cloud Function (Gemini, key server-side).
 *
 * The deployed function currently returns ONE whole-meal total; we map it to a
 * single {@link ScannedFoodItem} so the review UI is already itemized-shaped —
 * when the CF grows per-item USDA resolution, the same screen renders N rows
 * with no client change.
 */

export type ScanSource = 'camera' | 'library';

export interface MealScan {
  items: ScannedFoodItem[];
  /** 'low' triggers the "double-check this" hint in review. */
  confidence: 'low' | 'medium' | 'high';
  /** Scans left today (decorative for unlimited tiers). */
  photosRemaining: number;
}

interface AnalyzePhotoResult {
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
 * Acquire a meal photo and return it as a downscaled JPEG base64 string, or
 * null if permission is denied or the user cancels. `camera` opens the OS
 * camera on device; on web both sources fall back to the file picker.
 */
export async function captureMealPhoto(source: ScanSource): Promise<string | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const picker = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const result = await picker({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
  if (result.canceled || !result.assets?.length) return null;

  const image = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1080 }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  image.release();
  return saved.base64 ?? null;
}

/** Send a base64 meal photo to `analyzePhoto` and normalize to a MealScan. */
export async function analyzeMealPhoto(photoBase64: string, locale: string): Promise<MealScan> {
  const call = httpsCallable<{ photoBase64: string; locale: string }, AnalyzePhotoResult>(functions, 'analyzePhoto');
  const { data } = await call({ photoBase64, locale });
  const item: ScannedFoodItem = {
    name: data.description || 'Meal',
    grams: 0, // whole-meal total — no single portion weight (yet)
    calories: Math.max(0, Math.round(data.calories)),
    protein: Math.max(0, Math.round(data.protein ?? 0)),
    carbs: Math.max(0, Math.round(data.carbs ?? 0)),
    fat: Math.max(0, Math.round(data.fat ?? 0)),
    confidence: CONFIDENCE_SCORE[data.confidence] ?? 0.7,
  };
  return { items: [item], confidence: data.confidence, photosRemaining: data.photosRemaining };
}
