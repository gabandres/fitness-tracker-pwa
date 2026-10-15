/**
 * The "update required" minimum, as the admin page reasons about it. Pure, so
 * the one rule that can strand the whole fleet is unit-tested here and not only
 * on the server.
 *
 * The server is the authority — `checkMinAppVersion` in
 * `functions/src/app-version.ts` refuses the same inputs this refuses, and the
 * mobile client compares with `versionKey` in `apps/mobile/src/lib/app-update.ts`.
 * This copy exists so the page can say WHY before the owner presses the button.
 */

export type MinPlatform = 'android' | 'ios';

/** `public/appVersion` as stored (read straight from Firestore, not the
 *  CDN-cached JSON, so the page sees a just-set minimum immediately). */
export interface AppVersionDoc {
  android?: { latestVersionCode?: number; where?: string[]; productionVersionCode?: number; minVersionCode?: number };
  ios?: { latestVersion?: string; latestBuild?: number; minVersion?: string };
}

/** One platform's row on the page. `live` is what a STORE user can install:
 *  Android's production track (alpha/beta excluded), iOS's App Store version. */
export interface MinVersionRow {
  platform: MinPlatform;
  live: number | string | null;
  newest: number | string | null;
  min: number | string | null;
}

/** "1.2.3" → 1_002_003. Mirror of the client's and the server's `versionKey`. */
export function versionKey(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const m = /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3] ?? 0);
}

/** Newest versionCode in a COMPLETED production release, as the sync records
 *  it (`productionVersionCode`). Deliberately NOT parsed from `where`: that
 *  list carries no release status, so a staged rollout (`inProgress`, most
 *  users cannot install it) would read as live. Null = unknown. */
export function liveProductionVersionCode(android: AppVersionDoc['android']): number | null {
  const vc = android?.productionVersionCode;
  return typeof vc === 'number' && Number.isInteger(vc) && vc > 0 ? vc : null;
}

export function minVersionRows(doc: AppVersionDoc | null): MinVersionRow[] {
  const a = doc?.android;
  const i = doc?.ios;
  return [
    {
      platform: 'android',
      live: liveProductionVersionCode(a),
      newest: typeof a?.latestVersionCode === 'number' ? a.latestVersionCode : null,
      min: typeof a?.minVersionCode === 'number' ? a.minVersionCode : null,
    },
    {
      platform: 'ios',
      live: versionKey(i?.latestVersion) != null ? i!.latestVersion! : null,
      newest: versionKey(i?.latestVersion) != null ? i!.latestVersion! : null,
      min: typeof i?.minVersion === 'string' ? i.minVersion : null,
    },
  ];
}

/** Why a typed minimum cannot be saved — an i18n key under
 *  `admin.minVersion.error`, plus its interpolation params. */
export type MinVersionVerdict =
  | { ok: true; value: number | string }
  | { ok: false; error: 'empty' | 'invalidAndroid' | 'invalidIos' | 'liveUnknown' | 'aboveLive'; params?: Record<string, string | number> };

/**
 * May `raw` become `row.platform`'s minimum? Refuses anything ABOVE the live
 * store version (it would tell every user to install something the store
 * cannot give them) and refuses when the live version is unknown — "cannot
 * verify" must not read as "fine".
 */
export function checkMinVersion(row: MinVersionRow, raw: string): MinVersionVerdict {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'empty' };
  if (row.platform === 'android') {
    if (!/^\d+$/.test(text) || Number(text) <= 0) return { ok: false, error: 'invalidAndroid' };
    const value = Number(text);
    if (row.live == null) return { ok: false, error: 'liveUnknown' };
    if (value > (row.live as number)) return { ok: false, error: 'aboveLive', params: { value: `vc ${value}`, live: `vc ${row.live}` } };
    return { ok: true, value };
  }
  const key = versionKey(text);
  if (key == null) return { ok: false, error: 'invalidIos' };
  if (row.live == null) return { ok: false, error: 'liveUnknown' };
  if (key > versionKey(row.live)!) return { ok: false, error: 'aboveLive', params: { value: text, live: String(row.live) } };
  return { ok: true, value: text };
}
