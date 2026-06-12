import { getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";

/**
 * Admin-SDK Firestore bound to the emulator. `firebase emulators:exec`
 * sets FIRESTORE_EMULATOR_HOST; the guard makes a bare `vitest run`
 * fail loudly instead of touching production.
 */
export function testDb(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set — run via `npm test` " +
      "(firebase emulators:exec), never against production.",
    );
  }
  if (!getApps().length) {
    initializeApp({ projectId: "demo-macrolog-functions-test" });
  }
  return getFirestore();
}

let uidCounter = 0;

/** Fresh uid per test so tests never share quota/rate-limit docs. */
export function freshUid(prefix = "u"): string {
  return `${prefix}-${Date.now()}-${uidCounter++}`;
}
