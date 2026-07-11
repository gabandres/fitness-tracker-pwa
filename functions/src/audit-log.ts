import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { AdminCaller } from "./admin-guard";

interface AuditLogEntry {
  action: string;
  /** The admin who performed the action — supplied by `requireAdmin`, so
      the `{ adminUid, adminEmail }` stamp is never hand-written at a site. */
  admin: AdminCaller;
  targetUid?: string;
  targetEmail?: string;
  details?: Record<string, unknown>;
}

/**
 * Append-only log of admin actions. Every mutating admin endpoint writes
 * one of these so the owner can audit who did what. Retention: indefinite;
 * volume is tiny for a single-admin app.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<string> {
  const { admin, ...rest } = entry;
  const db = getFirestore();
  const ref = await db.collection("auditLogs").add({
    ...rest,
    adminUid: admin.uid,
    adminEmail: admin.email,
    timestamp: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/** Convert a Firestore Timestamp to an ISO string for client payloads. */
export function tsToIso(ts: unknown): string | null {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  return null;
}
