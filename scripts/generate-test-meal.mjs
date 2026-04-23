/**
 * Generates a plausible "meal photo" from a composed SVG for the PH
 * photo-capture gallery shot. Not meant to be convincing food photo —
 * just non-empty so Gemini returns *some* structured result we can
 * screenshot.
 *
 * Output: scripts/test-meal.jpg
 */
import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const W = 1024;
const H = 1024;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#d8ccb0"/>
  <circle cx="512" cy="512" r="380" fill="#f4ecd8" stroke="#a08060" stroke-width="4"/>
  <ellipse cx="400" cy="440" rx="140" ry="90" fill="#c47a3a"/>
  <ellipse cx="620" cy="420" rx="120" ry="80" fill="#8a5a2a"/>
  <g fill="#5a7a3a">
    <ellipse cx="500" cy="600" rx="40" ry="30"/>
    <ellipse cx="560" cy="620" rx="35" ry="28"/>
    <ellipse cx="460" cy="640" rx="30" ry="25"/>
  </g>
  <g fill="#f0e0b0" opacity="0.85">
    <ellipse cx="680" cy="560" rx="90" ry="60"/>
    <ellipse cx="700" cy="540" rx="30" ry="20"/>
  </g>
</svg>`;

const out = resolve(__dirname, 'test-meal.jpg');
await sharp(Buffer.from(svg))
  .jpeg({ quality: 85 })
  .toFile(out);

console.log(`Generated ${out}`);
