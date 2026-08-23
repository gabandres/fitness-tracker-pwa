// Ignia transactional email templates.
//
// ─── Why this file looks the way it does ────────────────────────────
//
// Every template is authored ONCE as an array of structural `Block`s and
// then rendered twice — `renderHtml` and `renderText`. Email clients that
// receive a `multipart/alternative` without a real text/plain part get a
// measurable spam penalty, and hand-maintained plain-text twins always
// drift from the HTML within a release or two. Deriving both from the same
// blocks makes drift structurally impossible.
//
// Brand: Ignia (ADR-0015). Warm near-white paper, warm near-black ink,
// ember-coral accent — the same palette the shipped apps use
// (`apps/mobile/src/theme.ts`). The heading keeps the serif italic from the
// original editorial direction because that is the recognisable brand mark;
// body copy moved to a system sans stack for legibility at small sizes.
//
// Email-HTML constraints honoured throughout: tables not flexbox, inline
// CSS on every element (light-mode fallback), ~600px, no external assets,
// no JS. Dark mode is layered on top via `prefers-color-scheme` classes —
// clients that ignore the <style> block simply keep the inline light
// styling, which is the correct fallback.

import { type EmailLocale, htmlLangFor, intlTagFor } from "./locales";

// ─── Palette ────────────────────────────────────────────────────────
// Mirrors `apps/mobile/src/theme.ts` (`palettes.light` / `palettes.dark`).
// If the app palette moves, move these with it.

// Token-for-token parity with the app: `surface` is the app's `card`, and the
// button uses `ink` / `onInk` because that is what the app uses for strong
// CTAs and the FAB. Coral stays where the app puts it — accent text, links
// and list bullets — rather than becoming a button fill.
const LIGHT = {
  paper: "#faf9f6",
  surface: "#f4f2ee",
  ink: "#1c1917",
  onInk: "#ffffff",
  muted: "#57534e",
  line: "#e7e5e2",
  accent: "#c62f27",
  accentSoft: "#faf3f1",
} as const;

const DARK = {
  paper: "#131210",
  surface: "#1d1b18",
  ink: "#f3f1ec",
  onInk: "#131210",
  muted: "#b3ada3",
  line: "#2b2822",
  accent: "#ff8a5c",
  accentSoft: "#2a1712",
} as const;

const SERIF = "Georgia,'Iowan Old Style','Times New Roman',serif";
const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

const SITE = "https://ignia.fit";

// ─── Where "open the app" points ────────────────────────────────────
//
// NOT `${SITE}/app` (the PWA). Mobile is the product (ADR-0015) and the web
// logging surfaces are frozen (ADR-0022), so a recap that lands a phone user
// in the browser drops them into the surface that is no longer being built.
//
// `/open` is a static redirector (`public/open.html`), not a page anyone is
// meant to read: it hands the request to the installed app via the `ignia://`
// scheme, and falls back to the App Store / Play / the PWA per platform. It
// exists because Ignia has **no universal links yet** — `app.json` declares no
// `associatedDomains` and no `autoVerify` intent filter, so `https://ignia.fit/...`
// cannot be captured by the app on either platform. Adding those is a native
// change: it moves the EAS fingerprint, which would strand the iOS OTA that
// `STATUS.md` §2 is holding for 1.2.0's approval. Until a build carries them,
// a redirector is the only thing that can open the app from an inbox.
const APP_LINK = `${SITE}/open`;

// ─── Block model ────────────────────────────────────────────────────
//
// `text` fields carry a tiny inline-HTML subset (<strong>, <em>, <a href>).
// `renderText` unwraps that subset rather than regex-stripping arbitrary
// markup — the input is authored in this file, so the grammar is closed and
// the conversion is total.

export type Block =
  | { kind: "para"; text: string }
  | { kind: "lead"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "button"; label: string; href: string }
  | { kind: "linkFallback"; href: string; note: string }
  | { kind: "stats"; rows: Array<{ label: string; value: string }> }
  | { kind: "note"; text: string }
  | { kind: "divider" };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Plain-text rendering ───────────────────────────────────────────

/** Unwraps the authored inline-HTML subset into plain text. Anchors become
 *  `label (url)` so a text-only reader never loses the destination. */
function inlineToText(html: string): string {
  return html
    .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_m, href, label) =>
      label.trim() === href.trim() ? href : `${label} (${href})`,
    )
    .replace(/<\/?(strong|b|em|i|span)[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Hard-wraps at 72 columns — the width plain-text mail readers assume. */
function wrap(text: string, width = 72): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const out: string[] = [];
      let current = "";
      for (const word of line.split(" ")) {
        if (current && (current + " " + word).length > width) {
          out.push(current);
          current = word;
        } else {
          current = current ? current + " " + word : word;
        }
      }
      if (current) out.push(current);
      return out.join("\n");
    })
    .join("\n");
}

function renderText(heading: string, blocks: Block[], footer: string[]): string {
  const parts: string[] = [heading.toUpperCase(), "=".repeat(Math.min(heading.length, 72)), ""];

  for (const b of blocks) {
    switch (b.kind) {
      case "lead":
      case "para":
        parts.push(wrap(inlineToText(b.text)), "");
        break;
      case "list":
        for (const item of b.items) {
          const t = wrap(inlineToText(item), 69).split("\n").join("\n   ");
          parts.push(` - ${t}`);
        }
        parts.push("");
        break;
      case "button":
        parts.push(`${inlineToText(b.label).toUpperCase()}:`, b.href, "");
        break;
      case "linkFallback":
        parts.push(wrap(inlineToText(b.note)), b.href, "");
        break;
      case "stats":
        for (const r of b.rows) {
          parts.push(`  ${r.label.padEnd(24, ".")} ${r.value}`);
        }
        parts.push("");
        break;
      case "note":
        parts.push(wrap(inlineToText(b.text)), "");
        break;
      case "divider":
        parts.push("-".repeat(48), "");
        break;
    }
  }

  parts.push("-".repeat(48));
  for (const f of footer) parts.push(wrap(inlineToText(f)));
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ─── HTML rendering ─────────────────────────────────────────────────

function htmlPara(text: string, lead: boolean): string {
  const size = lead ? 17 : 16;
  return `<p class="i-ink" style="margin:0 0 16px;color:${LIGHT.ink};font-family:${SANS};font-size:${size}px;line-height:1.62;">${text}</p>`;
}

function htmlList(items: string[]): string {
  // Table-based list: Outlook's Word engine mangles <ul> padding, and a
  // table lets the bullet keep its colour independent of the text.
  const rows = items
    .map(
      (item) => `<tr>
        <td valign="top" style="padding:0 10px 12px 0;font-family:${SANS};font-size:16px;line-height:1.62;color:${LIGHT.accent};" class="i-accent">&bull;</td>
        <td valign="top" class="i-ink" style="padding:0 0 12px;color:${LIGHT.ink};font-family:${SANS};font-size:16px;line-height:1.62;">${item}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">${rows}</table>`;
}

function htmlButton(label: string, href: string): string {
  // Bulletproof pattern: padding lives on the <td>, not the <a>, because
  // Outlook desktop drops padding on inline anchors. border-radius is
  // ignored there too — it degrades to a square button, which is fine.
  //
  // Filled with `ink`, matching the app's strong-CTA/FAB treatment. In dark
  // mode `ink` is the light token and `onInk` the dark one, so the button
  // inverts exactly the way it does in the app.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:26px auto 20px;">
    <tr>
      <td class="i-btn" bgcolor="${LIGHT.ink}" style="background-color:${LIGHT.ink};border-radius:6px;">
        <a href="${href}" class="i-btn-a" style="display:inline-block;padding:14px 34px;font-family:${SANS};font-size:15px;font-weight:700;letter-spacing:0.01em;color:${LIGHT.onInk};text-decoration:none;border-radius:6px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function htmlLinkFallback(href: string, note: string): string {
  return `<p class="i-muted" style="margin:0 0 16px;color:${LIGHT.muted};font-family:${SANS};font-size:13px;line-height:1.55;">${note}<br>
    <a href="${href}" class="i-accent" style="color:${LIGHT.accent};font-family:${MONO};font-size:12px;word-break:break-all;">${href}</a></p>`;
}

function htmlStats(rows: Array<{ label: string; value: string }>): string {
  const body = rows
    .map(
      (r) => `<tr>
      <td class="i-muted i-line" style="padding:11px 0;border-bottom:1px solid ${LIGHT.line};color:${LIGHT.muted};font-family:${SANS};font-size:12px;letter-spacing:0.06em;text-transform:uppercase;">${r.label}</td>
      <td align="right" class="i-ink i-line" style="padding:11px 0;border-bottom:1px solid ${LIGHT.line};color:${LIGHT.ink};font-family:${SERIF};font-size:24px;">${r.value}</td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;">${body}</table>`;
}

function htmlNote(text: string): string {
  return `<p class="i-muted" style="margin:0 0 12px;color:${LIGHT.muted};font-family:${SANS};font-size:13px;line-height:1.55;">${text}</p>`;
}

function htmlDivider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="i-line" style="border-top:1px solid ${LIGHT.line};font-size:0;line-height:0;height:1px;padding:0;">&nbsp;</td></tr></table><div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>`;
}

function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "lead":
          return htmlPara(b.text, true);
        case "para":
          return htmlPara(b.text, false);
        case "list":
          return htmlList(b.items);
        case "button":
          return htmlButton(b.label, b.href);
        case "linkFallback":
          return htmlLinkFallback(b.href, b.note);
        case "stats":
          return htmlStats(b.rows);
        case "note":
          return htmlNote(b.text);
        case "divider":
          return htmlDivider();
      }
    })
    .join("\n");
}

interface LayoutParams {
  /** Inbox preview line. Without one, clients scrape the first body words —
   *  which is why the old templates previewed as "Hi there,". */
  preheader: string;
  heading: string;
  blocks: Block[];
  footer: string[];
  /** `<html lang>`. Screen readers pick a voice from it, and Gmail's
   *  offer-to-translate prompt keys off it — a Portuguese mail declaring
   *  itself English gets offered a translation into English. */
  lang: string;
}

function layout(p: LayoutParams): string {
  const footerHtml = p.footer
    .map(
      (line) =>
        `<p class="i-muted" style="margin:0 0 6px;color:${LIGHT.muted};font-family:${SANS};font-size:12px;line-height:1.5;">${line}</p>`,
    )
    .join("");

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${p.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(p.heading)}</title>
  <style>
    /* Dark mode. Inline styles above are the light-mode fallback for the
       many clients that strip <style> entirely; these classes only ever
       override, never establish. */
    @media (prefers-color-scheme: dark) {
      .i-body   { background-color: ${DARK.paper} !important; }
      .i-card   { background-color: ${DARK.surface} !important; border-color: ${DARK.line} !important; }
      .i-head   { background-color: ${DARK.accentSoft} !important; border-color: ${DARK.line} !important; }
      .i-ink    { color: ${DARK.ink} !important; }
      .i-muted  { color: ${DARK.muted} !important; }
      .i-accent { color: ${DARK.accent} !important; }
      .i-line   { border-color: ${DARK.line} !important; }
      .i-btn    { background-color: ${DARK.ink} !important; }
      .i-btn-a  { color: ${DARK.onInk} !important; }
    }
    /* Long URLs must not force a horizontal scroll on narrow screens. */
    @media only screen and (max-width: 620px) {
      .i-shell { width: 100% !important; }
      .i-pad   { padding-left: 22px !important; padding-right: 22px !important; }
    }
    a { text-decoration: none; }
  </style>
</head>
<body class="i-body" style="margin:0;padding:0;width:100%;background-color:${LIGHT.paper};-webkit-font-smoothing:antialiased;">
  <!-- Preheader: shown in the inbox list, never in the open message. The
       zero-width padding stops Gmail from trailing body copy after it. -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${LIGHT.paper};opacity:0;">
    ${escapeHtml(p.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="i-body" bgcolor="${LIGHT.paper}" style="background-color:${LIGHT.paper};">
    <tr>
      <td align="center" style="padding:32px 16px 40px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="i-shell" style="width:600px;max-width:600px;">

          <!-- Masthead -->
          <tr>
            <td class="i-head i-pad" bgcolor="${LIGHT.accentSoft}" style="background-color:${LIGHT.accentSoft};border:1px solid ${LIGHT.line};border-bottom:none;border-radius:10px 10px 0 0;padding:30px 36px 24px;">
              <p class="i-accent" style="margin:0 0 10px;font-family:${MONO};font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${LIGHT.accent};font-weight:700;">Ignia</p>
              <h1 class="i-ink" style="margin:0;font-family:${SERIF};font-style:italic;font-size:33px;font-weight:400;line-height:1.12;letter-spacing:-0.015em;color:${LIGHT.ink};">${escapeHtml(p.heading)}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="i-card i-pad" bgcolor="${LIGHT.surface}" style="background-color:${LIGHT.surface};border:1px solid ${LIGHT.line};border-top:none;border-radius:0 0 10px 10px;padding:30px 36px 26px;">
              ${renderBlocks(p.blocks)}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" class="i-pad" style="padding:22px 24px 0;">
              ${footerHtml}
              <p style="margin:10px 0 0;">
                <a href="${SITE}" class="i-accent" style="color:${LIGHT.accent};font-family:${MONO};font-size:12px;font-weight:700;letter-spacing:0.08em;">ignia.fit</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Real text/plain alternative. A missing one is itself a spam signal. */
  text: string;
}

function build(
  locale: EmailLocale,
  subject: string,
  preheader: string,
  heading: string,
  blocks: Block[],
  footer: string[],
): RenderedEmail {
  return {
    subject,
    html: layout({ preheader, heading, blocks, footer, lang: htmlLangFor(locale) }),
    text: renderText(heading, blocks, footer),
  };
}

// ─── Shared footers ─────────────────────────────────────────────────
//
// Transactional mail (password reset) deliberately carries NO unsubscribe
// invitation — you cannot opt out of account-security mail, and offering it
// confuses the consent model. Lifecycle mail (welcome, digest) does.
//
// These used to take `isEs: boolean`, which is why adding a third language
// touched this file at all: a boolean can only ever answer "Spanish, or not".
// They take a tag now, and the tables below are exhaustive by type — a
// language added to `locales.ts` fails the build here until its copy exists,
// which is the whole point. Silence would mean shipping English to someone
// who asked for Portuguese.

function link(label: string, href: string): string {
  return `<a href="${href}" style="color:${LIGHT.accent};" class="i-accent">${label}</a>`;
}

const FOOTER_LIFECYCLE: Record<EmailLocale, (unsub?: string) => string[]> = {
  "en": () => [
    "You're receiving this because you created an Ignia account.",
    `Private log · no ads · we never sell your data · ${link("Privacy policy", `${SITE}/privacy`)}`,
  ],
  "es-PR": () => [
    "Recibiste este correo porque creaste una cuenta en Ignia.",
    `Bitácora privada · sin anuncios · nunca vendemos tus datos · ${link("Política de privacidad", `${SITE}/privacy`)}`,
  ],
  "pt-BR": () => [
    "Você está recebendo este e-mail porque criou uma conta no Ignia.",
    `Diário privado · sem anúncios · nunca vendemos os seus dados · ${link("Política de privacidade", `${SITE}/privacy`)}`,
  ],
};

const FOOTER_UNSUB: Record<EmailLocale, (url: string) => string> = {
  "en": (url) => `${link("Unsubscribe from the weekly recap", url)} · one click, no questions.`,
  "es-PR": (url) => `${link("Darte de baja del resumen semanal", url)} · un clic, sin preguntas.`,
  "pt-BR": (url) => `${link("Cancelar o resumo semanal", url)} · um clique, sem perguntas.`,
};

function footerLifecycle(locale: EmailLocale, unsubscribeUrl?: string): string[] {
  const lines = FOOTER_LIFECYCLE[locale]();

  // A visible opt-out, not just a header. Gmail hides its own unsubscribe
  // affordance behind a sender-reputation check, so a recipient who wants out
  // and cannot find the button marks the mail as spam instead — the single
  // most expensive signal a sender can collect.
  if (unsubscribeUrl) lines.push(FOOTER_UNSUB[locale](unsubscribeUrl));
  return lines;
}

const FOOTER_TRANSACTIONAL: Record<EmailLocale, string[]> = {
  "en": [
    "This is an automated security message about your Ignia account. You can't unsubscribe from these.",
    `<a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Privacy policy</a>`,
  ],
  "es-PR": [
    "Este es un correo automático de seguridad de tu cuenta Ignia. No puedes darte de baja de estos mensajes.",
    `<a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Política de privacidad</a>`,
  ],
  "pt-BR": [
    "Esta é uma mensagem automática de segurança da sua conta Ignia. Não dá para cancelar este tipo de e-mail.",
    `<a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Política de privacidade</a>`,
  ],
};

function footerTransactional(locale: EmailLocale): string[] {
  return FOOTER_TRANSACTIONAL[locale];
}

function firstNameOf(displayName?: string | null): string | null {
  return (displayName ?? "").trim().split(/\s+/)[0] || null;
}

/** `Hi <strong>Ada</strong>,` — or the nameless form when there is no name. */
const GREETING: Record<EmailLocale, (first: string | null) => string> = {
  "en": (f) => (f ? `Hi <strong>${escapeHtml(f)}</strong>,` : "Hi there,"),
  "es-PR": (f) => (f ? `Hola <strong>${escapeHtml(f)}</strong>,` : "Hola,"),
  "pt-BR": (f) => (f ? `Olá <strong>${escapeHtml(f)}</strong>,` : "Olá,"),
};

// ─── Welcome ────────────────────────────────────────────────────────

export interface WelcomeEmailParams {
  locale: EmailLocale;
  displayName?: string | null;
  /** Per-recipient one-click opt-out (`unsubscribe.ts`). Omitting it degrades
   *  the mail to a mailto-only opt-out — correct, but worse. */
  unsubscribeUrl?: string;
}

type Welcome = (first: string | null, unsubscribeUrl?: string) => RenderedEmail;

export function welcomeEmail(params: WelcomeEmailParams): RenderedEmail {
  return WELCOME[params.locale](firstNameOf(params.displayName), params.unsubscribeUrl);
}

function welcomeEn(first: string | null, unsubscribeUrl?: string): RenderedEmail {
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["en"](first) },
    {
      kind: "para",
      text:
        "Ignia is a quiet, private calorie and protein log. No ads, no streaks that shame you, no red-and-green scoreboards — just a calm place to record what you eat so the math can do the work.",
    },
    { kind: "para", text: "Three things worth knowing in your first week:" },
    {
      kind: "list",
      items: [
        "<strong>Log first, analyse later.</strong> The capture surface is built for speed — get the meal in, move on. The insights only start paying off once there's data behind them.",
        "<strong>Your TDEE gets real after two weeks.</strong> Until then Ignia uses a Mifflin-St Jeor estimate. Once you have 14 days of weight and log data, it switches to a measured TDEE tuned to you.",
        "<strong>Four ways to log a meal:</strong> snap a photo, type it in plain language, pick a saved preset, or scan a barcode. All four are free.",
      ],
    },
    { kind: "divider" },
    {
      kind: "para",
      text:
        "The one question this app exists to answer is: <em>how many calories do I have left today?</em> Everything else is in service of that.",
    },
    { kind: "button", label: "Open your log", href: APP_LINK },
    { kind: "note", text: "Questions? Just reply — it reaches a human." },
  ];
  return build(
    "en",
    "Welcome to Ignia",
    "Your private calorie and protein log is ready — here's how to get the most out of week one.",
    "You're in.",
    blocks,
    footerLifecycle("en", unsubscribeUrl),
  );
}

function welcomeEs(first: string | null, unsubscribeUrl?: string): RenderedEmail {
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["es-PR"](first) },
    {
      kind: "para",
      text:
        "Ignia es una bitácora privada y silenciosa de calorías y proteína. Sin anuncios, sin rachas que te avergüencen, sin marcadores rojo-verde — solo un lugar tranquilo para anotar lo que comes y dejar que las matemáticas trabajen.",
    },
    { kind: "para", text: "Tres cosas que vale la pena saber en tu primera semana:" },
    {
      kind: "list",
      items: [
        "<strong>Primero registra, después analiza.</strong> La pantalla de captura está hecha para la velocidad — anota la comida y sigue. Los análisis empiezan a rendir cuando ya hay datos detrás.",
        "<strong>Tu TDEE se vuelve real después de dos semanas.</strong> Mientras tanto Ignia usa una estimación Mifflin-St Jeor. Cuando tengas 14 días de peso y bitácora, cambia a un TDEE medido y afinado a ti.",
        "<strong>Cuatro formas de registrar una comida:</strong> tómale una foto, escríbela en lenguaje natural, elige un preset guardado, o escanea un código de barras. Las cuatro son gratis.",
      ],
    },
    { kind: "divider" },
    {
      kind: "para",
      text:
        "La única pregunta que esta app existe para contestar es: <em>¿cuántas calorías me quedan hoy?</em> Todo lo demás está al servicio de eso.",
    },
    { kind: "button", label: "Abrir tu bitácora", href: APP_LINK },
    { kind: "note", text: "¿Preguntas? Responde a este correo — llega a una persona." },
  ];
  return build(
    "es-PR",
    "Bienvenido a Ignia",
    "Tu bitácora privada de calorías y proteína está lista — así aprovechas la primera semana.",
    "Listo.",
    blocks,
    footerLifecycle("es-PR", unsubscribeUrl),
  );
}

function welcomePt(first: string | null, unsubscribeUrl?: string): RenderedEmail {
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["pt-BR"](first) },
    {
      kind: "para",
      text:
        "O Ignia é um diário silencioso e privado de calorias e proteína. Sem anúncios, sem sequências que te envergonham, sem placares vermelho-e-verde — só um lugar tranquilo para anotar o que você come e deixar a matemática trabalhar.",
    },
    { kind: "para", text: "Três coisas que vale a pena saber na primeira semana:" },
    {
      kind: "list",
      items: [
        "<strong>Primeiro registre, depois analise.</strong> A tela de registro foi feita para ser rápida — anote a refeição e siga em frente. As análises só começam a valer quando já existem dados por trás delas.",
        "<strong>A sua manutenção fica real depois de duas semanas.</strong> Até lá o Ignia usa uma estimativa Mifflin-St Jeor. Quando você tiver 14 dias de peso e de registro, ele troca por um gasto medido e ajustado a você.",
        "<strong>Quatro jeitos de registrar uma refeição:</strong> tire uma foto, escreva em linguagem natural, escolha um atalho salvo, ou leia um código de barras. Os quatro são gratuitos.",
      ],
    },
    { kind: "divider" },
    {
      kind: "para",
      text:
        "A única pergunta que este app existe para responder é: <em>quantas calorias eu ainda tenho hoje?</em> Todo o resto está a serviço disso.",
    },
    { kind: "button", label: "Abrir o seu diário", href: APP_LINK },
    { kind: "note", text: "Dúvidas? É só responder — chega numa pessoa." },
  ];
  return build(
    "pt-BR",
    "Bem-vindo ao Ignia",
    "O seu diário privado de calorias e proteína está pronto — veja como aproveitar a primeira semana.",
    "Tudo pronto.",
    blocks,
    footerLifecycle("pt-BR", unsubscribeUrl),
  );
}

const WELCOME: Record<EmailLocale, Welcome> = {
  "en": welcomeEn,
  "es-PR": welcomeEs,
  "pt-BR": welcomePt,
};

// ─── Password reset ─────────────────────────────────────────────────
//
// Copy carries the two trust signals every reset mail needs: an explicit
// expiry, and a clear "you can ignore this" for the case where the
// recipient did not request it. Both also read as legitimacy to filters.
// The raw link is repeated as text because a meaningful minority of
// clients strip or rewrite buttons.

export interface PasswordResetEmailParams {
  locale: EmailLocale;
  resetLink: string;
  displayName?: string | null;
  /** Firebase action codes are valid for one hour. */
  expiresInHours?: number;
}

type Timed = (link: string, hours: number, first: string | null) => RenderedEmail;

export function passwordResetEmail(params: PasswordResetEmailParams): RenderedEmail {
  return RESET[params.locale](
    params.resetLink,
    params.expiresInHours ?? 1,
    firstNameOf(params.displayName),
  );
}

function resetEn(link: string, hours: number, first: string | null): RenderedEmail {
  const validFor = hours === 1 ? "one hour" : `${hours} hours`;
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["en"](first) },
    {
      kind: "para",
      text: "Someone asked to reset the password for your Ignia account. If that was you, use the button below.",
    },
    { kind: "button", label: "Choose a new password", href: link },
    {
      kind: "linkFallback",
      href: link,
      note: "Button not working? Paste this into your browser:",
    },
    { kind: "divider" },
    {
      kind: "para",
      text: `<strong>This link expires in ${validFor}</strong> and can only be used once.`,
    },
    {
      kind: "para",
      text:
        "<strong>Didn't request this?</strong> You can safely ignore this email — your password stays exactly as it is, and nobody can get in without this link.",
    },
    { kind: "note", text: "Ignia will never email you asking for your password." },
  ];
  return build(
    "en",
    "Reset your Ignia password",
    `A link to set a new password — it expires in ${validFor}.`,
    "Password reset.",
    blocks,
    footerTransactional("en"),
  );
}

function resetEs(link: string, hours: number, first: string | null): RenderedEmail {
  const validFor = hours === 1 ? "una hora" : `${hours} horas`;
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["es-PR"](first) },
    {
      kind: "para",
      text: "Alguien pidió restablecer la contraseña de tu cuenta Ignia. Si fuiste tú, usa el botón de abajo.",
    },
    { kind: "button", label: "Elegir nueva contraseña", href: link },
    {
      kind: "linkFallback",
      href: link,
      note: "¿El botón no funciona? Pega esto en tu navegador:",
    },
    { kind: "divider" },
    {
      kind: "para",
      text: `<strong>Este enlace vence en ${validFor}</strong> y solo se puede usar una vez.`,
    },
    {
      kind: "para",
      text:
        "<strong>¿No pediste esto?</strong> Puedes ignorar este correo sin problema — tu contraseña queda igual, y nadie puede entrar sin este enlace.",
    },
    { kind: "note", text: "Ignia nunca te va a pedir tu contraseña por correo." },
  ];
  return build(
    "es-PR",
    "Restablece tu contraseña de Ignia",
    `Un enlace para poner una contraseña nueva — vence en ${validFor}.`,
    "Restablecer contraseña.",
    blocks,
    footerTransactional("es-PR"),
  );
}

function resetPt(link: string, hours: number, first: string | null): RenderedEmail {
  const validFor = hours === 1 ? "uma hora" : `${hours} horas`;
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["pt-BR"](first) },
    {
      kind: "para",
      text: "Alguém pediu para redefinir a senha da sua conta Ignia. Se foi você, use o botão abaixo.",
    },
    { kind: "button", label: "Escolher uma nova senha", href: link },
    {
      kind: "linkFallback",
      href: link,
      note: "O botão não funcionou? Cole isto no seu navegador:",
    },
    { kind: "divider" },
    {
      kind: "para",
      text: `<strong>Este link expira em ${validFor}</strong> e só pode ser usado uma vez.`,
    },
    {
      kind: "para",
      text:
        "<strong>Não foi você que pediu?</strong> Pode ignorar este e-mail sem problema — a sua senha continua exatamente a mesma, e ninguém entra sem este link.",
    },
    { kind: "note", text: "O Ignia nunca vai pedir a sua senha por e-mail." },
  ];
  return build(
    "pt-BR",
    "Redefina a sua senha do Ignia",
    `Um link para criar uma senha nova — expira em ${validFor}.`,
    "Redefinir senha.",
    blocks,
    footerTransactional("pt-BR"),
  );
}

const RESET: Record<EmailLocale, Timed> = {
  "en": resetEn,
  "es-PR": resetEs,
  "pt-BR": resetPt,
};

// ─── Email verification ─────────────────────────────────────────────
//
// This is the highest-stakes mail Ignia sends: email verification is the
// signup wall, so a message that lands in junk is a user who never reaches
// the product at all. It exists here — rather than being left to Firebase
// Auth's built-in sender — because that sender ships from
// `noreply@<project>.firebaseapp.com`, which cannot be DMARC-aligned with
// ignia.fit, and because this project has email-enumeration protection on,
// which locks Firebase's own template and SMTP settings against any edit.

export interface VerifyEmailParams {
  locale: EmailLocale;
  verifyLink: string;
  displayName?: string | null;
  /** Firebase action codes are valid for one hour. */
  expiresInHours?: number;
}

export function verifyEmailEmail(params: VerifyEmailParams): RenderedEmail {
  return VERIFY[params.locale](
    params.verifyLink,
    params.expiresInHours ?? 1,
    firstNameOf(params.displayName),
  );
}

function verifyEn(link: string, hours: number, first: string | null): RenderedEmail {
  const validFor = hours === 1 ? "one hour" : `${hours} hours`;
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["en"](first) },
    {
      kind: "para",
      text: "Confirm this address and your Ignia account is ready — it's the last step before you can log anything.",
    },
    { kind: "button", label: "Confirm my email", href: link },
    {
      kind: "linkFallback",
      href: link,
      note: "Button not working? Paste this into your browser:",
    },
    { kind: "divider" },
    {
      kind: "para",
      text: `<strong>This link expires in ${validFor}</strong> and can only be used once. You can ask for a new one from the app any time.`,
    },
    {
      kind: "para",
      text: "<strong>Didn't sign up?</strong> Ignore this email and nothing happens — the account stays unverified and unusable.",
    },
    { kind: "note", text: "Ignia will never email you asking for your password." },
  ];
  return build(
    "en",
    "Confirm your email for Ignia",
    `One link to confirm your address — it expires in ${validFor}.`,
    "Confirm your email.",
    blocks,
    footerTransactional("en"),
  );
}

function verifyEs(link: string, hours: number, first: string | null): RenderedEmail {
  const validFor = hours === 1 ? "una hora" : `${hours} horas`;
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["es-PR"](first) },
    {
      kind: "para",
      text: "Confirma esta dirección y tu cuenta de Ignia queda lista — es el último paso antes de poder registrar nada.",
    },
    { kind: "button", label: "Confirmar mi correo", href: link },
    {
      kind: "linkFallback",
      href: link,
      note: "¿El botón no funciona? Pega esto en tu navegador:",
    },
    { kind: "divider" },
    {
      kind: "para",
      text: `<strong>Este enlace vence en ${validFor}</strong> y solo se puede usar una vez. Puedes pedir otro desde la app cuando quieras.`,
    },
    {
      kind: "para",
      text: "<strong>¿No creaste esta cuenta?</strong> Ignora este correo y no pasa nada — la cuenta queda sin verificar y no se puede usar.",
    },
    { kind: "note", text: "Ignia nunca te va a pedir tu contraseña por correo." },
  ];
  return build(
    "es-PR",
    "Confirma tu correo para Ignia",
    `Un enlace para confirmar tu dirección — vence en ${validFor}.`,
    "Confirma tu correo.",
    blocks,
    footerTransactional("es-PR"),
  );
}

function verifyPt(link: string, hours: number, first: string | null): RenderedEmail {
  const validFor = hours === 1 ? "uma hora" : `${hours} horas`;
  const blocks: Block[] = [
    { kind: "lead", text: GREETING["pt-BR"](first) },
    {
      kind: "para",
      text: "Confirme este endereço e a sua conta do Ignia fica pronta — é o último passo antes de você poder registrar qualquer coisa.",
    },
    { kind: "button", label: "Confirmar o meu e-mail", href: link },
    {
      kind: "linkFallback",
      href: link,
      note: "O botão não funcionou? Cole isto no seu navegador:",
    },
    { kind: "divider" },
    {
      kind: "para",
      text: `<strong>Este link expira em ${validFor}</strong> e só pode ser usado uma vez. Você pode pedir outro pelo app quando quiser.`,
    },
    {
      kind: "para",
      text: "<strong>Não foi você que criou esta conta?</strong> Ignore este e-mail e nada acontece — a conta continua sem verificação e não dá para usar.",
    },
    { kind: "note", text: "O Ignia nunca vai pedir a sua senha por e-mail." },
  ];
  return build(
    "pt-BR",
    "Confirme o seu e-mail do Ignia",
    `Um link para confirmar o seu endereço — expira em ${validFor}.`,
    "Confirme o seu e-mail.",
    blocks,
    footerTransactional("pt-BR"),
  );
}

const VERIFY: Record<EmailLocale, Timed> = {
  "en": verifyEn,
  "es-PR": verifyEs,
  "pt-BR": verifyPt,
};

// ─── Weekly digest ──────────────────────────────────────────────────
//
// Retention email — sent to opted-in users. Same metrics as the in-app
// weekly summary card. Skim-friendly: one stat block, big numbers.
//
// ## Two things this template used to get wrong in EVERY language
//
// **It printed `lb` at everyone.** UX_AUDIT F3 shipped kilograms on both
// frontends — body weight is entered and read in the user's unit, with
// pounds kept only as the storage unit — and this mail never learned. A
// metric user saw `−1.4 lb` here and `−0.6 kg` in the app, for the same
// week. Storage stays pounds (see `packages/core/src/body-weight-units.ts`
// for why); the conversion belongs at the display seam, which is this file.
//
// **It formatted numbers as en-US at everyone.** `2100` and `1.4` are
// written `2.100` and `1,4` in Brazil, and the mobile app started honouring
// that on 2026-08-23. An email that disagrees with the app about what a
// number looks like reads as a different product.

/** `packages/core/src/health-mapping.ts`. Mirrored, not imported —
 *  `functions/` is not a workspace. */
const LB_PER_KG = 2.20462;

export interface WeeklyDigestParams {
  locale: EmailLocale;
  displayName?: string | null;
  avgCalories: number | null;
  avgProtein: number | null;
  weightDeltaLbs: number | null;
  /** Distinct days logged inside the 7-day window — never more than 7.
   *  `weekly-digest.ts` guarantees that; this template only renders it. */
  daysLogged: number;
  streak: number;
  /** The user's `unitSystem`, straight off the profile. `undefined` reads as
   *  `'us'`, which is what the profile's own absence means. */
  unitSystem?: "us" | "metric";
  /** Per-recipient one-click opt-out (`unsubscribe.ts`). */
  unsubscribeUrl?: string;
}

interface DigestStrings {
  avgKcal: string;
  avgProtein: string;
  weightDelta: string;
  daysLogged: string;
  streak: string;
  intro: string;
  button: string;
  /** The quoted label MUST be the row a user will actually find in Settings.
   *  Web `settings.reminders.weeklyDigest`, mobile `settings.weeklyDigest` —
   *  both read "weekly recap email", never "weekly digest", which is the
   *  internal name and appeared here for years. */
  optOut: string;
  subject: string;
  preheader: (daysLogged: number) => string;
  heading: string;
}

const DIGEST: Record<EmailLocale, DigestStrings> = {
  "en": {
    avgKcal: "Avg kcal / day",
    avgProtein: "Avg protein / day",
    weightDelta: "Weight change",
    daysLogged: "Days logged",
    streak: "Streak",
    intro: "Here's a snapshot of your last 7 days.",
    button: "Open your log",
    optOut: 'Don\'t want this email? Turn off "Weekly recap email" in Settings.',
    subject: "Your weekly recap · Ignia",
    preheader: (d) => `${d} of 7 days logged this week.`,
    heading: "Your week.",
  },
  "es-PR": {
    avgKcal: "Calorías / día",
    avgProtein: "Proteína / día",
    weightDelta: "Cambio de peso",
    daysLogged: "Días registrados",
    streak: "Racha",
    intro: "Aquí está tu resumen de los últimos 7 días.",
    button: "Abrir tu bitácora",
    optOut: '¿No quieres este correo? Apaga "Resumen semanal por correo" en Ajustes.',
    subject: "Tu resumen semanal · Ignia",
    preheader: (d) => `${d} de 7 días registrados esta semana.`,
    heading: "Tu semana.",
  },
  "pt-BR": {
    avgKcal: "Calorias / dia",
    avgProtein: "Proteína / dia",
    weightDelta: "Variação de peso",
    daysLogged: "Dias registrados",
    streak: "Sequência",
    intro: "Aqui está um retrato dos seus últimos 7 dias.",
    button: "Abrir o seu diário",
    optOut: 'Não quer este e-mail? Desligue "E-mail de resumo semanal" nos Ajustes.',
    subject: "O seu resumo semanal · Ignia",
    preheader: (d) => `${d} de 7 dias registrados nesta semana.`,
    heading: "A sua semana.",
  },
};

export function weeklyDigestEmail(params: WeeklyDigestParams): RenderedEmail {
  const t = DIGEST[params.locale];
  const nf = new Intl.NumberFormat(intlTagFor(params.locale));
  const nf1 = new Intl.NumberFormat(intlTagFor(params.locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const EMPTY = "—";
  const fmt = (n: number | null, suffix: string): string =>
    n == null ? EMPTY : `${nf.format(Math.round(n))}${suffix}`;

  // Sign is rendered by hand rather than by `signDisplay`, because the app
  // uses U+2212 MINUS SIGN and Intl emits U+002D HYPHEN-MINUS. A hyphen is
  // narrower than the plus it sits under in the stat column.
  const fmtDelta = (lbs: number | null): string => {
    if (lbs == null) return EMPTY;
    const metric = params.unitSystem === "metric";
    const value = metric ? lbs / LB_PER_KG : lbs;
    const unit = metric ? "kg" : "lb";
    return `${value >= 0 ? "+" : "−"}${nf1.format(Math.abs(value))} ${unit}`;
  };

  const blocks: Block[] = [
    { kind: "lead", text: GREETING[params.locale](firstNameOf(params.displayName)) },
    { kind: "para", text: t.intro },
    {
      kind: "stats",
      rows: [
        { label: t.avgKcal, value: fmt(params.avgCalories, "") },
        { label: t.avgProtein, value: fmt(params.avgProtein, " g") },
        { label: t.weightDelta, value: fmtDelta(params.weightDeltaLbs) },
        { label: t.daysLogged, value: `${nf.format(params.daysLogged)} / 7` },
        { label: t.streak, value: nf.format(params.streak) },
      ],
    },
    { kind: "button", label: t.button, href: APP_LINK },
    {
      kind: "note",
      // Names the in-app route only; the one-click link lives in the footer,
      // where a reader looks for it and where it does not read as a second
      // ask five lines under the first.
      text: t.optOut,
    },
  ];

  return build(
    params.locale,
    t.subject,
    t.preheader(params.daysLogged),
    t.heading,
    blocks,
    footerLifecycle(params.locale, params.unsubscribeUrl),
  );
}
