import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
// Train derivations — shared with the Angular Train tab so the two cannot
// disagree about the same numbers (`@macrolog/core/train-view`).
import { bestE1RMByExercise, improvedExercises } from '@macrolog/core';
import { useTrain } from '@/hooks/useTrain';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { TrainGlossary } from '@/components/TrainGlossary';
// The route keeps the screen and nothing else. Since the 2026-10-04 Train
// review (item 32) the idle screen, the live session, each sheet and the
// shared wording live in `components/train/` — this file was 2,400 lines,
// three times any other screen, and every in-session component took the whole
// hook result, so none of them could be memoized.
import { ActiveSession } from '@/components/train/ActiveSession';
import { TrainFinishSheet } from '@/components/train/FinishSheet';
import { StartView } from '@/components/train/StartView';
import { createStyles } from '@/components/train/train-styles';
import { useWorkoutShare, workoutShareStats } from '@/components/train/WorkoutShareCard';
import { useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { usePulse } from '@/lib/motion';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type { WorkoutSession } from '@/lib/workout';
import { useStartNextWorkoutIntent } from '@/hooks/useStartNextWorkoutIntent';

/** Remount boundary for Retry — see Today for why a `key` bump is the
 *  mechanism (the feed hooks expose no reload; UX_AUDIT S18-7). */
export default function Train() {
  const [attempt, setAttempt] = useState(0);
  return <TrainScreen key={attempt} onRetry={() => setAttempt((a) => a + 1)} />;
}

function TrainScreen({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const train = useTrain();
  // Not until the device has said whether a workout is already open
  // (`activePending`): `loading` alone can clear first on a cold start, and a
  // Start pressed in that window began a second session over the open one
  // (Train re-score 3, bug 2). The Start buttons wait behind the same flag.
  const resolving = train.loading || train.activePending;
  // Siri / Shortcuts "Start my next workout" and ignia://train?start=next.
  useStartNextWorkoutIntent({ ...train, loading: resolving });
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  // On the SCREEN, not on the live session: finishing unmounts the session,
  // and a native sheet has to be closed by an owner that is still mounted.
  const [finishOpen, setFinishOpen] = useState(false);
  // One share-card capture for the screen, used by the history detail, the
  // history menu and the "Workout saved" receipt. Here because the screen is
  // the one owner that outlives all three (finishing unmounts the session).
  const locale = useLocale();
  const unitSystem = useUnitSystem();
  const workoutShare = useWorkoutShare();
  const shareSession = (s: WorkoutSession) => {
    haptics.tap();
    workoutShare.share(workoutShareStats(s, train.recentSessions, t, locale, unitSystem));
  };

  // Celebration (ADR-0014 §7): finishing a workout that beats a prior best
  // estimated-1RM bounces the idle hero once with a success haptic.
  // Crossing-only (null-first ref), computed here in the always-mounted parent
  // so it survives the active→idle remount when a session is saved.
  const [prPulse, triggerPrPulse] = usePulse(1.05);
  const bestByEx = useMemo(() => bestE1RMByExercise(train.recentSessions), [train.recentSessions]);
  const prevBest = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (train.loading) return;
    const prev = prevBest.current;
    if (prev && improvedExercises(prev, bestByEx).length > 0) {
      haptics.success();
      triggerPrPulse();
    }
    prevBest.current = bestByEx;
  }, [bestByEx, train.loading, triggerPrPulse]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">{t('nav.train')}</Text>
        {/* The tab is full of lifting vocabulary (RIR, cluster, e1RM); this is
            the always-available way to look any of it up. */}
        <TouchableOpacity
          onPress={() => setGlossaryOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('train.glossaryOpen')}
          style={styles.headerHelp}
          testID="train-glossary-open"
        >
          <Ionicons name="help-circle-outline" size={24} color={colors.muted} />
        </TouchableOpacity>
        <HeaderAvatar />
      </View>
      <TrainGlossary visible={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      {train.loading || (train.activePending && !train.active) ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : train.active ? (
        <ActiveSession train={train} bestByEx={bestByEx} onFinish={() => setFinishOpen(true)} />
      ) : (
        <StartView train={train} heroPulse={prPulse} onRetry={onRetry} onShare={shareSession} />
      )}
      <TrainFinishSheet
        train={train}
        visible={finishOpen}
        onClose={() => setFinishOpen(false)}
        onShare={shareSession}
      />
      {workoutShare.host}
    </SafeAreaView>
  );
}
