import { useCallback, useEffect, useState } from 'react';
import { localDateKey } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  type ProgressPhoto,
  deleteProgressPhoto,
  subscribeProgressPhotos,
  uploadProgressPhoto,
} from '@/lib/ledger';
import { pickProgressPhoto } from '@/lib/photoCapture';

export interface PhotosState {
  loading: boolean;
  error: Error | null;
  photos: ProgressPhoto[];
  /** True while a pick → compress → upload is in flight. */
  uploading: boolean;
  /** Pick from the library and upload as today's photo (overwrites today). */
  addPhoto: (weightLb?: number) => Promise<void>;
  deletePhoto: (dateKey: string) => Promise<void>;
}

export function usePhotos(): PhotosState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsub = subscribeProgressPhotos(
      uid,
      (p) => {
        setPhotos(p);
        setLoading(false);
      },
      setError,
    );
    return unsub;
  }, [uid]);

  const addPhoto = useCallback(
    async (weightLb?: number) => {
      if (!uid || uploading) return;
      setUploading(true);
      try {
        const blob = await pickProgressPhoto();
        if (blob) await uploadProgressPhoto(uid, localDateKey(new Date()), blob, weightLb);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Upload failed'));
      } finally {
        setUploading(false);
      }
    },
    [uid, uploading],
  );

  const deletePhoto = useCallback(
    async (dateKey: string) => {
      if (uid) await deleteProgressPhoto(uid, dateKey);
    },
    [uid],
  );

  return { loading, error, photos, uploading, addPhoto, deletePhoto };
}
