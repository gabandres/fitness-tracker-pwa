import { Injectable } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';
import en from './en.json';
import esPR from './es-PR.json';

export const INLINE_TRANSLATIONS: Record<string, Translation> = {
  en: en as Translation,
  'es-PR': esPR as Translation,
};

@Injectable({ providedIn: 'root' })
export class InlineTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    return Promise.resolve(INLINE_TRANSLATIONS[lang] ?? INLINE_TRANSLATIONS['en']);
  }
}
