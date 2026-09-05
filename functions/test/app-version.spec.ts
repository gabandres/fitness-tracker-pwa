import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  buildForVersion,
  pickLiveAppStoreVersion,
  pickLivePlayVersionCode,
  serialize,
} from "../src/app-version";

// The pure halves of the store-version sync. The two "never point the banner
// at a build nobody can install" rules are pinned here because both were
// learned the expensive way (scripts/app-version-sync.mjs has the history).

describe("pickLivePlayVersionCode", () => {
  it("takes the newest rolled-out code across distributing tracks", () => {
    const r = pickLivePlayVersionCode([
      { track: "production", releases: [{ status: "completed", versionCodes: ["44"] }] },
      { track: "alpha", releases: [{ status: "completed", versionCodes: ["44"] }] },
    ]);
    expect(r.versionCode).toBe(44);
    expect(r.where).toEqual(["production vc 44", "alpha vc 44"]);
  });

  it("ignores drafts — uploaded is not distributed", () => {
    const r = pickLivePlayVersionCode([
      { track: "production", releases: [{ status: "draft", versionCodes: ["45"] }, { status: "completed", versionCodes: ["44"] }] },
    ]);
    expect(r.versionCode).toBe(44);
  });

  it("ignores the internal track — it is a mechanism, not a channel", () => {
    // vc 39 went to internal with no testers to make Play re-scan a bundle;
    // telling 15 alpha testers on vc 37 that 39 existed would have sent them
    // to a store page with nothing to install.
    const r = pickLivePlayVersionCode([
      { track: "internal", releases: [{ status: "completed", versionCodes: ["39"] }] },
      { track: "alpha", releases: [{ status: "completed", versionCodes: ["37"] }] },
    ]);
    expect(r.versionCode).toBe(37);
  });

  it("returns 0 when nothing is rolled out, never a guess", () => {
    expect(pickLivePlayVersionCode([]).versionCode).toBe(0);
    expect(pickLivePlayVersionCode([{ track: "production", releases: [] }]).versionCode).toBe(0);
  });
});

describe("pickLiveAppStoreVersion", () => {
  it("reads the version for our bundle id only", () => {
    const r = pickLiveAppStoreVersion({
      resultCount: 2,
      results: [
        { bundleId: "com.other.app", version: "9.9.9" },
        { bundleId: "fit.ignia.app", version: "1.2.2", currentVersionReleaseDate: "2026-09-04T18:00:00Z" },
      ],
    });
    expect(r).toEqual({ version: "1.2.2", releaseDate: "2026-09-04T18:00:00Z" });
  });

  it("is null on an empty lookup", () => {
    expect(pickLiveAppStoreVersion({ resultCount: 0, results: [] })).toBeNull();
    expect(pickLiveAppStoreVersion({})).toBeNull();
  });
});

describe("buildForVersion", () => {
  it("maps a recorded version to its build and refuses junk", () => {
    const m = { "1.2.2": 63, "1.2.3": "64", bad: "x" };
    expect(buildForVersion(m, "1.2.2")).toBe(63);
    expect(buildForVersion(m, "1.2.3")).toBe(64);
    expect(buildForVersion(m, "bad")).toBeNull();
    expect(buildForVersion(m, "1.2.4")).toBeNull();
    expect(buildForVersion(undefined, "1.2.2")).toBeNull();
  });
});

describe("serialize", () => {
  it("emits the shape the app has always read, plus latestVersion", () => {
    const out = serialize({
      android: { latestVersionCode: 44, where: ["production vc 44"], checkedAt: Timestamp.now() },
      ios: { latestVersion: "1.2.2", latestBuild: 63, releaseDate: null, checkedAt: Timestamp.now() },
      iosBuilds: { "1.2.2": 63 },
      updatedAt: Timestamp.fromMillis(Date.UTC(2026, 8, 5, 20, 0, 0)),
      lastSource: "admin",
    });
    expect(out).toEqual({
      android: { latestVersionCode: 44 },
      ios: { latestBuild: 63, latestVersion: "1.2.2" },
      updatedAt: "2026-09-05T20:00:00.000Z",
    });
  });

  it("omits a side it does not know rather than writing 0", () => {
    // 0 disables the prompt on that platform; an absent key reads as unknown
    // and the client stays silent — the honest answer.
    expect(serialize(undefined)).toEqual({});
    expect(serialize({ ios: { latestVersion: "1.2.2" } })).toEqual({ ios: { latestVersion: "1.2.2" } });
    expect(serialize({ ios: { releaseDate: null } })).toEqual({});
  });
});
