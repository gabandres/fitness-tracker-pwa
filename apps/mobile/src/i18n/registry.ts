// The mobile end of the locale registry.
//
// The LIST of languages lives in `packages/core/src/locales.ts` — it is shared
// with the PWA, so neither frontend can quietly ship a language the other has
// never heard of. This file only says which dictionary object goes with which
// tag, because a React string table cannot live in framework-free core.
//
// ADDING A LANGUAGE:
//   1. add the row to `packages/core/src/locales.ts`;
//   2. write `<tag>.ts` next to this file with the same keys as `en.ts`;
//   3. add ONE line to DICTS below.
//
// `src/__tests__/i18n-parity.test.ts` then fails until the dictionary is
// complete, and `npm run doctor` fails if a dict file exists with no row —
// so a half-added language cannot pass for a shipped one.

import {
  DEFAULT_LOCALE as CORE_DEFAULT,
  LOCALES as CORE_LOCALES,
  intlTagFor,
  localeDefinition,
  normalizeLocale as coreNormalize,
} from '@macrolog/core';
import { type I18nKey, en } from './en';
import { esPR } from './es-PR';
import { ptBR } from './pt-BR';

const DICTS = {
  en,
  'es-PR': esPR,
  'pt-BR': ptBR,
} satisfies Record<string, Record<I18nKey, string>>;

/** The tag stored in `users/{uid}.preferredLocale`, shared with the PWA. */
export type Locale = keyof typeof DICTS;

export interface LocaleDef {
  /** Endonym for the settings picker — a language names itself. */
  label: string;
  /** What `Intl` gets for dates, times and numbers. */
  intlTag: string;
  dict: Record<I18nKey, string>;
}

/**
 * Core's list, narrowed to the ones this app actually has a dictionary for.
 *
 * Deriving rather than re-listing is deliberate: a tag added to core but not
 * given a dict here would otherwise appear in the settings picker and render
 * an entirely English app. It is simply absent until its dictionary exists.
 */
export const LOCALES = CORE_LOCALES.map((l) => l.tag).filter(
  (t): t is Locale => t in DICTS,
);

export const LOCALE_DEFS = Object.fromEntries(
  LOCALES.map((tag) => [
    tag,
    { label: localeDefinition(tag)!.label, intlTag: intlTagFor(tag), dict: DICTS[tag] },
  ]),
) as Record<Locale, LocaleDef>;

/** The fallback, and the language `en.ts` is written in. */
export const DEFAULT_LOCALE = CORE_DEFAULT as Locale;

/**
 * Any BCP-47 tag (or stored preference) → a locale this app can render, or
 * null. Core matches on the primary subtag — `pt-PT` and `es-MX` resolve —
 * and this narrows the answer to a tag we hold a dictionary for.
 */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  const resolved = coreNormalize(tag);
  return resolved && resolved in DICTS ? (resolved as Locale) : null;
}

/**
 * The phone's own language, or null if it isn't one we ship.
 *
 * `Intl.DateTimeFormat().resolvedOptions().locale` is the device locale on
 * both platforms under Hermes — `lib/feedback.ts` has relied on it since it
 * was written — and it is pure JS, so device auto-detect ships over an EAS
 * Update with no native module and no new binary. `expo-localization` would
 * have moved the fingerprint and cost a build per platform.
 */
export function deviceLocale(): Locale | null {
  try {
    return normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

/**
 * The language to render in.
 *
 * An explicit stored choice always wins — including an explicit choice of
 * English on a Brazilian phone, which is a preference and not a mistake. With
 * nothing stored (a fresh install, or anyone who has never opened the language
 * row) the PHONE decides, so a `pt-BR` device opens in Portuguese on first
 * launch instead of English.
 */
export function resolveLocale(stored: string | null | undefined): Locale {
  return normalizeLocale(stored) ?? deviceLocale() ?? DEFAULT_LOCALE;
}
