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
}

function layout(p: LayoutParams): string {
  const footerHtml = p.footer
    .map(
      (line) =>
        `<p class="i-muted" style="margin:0 0 6px;color:${LIGHT.muted};font-family:${SANS};font-size:12px;line-height:1.5;">${line}</p>`,
    )
    .join("");

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
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
  subject: string,
  preheader: string,
  heading: string,
  blocks: Block[],
  footer: string[],
): RenderedEmail {
  return {
    subject,
    html: layout({ preheader, heading, blocks, footer }),
    text: renderText(heading, blocks, footer),
  };
}

// ─── Shared footers ─────────────────────────────────────────────────
//
// Transactional mail (password reset) deliberately carries NO unsubscribe
// invitation — you cannot opt out of account-security mail, and offering it
// confuses the consent model. Lifecycle mail (welcome, digest) does.

function footerLifecycle(isEs: boolean): string[] {
  return isEs
    ? [
      "Recibiste este correo porque creaste una cuenta en Ignia.",
      `Bitácora privada · sin anuncios · nunca vendemos tus datos · <a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Política de privacidad</a>`,
    ]
    : [
      "You're receiving this because you created an Ignia account.",
      `Private log · no ads · we never sell your data · <a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Privacy policy</a>`,
    ];
}

function footerTransactional(isEs: boolean): string[] {
  return isEs
    ? [
      "Este es un correo automático de seguridad de tu cuenta Ignia. No puedes darte de baja de estos mensajes.",
      `<a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Política de privacidad</a>`,
    ]
    : [
      "This is an automated security message about your Ignia account. You can't unsubscribe from these.",
      `<a href="${SITE}/privacy" style="color:${LIGHT.accent};" class="i-accent">Privacy policy</a>`,
    ];
}

function firstNameOf(displayName?: string | null): string | null {
  return (displayName ?? "").trim().split(/\s+/)[0] || null;
}

// ─── Welcome ────────────────────────────────────────────────────────

export interface WelcomeEmailParams {
  locale: "en" | "es-PR";
  displayName?: string | null;
}

export function welcomeEmail(params: WelcomeEmailParams): RenderedEmail {
  const first = firstNameOf(params.displayName);
  return params.locale === "es-PR" ? welcomeEs(first) : welcomeEn(first);
}

function welcomeEn(first: string | null): RenderedEmail {
  const hi = first ? `Hi <strong>${escapeHtml(first)}</strong>,` : "Hi there,";
  const blocks: Block[] = [
    { kind: "lead", text: hi },
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
        "<strong>Three ways to log a meal:</strong> type it in plain language, pick a saved preset, or scan a barcode.",
      ],
    },
    { kind: "divider" },
    {
      kind: "para",
      text:
        "The one question this app exists to answer is: <em>how many calories do I have left today?</em> Everything else is in service of that.",
    },
    { kind: "button", label: "Open your log", href: `${SITE}/app` },
    { kind: "note", text: "Questions? Just reply — it reaches a human." },
  ];
  return build(
    "Welcome to Ignia",
    "Your private calorie and protein log is ready — here's how to get the most out of week one.",
    "You're in.",
    blocks,
    footerLifecycle(false),
  );
}

function welcomeEs(first: string | null): RenderedEmail {
  const hi = first ? `Hola <strong>${escapeHtml(first)}</strong>,` : "Hola,";
  const blocks: Block[] = [
    { kind: "lead", text: hi },
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
        "<strong>Tres formas de registrar una comida:</strong> escríbela en lenguaje natural, elige un preset guardado, o escanea un código de barras.",
      ],
    },
    { kind: "divider" },
    {
      kind: "para",
      text:
        "La única pregunta que esta app existe para contestar es: <em>¿cuántas calorías me quedan hoy?</em> Todo lo demás está al servicio de eso.",
    },
    { kind: "button", label: "Abrir tu bitácora", href: `${SITE}/app` },
    { kind: "note", text: "¿Preguntas? Responde a este correo — llega a una persona." },
  ];
  return build(
    "Bienvenido a Ignia",
    "Tu bitácora privada de calorías y proteína está lista — así aprovechas la primera semana.",
    "Listo.",
    blocks,
    footerLifecycle(true),
  );
}

// ─── Password reset ─────────────────────────────────────────────────
//
// Copy carries the two trust signals every reset mail needs: an explicit
// expiry, and a clear "you can ignore this" for the case where the
// recipient did not request it. Both also read as legitimacy to filters.
// The raw link is repeated as text because a meaningful minority of
// clients strip or rewrite buttons.

export interface PasswordResetEmailParams {
  locale: "en" | "es-PR";
  resetLink: string;
  displayName?: string | null;
  /** Firebase action codes are valid for one hour. */
  expiresInHours?: number;
}

export function passwordResetEmail(params: PasswordResetEmailParams): RenderedEmail {
  const hours = params.expiresInHours ?? 1;
  const first = firstNameOf(params.displayName);
  return params.locale === "es-PR"
    ? resetEs(params.resetLink, hours, first)
    : resetEn(params.resetLink, hours, first);
}

function resetEn(link: string, hours: number, first: string | null): RenderedEmail {
  const hi = first ? `Hi <strong>${escapeHtml(first)}</strong>,` : "Hi there,";
  const validFor = hours === 1 ? "one hour" : `${hours} hours`;
  const blocks: Block[] = [
    { kind: "lead", text: hi },
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
    "Reset your Ignia password",
    `A link to set a new password — it expires in ${validFor}.`,
    "Password reset.",
    blocks,
    footerTransactional(false),
  );
}

function resetEs(link: string, hours: number, first: string | null): RenderedEmail {
  const hi = first ? `Hola <strong>${escapeHtml(first)}</strong>,` : "Hola,";
  const validFor = hours === 1 ? "una hora" : `${hours} horas`;
  const blocks: Block[] = [
    { kind: "lead", text: hi },
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
    "Restablece tu contraseña de Ignia",
    `Un enlace para poner una contraseña nueva — vence en ${validFor}.`,
    "Restablecer contraseña.",
    blocks,
    footerTransactional(true),
  );
}

// ─── Weekly digest ──────────────────────────────────────────────────
//
// Retention email — sent to opted-in users. Same metrics as the in-app
// weekly summary card. Skim-friendly: one stat block, big numbers.

export interface WeeklyDigestParams {
  locale: "en" | "es-PR";
  displayName?: string | null;
  avgCalories: number | null;
  avgProtein: number | null;
  weightDeltaLbs: number | null;
  daysLogged: number;
  streak: number;
}

export function weeklyDigestEmail(params: WeeklyDigestParams): RenderedEmail {
  const isEs = params.locale === "es-PR";
  const first = firstNameOf(params.displayName);
  const hi = first
    ? `${isEs ? "Hola" : "Hi"} <strong>${escapeHtml(first)}</strong>,`
    : isEs
      ? "Hola,"
      : "Hi there,";

  const EMPTY = "—";
  const fmt = (n: number | null, suffix: string): string =>
    n == null ? EMPTY : `${Math.round(n)}${suffix}`;
  const fmtDelta = (n: number | null): string => {
    if (n == null) return EMPTY;
    return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)} lb`;
  };

  const labels = isEs
    ? {
      avgKcal: "Calorías / día",
      avgProtein: "Proteína / día",
      weightDelta: "Cambio de peso",
      daysLogged: "Días registrados",
      streak: "Racha",
    }
    : {
      avgKcal: "Avg kcal / day",
      avgProtein: "Avg protein / day",
      weightDelta: "Weight change",
      daysLogged: "Days logged",
      streak: "Streak",
    };

  const blocks: Block[] = [
    { kind: "lead", text: hi },
    {
      kind: "para",
      text: isEs
        ? "Aquí está tu resumen de los últimos 7 días."
        : "Here's a snapshot of your last 7 days.",
    },
    {
      kind: "stats",
      rows: [
        { label: labels.avgKcal, value: fmt(params.avgCalories, "") },
        { label: labels.avgProtein, value: fmt(params.avgProtein, "g") },
        { label: labels.weightDelta, value: fmtDelta(params.weightDeltaLbs) },
        { label: labels.daysLogged, value: `${params.daysLogged} / 7` },
        { label: labels.streak, value: `${params.streak}` },
      ],
    },
    {
      kind: "button",
      label: isEs ? "Abrir tu bitácora" : "Open your log",
      href: `${SITE}/app`,
    },
    {
      kind: "note",
      text: isEs
        ? '¿No quieres este correo? Apaga "Resumen semanal" en Ajustes.'
        : 'Don\'t want this email? Turn off "Weekly digest" in Settings.',
    },
  ];

  return build(
    isEs ? "Tu resumen semanal · Ignia" : "Your weekly recap · Ignia",
    isEs
      ? `${params.daysLogged} de 7 días registrados esta semana.`
      : `${params.daysLogged} of 7 days logged this week.`,
    isEs ? "Tu semana." : "Your week.",
    blocks,
    footerLifecycle(isEs),
  );
}
