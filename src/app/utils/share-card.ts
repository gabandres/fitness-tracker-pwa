/**
 * Share-card image builder. The stat selection + number formatting are
 * pure and unit-tested ({@link shareStatItems}); the canvas render and
 * the Web-Share/download handoff need a DOM and are exercised in the
 * browser smoke.
 *
 * Privacy: the card is built from numbers only (streak, days, weight
 * delta) — it NEVER sources a progress photo (ADR-0010 guardrail).
 */

export interface ShareStats {
  streak: number;
  /** Distinct calendar days with at least one log, all-time. */
  loggedDays: number;
  /** Signed lb change since the start weight; positive = lost. Null when
   *  there's no goal/weight history to compare. */
  weightDeltaLb: number | null;
}

/** A stat tile: a formatted value plus a stable `kind` the caller maps to
 *  a localized label (so this module stays translation-free). */
export interface ShareStatItem {
  value: string;
  kind: 'streak' | 'days' | 'lost' | 'gained';
}

/** Minimum weight move worth putting on a card — below this it's noise. */
const MIN_WEIGHT_DELTA = 0.1;

/**
 * Choose and format the tiles for the card. Streak and days always
 * appear; the weight tile only when there's a meaningful move (and its
 * `kind` encodes direction so the label can read "lost"/"gained" and the
 * value stays unsigned).
 */
export function shareStatItems(s: ShareStats): ShareStatItem[] {
  const items: ShareStatItem[] = [
    { value: s.streak.toLocaleString(), kind: 'streak' },
    { value: s.loggedDays.toLocaleString(), kind: 'days' },
  ];
  if (s.weightDeltaLb != null && Math.abs(s.weightDeltaLb) >= MIN_WEIGHT_DELTA) {
    const lost = s.weightDeltaLb > 0;
    items.push({
      value: `${Math.abs(s.weightDeltaLb).toFixed(1)} lb`,
      kind: lost ? 'lost' : 'gained',
    });
  }
  return items;
}

/** A tile with its label already localized by the caller. */
export interface RenderTile {
  value: string;
  label: string;
}

const CARD_W = 1200;
const CARD_H = 630;
// Warm-minimal palette, hard-coded so the offscreen canvas renders the
// same regardless of the user's active theme.
const PAPER = '#f4f0e8';
const PAPER_DEEP = '#eae4d6';
const INK = '#111110';
const GRAPHITE = '#504840';
const BLOOD = '#8b1a1a';

/**
 * Render the share card to a PNG Blob (1200×630, OG-image ratio). Draws
 * an offscreen canvas — never attached to the DOM. Rejects if the 2D
 * context or PNG encode is unavailable.
 */
export function renderShareCardCanvas(
  tiles: readonly RenderTile[],
  opts: { wordmark: string; tagline: string },
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas 2D context unavailable'));
      return;
    }

    // Background: a soft vertical paper wash.
    const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
    bg.addColorStop(0, PAPER);
    bg.addColorStop(1, PAPER_DEEP);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Accent rule down the left edge.
    ctx.fillStyle = BLOOD;
    ctx.fillRect(0, 0, 12, CARD_H);

    const sans = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    const left = 90;

    // Wordmark.
    ctx.fillStyle = BLOOD;
    ctx.font = `600 44px ${sans}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(opts.wordmark, left, 120);

    // Stat tiles, evenly spaced across the middle band.
    const n = Math.max(1, tiles.length);
    const bandTop = 210;
    const colW = (CARD_W - left * 2) / n;
    tiles.forEach((tile, i) => {
      const cx = left + colW * i + colW / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.font = `700 96px ${sans}`;
      ctx.fillText(tile.value, cx, bandTop + 110);
      ctx.fillStyle = GRAPHITE;
      ctx.font = `500 30px ${sans}`;
      ctx.fillText(tile.label.toUpperCase(), cx, bandTop + 165);
    });

    // Tagline footer.
    ctx.textAlign = 'left';
    ctx.fillStyle = GRAPHITE;
    ctx.font = `400 30px ${sans}`;
    ctx.fillText(opts.tagline, left, CARD_H - 70);

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Share image encode failed'))),
      'image/png',
    );
  });
}

/**
 * Share the PNG via the Web Share API when the platform can share files,
 * else fall back to a download. Returns which path was taken. A user
 * cancelling the native share sheet resolves as 'shared' (not an error).
 */
export async function shareImage(
  blob: Blob,
  filename: string,
  shareText: string,
): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: shareText });
      return 'shared';
    } catch (err) {
      // AbortError = user dismissed the sheet; not a failure.
      if (err instanceof Error && err.name === 'AbortError') return 'shared';
      throw err;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
