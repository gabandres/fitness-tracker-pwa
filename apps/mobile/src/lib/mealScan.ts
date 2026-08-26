import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { I18nKey } from '@/i18n';
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
  /** Present (and only ever `true`) when the grams came off a scale in the
   *  photo — ADR-0029 item 2. Absent from any server predating that. */
  measured?: boolean;
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

/**
 * Send a base64 meal photo to `analyzePhoto` and normalize to a MealScan.
 *
 * `note` is the user's own words about the meal (ADR-0029 item 1), optional.
 * It is sent as data the model may use for NAMING and PORTION only — the server
 * fences it and says so in the prompt — and it never touches the macros, which
 * still come from the USDA database. Empty or whitespace-only notes are not
 * sent at all rather than sent blank: the wire should say "no note", not "an
 * empty note", and an omitted key costs no tokens.
 */
export async function analyzeMealPhoto(
  photos: string | string[],
  locale: string,
  note?: string,
): Promise<MealScan> {
  const call = httpsCallable<
    { photoBase64: string; photosBase64?: string[]; locale: string; note?: string },
    AnalyzePhotoResult
  >(functions, 'analyzePhoto');
  const trimmed = note?.trim();
  const list = (Array.isArray(photos) ? photos : [photos]).filter(Boolean);

  // `photoBase64` is ALWAYS sent, even when there are several. It is what a
  // server predating multi-image reads, and sending only the array to an
  // un-deployed function would fail every scan with PHOTO_MISSING — the client
  // reaching a server that is one deploy behind is the ordinary case during a
  // rollout, not an edge one.
  const { data } = await call({
    photoBase64: list[0],
    ...(list.length > 1 ? { photosBase64: list } : {}),
    locale,
    ...(trimmed ? { note: trimmed } : {}),
  });

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
        // Carried only when true, so review can render a measurement
        // differently from an estimate (ADR-0029 item 4).
        ...(i.measured ? { measured: true as const } : {}),
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

/**
 * Which message a failed scan deserves.
 *
 * `scan.tsx` used to catch every failure with a bare `catch {}` and render
 * `scan.failed` — "Couldn't read that photo. Try another angle." That is a
 * reasonable sentence for exactly one of the seven ways this call can fail,
 * and a lie for the other six.
 *
 * It cost a real user a real afternoon. On 2026-08-23 a tester used his three
 * free daily scans (13:31, 13:39, 16:46 UTC), and the fourth was correctly
 * rejected with `resource-exhausted` / `PHOTO_QUOTA_EXCEEDED`. The app told
 * him his PHOTO was bad — so he retook it, four more times, over 23 minutes.
 * The wording did not merely fail to explain the problem; it prescribed the
 * one action guaranteed not to work.
 *
 * The server has always sent a typed code in `details` (functions/src/
 * error-codes.ts) and the client has always thrown it away. Codes that mean
 * "the picture is the problem" still map to `scan.failed`; everything else
 * now says what actually happened, and whether waiting helps.
 */
export interface ScanErrorMessage {
  key: I18nKey;
  params?: Record<string, string | number>;
}

/** The shape `httpsCallable` rejects with — `details` carries our own code. */
interface CallableError {
  details?: { code?: string; limit?: number };
}

export function scanErrorMessage(e: unknown): ScanErrorMessage {
  const details = (e as CallableError | null)?.details;
  switch (details?.code) {
    case 'PHOTO_QUOTA_EXCEEDED':
      // The one that matters: it is not the photo, and tomorrow it works.
      return { key: 'scan.errQuota', params: { n: details.limit ?? 3 } };
    case 'PHOTO_RATE_LIMITED':
    case 'RATE_LIMITED':
      return { key: 'scan.errRateLimited' };
    case 'PHOTO_TOO_LARGE':
      return { key: 'scan.errTooLarge' };
    case 'SERVICE_CEILING_REACHED':
      // Org-wide, not personal. Never tell them to upgrade or come back
      // tomorrow with a different photo — neither is the problem.
      return { key: 'scan.errBusy' };
    case 'FEATURE_DISABLED':
      return { key: 'scan.errOff' };
    case 'UNAUTHENTICATED':
      return { key: 'scan.errAuth' };
    default:
      // PHOTO_ESTIMATE_FAILED / PHOTO_ANALYZE_FAILED / a local encode failure
      // / no network. Here the photo genuinely may be the problem.
      return { key: 'scan.failed' };
  }
}
