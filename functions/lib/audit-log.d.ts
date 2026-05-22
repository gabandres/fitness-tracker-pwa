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
export declare function writeAuditLog(entry: AuditLogEntry): Promise<string>;
/** Convert a Firestore Timestamp to an ISO string for client payloads. */
export declare function tsToIso(ts: unknown): string | null;
export {};
//# sourceMappingURL=audit-log.d.ts.map