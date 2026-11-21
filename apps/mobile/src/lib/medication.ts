/**
 * The medication log on THIS phone (core `medication.ts` defines the shape and
 * the schedule math; this is storage and the one place the log is held).
 *
 * ## It never leaves the device
 *
 * No Firestore collection, no health-store export, no analytics property.
 * What someone takes is the most sensitive thing this app could hold, and the
 * way to be sure it cannot leak from a server is not to send it. The price is
 * stated on the screen: it does not follow the account to another phone, and
 * an explicit sign-out removes it — the same rule every other device store
 * here follows (`signOutLocal`), because a signed-out phone may be a shared or
 * sold one. `Share log` on the screen is how a copy leaves, by the person's
 * own hand.
 *
 * ## One holder, many readers
 *
 * Today's card and the Medication screen both show it, so the log is held
 * once per uid here and readers subscribe (`useMedicationLog`). Not a shared
 * Firestore subscription (ADR-0016 is about listeners; this opens none).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import {
  EMPTY_MEDICATION_LOG,
  type Medication,
  type MedicationDose,
  type MedicationLog,
  sanitizeMedicationLog,
  withDose,
  withMedication,
  withoutDose,
  withoutMedication,
} from '@macrolog/core';
import type { TFn } from '@/i18n';
import { clearMedicationReminders, setMedicationReminders } from '@/lib/medication-reminders';

const KEY_PREFIX = 'ignia.medication.v1.';
const keyFor = (uid: string) => `${KEY_PREFIX}${uid}`;

let held: { uid: string; log: MedicationLog } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Read this account's log from the phone. Never throws: unreadable storage
 *  is an empty log, and the next save rewrites it. */
export async function readMedicationLog(uid: string): Promise<MedicationLog> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    return raw ? sanitizeMedicationLog(JSON.parse(raw)) : EMPTY_MEDICATION_LOG;
  } catch {
    return EMPTY_MEDICATION_LOG;
  }
}

/**
 * Store a new log for this account, tell every reader, and re-plan the
 * dose-day reminders. Rejects when the phone refuses the write, so a screen
 * never shows a dose as logged that is not on disk.
 */
export async function writeMedicationLog(uid: string, log: MedicationLog, t: TFn): Promise<MedicationLog> {
  const clean = sanitizeMedicationLog(log);
  await AsyncStorage.setItem(keyFor(uid), JSON.stringify(clean));
  held = { uid, log: clean };
  emit();
  void setMedicationReminders(clean, t);
  return clean;
}

/** Remove every stored medication log and cancel the reminders — explicit
 *  sign-out and account deletion. Never throws. */
export async function clearMedicationLogs(): Promise<void> {
  held = null;
  emit();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(KEY_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Storage unavailable: nothing more this can do, and sign-out must go on.
  }
  await clearMedicationReminders();
}

/** Test seam: forget what this runtime holds. */
export function __resetMedicationStore(): void {
  held = null;
  listeners.clear();
}

export interface MedicationStore {
  log: MedicationLog;
  /** False until the phone has answered for this account. */
  ready: boolean;
  saveMedication(med: Medication): Promise<boolean>;
  removeMedication(id: string): Promise<boolean>;
  logDose(dose: MedicationDose): Promise<boolean>;
  removeDose(id: string): Promise<boolean>;
}

/**
 * This account's medication log, live. Every edit answers `true` when it is
 * on disk and `false` when the phone refused it.
 */
export function useMedicationLog(uid: string | undefined, t: TFn): MedicationStore {
  const [snapshot, setSnapshot] = useState<{ uid: string; log: MedicationLog } | null>(() => (held && held.uid === uid ? held : null));

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const sync = () => {
      if (alive) setSnapshot(held && held.uid === uid ? held : null);
    };
    listeners.add(sync);
    if (held?.uid === uid) {
      // Already loaded by another reader: adopt it after this effect, not in it.
      void Promise.resolve().then(sync);
    } else {
      void readMedicationLog(uid).then((log) => {
        if (!alive) return;
        // A write may have landed while the read was out; it is newer.
        if (held?.uid !== uid) held = { uid, log };
        emit();
        // The reminders the OS holds may predate a reinstall or a cancel-all.
        void setMedicationReminders(held.log, t);
      });
    }
    return () => {
      alive = false;
      listeners.delete(sync);
    };
  }, [uid, t]);

  const apply = useCallback(
    async (change: (log: MedicationLog) => MedicationLog): Promise<boolean> => {
      if (!uid) return false;
      const base = held?.uid === uid ? held.log : await readMedicationLog(uid);
      return writeMedicationLog(uid, change(base), t).then(
        () => true,
        () => false,
      );
    },
    [uid, t],
  );

  const saveMedication = useCallback((med: Medication) => apply((log) => withMedication(log, med)), [apply]);
  const removeMedication = useCallback((id: string) => apply((log) => withoutMedication(log, id)), [apply]);
  const logDose = useCallback((dose: MedicationDose) => apply((log) => withDose(log, dose)), [apply]);
  const removeDose = useCallback((id: string) => apply((log) => withoutDose(log, id)), [apply]);

  const mine = snapshot && snapshot.uid === uid ? snapshot : null;
  return {
    log: mine?.log ?? EMPTY_MEDICATION_LOG,
    ready: mine != null,
    saveMedication,
    removeMedication,
    logDose,
    removeDose,
  };
}
