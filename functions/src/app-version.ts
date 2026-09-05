import { onCall, onRequest } from "firebase-functions/v2/https";
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

/**
 * Read both stores and merge into `public/appVersion`. Each side is
 * independent; a side that cannot be read is reported in `notes` and its
 * stored value is left as it was.
 */
export async function runSyncAppVersion(firestore: Firestore = db, source = "hourly"): Promise<SyncResult> {
  const ref = firestore.doc(DOC_PATH);
  const snap = await ref.get();
  const prev = (snap.data() ?? {}) as { iosBuilds?: Record<string, unknown>; ios?: { latestBuild?: number } };
  const notes: string[] = [];
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), lastSource: source };
  const out: SyncResult = { android: null, ios: null, notes };

  try {
    const { versionCode, where } = pickLivePlayVersionCode(await readPlayTracks());
    if (versionCode > 0) {
      out.android = { latestVersionCode: versionCode, where };
      patch.android = { latestVersionCode: versionCode, where, checkedAt: Timestamp.now() };
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
    const live = pickLiveAppStoreVersion(await readAppStoreLookup());
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
 *  `ios.latestVersion`, which the 2026-09-05 client prefers. */
export function serialize(data: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> {
  const d = data ?? {};
  const android = d.android as { latestVersionCode?: number } | undefined;
  const ios = d.ios as { latestVersion?: string; latestBuild?: number } | undefined;
  const out: Record<string, unknown> = {};
  if (typeof android?.latestVersionCode === "number") out.android = { latestVersionCode: android.latestVersionCode };
  if (ios && (typeof ios.latestVersion === "string" || typeof ios.latestBuild === "number")) {
    out.ios = {
      ...(typeof ios.latestBuild === "number" ? { latestBuild: ios.latestBuild } : {}),
      ...(typeof ios.latestVersion === "string" ? { latestVersion: ios.latestVersion } : {}),
    };
  }
  const updatedAt = d.updatedAt as Timestamp | undefined;
  if (updatedAt?.toDate) out.updatedAt = updatedAt.toDate().toISOString();
  return out;
}

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
