/**
 * The languages Ignia ships — the canonical list for the whole monorepo.
 *
 * ADDING A LANGUAGE:
 *   1. add ONE row to `LOCALES` below;
 *   2. write the dictionary in each frontend that should carry it
 *      (`apps/mobile/src/i18n/<tag>.ts`, `src/app/i18n/<tag>.json`) and point
 *      that frontend's one-line dict map at it;
 *   3. optionally fill the side tables — starter foods, widget strings, the
 *      Train seed maps in `workout-seed.ts`. All three fall back to English,
 *      so none of them blocks the language from working.
 *
 * This file exists because the language list used to be written down in about
 * ten places, most of them as a BOOLEAN (`es: boolean`, `=== 'es-PR'`), which
 * can only ever answer "Spanish, or not". Adding Portuguese meant finding all
 * ten. Keep the shape of this file: a tag, what it claims, what it is called,
 * and what Intl should format with. Anything platform-specific — a React dict,
 * a Transloco JSON — belongs in that platform's registry, not here.
 *
 * Pure data and pure functions only, per the packages/core rule.
 */

export interface LocaleDefinition {
  /** Stored in `users/{uid}.preferredLocale`; shared by both frontends. */
  tag: string;
  /**
   * BCP-47 PRIMARY subtags this locale answers for.
   *
   * Matched on the primary subtag, never the whole tag, because the region we
   * ship is not the region most speakers live in: `es-MX`, `es-ES` and
   * `es-419` all take the Puerto Rican Spanish, and `pt-PT` takes the
   * Brazilian Portuguese. Someone reading their own language in the wrong
   * dialect is far better served than someone reading English.
   */
  claims: string[];
  /** Endonym, for a language picker — a language names itself. */
  label: string;
  /** The tag `Intl` should format dates, times and numbers with. */
  intlTag: string;
}

export const LOCALES: readonly LocaleDefinition[] = [
  { tag: 'en', claims: ['en'], label: 'English', intlTag: 'en-US' },
  { tag: 'es-PR', claims: ['es'], label: 'Español', intlTag: 'es-PR' },
  { tag: 'pt-BR', claims: ['pt'], label: 'Português', intlTag: 'pt-BR' },
] as const;

/** Every shipped tag, in registration order. */
export const LOCALE_TAGS = LOCALES.map((l) => l.tag);

/** The fallback, and the language the source dictionaries are written in. */
export const DEFAULT_LOCALE = 'en';

const BY_TAG = new Map(LOCALES.map((l) => [l.tag, l]));
const BY_CLAIM = new Map(LOCALES.flatMap((l) => l.claims.map((c) => [c, l.tag] as const)));

/** The definition for a tag, or undefined if we do not ship it. */
export function localeDefinition(tag: string): LocaleDefinition | undefined {
  return BY_TAG.get(tag);
}

/**
 * Any BCP-47 tag, browser language or stored preference → a locale we ship,
 * or null when we ship nothing for it. Accepts the `pt_BR` underscore form
 * Android hands out in some paths.
 */
export function normalizeLocale(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const primary = tag.toLowerCase().replace(/_/g, '-').split('-')[0];
  return BY_CLAIM.get(primary) ?? null;
}

/** The tag `Intl` should use, falling back to English rather than throwing. */
export function intlTagFor(tag: string): string {
  return BY_TAG.get(tag)?.intlTag ?? 'en-US';
}
