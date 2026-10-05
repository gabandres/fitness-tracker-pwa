import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  type ActivationFinding,
  bodyWeightUnit,
  checkWeightEntry,
  finishSummary,
  formatLoad,
  parseWeightToLb,
  sessionActivationIssues,
  weightBoundsFor,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { confirm } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import type { WorkoutSession } from '@/lib/workout';
import { useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { isOffline } from '@/lib/connectivity';
import * as haptics from '@/lib/haptics';
import { enterUp, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { numOrUndef } from './train-shared';
import { activationIssueKey } from './train-summary';
import { createStyles } from './train-styles';

/**
 * Finish a workout: what it was (time, volume, sets, records, and how it
 * compares with last time), then Complete. Body weight and sleep are behind
 * one optional row (Train review item 34) — they were the sheet's whole
 * content, and they are the least of what finishing a workout is about.
 *
 * Complete no longer waits on the network (Train review bug 2): `onFinish`
 * resolves as soon as the finish is recorded on the device. It resolves
 * `false` only when that failed too, and then the sheet stays up with the
 * typed values and an error line, and Complete is the retry.
 */
export function FinishSheet({
  visible,
  session,
  recentSessions,
  onFinish,
  onClose,
  invalid,
}: {
  visible: boolean;
  session: WorkoutSession;
  recentSessions: readonly WorkoutSession[];
  /** Lifts whose activation could not be read. Reported, never blocking. */
  invalid: ActivationFinding[];
  /** Resolves `false` when the save failed and the sheet should stay open. */
  onFinish: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<boolean | void> | boolean | void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const doneKey = useDoneKeyProps();
  // Body weight only — the LOADS on this screen (volume, PRs, plate math) are
  // converted where they are shown. F3 is about the weight of the person.
  const unitSystem = useUnitSystem();
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [weightErr, setWeightErr] = useState('');
  const [saveErr, setSaveErr] = useState('');
  // The clock the summary is read at, taken when the sheet opens: a duration
  // that ticks while you decide whether to add your body weight is noise.
  const [openedAt, setOpenedAt] = useState(() => Date.now());

  useEffect(() => {
    if (visible) {
      setBodyweight('');
      setSleep('');
      setExtrasOpen(false);
      setBusy(false);
      setWeightErr('');
      setSaveErr('');
      setOpenedAt(Date.now());
    }
  }, [visible]);

  const summary = useMemo(
    () => finishSummary(session, recentSessions, openedAt),
    [session, recentSessions, openedAt],
  );
  const vsLast = summary.previousVolume && summary.previousVolume > 0 && summary.volume > 0
    ? Math.round(((summary.volume - summary.previousVolume) / summary.previousVolume) * 100)
    : null;
  const typed = bodyweight.trim() !== '' || sleep.trim() !== '';

  // A record is the best thing a workout can end on, and it was one trophy
  // line among the stats (Train re-score, delight). It now leads the sheet: a
  // heading, a trophy that bounces once (skipped under reduce motion — the
  // haptic carries it), a success haptic. Once per opening.
  const prCount = summary.prs.length;
  const [trophyPulse, triggerTrophy] = usePulse(1.3);
  const celebrated = useRef(false);
  useEffect(() => {
    if (!visible) {
      celebrated.current = false;
      return;
    }
    if (prCount > 0 && !celebrated.current) {
      celebrated.current = true;
      triggerTrophy();
      haptics.success();
    }
  }, [visible, prCount, triggerTrophy]);

  async function finish() {
    if (busy) return;
    // Same gate the Body tab applies (`checkWeightEntry`): this sheet mirrors
    // its value into `dailyWeights`, and it accepted 11 lb once. A typo is
    // rejected here, in the sheet, rather than silently dropped by the writer.
    const lb = parseWeightToLb(bodyweight, unitSystem);
    if (lb != null && !checkWeightEntry(lb).ok) {
      const b = weightBoundsFor(unitSystem);
      const msg = t('body.weightRange', { min: b.min, max: b.max, unit: bodyWeightUnit(unitSystem) });
      setWeightErr(msg);
      announce(msg, { androidHasLiveRegion: true });
      return;
    }
    setWeightErr('');
    setSaveErr('');
    setBusy(true);
    try {
      const ok = await onFinish({
        bodyweight: lb ?? undefined,
        sleepHours: numOrUndef(sleep),
      });
      if (ok === false) setSaveErr(t('train.workoutSaveErr'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      native
      detents={[0.5, 1]}
      // Guarded once something is typed: a swipe then asks instead of
      // throwing the number away.
      guarded={typed}
      onRequestClose={() => {
        if (!typed) {
          onClose();
          return true;
        }
        confirm({
          title: t('train.discardChangesTitle'),
          confirmText: t('train.discard'),
          destructive: true,
          onConfirm: onClose,
        });
        return false;
      }}
      visible={visible}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      {/* Scroll so the numeric keyboard can't hide the Complete button
          (KeyboardAvoidingView under-lifts inside a bottom-sheet Modal). */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.finishScroll}
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.finishTitle')}</Text>

        {prCount > 0 ? (
          <Animated.View entering={enterUp(0)} style={styles.prHero} testID="finish-pr-hero">
            <Animated.View style={trophyPulse}>
              <Ionicons name="trophy" size={34} color={colors.accent} />
            </Animated.View>
            <Text style={styles.prHeroText} accessibilityRole="header">
              {prCount === 1 ? t('train.prHeadOne') : t('train.prHeadMany', { n: prCount })}
            </Text>
          </Animated.View>
        ) : null}

        <View style={styles.summaryGrid} testID="finish-summary">
          <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summaryTime')}: ${t('train.summaryMinutes', { n: summary.durationMin })}`}>
            <Text style={styles.summaryValue}>{t('train.summaryMinutes', { n: summary.durationMin })}</Text>
            <Text style={styles.summaryLabel}>{t('train.summaryTime')}</Text>
          </View>
          <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summaryVolume')}: ${formatLoad(summary.volume, unitSystem, 0)}`}>
            <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatLoad(summary.volume, unitSystem, 0)}
            </Text>
            <Text style={styles.summaryLabel}>{t('train.summaryVolume')}</Text>
          </View>
          <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summarySets')}: ${summary.sets}`}>
            <Text style={styles.summaryValue}>{summary.sets}</Text>
            <Text style={styles.summaryLabel}>{t('train.summarySets')}</Text>
          </View>
        </View>

        {summary.prs.map((pr) => (
          <View key={pr.exerciseId} style={styles.syncRow} testID={`finish-pr-${pr.exerciseId}`}>
            <Ionicons name="trophy-outline" size={16} color={colors.accent} />
            <Text style={styles.summaryBest}>
              {t('train.summaryNewBest', { name: pr.name, weight: formatLoad(pr.weight, unitSystem), reps: pr.reps })}
            </Text>
          </View>
        ))}
        {vsLast != null && vsLast !== 0 ? (
          <Text style={styles.summaryLine} testID="finish-vs-last">
            {t('train.summaryVsLast', { delta: `${vsLast > 0 ? '+' : '−'}${Math.abs(vsLast)}%` })}
          </Text>
        ) : null}

        {invalid.length > 0 ? (
          <View style={styles.invalidBox} testID="finish-invalid-activations">
            <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.invalidHeading}>{t('train.invalidHeading')}</Text>
              {invalid.map((f) => (
                <Text key={f.exerciseId} style={styles.invalidRow}>
                  <Text style={styles.invalidName}>{f.name}</Text>
                  {' — '}
                  {t(activationIssueKey(f.issue))}
                </Text>
              ))}
              <Text style={styles.invalidHint}>{t('train.invalidHint')}</Text>
            </View>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.moreRow}
          onPress={() => setExtrasOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: extrasOpen }}
          testID="finish-extras"
        >
          <Text style={styles.moreText}>{t('train.finishExtras')}</Text>
          <Ionicons name={extrasOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
        </TouchableOpacity>

        {extrasOpen ? (
          <>
            <Text style={styles.sheetHint}>{t('train.finishHint')}</Text>
            <View style={styles.finishRow}>
              <View style={styles.finishField}>
                <Text style={styles.fieldLabel}>
                  {t('train.bodyweight', { unit: bodyWeightUnit(unitSystem) })}
                </Text>
                <SheetTextInput
                  style={styles.input}
                  placeholder="—"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={bodyweight}
                  onChangeText={setBodyweight}
                  selectTextOnFocus
                  {...doneKey}
                  testID="finish-bodyweight"
                />
                {weightErr ? (
                  <Text
                    style={[styles.sheetHint, { color: colors.danger }]}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    testID="finish-bodyweight-error"
                  >
                    {weightErr}
                  </Text>
                ) : null}
              </View>
              <View style={styles.finishField}>
                <Text style={styles.fieldLabel}>{t('train.sleepH')}</Text>
                <SheetTextInput
                  style={styles.input}
                  placeholder="—"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={sleep}
                  onChangeText={setSleep}
                  selectTextOnFocus
                  {...doneKey}
                  testID="finish-sleep"
                />
              </View>
            </View>
          </>
        ) : null}

        {saveErr ? (
          <Text
            style={[styles.sheetHint, { color: colors.danger }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="finish-save-error"
          >
            {saveErr}
          </Text>
        ) : null}

        {/* The button IS the retry: a failed save leaves the sheet open with
            the typed values and the error line above, and tapping Complete
            again re-runs the same write (`s18-train-finish.test.tsx`). */}
        <TouchableOpacity
          style={styles.finishBtn}
          onPress={finish}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          testID="finish-confirm"
        >
          <Text style={styles.finishText}>{busy ? t('common.saving') : t('train.complete')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * The Finish sheet as the SCREEN mounts it, wired to the hook.
 *
 * Owned by the screen rather than by `ActiveSession` because finishing
 * unmounts the session, and a native sheet has to be closed by an owner that
 * is still mounted. It holds the last live session while it closes, so its
 * content does not blank mid-animation.
 */
export function TrainFinishSheet({
  train,
  visible,
  onClose,
  onShare,
}: {
  train: Pick<TrainState, 'active' | 'editingExisting' | 'templates' | 'recentSessions' | 'finishWorkout'>;
  visible: boolean;
  onClose: () => void;
  /** Share the workout just finished — offered on the "Workout saved" receipt. */
  onShare?: (session: WorkoutSession) => void;
}) {
  const t = useT();
  const live = train.active && !train.editingExisting ? train.active : null;
  // Derived during render (React's "previous value" pattern), not in an
  // effect: an effect would paint one frame of the stale session first.
  const [held, setHeld] = useState<WorkoutSession | null>(live);
  if (live && live !== held) setHeld(live);
  const session = live ?? held;
  // Lifts whose activation set cannot be read as a progression input. Judged
  // against the template the session was STARTED from, which is the only way
  // "logged as straight sets where a cluster was prescribed" is detectable —
  // the session alone carries no prescription. An ad-hoc session (no template)
  // still gets the RIR checks, just not that one.
  const invalid = useMemo(
    () =>
      session
        ? sessionActivationIssues(
            session.exercises,
            train.templates.find((tpl) => tpl.id === session.templateId) ?? null,
          )
        : [],
    [session, train.templates],
  );
  if (!session) return null;
  return (
    <FinishSheet
      visible={visible}
      session={session}
      recentSessions={train.recentSessions}
      onClose={onClose}
      // Reported at the finish boundary, where the whole session is in view
      // and a lift can still be repeated — not as a mid-set interruption.
      // Never gates the save: an unreadable set is still training that
      // happened, and refusing to store it would lose the evidence.
      invalid={invalid}
      onFinish={async (extras) => {
        // `finishWorkout` answers `false` when it could not record the
        // finish at all (the hook's boolean contract); a legacy void resolve
        // reads as success. On failure the sheet stays up with the typed
        // values, says so, and does NOT spend a rating prompt.
        const ok: unknown = await train.finishWorkout(extras);
        if (ok === false) return false;
        onClose();
        haptics.success();
        // A finish recorded offline IS saved — on this phone, until the
        // signal returns — and the receipt says it in those words.
        // Share rides on the receipt — the moment a finished workout is worth
        // showing someone, and the one place it costs nothing to offer.
        const finished = session;
        showToast(
          isOffline() ? t('train.savedOnPhone') : t('train.workoutSaved'),
          onShare
            ? { action: { label: t('train.share'), onPress: () => onShare(finished) }, testID: 'train-toast' }
            : undefined,
        );
        // Finishing a workout is the app's clearest "that went well" beat —
        // the best place to spend one of iOS's few rating requests.
        // Fire-and-forget; it self-throttles and no-ops until the user has
        // enough qualifying days.
        void recordPositiveMoment();
        return true;
      }}
    />
  );
}
