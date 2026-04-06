/**
 * One-off icon generator. Reads public/icon-source.svg and rasterizes
 * it to every PNG size referenced by manifest.webmanifest, plus a
 * 32x32 favicon.
 *
 * Usage:  node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svg = readFileSync(resolve(root, 'public/icon-source.svg'));

const pwaSizes = [72, 96, 128, 144, 152, 192, 384, 512];

console.log('Generating PWA icons from public/icon-source.svg');

for (const size of pwaSizes) {
  const out = resolve(root, `public/icons/icon-${size}x${size}.png`);
  await sharp(svg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`  icon-${size}x${size}.png`);
}

// Favicon (32x32 PNG — modern browsers accept PNG at /favicon)
const favOut = resolve(root, 'public/favicon.png');
await sharp(svg)
  .resize(32, 32)
  .png({ compressionLevel: 9 })
  .toFile(favOut);
console.log('  favicon.png');

console.log('Done.');
