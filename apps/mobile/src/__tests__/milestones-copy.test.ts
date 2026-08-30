import { LOCALES, LOCALE_DEFS } from '@/i18n/registry';

/**
 * The milestone copy may not look forward — in any language.
 *
 * ## Why this is a test and not a style note
 *
 * `UX_AUDIT.md` §S12 lists **shame-based gamification** (streak-break
 * punishment, red/green progress) among the things this product explicitly does
 * not do, and names *log — editorial, adult, not gamified* as one of four
 * load-bearing positioning words. Milestones were permitted on 2026-08-29 as a
 * NARROWING of that decision, on one finding: the pressure in a badge system
 * lives in the forward-looking meter, not in the backward-looking record.
 *
 * The whole permission therefore rests on the copy never acquiring a countdown.
 * "Two more days!" is one well-meaning pull request away, it would read as
 * helpful, and it would quietly convert a record into the mechanism the
 * positioning rejects. `packages/core/src/milestones.ts` makes it unbuildable in
 * the data layer; this makes it unshippable in the strings.
 *
 * The banned lists are per-language on purpose. A single English regex would
 * pass `faltan 3 días` without blinking, which is exactly the string that would
 * appear first — es-PR is a first-class locale here, not a translation of a
 * shipped English feature.
 */

// Forward-looking language, per locale. Deliberately about UNEARNED distance:
// "recorded", "logged" and "so far" are all retrospective and must stay legal.
const BANNED: Record<string, RegExp> = {
  en: /\b(next|remaining|until|to go|left to|keep it up|almost|so close|more to|streak at risk|don't break|days away)\b/i,
  'es-PR': /\b(próximo|próxima|siguiente|faltan?|restante|quedan?|sigue así|casi|no pierdas|te falta)\b/i,
  'pt-BR': /\b(próximo|próxima|faltam?|restante|continue assim|quase|não perca|falta pouco)\b/i,
};

const milestoneEntries = (locale: string): [string, string][] =>
  Object.entries(LOCALE_DEFS[locale as keyof typeof LOCALE_DEFS].dict).filter(([k]) =>
    k.startsWith('milestones.'),
  );

describe('milestone copy is retrospective in every locale', () => {
  it('ships milestone strings in every locale the app renders', () => {
    // Guards the guard: if the keys were renamed away from the `milestones.`
    // prefix this suite would silently scan nothing and pass forever.
    for (const locale of LOCALES) {
      expect(milestoneEntries(locale).length).toBeGreaterThan(8);
    }
  });

  it.each(LOCALES)('%s contains no forward-looking milestone copy', (locale) => {
    // A language added without a banned-word list would otherwise be scanned
    // by `undefined` and pass silently, which is the failure this whole suite
    // is guarding against — so its absence is itself the assertion.
    const banned = BANNED[locale];
    expect(BANNED).toHaveProperty(locale);

    const offenders = milestoneEntries(locale)
      .filter(([, v]) => banned.test(v))
      .map(([k, v]) => `${k}: ${v}`);

    expect(offenders).toEqual([]);
  });

  it('never promises a milestone the user has not earned', () => {
    // The archive renders earned entries only (#110 decision). A string that
    // names an unearned target is the progress meter arriving as copy.
    for (const locale of LOCALES) {
      const offenders = milestoneEntries(locale)
        .filter(([, v]) => /\d+\s*(more|más|mais)\b/i.test(v))
        .map(([k, v]) => `${locale} ${k}: ${v}`);
      expect(offenders).toEqual([]);
    }
  });

  it('says "recorded", not "achieved" — the date is when Ignia noticed', () => {
    // For a derived milestone (a streak length is not an event) `earnedAt` is
    // when the app evaluated, not when the act happened. The copy must not
    // claim more precision than that. See useMilestones.ts.
    expect(LOCALE_DEFS.en.dict['milestones.recorded']).toMatch(/recorded/i);
    expect(LOCALE_DEFS.en.dict['milestones.recorded']).not.toMatch(/achiev/i);
  });
});
