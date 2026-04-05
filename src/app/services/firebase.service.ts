import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  getDoc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

/** Document as persisted in Firestore. */
export interface DailyLogDoc {
  weight: number;
  calories: number;
  timestamp: Timestamp;
}

/** Shape the rest of the app works with — plain Date instead of Timestamp. */
export interface DailyLog {
  id?: string;
  weight: number;
  calories: number;
  date: Date;
}

/**
 * All Firestore I/O is scoped to the currently signed-in user's
 * UID subtree at `users/{uid}/dailyLogs`. Methods throw if called
 * while unauthenticated — the UI is responsible for only rendering
 * components that use this service while a user is signed in.
 */
@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('FirebaseService called while unauthenticated.');
    }
    return uid;
  }

  private logsCollection() {
    const uid = this.requireUid();
    return collection(this.firestore, 'users', uid, 'dailyLogs');
  }

  private userDoc() {
    const uid = this.requireUid();
    return doc(this.firestore, 'users', uid);
  }

  /**
   * Idempotent profile upsert. Call on every sign-in:
   *   - First time: creates the users/{uid} doc with email + createdAt + lastSeenAt
   *   - Subsequent times: bumps lastSeenAt, leaves createdAt intact
   *
   * Uses two separate paths because Firestore rules validate the
   * schema strictly (exactly the keys we allow) on both create and
   * update, so we can't pass an optional createdAt on update.
   */
  async ensureUserProfile(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ensureUserProfile called while unauthenticated.');

    const ref = this.userDoc();
    const snap = await getDoc(ref);
    const now = Timestamp.now();

    if (!snap.exists()) {
      await setDoc(ref, {
        email: user.email ?? '',
        createdAt: now,
        lastSeenAt: now,
      });
    } else {
      // Update path — preserve the existing createdAt by re-writing it
      // alongside the bumped lastSeenAt so rules see the full schema.
      const existing = snap.data() as { createdAt: Timestamp; email: string };
      await setDoc(ref, {
        email: user.email ?? existing.email,
        createdAt: existing.createdAt,
        lastSeenAt: now,
      });
    }
  }

  /** Write a new log entry for the current user. */
  async addLog(weight: number, calories: number): Promise<void> {
    await addDoc(this.logsCollection(), {
      weight,
      calories,
      timestamp: Timestamp.fromDate(new Date()),
    });
  }

  /**
   * Fetch the most recent N logs, newest-first from Firestore, then
   * reversed to oldest-first for the calculator. Default N = 14.
   */
  async getRecentLogs(days = 14): Promise<DailyLog[]> {
    const q = query(this.logsCollection(), orderBy('timestamp', 'desc'), limit(days));
    const snap = await getDocs(q);
    const results: DailyLog[] = snap.docs.map((d) => {
      const data = d.data() as DailyLogDoc;
      return {
        id: d.id,
        weight: data.weight,
        calories: data.calories,
        date: data.timestamp.toDate(),
      };
    });
    return results.reverse();
  }
}
