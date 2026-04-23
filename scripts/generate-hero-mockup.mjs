/**
 * Product mockup for the landing hero. A standalone dashboard card
 * (calorie ring + two stats) on a transparent background, roughly
 * square, designed to sit beside the hero headline on desktop and
 * hide on mobile.
 *
 * Output: public/hero-mockup.png (720×720, transparent).
 *
 * Run: node scripts/generate-hero-mockup.mjs
 */
import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const W = 720;
const H = 720;

const ink = '#1a1816';
const inkSoft = '#4a4540';
const blood = '#6e121a';
const rule = '#c8b8a0';
const paperDeep = '#ece4d3';
const olive = '#5a6b3a';

// Card geometry: centered, with a 30px outer margin.
const cardX = 60;
const cardY = 60;
const cardW = W - 120;  // 600
const cardH = H - 120;  // 600

// Ring centered in the upper half of the card.
const ringCx = cardX + cardW / 2;     // 360
const ringCy = cardY + 210;           // 270
const ringR = 150;
const ringStroke = 26;
const consumed = 0.78;
const circumference = 2 * Math.PI * ringR;
const consumedDash = circumference * consumed;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>
      .serif { font-family: 'Instrument Serif', 'Times New Roman', serif; font-style: italic; }
      .sans  { font-family: 'DM Sans', system-ui, sans-serif; }
      .mono  { font-family: 'JetBrains Mono', ui-monospace, 'Menlo', monospace; }
    </style>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="6" dy="10" stdDeviation="12" flood-color="#1a1816" flood-opacity="0.12"/>
    </filter>
  </defs>

  <!-- specimen frame with a soft drop shadow -->
  <g filter="url(#shadow)">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" fill="${paperDeep}" stroke="${ink}" stroke-width="1.5"/>
  </g>

  <!-- crop marks inside the card corners -->
  <g stroke="${blood}" stroke-width="2" fill="none">
    <path d="M ${cardX + 14} ${cardY + cardH - 14} L ${cardX + 14} ${cardY + cardH - 28} M ${cardX + 14} ${cardY + cardH - 14} L ${cardX + 28} ${cardY + cardH - 14}"/>
    <path d="M ${cardX + cardW - 14} ${cardY + cardH - 14} L ${cardX + cardW - 14} ${cardY + cardH - 28} M ${cardX + cardW - 14} ${cardY + cardH - 14} L ${cardX + cardW - 28} ${cardY + cardH - 14}"/>
  </g>

  <!-- label row -->
  <text x="${cardX + 32}" y="${cardY + 50}" class="mono" font-size="15" letter-spacing="4" fill="${blood}">[ TODAY · THU ]</text>
  <text x="${cardX + cardW - 32}" y="${cardY + 50}" class="mono" font-size="15" letter-spacing="3" fill="${inkSoft}" text-anchor="end">— 2026.04.23</text>

  <!-- ring -->
  <g transform="translate(${ringCx}, ${ringCy})">
    <circle r="${ringR}" fill="none" stroke="${rule}" stroke-width="${ringStroke}" stroke-opacity="0.5"/>
    <circle r="${ringR}" fill="none" stroke="${blood}" stroke-width="${ringStroke}"
      stroke-dasharray="${consumedDash} ${circumference}"
      stroke-linecap="butt"
      transform="rotate(-90)"/>

    <text y="-32" class="mono" font-size="14" letter-spacing="4" text-anchor="middle" fill="${inkSoft}">REMAINING</text>
    <text y="32" class="serif" font-size="96" text-anchor="middle" fill="${ink}">447</text>
    <text y="64" class="mono" font-size="14" letter-spacing="3" text-anchor="middle" fill="${inkSoft}">/ 2048 kcal</text>
  </g>

  <!-- divider -->
  <line x1="${cardX + 32}" y1="${cardY + 460}" x2="${cardX + cardW - 32}" y2="${cardY + 460}" stroke="${rule}" stroke-width="1"/>

  <!-- stats row -->
  <g transform="translate(${cardX + 32}, ${cardY + 490})">
    <text class="mono" font-size="12" letter-spacing="3" fill="${inkSoft}">PROTEIN</text>
    <text y="32" class="serif" font-size="36" fill="${ink}">138<tspan class="mono" font-size="14" dx="6" fill="${inkSoft}">g</tspan></text>
    <text y="58" class="mono" font-size="11" letter-spacing="2" fill="${olive}">✓ ON TARGET</text>
  </g>
  <g transform="translate(${cardX + 290}, ${cardY + 490})">
    <text class="mono" font-size="12" letter-spacing="3" fill="${inkSoft}">TDEE · 14D MEASURED</text>
    <text y="32" class="serif" font-size="36" fill="${ink}">2,048<tspan class="mono" font-size="14" dx="6" fill="${inkSoft}">kcal</tspan></text>
    <text y="58" class="mono" font-size="11" letter-spacing="2" fill="${inkSoft}">+38 VS MIFFLIN-ST JEOR</text>
  </g>
</svg>`;

const out = resolve(root, 'public/hero-mockup.png');
await sharp(Buffer.from(svg))
  .resize(W, H)
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`Generated ${out}`);
