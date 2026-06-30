import { useEffect, useMemo, useState } from 'react';
import { type DailyLog, type DailyTargets, type Profile, dailyTargets } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

const LOG_WINDOW = 400;

/** The EFFECTIVE daily targets (calorie + protein), computed through the full
 *  TDEE chain — measured → formula → manual heuristic. Use this anywhere that
 *  needs to *display* the target a user is actually held to, rather than the
 *  raw `manualCaloriesTarget` profile field (which is deleted once the user
 *  refines into formula mode — reading it directly shows a stale "—"). */
export function useDailyTargets(): DailyTargets {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!uid) return;
    const unsubs = [
      subscribeRecentLogs(uid, LOG_WINDOW, setLogs),
      subscribeDailyWeights(uid, setWeights),
      subscribeProfile(uid, setProfile),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  return useMemo(() => dailyTargets(profile, logs, weights), [profile, logs, weights]);
}
