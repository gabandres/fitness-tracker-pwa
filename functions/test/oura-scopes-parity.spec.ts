import { describe, expect, it } from "vitest";
import { mintOuraState, ouraAuthorizeUrl } from "../src/oura-link";
import {
  OURA_REQUIRED_SCOPES,
  missingOuraScopes,
  needsOuraScopeUpgrade,
  parseOuraScopes,
} from "../../packages/core/src/oura-scopes";

/**
 * What the server ASKS Oura for and what the client CHECKS a grant against
 * must be the same set.
 *
 * `functions/` is not a workspace and cannot import `@macrolog/core`
 * (ADR-0012), so the list exists twice: `SCOPE` in
 * `functions/src/oura-link.ts:56` — whose own header says "Hand-mirrored by
 * `OURA_REQUIRED_SCOPES`" — and `OURA_REQUIRED_SCOPES` in
 * `packages/core/src/oura-scopes.ts`. This is the holder that header assumes
 * exists, the fourth of its kind here (`food-plausibility-parity`,
 * `locales-parity`, `food-search-parity`).
 *
 * WHY THE TWO EXISTING ASSERTIONS ARE NOT THIS CHECK. Both sides already pin
 * the literal in their own suite — `oura-link.spec.ts` asserts the authorize
 * URL carries `"workout daily"`, `oura-scopes.test.ts` asserts the array is
 * `['workout','daily']`. Neither one can see the other. The realistic edit is
 * a single sitting: someone adds `heartrate` to the server constant and fixes
 * the spec sitting two files away that just went red. Both functions suites
 * are green, core is untouched, and core's own suite is green too — it is
 * still asserting its own unchanged literal. Nothing is red anywhere.
 *
 * AND THE CONSEQUENCE IS THE OPPOSITE OF A CRASH. Oura cannot widen a grant
 * without re-consent, so drift lands as: every already-connected user keeps
 * the narrower grant, `needsOuraScopeUpgrade` says false because core does not
 * know the new scope is required, no reconnect prompt is ever shown, and the
 * new data is simply absent behind a Settings row reading "Connected". The
 * reverse drift is worse in a different direction — core requiring a scope the
 * server never asks for prompts EVERY user to reconnect, forever, and
 * reconnecting does not fix it.
 *
 * BEHAVIOURAL, not text. The two sides are deliberately different SHAPES — a
 * space-delimited OAuth string on the wire, an array in core — so a source
 * diff would be comparing a string to an array literal. What is shared is the
 * SET, and the closed loop below is the property that actually matters: a user
 * who grants exactly what the server asked for is never told to reconnect.
 *
 * Emulator-free: `ouraAuthorizeUrl` is pure string-building, and reading the
 * scope from the URL rather than from an exported constant means this holds
 * what is really SENT to Oura, not a constant that could stop feeding it.
 */

const UID = "xFm6lDvP7eSQdayrXqkVuHVRYIM2";
const SECRET = "oura_test_secret_0000000000";

/** Exactly the `scope` Oura is asked for, read off the authorize URL. */
const SERVER_SCOPE = new URL(
  ouraAuthorizeUrl(mintOuraState(UID, SECRET, 1_756_000_000_000)),
).searchParams.get("scope");

describe("Oura scope parity — server request vs core requirement", () => {
  it("sends a scope at all", () => {
    expect(SERVER_SCOPE, "no scope parameter in the authorize URL").toBeTruthy();
  });

  it("asks for exactly the scopes core requires, and no others", () => {
    expect(
      parseOuraScopes(SERVER_SCOPE),
      `SCOPE in functions/src/oura-link.ts and OURA_REQUIRED_SCOPES in ` +
        `packages/core/src/oura-scopes.ts disagree. Both must change together: ` +
        `server-only means no user is ever prompted to reconnect, core-only means ` +
        `every user is prompted forever.`,
    ).toEqual([...OURA_REQUIRED_SCOPES]);
  });

  it("closes the loop: granting what the server asked for needs no upgrade", () => {
    // The user-visible property, stated once. `integrations/oura.scope` is
    // stored verbatim from Oura's token response, so this is the exact string
    // a user who consents today ends up holding.
    expect(missingOuraScopes(SERVER_SCOPE)).toEqual([]);
    expect(needsOuraScopeUpgrade(SERVER_SCOPE)).toBe(false);
  });

  it("still flags the pre-2026-08-24 grant as needing an upgrade", () => {
    // `workout` alone is the state every user who linked before `daily` was
    // added is really in (see the core module header). If this ever stops
    // being an upgrade it means `daily` left the required set, which is a
    // product decision and not something a refactor should be able to make.
    expect(needsOuraScopeUpgrade("workout")).toBe(true);
    expect(missingOuraScopes("workout")).toContain("daily");
  });

  it("uses the space delimiter OAuth 2 specifies", () => {
    // `parseOuraScopes` tolerates commas, so the assertion above would pass on
    // a comma-joined string that Oura itself would reject at the consent
    // screen — a failure that lives outside both suites entirely.
    expect(SERVER_SCOPE).toBe([...OURA_REQUIRED_SCOPES].join(" "));
  });
});
