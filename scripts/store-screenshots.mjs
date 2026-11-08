#!/usr/bin/env node
/**
 * Composites App Store screenshots from raw device captures.
 *
 * Apple wants ONE set at 6.9" (1320 × 2868) and downscales the rest, but a
 * bare capture sells nothing — the first two frames are read as a thumbnail
 * strip in search results, where a caption is the only thing legible. This
 * script takes the raw captures off the phone and burns the caption band on
 * top of them at exactly the pixel size App Store Connect accepts, so the
 * whole set is consistent and re-runnable when the copy changes.
 *
 * Usage:
 *   node scripts/store-screenshots.mjs                 # both locales
 *   node scripts/store-screenshots.mjs --locale en     # one locale
 *   node scripts/store-screenshots.mjs --font path/to/Manrope-ExtraBold.ttf
 *
 * Input   store-assets/raw/<locale>/01.png … 05.png   (raw device captures)
 * Output  store-assets/out/<locale>/01.png … 05.png   (1320 × 2868, upload these)
 *
 * The captions below are the shot list from docs/app-store-metadata.md §3 —
 * that file stays the source of truth for the copy; this is its renderer.
 * Change one and change the other.
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── Canvas ────────────────────────────────────────────────────────────
// 6.9" portrait. Apple also accepts 1290 × 2796 for this slot; we normalise
// everything to the larger one so a mixed-device capture set still matches.
const W = 1320;
const H = 2868;

// Palette from apps/mobile/src/theme.ts. `heroPanel` is deliberately shared
// across light and dark there — it is the brand anchor, so the frame reads
// the same whichever theme the captures were taken in.
const BG = '#161412'; // heroPanel
const TEXT = '#f3f1ec'; // heroText
const ACCENT = '#ff6a3d'; // ring — the hero coral

// ─── Layout ────────────────────────────────────────────────────────────
// v2 (2026-11-08): the whole phone is shown, inside a drawn bezel, over an
// ember glow. v1 bled the capture off the bottom edge of a flat canvas. That
// worked for a light-mode capture, but a dark one disappears into the canvas,
// and a phone with no bottom edge reads as a cropped screenshot, not a device.
const CAP_TOP = 150; // accent rule y
const CAP_TEXT_TOP = 214; // caption box top
const CAP_WIDTH = 1180; // wrap width, centred
const CAP_SIZE = 80; // px at 72 dpi
const CAP_LEADING = 4; // extra px between lines (Pango leading, on top of the font's own)
const DEVICE_BOTTOM = 70; // gap under the phone
const BEZEL = 22; // px of frame around the screen
const DEVICE_RADIUS = 118; // outer corner radius; the screen gets this minus the bezel
const DEVICE_TOP = 560;
const FRAME = '#2a2622'; // titanium-ish, warm to match the ink
const FRAME_EDGE = '#4a443d'; // the frame's outer highlight

/** Shot list — order is the pitch (docs/app-store-metadata.md §3).
 *  `*…*` marks the words drawn in the accent colour; the copy itself is §3's. */
const SHOTS = {
  en: [
    'Your target moves\nbecause *your body did*',
    'The only macro tracker\nwith a *real lifting log*',
    'Log a meal in\nabout *five seconds*',
    'See where the week\n*actually went*',
    'Every feature.\n*No subscription. No ads.*',
  ],
  es: [
    'Tu meta cambia\nporque *tu cuerpo cambió*',
    'El único contador de macros\ncon *registro de pesas*',
    'Registra una comida\nen unos *cinco segundos*',
    'Mira a dónde se fue\nla semana *de verdad*',
    'Todas las funciones.\n*Sin suscripción. Sin anuncios.*',
  ],
};

// ─── Args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};
const only = arg('locale');
const locales = only ? [only] : Object.keys(SHOTS);

// Pango resolves `font` by family name; a fontfile is only needed when the
// family is not installed system-wide, which is the normal case on a build
// machine. Without it we fall back to the system sans — legible, but not the
// app's Manrope, so the set will look subtly off-brand.
const fontfile = arg('font') ?? findBundledManrope();
const fontFamily = fontfile ? 'Manrope ExtraBold' : 'sans-serif Bold';
if (!fontfile) {
  console.warn(
    '! No Manrope TTF found — falling back to the system sans.\n' +
      '  Pass --font <path to Manrope-ExtraBold.ttf> for the real brand type.',
  );
}

/** Manrope ships as TTFs inside the Expo font package when mobile deps are installed. */
function findBundledManrope() {
  const candidates = [
    'apps/mobile/node_modules/@expo-google-fonts/manrope/800ExtraBold/Manrope_800ExtraBold.ttf',
    'node_modules/@expo-google-fonts/manrope/800ExtraBold/Manrope_800ExtraBold.ttf',
    'store-assets/fonts/Manrope-ExtraBold.ttf',
  ];
  for (const c of candidates) {
    const p = resolve(root, c);
    if (existsSync(p)) return p;
  }
  return null;
}

const escapeMarkup = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Caption block, rendered by Pango so the line breaks and kerning are real. */
async function caption(text) {
  return sharp({
    text: {
      text: `<span foreground="${TEXT}">${escapeMarkup(text).replace(
        /\*([^*]+)\*/g,
        `<span foreground="${ACCENT}">$1</span>`,
      )}</span>`,
      ...(fontfile ? { fontfile } : {}),
      font: `${fontFamily} ${CAP_SIZE}`,
      rgba: true,
      align: 'center',
      width: CAP_WIDTH,
      spacing: CAP_LEADING,
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
}

/** Rounded-corner mask so the capture reads as a device, not a pasted rectangle. */
async function roundCorners(buf, w, h, r) {
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
  return sharp(buf)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** The canvas: ink, with an ember glow rising behind the phone. It's what keeps
 *  a dark-theme capture from merging into the background. */
function background() {
  return Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="58%" r="62%">
          <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.42"/>
          <stop offset="45%" stop-color="${ACCENT}" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d0b0a"/>
          <stop offset="100%" stop-color="${BG}"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#fade)"/>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
    </svg>`,
  );
}

async function build(locale, file, slot, outDir) {
  const text = SHOTS[locale][slot];
  if (!text) {
    console.warn(`  ${file} — no caption for slot ${slot + 1}, skipped`);
    return false;
  }

  const src = sharp(file);
  const meta = await src.metadata();
  const expected = (W / H).toFixed(3);
  const actual = (meta.width / meta.height).toFixed(3);
  if (actual !== expected) {
    console.warn(`  ${file} — ${meta.width}×${meta.height} is not a 6.9"/6.5" portrait ratio; it will be squeezed.`);
  }

  // Size the phone to fill what the caption leaves, keeping the capture's ratio.
  const devH = H - DEVICE_TOP - DEVICE_BOTTOM;
  const scrH = devH - 2 * BEZEL;
  const scrW = Math.round((scrH * W) / H);
  const devW = scrW + 2 * BEZEL;
  const devLeft = Math.round((W - devW) / 2);
  const scrR = DEVICE_RADIUS - BEZEL;
  const k = scrW / W; // capture px → canvas px

  const scaled = await src.resize({ width: scrW, height: scrH, fit: 'fill' }).png().toBuffer();
  // The Dynamic Island. A simulator capture never includes it, and without it
  // the frame reads as a mock-up. Geometry is the 16 Pro Max's, at 3x.
  const islandW = Math.round(378 * k);
  const islandH = Math.round(111 * k);
  const island = Buffer.from(
    `<svg width="${scrW}" height="${scrH}"><rect x="${Math.round((scrW - islandW) / 2)}" y="${Math.round(33 * k)}" width="${islandW}" height="${islandH}" rx="${islandH / 2}" fill="#000"/></svg>`,
  );
  const screen = await roundCorners(
    await sharp(scaled).composite([{ input: island }]).png().toBuffer(),
    scrW,
    scrH,
    scrR,
  );

  const device = Buffer.from(
    `<svg width="${devW + 120}" height="${devH + 130}" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="30"/></filter></defs>
      <rect x="60" y="90" width="${devW}" height="${devH}" rx="${DEVICE_RADIUS}" fill="#000" opacity="0.55" filter="url(#s)"/>
      <rect x="60" y="60" width="${devW}" height="${devH}" rx="${DEVICE_RADIUS}" fill="${FRAME}"/>
      <rect x="61.5" y="61.5" width="${devW - 3}" height="${devH - 3}" rx="${DEVICE_RADIUS - 1.5}" fill="none" stroke="${FRAME_EDGE}" stroke-width="3"/>
      <rect x="${60 + BEZEL - 3}" y="${60 + BEZEL - 3}" width="${scrW + 6}" height="${scrH + 6}" rx="${scrR + 3}" fill="#000"/>
    </svg>`,
  );
  const rule = Buffer.from(
    `<svg width="96" height="10"><rect width="96" height="10" rx="5" fill="${ACCENT}"/></svg>`,
  );

  const cap = await caption(text);
  const capMeta = await sharp(cap).metadata();

  await sharp(background())
    .composite([
      { input: rule, top: CAP_TOP, left: Math.round((W - 96) / 2) },
      { input: cap, top: CAP_TEXT_TOP, left: Math.round((W - capMeta.width) / 2) },
      { input: device, top: DEVICE_TOP - 60, left: devLeft - 60 },
      { input: screen, top: DEVICE_TOP + BEZEL, left: devLeft + BEZEL },
    ])
    // App Store Connect REJECTS screenshots carrying an alpha channel, and
    // the rounded-corner mask puts one there. The canvas is opaque anyway,
    // so flattening onto it changes no pixel — it only drops the channel.
    .flatten({ background: BG })
    .removeAlpha()
    .png()
    .toFile(join(outDir, `${String(slot + 1).padStart(2, '0')}.png`));

  return true;
}

/**
 * Which caption a capture gets. A leading number in the filename IS the slot
 * (`03-search.png` → shot 3), so a set missing one shot doesn't silently
 * shift every later caption onto the wrong screen — which is exactly what
 * position-based numbering does, and it is invisible until the store listing
 * is live. Unnumbered files fall back to their position in the directory.
 */
function slotFor(filename, position) {
  const m = /^(\d{1,2})/.exec(filename);
  return m ? Number(m[1]) - 1 : position;
}

for (const locale of locales) {
  const inDir = resolve(root, 'store-assets/raw', locale);
  const outDir = resolve(root, 'store-assets/out', locale);

  if (!existsSync(inDir)) {
    console.log(`· ${locale}: no captures at store-assets/raw/${locale}/ — skipped`);
    continue;
  }
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(inDir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();

  if (!files.length) {
    console.log(`· ${locale}: directory is empty — skipped`);
    continue;
  }

  console.log(`· ${locale}: ${files.length} capture(s)`);
  const made = [];
  for (const [i, f] of files.entries()) {
    const slot = slotFor(f, i);
    if (await build(locale, join(inDir, f), slot, outDir)) made.push(slot + 1);
  }
  const missing = SHOTS[locale]
    .map((_, i) => i + 1)
    .filter((n) => !made.includes(n));
  console.log(`  → ${made.length} frame(s) in store-assets/out/${locale}/ (${W}×${H})`);
  if (missing.length) {
    // Say it out loud. An incomplete set uploads perfectly happily and the
    // gap only shows up as a missing frame on the live listing.
    console.warn(`  ! no capture for shot ${missing.join(', ')} — set is incomplete`);
  }
}
