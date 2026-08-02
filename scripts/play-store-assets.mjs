/**
 * Generate the Play Console graphics Ignia is missing.
 *
 * Play's constraints differ from Apple's in one way that matters: phone
 * screenshots must be 16:9 or 9:16, and the captures in `store-assets/out/`
 * are 1320x2868 (1:2.17) — taller than 9:16, so Play rejects them outright.
 * Rather than re-crop the artwork (which would cut content), each is fitted
 * onto a 1080x1920 canvas in the brand panel colour, which is exactly 9:16.
 *
 * Outputs to store-assets/play/. Run: node scripts/play-store-assets.mjs
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'store-assets', 'play');

// Brand palette — mirrors targets/widget/index.swift, which mirrors theme.ts.
const PANEL = '#161412';
const ACCENT = '#ff6a3d';
const MUTED = '#a39c91';

const TAGLINE = 'Adaptive macros + workouts';

await fs.mkdir(OUT, { recursive: true });

// ── App icon: 512x512 ────────────────────────────────────────────
await sharp(path.join(ROOT, 'apps/mobile/assets/images/icon.png'))
  .resize(512, 512, { fit: 'cover' })
  .png()
  .toFile(path.join(OUT, 'icon-512.png'));
console.log('icon-512.png');

// ── Feature graphic: 1024x500 ────────────────────────────────────
// Text is drawn as SVG rather than composited from a font file: only two
// short strings are needed and a generic sans stack renders identically
// enough at this size.
const featureSvg = Buffer.from(`
<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PANEL}"/>
      <stop offset="100%" stop-color="#241f1a"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="500" fill="url(#g)"/>
  <circle cx="905" cy="95" r="190" fill="${ACCENT}" opacity="0.10"/>
  <text x="330" y="235" font-family="Segoe UI, Arial, Helvetica, sans-serif"
        font-size="112" font-weight="700" fill="#ffffff">Ignia</text>
  <text x="334" y="300" font-family="Segoe UI, Arial, Helvetica, sans-serif"
        font-size="36" font-weight="400" fill="${MUTED}">${TAGLINE}</text>
  <rect x="334" y="330" width="132" height="6" rx="3" fill="${ACCENT}"/>
</svg>`);

const featureIcon = await sharp(path.join(ROOT, 'apps/mobile/assets/images/icon.png'))
  .resize(210, 210, { fit: 'cover' })
  .png()
  .toBuffer();

await sharp(featureSvg)
  .composite([{ input: featureIcon, left: 90, top: 145 }])
  .png()
  .toFile(path.join(OUT, 'feature-1024x500.png'));
console.log('feature-1024x500.png');

// ── Phone screenshots: 1080x1920 (exactly 9:16) ──────────────────
const srcDir = path.join(ROOT, 'store-assets', 'out', 'en');
const shots = (await fs.readdir(srcDir)).filter((f) => f.endsWith('.png')).sort();

for (const f of shots) {
  const dest = path.join(OUT, `phone-${f}`);
  await sharp(path.join(srcDir, f))
    .resize(1080, 1920, {
      fit: 'contain',
      background: PANEL, // letterbox the sides; never crop the artwork
    })
    .png()
    .toFile(dest);
  const m = await sharp(dest).metadata();
  console.log(`phone-${f} -> ${m.width}x${m.height}`);
}

console.log(`\n${shots.length} screenshots + icon + feature graphic in store-assets/play/`);
