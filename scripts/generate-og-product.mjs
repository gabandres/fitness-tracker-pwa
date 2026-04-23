/**
 * Second OG variant: a product-forward card showing a faux dashboard
 * ring + the primary headline. Used for launch platforms (Product Hunt
 * gallery, Twitter/X) that favor screenshots over pure typography.
 * The primary og-image.png stays editorial — this one fights for a
 * click in a product feed.
 *
 * Output: public/og-product.png (1200×630).
 *
 * Run: node scripts/generate-og-product.mjs
 */
import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const W = 1200;
const H = 630;

const bg = '#f4f0e8';
const ink = '#1a1816';
const inkSoft = '#4a4540';
const blood = '#6e121a';
const rule = '#c8b8a0';
const paperDeep = '#ece4d3';
const olive = '#5a6b3a';

// Ring geometry — a calorie-remaining donut. 78% consumed, 22% left.
// Center is (ringCx, ringCy) in absolute canvas coords; the card group
// translates by (720, 120), so the ring sits at card-local (180, 155).
const ringCx = 900;
const ringCy = 275;
const ringR = 105;
const ringStroke = 18;
const consumed = 0.78;
const circumference = 2 * Math.PI * ringR;
const consumedDash = circumference * consumed;

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

  <!-- LEFT: copy -->
  <g transform="translate(90, 110)">
    <rect x="0" y="0" width="130" height="30" fill="none" stroke="${blood}" stroke-width="1.5" rx="2"/>
    <text x="65" y="21" class="sans" font-size="12" font-weight="600" letter-spacing="3" text-anchor="middle" fill="${blood}">CALIBRATION</text>
  </g>

  <g transform="translate(90, 210)">
    <text class="serif" font-size="74" fill="${ink}">how many calories</text>
    <text y="86" class="serif" font-size="74" fill="${blood}">do I have left today?</text>
  </g>

  <text x="90" y="420" class="sans" font-size="20" fill="${inkSoft}">measured TDEE · photo → macros · weekly AI report</text>
  <text x="90" y="450" class="sans" font-size="20" fill="${inkSoft}">no ads. no data selling. $3/mo. 7-day free trial.</text>

  <!-- RIGHT: faux dashboard card -->
  <g transform="translate(720, 120)">
    <!-- specimen frame -->
    <rect x="0" y="0" width="380" height="380" fill="${paperDeep}" stroke="${ink}" stroke-width="1.5"/>
    <!-- crop marks bottom-left + bottom-right of the card -->
    <g stroke="${blood}" stroke-width="1.5" fill="none">
      <path d="M 10 370 L 10 360 M 10 370 L 20 370"/>
      <path d="M 370 370 L 370 360 M 370 370 L 360 370"/>
    </g>

    <!-- label row -->
    <text x="24" y="38" class="mono" font-size="11" letter-spacing="3" fill="${blood}">[ TODAY · THU ]</text>
    <text x="356" y="38" class="mono" font-size="11" letter-spacing="2" fill="${inkSoft}" text-anchor="end">— 2026.04.23</text>

    <!-- ring -->
    <g transform="translate(${ringCx - 720}, ${ringCy - 120})">
      <circle r="${ringR}" fill="none" stroke="${rule}" stroke-width="${ringStroke}" stroke-opacity="0.5"/>
      <circle r="${ringR}" fill="none" stroke="${blood}" stroke-width="${ringStroke}"
        stroke-dasharray="${consumedDash} ${circumference}"
        stroke-linecap="butt"
        transform="rotate(-90)"/>

      <!-- center stack -->
      <text y="-20" class="mono" font-size="11" letter-spacing="3" text-anchor="middle" fill="${inkSoft}">REMAINING</text>
      <text y="22" class="serif" font-size="64" text-anchor="middle" fill="${ink}">447</text>
      <text y="50" class="mono" font-size="11" letter-spacing="2" text-anchor="middle" fill="${inkSoft}">/ 2048 kcal</text>
    </g>

    <!-- divider above stats -->
    <line x1="24" y1="300" x2="356" y2="300" stroke="${rule}" stroke-width="1"/>

    <!-- stats row -->
    <g transform="translate(24, 320)">
      <text class="mono" font-size="10" letter-spacing="3" fill="${inkSoft}">PROTEIN</text>
      <text y="22" class="serif" font-size="24" fill="${ink}">138<tspan class="mono" font-size="11" dx="4" fill="${inkSoft}">g</tspan></text>
      <text y="42" class="mono" font-size="9" letter-spacing="2" fill="${olive}">✓ ON TARGET</text>
    </g>
    <g transform="translate(200, 320)">
      <text class="mono" font-size="10" letter-spacing="3" fill="${inkSoft}">TDEE · 14D</text>
      <text y="22" class="serif" font-size="24" fill="${ink}">2,048<tspan class="mono" font-size="11" dx="4" fill="${inkSoft}">kcal</tspan></text>
      <text y="42" class="mono" font-size="9" letter-spacing="2" fill="${inkSoft}">MEASURED · +38 VS MSJ</text>
    </g>
  </g>

  <!-- footer rule -->
  <line x1="90" y1="570" x2="${W - 90}" y2="570" stroke="${rule}" stroke-width="1"/>
  <text x="90" y="602" class="mono" font-size="13" letter-spacing="3" fill="${ink}">MACROLOG.WEB.APP · PWA · PRIVATE · CONFIDENTIAL</text>
</svg>`;

const out = resolve(root, 'public/og-product.png');
await sharp(Buffer.from(og))
  .resize(W, H)
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`Generated ${out}`);
