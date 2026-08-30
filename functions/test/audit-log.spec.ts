import { describe, expect, it, beforeAll } from "vitest";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { writeAuditLog, tsToIso } from "../src/audit-log";

/**
 * The audit log's write → read contract, against the Firestore emulator.
 *
 * `writeAuditLog` stamps `timestamp` with `FieldValue.serverTimestamp()`;
 * `getAuditLogs` orders by that field and converts it with `tsToIso`. The
 * two only agree if the server stamp round-trips as a `Timestamp` — this
 * pins that, plus ordering, plus the admin stamp coming from the caller and
 * never from the call site.
 */
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set — run via `npm test` (firebase emulators:exec), never against production.");
}

describe("audit log", () => {
  beforeAll(() => {
    if (!getApps().length) initializeApp({ projectId: "demo-audit-log" });
  });

  it("writes a server-stamped entry that reads back through the panel's query", async () => {
    const db = getFirestore();
    const admin = { uid: "admin-uid", email: "owner@example.com" };
    const first = await writeAuditLog({ action: "plan_override", admin, targetUid: "u1", targetEmail: "u1@example.com", details: { role: "paid" } });
    await new Promise((r) => setTimeout(r, 20)); // distinct server timestamps
    const second = await writeAuditLog({ action: "quota_reset", admin, targetUid: "u2" });

    // The exact query getAuditLogs runs (no filter): newest first.
    const snap = await db.collection("auditLogs").orderBy("timestamp", "desc").limit(10).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data(), timestamp: tsToIso(d.data()["timestamp"]) }));

    expect(rows.map((r) => r.id).slice(0, 2)).toEqual([second, first]);
    expect(rows[1]).toMatchObject({ action: "plan_override", adminUid: "admin-uid", adminEmail: "owner@example.com", targetUid: "u1", details: { role: "paid" } });
    // The stamp is a real Timestamp on read, and tsToIso renders it — a null
    // here is what an un-materialised serverTimestamp would look like.
    expect(snap.docs[0].data()["timestamp"]).toBeInstanceOf(Timestamp);
    expect(rows[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The caller supplies the admin stamp; nothing else can.
    expect(Object.keys(rows[0])).not.toContain("admin");
  });

  it("tsToIso refuses anything that is not a Timestamp", () => {
    expect(tsToIso(undefined)).toBeNull();
    expect(tsToIso("2026-08-30")).toBeNull();
    expect(tsToIso(Timestamp.fromMillis(0))).toBe("1970-01-01T00:00:00.000Z");
  });
});
