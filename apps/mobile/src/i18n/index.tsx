import { type ReactNode, createContext, useContext, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { type I18nKey, en } from './en';
import { LOCALE_DEFS, type Locale, resolveLocale } from './registry';

export type { I18nKey } from './en';
export type { Locale, LocaleDef } from './registry';
export {
  LOCALES,
  LOCALE_DEFS,
  DEFAULT_LOCALE,
  normalizeLocale,
  deviceLocale,
  resolveLocale,
} from './registry';

export type TParams = Record<string, string | number>;
export type TFn = (key: I18nKey, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

interface I18nValue {
  locale: Locale;
  t: TFn;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

/** Drives the active locale from `profile.preferredLocale` (the same field
 *  the PWA's Transloco uses), falling back to the phone's own language —
 *  see `resolveLocale`. Mount inside AuthProvider so the profile is
 *  available. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const locale = resolveLocale(profile?.preferredLocale);

  const value = useMemo<I18nValue>(() => {
    const dict = LOCALE_DEFS[locale].dict;
    // Falls back key-by-key rather than dict-by-dict: a locale missing one
    // string renders English for that string only, not for the screen.
    const t: TFn = (key, params) => interpolate(dict[key] ?? en[key] ?? key, params);
    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Returns the translate function. Components call `const t = useT()`. */
export function useT(): TFn {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within I18nProvider');
  return ctx.t;
}

export function useLocale(): Locale {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useLocale must be used within I18nProvider');
  return ctx.locale;
}
