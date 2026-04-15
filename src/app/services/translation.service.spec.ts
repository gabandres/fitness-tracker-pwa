// @vitest-environment jsdom
import '@angular/compiler';
import { vi, beforeEach, describe, expect, it, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TranslationService } from './translation.service';

// Lightweight mock of TranslocoService — we only exercise the surface the
// TranslationService actually calls. No Angular DI, no TestBed; matches the
// pure-function style in tdee-calculator.service.spec.ts.
type TranslocoMock = {
  setActiveLang: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  events$: { subscribe: ReturnType<typeof vi.fn> };
};

function makeService(opts: { navLang?: string; stored?: string | null } = {}) {
  if (opts.stored !== undefined) {
    if (opts.stored === null) localStorage.removeItem('macrolog.lang');
    else localStorage.setItem('macrolog.lang', opts.stored);
  }
  Object.defineProperty(globalThis.navigator, 'language', {
    value: opts.navLang ?? 'en-US',
    configurable: true,
  });

  const transloco: TranslocoMock = {
    setActiveLang: vi.fn(),
    translate: vi.fn((key: string) => `t:${key}`),
    events$: { subscribe: vi.fn() },
  };

  // Build a service instance without invoking the decorated constructor (which
  // triggers Angular DI). This matches the pure-function style used elsewhere.
  const svc = Object.create(TranslationService.prototype) as TranslationService;
  (svc as any).transloco = transloco;
  (svc as any).language = signal('en');
  (svc as any).language.set((svc as any).resolveInitial());
  transloco.setActiveLang(svc.language());

  return { svc, transloco };
}

describe('TranslationService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to English when no preference and navigator is English', () => {
    const { svc } = makeService({ navLang: 'en-US' });
    expect(svc.language()).toBe('en');
  });

  it('auto-detects es-PR when navigator language starts with es', () => {
    const { svc } = makeService({ navLang: 'es-MX' });
    expect(svc.language()).toBe('es-PR');
  });

  it('prefers localStorage over navigator', () => {
    const { svc } = makeService({ navLang: 'es-MX', stored: 'en' });
    expect(svc.language()).toBe('en');
  });

  it('falls back to English for unknown localStorage values', () => {
    const { svc } = makeService({ navLang: 'en-US', stored: 'fr-FR' });
    expect(svc.language()).toBe('en');
  });

  it('setLanguage persists to localStorage and updates signal', () => {
    const { svc, transloco } = makeService({ navLang: 'en-US' });
    svc.setLanguage('es-PR');
    expect(svc.language()).toBe('es-PR');
    expect(localStorage.getItem('macrolog.lang')).toBe('es-PR');
    expect(transloco.setActiveLang).toHaveBeenLastCalledWith('es-PR');
  });

  it('setLanguage ignores unknown locales', () => {
    const { svc } = makeService({ navLang: 'en-US' });
    svc.setLanguage('fr-FR' as any);
    expect(svc.language()).toBe('en');
  });

  it('tError maps SNAKE_CASE codes to errors.camelCase keys', () => {
    const { svc, transloco } = makeService({ navLang: 'en-US' });
    // First call returns a real translation; no fallback to errors.unknown.
    transloco.translate.mockReturnValueOnce('Photo too large');
    svc.tError('PHOTO_TOO_LARGE');
    expect(transloco.translate).toHaveBeenCalledWith('errors.photoTooLarge', undefined, 'en');
  });

  it('tError falls back to errors.unknown when the code has no translation', () => {
    const { svc, transloco } = makeService({ navLang: 'en-US' });
    // First lookup returns the key itself — i.e. no translation found.
    transloco.translate.mockImplementation((key: string) => key);
    svc.tError('MYSTERY_CODE');
    expect(transloco.translate).toHaveBeenCalledWith('errors.mysteryCode', undefined, 'en');
    expect(transloco.translate).toHaveBeenLastCalledWith('errors.unknown', undefined, 'en');
  });

  it('tError falls back to errors.unknown when code is missing', () => {
    const { svc, transloco } = makeService({ navLang: 'en-US' });
    svc.tError(undefined);
    expect(transloco.translate).toHaveBeenCalledWith('errors.unknown', undefined, 'en');
  });
});
