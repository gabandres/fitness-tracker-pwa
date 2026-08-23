import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_LOCALE,
  EMAIL_LOCALES,
  EMAIL_LOCALE_TAGS,
  emailLocale,
  htmlLangFor,
  intlTagFor,
} from "../src/locales";
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, normalizeLocale } from "../../packages/core/src/locales";

/**
 * The server's locale list and the shared one must be the same list.
 *
 * `functions/` is not a workspace, so `locales.ts` exists twice by hand — the
 * same arrangement as `food-plausibility.ts`, and this is its parity spec.
 *
 * The divergence this guards against is invisible in every other way. Add a
 * language to `packages/core/src/locales.ts`, ship it in both frontends, and
 * everything works: the picker offers it, the app speaks it, the profile
 * stores it. Then the user gets a welcome email in English, and nothing
 * anywhere has logged an error — the server simply never heard of the tag and
 * fell through to its default, which is the correct behaviour for a tag it
 * genuinely does not have copy for, and therefore indistinguishable from the
 * bug.
 *
 * So this file does not test the resolution rules; `packages/core` owns those.
 * It tests that the two lists are the same list.
 */

describe("the server locale list mirrors packages/core", () => {
  it("ships exactly the same tags, in the same order", () => {
    expect(EMAIL_LOCALE_TAGS).toEqual(LOCALE_TAGS);
  });

  it("agrees on the fallback", () => {
    expect(DEFAULT_EMAIL_LOCALE).toBe(DEFAULT_LOCALE);
  });

  it("claims the same primary subtags per locale", () => {
    // The mismatch that matters: core takes `pt` for pt-BR, so a Brazilian
    // user's browser gets Portuguese in the app. If the server's table did
    // not claim it, the same user's mail would arrive in English.
    for (const core of LOCALES) {
      const mirror = EMAIL_LOCALES.find((l) => l.tag === core.tag);
      expect(mirror, `no server entry for ${core.tag}`).toBeDefined();
      expect(mirror!.claims).toEqual(core.claims);
    }
  });

  it("formats with the same Intl tag", () => {
    // A digest that groups thousands differently from the app it summarises
    // is the same defect `d03e0723` fixed on mobile.
    for (const core of LOCALES) {
      expect(intlTagFor(core.tag as never)).toBe(core.intlTag);
    }
  });

  it("resolves any given tag identically", () => {
    // Spread across the shapes that actually reach these functions: stored
    // preferences, browser languages, the underscore form Android hands out,
    // and the junk a hand-written client can send.
    const SAMPLES = [
      "en",
      "en-US",
      "en-GB",
      "es",
      "es-PR",
      "es-MX",
      "es-419",
      "pt",
      "pt-BR",
      "pt-PT",
      "pt_BR",
      "PT-br",
      "fr",
      "zh-Hans",
      "",
      "   ",
      "es-PR-extra",
      null,
      undefined,
    ];

    for (const sample of SAMPLES) {
      // Core returns null for "we ship nothing for this"; the server has to
      // pick a language regardless, and English is the one every template
      // is guaranteed to have. That is the ONLY difference between them.
      const expected = normalizeLocale(sample) ?? DEFAULT_LOCALE;
      expect(emailLocale(sample), `for ${JSON.stringify(sample)}`).toBe(expected);
    }
  });
});

describe("html lang", () => {
  it("is a valid, distinct BCP-47 tag for every locale", () => {
    const seen = new Set<string>();
    for (const tag of EMAIL_LOCALE_TAGS) {
      const lang = htmlLangFor(tag);
      expect(lang).toMatch(/^[a-z]{2}(-[A-Za-z]{2,4})?$/);
      expect(seen.has(lang)).toBe(false);
      seen.add(lang);
    }
  });
});
