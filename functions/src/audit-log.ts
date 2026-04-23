import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

interface AuditLogEntry {
  action: string;
  adminUid: string;
  adminEmail: string;
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
  const db = getFirestore();
  const ref = await db.collection("auditLogs").add({
    ...entry,
    timestamp: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/** Convert a Firestore Timestamp to an ISO string for client payloads. */
export function tsToIso(ts: unknown): string | null {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  return null;
}
