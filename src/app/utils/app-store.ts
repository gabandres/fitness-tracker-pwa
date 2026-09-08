/**
 * App Store destinations.
 *
 * The listing URL was copy-pasted into three components and two static pages;
 * it lives here now so a Custom Product Page can be pointed at a surface by
 * changing one line rather than hunting for string literals.
 *
 * A **Custom Product Page** is an alternate version of the listing at its own
 * `?ppid=` URL, with its own screenshots and promotional text. The app name,
 * subtitle, description and icon are unchanged — only the visual pitch. The
 * point is that the first screenshot can answer the search that produced the
 * tap, instead of every route landing on the same generic frame.
 *
 * **Unapproved pages degrade to the default listing rather than 404**, so a
 * ppid link is safe to ship before Apple has reviewed the page. The flip side:
 * a wrong or deleted ppid fails silently and looks like it is working.
 *
 * Pages are created by `scripts/asc-custom-product-pages.mjs`, which is where
 * the screenshot order and promo text for each one are defined.
 */

const LISTING = 'https://apps.apple.com/app/id6788589414';

/** The plain listing — the default for any surface without a matching page. */
export const APP_STORE_URL = LISTING;

/** Google Play listing. Same package as `android.package` in apps/mobile/app.json
 *  and the `android` entry of `STORE_URLS` in apps/mobile/src/lib/app-update.ts. */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=fit.ignia.app';

/**
 * ONE-LINE FLIP: `true` while the Play listing is public — i.e. while
 * `PLAY_STORE_URL` returns 200 (`STATUS.md` owns that fact). Set back to
 * `false` only if the listing is ever pulled; the landing then shows a quiet
 * "coming soon to Google Play" state instead of linking visitors to a 404.
 */
export const PLAY_STORE_LIVE = true; // flipped 2026-09-07: Play production vc 44 public since 2026-09-03, store URL 200

/**
 * Google's official "Get it on Google Play" badge (play.google.com/intl/en_us/badges),
 * cropped of its transparent padding so a `height: 54px` renders it at the same
 * visual height as `/appstore-badge.svg` beside it. Two files because the badge
 * is localized ARTWORK — Google's brand rules forbid re-typesetting it, so the
 * Spanish half of the site gets Google's own es-419 badge, not a translated
 * label. Sized 564×168 (en) and 646×192 (es); both are 3.36:1.
 */
export function playBadgeSrc(lang: string): string {
  return lang.startsWith('es') ? '/playstore-badge-es.png' : '/playstore-badge-en.png';
}

/**
 * Custom Product Pages, keyed by the intent they serve.
 *
 * `switchers` — leads with the adaptive target, then the no-subscription
 * frame. For visitors arriving from the `/vs/*` comparisons, who are already
 * shopping for a replacement and for whom the price is the differentiator.
 *
 * `lifters` — leads with the training log. For traffic that already knows it
 * lifts, where the adaptive maths is the surprise rather than the pitch.
 */
export const APP_STORE_CPP = {
  switchers: `${LISTING}?ppid=d0f6d8e8-22ab-480c-ae73-bd161ca97fad`,
  lifters: `${LISTING}?ppid=a45a65d8-67a9-40c8-812f-33af908c41b6`,
} as const;
