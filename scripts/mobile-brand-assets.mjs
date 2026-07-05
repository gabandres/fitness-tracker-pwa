/**
 * One-shot generator for the Ignia mobile app icons + native splash, all built
 * from the in-app Flame mark (apps/mobile/src/components/Flame.tsx) so the store
 * icon, adaptive icon, splash and favicon are the same ember. Re-run after
 * editing the mark:  node scripts/mobile-brand-assets.mjs
 */
import sharp from 'sharp';

const OUT = 'apps/mobile/assets/images';

// Brand constants (theme.ts): coral ring, amber carb, deep accent, ember canvas.
const CORAL = '#ff6a3d';
const AMBER = '#fbbf24';
const DEEP = '#c62f27';
const EMBER_HI = '#2a1712'; // ember glow center
const EMBER_LO = '#131210'; // dark paper edge

// Flame + core paths in a 0..100 box (mark center ≈ 50,52), mirrored from Flame.tsx.
const FLAME = 'M50 15 C 62 31 64 45 60 58 C 57 70 52 78 50 87 C 48 78 43 70 40 58 C 36 45 38 31 50 15 Z';
const CORE = 'M50 41 C 56 49 57 57 54 64 C 52 70 51 74 50 79 C 49 74 48 70 46 64 C 43 57 44 49 50 41 Z';

/** The mark (ring + flame + core + white-hot base) as SVG inner markup, scaled
 *  and centered so its ~90-tall body fills `frac` of a `canvas`px square. */
function mark({ mono = false } = {}) {
  const ring = mono ? '#ffffff' : CORAL;
  const flameFill = mono ? '#ffffff' : 'url(#flame)';
  return `
    <circle cx="50" cy="52" r="45" fill="none" stroke="${ring}" stroke-width="4" opacity="${mono ? 1 : 0.9}"/>
    <path d="${FLAME}" fill="${flameFill}"/>
    ${mono ? '' : `<path d="${CORE}" fill="${AMBER}" opacity="0.92"/><circle cx="50" cy="66" r="6" fill="#fff" opacity="0.85"/>`}
  `;
}

/** Build a full SVG: optional ember background, the mark scaled to `frac`. */
function svg({ canvas = 1024, frac = 0.62, bg = null, mono = false } = {}) {
  const s = (canvas * frac) / 100; // 100-space → px scale
  const tx = canvas / 2;
  const ty = canvas / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="75%">
      <stop offset="0" stop-color="${EMBER_HI}"/><stop offset="1" stop-color="${EMBER_LO}"/>
    </radialGradient>
    <radialGradient id="flame" cx="50%" cy="72%" r="62%">
      <stop offset="0" stop-color="${AMBER}"/><stop offset="0.5" stop-color="${CORAL}"/><stop offset="1" stop-color="${DEEP}"/>
    </radialGradient>
  </defs>
  ${bg === 'ember' ? `<rect width="${canvas}" height="${canvas}" fill="url(#bg)"/>` : ''}
  <g transform="translate(${tx} ${ty}) scale(${s}) translate(-50 -52)">
    ${mark({ mono })}
  </g>
</svg>`;
}

async function render(name, opts) {
  const canvas = opts.canvas ?? 1024;
  const buf = await sharp(Buffer.from(svg(opts)), { density: 384 })
    .resize(canvas, canvas)
    .png()
    .toBuffer();
  await sharp(buf).toFile(`${OUT}/${name}`);
  console.log('  ✓', name, `${canvas}²`, opts.bg === 'ember' ? '(ember bg)' : opts.mono ? '(mono)' : '(transparent)');
}

// Solid ember-radial background for the Android adaptive backer.
async function renderBackground(name) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs><radialGradient id="bg" cx="50%" cy="42%" r="75%">
      <stop offset="0" stop-color="${EMBER_HI}"/><stop offset="1" stop-color="${EMBER_LO}"/>
    </radialGradient></defs>
    <rect width="1024" height="1024" fill="url(#bg)"/></svg>`;
  await sharp(Buffer.from(s), { density: 384 }).resize(1024, 1024).flatten({ background: EMBER_LO }).png().toFile(`${OUT}/${name}`);
  console.log('  ✓', name, '1024² (ember bg, no alpha)');
}

console.log('Generating Ignia mobile brand assets →', OUT);
// iOS/store icon: full-bleed ember + glowing flame.
await render('icon.png', { frac: 0.6, bg: 'ember' });
// Native splash foreground: transparent (sits on the app.json splash bg), larger.
await render('splash-icon.png', { frac: 0.82 });
// Android adaptive: flame in the 60% safe zone, transparent; ember backer.
await render('android-icon-foreground.png', { frac: 0.52 });
await renderBackground('android-icon-background.png');
// Android themed-icon monochrome: white silhouette, transparent.
await render('android-icon-monochrome.png', { frac: 0.52, mono: true });
// Web favicon.
await render('favicon.png', { canvas: 48, frac: 0.74, bg: 'ember' });
console.log('Done.');
