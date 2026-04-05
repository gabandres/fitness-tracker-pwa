import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  Timestamp,
} from '@angular/fire/firestore';

/**
 * Shape persisted to Firestore. `timestamp` is a Firestore Timestamp
 * so we can rely on server-side sorting and range queries.
 */
export interface DailyLogDoc {
  weight: number;
  calories: number;
  timestamp: Timestamp;
}

/**
 * Shape the rest of the app works with — a plain JS Date is easier
 * for the TDEE math engine and the UI.
 */
export interface DailyLog {
  id?: string;
  weight: number;
  calories: number;
  date: Date;
}

@Injectable({ providedIn: 'root' })
export class FirebaseService {
  private readonly firestore = inject(Firestore);
  private readonly collectionName = 'dailyLogs';

  /** Write a new log entry stamped with the current instant. */
  async addLog(weight: number, calories: number): Promise<void> {
    const logs = collection(this.firestore, this.collectionName);
    await addDoc(logs, {
      weight,
      calories,
      timestamp: Timestamp.fromDate(new Date()),
    });
  }

  /**
   * Pull the most recent N logs, newest-first from Firestore, then
   * flip them to oldest-first so downstream callers can iterate
   * chronologically. Default N = 14 matches the TDEE window.
   */
  async getRecentLogs(days = 14): Promise<DailyLog[]> {
    const logs = collection(this.firestore, this.collectionName);
    const q = query(logs, orderBy('timestamp', 'desc'), limit(days));
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

    // Oldest -> newest for the calculator.
    return results.reverse();
  }
}
