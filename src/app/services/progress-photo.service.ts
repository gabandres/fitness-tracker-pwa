import { Injectable, inject } from '@angular/core';
// IMPORTANT: Firestore symbols come from '@angular/fire/firestore' ONLY —
// mixing in a second bundled copy of the SDK throws "Expected first
// argument to doc()…" (see ADR-0010 / feedback_angularfire_single_sdk_copy).
import {
  Firestore,
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import {
  Storage,
  deleteObject,
  getBlob,
  ref,
  uploadBytes,
} from '@angular/fire/storage';

/**
 * One dated progress photo. Index doc at `users/{uid}/photos/{dateKey}`;
 * the JPEG bytes live in Storage at `storagePath`. The doc deliberately
 * holds **no download URL** — bytes are fetched via {@link
 * ProgressPhotoService.objectUrl} so the owner-only rule is re-checked on
 * every read and no shareable token ever exists (ADR-0010).
 */
export interface ProgressPhoto {
  /** Local date key (YYYY-MM-DD), also the doc id. One photo per day. */
  readonly dateKey: string;
  readonly storagePath: string;
  readonly takenAt: Date;
  /** Snapshot of the day's weight, for a before/after caption. */
  readonly weightLb?: number;
}

/**
 * Progress-photo aggregate: Firebase Storage bytes + a Firestore index
 * subcollection. The first feature to use Storage (ADR-0010). Standalone
 * (not part of the ledger): photos are binary and not derivations.
 */
@Injectable({ providedIn: 'root' })
export class ProgressPhotoService {
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);

  private uid(): string {
    const u = this.auth.currentUser;
    if (!u) throw new Error('Not signed in');
    return u.uid;
  }

  private photosCollection() {
    return collection(this.firestore, 'users', this.uid(), 'photos');
  }

  private storagePath(uid: string, dateKey: string): string {
    return `users/${uid}/photos/${dateKey}.jpg`;
  }

  /** All of the signed-in user's photos, newest first. */
  async list(): Promise<ProgressPhoto[]> {
    const snap = await getDocs(query(this.photosCollection(), orderBy('takenAt', 'desc')));
    return snap.docs.map((d) => {
      const data = d.data() as { storagePath: string; takenAt: Timestamp; weightLb?: number };
      return {
        dateKey: d.id,
        storagePath: data.storagePath,
        takenAt: data.takenAt.toDate(),
        weightLb: data.weightLb,
      };
    });
  }

  /**
   * Upload (or overwrite) the photo for `dateKey`. Writes the Storage
   * object first, then the index doc — so a doc never points at a missing
   * object. One photo per day; re-uploading the same day overwrites.
   */
  async upload(dateKey: string, blob: Blob, weightLb?: number): Promise<ProgressPhoto> {
    const uid = this.uid();
    const path = this.storagePath(uid, dateKey);
    await uploadBytes(ref(this.storage, path), blob, { contentType: 'image/jpeg' });

    const takenAt = new Date();
    const data: { storagePath: string; takenAt: Timestamp; weightLb?: number } = {
      storagePath: path,
      takenAt: Timestamp.fromDate(takenAt),
    };
    if (weightLb != null) data.weightLb = weightLb;
    await setDoc(doc(this.photosCollection(), dateKey), data);

    return { dateKey, storagePath: path, takenAt, weightLb };
  }

  /**
   * Fetch the bytes and return an object URL for an `<img>`. Auth- and
   * rule-enforced on every call (no token URL). Callers MUST
   * `URL.revokeObjectURL` the result when the image leaves the DOM.
   */
  async objectUrl(photo: ProgressPhoto): Promise<string> {
    const blob = await getBlob(ref(this.storage, photo.storagePath));
    return URL.createObjectURL(blob);
  }

  /** Delete both the Storage object and the index doc for `dateKey`. */
  async delete(dateKey: string): Promise<void> {
    const uid = this.uid();
    try {
      await deleteObject(ref(this.storage, this.storagePath(uid, dateKey)));
    } catch {
      // Object already gone (e.g. a prior partial delete) — fall through
      // and still drop the index doc so the grid doesn't show a ghost.
    }
    await deleteDoc(doc(this.photosCollection(), dateKey));
  }
}
