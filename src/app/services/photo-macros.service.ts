import { Injectable, inject } from '@angular/core';
import { CallableGateway } from './callable.gateway';
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
  private readonly callables = inject(CallableGateway);
  private readonly translation = inject(TranslationService);

  async analyze(photoBase64: string): Promise<PhotoAnalysisResult> {
    return this.callables.call<{ photoBase64: string; locale: string }, PhotoAnalysisResult>(
      'analyzePhoto',
      { photoBase64, locale: this.translation.language() },
    );
  }
}
