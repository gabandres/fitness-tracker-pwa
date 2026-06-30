import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type Measurement,
  type Profile,
  currentWeight as coreCurrentWeight,
  localDateKey,
  navyBodyFat,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  addMeasurement as addMeasurementDoc,
  deleteMeasurement as deleteMeasurementDoc,
  setDailyWeight,
  subscribeDailyWeights,
  subscribeMeasurements,
  subscribeProfile,
  subscribeRecentLogs,
} from '@/lib/ledger';

export interface WeighIn {
  dateKey: string;
  weight: number;
}

export interface BodyState {
  loading: boolean;
  error: Error | null;
  /** Most recent weight (daily weights first, then log weights). */
  currentWeight: number | null;
  /** Today's logged weight, or null if not weighed in today. */
  todayWeight: number | null;
  /** All weigh-ins, newest first. */
  weighIns: WeighIn[];
  setWeight: (weight: number, dateKey?: string) => Promise<void>;
  /** Measurement rows, newest first. */
  measurements: Measurement[];
  /** Navy body-fat % from the latest measurement + profile, or null when
   *  inputs are missing (no sex/height, or no waist/neck — hip for female). */
  bodyFat: number | null;
  /** Why body-fat can't be shown, for an inline hint. null when shown. */
  bodyFatGap: 'profile' | 'measurement' | null;
  addMeasurement: (entry: Omit<Measurement, 'id' | 'date'>) => Promise<void>;
  deleteMeasurement: (id: string) => Promise<void>;
}

export function useBody(): BodyState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsubs = [
      subscribeDailyWeights(
        uid,
        (w) => {
          setWeights(w);
          setLoading(false);
        },
        setError,
      ),
      subscribeRecentLogs(uid, 400, setLogs, setError),
      subscribeMeasurements(uid, 20, setMeasurements, setError),
      subscribeProfile(uid, setProfile, setError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const todayKey = localDateKey(new Date());
  const weighIns = useMemo<WeighIn[]>(
    () =>
      Object.entries(weights)
        .map(([dateKey, weight]) => ({ dateKey, weight }))
        .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)),
    [weights],
  );

  // Body-fat from the latest measurement that carries the inputs the Navy
  // formula needs. `bodyFatGap` explains a null so the UI can nudge the user
  // toward the missing piece (profile sex/height vs. a tape measurement).
  const { bodyFat, bodyFatGap } = useMemo<{ bodyFat: number | null; bodyFatGap: BodyState['bodyFatGap'] }>(() => {
    if (!profile?.sex || !profile?.heightIn) return { bodyFat: null, bodyFatGap: 'profile' };
    const latest = measurements[0];
    if (!latest || latest.waist == null || latest.neck == null) {
      return { bodyFat: null, bodyFatGap: 'measurement' };
    }
    const bf = navyBodyFat(profile.sex, profile.heightIn, latest.waist, latest.neck, latest.hip);
    return bf == null ? { bodyFat: null, bodyFatGap: 'measurement' } : { bodyFat: bf, bodyFatGap: null };
  }, [profile, measurements]);

  const setWeight = useCallback(
    async (weight: number, dateKey?: string) => {
      if (uid) await setDailyWeight(uid, dateKey ?? todayKey, weight);
    },
    [uid, todayKey],
  );
  const addMeasurement = useCallback(
    async (entry: Omit<Measurement, 'id' | 'date'>) => {
      if (uid) await addMeasurementDoc(uid, entry);
    },
    [uid],
  );
  const deleteMeasurement = useCallback(
    async (id: string) => {
      if (uid) await deleteMeasurementDoc(uid, id);
    },
    [uid],
  );

  return {
    loading,
    error,
    currentWeight: coreCurrentWeight(logs, weights),
    todayWeight: weights[todayKey] ?? null,
    weighIns,
    setWeight,
    measurements,
    bodyFat,
    bodyFatGap,
    addMeasurement,
    deleteMeasurement,
  };
}
