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
const LINE = '#2b2822'; // heroTrack, used as the device hairline

// ─── Layout ────────────────────────────────────────────────────────────
// The screenshot bleeds toward the bottom edge so the device art is as large
// as it can be while the caption still owns the top third — that top third is
// all a search-results thumbnail actually shows.
const CAP_TOP = 190; // accent rule y
const CAP_TEXT_TOP = 268; // first caption baseline box
const CAP_WIDTH = 1080; // wrap width, centred
const CAP_SIZE = 68; // px at 72 dpi
const CAP_LEADING = 6; // extra px between lines (Pango leading, on top of the font's own)
const SHOT_TOP = 620;
const SHOT_WIDTH = 1030;
const SHOT_RADIUS = 58;

/** Shot list — order is the pitch (docs/app-store-metadata.md §3). */
const SHOTS = {
  en: [
    'Your target moves\nbecause your body did',
    'The only macro tracker\nwith a real lifting log',
    'Log a meal in\nabout five seconds',
    'See where the week\nactually went',
    'Every feature.\nNo subscription. No ads.',
  ],
  es: [
    'Tu meta cambia\nporque tu cuerpo cambió',
    'El único contador de macros\ncon registro de pesas',
    'Registra una comida\nen unos cinco segundos',
    'Mira a dónde se fue\nla semana de verdad',
    'Todas las funciones.\nSin suscripción. Sin anuncios.',
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
      text: `<span foreground="${TEXT}">${escapeMarkup(text)}</span>`,
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
async function roundCorners(buf, w, h) {
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${SHOT_RADIUS}" ry="${SHOT_RADIUS}" fill="#fff"/></svg>`,
  );
  return sharp(buf)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
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
    console.warn(
      `  ${file} — ${meta.width}×${meta.height} is not a 6.9"/6.5" portrait ratio; ` +
        'scaling to width and cropping the bottom.',
    );
  }

  const shotH = Math.round((SHOT_WIDTH * meta.height) / meta.width);
  const scaled = await src.resize({ width: SHOT_WIDTH }).png().toBuffer();
  const rounded = await roundCorners(scaled, SHOT_WIDTH, shotH);

  // A hairline the same colour as the app's own dividers keeps the capture
  // from floating: near-black art on a near-black canvas otherwise has no edge.
  const border = Buffer.from(
    `<svg width="${SHOT_WIDTH}" height="${shotH}"><rect x="1" y="1" width="${SHOT_WIDTH - 2}" height="${shotH - 2}" rx="${SHOT_RADIUS}" ry="${SHOT_RADIUS}" fill="none" stroke="${LINE}" stroke-width="2"/></svg>`,
  );
  const rule = Buffer.from(
    `<svg width="96" height="10"><rect width="96" height="10" rx="5" fill="${ACCENT}"/></svg>`,
  );

  const cap = await caption(text);
  const capMeta = await sharp(cap).metadata();

  await sharp({
    create: { width: W, height: H, channels: 4, background: BG },
  })
    .composite([
      { input: rule, top: CAP_TOP, left: Math.round((W - 96) / 2) },
      { input: cap, top: CAP_TEXT_TOP, left: Math.round((W - capMeta.width) / 2) },
      { input: rounded, top: SHOT_TOP, left: Math.round((W - SHOT_WIDTH) / 2) },
      { input: border, top: SHOT_TOP, left: Math.round((W - SHOT_WIDTH) / 2) },
    ])
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
