// Ignia transactional email templates. Brand is editorial / "Personal
// Calibration Log" — warm cream paper, dark charcoal ink, oxblood accent,
// Instrument Serif italic + JetBrains Mono. Email clients that strip CSS
// fall back to plain serif on cream, which is still on-brand. Keep templates
// as pure functions returning { subject, html } so they're trivially
// unit-testable and swappable per locale.

const PAPER = "#f2ead7";
const PAPER_DEEP = "#e8dfc8";
const INK = "#1a1612";
const BLOOD = "#6f1a10";
const GRAPHITE = "#6b5b47";
const RULE = "#b8a889";

function layout(heading: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;font-family:Georgia,'Times New Roman',serif;">
          <tr>
            <td bgcolor="${PAPER_DEEP}" style="background-color:${PAPER_DEEP};border:1px solid ${RULE};border-bottom:none;border-radius:6px 6px 0 0;padding:28px 32px 20px;">
              <p style="margin:0 0 8px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${GRAPHITE};">macro log · personal calibration</p>
              <h1 style="margin:0;font-style:italic;font-size:32px;font-weight:400;color:${INK};letter-spacing:-0.01em;line-height:1.05;">${heading}</h1>
            </td>
          </tr>
          <tr>
            <td bgcolor="#fbf6ec" style="background-color:#fbf6ec;border:1px solid ${RULE};border-top:none;border-radius:0 0 6px 6px;padding:28px 32px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:18px 8px 4px;">
              <p style="margin:0 0 4px;color:${GRAPHITE};font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;">private log · no ads · no data selling</p>
              <a href="https://macrolog.web.app" style="color:${BLOOD};font-family:'Courier New',monospace;font-size:11px;text-decoration:none;font-weight:600;">macrolog.web.app</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;color:${INK};font-size:16px;line-height:1.65;">${text}</p>`;
}

function caption(text: string): string {
  return `<p style="margin:0 0 14px;color:${GRAPHITE};font-size:13px;line-height:1.55;font-style:italic;">${text}</p>`;
}

function brandButton(text: string, href: string): string {
  return `<div style="text-align:center;margin:22px 0;">
    <a href="${href}" style="display:inline-block;padding:12px 28px;background:${INK};color:${PAPER};text-decoration:none;border-radius:2px;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;box-shadow:3px 3px 0 0 ${BLOOD};">${text}</a>
  </div>`;
}

function divider(): string {
  return `<hr style="border:none;border-top:1px solid ${RULE};margin:20px 0;" />`;
}

function list(items: string[]): string {
  return `<ul style="margin:0 0 16px;padding:0 0 0 18px;color:${INK};font-size:15px;line-height:1.7;">${items.map((i) => `<li style="margin:0 0 6px;">${i}</li>`).join("")}</ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface WelcomeEmailParams {
  locale: "en" | "es-PR";
  displayName?: string | null;
}

export function welcomeEmail(params: WelcomeEmailParams): { subject: string; html: string } {
  const firstName = (params.displayName ?? "").split(" ")[0] || null;
  if (params.locale === "es-PR") {
    return welcomeEmailEs(firstName);
  }
  return welcomeEmailEn(firstName);
}

function welcomeEmailEn(firstName: string | null): { subject: string; html: string } {
  const subject = "Welcome to Ignia.";
  const heading = "You're in.";
  const salutation = firstName ? `Hi <strong>${escapeHtml(firstName)}</strong>,` : "Hi there,";

  let body = paragraph(salutation);
  body += paragraph(
    "Ignia is a quiet, private calorie and protein log. No ads, no streaks that shame you, no red-and-green scoreboards — just a calm place to record what you eat so the math can help you.",
  );
  body += paragraph("A few things worth knowing your first week:");
  body += list([
    "<strong>Log first, analyse later.</strong> The left column on desktop (top of screen on mobile) is for capturing meals fast. The right column becomes useful after ~14 days of data.",
    "<strong>Your TDEE becomes real after two weeks.</strong> Until then the dashboard uses a Mifflin-St Jeor estimate. Once you have 14 days of real weight + log data, it switches to a measured TDEE tuned to you.",
    "<strong>Four ways to log a meal:</strong> type it, pick a saved preset, scan a barcode, or snap a photo for AI macro estimation.",
    "<strong>Ask the coach.</strong> If you're stuck on a plateau or want to understand your adherence, the AI coach in the right column has your last 14 days of context and three free consultations per day.",
  ]);
  body += divider();
  body += paragraph("The primary question the app is built to answer is: <em>how many calories do I have left today?</em> Everything else is in service of that.");
  body += brandButton("open the ledger", "https://macrolog.web.app/app");
  body += caption("Questions? Reply to this email — it goes straight to a human.");
  body += caption(
    "Privacy: your logs are yours. We don't sell data, we don't run ads, and the AI coach only sees summaries of your data in-flight — never your email or name. Full policy at <a href=\"https://macrolog.web.app/privacy\" style=\"color:" + BLOOD + ";\">macrolog.web.app/privacy</a>.",
  );

  return { subject, html: layout(heading, body) };
}

// ─── Weekly digest ─────────────────────────────────────────────
//
// Lightweight retention email — sent Sundays to opted-in users. Pulls
// the same metrics the in-app weekly summary card already renders:
// average kcal, average protein, weight delta, days logged, current
// streak. Free users get a passive return reason; Pro users an extra
// polish layer. Designed to be skim-friendly (one card, big numbers)
// rather than another newsletter.

export interface WeeklyDigestParams {
  locale: "en" | "es-PR";
  displayName?: string | null;
  avgCalories: number | null;
  avgProtein: number | null;
  weightDeltaLbs: number | null;
  daysLogged: number;
  streak: number;
}

function statRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;color:${GRAPHITE};font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.10em;text-transform:uppercase;">${label}</td>
    <td align="right" style="padding:8px 0;color:${INK};font-family:Georgia,serif;font-size:22px;font-weight:400;">${value}</td>
  </tr>`;
}

export function weeklyDigestEmail(params: WeeklyDigestParams): { subject: string; html: string } {
  const firstName = (params.displayName ?? "").split(" ")[0] || null;
  const isEs = params.locale === "es-PR";
  const subject = isEs ? "Tu resumen semanal · Ignia" : "Your weekly recap · Ignia";
  const heading = isEs ? "Tu semana." : "Your week.";
  const salutation = firstName
    ? (isEs ? `Hola <strong>${escapeHtml(firstName)}</strong>,` : `Hi <strong>${escapeHtml(firstName)}</strong>,`)
    : (isEs ? "Hola," : "Hi there,");

  const intro = isEs
    ? "Aquí está tu resumen de los últimos 7 días."
    : "Here's a snapshot of your last 7 days.";

  const noDataLabel = isEs ? "—" : "—";
  const fmt = (n: number | null, suffix: string): string =>
    n == null ? noDataLabel : `${Math.round(n)}${suffix}`;
  const fmtDelta = (n: number | null): string => {
    if (n == null) return noDataLabel;
    const sign = n >= 0 ? "+" : "−";
    return `${sign}${Math.abs(n).toFixed(1)} ${isEs ? "lb" : "lb"}`;
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

  const cta = isEs ? "abrir la bitácora" : "open the ledger";
  const unsubBlurb = isEs
    ? "¿No quieres este correo? Apaga \"Resumen semanal\" en Ajustes."
    : "Don't want this email? Turn off \"Weekly digest\" in Settings.";

  let body = paragraph(salutation);
  body += paragraph(intro);
  body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;border-top:1px solid ${RULE};border-bottom:1px solid ${RULE};">
    ${statRow(labels.avgKcal, fmt(params.avgCalories, ""))}
    ${statRow(labels.avgProtein, fmt(params.avgProtein, "g"))}
    ${statRow(labels.weightDelta, fmtDelta(params.weightDeltaLbs))}
    ${statRow(labels.daysLogged, `${params.daysLogged} / 7`)}
    ${statRow(labels.streak, `${params.streak}`)}
  </table>`;
  body += brandButton(cta, "https://macrolog.web.app/app");
  body += caption(unsubBlurb);

  return { subject, html: layout(heading, body) };
}

function welcomeEmailEs(firstName: string | null): { subject: string; html: string } {
  const subject = "Bienvenido a Ignia.";
  const heading = "Listo.";
  const salutation = firstName ? `Hola <strong>${escapeHtml(firstName)}</strong>,` : "Hola,";

  let body = paragraph(salutation);
  body += paragraph(
    "Ignia es una bitácora privada y silenciosa de calorías y proteína. Sin anuncios, sin rachas que te avergüencen, sin marcadores rojo-verde — solo un lugar tranquilo para anotar lo que comes, y dejar que las matemáticas te ayuden.",
  );
  body += paragraph("Algunas cosas útiles para tu primera semana:");
  body += list([
    "<strong>Primero registra, después analiza.</strong> La columna izquierda (o la parte de arriba en móvil) es para capturar comidas rápido. La columna derecha empieza a ser útil después de unos 14 días de datos.",
    "<strong>Tu TDEE se vuelve real después de dos semanas.</strong> Mientras tanto usamos una estimación Mifflin-St Jeor. Cuando tengas 14 días de peso + bitácora reales, cambia a un TDEE medido y afinado a ti.",
    "<strong>Cuatro formas de registrar una comida:</strong> escribirla, elegir un preset guardado, escanear un código de barras, o sacar una foto para estimar macros con IA.",
    "<strong>Consulta al coach.</strong> Si te estancas o quieres entender tu adherencia, el coach IA en la columna derecha tiene tu contexto de los últimos 14 días y tres consultas gratis por día.",
  ]);
  body += divider();
  body += paragraph("La pregunta principal que la app está hecha para contestar es: <em>¿cuántas calorías me quedan hoy?</em> Todo lo demás está al servicio de eso.");
  body += brandButton("abrir la bitácora", "https://macrolog.web.app/app");
  body += caption("¿Preguntas? Responde a este correo — llega directo a una persona.");
  body += caption(
    "Privacidad: tu bitácora es tuya. No vendemos datos, no mostramos anuncios, y el coach IA solo ve resúmenes de tus datos en tránsito — nunca tu correo o nombre. Política completa en <a href=\"https://macrolog.web.app/privacy\" style=\"color:" + BLOOD + ";\">macrolog.web.app/privacy</a>.",
  );

  return { subject, html: layout(heading, body) };
}
