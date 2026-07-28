import { describe, expect, it } from 'vitest';
import { langFromPath, stripLangPrefix } from './locale-path';

// The `/es` prefix is a three-way contract: scripts/prerender-seo.mjs emits
// the URLs, detectRoute() in app.ts matches them with the prefix removed,
// and TranslationService picks the language from it. These two helpers are
// the only shared piece, so this is where the contract gets pinned.

describe('langFromPath', () => {
  it('claims the Spanish prefix and its sub-paths', () => {
    expect(langFromPath('/es')).toBe('es-PR');
    expect(langFromPath('/es/')).toBe('es-PR');
    expect(langFromPath('/es/calculator')).toBe('es-PR');
    expect(langFromPath('/ES/Calculator')).toBe('es-PR');
  });

  it('leaves English paths without an opinion', () => {
    expect(langFromPath('/')).toBeNull();
    expect(langFromPath('/calculator')).toBeNull();
  });

  it('does not treat a path that merely starts with "es" as Spanish', () => {
    // `/espanol` and `/estimate` are not the `/es` segment.
    expect(langFromPath('/espanol')).toBeNull();
    expect(langFromPath('/estimate')).toBeNull();
  });
});

describe('stripLangPrefix', () => {
  it('reduces a Spanish URL to the route the app matches', () => {
    expect(stripLangPrefix('/es/calculator')).toBe('/calculator');
    expect(stripLangPrefix('/es/vs/macrofactor')).toBe('/vs/macrofactor');
    expect(stripLangPrefix('/es/macros/lose/180-lb')).toBe('/macros/lose/180-lb');
  });

  it('maps the bare prefix to the landing route', () => {
    // Not '' — detectRoute matches '/' for the landing page, and an empty
    // string would fall through to the 404 branch.
    expect(stripLangPrefix('/es')).toBe('/');
    expect(stripLangPrefix('/es/')).toBe('/');
  });

  it('passes English paths through untouched', () => {
    expect(stripLangPrefix('/calculator')).toBe('/calculator');
    expect(stripLangPrefix('/espanol')).toBe('/espanol');
    expect(stripLangPrefix('/')).toBe('/');
  });
});
