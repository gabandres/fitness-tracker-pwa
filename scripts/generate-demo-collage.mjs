/**
 * Four-panel demo collage — standin for a proper Loom until Gabriel
 * records one. Shows the core user journey in a single static image:
 *
 *   1. open the landing  → "how many calories do I have left?"
 *   2. log via photo     → camera icon + macro readout
 *   3. check dashboard   → calorie ring + protein + TDEE
 *   4. weekly report     → AI summary card
 *
 * Output: public/demo-collage.png (1600×1000).
 *
 * Run: node scripts/generate-demo-collage.mjs
 */
import sharp from 'sharp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const W = 1600;
const H = 1000;

const bg = '#f4f0e8';
const ink = '#1a1816';
const inkSoft = '#4a4540';
const blood = '#6e121a';
const rule = '#c8b8a0';
const paperDeep = '#ece4d3';
const olive = '#5a6b3a';
const gold = '#a67c2e';

// 2×2 grid of panels. Each is 700×400 with 50px gutters and 50px outer margin.
const panelW = 700;
const panelH = 400;
const gutter = 50;
const outer = 50;

const panel = (col, row) => ({
  x: outer + col * (panelW + gutter),
  y: outer + 80 + row * (panelH + gutter),
});

const p1 = panel(0, 0);
const p2 = panel(1, 0);
const p3 = panel(0, 1);
const p4 = panel(1, 1);

// Ring geometry for panel 3.
const ringCx = p3.x + panelW / 2;
const ringCy = p3.y + 180;
const ringR = 90;
const ringStroke = 16;
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
  </defs>

  <rect width="${W}" height="${H}" fill="${bg}"/>

  <!-- crop marks -->
  <g stroke="${ink}" stroke-width="2" fill="none">
    <path d="M 30 15 L 30 40 M 15 30 L 40 30"/>
    <path d="M ${W - 30} 15 L ${W - 30} 40 M ${W - 15} 30 L ${W - 40} 30"/>
    <path d="M 30 ${H - 15} L 30 ${H - 40} M 15 ${H - 30} L 40 ${H - 30}"/>
    <path d="M ${W - 30} ${H - 15} L ${W - 30} ${H - 40} M ${W - 15} ${H - 30} L ${W - 40} ${H - 30}"/>
  </g>

  <!-- Title bar -->
  <text x="${outer + 10}" y="62" class="serif" font-size="42" fill="${ink}">
    Macro Log <tspan fill="${blood}">— four steps.</tspan>
  </text>
  <text x="${W - outer - 10}" y="62" class="mono" font-size="14" letter-spacing="3" fill="${inkSoft}" text-anchor="end">DEMO · 2026.04.23</text>

  <!-- ============== PANEL 1: LANDING ============== -->
  <rect x="${p1.x}" y="${p1.y}" width="${panelW}" height="${panelH}" fill="${paperDeep}" stroke="${ink}" stroke-width="1.5"/>
  <g stroke="${blood}" stroke-width="1.5" fill="none">
    <path d="M ${p1.x + 12} ${p1.y + panelH - 12} L ${p1.x + 12} ${p1.y + panelH - 26} M ${p1.x + 12} ${p1.y + panelH - 12} L ${p1.x + 26} ${p1.y + panelH - 12}"/>
  </g>
  <rect x="${p1.x + 30}" y="${p1.y + 30}" width="56" height="26" fill="none" stroke="${blood}" stroke-width="1.5" rx="2"/>
  <text x="${p1.x + 58}" y="${p1.y + 48}" class="sans" font-size="11" font-weight="600" letter-spacing="2.5" text-anchor="middle" fill="${blood}">01</text>
  <text x="${p1.x + 100}" y="${p1.y + 48}" class="mono" font-size="13" letter-spacing="3" fill="${inkSoft}">START ON THE LANDING</text>

  <text x="${p1.x + 30}" y="${p1.y + 130}" class="serif" font-size="48" fill="${ink}">how many calories</text>
  <text x="${p1.x + 30}" y="${p1.y + 180}" class="serif" font-size="48" fill="${blood}">do I have left today?</text>

  <text x="${p1.x + 30}" y="${p1.y + 230}" class="sans" font-size="16" fill="${inkSoft}">that's the only question.</text>

  <rect x="${p1.x + 30}" y="${p1.y + 280}" width="200" height="44" fill="${blood}"/>
  <text x="${p1.x + 130}" y="${p1.y + 308}" class="mono" font-size="13" letter-spacing="3" text-anchor="middle" fill="${bg}">START LOGGING</text>

  <rect x="${p1.x + 250}" y="${p1.y + 280}" width="140" height="44" fill="none" stroke="${ink}" stroke-width="1.5"/>
  <text x="${p1.x + 320}" y="${p1.y + 308}" class="mono" font-size="13" letter-spacing="3" text-anchor="middle" fill="${ink}">SEE PRICING</text>

  <!-- ============== PANEL 2: PHOTO CAPTURE ============== -->
  <rect x="${p2.x}" y="${p2.y}" width="${panelW}" height="${panelH}" fill="${paperDeep}" stroke="${ink}" stroke-width="1.5"/>
  <g stroke="${blood}" stroke-width="1.5" fill="none">
    <path d="M ${p2.x + 12} ${p2.y + panelH - 12} L ${p2.x + 12} ${p2.y + panelH - 26} M ${p2.x + 12} ${p2.y + panelH - 12} L ${p2.x + 26} ${p2.y + panelH - 12}"/>
  </g>
  <rect x="${p2.x + 30}" y="${p2.y + 30}" width="56" height="26" fill="none" stroke="${blood}" stroke-width="1.5" rx="2"/>
  <text x="${p2.x + 58}" y="${p2.y + 48}" class="sans" font-size="11" font-weight="600" letter-spacing="2.5" text-anchor="middle" fill="${blood}">02</text>
  <text x="${p2.x + 100}" y="${p2.y + 48}" class="mono" font-size="13" letter-spacing="3" fill="${inkSoft}">LOG A MEAL · PHOTO → MACROS</text>

  <!-- fake phone frame -->
  <g transform="translate(${p2.x + 60}, ${p2.y + 90})">
    <rect x="0" y="0" width="200" height="280" rx="28" fill="${ink}"/>
    <rect x="8" y="8" width="184" height="264" rx="22" fill="${bg}"/>
    <!-- camera reticle -->
    <rect x="36" y="52" width="128" height="90" fill="none" stroke="${blood}" stroke-width="2" stroke-dasharray="4 4"/>
    <circle cx="100" cy="97" r="22" fill="none" stroke="${blood}" stroke-width="2"/>
    <circle cx="100" cy="97" r="6" fill="${blood}"/>
    <text x="100" y="180" class="mono" font-size="9" letter-spacing="2" text-anchor="middle" fill="${inkSoft}">[ SHUTTER ]</text>
    <rect x="40" y="210" width="120" height="36" rx="4" fill="${blood}"/>
    <text x="100" y="234" class="mono" font-size="11" letter-spacing="2" text-anchor="middle" fill="${bg}">ANALYZE</text>
  </g>

  <!-- result card -->
  <g transform="translate(${p2.x + 300}, ${p2.y + 90})">
    <text y="16" class="mono" font-size="11" letter-spacing="3" fill="${blood}">[ DETECTED ]</text>
    <text y="60" class="serif" font-size="28" fill="${ink}">Grilled chicken</text>
    <text y="86" class="serif" font-style="italic" font-size="18" fill="${inkSoft}">+ rice + broccoli</text>

    <line x1="0" y1="110" x2="330" y2="110" stroke="${rule}" stroke-width="1"/>

    <text x="0" y="140" class="mono" font-size="11" letter-spacing="3" fill="${inkSoft}">CALORIES</text>
    <text x="0" y="170" class="serif" font-size="32" fill="${ink}">612<tspan class="mono" font-size="12" dx="6" fill="${inkSoft}">kcal</tspan></text>

    <text x="140" y="140" class="mono" font-size="11" letter-spacing="3" fill="${inkSoft}">PROTEIN</text>
    <text x="140" y="170" class="serif" font-size="32" fill="${ink}">48<tspan class="mono" font-size="12" dx="6" fill="${inkSoft}">g</tspan></text>

    <text x="240" y="140" class="mono" font-size="11" letter-spacing="3" fill="${inkSoft}">CONF.</text>
    <text x="240" y="170" class="serif" font-size="32" fill="${olive}">92<tspan class="mono" font-size="12" dx="4" fill="${inkSoft}">%</tspan></text>

    <rect x="0" y="210" width="200" height="36" fill="${ink}"/>
    <text x="100" y="234" class="mono" font-size="11" letter-spacing="3" text-anchor="middle" fill="${bg}">SAVE TO LEDGER</text>
  </g>

  <!-- ============== PANEL 3: DASHBOARD ============== -->
  <rect x="${p3.x}" y="${p3.y}" width="${panelW}" height="${panelH}" fill="${paperDeep}" stroke="${ink}" stroke-width="1.5"/>
  <g stroke="${blood}" stroke-width="1.5" fill="none">
    <path d="M ${p3.x + 12} ${p3.y + panelH - 12} L ${p3.x + 12} ${p3.y + panelH - 26} M ${p3.x + 12} ${p3.y + panelH - 12} L ${p3.x + 26} ${p3.y + panelH - 12}"/>
  </g>
  <rect x="${p3.x + 30}" y="${p3.y + 30}" width="56" height="26" fill="none" stroke="${blood}" stroke-width="1.5" rx="2"/>
  <text x="${p3.x + 58}" y="${p3.y + 48}" class="sans" font-size="11" font-weight="600" letter-spacing="2.5" text-anchor="middle" fill="${blood}">03</text>
  <text x="${p3.x + 100}" y="${p3.y + 48}" class="mono" font-size="13" letter-spacing="3" fill="${inkSoft}">DASHBOARD · THE ONE NUMBER</text>

  <g transform="translate(${ringCx}, ${ringCy})">
    <circle r="${ringR}" fill="none" stroke="${rule}" stroke-width="${ringStroke}" stroke-opacity="0.5"/>
    <circle r="${ringR}" fill="none" stroke="${blood}" stroke-width="${ringStroke}"
      stroke-dasharray="${consumedDash} ${circumference}"
      transform="rotate(-90)"/>
    <text y="-14" class="mono" font-size="11" letter-spacing="3" text-anchor="middle" fill="${inkSoft}">REMAINING</text>
    <text y="22" class="serif" font-size="60" text-anchor="middle" fill="${ink}">447</text>
    <text y="46" class="mono" font-size="11" letter-spacing="2" text-anchor="middle" fill="${inkSoft}">/ 2048 kcal</text>
  </g>

  <line x1="${p3.x + 30}" y1="${p3.y + 320}" x2="${p3.x + panelW - 30}" y2="${p3.y + 320}" stroke="${rule}" stroke-width="1"/>

  <text x="${p3.x + 30}" y="${p3.y + 348}" class="mono" font-size="11" letter-spacing="3" fill="${inkSoft}">PROTEIN</text>
  <text x="${p3.x + 30}" y="${p3.y + 375}" class="serif" font-size="24" fill="${ink}">138<tspan class="mono" font-size="12" dx="4" fill="${inkSoft}">g</tspan></text>

  <text x="${p3.x + 230}" y="${p3.y + 348}" class="mono" font-size="11" letter-spacing="3" fill="${inkSoft}">TDEE · 14D</text>
  <text x="${p3.x + 230}" y="${p3.y + 375}" class="serif" font-size="24" fill="${ink}">2,048<tspan class="mono" font-size="12" dx="4" fill="${inkSoft}">kcal</tspan></text>

  <text x="${p3.x + 430}" y="${p3.y + 348}" class="mono" font-size="11" letter-spacing="3" fill="${inkSoft}">WEIGHT · 7D</text>
  <text x="${p3.x + 430}" y="${p3.y + 375}" class="serif" font-size="24" fill="${ink}">174.2<tspan class="mono" font-size="12" dx="4" fill="${inkSoft}">lb</tspan></text>

  <!-- ============== PANEL 4: WEEKLY REPORT ============== -->
  <rect x="${p4.x}" y="${p4.y}" width="${panelW}" height="${panelH}" fill="${paperDeep}" stroke="${ink}" stroke-width="1.5"/>
  <g stroke="${blood}" stroke-width="1.5" fill="none">
    <path d="M ${p4.x + 12} ${p4.y + panelH - 12} L ${p4.x + 12} ${p4.y + panelH - 26} M ${p4.x + 12} ${p4.y + panelH - 12} L ${p4.x + 26} ${p4.y + panelH - 12}"/>
  </g>
  <rect x="${p4.x + 30}" y="${p4.y + 30}" width="56" height="26" fill="none" stroke="${blood}" stroke-width="1.5" rx="2"/>
  <text x="${p4.x + 58}" y="${p4.y + 48}" class="sans" font-size="11" font-weight="600" letter-spacing="2.5" text-anchor="middle" fill="${blood}">04</text>
  <text x="${p4.x + 100}" y="${p4.y + 48}" class="mono" font-size="13" letter-spacing="3" fill="${inkSoft}">WEEKLY AI REPORT · READS YOUR LOG</text>

  <text x="${p4.x + 30}" y="${p4.y + 110}" class="serif" font-size="28" fill="${ink}">
    You're running a
    <tspan fill="${blood}" font-style="italic">380 kcal deficit</tspan>
  </text>
  <text x="${p4.x + 30}" y="${p4.y + 142}" class="serif" font-size="28" fill="${ink}">against a measured TDEE of 2,048.</text>

  <line x1="${p4.x + 30}" y1="${p4.y + 170}" x2="${p4.x + panelW - 30}" y2="${p4.y + 170}" stroke="${rule}" stroke-width="1"/>

  <g transform="translate(${p4.x + 30}, ${p4.y + 200})">
    <circle cx="6" cy="6" r="4" fill="${olive}"/>
    <text x="20" y="10" class="sans" font-size="14" fill="${ink}">Protein held 138g average — on target.</text>
  </g>
  <g transform="translate(${p4.x + 30}, ${p4.y + 230})">
    <circle cx="6" cy="6" r="4" fill="${gold}"/>
    <text x="20" y="10" class="sans" font-size="14" fill="${ink}">Weekend intake jumped +640 kcal on Sat.</text>
  </g>
  <g transform="translate(${p4.x + 30}, ${p4.y + 260})">
    <circle cx="6" cy="6" r="4" fill="${olive}"/>
    <text x="20" y="10" class="sans" font-size="14" fill="${ink}">Scale trended −0.6 lb/week — pace matches target.</text>
  </g>
  <g transform="translate(${p4.x + 30}, ${p4.y + 290})">
    <circle cx="6" cy="6" r="4" fill="${blood}"/>
    <text x="20" y="10" class="sans" font-size="14" fill="${ink}">Consider repeating Tue's protein distribution.</text>
  </g>

  <text x="${p4.x + 30}" y="${p4.y + 370}" class="mono" font-size="10" letter-spacing="2" fill="${inkSoft}">GROUNDED IN YOUR LOG · NOT A GENERIC TEMPLATE</text>

  <!-- Bottom rule + footer -->
  <line x1="${outer}" y1="${H - 40}" x2="${W - outer}" y2="${H - 40}" stroke="${rule}" stroke-width="1"/>
  <text x="${outer}" y="${H - 15}" class="mono" font-size="12" letter-spacing="3" fill="${ink}">MACROLOG.WEB.APP · $3/MO · 7-DAY FREE TRIAL · NO ADS · NO SELLING</text>
</svg>`;

const out = resolve(root, 'public/demo-collage.png');
await sharp(Buffer.from(svg))
  .resize(W, H)
  .png({ compressionLevel: 9 })
  .toFile(out);

console.log(`Generated ${out}`);
