import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { db } from "./init";
import { requireAdmin } from "./admin-guard";
import { writeAuditLog } from "./audit-log";

// ─── app-version: what the newest STORE binary is, per platform ─────
//
// The mobile app fetches `https://ignia.fit/app-version.json` on launch and
// shows an "update available" banner when the store has a newer binary than
// the one running (`apps/mobile/src/lib/app-update.ts`). Until 2026-09-05
// that URL was a static file: derived by `scripts/app-version-sync.mjs` on
// the workstation, then shipped by `npm run build && firebase deploy`. It
// drifted on every release (1.2.1, 1.2.2) because the sync was a step a
// person had to remember at the moment they were busy shipping.
//
// Now the numbers live in Firestore `public/appVersion`, refreshed by the
// hourly dispatcher and on demand from the admin console, and the URL is a
// hosting rewrite to `appVersionJson` below. No key, no build, no deploy:
//
//   - Android: the androidpublisher tracks API, authenticated as the
//     function's OWN service account (`<project-number>-compute@…`), which
//     the owner invited to Play Console read-only. No JSON key anywhere in
//     the cloud — the Secret Manager floor stays at 6.
//   - iOS: Apple's public iTunes Lookup API, which needs no credential and
//     returns the marketing version that is live on the App Store. It does
//     NOT return the build number, which older clients compare on, so the
//     release script records `version → build` in `iosBuilds` at submission
//     time (the workstation holds the ASC key) and the sync promotes that
//     build the hour the version goes live. Legacy clients keep working.
//
// Every read is best-effort and one-sided: a failed Play call leaves the
// android half untouched, a failed lookup leaves ios untouched. "Unknown"
// must never be written as 0 — 0 disables the banner, and silently turning
// off a shipped feature because an API blinked is the failure this exists
// to prevent.

export const PACKAGE = "fit.ignia.app";
export const BUNDLE_ID = "fit.ignia.app";
export const DOC_PATH = "public/appVersion";

/** Tracks that can actually put a build on a stranger's phone. `internal`
 *  is deliberately absent — it is used as a MECHANISM (making Play re-scan
 *  a bundle for a new health permission), never as a channel, and pointing
 *  the banner at a build nobody can install burns its credibility. Same rule
 *  as `scripts/app-version-sync.mjs`, which owns the full history. */
export const DISTRIBUTING_TRACKS: ReadonlySet<string> = new Set(["production", "beta", "alpha"]);

export interface PlayTrack {
  track?: string;
  releases?: Array<{ status?: string; versionCodes?: Array<string | number> }>;
}

/** Newest rolled-out versionCode on a track with an audience. Pure. */
export function pickLivePlayVersionCode(tracks: readonly PlayTrack[]): { versionCode: number; where: string[] } {
  let best = 0;
  const where: string[] = [];
  for (const t of tracks) {
    if (!t.track || !DISTRIBUTING_TRACKS.has(t.track)) continue;
    for (const r of t.releases ?? []) {
      if (r.status === "draft") continue;
      for (const vc of r.versionCodes ?? []) {
        const n = Number(vc);
        if (!Number.isFinite(n) || n <= 0) continue;
        if (n > best) best = n;
        where.push(`${t.track} vc ${n}`);
      }
    }
  }
  return { versionCode: best, where };
}

export interface LookupResult {
  resultCount?: number;
  results?: Array<{ bundleId?: string; version?: string; currentVersionReleaseDate?: string }>;
}

/** The live App Store marketing version from an iTunes Lookup payload. Pure.
 *  Null when the lookup has nothing for our bundle — never a guess. */
export function pickLiveAppStoreVersion(lookup: LookupResult): { version: string; releaseDate: string | null } | null {
  const hit = (lookup.results ?? []).find((r) => r.bundleId === BUNDLE_ID && typeof r.version === "string");
  if (!hit?.version) return null;
  return { version: hit.version, releaseDate: hit.currentVersionReleaseDate ?? null };
}

/** `{ "1.2.2": 63, "1.2.3": 64 }` → the build for a version, or null. Pure. */
export function buildForVersion(iosBuilds: Record<string, unknown> | undefined, version: string): number | null {
  const n = Number(iosBuilds?.[version]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─── Live reads ─────────────────────────────────────────────────────

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] });

/** Play, as the function's own identity. Opens and closes an edit — leaving
 *  one open can block the next `eas submit`. */
export async function readPlayTracks(): Promise<PlayTrack[]> {
  const client = await auth.getClient();
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
  const edit = await client.request<{ id: string }>({ url: `${base}/edits`, method: "POST" });
  const editId = edit.data.id;
  try {
    const res = await client.request<{ tracks?: PlayTrack[] }>({ url: `${base}/edits/${editId}/tracks` });
    return res.data.tracks ?? [];
  } finally {
    await client.request({ url: `${base}/edits/${editId}`, method: "DELETE" }).catch(() => undefined);
  }
}

/** Apple's public lookup. The `t` parameter defeats its aggressive edge
 *  cache; the response still lags a release by up to a few hours. */
export async function readAppStoreLookup(): Promise<LookupResult> {
  const url = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}&country=us&t=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`itunes lookup HTTP ${res.status}`);
  return (await res.json()) as LookupResult;
}

// ─── The sync ───────────────────────────────────────────────────────

export interface SyncResult {
  android: { latestVersionCode: number; where: string[] } | null;
  ios: { latestVersion: string; latestBuild: number | null; releaseDate: string | null } | null;
  /** Per-side reasons a value was left alone. Surfaced to the admin. */
  notes: string[];
}

export interface StoreReaders {
  play: () => Promise<PlayTrack[]>;
  appStore: () => Promise<LookupResult>;
}

const LIVE_READERS: StoreReaders = { play: readPlayTracks, appStore: readAppStoreLookup };

/**
 * Read both stores and merge into `public/appVersion`. Each side is
 * independent; a side that cannot be read is reported in `notes` and its
 * stored value is left as it was.
 *
 * **The minimums (`android.minVersionCode`, `ios.minVersion`) are never
 * touched here.** They are set only by `adminSetMinAppVersion`, and the patch
 * below is written with `{ merge: true }`, which merges nested maps field by
 * field — so `patch.android` replaces `latestVersionCode`/`where`/`checkedAt`
 * and leaves a sibling `minVersionCode` alone. An hourly pass that erased a
 * minimum would silently re-open the gate; `app-version-min.spec.ts` pins it.
 * `readers` exists for that spec — production always passes the live ones.
 */
export async function runSyncAppVersion(
  firestore: Firestore = db,
  source = "hourly",
  readers: StoreReaders = LIVE_READERS,
): Promise<SyncResult> {
  const ref = firestore.doc(DOC_PATH);
  const snap = await ref.get();
  const prev = (snap.data() ?? {}) as { iosBuilds?: Record<string, unknown>; ios?: { latestBuild?: number } };
  const notes: string[] = [];
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), lastSource: source };
  const out: SyncResult = { android: null, ios: null, notes };

  try {
    const tracks = await readers.play();
    const { versionCode, where } = pickLivePlayVersionCode(tracks);
    if (versionCode > 0) {
      out.android = { latestVersionCode: versionCode, where };
      // `productionVersionCode` is what EVERY store user can install — the
      // only number `adminSetMinAppVersion` may gate up to. Deleted (never 0)
      // when production has no completed release, so a stale value cannot
      // outlive the release it described.
      const production = completedProductionVersionCode(tracks);
      patch.android = {
        latestVersionCode: versionCode,
        where,
        productionVersionCode: production ?? FieldValue.delete(),
        checkedAt: Timestamp.now(),
      };
    } else {
      notes.push("Play: no rolled-out release on a distributing track — android left alone");
    }
  } catch (e) {
    // The first failure to expect here is the service account not (yet)
    // invited to Play Console — a 401/403 with an "insufficient permissions"
    // body. That is an owner step (DEV_ENVIRONMENT.md), not a code bug.
    notes.push(`Play: ${e instanceof Error ? e.message : String(e)} — android left alone`);
  }

  try {
    const live = pickLiveAppStoreVersion(await readers.appStore());
    if (live) {
      const build = buildForVersion(prev.iosBuilds, live.version);
      // Unknown mapping (the release script did not record it): keep the
      // previous build number rather than dropping it — an older client with
      // a stale-but-lower number stays silent, which is the safe direction.
      const latestBuild = build ?? (typeof prev.ios?.latestBuild === "number" ? prev.ios.latestBuild : null);
      if (!build) notes.push(`App Store: no build recorded for ${live.version} in iosBuilds — legacy clients keep ${latestBuild ?? "nothing"}`);
      out.ios = { latestVersion: live.version, latestBuild, releaseDate: live.releaseDate };
      patch.ios = {
        latestVersion: live.version,
        ...(latestBuild != null ? { latestBuild } : {}),
        releaseDate: live.releaseDate,
        checkedAt: Timestamp.now(),
      };
    } else {
      notes.push("App Store: lookup returned nothing for the bundle — ios left alone");
    }
  } catch (e) {
    notes.push(`App Store: ${e instanceof Error ? e.message : String(e)} — ios left alone`);
  }

  await ref.set(patch, { merge: true });
  return out;
}

// ─── Endpoints ──────────────────────────────────────────────────────

/** Admin console → "Sync store versions". Same read as the hourly pass,
 *  audited, returning what it found so the page can show it. */
export const adminSyncAppVersion = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = requireAdmin(request);
  const result = await runSyncAppVersion(db, "admin");
  await writeAuditLog({
    action: "app_version_synced",
    admin,
    details: {
      android: result.android?.latestVersionCode ?? null,
      ios: result.ios?.latestVersion ?? null,
      iosBuild: result.ios?.latestBuild ?? null,
      notes: result.notes,
    },
  });
  const snap = await db.doc(DOC_PATH).get();
  return { ...result, doc: serialize(snap.data()) };
});

/** What `/app-version.json` serves. Shape is the one the app has always
 *  read (`android.latestVersionCode`, `ios.latestBuild`) plus
 *  `ios.latestVersion`, which the 2026-09-05 client prefers, plus the two
 *  optional "update required" minimums (`android.minVersionCode`,
 *  `ios.minVersion`). An absent minimum means no gate — never 0. */
export function serialize(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  const d = data ?? {};
  const android = d.android as { latestVersionCode?: number; minVersionCode?: number } | undefined;
  const ios = d.ios as { latestVersion?: string; latestBuild?: number; minVersion?: string } | undefined;
  const out: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  if (typeof android?.latestVersionCode === "number") a.latestVersionCode = android.latestVersionCode;
  if (isPositiveInt(android?.minVersionCode)) a.minVersionCode = android!.minVersionCode;
  if (Object.keys(a).length) out.android = a;
  const i: Record<string, unknown> = {};
  if (typeof ios?.latestBuild === "number") i.latestBuild = ios.latestBuild;
  if (typeof ios?.latestVersion === "string") i.latestVersion = ios.latestVersion;
  if (typeof ios?.minVersion === "string" && versionKey(ios.minVersion) != null) i.minVersion = ios.minVersion;
  if (Object.keys(i).length) out.ios = i;
  const updatedAt = d.updatedAt as Timestamp | undefined;
  if (updatedAt?.toDate) out.updatedAt = updatedAt.toDate().toISOString();
  return out;
}

// ─── "Update required": the per-platform minimum ────────────────────
//
// An installed binary below the minimum gets a full-screen, non-dismissible
// "Update required" screen (`apps/mobile/src/lib/update-required.ts`). The
// point is operational: once a new binary is LIVE in the store, raising the
// minimum retires the older runtimes, so OTAs only have to be published to
// current ones (`apps/mobile/AGENTS.md`, "Which runtimes get an OTA").
//
// The one rule this module enforces: **a minimum may never exceed the binary
// that is LIVE in the public store**. A higher one would send every user to a
// store page that cannot give them what the gate demands — a bricked fleet.
// Android "live" is the newest COMPLETED release on the PRODUCTION track only
// (`productionVersionCode`, written by the sync — the banner's
// `latestVersionCode` also counts alpha/beta and staged rollouts, which most
// store users cannot install). Play exposes no review status, so a completed
// production release still IN REVIEW reads as live: wait for the listing to
// show it before raising the Android minimum. iOS "live" is
// the iTunes lookup's marketing version, which is the App Store by definition.

export type MinPlatform = "android" | "ios";

/** "1.2.3" → 1_002_003. Mirror of `versionKey` in
 *  `apps/mobile/src/lib/app-update.ts` — the client compares with that one,
 *  so the server must refuse anything it would not parse. */
export function versionKey(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const m = /^(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3] ?? 0);
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/**
 * The newest versionCode in a **completed** release on the PRODUCTION track —
 * what every store user can actually install. Null when there is none —
 * unknown, never 0. Pure.
 *
 * `completed` only, and this is the false-lockout guard: a staged rollout
 * (`inProgress` with a `userFraction`, which `play-production-release.mjs
 * --fraction` creates) or a `halted` release is on the production track but
 * NOT installable by most users, and the sync's `where` list does not record
 * status. Gating at a staged build would strand everyone outside the fraction
 * on a store page offering only the build they already have.
 */
export function completedProductionVersionCode(tracks: readonly PlayTrack[]): number | null {
  let best: number | null = null;
  for (const t of tracks) {
    if (t.track !== "production") continue;
    for (const r of t.releases ?? []) {
      if (r.status !== "completed") continue;
      for (const vc of r.versionCodes ?? []) {
        const n = Number(vc);
        if (Number.isInteger(n) && n > 0 && (best == null || n > best)) best = n;
      }
    }
  }
  return best;
}

/** What the store has LIVE for a platform, from the stored doc. Pure. */
export function liveStoreVersion(data: FirebaseFirestore.DocumentData | undefined, platform: MinPlatform): string | number | null {
  if (platform === "android") {
    const vc = (data?.android as { productionVersionCode?: unknown } | undefined)?.productionVersionCode;
    return isPositiveInt(vc) ? vc : null;
  }
  const v = (data?.ios as { latestVersion?: unknown } | undefined)?.latestVersion;
  return versionKey(v) != null ? (v as string) : null;
}

export type MinCheck =
  | { ok: true; value: number | string | null }
  | { ok: false; code: "invalid-argument" | "failed-precondition"; message: string };

/**
 * Decide whether `value` may become `platform`'s minimum. Pure — the callable
 * and its spec share it, and the admin page mirrors it for its warning.
 *
 *  - `null` clears the gate and is always allowed.
 *  - Android takes a positive integer versionCode; iOS a marketing version
 *    ("1.2.7") the client's `versionKey` can order.
 *  - It must not exceed the LIVE store version, and when the live version is
 *    unknown it is refused: "cannot verify" must not read as "fine".
 */
export function checkMinAppVersion(platform: unknown, value: unknown, data: FirebaseFirestore.DocumentData | undefined): MinCheck {
  if (platform !== "android" && platform !== "ios") {
    return { ok: false, code: "invalid-argument", message: "platform must be \"android\" or \"ios\"." };
  }
  if (value === null) return { ok: true, value: null };
  const live = liveStoreVersion(data, platform);
  if (platform === "android") {
    if (!isPositiveInt(value)) return { ok: false, code: "invalid-argument", message: "Android minimum must be a positive integer versionCode." };
    if (live == null) return { ok: false, code: "failed-precondition", message: "No COMPLETED (100%) release is on the Android production track, or the store sync has not run since this check was added — cannot verify the minimum. Sync store versions first." };
    if (value > (live as number)) {
      return { ok: false, code: "failed-precondition", message: `vc ${value} is above the live (completed) production build (vc ${live}). Every Android user would be told to install a build the store cannot give them.` };
    }
    return { ok: true, value };
  }
  const key = versionKey(value);
  if (key == null) return { ok: false, code: "invalid-argument", message: "iOS minimum must be a marketing version like \"1.2.7\"." };
  if (live == null) return { ok: false, code: "failed-precondition", message: "The live App Store version is unknown — cannot verify the minimum. Sync store versions first." };
  if (key > versionKey(live)!) {
    return { ok: false, code: "failed-precondition", message: `${value} is above the live App Store version (${live}). Every iOS user would be told to install a version the store cannot give them.` };
  }
  return { ok: true, value: (value as string).trim() };
}

const MIN_FIELD: Record<MinPlatform, "minVersionCode" | "minVersion"> = { android: "minVersionCode", ios: "minVersion" };

/** Admin console → System → "Update required". Sets or clears one platform's
 *  minimum, audited. The hourly sync never writes these fields. */
export const adminSetMinAppVersion = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = requireAdmin(request);
  const input = (request.data ?? {}) as { platform?: unknown; value?: unknown };
  if (input.value === undefined) {
    throw new HttpsError("invalid-argument", "value is required (null clears the minimum).");
  }
  const ref = db.doc(DOC_PATH);
  const snap = await ref.get();
  const data = snap.data();
  const check = checkMinAppVersion(input.platform, input.value, data);
  if (!check.ok) throw new HttpsError(check.code, check.message);
  const platform = input.platform as MinPlatform;
  const field = MIN_FIELD[platform];
  const previous = (data?.[platform] as Record<string, unknown> | undefined)?.[field] ?? null;
  await ref.set(
    {
      [platform]: {
        [field]: check.value === null ? FieldValue.delete() : check.value,
        minSetAt: Timestamp.now(),
      },
    },
    { merge: true },
  );
  await writeAuditLog({
    action: "app_min_version_set",
    admin,
    details: { platform, previous, value: check.value, liveStore: liveStoreVersion(data, platform) },
  });
  const after = await ref.get();
  return { doc: serialize(after.data()) };
});

/** `GET /app-version.json` via the hosting rewrite. One Firestore read per
 *  CDN miss; `firebase.json` carries the matching Cache-Control header,
 *  because a hosting header rule overrides whatever is set here. */
export const appVersionJson = onRequest({ cors: true, maxInstances: 2 }, async (_req, res) => {
  res.set("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.set("Content-Type", "application/json; charset=utf-8");
  try {
    const snap = await db.doc(DOC_PATH).get();
    res.status(200).send(JSON.stringify(serialize(snap.data())));
  } catch (e) {
    // The client treats a non-2xx as "unknown" and stays silent — correct.
    console.error("appVersionJson:", e);
    res.set("Cache-Control", "no-store");
    res.status(503).send("{}");
  }
});
