import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { freshUid, testDb } from "./helpers";
import {
  DELETE_BATCH_SIZE,
  deleteRefsInChunks,
  UID_KEYED_RATE_LIMITS,
  uidKeyedRateLimitDocs,
} from "../src/gdpr";
import { DailyQuota } from "../src/daily-quota";

const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/gdpr.ts"), "utf8");
const ALL_SRC = ["caller-access.ts", "food-search.ts", "analyze-photo.ts", "consultation.ts", "gdpr.ts", "verify-email.ts"]
  .map((f) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../src/${f}`), "utf8"))
  .join("\n");

describe("account erasure survives big accounts (emulator)", () => {
  it("deletes more than one batch's worth of docs — the 500-write cap", async () => {
    const db = testDb();
    const prefix = freshUid("chunk");
    const refs = Array.from({ length: 2 * DELETE_BATCH_SIZE + 17 }, (_, i) =>
      db.collection("usageEvents").doc(`${prefix}_${i}`));
    for (let i = 0; i < refs.length; i += 400) {
      const b = db.batch();
      refs.slice(i, i + 400).forEach((r) => b.set(r, { uid: prefix }));
      await b.commit();
    }
    const batches = await deleteRefsInChunks(db, refs);
    expect(batches).toBe(3);
    const left = await db.collection("usageEvents").where("uid", "==", prefix).count().get();
    expect(left.data().count).toBe(0);
  });

  it("DailyQuota.deleteAll clears 500+ quota docs without a batch overflow", async () => {
    const db = testDb();
    const uid = freshUid("q");
    for (let i = 0; i < 520; i += 260) {
      const b = db.batch();
      for (let j = i; j < i + 260; j++) {
        b.set(db.collection("photoQuota").doc(`${uid}_d${j}`), { uid, count: 1 });
      }
      await b.commit();
    }
    await new DailyQuota(db).deleteAll(uid);
    const left = await db.collection("photoQuota").where("uid", "==", uid).count().get();
    expect(left.data().count).toBe(0);
  });
});

describe("uid-keyed rate-limit docs are erased", () => {
  it("lists every per-uid limiter collection the code writes", () => {
    for (const name of [
      "photoRateLimit", "consultationRateLimit", "exportRateLimit",
      "accessStatusRateLimit", "foodSearchRateLimit", "foodDetailRateLimit",
    ]) {
      expect(UID_KEYED_RATE_LIMITS).toContain(name);
      expect(ALL_SRC).toContain(`"${name}"`);
    }
    expect(uidKeyedRateLimitDocs("abc")).toEqual(["emailRateLimits/verify_uid_abc"]);
  });

  it("removes deleteRateLimit last, after the Auth user", () => {
    const authDel = SRC.indexOf("await getAuth().deleteUser(uid)");
    const rlDel = SRC.indexOf('db.collection("deleteRateLimit").doc(uid).delete()');
    expect(authDel).toBeGreaterThan(0);
    expect(rlDel).toBeGreaterThan(authDel);
  });

  it("disables the public page before deleting, and sweeps the mirror after the profile", () => {
    const disable = SRC.indexOf("publicProfileEnabled: false");
    const subDelete = SRC.indexOf("USER_SUBCOLLECTIONS.map((name) => deleteSubcollection(userPath, name))");
    const profileDelete = SRC.indexOf("await db.doc(userPath).delete()");
    const sweep = SRC.indexOf("tx.delete(db.doc(`publicProfiles/${slug}`))");
    expect(disable).toBeGreaterThan(0);
    expect(disable).toBeLessThan(subDelete);
    expect(sweep).toBeGreaterThan(profileDelete);
  });
});
