import { describe, expect, it } from "vitest";
import { brandActionLink } from "../src/auth-links";

/**
 * The action-link rebrand (host since 2026-07-24, path since 2026-08-31).
 * The path half is what lands users on the shell's branded `/auth/action`
 * page instead of Firebase's stock OOB card — and the conservatisms are the
 * contract: an unknown host or an unexpected path passes through untouched,
 * because a wrong guess here breaks account recovery.
 */
describe("brandActionLink", () => {
  const stock =
    "https://fitness-tracker-gb-1775407101.firebaseapp.com/__/auth/action" +
    "?mode=verifyEmail&oobCode=ABC123&apiKey=k&continueUrl=https%3A%2F%2Fignia.fit%2F&lang=en";

  it("moves the host to ignia.fit AND the path to the branded handler", () => {
    const out = new URL(brandActionLink(stock));
    expect(out.hostname).toBe("ignia.fit");
    expect(out.pathname).toBe("/auth/action");
  });

  it("preserves every query parameter, oobCode above all", () => {
    const out = new URL(brandActionLink(stock));
    expect(out.searchParams.get("oobCode")).toBe("ABC123");
    expect(out.searchParams.get("mode")).toBe("verifyEmail");
    expect(out.searchParams.get("apiKey")).toBe("k");
    expect(out.searchParams.get("continueUrl")).toBe("https://ignia.fit/");
  });

  it("leaves an unrecognised host completely alone", () => {
    const foreign = "https://example.com/__/auth/action?oobCode=X";
    expect(brandActionLink(foreign)).toBe(foreign);
  });

  it("rebrands the host but NOT an unexpected path", () => {
    const odd = "https://fitness-tracker-gb-1775407101.firebaseapp.com/somewhere/else?oobCode=X";
    const out = new URL(brandActionLink(odd));
    expect(out.hostname).toBe("ignia.fit");
    expect(out.pathname).toBe("/somewhere/else");
  });

  it("hands back non-URLs verbatim", () => {
    expect(brandActionLink("not a url")).toBe("not a url");
  });
});
