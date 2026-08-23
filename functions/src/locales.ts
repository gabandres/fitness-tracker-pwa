/**
 * The languages Ignia's outbound email speaks.
 *
 * ## Why this file exists twice
 *
 * `functions/` is not an npm workspace and cannot import `@macrolog/core`, so
 * the canonical registry — `packages/core/src/locales.ts` — is mirrored here by
 * hand. That is the same arrangement `food-plausibility.ts` uses, and it gets
 * the same treatment: `test/locales-parity.spec.ts` imports both and asserts
 * they are the same list. A hand-mirror with nothing holding it together
 * diverges silently, and this one would diverge in the worst possible place —
 * a user picks Portuguese in the app, the app agrees, and the mail still
 * arrives in English with no error anywhere.
 *
 * ## Why not just a string union
 *
 * Because that is what was here before, spelled five different ways. Every
 * call site that needed a locale wrote `preferredLocale === "es-PR" ? "es-PR"
 * : "en"`, and one of them collapsed it further into `isEs: boolean` — a
 * shape that can only ever answer "Spanish, or not". Adding Portuguese meant
 * finding all five (`weekly-digest.ts`, `user-lifecycle.ts`, `unsubscribe.ts`,
 * `password-reset.ts`, `verify-email.ts`), and four of them would have kept
 * compiling while quietly sending English.
 *
 * So the widening goes through ONE function. A sixth call site added later
 * gets the whole list for free, and a language added to the registry reaches
 * every one of them without a code change.
 */

/** A language the email templates are written in. Mirrors `LOCALE_TAGS`. */
export type EmailLocale = "en" | "es-PR" | "pt-BR";

interface EmailLocaleDefinition {
  tag: EmailLocale;
  /** BCP-47 PRIMARY subtags this locale answers for — matched on the primary
   *  subtag only, so `es-MX` takes the Puerto Rican Spanish and `pt-PT` takes
   *  the Brazilian Portuguese. See the core registry for the reasoning. */
  claims: string[];
  /** The tag `Intl` formats numbers and dates with. */
  intlTag: string;
  /** `<html lang>` on the pages `unsubscribe.ts` serves. */
  htmlLang: string;
}

export const EMAIL_LOCALES: readonly EmailLocaleDefinition[] = [
  { tag: "en", claims: ["en"], intlTag: "en-US", htmlLang: "en" },
  { tag: "es-PR", claims: ["es"], intlTag: "es-PR", htmlLang: "es" },
  { tag: "pt-BR", claims: ["pt"], intlTag: "pt-BR", htmlLang: "pt-BR" },
] as const;

/** Every shipped tag, in registration order. Mirrors core's `LOCALE_TAGS`. */
export const EMAIL_LOCALE_TAGS: readonly EmailLocale[] = EMAIL_LOCALES.map((l) => l.tag);

/** The fallback, and the language the source copy is written in. */
export const DEFAULT_EMAIL_LOCALE: EmailLocale = "en";

const BY_TAG = new Map(EMAIL_LOCALES.map((l) => [l.tag, l]));
const BY_CLAIM = new Map(
  EMAIL_LOCALES.flatMap((l) => l.claims.map((c) => [c, l.tag] as const)),
);

/**
 * Anything a client or a profile doc might hold → a locale we can actually
 * write. Never throws and never returns a tag with no templates behind it.
 *
 * Deliberately lenient about the *region*: a profile written by an older
 * client may carry a bare `es`, and Android hands out `pt_BR` with an
 * underscore on some paths. Both resolve. Anything unrecognised falls back to
 * English, which is the one language every template is guaranteed to have.
 */
export function emailLocale(pref: string | null | undefined): EmailLocale {
  if (!pref) return DEFAULT_EMAIL_LOCALE;
  const primary = pref.toLowerCase().replace(/_/g, "-").split("-")[0];
  return BY_CLAIM.get(primary) ?? DEFAULT_EMAIL_LOCALE;
}

/** The tag `Intl` should format with, falling back rather than throwing. */
export function intlTagFor(locale: EmailLocale): string {
  return BY_TAG.get(locale)?.intlTag ?? "en-US";
}

/** The value for `<html lang="…">`. */
export function htmlLangFor(locale: EmailLocale): string {
  return BY_TAG.get(locale)?.htmlLang ?? "en";
}
