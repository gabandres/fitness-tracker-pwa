import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ActivityGuidance,
  type ActivityLevel,
  ACTIVITY_WINDOW_DAYS,
  activityGuidance,
  activityWindowRange,
  addDays,
  localDateKey,
  parseYmd,
  suggestActivityLevel,
} from '@macrolog/core';
import { FEATURES } from './features';
import { health } from './health';
import { connectHealth, importHealth, isHealthConnected } from './health-sync';
import { getActivityWindow } from './ledger';

/**
 * Activity-level correction glue: the trailing-window read, the device-local
 * decline memory, and the hook both surfaces share.
 *
 * The decision itself is pure and lives in `@macrolog/core`
 * (`suggestActivityLevel`) — this file only feeds it and remembers a "no".
 * Nothing here writes to Firestore: accepting a suggestion goes through the
 * ordinary Refine Targets save, so there is no new field and no rules change.
 */

/** Device-local, one bucket, most-recent-wins, no TTL, cleared on accept. */
const DECLINED_KEY = 'ignia.activity.declinedBucket';

const BUCKETS: readonly string[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

/** The bucket the user last waved off, or null if they never have. */
export async function getDeclinedBucket(): Promise<ActivityLevel | null> {
  const v = await AsyncStorage.getItem(DECLINED_KEY);
  return v != null && BUCKETS.includes(v) ? (v as ActivityLevel) : null;
}

/** Remember a "no" — most-recent-wins, so this replaces any earlier decline. */
export async function setDeclinedBucket(bucket: ActivityLevel): Promise<void> {
  await AsyncStorage.setItem(DECLINED_KEY, bucket);
}

/** Forget the decline. Called on accept: the user changed their mind, so a
 *  later window is free to suggest that bucket again. */
export async function clearDeclinedBucket(): Promise<void> {
  await AsyncStorage.removeItem(DECLINED_KEY);
}

/** The trailing window, day-aligned: index i is the i-th day after `from`. */
export interface ActivityWindow {
  activeKcals: number[];
  /** Same days, step counts — display-only, but it distinguishes "no device"
   *  from "a device that logs steps and nothing else". */
  steps: number[];
}

/**
 * One-shot read of the trailing window, one entry per calendar day. Missing
 * days come back as 0 — which `reduceActivityWindow` reads as ABSENCE, so they
 * lower `usableDays` (toward the gate) without dragging the mean down.
 */
export async function readActivityWindow(uid: string, today = new Date()): Promise<ActivityWindow> {
  const { from, to } = activityWindowRange(today);
  const docs = await getActivityWindow(uid, from, to);
  const activeKcals: number[] = [];
  const steps: number[] = [];
  // Walk in LOCAL days — dateKeys are local (`localDateKey`), so stepping a
  // UTC cursor would shift the window by a day east of UTC+12.
  const start = parseYmd(from);
  for (let i = 0; i < ACTIVITY_WINDOW_DAYS; i++) {
    const day = docs[localDateKey(addDays(start, i))];
    activeKcals.push(day?.activeKcal ?? 0);
    steps.push(day?.steps ?? 0);
  }
  return { activeKcals, steps };
}

export interface ActivitySuggestion {
  /** The bucket to suggest, or null for "no suggestion — keep current". */
  suggestion: ActivityLevel | null;
  /** The single thing this surface should say, if anything (pure decision —
   *  see `activityGuidance`). Surfaces pick which kinds they render. */
  guidance: ActivityGuidance;
  /** Record a "no" for the current suggestion (dismiss / manual override). */
  decline: () => void;
  /** Forget any decline — call when the user accepts a suggested bucket. */
  accept: () => void;
  /** Prompt for OS health permissions, then re-read the window. Resolves to
   *  whether permission was granted. */
  connect: () => Promise<boolean>;
  /** True while that permission prompt + first import is in flight. */
  connecting: boolean;
}

/**
 * Shared by both surfaces (Refine Targets pre-fill + Trends card). Reads the
 * window once per mount, then recomputes purely as `basalKcal` changes — so
 * the Refine pre-fill can stay live while the user is still typing height/age.
 *
 * Everything collapses to `{ suggestion: null, guidance: { kind: 'none' } }`
 * when the kill-switch is off, which is what makes ONE flag kill every
 * surface — including the connect prompt and the progress line.
 */
export function useActivitySuggestion(params: {
  uid: string | undefined;
  /** Bare Mifflin BMR (`basalMifflinStJeor`), 0 while unknown. */
  basalKcal: number;
  /** The stored bucket, or null at seed (no bucket stated yet). */
  currentBucket: ActivityLevel | null;
  /** Extra caller-side gate (e.g. Trends hides the card in measured mode). */
  enabled?: boolean;
}): ActivitySuggestion {
  const { uid, basalKcal, currentBucket, enabled = true } = params;
  const on = FEATURES.activityTdee && enabled;

  const [window, setWindow] = useState<ActivityWindow | null>(null);
  const [declinedBucket, setDeclined] = useState<ActivityLevel | null>(null);
  const [healthAvailable, setHealthAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!uid) return;
    try {
      const [win, declined, available, isConnected] = await Promise.all([
        readActivityWindow(uid),
        getDeclinedBucket(),
        health.isAvailable(),
        isHealthConnected(),
      ]);
      setWindow(win);
      setDeclined(declined);
      setHealthAvailable(available);
      setConnected(isConnected);
    } catch {
      // No activity history (or no permission) is the common case, not an
      // error state: the surfaces simply don't appear.
      setWindow({ activeKcals: [], steps: [] });
    }
  }, [uid]);

  useEffect(() => {
    if (!uid || !on) return;
    let alive = true;
    void (async () => {
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [uid, on, load]);

  const suggestion = useMemo(() => {
    if (!on || window == null) return null;
    return suggestActivityLevel({
      activeKcals: window.activeKcals,
      basalKcal,
      currentBucket,
      declinedBucket,
    });
  }, [on, window, basalKcal, currentBucket, declinedBucket]);

  const guidance = useMemo<ActivityGuidance>(() => {
    // Until the first read lands there is nothing honest to say — a flash of
    // "connect Health" under a user who connected months ago is a lie.
    if (!on || window == null) return { kind: 'none' };
    return activityGuidance({
      enabled: on,
      healthAvailable,
      connected,
      activeKcals: window.activeKcals,
      steps: window.steps,
      suggestion,
    });
  }, [on, window, healthAvailable, connected, suggestion]);

  const decline = useCallback(() => {
    if (!suggestion) return;
    setDeclined(suggestion);
    void setDeclinedBucket(suggestion);
  }, [suggestion]);

  const accept = useCallback(() => {
    setDeclined(null);
    void clearDeclinedBucket();
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    setConnecting(true);
    try {
      // `connectHealth` prompts, persists the flag, and the caller's import
      // pulls history — so re-reading after it can already find days.
      const ok = await connectHealth();
      setConnected(ok);
      if (ok && uid) {
        await importHealth(uid);
        await load();
      }
      return ok;
    } catch {
      return false;
    } finally {
      setConnecting(false);
    }
  }, [uid, load]);

  return { suggestion, guidance, decline, accept, connect, connecting };
}
