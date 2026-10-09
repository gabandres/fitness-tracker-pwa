import type { TFn } from '@/i18n';
import { en } from '@/i18n/en';
import { LOCALE_DEFS, type Locale } from '@/i18n/registry';
import { loadTargetIndices, spokenDuration, untouchedLoad } from '@/components/train/train-summary';

/**
 * Train re-score 3 — the two pure rules behind its fixes: what a screen
 * reader hears for the session clock, and which sets one load for the whole
 * lift lands on (the accept and the bump chip share it).
 */

const tFor = (locale: Locale): TFn => (key, params) => {
  const dict = LOCALE_DEFS[locale].dict as Record<string, string>;
  const template = dict[key] ?? (en as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? `{${k}}`));
};

describe('spokenDuration', () => {
  const t = tFor('en');
  it('says minutes and seconds, in words, with the right plural', () => {
    expect(spokenDuration(754, t, 'en')).toBe('12 minutes 34 seconds');
    expect(spokenDuration(61, t, 'en')).toBe('1 minute 1 second');
    expect(spokenDuration(120, t, 'en')).toBe('2 minutes');
    expect(spokenDuration(9, t, 'en')).toBe('9 seconds');
    expect(spokenDuration(0, t, 'en')).toBe('0 seconds');
  });

  it('drops the seconds past an hour', () => {
    expect(spokenDuration(3600 + 5 * 60 + 12, t, 'en')).toBe('1 hour 5 minutes');
    expect(spokenDuration(2 * 3600, t, 'en')).toBe('2 hours');
  });

  it('speaks each locale', () => {
    expect(spokenDuration(61, tFor('es-PR'), 'es-PR')).toBe('1 minuto 1 segundo');
    expect(spokenDuration(754, tFor('pt-BR'), 'pt-BR')).toBe('12 minutos 34 segundos');
  });
});

describe('loadTargetIndices — one rule for the accept and the bump chip', () => {
  it('names every unweighted, unticked working set', () => {
    expect(
      loadTargetIndices([
        { kind: 'warmup' },
        { kind: 'working' },
        { kind: 'working', weight: 0 },
        { kind: 'working', weight: 135 },
        { kind: 'working', reps: 5, done: true },
        { kind: 'mini' },
      ]),
    ).toEqual([1, 2, 5]);
  });

  it('also names sets still holding the seeded template load (10/6: Accept did nothing)', () => {
    expect(
      loadTargetIndices(
        [
          { kind: 'activation', weight: 30 },
          { kind: 'mini', weight: 30 },
          { kind: 'mini', weight: 27.5 },
          { kind: 'activation', weight: 30, reps: 8, done: true },
          { kind: 'warmup', weight: 30 },
          { kind: 'mini' },
        ],
        [30],
      ),
    ).toEqual([0, 1, 5]);
  });

  it('counts the card\'s load and the template\'s alike, so either tap can undo the other', () => {
    const sets = [
      { kind: 'activation' as const, weight: 20 },
      { kind: 'mini' as const, weight: 25 },
      { kind: 'mini' as const, weight: 22.5 },
    ];
    expect(loadTargetIndices(sets, [25, 20])).toEqual([0, 1]);
  });
});

describe('untouchedLoad — what a tap on the card would replace', () => {
  it('is the load the first untouched set holds', () => {
    expect(untouchedLoad([{ kind: 'activation', weight: 20, reps: 15, done: true }, { kind: 'mini', weight: 20 }], [20, 25]))
      .toBe(20);
  });

  it('is 0 for empty sets, and undefined when nothing is left to move', () => {
    expect(untouchedLoad([{ kind: 'working' }])).toBe(0);
    expect(untouchedLoad([{ kind: 'working', weight: 20, reps: 8, done: true }, { kind: 'working', weight: 22.5 }], [20]))
      .toBeUndefined();
  });
});
