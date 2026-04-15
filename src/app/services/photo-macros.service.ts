import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { TranslationService } from './translation.service';

export interface PhotoAnalysisResult {
  calories: number;
  protein: number;
  description: string;
  confidence: 'low' | 'medium' | 'high';
  photosRemaining: number;
}

/**
 * Wraps the analyzePhoto Cloud Function callable.
 * Sends a base64-encoded meal photo, receives calorie + protein estimates.
 */
@Injectable({ providedIn: 'root' })
export class PhotoMacrosService {
  private readonly functions = inject(Functions);
  private readonly translation = inject(TranslationService);

  async analyze(photoBase64: string): Promise<PhotoAnalysisResult> {
    const callable = httpsCallable<
      { photoBase64: string; locale: string },
      PhotoAnalysisResult
    >(this.functions, 'analyzePhoto');
    const result = await callable({ photoBase64, locale: this.translation.language() });
    return result.data;
  }
}
