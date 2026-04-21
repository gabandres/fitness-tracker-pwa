/**
 * One-off OG image generator. Produces public/og-image.png (1200×630).
 * Social cards (Slack, Twitter, iMessage, WhatsApp, Facebook, LinkedIn)
 * fetch this when the URL is shared. Without it, previews fall back to
 * the first image on the page — unreliable and unbranded.
 *
 * Usage:  node scripts/generate-og-image.mjs
 *
 * The SVG is composed inline so the generator has no external asset
 * dependency beyond public/icon-source.svg.
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const iconSvg = readFileSync(resolve(root, 'public/icon-source.svg'), 'utf8');

// Extract the inner <svg> contents of the icon source so we can embed it
// at a specific offset inside the OG canvas. Strip the outer <svg> tag.
const iconInner = iconSvg
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

const W = 1200;
const H = 630;

const bg = '#f4f0e8';        // --color-paper
const ink = '#1a1816';       // --color-ink
const blood = '#6e121a';     // --color-blood
const rule = '#c8b8a0';      // --color-rule

const og = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      .serif { font-family: 'Instrument Serif', 'Times New Roman', serif; font-style: italic; }
      .sans  { font-family: 'DM Sans', system-ui, sans-serif; }
      .mono  { font-family: 'JetBrains Mono', ui-monospace, 'Menlo', monospace; }
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="${bg}"/>

  <!-- crop marks -->
  <g stroke="${ink}" stroke-width="2" fill="none">
    <path d="M 40 20 L 40 50 M 20 40 L 50 40"/>
    <path d="M ${W - 40} 20 L ${W - 40} 50 M ${W - 20} 40 L ${W - 50} 40"/>
    <path d="M 40 ${H - 20} L 40 ${H - 50} M 20 ${H - 40} L 50 ${H - 40}"/>
    <path d="M ${W - 40} ${H - 20} L ${W - 40} ${H - 50} M ${W - 20} ${H - 40} L ${W - 50} ${H - 40}"/>
  </g>

  <!-- Stamp + monogram row -->
  <g transform="translate(90, 110)">
    <rect x="0" y="0" width="130" height="34" fill="none" stroke="${blood}" stroke-width="1.5" rx="2"/>
    <text x="65" y="23" class="sans" font-size="13" font-weight="600" letter-spacing="3" text-anchor="middle" fill="${blood}">CALIBRATION</text>
    <text x="160" y="23" class="serif" font-size="22" fill="${ink}">Macro Log · no. 001</text>
  </g>

  <!-- Hero -->
  <g transform="translate(90, 230)">
    <text class="serif" font-size="86" fill="${ink}">how many calories</text>
    <text y="100" class="serif" font-size="86" fill="${blood}">do I have left today?</text>
  </g>

  <!-- Subhead -->
  <text x="90" y="470" class="sans" font-size="24" fill="${ink}">
    a quiet, private calorie + protein log with AI coaching.
  </text>
  <text x="90" y="506" class="sans" font-size="24" fill="${ink}">
    measured TDEE from your own data. no ads. no data selling.
  </text>

  <!-- Bottom rule + footer -->
  <line x1="90" y1="560" x2="${W - 90}" y2="560" stroke="${rule}" stroke-width="1"/>
  <text x="90" y="595" class="mono" font-size="14" letter-spacing="3" fill="${ink}">MACROLOG.WEB.APP · SPECIMEN · PERSONAL USE · CONFIDENTIAL</text>

  <!-- Icon lockup (top-right). Scale + translate the imported icon SVG. -->
  <g transform="translate(${W - 230}, 90) scale(0.55)">
    ${iconInner}
  </g>
</svg>`;

const out = resolve(root, 'public/og-image.png');
await sharp(Buffer.from(og))
  .resize(W, H)
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`Generated ${out}`);
