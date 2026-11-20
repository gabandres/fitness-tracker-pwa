/**
 * Every registered locale must carry every key `en.ts` carries.
 *
 * This exists because a missing key is INVISIBLE at runtime: `t()` falls back
 * to English per key, so a half-translated locale renders a screen that is
 * mostly Portuguese with three English strings in it, and nothing errors.
 * `npm run doctor` checks the same thing, but only on a machine someone
 * remembers to run it on — this fails the suite.
 *
 * It reads `LOCALE_DEFS` rather than a list of its own, so a fourth language
 * is covered the moment it is registered and nobody has to remember to add it
 * here. That is the entire point of the registry.
 */
import {
  LOCALES,
  LOCALE_DEFS,
  DEFAULT_LOCALE,
  normalizeLocale,
  resolveLocale,
} from '@/i18n/registry';
import { LOCALES as CORE_LOCALES } from '@macrolog/core';
import { en } from '@/i18n/en';

const EN_KEYS = Object.keys(en);

describe('i18n registry', () => {
  it('registers English and makes it the fallback', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it.each(LOCALES)('%s has every key en.ts has', (locale) => {
    const keys = new Set(Object.keys(LOCALE_DEFS[locale].dict));
    const missing = EN_KEYS.filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s has no keys en.ts lacks', (locale) => {
    const enKeys = new Set(EN_KEYS);
    const extra = Object.keys(LOCALE_DEFS[locale].dict).filter((k) => !enKeys.has(k));
    expect(extra).toEqual([]);
  });

  it.each(LOCALES)('%s keeps every {placeholder} the English string uses', (locale) => {
    const dict = LOCALE_DEFS[locale].dict as Record<string, string>;
    const source = en as Record<string, string>;
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const broken: string[] = [];
    for (const key of EN_KEYS) {
      const want = placeholders(source[key]);
      const got = placeholders(dict[key] ?? '');
      if (want.join(',') !== got.join(',')) broken.push(`${key}: expected {${want}} got {${got}}`);
    }
    expect(broken).toEqual([]);
  });

  it('gives every locale a distinct label and a non-empty Intl tag', () => {
    const labels = LOCALES.map((l) => LOCALE_DEFS[l].label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of LOCALES) expect(LOCALE_DEFS[l].intlTag).toMatch(/^[a-z]{2}(-[A-Za-z0-9]+)?$/);
  });

  it('claims no primary subtag twice', () => {
    // Claims live in packages/core — two locales claiming `pt` would make
    // which one a Brazilian phone gets depend on registration order.
    const claims = CORE_LOCALES.flatMap((l) => l.claims);
    expect(new Set(claims).size).toBe(claims.length);
  });

  it('ships a dictionary for every locale core registers', () => {
    // Core is the shared list; a tag there with no dict here would render an
    // all-English app under a Portuguese label. `LOCALES` filters those out,
    // so this failing means someone added to core and stopped.
    expect(LOCALES).toEqual(CORE_LOCALES.map((l) => l.tag));
  });
});

/**
 * A key nothing reads is invisible too: it ships in three dictionaries, gets
 * translated, and no screen ever shows it. This scans the source for every
 * key-shaped token and fails when a NEW key is named nowhere.
 *
 * A key counts as read when the source holds
 *   - the key itself, as text (`t('today.title')`),
 *   - a template or concatenation that starts it (`t(\`meal.${slot}\`)`),
 *   - a namespace literal it lives under (`prefix="numbers.glossary"`), or
 *   - a dynamic ending it carries (`\`${base}.one\``).
 * That is generous on purpose: a false "read" costs a few bytes, a false
 * "unread" would fail the suite on a working screen.
 *
 * `i18n-unreferenced.json` is the baseline of keys that were already unread on
 * 2026-11-20. It only shrinks: delete a key from all three dictionaries (or
 * start reading it) and remove it from the baseline. To rewrite the file after
 * such a cleanup: `UPDATE_I18N_BASELINE=1 npx jest i18n-parity`.
 */
describe('every English key is read somewhere', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const mobile = path.resolve(__dirname, '../..');
  const baselineFile = path.join(__dirname, 'i18n-unreferenced.json');
  const roots = ['src', 'index.js', 'modules', 'plugins', '../../packages/core/src'].map((r) => path.join(mobile, r));
  const skip = /(__tests__|\.test\.|\.spec\.|node_modules|[\\/]i18n[\\/](en|es-PR|pt-BR)\.ts$)/;

  const sources: string[] = [];
  const walk = (p: string) => {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) {
      for (const entry of fs.readdirSync(p)) walk(path.join(p, entry));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(p) && !skip.test(p)) {
      sources.push(fs.readFileSync(p, 'utf8'));
    }
  };
  roots.forEach(walk);

  const tokens = new Set<string>();
  const starts = new Set<string>();
  const endings = new Set<string>();
  for (const s of sources) {
    for (const m of s.matchAll(/[A-Za-z_][\w-]*(?:\.[\w-]+)+/g)) tokens.add(m[0]);
    for (const m of s.matchAll(/([A-Za-z_][\w-]*(?:\.[\w-]+)*\.)\$\{/g)) starts.add(m[1]);
    for (const m of s.matchAll(/['"]([A-Za-z_][\w-]*(?:\.[\w-]+)*\.)['"]\s*\+/g)) starts.add(m[1]);
    for (const m of s.matchAll(/\}((?:\.[\w-]+)+)[`'"]/g)) endings.add(m[1]);
  }
  const keySet = new Set(EN_KEYS);
  // A dotted literal that is not itself a key names a namespace (`prefix="numbers.glossary"`).
  for (const t of tokens) if (!keySet.has(t)) starts.add(`${t}.`);
  const startList = [...starts];
  const endingList = [...endings];
  const unread = EN_KEYS.filter(
    (k) => !tokens.has(k) && !startList.some((p) => k.startsWith(p)) && !endingList.some((e) => k.endsWith(e)),
  ).sort();

  if (process.env.UPDATE_I18N_BASELINE === '1') fs.writeFileSync(baselineFile, `${JSON.stringify(unread, null, 2)}\n`);
  const baseline = new Set<string>(JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as string[]);

  it('scans a real tree', () => {
    expect(sources.length).toBeGreaterThan(300);
    expect(tokens.has('today.pf.kcalRange')).toBe(true);
  });

  it('adds no key that nothing reads', () => {
    expect(unread.filter((k) => !baseline.has(k))).toEqual([]);
  });

  it('keeps the baseline to keys that are still unread', () => {
    const unreadSet = new Set(unread);
    expect([...baseline].filter((k) => !unreadSet.has(k))).toEqual([]);
  });
});

describe('normalizeLocale', () => {
  it('matches on the primary subtag, not the exact tag', () => {
    // The region we ship is not the region most speakers are in.
    expect(normalizeLocale('pt-BR')).toBe('pt-BR');
    expect(normalizeLocale('pt-PT')).toBe('pt-BR');
    expect(normalizeLocale('pt')).toBe('pt-BR');
    expect(normalizeLocale('es-MX')).toBe('es-PR');
    expect(normalizeLocale('es-419')).toBe('es-PR');
    expect(normalizeLocale('en-GB')).toBe('en');
  });

  it('accepts the underscore form Android hands out', () => {
    expect(normalizeLocale('pt_BR')).toBe('pt-BR');
  });

  it('is case-insensitive', () => {
    expect(normalizeLocale('PT-br')).toBe('pt-BR');
  });

  it('returns null for a language we do not ship, and for nothing at all', () => {
    expect(normalizeLocale('fr-FR')).toBeNull();
    expect(normalizeLocale('')).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
    expect(normalizeLocale(undefined)).toBeNull();
  });
});

describe('resolveLocale', () => {
  const realDTF = Intl.DateTimeFormat;
  const pretendDeviceIs = (tag: string) => {
    // Only `resolvedOptions().locale` is read; everything else is left alone.
    (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
      return { resolvedOptions: () => ({ locale: tag }) };
    };
  };
  afterEach(() => {
    (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = realDTF;
  });

  it('follows the phone when nothing is stored', () => {
    pretendDeviceIs('pt-BR');
    expect(resolveLocale(undefined)).toBe('pt-BR');
    expect(resolveLocale(null)).toBe('pt-BR');
    expect(resolveLocale('')).toBe('pt-BR');
  });

  it('lets an explicit choice beat the phone — including a choice of English', () => {
    pretendDeviceIs('pt-BR');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('es-PR')).toBe('es-PR');
  });

  it('falls back to English for a phone language we do not ship', () => {
    pretendDeviceIs('fr-FR');
    expect(resolveLocale(undefined)).toBe('en');
  });

  it('survives a runtime with no usable Intl', () => {
    (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
      throw new Error('no ICU');
    };
    expect(resolveLocale(undefined)).toBe('en');
  });
});
