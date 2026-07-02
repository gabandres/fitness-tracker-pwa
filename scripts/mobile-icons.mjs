/**
 * Regenerate the Expo app icons from public/icon-source.svg so the mobile app
 * matches the web mark. Outputs into apps/mobile/assets/images/.
 *   - icon.png                    full square (paper bg) 1024
 *   - splash-icon.png             logo-only, transparent 1024
 *   - favicon.png                 48
 *   - android-icon-foreground.png logo-only, transparent, safe-zone padded 1024
 *   - android-icon-background.png solid paper 1024
 *   - android-icon-monochrome.png single-colour logo silhouette 1024
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const OUT = resolve(root, 'apps/mobile/assets/images');
const PAPER = '#f4f0e8';

const full = readFileSync(resolve(root, 'public/icon-source.svg'), 'utf8');
// Logo-only: drop the background <rect> so it composites on any surface.
const logo = Buffer.from(full.replace(/\s*<rect[^>]*\/>/, ''));
// Monochrome: every stroke/fill in one ink colour (Android tints it).
const mono = Buffer.from(
  full
    .replace(/\s*<rect[^>]*\/>/, '')
    .replace(/stroke="#[0-9a-fA-F]{6}"/g, 'stroke="#1a1816"')
    .replace(/fill="#[0-9a-fA-F]{6}"/g, 'fill="#1a1816"')
    .replace(/opacity="[^"]*"/g, 'opacity="1"'),
);

const png = (buf, size, density = 512) =>
  sharp(buf, { density }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png();

// Logo padded into the adaptive safe zone (~66%): render at 66% on a transparent 1024 canvas.
async function padded(buf, out) {
  const inner = await png(buf, Math.round(1024 * 0.66)).toBuffer();
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, gravity: 'centre' }])
    .png()
    .toFile(resolve(OUT, out));
  console.log('  ' + out);
}

console.log('Generating Expo icons from public/icon-source.svg');
await sharp(readFileSync(resolve(root, 'public/icon-source.svg')), { density: 512 }).resize(1024, 1024).png().toFile(resolve(OUT, 'icon.png'));
console.log('  icon.png');
await png(logo, 1024).toFile(resolve(OUT, 'splash-icon.png'));
console.log('  splash-icon.png');
await png(logo, 48).toFile(resolve(OUT, 'favicon.png'));
console.log('  favicon.png');
await padded(logo, 'android-icon-foreground.png');
await padded(mono, 'android-icon-monochrome.png');
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: PAPER } }).png().toFile(resolve(OUT, 'android-icon-background.png'));
console.log('  android-icon-background.png');
console.log('Done.');
