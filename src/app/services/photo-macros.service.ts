import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export interface PhotoAnalysisResult {
  calories: number;
  protein: number;
  description: string;
  photosRemaining: number;
}

/**
 * Wraps the analyzePhoto Cloud Function callable.
 * Sends a base64-encoded meal photo, receives calorie + protein estimates.
 */
@Injectable({ providedIn: 'root' })
export class PhotoMacrosService {
  private readonly functions = inject(Functions);

  async analyze(photoBase64: string): Promise<PhotoAnalysisResult> {
    const callable = httpsCallable<
      { photoBase64: string },
      PhotoAnalysisResult
    >(this.functions, 'analyzePhoto');
    const result = await callable({ photoBase64 });
    return result.data;
  }
}
