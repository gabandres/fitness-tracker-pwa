import { isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { InlineTranslocoLoader } from './inline-loader';

export const AVAILABLE_LANGS = ['en', 'es-PR'] as const;
export type AppLang = (typeof AVAILABLE_LANGS)[number];

export function provideTranslocoConfig() {
  return provideTransloco({
    config: {
      availableLangs: [...AVAILABLE_LANGS],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
    },
    loader: InlineTranslocoLoader,
  });
}
