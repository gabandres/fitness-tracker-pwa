import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { testDb } from "./helpers";
import {
  DOC_PATH,
  adminSetMinAppVersion,
  checkMinAppVersion,
  completedProductionVersionCode,
  runSyncAppVersion,
  serialize,
  versionKey,
} from "../src/app-version";

// The "update required" minimum. Two failures are pinned here because both
// are silent in production: an hourly sync that erases a minimum re-opens the
// gate for every retired runtime, and a minimum above the live store build
// tells every user to install something the store cannot give them.

const db = testDb();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (data: unknown, token: Record<string, unknown> = { admin: true, email: "owner@example.com" }, uid = "owner") =>
  (adminSetMinAppVersion as any).run({ auth: { uid, token }, data, rawRequest: {} });

/** A doc as the sync leaves it: production vc 50, alpha vc 51, App Store 1.2.6. */
const seeded = () => ({
  android: { latestVersionCode: 51, where: ["production vc 50", "alpha vc 51"], productionVersionCode: 50, checkedAt: Timestamp.now() },
  ios: { latestVersion: "1.2.6", latestBuild: 70, releaseDate: null, checkedAt: Timestamp.now() },
  updatedAt: Timestamp.now(),
});

describe("pure minimum rules", () => {
  it("live Android is a COMPLETED production release, never alpha", () => {
    expect(completedProductionVersionCode([
      { track: "production", releases: [{ status: "completed", versionCodes: ["50"] }] },
      { track: "alpha", releases: [{ status: "completed", versionCodes: ["51"] }] },
    ])).toBe(50);
    expect(completedProductionVersionCode([{ track: "alpha", releases: [{ status: "completed", versionCodes: ["51"] }] }])).toBeNull();
    expect(completedProductionVersionCode([])).toBeNull();
  });

  it("a staged rollout or halted release is NOT live — most users cannot install it", () => {
    const staged = [{ track: "production", releases: [
      { status: "inProgress", versionCodes: ["52"] },
      { status: "completed", versionCodes: ["50"] },
    ] }];
    expect(completedProductionVersionCode(staged)).toBe(50);
    expect(completedProductionVersionCode([{ track: "production", releases: [{ status: "halted", versionCodes: ["52"] }] }])).toBeNull();
    expect(completedProductionVersionCode([{ track: "production", releases: [{ status: "draft", versionCodes: ["52"] }] }])).toBeNull();
  });

  it("the Android check ignores `where` — a doc synced before productionVersionCode existed cannot be gated", () => {
    const legacy = { android: { latestVersionCode: 51, where: ["production vc 51"] } };
    expect(checkMinAppVersion("android", 51, legacy)).toMatchObject({ ok: false, code: "failed-precondition" });
  });

  it("versionKey matches the client's parser", () => {
    expect(versionKey("1.2.7")).toBe(1_002_007);
    expect(versionKey("1.2")).toBe(1_002_000);
    expect(versionKey("1.2.7-beta")).toBeNull();
    expect(versionKey(127)).toBeNull();
  });

  it("refuses a minimum above the live store version", () => {
    const d = seeded();
    expect(checkMinAppVersion("android", 51, d)).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(checkMinAppVersion("android", 50, d)).toEqual({ ok: true, value: 50 });
    expect(checkMinAppVersion("ios", "1.2.7", d)).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(checkMinAppVersion("ios", "1.2.6", d)).toEqual({ ok: true, value: "1.2.6" });
  });

  it("refuses when the live version is unknown — cannot verify is not fine", () => {
    expect(checkMinAppVersion("android", 40, {})).toMatchObject({ ok: false, code: "failed-precondition" });
    expect(checkMinAppVersion("ios", "1.0.0", {})).toMatchObject({ ok: false, code: "failed-precondition" });
  });

  it("always allows clearing, and rejects junk", () => {
    expect(checkMinAppVersion("android", null, {})).toEqual({ ok: true, value: null });
    expect(checkMinAppVersion("android", "50", seeded())).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(checkMinAppVersion("android", 0, seeded())).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(checkMinAppVersion("ios", "build 70", seeded())).toMatchObject({ ok: false, code: "invalid-argument" });
    expect(checkMinAppVersion("web", 1, seeded())).toMatchObject({ ok: false, code: "invalid-argument" });
  });

  it("serves the minimums, and only valid ones", () => {
    expect(serialize({ android: { latestVersionCode: 51, minVersionCode: 50 }, ios: { latestVersion: "1.2.6", minVersion: "1.2.5" } }))
      .toEqual({ android: { latestVersionCode: 51, minVersionCode: 50 }, ios: { latestVersion: "1.2.6", minVersion: "1.2.5" } });
    // A minimum alone still reaches the client.
    expect(serialize({ android: { minVersionCode: 50 } })).toEqual({ android: { minVersionCode: 50 } });
    expect(serialize({ android: { minVersionCode: 0 }, ios: { minVersion: "x" } })).toEqual({});
  });
});

describe("adminSetMinAppVersion (emulator)", () => {
  beforeEach(async () => {
    await db.doc(DOC_PATH).set(seeded());
  });

  it("rejects a signed-out caller and a non-admin", async () => {
    await expect((adminSetMinAppVersion as any).run({ auth: null, data: { platform: "android", value: 50 }, rawRequest: {} }))
      .rejects.toMatchObject({ code: "unauthenticated" });
    await expect(call({ platform: "android", value: 50 }, { email: "someone@example.com" }, "u1"))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect((await db.doc(DOC_PATH).get()).data()?.android?.minVersionCode).toBeUndefined();
  });

  it("sets, audits and serves a minimum at the live build", async () => {
    const r = await call({ platform: "android", value: 50 });
    expect(r.doc.android).toEqual({ latestVersionCode: 51, minVersionCode: 50 });
    const stored = (await db.doc(DOC_PATH).get()).data()!;
    expect(stored.android.minVersionCode).toBe(50);
    // The sync's own fields survive the admin write.
    expect(stored.android.where).toEqual(["production vc 50", "alpha vc 51"]);

    const audit = await db.collection("auditLogs").where("action", "==", "app_min_version_set").get();
    const mine = audit.docs.map((d) => d.data()).find((d) => d.details?.platform === "android" && d.details?.value === 50);
    expect(mine).toMatchObject({ adminUid: "owner", adminEmail: "owner@example.com", details: { previous: null, liveStore: 50 } });
  });

  it("refuses a minimum above the live store build and writes nothing", async () => {
    await expect(call({ platform: "android", value: 51 })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(call({ platform: "ios", value: "1.2.7" })).rejects.toMatchObject({ code: "failed-precondition" });
    const stored = (await db.doc(DOC_PATH).get()).data()!;
    expect(stored.android.minVersionCode).toBeUndefined();
    expect(stored.ios.minVersion).toBeUndefined();
  });

  it("null clears the gate", async () => {
    await call({ platform: "ios", value: "1.2.6" });
    expect((await db.doc(DOC_PATH).get()).data()!.ios.minVersion).toBe("1.2.6");
    const r = await call({ platform: "ios", value: null });
    expect(r.doc.ios).toEqual({ latestVersion: "1.2.6", latestBuild: 70 });
    expect((await db.doc(DOC_PATH).get()).data()!.ios.minVersion).toBeUndefined();
  });

  it("requires a value key — a missing one is not a silent clear", async () => {
    await call({ platform: "android", value: 50 });
    await expect(call({ platform: "android" })).rejects.toMatchObject({ code: "invalid-argument" });
    expect((await db.doc(DOC_PATH).get()).data()!.android.minVersionCode).toBe(50);
  });
});

describe("the hourly sync preserves the minimums", () => {
  it("rewrites latest* on both sides and leaves minVersionCode / minVersion alone", async () => {
    await db.doc(DOC_PATH).set({ ...seeded(), iosBuilds: { "1.2.7": 71 } });
    await call({ platform: "android", value: 48 });
    await call({ platform: "ios", value: "1.2.5" });

    const result = await runSyncAppVersion(db, "test", {
      play: async () => [{ track: "production", releases: [{ status: "completed", versionCodes: ["51"] }] }],
      appStore: async () => ({ resultCount: 1, results: [{ bundleId: "fit.ignia.app", version: "1.2.7" }] }),
    });
    expect(result.android?.latestVersionCode).toBe(51);
    expect(result.ios?.latestVersion).toBe("1.2.7");

    const stored = (await db.doc(DOC_PATH).get()).data()!;
    expect(stored.android).toMatchObject({ latestVersionCode: 51, minVersionCode: 48, where: ["production vc 51"], productionVersionCode: 51 });
    expect(stored.ios).toMatchObject({ latestVersion: "1.2.7", latestBuild: 71, minVersion: "1.2.5" });
    expect(serialize(stored)).toMatchObject({
      android: { latestVersionCode: 51, minVersionCode: 48 },
      ios: { latestVersion: "1.2.7", latestBuild: 71, minVersion: "1.2.5" },
    });
  });

  it("a failed store read also leaves the minimums alone", async () => {
    await db.doc(DOC_PATH).set(seeded());
    await call({ platform: "android", value: 50 });
    const result = await runSyncAppVersion(db, "test", {
      play: async () => { throw new Error("403"); },
      appStore: async () => { throw new Error("timeout"); },
    });
    expect(result.notes).toHaveLength(2);
    expect((await db.doc(DOC_PATH).get()).data()!.android.minVersionCode).toBe(50);
  });
});

describe("the sync records only a COMPLETED production build as gateable", () => {
  it("a staged rollout moves latestVersionCode but not productionVersionCode, so the minimum cannot follow it", async () => {
    await db.doc(DOC_PATH).set(seeded());
    await runSyncAppVersion(db, "test", {
      play: async () => [{ track: "production", releases: [
        { status: "inProgress", versionCodes: ["52"] },
        { status: "completed", versionCodes: ["50"] },
      ] }],
      appStore: async () => ({ resultCount: 0, results: [] }),
    });
    const stored = (await db.doc(DOC_PATH).get()).data()!;
    expect(stored.android).toMatchObject({ latestVersionCode: 52, productionVersionCode: 50 });
    await expect(call({ platform: "android", value: 52 })).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(call({ platform: "android", value: 50 })).resolves.toBeDefined();
  });

  it("production with no completed release clears productionVersionCode instead of keeping a stale one", async () => {
    await db.doc(DOC_PATH).set(seeded());
    await runSyncAppVersion(db, "test", {
      play: async () => [{ track: "production", releases: [{ status: "halted", versionCodes: ["50"] }] }],
      appStore: async () => ({ resultCount: 0, results: [] }),
    });
    expect((await db.doc(DOC_PATH).get()).data()!.android.productionVersionCode).toBeUndefined();
    await expect(call({ platform: "android", value: 50 })).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
