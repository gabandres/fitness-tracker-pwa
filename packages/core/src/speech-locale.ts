/**
 * Choosing the speech-recognition locale, and deciding what a transcript means.
 *
 * Both are pure so they can be tested without a microphone. On a device the
 * failure they prevent is silent: a recogniser handed a locale it does not have
 * returns nothing at all, and a transcript routed to the wrong surface looks
 * like the mic "not working".
 */

/**
 * Pick the best speech locale the device actually has for an app locale.
 *
 * Our locale is a **profile** preference (`es-PR`, `en`), not the device's — the
 * same distinction every glanceable surface in this app draws. The recogniser's
 * list is the device's, and `es-PR` is very unlikely to be on it.
 *
 * Resolution order, most to least specific:
 *
 *   1. the exact tag (`es-PR`) if the device really has it;
 *   2. a **preferred regional substitute** — `es-PR` → `es-US`, because Puerto
 *      Rico is US-market Spanish and `es-US` is the tag phones actually ship;
 *   3. any locale in the same language (`es-MX`, `es-ES`, …), so a Spanish
 *      speaker gets Spanish rather than English;
 *   4. any English, then whatever the device offers first.
 *
 * Never returns `undefined`: handing the recogniser nothing is worse than
 * handing it an imperfect match, because "no result" is indistinguishable from
 * a broken mic.
 *
 * `supported` is what `getSupportedLocales()` reports. Pass the **installed**
 * list when asking for on-device recognition and the full list otherwise — the
 * difference is exactly why this takes the list rather than guessing.
 */
export function resolveSpeechLocale(appLocale: string, supported: readonly string[]): string {
  const want = appLocale.trim();
  if (!want) return fallback(supported);

  const has = (tag: string) => supported.find((s) => s.toLowerCase() === tag.toLowerCase());

  const exact = has(want);
  if (exact) return exact;

  const preferred = PREFERRED_SUBSTITUTE[want.toLowerCase()];
  if (preferred) {
    const sub = has(preferred);
    if (sub) return sub;
  }

  const lang = want.split(/[-_]/)[0].toLowerCase();
  const sameLanguage = supported.find((s) => s.split(/[-_]/)[0].toLowerCase() === lang);
  if (sameLanguage) return sameLanguage;

  return fallback(supported);
}

/** Regional substitutions worth making before falling back to "any same-language". */
const PREFERRED_SUBSTITUTE: Record<string, string> = {
  // Puerto Rico is US-market Spanish, and `es-US` is a tag phones actually ship.
  'es-pr': 'es-US',
  en: 'en-US',
};

function fallback(supported: readonly string[]): string {
  const english = supported.find((s) => s.toLowerCase().startsWith('en'));
  return english ?? supported[0] ?? 'en-US';
}

/**
 * What to do with a finished transcript.
 *
 * A mic on the search field is ambiguous by nature: "chicken" is a search, while
 * "a cup of oats and six ounces of grilled chicken" is a whole meal that the
 * search box cannot express. Feeding the second into a food search returns
 * nothing useful and reads as the mic being broken.
 *
 * So the transcript is routed by whether the deterministic parser found any
 * **quantity** in it — which is the signal that separates "find me this food"
 * from "log these amounts". `parse` is injected rather than imported so this
 * stays pure and testable.
 *
 * Deliberately conservative: anything that is not clearly a quantified meal goes
 * to search, where the user can see and edit it. The cost of routing a meal to
 * search is one extra tap; the cost of routing a search to the meal draft is a
 * confusing screen the user did not ask for.
 */
export function routeTranscript(
  transcript: string,
  parse: (text: string) => readonly { quantity?: number | null; unit?: string | null }[],
): { to: 'meal'; text: string } | { to: 'search'; text: string } {
  const text = transcript.trim();
  if (!text) return { to: 'search', text: '' };

  let parsed: readonly { quantity?: number | null; unit?: string | null }[] = [];
  try {
    parsed = parse(text) ?? [];
  } catch {
    return { to: 'search', text };
  }

  const quantified = parsed.filter((p) => typeof p.quantity === 'number' && p.quantity > 0);
  // Two or more foods is a meal even without units; one food with an explicit
  // unit ("100 g chicken") is too. A bare "chicken" is a search.
  const isMeal = parsed.length > 1 || (quantified.length > 0 && Boolean(quantified[0].unit));
  return isMeal ? { to: 'meal', text } : { to: 'search', text };
}
