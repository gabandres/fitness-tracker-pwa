"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = writeAuditLog;
exports.tsToIso = tsToIso;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Append-only log of admin actions. Every mutating admin endpoint writes
 * one of these so the owner can audit who did what. Retention: indefinite;
 * volume is tiny for a single-admin app.
 */
async function writeAuditLog(entry) {
    const db = (0, firestore_1.getFirestore)();
    const ref = await db.collection("auditLogs").add({
        ...entry,
        timestamp: firestore_1.FieldValue.serverTimestamp(),
    });
    return ref.id;
}
/** Convert a Firestore Timestamp to an ISO string for client payloads. */
function tsToIso(ts) {
    if (ts instanceof firestore_1.Timestamp)
        return ts.toDate().toISOString();
    return null;
}
//# sourceMappingURL=audit-log.js.map