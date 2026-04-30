import { AppLang } from '../i18n/transloco.providers';

/**
 * Maps an app language to a BCP-47 locale tag for Intl APIs
 * (Date.toLocaleString, Intl.DateTimeFormat, Intl.NumberFormat).
 */
export function bcp47ForLang(lang: AppLang): string {
  return lang === 'es-PR' ? 'es' : 'en-US';
}
