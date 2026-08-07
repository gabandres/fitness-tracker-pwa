import { describe, expect, it } from "vitest";
import {
  passwordResetEmail,
  welcomeEmail,
  weeklyDigestEmail,
  type RenderedEmail,
} from "../src/email-templates";

// These templates are pure functions, so this suite needs no emulator — it
// runs under the same `npm test` wrapper as the rest for convenience.
//
// What's worth asserting here is mostly *deliverability* and *safety*
// invariants rather than copy: a missing text/plain part, an unescaped
// display name, or a reset link that only exists inside a button are all
// bugs that would ship silently and only show up as junk-foldered mail or
// an XSS report weeks later.

const LOCALES = ["en", "es-PR"] as const;

/** Anything that survives here would render as markup in a text/plain part. */
function hasHtmlTags(s: string): boolean {
  return /<[a-z/][^>]*>/i.test(s);
}

/** Collapses the 72-column hard wrap so assertions can match whole phrases. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ");
}

const ALL: Array<[string, RenderedEmail]> = [
  ...LOCALES.flatMap((locale): Array<[string, RenderedEmail]> => [
    [`welcome/${locale}`, welcomeEmail({ locale, displayName: "Ada Lovelace" })],
    [
      `reset/${locale}`,
      passwordResetEmail({ locale, resetLink: "https://example.com/r?oob=abc", displayName: null }),
    ],
    [
      `digest/${locale}`,
      weeklyDigestEmail({
        locale,
        displayName: null,
        avgCalories: 2100,
        avgProtein: 158,
        weightDeltaLbs: -1.4,
        daysLogged: 6,
        streak: 12,
      }),
    ],
  ]),
];

describe("every template", () => {
  for (const [name, email] of ALL) {
    describe(name, () => {
      it("has a non-empty subject, html and text part", () => {
        expect(email.subject.length).toBeGreaterThan(0);
        expect(email.html.length).toBeGreaterThan(0);
        // A multipart/alternative without a real text part is itself a
        // spam signal — this is the assertion that keeps it honest.
        expect(email.text.trim().length).toBeGreaterThan(0);
      });

      it("emits a text part with no markup left in it", () => {
        expect(hasHtmlTags(email.text)).toBe(false);
        expect(email.text).not.toContain("&amp;");
        expect(email.text).not.toContain("&quot;");
      });

      it("never leaks an unrendered value", () => {
        for (const part of [email.subject, email.html, email.text]) {
          expect(part).not.toContain("undefined");
          expect(part).not.toContain("NaN");
          expect(part).not.toContain("[object Object]");
          // An unsubstituted template hole, e.g. `${...}`.
          expect(part).not.toMatch(/\$\{/);
        }
      });

      it("declares both colour schemes and a dark-mode block", () => {
        expect(email.html).toContain('name="color-scheme" content="light dark"');
        expect(email.html).toContain("prefers-color-scheme: dark");
      });

      it("carries a preheader for the inbox preview", () => {
        // Hidden preview text — without it clients scrape the first body
        // words, which is how the old templates previewed as "Hi there,".
        expect(email.html).toContain("display:none;max-height:0;overflow:hidden");
      });

      it("uses table layout, not flexbox or grid", () => {
        expect(email.html).toContain('role="presentation"');
        expect(email.html).not.toMatch(/display:\s*(flex|grid)/);
      });

      it("references no external assets or scripts", () => {
        expect(email.html).not.toContain("<script");
        expect(email.html).not.toContain("<link");
        expect(email.html).not.toMatch(/<img/i);
      });
    });
  }
});

describe("welcome email", () => {
  it("greets by first name only", () => {
    const { html, text } = welcomeEmail({ locale: "en", displayName: "Ada Lovelace" });
    expect(html).toContain("Ada");
    expect(html).not.toContain("Lovelace");
    expect(text).toContain("Ada");
  });

  it("falls back to a generic greeting without a name", () => {
    const en = welcomeEmail({ locale: "en", displayName: null });
    const es = welcomeEmail({ locale: "es-PR", displayName: "  " });
    expect(en.html).toContain("Hi there");
    expect(es.html).toContain("Hola");
  });

  it("escapes a hostile display name in the HTML part", () => {
    const { html, text } = welcomeEmail({
      locale: "en",
      displayName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // The text/plain part legitimately carries the name verbatim — it is
    // never parsed as markup, so escaping there would just show the user
    // mangled entities instead of what they typed.
    expect(text).toContain("<script>");
  });

  it("advertises photo scanning, and only because it actually ships free", () => {
    // This assertion was INVERTED on 2026-08-07 (ADR-0017). It used to pin
    // the opposite — "must not contain photo/foto" — because the meal-photo
    // loop was gated off and promising it in a user's first email broke a
    // promise in their first session. The loop is now on and free on both
    // platforms, so the same reasoning now requires the mention: the email
    // lists the ways to log a meal, and omitting the headline one undersells
    // the product to every new user.
    //
    // The durable rule underneath both versions: this email may name a way to
    // log a meal if and only if a free user can actually do it today. If
    // photo-scan is ever gated again, invert this back rather than deleting
    // it — the copy and the gate have to move together, and this test is the
    // only thing that couples them.
    const word = { en: "photo", "es-PR": "foto" } as const;
    for (const locale of LOCALES) {
      const { html, text } = welcomeEmail({ locale, displayName: null });
      for (const part of [html.toLowerCase(), text.toLowerCase()]) {
        expect(part).toContain(word[locale]);
      }
    }
  });

  it("never promises a paid tier — nothing is purchasable yet", () => {
    // PRO_ENABLED is false on both platforms and no purchase surface ships,
    // so any upsell language here is a promise the app cannot keep.
    for (const locale of LOCALES) {
      const { html, text } = welcomeEmail({ locale, displayName: null });
      for (const part of [html.toLowerCase(), text.toLowerCase()]) {
        // Deliberately NOT "subscri" — that substring is inside
        // "unsubscribe", which this mail is required to offer and which the
        // test above it asserts. Ban the upsell nouns, not the stem.
        for (const banned of ["upgrade", "premium", "paid plan", "go pro"]) {
          expect(part).not.toContain(banned);
        }
      }
    }
  });

  it("offers a one-click unsubscribe path in the footer copy", () => {
    // Lifecycle mail: recipient can opt out, and says so.
    const { html } = welcomeEmail({ locale: "en", displayName: null });
    expect(flat(html)).toContain("You're receiving this because");
  });
});

describe("password reset email", () => {
  const LINK = "https://ignia.fit/__/auth/action?mode=resetPassword&oobCode=XYZ123";

  it("puts the link in the button AND as selectable text", () => {
    // A meaningful minority of clients strip or rewrite buttons; without
    // the raw URL those users have no way to complete a reset.
    const { html, text } = passwordResetEmail({ locale: "en", resetLink: LINK });
    expect(html).toContain(`href="${LINK}"`);
    expect(html.split(LINK).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).toContain(LINK);
  });

  it("states the expiry window in both locales", () => {
    expect(passwordResetEmail({ locale: "en", resetLink: LINK }).text).toContain("one hour");
    expect(passwordResetEmail({ locale: "es-PR", resetLink: LINK }).text).toContain("una hora");
  });

  it("pluralises a non-default expiry", () => {
    const en = passwordResetEmail({ locale: "en", resetLink: LINK, expiresInHours: 6 });
    const es = passwordResetEmail({ locale: "es-PR", resetLink: LINK, expiresInHours: 6 });
    expect(en.text).toContain("6 hours");
    expect(es.text).toContain("6 horas");
  });

  it("tells an unintended recipient they can ignore it", () => {
    // Trust signal for the human, legitimacy signal for the filter.
    expect(flat(passwordResetEmail({ locale: "en", resetLink: LINK }).text)).toContain(
      "Didn't request this?",
    );
    expect(flat(passwordResetEmail({ locale: "es-PR", resetLink: LINK }).text)).toContain(
      "¿No pediste esto?",
    );
  });

  it("does NOT offer an unsubscribe affordance — security mail is not opt-out", () => {
    // The copy may *mention* unsubscribing (to say it isn't possible); what
    // must not exist is a link or action, which would either no-op or lock
    // someone out of account recovery.
    for (const locale of LOCALES) {
      const { html } = passwordResetEmail({ locale, resetLink: LINK });
      expect(html).not.toMatch(/href="[^"]*unsub/i);
      expect(html).not.toMatch(/mailto:[^"]*unsubscribe/i);
    }
    expect(flat(passwordResetEmail({ locale: "en", resetLink: LINK }).text)).toContain(
      "can't unsubscribe",
    );
    expect(flat(passwordResetEmail({ locale: "es-PR", resetLink: LINK }).text)).toContain(
      "No puedes darte de baja",
    );
  });

  it("warns that Ignia never asks for a password", () => {
    expect(flat(passwordResetEmail({ locale: "en", resetLink: LINK }).text)).toContain(
      "never email you asking for your password",
    );
  });
});

describe("weekly digest email", () => {
  it("renders every stat", () => {
    const { text } = weeklyDigestEmail({
      locale: "en",
      displayName: "Sam",
      avgCalories: 2101.4,
      avgProtein: 157.8,
      weightDeltaLbs: -1.42,
      daysLogged: 6,
      streak: 12,
    });
    expect(text).toContain("2101");
    expect(text).toContain("158g");
    expect(text).toContain("−1.4 lb");
    expect(text).toContain("6 / 7");
  });

  it("shows an em dash rather than a zero for missing metrics", () => {
    // A user with no weigh-ins should not be told their weight change
    // was 0.0 lb — that is a fabricated measurement.
    const { text } = weeklyDigestEmail({
      locale: "en",
      displayName: null,
      avgCalories: null,
      avgProtein: null,
      weightDeltaLbs: null,
      daysLogged: 0,
      streak: 0,
    });
    expect(text).toContain("—");
    expect(text).not.toContain("0.0 lb");
  });

  it("signs a positive weight delta explicitly", () => {
    const { text } = weeklyDigestEmail({
      locale: "en",
      displayName: null,
      avgCalories: 2000,
      avgProtein: 150,
      weightDeltaLbs: 0.8,
      daysLogged: 7,
      streak: 3,
    });
    expect(text).toContain("+0.8 lb");
  });
});

describe("locale parity", () => {
  it("produces a different subject per locale for every template", () => {
    // Catches a template that silently forgot its es-PR branch.
    for (const kind of ["welcome", "reset", "digest"] as const) {
      const en = ALL.find(([n]) => n === `${kind}/en`)![1];
      const es = ALL.find(([n]) => n === `${kind}/es-PR`)![1];
      expect(es.subject).not.toBe(en.subject);
      expect(es.text).not.toBe(en.text);
    }
  });
});
