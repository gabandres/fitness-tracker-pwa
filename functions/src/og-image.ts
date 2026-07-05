import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Resvg } from "@resvg/resvg-js";

// ─── Open Graph image renderer for `/u/<slug>` ─────────────────
//
// Twitter / Facebook / Discord scrapers don't run JS, so the public
// profile's stats can't reach them via the SPA. This endpoint renders
// a 1200×630 PNG with the user's start → current → goal weights so
// shared links show real numbers in the embed card. Cache-Control = 1h
// so the same scraper hit doesn't re-render forever; CDN respects it.
//
// Render path: build SVG string from the publicProfiles mirror →
// resvg-js → PNG buffer → response. Pure Node, no headless browser.

const PAPER = "#f2ead7";
const INK = "#1a1612";
const BLOOD = "#6f1a10";
const SAGE = "#5b6e3f";
const RULE = "#b8a889";
const GRAPHITE = "#6b5b47";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtWeight(w: number | null | undefined): string {
  if (w == null) return "—";
  return w.toFixed(1);
}

function renderSvg(p: {
  displayName: string;
  startWeight: number | null;
  currentWeight: number | null;
  goalWeight: number | null;
  totalChange: number | null;
  startedAt: Timestamp | null;
}): string {
  const headline = (() => {
    if (p.totalChange != null && p.totalChange < 0) {
      return `${escapeXml(p.displayName)} lost ${Math.abs(p.totalChange).toFixed(1)} lb`;
    }
    if (p.totalChange != null && p.totalChange > 0) {
      return `${escapeXml(p.displayName)} gained ${Math.abs(p.totalChange).toFixed(1)} lb`;
    }
    return `${escapeXml(p.displayName)}'s progress`;
  })();
  const subtitle = p.startedAt
    ? `Tracking since ${p.startedAt.toDate().toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
    : "Tracked with Ignia";

  // Stat boxes: 3 columns, big serif numbers, small mono labels.
  const stat = (x: number, label: string, value: string, color = INK) => `
    <text x="${x}" y="380" font-family="Courier New, monospace" font-size="20" fill="${GRAPHITE}" text-anchor="middle" letter-spacing="2">${label}</text>
    <text x="${x}" y="460" font-family="Georgia, serif" font-size="84" fill="${color}" text-anchor="middle" font-style="italic" font-weight="400">${value}</text>
    <text x="${x}" y="500" font-family="Courier New, monospace" font-size="18" fill="${GRAPHITE}" text-anchor="middle">lb</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${PAPER}" />
  <rect x="40" y="40" width="1120" height="550" fill="none" stroke="${RULE}" stroke-width="1" />
  <text x="80" y="110" font-family="Courier New, monospace" font-size="20" fill="${GRAPHITE}" letter-spacing="3">MACRO LOG · PERSONAL CALIBRATION</text>
  <text x="80" y="220" font-family="Georgia, serif" font-size="64" fill="${INK}" font-style="italic" font-weight="400">${headline}</text>
  <text x="80" y="270" font-family="Georgia, serif" font-size="26" fill="${GRAPHITE}" font-style="italic">${escapeXml(subtitle)}</text>
  <line x1="80" y1="310" x2="1120" y2="310" stroke="${RULE}" stroke-width="1" />
  ${stat(280, "START", fmtWeight(p.startWeight))}
  ${stat(600, "CURRENT", fmtWeight(p.currentWeight), BLOOD)}
  ${stat(920, "GOAL", fmtWeight(p.goalWeight), SAGE)}
  <text x="600" y="570" font-family="Courier New, monospace" font-size="18" fill="${GRAPHITE}" text-anchor="middle" letter-spacing="2">ignia.fit</text>
</svg>`;
}

// ─── HTML intercept for `/u/<slug>` ────────────────────────────
//
// SPA scrapers (Twitter, Discord, Facebook, LinkedIn) don't run JS, so
// they read whatever `<meta>` is in the static `index.html`. To get
// per-profile OG cards we have to inject the slug-specific tags
// server-side. This intercept fetches the built index.html from
// hosting (cached in CF memory after the first hit), injects
// per-slug `<title>`, `og:title`, `og:description`, `og:image`, and
// returns it. The SPA still bootstraps after this — humans get the
// same page they always did, just with richer scraper metadata.

let cachedIndexHtml: { html: string; fetchedAt: number } | null = null;
const INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadIndexHtml(): Promise<string> {
  const now = Date.now();
  if (cachedIndexHtml && now - cachedIndexHtml.fetchedAt < INDEX_CACHE_TTL_MS) {
    return cachedIndexHtml.html;
  }
  // Fetch the canonical index.html. The `/u/**` rewrite shadows this
  // function only — `/index.html` still serves the static asset, no
  // recursion.
  const resp = await fetch("https://ignia.fit/index.html");
  const html = await resp.text();
  cachedIndexHtml = { html, fetchedAt: now };
  return html;
}

function injectMeta(html: string, params: {
  title: string;
  description: string;
  ogImage: string;
  canonical: string;
}): string {
  const tags = [
    `<title>${escapeXml(params.title)}</title>`,
    `<meta name="description" content="${escapeXml(params.description)}" />`,
    `<link rel="canonical" href="${escapeXml(params.canonical)}" />`,
    `<meta property="og:type" content="profile" />`,
    `<meta property="og:title" content="${escapeXml(params.title)}" />`,
    `<meta property="og:description" content="${escapeXml(params.description)}" />`,
    `<meta property="og:image" content="${escapeXml(params.ogImage)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:url" content="${escapeXml(params.canonical)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeXml(params.title)}" />`,
    `<meta name="twitter:description" content="${escapeXml(params.description)}" />`,
    `<meta name="twitter:image" content="${escapeXml(params.ogImage)}" />`,
  ].join("\n    ");
  // Strip the static <title> from the source so we don't end up with two.
  const stripped = html
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/<meta\s+name="description"[^>]*>/i, "")
    .replace(/<link\s+rel="canonical"[^>]*>/i, "");
  return stripped.replace("</head>", `    ${tags}\n  </head>`);
}

export const servePublicProfilePage = onRequest(
  { cors: true, maxInstances: 5 },
  async (req, res) => {
    const m = /^\/u\/([a-z0-9-]{3,30})\/?$/i.exec(req.path);
    if (!m) {
      res.status(404).send("not found");
      return;
    }
    const slug = m[1].toLowerCase();
    const db = getFirestore();
    const snap = await db.doc(`publicProfiles/${slug}`).get();
    const html = await loadIndexHtml();

    if (!snap.exists) {
      // Pass through unaltered — the SPA renders its own "not found"
      // state when /u/<slug> doesn't resolve.
      res.set("Content-Type", "text/html; charset=utf-8");
      res.set("Cache-Control", "public, max-age=60");
      res.status(200).send(html);
      return;
    }

    const data = snap.data() ?? {};
    const displayName = (data["displayName"] as string | undefined) || "Ignia user";
    const totalChange = (data["totalChange"] as number | null | undefined) ?? null;
    const title = totalChange != null && totalChange < 0
      ? `${displayName} lost ${Math.abs(totalChange).toFixed(1)} lb · Ignia`
      : totalChange != null && totalChange > 0
        ? `${displayName} gained ${Math.abs(totalChange).toFixed(1)} lb · Ignia`
        : `${displayName}'s progress · Ignia`;
    const description = "Tracked with Ignia — a quiet, private calorie and protein log. Free TDEE calculator and weight tracking.";
    const canonical = `https://ignia.fit/u/${slug}`;
    const ogImage = `https://ignia.fit/og/u/${slug}.png`;

    const enriched = injectMeta(html, { title, description, ogImage, canonical });
    res.set("Content-Type", "text/html; charset=utf-8");
    // Short CDN cache so an updated weight propagates quickly to scrapers.
    res.set("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).send(enriched);
  },
);

export const ogImagePublicProfile = onRequest(
  { cors: true, maxInstances: 5 },
  async (req, res) => {
    // Path: /og/u/<slug>.png — extract via the URL since hosting rewrites
    // forward the original path.
    const m = /\/og\/u\/([a-z0-9-]{3,30})(?:\.png)?\/?$/i.exec(req.path);
    if (!m) {
      res.status(400).send("bad request");
      return;
    }
    const slug = m[1].toLowerCase();
    const db = getFirestore();
    const snap = await db.doc(`publicProfiles/${slug}`).get();
    if (!snap.exists) {
      res.status(404).send("not found");
      return;
    }
    const data = snap.data() ?? {};
    const svg = renderSvg({
      displayName: (data["displayName"] as string | undefined) ?? "Ignia user",
      startWeight: (data["startWeight"] as number | null | undefined) ?? null,
      currentWeight: (data["currentWeight"] as number | null | undefined) ?? null,
      goalWeight: (data["goalWeight"] as number | null | undefined) ?? null,
      totalChange: (data["totalChange"] as number | null | undefined) ?? null,
      startedAt: (data["startedAt"] as Timestamp | undefined) ?? null,
    });

    try {
      const png = new Resvg(svg, {
        fitTo: { mode: "width", value: 1200 },
        font: { loadSystemFonts: true },
      }).render().asPng();
      res.set("Content-Type", "image/png");
      // 1h CDN cache, 1d browser; scrapers re-fetch infrequently anyway.
      res.set("Cache-Control", "public, max-age=86400, s-maxage=3600");
      res.status(200).send(png);
    } catch (err) {
      console.error(`ogImagePublicProfile: render failed slug=${slug}`, err);
      res.status(500).send("render error");
    }
  },
);
