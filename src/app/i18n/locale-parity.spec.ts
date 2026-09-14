import { describe, expect, it } from 'vitest';
import { INLINE_TRANSLATIONS } from './inline-loader';
import { AVAILABLE_LANGS } from './transloco.providers';

/**
 * Every shipped language must carry every key `en.json` carries.
 *
 * This is the web half of a check mobile has had for a while
 * (`apps/mobile/src/__tests__/i18n-parity.test.ts`). The failure it exists for
 * is INVISIBLE: Transloco falls back PER KEY, so a bundle missing
 * `landing.hero.cta` renders a perfectly Spanish page with one English button
 * on it, and nothing logs, throws, or fails to build. There is no compiler
 * error either — `en.json` and `es-PR.json` are two independent JSON files and
 * TypeScript never compares them.
 *
 * WHAT IS DIFFERENT FROM MOBILE, and why this could not just be copied:
 *
 * Mobile's dictionaries are FLAT (`'today.title': '…'`) and interpolate with
 * `{n}`. The web's are NESTED Transloco bundles and interpolate with `{{n}}`
 * (CLAUDE.md §i18n). So the comparison here flattens both sides to dotted
 * paths first — which is also the shape Transloco itself addresses keys by, so
 * a failure message names the key exactly as a template would write it.
 *
 * Arrays are flattened by INDEX (`faq.items.3.q`) rather than treated as
 * leaves. `faq.items` is a 12-entry array of objects today; comparing it as
 * one opaque leaf would pass while a translator dropped an entry or left an
 * answer off one of them.
 *
 * Like mobile, this reads the REGISTRY (`INLINE_TRANSLATIONS`,
 * `AVAILABLE_LANGS`) rather than naming `es-PR` itself, so a third language is
 * covered the day it is registered and nobody has to remember this file.
 */

const DEFAULT_LANG = 'en';

type Bundle = Record<string, unknown>;

/**
 * Nested Transloco bundle → dotted leaf paths, the form templates address.
 * Arrays descend by index, so a short array is a set of missing keys rather
 * than one equal-looking leaf.
 */
function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}) {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Bundle)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

/** `{{ name }}` — Transloco's interpolation, tolerant of inner whitespace. */
const placeholders = (s: string) =>
  [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

const FLAT: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(INLINE_TRANSLATIONS).map(([lang, bundle]) => [
    lang,
    flatten(bundle as Bundle),
  ]),
);

const EN = FLAT[DEFAULT_LANG];
const EN_KEYS = Object.keys(EN);
/** Every registered language that is not the source of truth. */
const OTHERS = AVAILABLE_LANGS.filter((l) => l !== DEFAULT_LANG);

describe('web i18n bundle parity', () => {
  it('registers English, and a bundle for every available lang', () => {
    // The two lists are maintained in two files: `AVAILABLE_LANGS` is what
    // Transloco is configured with, `INLINE_TRANSLATIONS` is what the loader
    // can actually return. A lang in the first but not the second silently
    // serves English under a Spanish label — the loader's `?? en` fallback.
    expect(AVAILABLE_LANGS).toContain(DEFAULT_LANG);
    expect([...AVAILABLE_LANGS].sort()).toEqual(Object.keys(INLINE_TRANSLATIONS).sort());
    expect(EN_KEYS.length).toBeGreaterThan(0);
  });

  it.each(OTHERS)('%s has every key en.json has', (lang) => {
    const keys = new Set(Object.keys(FLAT[lang]));
    const missing = EN_KEYS.filter((k) => !keys.has(k));
    expect(
      missing,
      `${lang}.json is missing ${missing.length} key(s). Transloco falls back per key, ` +
        `so each one renders as English inside an otherwise translated page.`,
    ).toEqual([]);
  });

  it.each(OTHERS)('%s has no keys en.json lacks', (lang) => {
    // Not cosmetic: a key only the translation has is dead weight that reads
    // as coverage, and it is usually half of a rename that was applied to one
    // file. It also hides the other half — the English key that vanished.
    const extra = Object.keys(FLAT[lang]).filter((k) => !(k in EN));
    expect(extra, `${lang}.json declares keys en.json does not`).toEqual([]);
  });

  it.each(OTHERS)('%s keeps every {{placeholder}} the English string uses', (lang) => {
    // A dropped `{{n}}` does not error — it renders the literal sentence with
    // the number simply absent ("Log your first meal" where the count was).
    // A RENAMED one is worse: Transloco leaves `{{nombre}}` on the page.
    const broken: string[] = [];
    for (const key of EN_KEYS) {
      const want = placeholders(String(EN[key] ?? ''));
      const got = placeholders(String(FLAT[lang][key] ?? ''));
      if (want.join(',') !== got.join(',')) {
        broken.push(`${key}: en {{${want}}} vs ${lang} {{${got}}}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it.each(OTHERS)('%s keeps the same value SHAPE as en.json', (lang) => {
    // Flattening by index means a nested object that became a string (or an
    // array that lost entries) shows up above as missing keys. What is left
    // for this to catch is a leaf whose TYPE changed — a string that became a
    // number or a null — which would render as "null" in the UI.
    const wrong = EN_KEYS.filter(
      (k) => k in FLAT[lang] && typeof FLAT[lang][k] !== typeof EN[k],
    );
    expect(wrong).toEqual([]);
  });

  it.each(AVAILABLE_LANGS)('%s has no empty leaf', (lang) => {
    // An empty string is the one way to be "at parity" and still render
    // nothing. It passes every check above.
    const blank = Object.entries(FLAT[lang])
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it.each(AVAILABLE_LANGS)('%s is all strings at the leaves', (lang) => {
    // Transloco renders whatever it finds. A non-string leaf is a structural
    // mistake in the bundle, not a translation.
    const nonString = Object.entries(FLAT[lang])
      .filter(([, v]) => typeof v !== 'string')
      .map(([k]) => k);
    expect(nonString).toEqual([]);
  });
});
