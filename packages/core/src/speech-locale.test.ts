import { describe, expect, it } from 'vitest';
import { resolveSpeechLocale, routeTranscript } from './speech-locale';
import { parseMealUtterance } from './meal-utterance';

/**
 * Both functions guard silent failures. A recogniser handed a locale it does
 * not have returns nothing — indistinguishable from a broken mic — and a
 * transcript routed to the wrong surface looks the same way.
 */
describe('resolveSpeechLocale', () => {
  // Roughly what an iPhone reports.
  const device = ['en-US', 'en-GB', 'es-US', 'es-MX', 'es-ES', 'fr-FR'];

  it('takes the exact tag when the device really has it', () => {
    expect(resolveSpeechLocale('es-MX', device)).toBe('es-MX');
  });

  it('maps es-PR to es-US — the tag phones actually ship', () => {
    // Our locale is a PROFILE preference and es-PR is not a speech locale
    // anywhere. Falling through to English would hand a Spanish speaker an
    // English recogniser, which returns garbage rather than nothing.
    expect(resolveSpeechLocale('es-PR', device)).toBe('es-US');
  });

  it('falls back to ANY Spanish before it falls back to English', () => {
    expect(resolveSpeechLocale('es-PR', ['en-US', 'es-ES'])).toBe('es-ES');
  });

  it('is case-insensitive about tags', () => {
    expect(resolveSpeechLocale('ES-pr', device)).toBe('es-US');
  });

  it('maps bare en to en-US', () => {
    expect(resolveSpeechLocale('en', device)).toBe('en-US');
  });

  it('never returns undefined, even for a language the device lacks', () => {
    // Handing the recogniser nothing is worse than an imperfect match.
    expect(resolveSpeechLocale('ja-JP', device)).toBe('en-US');
    expect(resolveSpeechLocale('ja-JP', ['fr-FR'])).toBe('fr-FR');
    expect(resolveSpeechLocale('ja-JP', [])).toBe('en-US');
    expect(resolveSpeechLocale('', [])).toBe('en-US');
  });
});

describe('routeTranscript', () => {
  const route = (t: string) => routeTranscript(t, parseMealUtterance);

  it('sends a quantified meal to the meal draft', () => {
    expect(route('1 cup of white rice and 100 g chicken breast').to).toBe('meal');
  });

  it('sends a single quantified food with a unit to the meal draft', () => {
    expect(route('100g chicken').to).toBe('meal');
  });

  it('sends a bare food name to search', () => {
    // "chicken" is a search. Routing it to the meal draft would open a screen
    // the user did not ask for.
    expect(route('chicken').to).toBe('search');
  });

  it('sends empty speech to search rather than anywhere surprising', () => {
    expect(route('   ')).toEqual({ to: 'search', text: '' });
  });

  it('falls back to search if the parser throws', () => {
    expect(
      routeTranscript('anything', () => {
        throw new Error('boom');
      }),
    ).toEqual({ to: 'search', text: 'anything' });
  });

  it('carries the transcript through unchanged either way', () => {
    expect(route('100g chicken').text).toBe('100g chicken');
    expect(route('chicken').text).toBe('chicken');
  });
});
