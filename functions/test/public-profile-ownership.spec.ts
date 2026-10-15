import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { freshUid, testDb } from "./helpers";
import {
  claimPublicSlug,
  mayDeleteMirror,
  onDailyWeightWriteMirrorPublicProfile,
  ownsSlug,
  publicDisplayNameOf,
  releasePublicSlug,
} from "../src/public-profile";

/**
 * Slug takeover (2026-10-15 audit). `publicSlug` on a profile is just a field;
 * until the rules closed it, a client could write ANY value there at profile
 * create. `claimPublicSlug` / `releasePublicSlug` then deleted that slug's
 * ledger entry and public page, and the mirror trigger overwrote it — someone
 * else's page. The `publicSlugs` ledger is now the only authority.
 */

// The callables only read `auth.uid` + `auth.token.email_verified` and `data`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (fn: { run: (req: any) => unknown }, uid: string, data: unknown = {}) =>
  fn.run({ auth: { uid, token: { email_verified: true } }, data, rawRequest: {} });

function slugFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 30);
}

const EPOCH = Timestamp.fromDate(new Date("2000-01-01T00:00:00Z"));

async function seedProfile(uid: string, extra: Record<string, unknown> = {}) {
  await testDb().doc(`users/${uid}`).set({
    // 2000, not now: `retention.spec` counts every profile created after its
    // fixed window start, and the emulator is shared across spec files.
    createdAt: EPOCH, lastSeenAt: EPOCH, profileCompleted: false, ...extra,
  });
}

describe("pure ownership helpers", () => {
  const snap = (exists: boolean, uid?: string) => ({ exists, data: () => (exists ? { uid } : undefined) });
  it("ownsSlug: only the uid the ledger names", () => {
    expect(ownsSlug(snap(true, "a"), "a")).toBe(true);
    expect(ownsSlug(snap(true, "a"), "b")).toBe(false);
    expect(ownsSlug(snap(false), "a")).toBe(false);
  });
  it("mayDeleteMirror: the owner, or an orphan nobody holds", () => {
    expect(mayDeleteMirror(snap(false), "b")).toBe(true);
    expect(mayDeleteMirror(snap(true, "a"), "b")).toBe(false);
  });
  it("never derives a public name from an email", () => {
    expect(publicDisplayNameOf({ email: "jane.doe@example.com" })).toBe("Ignia user");
    expect(publicDisplayNameOf({ publicDisplayName: "  Jane  " })).toBe("Jane");
  });
});

describe("claim / release honour the ledger (emulator)", () => {
  it("claiming a new slug does NOT release a slug the caller never owned", async () => {
    const db = testDb();
    const victim = freshUid("victim");
    const attacker = freshUid("attacker");
    const victimSlug = slugFor("vic");
    await seedProfile(victim);
    await call(claimPublicSlug, victim, { slug: victimSlug });
    await db.doc(`publicProfiles/${victimSlug}`).set({ slug: victimSlug, displayName: "Victim" });

    // The forged state the create rule used to allow.
    await seedProfile(attacker, { publicSlug: victimSlug, publicProfileEnabled: true });
    await call(claimPublicSlug, attacker, { slug: slugFor("att") });

    expect((await db.doc(`publicSlugs/${victimSlug}`).get()).data()?.["uid"]).toBe(victim);
    expect((await db.doc(`publicProfiles/${victimSlug}`).get()).exists).toBe(true);
  });

  it("release does NOT delete someone else's ledger entry or page", async () => {
    const db = testDb();
    const victim = freshUid("victim");
    const attacker = freshUid("attacker");
    const victimSlug = slugFor("vic");
    await seedProfile(victim);
    await call(claimPublicSlug, victim, { slug: victimSlug });
    await db.doc(`publicProfiles/${victimSlug}`).set({ slug: victimSlug, displayName: "Victim" });
    await seedProfile(attacker, { publicSlug: victimSlug, publicProfileEnabled: true });

    await call(releasePublicSlug, attacker);

    expect((await db.doc(`publicSlugs/${victimSlug}`).get()).data()?.["uid"]).toBe(victim);
    expect((await db.doc(`publicProfiles/${victimSlug}`).get()).exists).toBe(true);
    // The attacker's own profile is still cleaned up.
    expect((await db.doc(`users/${attacker}`).get()).data()?.["publicSlug"]).toBeUndefined();
  });

  it("the owner can still change and release their own slug", async () => {
    const db = testDb();
    const uid = freshUid("owner");
    const first = slugFor("one");
    const second = slugFor("two");
    await seedProfile(uid);
    await call(claimPublicSlug, uid, { slug: first });
    await db.doc(`publicProfiles/${first}`).set({ slug: first });
    await call(claimPublicSlug, uid, { slug: second });
    expect((await db.doc(`publicSlugs/${first}`).get()).exists).toBe(false);
    expect((await db.doc(`publicProfiles/${first}`).get()).exists).toBe(false);
    await call(releasePublicSlug, uid);
    expect((await db.doc(`publicSlugs/${second}`).get()).exists).toBe(false);
  });
});

describe("the mirror trigger honours the ledger and the profile (emulator)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fire = (uid: string) => (onDailyWeightWriteMirrorPublicProfile as any).run({ params: { uid, dateKey: "2026-01-01" } });

  it("does not overwrite a page whose slug the profile merely CLAIMS", async () => {
    const db = testDb();
    const victim = freshUid("victim");
    const attacker = freshUid("attacker");
    const victimSlug = slugFor("vic");
    await seedProfile(victim);
    await call(claimPublicSlug, victim, { slug: victimSlug });
    await db.doc(`publicProfiles/${victimSlug}`).set({ slug: victimSlug, displayName: "Victim" });
    await seedProfile(attacker, { publicSlug: victimSlug, publicProfileEnabled: true, publicDisplayName: "Pwned" });

    await fire(attacker);

    expect((await db.doc(`publicProfiles/${victimSlug}`).get()).data()?.["displayName"]).toBe("Victim");
  });

  it("does not re-create a page for an erased account", async () => {
    const db = testDb();
    const uid = freshUid("gone");
    const slug = slugFor("gone");
    // No profile doc: the account was erased mid-flight.
    await fire(uid);
    expect((await db.doc(`publicProfiles/${slug}`).get()).exists).toBe(false);
  });

  it("still builds the owner's page", async () => {
    const db = testDb();
    const uid = freshUid("owner");
    const slug = slugFor("own");
    await seedProfile(uid);
    await call(claimPublicSlug, uid, { slug, displayName: "Owner" });
    await fire(uid);
    expect((await db.doc(`publicProfiles/${slug}`).get()).data()?.["displayName"]).toBe("Owner");
  });
});
