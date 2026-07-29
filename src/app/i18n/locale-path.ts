import type { AppLang } from './transloco.providers';

/**
 * URL prefix for the Spanish half of the indexed site (`/es/calculator`,
 * `/es/vs/macrofactor`, …). Written by scripts/prerender-seo.mjs; read
 * here so routing and locale selection agree with what was emitted.
 *
 * Deliberately `/es` and not `/es-pr`: the copy is Puerto Rican, but the
 * URLs target every Spanish-speaking searcher.
 *
 * These helpers live apart from `transloco.providers.ts` on purpose —
 * they are pure string functions used by route matching, and importing
 * them must not drag the Transloco runtime along with them.
 */
export const ES_PATH_PREFIX = '/es';

/** The locale a URL asks for, or null when it carries no opinion. */
export function langFromPath(pathname: string): AppLang | null {
  const p = pathname.toLowerCase();
  return p === ES_PATH_PREFIX || p.startsWith(`${ES_PATH_PREFIX}/`) ? 'es-PR' : null;
}

/**
 * Drop the locale prefix so route matching stays written in one language:
 * `/es/calculator` → `/calculator`, and a bare `/es` → `/`.
 */
export function stripLangPrefix(pathname: string): string {
  if (!langFromPath(pathname)) return pathname;
  return pathname.slice(ES_PATH_PREFIX.length) || '/';
}

/**
 * The inverse: point an English path at the copy for `lang`.
 * `('/download', 'es-PR')` → `/es/download`; English is unprefixed.
 *
 * For links OUT of the SPA into the indexed site — `/download` and
 * `/support` are hand-written files in `public/`, and a Spanish reader sent
 * to the English one hits a dead end at the conversion step, which is the
 * one place it costs a install. Idempotent, so passing an already-prefixed
 * path is safe.
 */
export function localizedPath(path: string, lang: AppLang): string {
  if (lang !== 'es-PR') return path;
  if (langFromPath(path)) return path;
  return `${ES_PATH_PREFIX}${path}`;
}
