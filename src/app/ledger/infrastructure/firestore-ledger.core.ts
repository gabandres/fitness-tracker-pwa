import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import type {
  DailyLog,
  DailyLogDoc,
  LogEntry,
  UserProfileDoc,
} from '../../services/firebase.service';

/**
 * Framework-free Firestore I/O core for the ledger adapter (issue #6
 * phase 3). `new`-able without Angular DI — the constructor takes a raw
 * `Firestore` handle and a uid thunk — so the SAME class runs in prod
 * (behind `FirebaseService`, which keeps the signals + auth wiring) and
 * under the Firestore emulator in `npm run test:ledger`.
 *
 * Imports come from `firebase/firestore`, never `@angular/fire/*`, so
 * the emulator suite can construct it in a plain node process.
 *
 * Current slice: profile-doc primitives + the four dailyLog verbs.
 * Remaining FirebaseService surfaces (presets, weights/water,
 * measurements, workout) migrate verb-by-verb in later slices.
 */
export class FirestoreLedgerCore {
  constructor(
    private readonly firestore: Firestore,
    private readonly uid: () => string,
  ) {}

  private userDoc() {
    return doc(this.firestore, 'users', this.uid());
  }

  private logsCollection() {
    return collection(this.firestore, 'users', this.uid(), 'dailyLogs');
  }

  /** Hard ceiling per Firestore call. The Firestore SDK retries 504s
   *  internally without ever rejecting → app-shell loader hangs forever.
   *  Surfacing a timeout lets the caller put up a retry UI. */
  private withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); },
             (e) => { clearTimeout(t); reject(e); });
    });
  }

  // ─── Profile doc primitives ────────────────────────────────────

  /** Read the stored profile doc, or null when none exists yet. */
  async readProfileDoc(): Promise<UserProfileDoc | null> {
    const snap = await this.withTimeout(getDoc(this.userDoc()), 15_000, 'profile-read');
    return snap.exists() ? (snap.data() as UserProfileDoc) : null;
  }

  /** Create the profile doc (first sign-in). */
  async createProfileDoc(initial: UserProfileDoc): Promise<void> {
    await this.withTimeout(setDoc(this.userDoc(), initial), 15_000, 'profile-create');
  }

  /** Apply a partial update to the profile doc. The patch carries
   *  Firestore types (`Timestamp`, `deleteField()` sentinels) — the
   *  caller maps to domain `Date` for its optimistic signal via
   *  `toDomainProfilePatch`. */
  async updateProfileDoc(patch: Partial<UserProfileDoc> | Record<string, unknown>): Promise<void> {
    await updateDoc(this.userDoc(), patch as Record<string, unknown>);
  }

  // ─── Daily logs ────────────────────────────────────────────────

  async addLog(entry: LogEntry): Promise<void> {
    const data: Record<string, unknown> = {
      calories: entry.calories,
      timestamp: Timestamp.fromDate(entry.timestamp ?? new Date()),
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.protein != null) data['protein'] = entry.protein;
    if (entry.exerciseCompleted) data['exerciseCompleted'] = true;
    if (entry.mealLabel) data['mealLabel'] = entry.mealLabel;
    await addDoc(this.logsCollection(), data);
  }

  /** Latest `count` rows, returned OLDEST-FIRST (the underlying query is
   *  desc-ordered; the seam contract reverses — see CONTEXT.md
   *  "Log array order"). Timestamp → Date happens here. */
  async getRecentLogs(count = 14): Promise<DailyLog[]> {
    const q = query(this.logsCollection(), orderBy('timestamp', 'desc'), limit(count));
    const snap = await getDocs(q);
    const results: DailyLog[] = snap.docs.map((d) => {
      const data = d.data() as DailyLogDoc;
      return {
        id: d.id,
        weight: data.weight,
        calories: data.calories,
        date: data.timestamp.toDate(),
        protein: data.protein,
        exerciseCompleted: data.exerciseCompleted,
        liftCompleted: data.liftCompleted,
        cardioCompleted: data.cardioCompleted,
        mealLabel: data.mealLabel,
      };
    });
    return results.reverse();
  }

  async updateLog(logId: string, entry: LogEntry): Promise<void> {
    const ref = doc(this.firestore, 'users', this.uid(), 'dailyLogs', logId);
    const data: Record<string, unknown> = {
      calories: entry.calories,
      protein: entry.protein != null ? entry.protein : deleteField(),
      exerciseCompleted: entry.exerciseCompleted ? true : deleteField(),
      // Migrate away from legacy fields on every edit.
      liftCompleted: deleteField(),
      cardioCompleted: deleteField(),
      mealLabel: entry.mealLabel ? entry.mealLabel : deleteField(),
    };
    if (entry.weight != null) data['weight'] = entry.weight;
    if (entry.timestamp != null) data['timestamp'] = Timestamp.fromDate(entry.timestamp);
    await updateDoc(ref, data);
  }

  async deleteLog(logId: string): Promise<void> {
    const ref = doc(this.firestore, 'users', this.uid(), 'dailyLogs', logId);
    await deleteDoc(ref);
  }
}
