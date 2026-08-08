import { Injectable, inject } from '@angular/core';
import type { ScannedFoodItem, ScannedItemSource } from '@macrolog/core';
import { CallableGateway } from './callable.gateway';
import { TranslationService } from './translation.service';

/** One recognized food as `analyzePhoto` puts it on the wire. */
export interface PhotoAnalysisItem {
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

export interface PhotoAnalysisResult {
  /**
   * The itemized breakdown (ADR-0015 §1) — each food the vision model
   * recognized, with macros resolved server-side from the bundled USDA
   * database. Optional because the field is newer than some deployments; when
   * it is absent the flat totals below are all there is.
   */
  items?: PhotoAnalysisItem[];
  source?: ScannedItemSource;
  calories: number;
  protein: number;
  /** Null when the (older) deployed function doesn't return them yet. */
  carbs: number | null;
  fat: number | null;
  description: string;
  confidence: 'low' | 'medium' | 'high';
  photosRemaining: number;
}

/**
 * Wraps the analyzePhoto Cloud Function callable.
 *
 * Sends a base64-encoded meal photo; receives an itemized list of foods with
 * database-grounded macros, plus the summed whole-meal totals. The model does
 * recognition + portion only — it is not asked for the calorie numbers — which
 * is the accuracy mitigation ADR-0015 §1 was built around.
 */
@Injectable({ providedIn: 'root' })
export class PhotoMacrosService {
  private readonly callables = inject(CallableGateway);
  private readonly translation = inject(TranslationService);

  async analyze(photoBase64: string): Promise<PhotoAnalysisResult> {
    return this.callables.call<{ photoBase64: string; locale: string }, PhotoAnalysisResult>(
      'analyzePhoto',
      { photoBase64, locale: this.translation.language() },
    );
  }
}

/**
 * Normalize a response to the shared `ScannedFoodItem` shape both frontends
 * render. Falls back to a single whole-meal row when a response carries no
 * `items` — the same fallback `apps/mobile/src/lib/mealScan.ts` keeps, for the
 * same reason: a client pointed at an older deployment should degrade to one
 * row, not to an empty screen.
 */
export function toScannedItems(result: PhotoAnalysisResult): ScannedFoodItem[] {
  const nonNeg = (n: number | null | undefined) => Math.max(0, Number(n) || 0);
  if (result.items?.length) {
    return result.items.map((i) => ({
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
    }));
  }
  return [
    {
      name: result.description || 'Meal',
      grams: 0,
      calories: nonNeg(result.calories),
      protein: nonNeg(result.protein),
      carbs: nonNeg(result.carbs),
      fat: nonNeg(result.fat),
      confidence: 0.7,
    },
  ];
}
