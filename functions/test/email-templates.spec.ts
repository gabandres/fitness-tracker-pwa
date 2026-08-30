import { describe, expect, it } from "vitest";
import {
  day1NudgeEmail,
  passwordResetEmail,
  verifyEmailEmail,
  welcomeEmail,
  weeklyDigestEmail,
  type RenderedEmail,
} from "../src/email-templates";
import { EMAIL_LOCALE_TAGS } from "../src/locales";

// These templates are pure functions, so this suite needs no emulator — it
// runs under the same `npm test` wrapper as the rest for convenience.
//
// What's worth asserting here is mostly *deliverability* and *safety*
// invariants rather than copy: a missing text/plain part, an unescaped
// display name, or a reset link that only exists inside a button are all
// bugs that would ship silently and only show up as junk-foldered mail or
// an XSS report weeks later.

// Every shipped language, taken from the registry rather than written out
// again — a fourth language added to `locales.ts` gets the whole structural
// suite below (text part, escaping, dark mode, one-click opt-out, the /open
// CTA) with no edit here. Writing the list down a second time is exactly the
// habit that let five call sites narrow to two languages.
const LOCALES = EMAIL_LOCALE_TAGS;

/** Anything that survives here would render as markup in a text/plain part. */
function hasHtmlTags(s: string): boolean {
  return /<[a-z/][^>]*>/i.test(s);
}

/** Collapses the 72-column hard wrap so assertions can match whole phrases. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ");
}

/** A representative one-click opt-out link, shaped like `unsubscribe.ts`
 *  mints them. */
const UNSUB = "https://ignia.fit/unsubscribe?u=abc123.DEADBEEFDEADBEEFDEADBE";

const ALL: Array<[string, RenderedEmail]> = [
  ...LOCALES.flatMap((locale): Array<[string, RenderedEmail]> => [
    [
      `welcome/${locale}`,
      welcomeEmail({ locale, displayName: "Ada Lovelace", unsubscribeUrl: UNSUB }),
    ],
    [
      `reset/${locale}`,
      passwordResetEmail({ locale, resetLink: "https://example.com/r?oob=abc", displayName: null }),
    ],
    // Was absent from this list entirely, which left the highest-stakes mail
    // Ignia sends — the signup wall — with no structural coverage at all.
    [
      `verify/${locale}`,
      verifyEmailEmail({ locale, verifyLink: "https://example.com/v?oob=abc", displayName: null }),
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
        unsubscribeUrl: UNSUB,
      }),
    ],
  ]),
];

/** Every template that a recipient can opt out of. */
const LIFECYCLE = ["welcome", "digest"] as const;

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
    const pt = welcomeEmail({ locale: "pt-BR", displayName: null });
    expect(en.html).toContain("Hi there");
    expect(es.html).toContain("Hola");
    expect(pt.html).toContain("Olá");
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
    const word = { "en": "photo", "es-PR": "foto", "pt-BR": "foto" } as const;
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

describe("the 'open the app' call to action", () => {
  // Mobile is the product (ADR-0015) and the web logging surfaces are frozen
  // (ADR-0022). A recap that lands a phone user on `/app` drops them into the
  // surface that is no longer being built — which is exactly what shipped.
  // `/open` hands off to the installed app and falls back per platform.
  it("points at /open, never at the PWA", () => {
    for (const kind of LIFECYCLE) {
      for (const locale of LOCALES) {
        const { html, text } = ALL.find(([n]) => n === `${kind}/${locale}`)![1];
        expect(html).toContain('href="https://ignia.fit/open"');
        expect(text).toContain("https://ignia.fit/open");
        // The old target. `/open` must not merely be added alongside it.
        expect(html).not.toContain('href="https://ignia.fit/app"');
        expect(text).not.toContain("https://ignia.fit/app");
      }
    }
  });

  it("keeps the CTA an absolute https URL", () => {
    // A relative href or a bare `ignia://` in the button would be dead in an
    // inbox: mail clients resolve nothing and block unknown schemes.
    for (const kind of LIFECYCLE) {
      const { html } = ALL.find(([n]) => n === `${kind}/en`)![1];
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href.startsWith("https://")).toBe(true);
    }
  });
});

describe("one-click unsubscribe", () => {
  it("puts the link in the body of every lifecycle mail", () => {
    // The RFC 8058 header alone is not enough: Gmail hides its own
    // unsubscribe affordance behind a reputation check, so a recipient who
    // cannot find one reports spam instead.
    for (const kind of LIFECYCLE) {
      for (const locale of LOCALES) {
        const { html, text } = ALL.find(([n]) => n === `${kind}/${locale}`)![1];
        expect(html).toContain(`href="${UNSUB}"`);
        expect(text).toContain(UNSUB);
      }
    }
  });

  it("degrades to plain copy when no URL is supplied", () => {
    // The parameter is optional, and a missing one must not render a dead
    // link or the literal word "undefined".
    for (const locale of LOCALES) {
      const digest = weeklyDigestEmail({
        locale,
        displayName: null,
        avgCalories: 2000,
        avgProtein: 150,
        weightDeltaLbs: null,
        daysLogged: 4,
        streak: 4,
      });
      const welcome = welcomeEmail({ locale, displayName: null });
      for (const { html } of [digest, welcome]) {
        expect(html).not.toMatch(/href="[^"]*undefined/);
        expect(html).not.toMatch(/href="[^"]*unsubscribe\?u="/);
      }
    }
  });

  it("stays off transactional mail", () => {
    // Security mail is not opt-out. Advertising one here would either no-op
    // or lock someone out of account recovery.
    for (const locale of LOCALES) {
      for (const mail of [
        passwordResetEmail({ locale, resetLink: "https://example.com/r" }),
        verifyEmailEmail({ locale, verifyLink: "https://example.com/v" }),
      ]) {
        expect(mail.html).not.toMatch(/href="[^"]*\/unsubscribe/i);
      }
    }
  });
});

describe("verification email", () => {
  const LINK = "https://ignia.fit/__/auth/action?mode=verifyEmail&oobCode=XYZ123";

  it("puts the link in the button AND as selectable text", () => {
    // Same reasoning as the reset mail, and higher stakes: this one is the
    // signup wall. `firestore.rules` blocks every write until the address is
    // verified, so a recipient who cannot action it has a walled account.
    const { html, text } = verifyEmailEmail({ locale: "en", verifyLink: LINK });
    expect(html).toContain(`href="${LINK}"`);
    expect(html.split(LINK).length - 1).toBeGreaterThanOrEqual(2);
    expect(text).toContain(LINK);
  });

  it("states the expiry window in every locale", () => {
    const singular = { "en": "one hour", "es-PR": "una hora", "pt-BR": "uma hora" } as const;
    for (const locale of LOCALES) {
      expect(verifyEmailEmail({ locale, verifyLink: LINK }).text).toContain(singular[locale]);
    }
  });

  it("pluralises a non-default expiry", () => {
    const plural = { "en": "6 hours", "es-PR": "6 horas", "pt-BR": "6 horas" } as const;
    for (const locale of LOCALES) {
      expect(verifyEmailEmail({ locale, verifyLink: LINK, expiresInHours: 6 }).text)
        .toContain(plural[locale]);
    }
  });

  it("escapes a hostile display name", () => {
    const { html } = verifyEmailEmail({
      locale: "en",
      verifyLink: LINK,
      displayName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
  });

  it("warns that Ignia never asks for a password", () => {
    expect(flat(verifyEmailEmail({ locale: "en", verifyLink: LINK }).text))
      .toContain("never email you asking for your password");
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

  it("states the expiry window in every locale", () => {
    const singular = { "en": "one hour", "es-PR": "una hora", "pt-BR": "uma hora" } as const;
    for (const locale of LOCALES) {
      expect(passwordResetEmail({ locale, resetLink: LINK }).text).toContain(singular[locale]);
    }
  });

  it("pluralises a non-default expiry", () => {
    const plural = { "en": "6 hours", "es-PR": "6 horas", "pt-BR": "6 horas" } as const;
    for (const locale of LOCALES) {
      expect(passwordResetEmail({ locale, resetLink: LINK, expiresInHours: 6 }).text)
        .toContain(plural[locale]);
    }
  });

  it("tells an unintended recipient they can ignore it", () => {
    // Trust signal for the human, legitimacy signal for the filter.
    expect(flat(passwordResetEmail({ locale: "en", resetLink: LINK }).text)).toContain(
      "Didn't request this?",
    );
    expect(flat(passwordResetEmail({ locale: "es-PR", resetLink: LINK }).text)).toContain(
      "¿No pediste esto?",
    );
    expect(flat(passwordResetEmail({ locale: "pt-BR", resetLink: LINK }).text)).toContain(
      "Não foi você que pediu?",
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
    expect(flat(passwordResetEmail({ locale: "pt-BR", resetLink: LINK }).text)).toContain(
      "Não dá para cancelar",
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
    expect(text).toContain("2,101");
    expect(text).toContain("158 g");
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

describe("the weekly digest speaks the reader's units", () => {
  // UX_AUDIT F3 shipped kilograms on both frontends; this mail printed `lb`
  // at everyone until 2026-08-23. A metric user read `−1.4 lb` here and
  // `−0.6 kg` in the app, for the same week — and had no way to tell which
  // number was the real one. Storage stays in pounds; the conversion is a
  // display concern, which is what this template is.
  const base = {
    displayName: null,
    avgCalories: 2000,
    avgProtein: 150,
    daysLogged: 7,
    streak: 3,
  } as const;

  it("converts the weight delta for a metric profile", () => {
    const us = weeklyDigestEmail({ ...base, locale: "en", weightDeltaLbs: -2.2 });
    const metric = weeklyDigestEmail({
      ...base,
      locale: "en",
      weightDeltaLbs: -2.2,
      unitSystem: "metric",
    });
    expect(us.text).toContain("−2.2 lb");
    // 2.2 lb ÷ 2.20462 = 0.9979… kg.
    expect(metric.text).toContain("−1.0 kg");
    expect(metric.text).not.toContain("lb");
  });

  it("treats an absent unitSystem as US, which is what the profile means", () => {
    // `unitSystem` is optional on the profile and its absence has always
    // read as 'us' (see packages/core/src/unit-system.ts). Defaulting the
    // other way would silently restate every existing user's weight.
    const { text } = weeklyDigestEmail({ ...base, locale: "en", weightDeltaLbs: 1.5 });
    expect(text).toContain("+1.5 lb");
  });

  it("still shows a dash, not a unit, when there is nothing to convert", () => {
    const { text } = weeklyDigestEmail({
      ...base,
      locale: "pt-BR",
      weightDeltaLbs: null,
      unitSystem: "metric",
    });
    expect(text).toContain("—");
    expect(text).not.toContain("0,0 kg");
  });
});

describe("the weekly digest formats numbers the way the reader writes them", () => {
  // The mobile app started honouring this on 2026-08-23 (`d03e0723`). An
  // email that disagrees with the app about what 2,100 looks like reads as a
  // different product — and in pt-BR `2.100` and `2,100` are a factor of a
  // thousand apart, so it is not only cosmetic.
  const base = {
    displayName: null,
    avgCalories: 2100,
    avgProtein: 158,
    weightDeltaLbs: -1.4,
    daysLogged: 6,
    streak: 12,
  } as const;

  it("groups thousands per locale", () => {
    expect(weeklyDigestEmail({ ...base, locale: "en" }).text).toContain("2,100");
    expect(weeklyDigestEmail({ ...base, locale: "es-PR" }).text).toContain("2,100");
    expect(weeklyDigestEmail({ ...base, locale: "pt-BR" }).text).toContain("2.100");
  });

  it("uses the locale decimal separator on the weight delta", () => {
    expect(weeklyDigestEmail({ ...base, locale: "en" }).text).toContain("−1.4 lb");
    expect(weeklyDigestEmail({ ...base, locale: "pt-BR" }).text).toContain("−1,4 lb");
  });

  it("signs with U+2212, the glyph the stat column is set in", () => {
    // Intl emits U+002D HYPHEN-MINUS, which is narrower than the `+` it
    // sits under. The sign is rendered by hand for exactly this reason, so
    // a refactor back onto `signDisplay` should fail here.
    for (const locale of LOCALES) {
      const { text } = weeklyDigestEmail({ ...base, locale });
      expect(text).toContain("−1");
      expect(text).not.toMatch(/-\d+[.,]\d\s(lb|kg)/);
    }
  });
});

describe("the opt-out names a Settings row that exists", () => {
  // Both frontends label the toggle *weekly recap email* — web
  // `settings.reminders.weeklyDigest`, mobile `settings.weeklyDigest`. This
  // mail said "Weekly digest", the internal name, which appears nowhere in
  // either UI. Someone who changed their mind went looking for a row that is
  // not there, in every language.
  const LABEL = {
    "en": "Weekly recap email",
    "es-PR": "Resumen semanal por correo",
    "pt-BR": "E-mail de resumo semanal",
  } as const;

  it("quotes the shipped label", () => {
    for (const locale of LOCALES) {
      const { text } = weeklyDigestEmail({
        locale,
        displayName: null,
        avgCalories: 2000,
        avgProtein: 150,
        weightDeltaLbs: null,
        daysLogged: 4,
        streak: 4,
      });
      expect(flat(text)).toContain(LABEL[locale]);
    }
  });
});

describe("locale parity", () => {
  it("produces a distinct subject and body for every locale, per template", () => {
    // Catches a template that silently forgot a branch — which is exactly
    // what would have happened to pt-BR: four of the five call sites kept
    // compiling while sending English.
    for (const kind of ["welcome", "reset", "verify", "digest"] as const) {
      const rendered = LOCALES.map((l) => ALL.find(([n]) => n === `${kind}/${l}`)![1]);
      expect(new Set(rendered.map((r) => r.subject)).size).toBe(LOCALES.length);
      expect(new Set(rendered.map((r) => r.text)).size).toBe(LOCALES.length);
    }
  });

  it("declares the right language on the html element", () => {
    // Gmail's offer-to-translate prompt keys off `<html lang>`, and a
    // Portuguese mail declaring itself English gets offered a translation
    // into English.
    const expected = { "en": "en", "es-PR": "es", "pt-BR": "pt-BR" } as const;
    for (const locale of LOCALES) {
      const { html } = welcomeEmail({ locale, displayName: null });
      expect(html).toContain(`lang="${expected[locale]}"`);
    }
  });
});

describe("day-1 nudge email", () => {
  const VARIANTS = ["firstLog", "keepGoing"] as const;

  it("renders both variants in every shipped language with a text part and the /open CTA", () => {
    for (const locale of LOCALES) {
      for (const variant of VARIANTS) {
        const mail: RenderedEmail = day1NudgeEmail({ locale, variant, displayName: "Ana Lucía", unsubscribeUrl: UNSUB });
        expect(mail.subject.length).toBeGreaterThan(8);
        expect(mail.text.length).toBeGreaterThan(200);
        expect(hasHtmlTags(mail.text)).toBe(false);
        expect(mail.html).toContain("https://ignia.fit/open");
        expect(mail.html).toContain(UNSUB);
        expect(flat(mail.text)).toContain("Ana");
      }
    }
  });

  it("the two variants say different things — never-logged gets the first-meal pitch, day-0 loggers get the day-two one", () => {
    const a = day1NudgeEmail({ locale: "en", variant: "firstLog", displayName: null });
    const b = day1NudgeEmail({ locale: "en", variant: "keepGoing", displayName: null });
    expect(a.subject).not.toBe(b.subject);
    expect(flat(a.text)).toMatch(/one meal|first log/i);
    expect(flat(b.text)).toMatch(/day two|yesterday/i);
  });

  it("never shames — no streak counters, no 'you missed', no red/green scoreboard language", () => {
    for (const locale of LOCALES) {
      for (const variant of VARIANTS) {
        const t = flat(day1NudgeEmail({ locale, variant, displayName: null }).text).toLowerCase();
        expect(t).not.toMatch(/you missed|fallaste|você perdeu|streak of|racha de|sequência de|days? in a row/);
      }
    }
  });

  it("escapes a hostile display name in the HTML part", () => {
    const mail = day1NudgeEmail({ locale: "en", variant: "firstLog", displayName: "<img src=x onerror=alert(1)> Bob" });
    expect(mail.html).not.toContain("<img src=x");
  });
});
