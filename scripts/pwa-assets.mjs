/**
 * One-shot generator for PWA "feels native" assets:
 *  - maskable icons (Android adaptive, content inside the 80% safe zone)
 *  - a real 180×180 apple-touch icon (iPhone home screen, no scaling blur)
 *  - iOS launch (splash) screens per device, paper background + centered logo
 *
 * Source of truth is public/icon-source.svg. Re-run after editing the mark:
 *   node scripts/pwa-assets.mjs
 * Prints the <link rel="apple-touch-startup-image"> tags to paste into
 * src/index.html.
 */
import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const PAPER = '#f2ead7'; // canonical light paper (app.ts chromeColor.light)
const SRC = 'public/icon-source.svg';

// Logo without the baked background rect, so it composites seamlessly onto
// any paper canvas (splash + maskable) with no visible square seam.
const transparentLogo = readFileSync(SRC, 'utf8').replace(
  /\s*<rect[^>]*\/>/,
  '',
);

mkdirSync('public/splash', { recursive: true });

/** Render the transparent logo to a PNG buffer at `size`px (square). */
async function logoBuffer(size) {
  return sharp(Buffer.from(transparentLogo), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Paper canvas with the logo centered at `logoFrac` of the short side. */
async function compose(width, height, logoFrac, out) {
  const logoSize = Math.round(Math.min(width, height) * logoFrac);
  const logo = await logoBuffer(logoSize);
  await sharp({
    create: { width, height, channels: 4, background: PAPER },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(out);
}

// ── Maskable icons: logo at 64% so the mark stays inside the 80% safe zone.
await compose(512, 512, 0.64, 'public/icons/icon-maskable-512x512.png');
await compose(192, 192, 0.64, 'public/icons/icon-maskable-192x192.png');

// ── Real 180×180 apple-touch icon (full-bleed, with paper background).
await compose(180, 180, 0.7, 'public/icons/icon-180x180.png');

// ── iOS splash screens (portrait). Logo at 32% of the short side.
const DEVICES = [
  // [pxW, pxH, dpr, cssW, cssH]
  [1290, 2796, 3, 430, 932], [1179, 2556, 3, 393, 852],
  [1284, 2778, 3, 428, 926], [1170, 2532, 3, 390, 844],
  [1125, 2436, 3, 375, 812], [1242, 2688, 3, 414, 896],
  [828, 1792, 2, 414, 896],  [1242, 2208, 3, 414, 736],
  [750, 1334, 2, 375, 667],  [640, 1136, 2, 320, 568],
  [1536, 2048, 2, 768, 1024], [1488, 2266, 2, 744, 1133],
  [1668, 2224, 2, 834, 1112], [1668, 2388, 2, 834, 1194],
  [2048, 2732, 2, 1024, 1366],
];

const links = [];
for (const [w, h, dpr, cssW, cssH] of DEVICES) {
  const file = `public/splash/apple-splash-${w}-${h}.png`;
  await compose(w, h, 0.32, file);
  links.push(
    `    <link rel="apple-touch-startup-image" ` +
      `media="(device-width: ${cssW}px) and (device-height: ${cssH}px) and ` +
      `(-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" ` +
      `href="splash/apple-splash-${w}-${h}.png" />`,
  );
}

writeFileSync('scripts/.splash-links.html', links.join('\n') + '\n');
console.log(`Generated ${DEVICES.length} splash screens + maskable + 180 icons.`);
console.log('Splash <link> tags written to scripts/.splash-links.html');
