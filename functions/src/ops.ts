import { Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db } from "./init";

// ─── Status heartbeat ───────────────────────────────────────────────
//
// Writes a heartbeat doc every 15 minutes so the public /status page
// can show whether the scheduler + Firestore admin write path are
// healthy. The /status page thresholds (healthy <20 min, degraded
// <45 min) are sized to this cadence. The fact that /status loads at all
// proves hosting + client fetch to Firestore work, so this signal
// covers the Cloud Functions scheduler side specifically.

export const statusPulse = onSchedule(
  { schedule: "every 15 minutes", timeZone: "UTC" },
  async () => {
    await db.doc("status/heartbeat").set({
      lastPulseAt: Timestamp.now(),
    });
  },
);

// ─── Public stats: user count for landing social proof ─────────────
//
// Tallies the `users/` collection once an hour and writes the count
// to a public `public/stats` doc. The landing page reads this and
// only renders the "join N+ quiet loggers" line when N >= 100, so
// early adopters don't see "join 3+ quiet loggers" (anti-social-proof).
// Using count() aggregation keeps the read cost a single billed unit
// regardless of collection size.
// Plain async task run by the hourly dispatcher (`hourly-tasks.ts`).
export async function runPublishUserCount(): Promise<void> {
    const snap = await db.collection("users").count().get();
    const total = snap.data().count;
    await db.doc("public/stats").set({
      totalUsers: total,
      updatedAt: Timestamp.now(),
    }, { merge: true });
}

// ─── Weekly Firestore backup ────────────────────────────────────────
//
// Scheduled export of all Firestore collections to a GCS bucket so a
// bad rules deploy or accidental mass-delete is recoverable. Lifecycle
// pruning (30-day retention) is handled GCS-side — see README operator
// checklist for the one-time bucket setup.
//
// We import the admin client lazily so the cold-start cost is paid only
// by the weekly schedule, not by every HTTP function.

const BACKUP_BUCKET = process.env.GCLOUD_PROJECT
  ? `gs://${process.env.GCLOUD_PROJECT}-backups`
  : "";

export const weeklyFirestoreBackup = onSchedule(
  { schedule: "0 6 * * 0", timeZone: "UTC" },
  async () => {
    if (!BACKUP_BUCKET) {
      console.warn("weeklyFirestoreBackup: GCLOUD_PROJECT env not set — skipping.");
      return;
    }
    // Dynamic import — @google-cloud/firestore is a transitive of
    // firebase-admin, no direct dep needed.
    //
    // This file compiles to CommonJS but `module: NodeNext` leaves the
    // `import()` as a REAL dynamic import, so Node loads the CJS package
    // through the ESM interop layer. That layer's named-export detection
    // does not surface `v1` — it only exists on `.default`. Destructuring
    // `{ v1 }` therefore yielded `undefined` and the constructor below threw
    // `Cannot read properties of undefined (reading 'FirestoreAdminClient')`
    // on every scheduled run from 2026-08-23 to 2026-09-13 (zero backups ever
    // ran). Read both shapes so either interop result works.
    const firestoreNs = await import("@google-cloud/firestore");
    const v1 = firestoreNs.v1 ??
      (firestoreNs as unknown as { default?: typeof firestoreNs }).default?.v1;
    if (!v1) {
      console.error(
        "weeklyFirestoreBackup: @google-cloud/firestore exposed no `v1` admin " +
        "client namespace — skipping. Interop shape changed.",
      );
      return;
    }
    const outputUri = `${BACKUP_BUCKET}/firestore/${new Date().toISOString().split("T")[0]}`;
    try {
      // Construct inside the try: a throw here used to reject the whole
      // scheduled run instead of being logged.
      const client = new v1.FirestoreAdminClient();
      const databaseName = client.databasePath(
        process.env.GCLOUD_PROJECT!,
        "(default)",
      );
      const [operation] = await client.exportDocuments({
        name: databaseName,
        outputUriPrefix: outputUri,
        collectionIds: [], // empty = export all
      });
      console.log(
        `weeklyFirestoreBackup: export started → ${outputUri}. operation=${operation.name}`,
      );
    } catch (err) {
      // Typical first-run failure: bucket doesn't exist yet. Log and
      // continue — this function is opt-in infrastructure.
      console.error(
        `weeklyFirestoreBackup: export failed. Ensure ${BACKUP_BUCKET} exists and ` +
        "Firebase service account has roles/datastore.importExportAdmin. Error:",
        err,
      );
    }
  },
);
