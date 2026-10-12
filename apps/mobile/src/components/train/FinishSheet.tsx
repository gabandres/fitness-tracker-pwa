import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Touchable } from './Touchable';
import Animated from 'react-native-reanimated';
import { SheetHeader } from '@/components/SheetHeader';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  type ActivationFinding,
  type Recommendation,
  type TemplateLoadChange,
  type TemplateStructureChange,
  applyStructureChanges,
  applyTemplateChanges,
  bodyWeightUnit,
  checkWeightEntry,
  finishProgression,
  finishSummary,
  formatLoad,
  isStorableDurationMin,
  isStorableSleepHours,
  parseWeightToLb,
  proposeStructureChanges,
  proposeTemplateChanges,
  sessionActivationIssues,
  sessionCounts,
  weightBoundsFor,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { confirmNative } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { DEFAULT_LOG_STYLE, isLoggedSet, type TemplateExercise, type WorkoutSession, type WorkoutTemplate } from '@/lib/workout';
import { type TFn, useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { announce } from '@/lib/a11y';
import { isOffline } from '@/lib/connectivity';
import * as haptics from '@/lib/haptics';
import { enterUp, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useSheetHiddenBelow } from '@/lib/sheet-detent';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { space } from '@/theme';
import { numOrUndef } from './train-shared';
import { type FinishCall, activationIssueKey, finishCalls, unloggedCardioNames } from './train-summary';
import { createStyles } from './train-styles';
import { reasonText, recommendationText } from './recommendation-text';

/** What Complete hands the owner besides the session itself. */
export interface FinishExtras {
  bodyweight?: number;
  sleepHours?: number;
  /** The real length, typed when the workout was left open (F15). Wins over
   *  the start-to-tap interval `useTrain` would otherwise stamp. */
  durationMin?: number;
}

/**
 * Detents per platform. iOS opens full height (F1: its sheet resizes the
 * content per detent, and at a half detent the calls filled it). Android opens
 * at 60 % — M3's partial first height, with the grabber well below the status
 * bar (F12, R33) — and goes full height on a drag; the content is laid out at
 * full height there, so {@link BelowFoldSpacer} lifts the pinned footer onto
 * the visible part.
 */
const FINISH_DETENTS = Platform.OS === 'android' ? [0.6, 1] : [1];

/** Android at the lower detent: the band below the fold, taken from the
 *  bottom of the sheet so Complete sits on screen (`lib/sheet-detent.ts`).
 *  Renders under the sheet route, where that context lives. */
function BelowFoldSpacer() {
  const hidden = useSheetHiddenBelow();
  return hidden > 0 ? <View style={{ height: hidden }} testID="finish-below-fold" /> : null;
}

/** A workout open this long is more likely forgotten than finished (F15). */
const LONG_OPEN_MIN = 180;
/** From this text size (iOS AX1 and up) the footer ends the scroll instead
 *  of being pinned under it (QA v2: ~40% of the sheet at AX-large). */
const FOOTER_INLINE_FONT_SCALE = 1.6;

/** "47 min", or "14 h 0 min" from an hour up — "840 min" read as a typo. */
export function durationText(min: number, t: TFn): string {
  return min >= 60
    ? t('train.summaryHoursMinutes', { h: Math.floor(min / 60), m: min % 60 })
    : t('train.summaryMinutes', { n: min });
}

/**
 * Finish a workout: what it was (time, volume, sets, records, and how it
 * compares with last time), then Complete. Body weight and sleep are behind
 * one optional row (Train review item 34) — they were the sheet's whole
 * content, and they are the least of what finishing a workout is about.
 *
 * Complete is PINNED under the scroll (train-ux F1/J1, 2026-10-11): it was the
 * scroll's last child and opened below the fold on every template workout,
 * where the calls fill the sheet. The header carries the visible way back
 * ("Keep training"), and Discard sits under Complete (F14) — finish, discard
 * or keep going, all on the sheet.
 *
 * Complete no longer waits on the network (Train review bug 2): `onFinish`
 * resolves as soon as the finish is recorded on the device. It resolves
 * `false` only when that failed too, and then the sheet stays up with the
 * typed values and an error line, and Complete is the retry.
 *
 * "Next session" (2026-10-07) lists the engine's call for every lift that has
 * one, read with this workout counted as the newest: the call, the new load,
 * the reps to expect and the reason. When the session came from a template,
 * each call that would move its load carries a box (on by default). There is
 * no separate Apply button any more (F2): Complete asks ONCE, when any box is
 * ticked — "Update {template}" / "Keep original" — and the template moves
 * only on that tap, after the workout itself is recorded (ADR-0044). With
 * "Auto-apply progression" on they are applied at Complete without asking,
 * and the sheet says so.
 *
 * The same question carries the template's SHAPE (S23-10, owner 2026-10-12):
 * a lift added mid-session ("Add Cable Fly") or removed from it ("Remove
 * Row") — core `template-structure.ts` says what counts. "Update {template}"
 * takes the ticked load moves and the shape; "Keep original" finishes and
 * leaves the template alone. Auto-apply never applies structure, so with it on
 * the question still comes up when the shape changed, listing only that.
 *
 * Every confirm on this sheet is the SYSTEM dialog (`confirmNative`; S23-2,
 * R30/R31): the sheet is native, and a branded sheet drawn over it was
 * sheet-on-sheet.
 */
export function FinishSheet({
  visible,
  session,
  recentSessions,
  onFinish,
  onClose,
  onDiscard,
  invalid,
  calls = [],
  proposed = [],
  structure = [],
  templateName = null,
  autoApply = false,
}: {
  visible: boolean;
  session: WorkoutSession;
  recentSessions: readonly WorkoutSession[];
  /** Lifts whose activation could not be read. Reported, never blocking. A
   *  lift that also has a call below is reported there, once. */
  invalid: ActivationFinding[];
  /** The engine's call per lift, from the history including this session. */
  calls?: FinishCall[];
  /** The template moves those calls imply (empty without a template). */
  proposed?: TemplateLoadChange[];
  /** Lifts added to / removed from the template this session (S23-10). Offered
   *  only on an explicit "Update" — auto-apply never applies them. */
  structure?: TemplateStructureChange[];
  /** The template the session came from, when it still exists. */
  templateName?: string | null;
  /** The lifter's "Auto-apply progression": applied at Complete, no question. */
  autoApply?: boolean;
  /** Resolves `false` when the save failed and the sheet should stay open.
   *  `changes` are the template moves the lifter chose to make and `shape` the
   *  structure changes — both empty unless they answered "Update {template}". */
  onFinish: (
    extras: FinishExtras,
    changes: TemplateLoadChange[],
    shape: TemplateStructureChange[],
  ) => Promise<boolean | void> | boolean | void;
  onClose: () => void;
  /** Discard the workout instead; the owner confirms first. */
  onDiscard?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const doneKey = useDoneKeyProps();
  // Three tiles side by side clip at accessibility sizes; they stack (F17).
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  // At accessibility sizes the pinned footer took ~40% of the sheet and left
  // a slot to scroll the calls through; there it closes the scroll instead.
  const inlineFooter = fontScale >= FOOTER_INLINE_FONT_SCALE;
  // Body weight only — the LOADS on this screen (volume, PRs, plate math) are
  // converted where they are shown. F3 is about the weight of the person.
  const unitSystem = useUnitSystem();
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState('');
  const [length, setLength] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [weightErr, setWeightErr] = useState('');
  const [sleepErr, setSleepErr] = useState('');
  const [lengthErr, setLengthErr] = useState('');
  const [saveErr, setSaveErr] = useState('');
  // Per-lift template-update boxes (default on).
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  // The clock the summary is read at, taken when the sheet opens: a duration
  // that ticks while you decide whether to add your body weight is noise.
  const [openedAt, setOpenedAt] = useState(() => Date.now());

  useEffect(() => {
    if (visible) {
      setBodyweight('');
      setSleep('');
      setLength('');
      setExtrasOpen(false);
      setBusy(false);
      setWeightErr('');
      setSleepErr('');
      setLengthErr('');
      setSaveErr('');
      setOpenedAt(Date.now());
      setOff(new Set());
    }
  }, [visible]);

  const changeFor = useMemo(() => new Map(proposed.map((c) => [c.exerciseId, c])), [proposed]);
  // A lift with a call is reported in the call list; the old block keeps
  // only the findings for lifts the engine had nothing to say about.
  const called = useMemo(() => new Set(calls.map((c) => c.exerciseId)), [calls]);
  const invalidRest = invalid.filter((f) => !called.has(f.exerciseId));
  const selected = proposed.filter((c) => !off.has(c.exerciseId));
  // The boxes are offered whenever the template can move on a tap: there is
  // a template, and auto-apply is not already moving it.
  const canOffer = templateName != null && !autoApply;

  const summary = useMemo(
    () => finishSummary(session, recentSessions, openedAt),
    [session, recentSessions, openedAt],
  );
  const vsLast = summary.previousVolume && summary.previousVolume > 0 && summary.volume > 0
    ? Math.round(((summary.volume - summary.previousVolume) / summary.previousVolume) * 100)
    : null;
  // The real length a forgotten workout was given (F15) is typed too: a swipe
  // must not throw it away unasked (fix R).
  const typed = bodyweight.trim() !== '' || sleep.trim() !== '' || length.trim() !== '';
  const longOpen = summary.durationMin > LONG_OPEN_MIN;
  // A valid typed length is what will be saved, so it is what the tile says.
  const typedLength = numOrUndef(length);
  const shownMin = typedLength != null && typedLength >= 1 && isStorableDurationMin(typedLength)
    ? Math.round(typedLength)
    : summary.durationMin;

  // A record is the best thing a workout can end on, and it was one trophy
  // line among the stats (Train re-score, delight). It now leads the sheet: a
  // heading, a trophy that bounces once (skipped under reduce motion — the
  // haptic carries it), a success haptic, and the heading SPOKEN (F12: a
  // screen reader user heard none of it). Once per opening.
  const prCount = summary.prs.length;
  const prHead = prCount === 1 ? t('train.prHeadOne') : t('train.prHeadMany', { n: prCount });
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
      announce(prHead);
    }
  }, [visible, prCount, prHead, triggerTrophy]);

  /** The close every way out shares — the swipe, Android back and "Keep
   *  training". Typed extras are asked about first (F7: it read as "discard
   *  the workout", which it never did). */
  function requestClose(): boolean {
    if (!typed) {
      onClose();
      return true;
    }
    confirmNative({
      title: t('train.finishDropExtrasTitle'),
      body: t('train.finishDropExtrasBody'),
      confirmText: t('train.finishDropExtrasConfirm'),
      destructive: true,
      onConfirm: onClose,
    });
    return false;
  }

  /** Validate, then — when any template box is ticked — ask once (F2). */
  function finish() {
    if (busy) return;
    // Same gate the Body tab applies (`checkWeightEntry`): this sheet mirrors
    // its value into `dailyWeights`, and it accepted 11 lb once. A typo is
    // rejected here, in the sheet, rather than silently dropped by the writer.
    const lb = parseWeightToLb(bodyweight, unitSystem);
    const b = weightBoundsFor(unitSystem);
    const wErr = lb != null && !checkWeightEntry(lb).ok
      ? t('body.weightRange', { min: b.min, max: b.max, unit: bodyWeightUnit(unitSystem) })
      : '';
    // Sleep the rules refuse (0–24 h) failed the WHOLE finish, after the
    // receipt had said "Workout saved" (F3): "75" typed for 7.5.
    const sh = numOrUndef(sleep);
    const sErr = sh != null && !isStorableSleepHours(sh) ? t('train.sleepRange') : '';
    const len = numOrUndef(length);
    const lErr = len != null && (len < 1 || !isStorableDurationMin(len)) ? t('train.finishLengthRange') : '';
    setWeightErr(wErr);
    setSleepErr(sErr);
    setLengthErr(lErr);
    const firstErr = wErr || sErr || lErr;
    if (firstErr) {
      // The extras row may have been folded away after typing.
      if (wErr || sErr) setExtrasOpen(true);
      announce(firstErr, { androidHasLiveRegion: true });
      return;
    }
    setSaveErr('');
    const extras: FinishExtras = {
      bodyweight: lb ?? undefined,
      sleepHours: sh,
      durationMin: len != null ? Math.round(len) : undefined,
    };
    const chosen = canOffer ? selected : [];
    // Structure is asked whenever there is a template to write, auto-apply or
    // not: auto-apply moves loads, never the template's shape (S23-10).
    const shape = templateName != null ? structure : [];
    if (chosen.length === 0 && shape.length === 0) {
      void complete(extras, [], []);
      return;
    }
    const fmt = (lbs: number) => formatLoad(lbs, unitSystem);
    const lines = [
      ...chosen.map((c) => t('train.rec.finish.askLine', { name: c.name, from: c.from != null ? fmt(c.from) : '—', to: fmt(c.to) })),
      ...shape.map((c) => t(c.kind === 'add' ? 'train.rec.finish.askAdd' : 'train.rec.finish.askRemove', { name: c.name })),
    ];
    // The system dialog (S23-2): this sheet is native, and the branded
    // confirm drawn over it was a sheet on a sheet (R30/R31).
    confirmNative({
      title: t('train.rec.finish.askTitle', { template: templateName ?? '' }),
      body: lines.join('\n'),
      confirmText: t('train.rec.finish.askUpdate', { template: templateName ?? '' }),
      secondaryText: t('train.rec.finish.askKeep'),
      onConfirm: () => void complete(extras, chosen, shape),
      onSecondary: () => void complete(extras, [], []),
    });
  }

  async function complete(extras: FinishExtras, changes: TemplateLoadChange[], shape: TemplateStructureChange[]) {
    setBusy(true);
    try {
      const ok = await onFinish(extras, changes, shape);
      if (ok === false) setSaveErr(t('train.workoutSaveErr'));
    } catch (e) {
      // A catch that resets and rethrows, then the same reset after it: a
      // `finally` cannot be lowered by React Compiler, which skipped the
      // whole sheet. Same effect — reset on both paths, the error propagates.
      setBusy(false);
      throw e;
    }
    setBusy(false);
  }

  const notes = [
    summary.unstarted.length > 0
      ? { id: 'finish-unstarted', text: plural(t, locale, 'train.unstarted', summary.unstarted.length, { names: summary.unstarted.join(', ') }) }
      : null,
    summary.skippedSets > 0
      ? { id: 'finish-skipped', text: plural(t, locale, 'train.skippedSets', summary.skippedSets) }
      : null,
    summary.untickedSets > 0
      ? { id: 'finish-unticked', text: plural(t, locale, 'train.untickedSets', summary.untickedSets) }
      : null,
    // A planned run left unlogged is dropped at Complete, like a lift never
    // started — said, not silent (L-N12).
    ...unloggedCardioNames(session, t).map((name, i) => ({ id: `finish-unlogged-cardio-${i}`, text: t('train.unloggedCardio', { name }) })),
  ].filter((n): n is { id: string; text: string } => n != null);

  const tile = (key: string, value: string, label: string, shrink = false) => (
    <View
      key={key}
      style={[styles.summaryTile, largeText && styles.summaryTileRow]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      {largeText ? <Text style={styles.summaryLabel}>{label}</Text> : null}
      {/* Stacked rows (large text): the value shrinks and wraps beside its
          label instead of clipping — "1,14" for 1,140 lb (QA R2 iOS, AX5). */}
      <Text
        style={[styles.summaryValue, largeText && { flexShrink: 1, textAlign: 'right' }]}
        numberOfLines={largeText ? undefined : 1}
        adjustsFontSizeToFit={shrink && !largeText}
      >
        {value}
      </Text>
      {largeText ? null : <Text style={styles.summaryLabel}>{label}</Text>}
    </View>
  );

  // Pinned below the scroll: the one action the sheet exists for is always on
  // screen — except at accessibility sizes, where it ends the scroll.
  const footer = (
    <View style={styles.finishFooter} testID="finish-footer">
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
      <Touchable
        style={[styles.finishBtn, styles.finishFooterBtn]}
        onPress={finish}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy }}
        testID="finish-confirm"
      >
        <Text style={styles.finishText}>{busy ? t('common.saving') : t('train.complete')}</Text>
      </Touchable>
      {onDiscard ? (
        <Touchable
          style={styles.finishDiscardBtn}
          onPress={onDiscard}
          disabled={busy}
          accessibilityRole="button"
          testID="finish-discard"
        >
          <Text style={styles.discardText}>{t('train.discardWorkout')}</Text>
        </Touchable>
      ) : null}
    </View>
  );

  return (
    <BottomSheet
      native
      // iOS full height (F1); Android 60 % then full on a drag (F12) — see
      // FINISH_DETENTS and BelowFoldSpacer.
      detents={FINISH_DETENTS}
      // Guarded once something is typed: a swipe then asks instead of
      // throwing the number away.
      guarded={typed}
      onRequestClose={requestClose}
      visible={visible}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      <SheetHeader
        title={t('train.finishTitle')}
        leading={{ label: t('train.keepTraining'), onPress: requestClose, testID: 'finish-keep-training' }}
      />
      {/* Scroll so the numeric keyboard can't hide the fields (the sheet
          route pads a height-detent sheet for the keyboard, so the footer
          rides above it). */}
      <ScrollView
        nestedScrollEnabled
        style={styles.finishScrollFill}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.finishScroll}
        testID="finish-scroll"
      >
        {prCount > 0 ? (
          <Animated.View entering={enterUp(0)} style={styles.prHero} testID="finish-pr-hero">
            <Animated.View style={trophyPulse}>
              <Ionicons name="trophy" size={34} color={colors.accent} />
            </Animated.View>
            <Text style={styles.prHeroText} accessibilityRole="header">{prHead}</Text>
          </Animated.View>
        ) : null}

        <View style={[styles.summaryGrid, largeText && styles.summaryGridStacked]} testID="finish-summary">
          {tile('time', durationText(shownMin, t), t('train.summaryTime'), true)}
          {tile('volume', formatLoad(summary.volume, unitSystem, 0), t('train.summaryVolume'), true)}
          {tile('sets', String(summary.sets), t('train.summarySets'))}
        </View>

        {/* Open for hours: more likely forgotten than finished. The interval
            would be saved as the session's length, and the superset report
            compares it — so ask for the real one (F15). Optional. */}
        {longOpen ? (
          <View style={styles.finishField} testID="finish-long-open">
            <Text style={styles.summaryLine}>
              {t('train.finishLongOpen', { time: durationText(summary.durationMin, t) })}
            </Text>
            <Text style={styles.fieldLabel}>{t('train.finishLengthLabel')}</Text>
            <SheetTextInput
              style={styles.input}
              placeholder="—"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              value={length}
              onChangeText={setLength}
              selectTextOnFocus
              {...doneKey}
              accessibilityLabel={t('train.finishLengthLabel')}
              testID="finish-length"
            />
            {lengthErr ? (
              <Text
                style={[styles.sheetHint, { color: colors.danger }]}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                testID="finish-length-error"
              >
                {lengthErr}
              </Text>
            ) : null}
          </View>
        ) : null}

        {summary.prs.map((pr) => (
          <View key={pr.exerciseId} style={styles.syncRow} testID={`finish-pr-${pr.exerciseId}`}>
            <Ionicons name="trophy-outline" size={16} color={colors.accent} />
            <Text style={styles.summaryBest}>
              {t('train.summaryNewBest', { name: pr.name, weight: formatLoad(pr.weight, unitSystem), reps: pr.reps })}
            </Text>
          </View>
        ))}
        {/* No record to lead with: name the best set instead — the one line
            of a finished workout worth reading twice (Train re-score 3). */}
        {prCount === 0 && summary.topSet ? (
          <View style={styles.syncRow} testID="finish-top-set">
            <Ionicons name="barbell-outline" size={16} color={colors.muted} />
            <Text style={[styles.summaryBest, { flexShrink: 1 }]}>
              {t('train.summaryTopSet', {
                name: summary.topSet.name,
                weight: formatLoad(summary.topSet.weight, unitSystem),
                reps: summary.topSet.reps,
              })}
            </Text>
          </View>
        ) : null}
        {/* Like for like (F4): the lifts this session logged, against the
            same lifts last time — and said so when last time had more. */}
        {vsLast != null && vsLast !== 0 ? (
          <Text style={styles.summaryLine} testID="finish-vs-last">
            {t(summary.previousSameLiftsOnly ? 'train.summaryVsLastSame' : 'train.summaryVsLast', {
              delta: `${vsLast > 0 ? '+' : '−'}${Math.abs(vsLast)}%`,
            })}
          </Text>
        ) : null}

        {/* What the save will drop or keep without being asked, said here
            while it can still be done (Train re-score 3; F9): lifts not
            started, planned sets skipped inside a started lift, and sets
            with numbers but no tick. Never blocking. */}
        {notes.length > 0 ? (
          <View style={styles.invalidBox} testID="finish-unsaved">
            <Ionicons name="alert-circle-outline" size={18} color={colors.muted} />
            <View style={{ flex: 1, gap: space.xs }}>
              {notes.map((n) => (
                <Text key={n.id} style={[styles.invalidHint, { marginTop: 0 }]} testID={n.id}>
                  {n.text}
                </Text>
              ))}
            </View>
          </View>
        ) : null}

        {calls.length > 0 ? (
          <View testID="finish-calls">
            <Text style={styles.invalidHeading} accessibilityRole="header">{t('train.rec.finish.heading')}</Text>
            {calls.map((c) => (
              <FinishCallRow
                key={c.exerciseId}
                call={c}
                change={changeFor.get(c.exerciseId)}
                toggle={canOffer && changeFor.has(c.exerciseId)}
                on={!off.has(c.exerciseId)}
                onToggle={() =>
                  setOff((cur) => {
                    const next = new Set(cur);
                    if (next.has(c.exerciseId)) next.delete(c.exerciseId);
                    else next.add(c.exerciseId);
                    return next;
                  })
                }
              />
            ))}
            {calls.some((c) => c.rec.action === 'repeat-invalid') ? (
              <Text style={styles.invalidHint}>{t('train.invalidHint')}</Text>
            ) : null}
            {templateName != null && autoApply && proposed.length > 0 ? (
              <Text style={styles.sheetHint} testID="finish-auto-apply">
                {t('train.rec.finish.auto', { template: templateName })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {invalidRest.length > 0 ? (
          <View style={styles.invalidBox} testID="finish-invalid-activations">
            <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.invalidHeading}>{t('train.invalidHeading')}</Text>
              {invalidRest.map((f) => (
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

        <Touchable
          style={styles.moreRow}
          onPress={() => setExtrasOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: extrasOpen }}
          testID="finish-extras"
        >
          <Text style={styles.moreText}>{t('train.finishExtras')}</Text>
          <Ionicons name={extrasOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
        </Touchable>

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
                  // The placeholder is a dash; without a label a screen
                  // reader announced the field as "dash" (UX_AUDIT S20).
                  accessibilityLabel={t('train.bodyweight', { unit: bodyWeightUnit(unitSystem) })}
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
                  accessibilityLabel={t('train.sleepHoursA11y')}
                  testID="finish-sleep"
                />
                {sleepErr ? (
                  <Text
                    style={[styles.sheetHint, { color: colors.danger }]}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    testID="finish-sleep-error"
                  >
                    {sleepErr}
                  </Text>
                ) : null}
              </View>
            </View>
          </>
        ) : null}
        {inlineFooter ? footer : null}
      </ScrollView>

      {inlineFooter ? null : footer}
      <BelowFoldSpacer />
    </BottomSheet>
  );
}

/**
 * One lift's call on the finish sheet: name and headline ("35 lb ·
 * INCREASE"), the rep target, what to expect at a new load, the reason, and —
 * when the call would move the template — the move itself with its box.
 */
function FinishCallRow({
  call,
  change,
  toggle,
  on,
  onToggle,
}: {
  call: FinishCall;
  change?: TemplateLoadChange;
  /** Offer the per-lift template-update box. */
  toggle: boolean;
  on: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const text = recommendationText(call.rec, unitSystem, t);
  if (!text) return null;
  const moves = text.call === 'increase' || text.call === 'drop';
  const fmt = (lb: number) => formatLoad(lb, unitSystem);
  // A HOLD whose template still names another load moves the template to the
  // weight actually lifted. "175 lb · HOLD" beside "Template 170 → 175" read
  // as a contradiction, so the line says why (F16).
  const changeKey = change?.from == null
    ? 'train.rec.finish.changeNew'
    : !moves && change.to !== change.from
      ? 'train.rec.finish.changeMatch'
      : 'train.rec.finish.change';
  return (
    <View style={styles.callRow} testID={`finish-call-${call.exerciseId}`}>
      <View style={styles.callMain}>
        <View style={styles.callHead}>
          <Text style={styles.callName}>{call.name}</Text>
          <Text style={[styles.callChip, moves && styles.callChipMove]} testID={`finish-call-${call.exerciseId}-headline`}>
            {text.headline}
          </Text>
        </View>
        {text.target ? <Text style={styles.recTarget}>{text.target}</Text> : null}
        {text.expect ? <Text style={styles.recNote}>{text.expect}</Text> : null}
        <Text style={styles.recReason}>{text.reason}</Text>
        {text.stall.length > 0 ? <Text style={styles.recNote}>{text.stall[0]}</Text> : null}
        {change ? (
          <Text style={styles.recNote} testID={`finish-change-${call.exerciseId}`}>
            {t(changeKey, { from: change.from != null ? fmt(change.from) : '', to: fmt(change.to) })}
          </Text>
        ) : null}
      </View>
      {toggle ? (
        <Touchable
          style={styles.callToggle}
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={t('train.rec.finish.toggleA11y', { name: call.name })}
          testID={`finish-toggle-${call.exerciseId}`}
        >
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.teal : colors.faint} />
        </Touchable>
      ) : null}
    </View>
  );
}

/** The template draft `saveTemplate` writes: the whole doc minus its id and
 *  stamps, with `exercises` replaced whole — `loadLog` included, since the
 *  write is a full overwrite of the array. */
function templateDraftWith(tpl: WorkoutTemplate, exercises: TemplateExercise[]) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...draft } = tpl;
  return { ...draft, exercises };
}

/**
 * The Finish sheet as the SCREEN mounts it, wired to the hook.
 *
 * Owned by the screen rather than by `ActiveSession` because finishing
 * unmounts the session, and a native sheet has to be closed by an owner that
 * is still mounted. It holds the last live session while it closes, so its
 * content does not blank mid-animation.
 *
 * It also owns the engine's calls at the finish boundary: computed here with
 * the session counted as the newest completed one, applied to the template
 * through the hook's `saveTemplate` (the same path the rest picker's "Keep
 * for this lift" writes) — AFTER the workout is recorded, either because the
 * lifter answered "Update and complete" or because auto-apply is on. Never
 * otherwise, and never for a workout that was then discarded (F2: the old
 * Apply button wrote the template before the session existed).
 */
export function TrainFinishSheet({
  train,
  visible,
  onClose,
  onShare,
}: {
  train: Pick<TrainState, 'active' | 'editingExisting' | 'templates' | 'recentSessions' | 'finishWorkout'>
    & Partial<Pick<TrainState, 'catalog' | 'saveTemplate' | 'trainingPhase' | 'autoApplyProgression' | 'maybeAutoSwitchProgram' | 'discardWorkout' | 'programVersion'>>;
  visible: boolean;
  onClose: () => void;
  /** Share the workout just finished — offered on the "Workout saved" receipt. */
  onShare?: (session: WorkoutSession) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const unitSystem = useUnitSystem();
  const live = train.active && !train.editingExisting ? train.active : null;
  // What the sheet shows, followed ONLY while it is open. This component is
  // mounted for the whole live session, and `train.active` is a new object on
  // every keystroke — so following it while closed re-ran `finishSummary`
  // and `sessionActivationIssues` (every set of every lift, plus the PR scan
  // over recent sessions) on each digit typed into a set row, for a sheet
  // nobody could see (UX_AUDIT S20). Held after close, so the content does
  // not blank mid-animation, and null until the first open, so the sheet is
  // not even mounted before then.
  //
  // Derived during render (React's "previous value" pattern), not in an
  // effect: an effect would paint one frame of the stale session first.
  const [held, setHeld] = useState<{
    session: WorkoutSession;
    recent: readonly WorkoutSession[];
    templates: TrainState['templates'];
  } | null>(null);
  if (
    visible &&
    live &&
    (held?.session !== live || held.recent !== train.recentSessions || held.templates !== train.templates)
  ) {
    setHeld({ session: live, recent: train.recentSessions, templates: train.templates });
  }
  const session = held?.session ?? null;
  const recentSessions = held?.recent;
  const templates = held?.templates;
  const template = session && templates ? templates.find((tpl) => tpl.id === session.templateId) ?? null : null;
  // Lifts whose activation set cannot be read as a progression input. Judged
  // against the template the session was STARTED from, which is the only way
  // "logged as straight sets where a cluster was prescribed" is detectable —
  // the session alone carries no prescription. An ad-hoc session (no template)
  // still gets the RIR checks, just not that one.
  // The engine reads the session as the save will store it: a lift with
  // nothing logged is dropped there, so it is not read here either. Read as
  // it was, an unstarted myo-reps lift came back `repeat-invalid` with no
  // reason, and its row threw rendering the sheet (S23-10 tests, 2026-10-12).
  const performed = useMemo(
    () => (session
      ? { ...session, exercises: session.exercises.filter((e) => e.sets.some((x) => isLoggedSet(x, e.logStyle ?? DEFAULT_LOG_STYLE))) }
      : null),
    [session],
  );
  const invalid = useMemo(
    () => (performed ? sessionActivationIssues(performed.exercises, template) : []),
    [performed, template],
  );
  const catalog = train.catalog;
  const phase = train.trainingPhase ?? 'cut';
  const calls = useMemo(
    () =>
      performed && recentSessions
        ? finishCalls({ session: performed, recentSessions, catalog: catalog ?? [], template, phase, now: performed.date.getTime() })
        : [],
    [performed, recentSessions, catalog, template, phase],
  );
  const recs = useMemo(() => new Map<string, Recommendation>(calls.map((c) => [c.exerciseId, c.rec])), [calls]);
  // The sentence the lifter read is the one the template's `loadLog` keeps.
  const reasonFor = (rec: Recommendation) => reasonText(rec, unitSystem, t);
  // The same sentence as `reasonFor`, built in here from `t` and the unit it
  // closes over: naming the per-render `reasonFor` needed an eslint-disable,
  // and that alone made React Compiler skip the whole screen.
  const proposed = useMemo(
    () =>
      template
        ? proposeTemplateChanges(template.exercises, recs, (rec) => reasonText(rec, unitSystem, t))
        : [],
    [template, recs, t, unitSystem],
  );
  // Lifts added to / removed from the template mid-session (S23-10), read off
  // the LIVE session — before the save prunes unstarted lifts, which are not
  // "removed" (core `template-structure.ts`).
  // Not when the program version moved since the session started (a Settings
  // switch mid-workout swaps the template's body under the same id): the
  // "differences" would be the other version's lifts, and Update would undo
  // the switch (review R2 P2-7). `templateVersion` is the start's snapshot.
  const programVersion = train.programVersion;
  const versionMoved = session?.templateVersion != null && programVersion !== session.templateVersion;
  const structure = useMemo(
    () => (template && session && !versionMoved ? proposeStructureChanges(template.exercises, session) : []),
    [template, session, versionMoved],
  );
  const autoApply = train.autoApplyProgression === true;
  const canWrite = template?.id != null && train.saveTemplate != null;

  /** Write a template's rows whole; false (and a toast) when it did not land. */
  async function writeRows(tpl: WorkoutTemplate, rows: TemplateExercise[]): Promise<boolean> {
    if (!tpl.id || !train.saveTemplate) return false;
    try {
      await train.saveTemplate(templateDraftWith(tpl, rows), tpl.id);
      return true;
    } catch {
      haptics.warning();
      showToast(t('train.rec.finish.applyErr'), { testID: 'train-toast' });
      return false;
    }
  }

  // Discard from the sheet (F14), confirmed from INSIDE it (a confirm host
  // nested in the sheet, which iOS can present): Cancel leaves the lifter on
  // the summary they were reading. Same words as the session's ⋯ Discard.
  const discard = train.discardWorkout;
  const onDiscard = discard && session
    ? () => {
        const n = sessionCounts(session).sets;
        confirmNative({
          title: t('train.discardWorkoutNamedTitle', { name: session.templateName || t('train.workout') }),
          body: n > 0 ? plural(t, locale, 'train.discardWorkoutLost', n) : t('train.discardConfirm'),
          confirmText: t('train.discardWorkout'),
          destructive: true,
          onConfirm: () => {
            onClose();
            void discard();
          },
        });
      }
    : undefined;

  if (!session || !recentSessions) return null;
  return (
    <FinishSheet
      visible={visible}
      session={session}
      recentSessions={recentSessions}
      onClose={onClose}
      onDiscard={onDiscard}
      // Reported at the finish boundary, where the whole session is in view
      // and a lift can still be repeated — not as a mid-set interruption.
      // Never gates the save: an unreadable set is still training that
      // happened, and refusing to store it would lose the evidence.
      invalid={invalid}
      calls={calls}
      proposed={canWrite ? proposed : []}
      structure={canWrite ? structure : []}
      templateName={canWrite ? template?.name ?? null : null}
      autoApply={autoApply}
      onFinish={async (extras, changes, shape) => {
        // `finishWorkout` answers `false` when it could not record the
        // finish at all (the hook's boolean contract); a legacy void resolve
        // reads as success. On failure the sheet stays up with the typed
        // values, says so, and does NOT spend a rating prompt — and the
        // template is not touched.
        const ok: unknown = await train.finishWorkout(extras);
        if (ok === false) return false;
        // The template moves only here, after the workout is recorded: the
        // changes the lifter just said yes to, or — with auto-apply on, the
        // one path without a question — every proposed move.
        // `finishProgression` returns `applied: null` with auto-apply off.
        const tpl = canWrite ? train.templates.find((x) => x.id === session.templateId) : undefined;
        let updated: string | null = null;
        let wrote: Promise<boolean> = Promise.resolve(true);
        let after = tpl;
        if (tpl) {
          const at = new Date();
          const { applied } = finishProgression({
            rows: tpl.exercises, recs, autoApply, at, reasonFor,
          });
          // The template as it stands NOW, not as the sheet opened on it.
          const loads = applied ?? (changes.length > 0 ? applyTemplateChanges(tpl.exercises, changes, { at, by: 'engine' }) : null);
          // Then its shape, only when the lifter said "Update" (S23-10) —
          // the lifter's change, so stamped `user`. One write for both.
          const rows = shape.length > 0
            ? applyStructureChanges(loads ?? tpl.exercises, shape, { at, by: 'user' })
            : loads;
          if (rows) {
            updated = tpl.name;
            after = { ...tpl, exercises: rows };
            // Behind the receipt, like the finish itself: a refusal toasts.
            wrote = writeRows(tpl, rows);
          }
        }
        // Program v2's one automatic switch waits for this session — AFTER
        // the progression write, and carrying its loads, so the switch never
        // lands under a write of the old body (`program.ts`).
        const auto = train.maybeAutoSwitchProgram;
        if (auto) {
          void wrote.then(() => auto(session, after)).then((switched) => {
            if (switched) showToast(t('train.program.autoSwitched'), { testID: 'train-toast-program' });
          }).catch(() => undefined);
        }
        onClose();
        haptics.success();
        // A finish recorded offline IS saved — on this phone, until the
        // signal returns — and the receipt says it in those words.
        // Share rides on the receipt — the moment a finished workout is worth
        // showing someone, and the one place it costs nothing to offer.
        const finished = session;
        const saved = isOffline() ? t('train.savedOnPhone') : t('train.workoutSaved');
        showToast(
          updated ? `${saved} · ${t('train.rec.finish.updated', { template: updated })}` : saved,
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
