import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';
import { spokenGrams } from '@/i18n/grammar';
import type { I18nKey } from '@/i18n';

/**
 * UX_AUDIT S24-27 (2026-11-20): a macro amount as a screen reader says it.
 * The spoken keys had no singular, so an egg white's fat was "1 grams of fat".
 */

const tFor = (dict: Record<string, string>) => (key: I18nKey, params?: Record<string, string | number>) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));

describe('spokenGrams', () => {
  it('says the amount in grams, and one gram in the singular', () => {
    const t = tFor(en);
    expect(spokenGrams(t, 'protein', '32')).toBe('32 grams of protein');
    expect(spokenGrams(t, 'fat', '1')).toBe('1 gram of fat');
    expect(spokenGrams(t, 'carbs', '1')).toBe('1 gram of carbs');
  });

  it('keeps the plural for a decimal and for a number that only starts with 1', () => {
    const t = tFor(en);
    expect(spokenGrams(t, 'fat', '1.5')).toBe('1.5 grams of fat');
    expect(spokenGrams(t, 'protein', '12')).toBe('12 grams of protein');
  });

  it('has the singular in the other two languages', () => {
    expect(spokenGrams(tFor(esPR), 'protein', '1')).toBe('1 gramo de proteína');
    expect(spokenGrams(tFor(ptBR), 'fat', '1')).toBe('1 grama de gordura');
    expect(spokenGrams(tFor(esPR), 'fat', '20')).toBe('20 gramos de grasa');
  });
});
