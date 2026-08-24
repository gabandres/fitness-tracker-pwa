/**
 * Which Oura scopes Ignia needs, and how to tell that a connected user granted
 * fewer than it needs today (ADR-0026).
 *
 * ## The problem this exists to solve, before it happens
 *
 * Oura grants scopes at consent time and **a scope set cannot be widened
 * later without the user consenting again** — that is Oura's rule, not ours.
 * So the day Ignia asks for anything beyond `workout` (sleep and readiness are
 * the obvious candidates), every already-connected user is in a state the app
 * has never had to model: the link is live, the token refreshes, the callable
 * succeeds, and the new data is simply **absent**.
 *
 * That failure is silent in the worst way. Nothing errors, nothing prompts, and
 * the user sees an empty sleep card next to a Settings row that says
 * "Connected". They would have to guess that reconnecting fixes it.
 *
 * The mechanism to prevent that already exists and cost nothing: the server
 * stores the granted `scope` string on `users/{uid}/integrations/oura` at
 * connect time. This module is the other half — comparing what was granted
 * against what is required, so the UI can say "reconnect to include sleep"
 * instead of showing nothing.
 *
 * ## Why the required set lives HERE
 *
 * `functions/src/oura-link.ts` owns the authoritative `SCOPE` constant it sends
 * to Oura, and `functions/` is not a workspace so it cannot import this package
 * (the same constraint that forces the `food-search` wire contract to be
 * hand-mirrored). The two are kept in step by `oura-scopes.test.ts` here and
 * `oura-link.spec.ts` there both asserting the literal string, which is the
 * `usda-search` golden-fixture pattern applied to a one-line constant.
 *
 * **When adding a scope, change BOTH** — the server constant is what Oura is
 * asked for, and this list is what the client checks a grant against. Changing
 * only the server means nobody is ever prompted to reconnect; changing only
 * this one means everybody is prompted forever.
 */

/**
 * The scopes Ignia asks Oura for today.
 *
 * Exactly one, and that is a decision rather than a starting point: the consent
 * screen lists what it is about to share, and every extra scope makes the one
 * thing the user actually wants harder to see. Oura's console offers `email`,
 * `personal`, `daily`, `heartrate`, `tag`, `workout`, `session`, `spo2`,
 * `ring_configuration`, `stress` and `heart_health`; ADR-0026 takes `workout`
 * and argues each of the others down.
 *
 * Mirrors `SCOPE` in `functions/src/oura-link.ts`.
 */
export const OURA_REQUIRED_SCOPES: readonly string[] = ['workout'];

/**
 * Split a granted scope string into scopes.
 *
 * Oura returns them space-delimited, which is what OAuth 2 specifies, but a
 * stored value can also be a single scope with no delimiter at all — which is
 * exactly what every user connected before a second scope existed will have.
 * Commas are tolerated because some providers use them and the cost of being
 * wrong here is a spurious reconnect prompt.
 */
export function parseOuraScopes(granted: string | null | undefined): string[] {
  if (!granted) return [];
  return granted
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Scopes Ignia needs that this grant does not carry.
 *
 * Order follows {@link OURA_REQUIRED_SCOPES} so a message listing them reads
 * the same way every time.
 */
export function missingOuraScopes(granted: string | null | undefined): string[] {
  const have = new Set(parseOuraScopes(granted));
  return OURA_REQUIRED_SCOPES.filter((s) => !have.has(s));
}

/**
 * True when a connected user must re-consent to get everything Ignia now reads.
 *
 * **Returns false for an unknown grant**, and that asymmetry is deliberate. A
 * missing `scope` field means the document predates the field, not that the
 * user granted nothing — and prompting every such user to reconnect would be
 * a false alarm delivered to exactly the people whose integration is working.
 * A silent gap for a user who really is under-scoped is recoverable the moment
 * they reconnect for any other reason; a wrong prompt teaches people to ignore
 * prompts.
 */
export function needsOuraScopeUpgrade(granted: string | null | undefined): boolean {
  if (!granted) return false;
  return missingOuraScopes(granted).length > 0;
}
