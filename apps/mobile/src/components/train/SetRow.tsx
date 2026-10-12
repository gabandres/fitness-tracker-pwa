import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
// Swipe-to-delete on a set row. No `GestureHandlerRootView` is added here —
// the app root already mounts one (`src/app/_layout.tsx`), and the live
// session is not inside a Modal, which is the case that needs its own (see
// the template editor, where RNGH cannot see the app's root through the
// native modal view).
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import {
  clampSetLoad,
  countToAccept,
  defaultIncrement,
  loadUnit,
  parseLoadToLb,
  setBeatsBest,
  toDisplayLoad,
} from '@macrolog/core';
import type { LogStyle, WorkoutSet } from '@/lib/workout';
import type { TrainState } from '@/hooks/useTrain';
import { KeyboardBar, useKeyboardBarProps } from '@/components/KeyboardBar';
import { showToast } from '@/components/Toast';
import { useLocale, useT } from '@/i18n';
import { formatDecimal } from '@/lib/entry-input';
import * as haptics from '@/lib/haptics';
import { takeLockScreenAccepted } from '@/lib/lock-screen-ticks';
import { noteFocusTrigger } from '@/lib/return-focus';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { font } from '@/theme';
import type { ChainField, InputChain } from './input-chain';
import { kindLabelKey, numOrUndef } from './train-shared';
import { createStyles } from './train-styles';
import { useKeepAboveKeyboard } from './reveal-above-keyboard';

/** The set number's extra reach, left and right — see `setNumCell`. */
const SET_NUM_SLOP = { left: 8, right: 8 };

/** The fixed-width numeric cells stop scaling here, so the row still fits
 *  at the largest Dynamic Type sizes (Train review item 17). */
const NUMERIC_FONT_CAP = 1.6;

/** One step of the ± buttons in the TRAINING unit: the smallest plate pair a
 *  gym has (2 × 1.25 lb is not a thing; 2.5 lb and 1.25 kg are). Half of
 *  core's default progression increment, which is the same pair of plates. */
const weightStep = (unitSystem: Parameters<typeof defaultIncrement>[0]) => defaultIncrement(unitSystem) / 2;

/** How far PREVIOUS may shrink to fit its 52pt column: to 11pt and no
 *  further. 0.85 of `font.tiny` was 10.2pt — too small to read at arm's
 *  length (Train re-score 3; UX_AUDIT S20). Past the floor the text wraps to
 *  a second line ("102.5 ×" / "10") and then truncates, and the cell's label
 *  still says the whole thing. */
const PREV_MIN_PT = 11;
const PREV_MIN_FONT_SCALE = Math.min(1, PREV_MIN_PT / font.tiny);

/** A rep or second count as stored: whole. The pad has no decimal key, but a
 *  paste or an Android keyboard can still bring "8.5", and 8.5 reps is not a
 *  set anyone did (Train re-score 3). */
const wholeCount = (text: string): number | undefined => {
  const n = numOrUndef(text);
  return n == null ? undefined : Math.round(n);
};

/** An empty field with nothing to offer. A dash, never "0": a grey 0 beside
 *  PREVIOUS "190×8" read as a value the tick would log, and it was not one
 *  (Train re-score L-N1 / J-N3, R14). */
const NOTHING_TO_OFFER = '–';

/** Ticking would log a weighted set with no load: nothing typed, and no load
 *  last time to take. Exported for the test. */
export function needsLoad(hasWeight: boolean, typed: string, previousSet: WorkoutSet | undefined): boolean {
  return hasWeight && numOrUndef(typed) == null && previousSet?.weight == null;
}

/** The PR badge inside the set-number cell: tighter than the standalone one. */
const PR_IN_CELL = { alignSelf: 'flex-start', paddingHorizontal: 4, marginTop: 1 } as const;
/** The swipe action's icon over its label, ~72pt wide. */
const SWIPE_DELETE_BODY = { alignItems: 'center', gap: 2, minWidth: 56 } as const;

export interface SetRowProps {
  exerciseIndex: number;
  setIndex: number;
  set: WorkoutSet;
  logStyle: LogStyle;
  /** Row label from `setRowLabels` — "2" for a straight set, "2a/2b/2c"
   *  for a cluster. Derived by the parent, which holds the whole sequence. */
  label: string;
  /** Last session's numbers for THIS row position, pre-formatted by core. */
  previous: string | null;
  /** The same set, unformatted — the source for the one-tap "repeat last
   *  time". Passing both avoids re-parsing the string the cell just rendered. */
  previousSet?: WorkoutSet;
  /** The lift's own rep target (its progression rule) — what a working row
   *  with no prescription and no same-kind PREVIOUS offers (core
   *  `countToAccept`). */
  exerciseTargetReps?: number;
  /** The last row of the card: its reps field ends the keyboard chain. */
  isLastSet: boolean;
  /** The card shows an RIR column (`liftUsesRir`). Off: no RIR cell and no
   *  spacer — the number fields take the room; the set sheet still logs RIR. */
  rirColumn: boolean;
  /** Best estimated-1RM on record for this lift, for the "PR" badge. */
  best?: number;
  /** Large text (font scale ≥ 1.5): PREVIOUS moves to its own line. */
  largeText: boolean;
  dispatch: TrainState['dispatch'];
  commitActive: TrainState['commitActive'];
  /** A set was ticked done, with the set as it now stands. */
  onDone: (setIndex: number, done: WorkoutSet) => void;
  /** Open the ONE set sheet the session owns, for this row. */
  onOpenSheet: (exerciseIndex: number, setIndex: number) => void;
  /** Remove this set — the session's, so the removal comes with an Undo. */
  onRemove: (exerciseIndex: number, setIndex: number) => void;
  chain: InputChain;
}

/**
 * One set of a live exercise: the PREVIOUS column, the number fields, RIR and
 * the done box.
 *
 * Memoized, and handed `dispatch` / `commitActive` rather than the whole hook
 * result — which was a new object on every render of the tab, so every row of
 * every card re-rendered on each keystroke anywhere (Train review item 29).
 */
export const SetRow = memo(function SetRow({
  exerciseIndex,
  setIndex,
  set,
  logStyle,
  label,
  previous,
  previousSet,
  exerciseTargetReps,
  isLastSet,
  rirColumn,
  best,
  largeText,
  dispatch,
  commitActive,
  onDone,
  onOpenSheet,
  onRemove,
  chain,
}: SetRowProps) {
  const unitSystem = useUnitSystem();
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  /** A load in the training unit as the field shows it — with the locale's
   *  decimal mark. Every re-seed wrote `String(n)`, so a pt-BR lifter who
   *  typed "102,5" saw it come back as "102.5" (Train re-score 3). */
  const loadText = (lb: number) => formatDecimal(toDisplayLoad(lb, unitSystem), locale);
  // Local string buffers so partial decimal input binds cleanly; the parsed
  // value is pushed into the session state via a deferred dispatch, persisted
  // on blur.
  //
  // The BUFFER is in the training unit and the dispatch is in POUNDS — the one
  // conversion, at the one boundary. Everything downstream (volume, e1RM,
  // progression) keeps working on a single scale (UX_AUDIT F3).
  const [weight, setWeight] = useState(set.weight != null ? loadText(set.weight) : '');
  const [count, setCount] = useState(
    logStyle === 'time'
      ? set.durationSec != null ? String(set.durationSec) : ''
      : set.reps != null ? String(set.reps) : '',
  );
  // Re-seed the buffers when the SET changes underneath the row: an accepted
  // recommendation, the bump chip — or a delete above, which slides a
  // different set into this index-keyed row. Without this the field kept
  // showing whatever it was mounted with while the stored set had moved on,
  // and the next keystroke overwrote the accepted load. Skipped while the
  // buffer already parses to the stored value, so a half-typed "12." is never
  // rewritten to "12" under the user's thumb. Compared in the DISPLAY unit,
  // which is what survives the lb↔kg round trip.
  //
  //
  // Only the STORED set (and the unit, the log style) fire a re-seed; the
  // buffers it compares against and `loadText` are read, never followed — a
  // keystroke must not re-seed. They are read through `latest`, written by
  // the effect declared just before the re-seeds, so on any commit it runs
  // first and they see THIS render's values, as the closure did. The effects
  // used to name them under an eslint-disable, and the disable alone made
  // React Compiler skip the whole row. (Not `useEffectEvent`: under the test
  // renderer its closure was one render stale here, and a re-seed missed.)
  const latest = useRef({ weight, count, loadText });
  useEffect(() => {
    latest.current = { weight, count, loadText };
  });
  useEffect(() => {
    const typed = clampSetLoad(parseLoadToLb(latest.current.weight, unitSystem));
    const same =
      typed == null || set.weight == null
        ? typed == null && set.weight == null
        : toDisplayLoad(typed, unitSystem) === toDisplayLoad(set.weight, unitSystem);
    if (!same) setWeight(set.weight != null ? latest.current.loadText(set.weight) : '');
  }, [set.weight, unitSystem]);
  useEffect(() => {
    const stored = logStyle === 'time' ? set.durationSec : set.reps;
    if (numOrUndef(latest.current.count) !== stored) setCount(stored != null ? String(stored) : '');
  }, [set.reps, set.durationSec, logStyle]);
  /** Which of this row's fields has the keyboard — it shows the ± steppers. */
  const [focused, setFocused] = useState<ChainField | null>(null);
  // The steppers open under the field; the keyboard must not cover them.
  const stepRowRef = useRef<View>(null);
  useKeepAboveKeyboard(focused != null, stepRowRef);

  // What the template prescribed for this set, if it came from one. Shown as
  // the placeholder rather than the value: a target the lifter has not
  // confirmed is not a logged set (see WorkoutSet.targetReps).
  // Falls back to what was actually done last time. This is the half the
  // one-tap path was missing: a PRESCRIBED set could be accepted with a tick,
  // but an ad-hoc or unprescribed one had nothing to accept and had to be
  // typed — which is most rows, for most users, on most sessions. Then, on a
  // working row, to the lift's own target: a row whose PREVIOUS was a warm-up
  // offered 0 beside rows offering 8 (v3 QA).
  const acceptCount = countToAccept(set, previousSet, logStyle, exerciseTargetReps);
  /** The offer is last time's numbers, not a target (the a11y hint says which). */
  const fromLastTime = set.targetReps == null && set.targetDurationSec == null
    && (logStyle === 'time' ? previousSet?.durationSec : previousSet?.reps) != null;
  // RIR is meaningful on real working effort, not warmups/back-offs.
  // `continuation` carries RIR too: a rest-pause continuation is taken to
  // failure, so the reading is as meaningful there as on the activation.
  const showRir = set.kind === 'working' || set.kind === 'activation'
    || set.kind === 'mini' || set.kind === 'continuation';
  const hasWeight = logStyle === 'weight-reps';
  // A ticked set that beats every prior session — derived, not stored, so an
  // untick or an edit takes the badge away with it (Train review item 35).
  const isPr = !!set.done && setBeatsBest(set, logStyle, best);

  // Closed after a delete taken from the sheet, so the row that slides up into
  // this slot is not already swiped open.
  const swipeRef = useRef<SwipeableMethods>(null);
  const countInputRef = useRef<TextInput | null>(null);
  const weightInputRef = useRef<TextInput | null>(null);
  const remove = () => {
    swipeRef.current?.close();
    onRemove(exerciseIndex, setIndex);
  };

  const weightSlot = { exerciseIndex, setIndex, field: 'weight' as const };
  const countSlot = { exerciseIndex, setIndex, field: 'count' as const };
  const weightBarId = `set-kb-${exerciseIndex}-${setIndex}-w`;
  const countBarId = `set-kb-${exerciseIndex}-${setIndex}-c`;
  const weightBarProps = useKeyboardBarProps(weightBarId);
  const countBarProps = useKeyboardBarProps(countBarId);
  // Weight → reps → the next row. The last row's reps is the end of the line;
  // its Next gives way to Done. Android's numeric keypad has a real Return
  // key, so `returnKeyType` is the whole chain there; iOS has none, which is
  // what each field's `KeyboardBar` is for.
  const countHasNext = !isLastSet;
  const weightHasPrev = setIndex > 0;
  const countHasPrev = hasWeight || setIndex > 0;

  /**
   * What the last accepting tick put into this set that the lifter never
   * typed — last session's reps (or the target) and load. An untick takes it
   * back out: "logged" means a stored count, not `done`, so a tick-then-untick
   * left a phantom set on the card's count and in Finish (L2, ADR-0041:
   * nothing is stored as a value until the lifter confirms it). Any typing
   * clears it, so the untick never erases what was typed. A ref, so it lives
   * as long as the row does — a collapse unmounts the row and forgets it,
   * which errs toward keeping the set.
   */
  const accepted = useRef<{ count?: number; weight?: number } | null>(null);

  function writeWeight(text: string) {
    accepted.current = null;
    takeLockScreenAccepted(exerciseIndex, setIndex, set);
    setWeight(text);
    dispatch(
      {
        type: 'patchSet',
        exerciseIndex,
        setIndex,
        // Through the shared ceiling (@macrolog/core) for the same reason RIR
        // is: `parseLoadToLb` only converts units and rejects negatives, so a
        // mistyped 12750 was storable (#85).
        patch: { weight: clampSetLoad(parseLoadToLb(text, unitSystem)) },
      },
      { defer: true },
    );
  }

  function writeCount(text: string) {
    accepted.current = null;
    takeLockScreenAccepted(exerciseIndex, setIndex, set);
    setCount(text);
    const n = wholeCount(text);
    dispatch(
      {
        type: 'patchSet',
        exerciseIndex,
        setIndex,
        patch: logStyle === 'time' ? { durationSec: n } : { reps: n },
      },
      { defer: true },
    );
  }

  /** ± one step from what the field shows — or, empty, from what it would
   *  accept (last time's number), which is what the lifter is adjusting. */
  function stepWeight(dir: 1 | -1) {
    haptics.tap();
    const from = numOrUndef(weight)
      ?? (previousSet?.weight != null ? toDisplayLoad(previousSet.weight, unitSystem) : 0);
    const next = Math.max(0, Math.round((from + dir * weightStep(unitSystem)) * 100) / 100);
    writeWeight(formatDecimal(next, locale));
  }

  function stepCount(dir: 1 | -1) {
    haptics.tap();
    const from = numOrUndef(count) ?? acceptCount ?? 0;
    // A hold steps by five seconds; nobody adjusts a plank by one.
    writeCount(String(Math.max(0, from + dir * (logStyle === 'time' ? 5 : 1))));
  }

  // What VoiceOver / TalkBack say for a live number field. The grey number
  // in an empty field is a PLACEHOLDER — last time's load, or the target —
  // and a screen reader reads a placeholder exactly as it reads a value, so
  // "135" sounded logged when nothing was (UX_AUDIT S20). The label says
  // "empty" outright, and the placeholder's meaning moves to the hint.
  const weightHintValue = previousSet?.weight != null ? loadText(previousSet.weight) : null;
  const countHintKey = fromLastTime ? 'train.lastTimeHintA11y' : 'train.targetHintA11y';
  const fieldA11y = (base: string, text: string) =>
    text.trim() === '' ? `${base}, ${t('train.fieldEmptyA11y')}` : base;

  const step = formatDecimal(weightStep(unitSystem), locale);
  const stepLabel = `${step} ${loadUnit(unitSystem)}`;

  /** Untick: `done` off, and what the tick accepted — still unchanged —
   *  back out, in the same write. */
  function untick() {
    haptics.tap();
    // A Lock Screen "Done set" (S23-8) keeps its note outside the row.
    const lockScreen = takeLockScreenAccepted(exerciseIndex, setIndex, set);
    const took = accepted.current ?? lockScreen;
    accepted.current = null;
    const patch: Partial<WorkoutSet> = { done: false };
    const storedCount = logStyle === 'time' ? set.durationSec : set.reps;
    if (took?.count != null && storedCount === took.count) {
      if (logStyle === 'time') patch.durationSec = undefined;
      else patch.reps = undefined;
      setCount('');
    }
    if (took?.weight != null && set.weight === took.weight) {
      patch.weight = undefined;
      setWeight('');
    }
    void dispatch({ type: 'patchSet', exerciseIndex, setIndex, patch });
  }

  const row = (
    <View style={styles.setRow}>
      <TouchableOpacity
        style={styles.setNumCell}
        onPress={(e) => {
          // VoiceOver comes back here when the sheet closes (J10).
          noteFocusTrigger(e?.currentTarget);
          onOpenSheet(exerciseIndex, setIndex);
        }}
        hitSlop={SET_NUM_SLOP}
        accessibilityRole="button"
        accessibilityLabel={isPr
          ? `${t('train.setTypeA11y', { n: label, kind: t(kindLabelKey(set.kind)) })}, ${t('train.prBadgeA11y')}`
          : t('train.setTypeA11y', { n: label, kind: t(kindLabelKey(set.kind)) })}
        accessibilityHint={t('train.setSheetHint')}
        // The sheet's three jobs, reachable without opening it (Train review
        // item 14): VoiceOver's actions rotor, TalkBack's actions menu.
        accessibilityActions={[
          { name: 'activate' },
          { name: 'delete', label: t('train.removeSet') },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') onOpenSheet(exerciseIndex, setIndex);
          if (e.nativeEvent.actionName === 'delete') remove();
        }}
        testID={`set-kind-${exerciseIndex}-${setIndex}`}
      >
        <Text style={[styles.setNum, set.group != null && styles.setNumCluster, set.done && styles.setNumDone]} maxFontSizeMultiplier={NUMERIC_FONT_CAP}>
          {label}
        </Text>
        {/* The record badge lives INSIDE the row, under the set number: as a
            line of its own between rows it pushed every later row's tick box
            down ~20pt at the moment of the next tick (L-N3). The cell is 44pt
            tall and the number ~17, so the badge fits without growing it. Its
            words ride on the cell's label above. */}
        {isPr ? (
          <View style={[styles.prBadge, PR_IN_CELL]} testID={`set-pr-${exerciseIndex}-${setIndex}`}>
            <Text style={styles.prBadgeText} maxFontSizeMultiplier={1.2}>{t('train.prBadge')}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      {/* PREVIOUS — read-only on purpose. It is the number to match or beat,
          and making it a field would invite typing into last week. At large
          text it moves to its own line above the row instead. */}
      {largeText ? null : (
        // Not a focus stop: the weight and reps fields' hints already say
        // "Last time …", so a screen reader heard PREVIOUS twice and walked
        // six stops per set (L6). Five now.
        <View
          style={styles.setPrevCell}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          testID={`set-prev-${exerciseIndex}-${setIndex}`}
        >
          <Text
            style={[styles.setPrevText, !previous && styles.setPrevEmpty]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={PREV_MIN_FONT_SCALE}
            maxFontSizeMultiplier={NUMERIC_FONT_CAP}
          >
            {previous ?? '—'}
          </Text>
        </View>
      )}

      {hasWeight ? (
        <>
          <TextInput
            ref={(r) => {
              chain.register(weightSlot, r);
              weightInputRef.current = r;
            }}
            style={[styles.setInput, styles.setInputCell, set.done && styles.setInputDone]}
            placeholder={previousSet?.weight != null ? loadText(previousSet.weight) : NOTHING_TO_OFFER}
            placeholderTextColor={colors.faint}
            keyboardType="numeric"
            value={weight}
            onChangeText={writeWeight}
            onFocus={() => setFocused('weight')}
            onBlur={() => setFocused((f) => (f === 'weight' ? null : f))}
            onEndEditing={() => void commitActive()}
            // Replacing a number is the common edit; a tap selects it all.
            selectTextOnFocus
            maxFontSizeMultiplier={NUMERIC_FONT_CAP}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => chain.next(weightSlot)}
            {...weightBarProps}
            accessibilityLabel={fieldA11y(t('train.liveWeightA11y', { n: label }), weight)}
            accessibilityHint={
              weightHintValue != null
                ? t('train.lastTimeHintA11y', { value: `${weightHintValue} ${loadUnit(unitSystem)}` })
                : undefined
            }
            testID={`set-weight-${exerciseIndex}-${setIndex}`}
          />
          <KeyboardBar
            nativeID={weightBarId}
            onPrev={weightHasPrev ? () => chain.prev(weightSlot) : undefined}
            onNext={() => chain.next(weightSlot)}
          />
        </>
      ) : null}

      <TextInput
        ref={(r) => {
          chain.register(countSlot, r);
          countInputRef.current = r;
        }}
        style={[styles.setInput, styles.setInputCell, set.done && styles.setInputDone]}
        placeholder={acceptCount != null ? String(acceptCount) : NOTHING_TO_OFFER}
        placeholderTextColor={colors.faint}
        // Whole numbers: reps and seconds are counts, and the decimal pad
        // stored 8.5 reps (Train re-score 3).
        keyboardType="number-pad"
        value={count}
        onChangeText={writeCount}
        onFocus={() => setFocused('count')}
        onBlur={() => setFocused((f) => (f === 'count' ? null : f))}
        onEndEditing={() => void commitActive()}
        selectTextOnFocus
        maxFontSizeMultiplier={NUMERIC_FONT_CAP}
        returnKeyType={countHasNext ? 'next' : 'done'}
        submitBehavior={countHasNext ? 'submit' : 'blurAndSubmit'}
        onSubmitEditing={() => {
          if (countHasNext) chain.next(countSlot);
        }}
        {...countBarProps}
        accessibilityLabel={fieldA11y(
          logStyle === 'time'
            ? t('train.liveDurationA11y', { n: label })
            : t('train.liveRepsA11y', { n: label }),
          count,
        )}
        accessibilityHint={
          acceptCount != null ? t(countHintKey, { value: String(acceptCount) }) : undefined
        }
        testID={`set-count-${exerciseIndex}-${setIndex}`}
      />
      <KeyboardBar
        nativeID={countBarId}
        onPrev={countHasPrev ? () => chain.prev(countSlot) : undefined}
        onNext={countHasNext ? () => chain.next(countSlot) : undefined}
      />

      {!rirColumn ? null : showRir ? (
        // A bare numeric box asked the user to know both the acronym and that
        // 0 is the hard end of the scale. Tapping opens the labelled picker in
        // the set sheet, so the scale explains itself.
        <TouchableOpacity
          style={[styles.setInput, styles.setRirCell, styles.setRirBtn]}
          onPress={(e) => {
            noteFocusTrigger(e?.currentTarget);
            onOpenSheet(exerciseIndex, setIndex);
          }}
          accessibilityRole="button"
          // The label carries the CURRENT VALUE, not just the prompt. Before
          // 2026-08-18 it was the prompt alone, so VoiceOver announced the
          // question and never the answer — a user could not hear what RIR a
          // set was already on. It also made the value unassertable on iOS,
          // which merges a touchable's Text child into this single label:
          // a Maestro hierarchy dump of this cell showed the prompt and no
          // number anywhere in the tree, on a set whose RIR was plainly 2.
          accessibilityLabel={`${t('train.rirPrompt')} ${set.rir == null ? t('train.rirClear') : set.rir}`}
          accessibilityValue={{ text: set.rir == null ? t('train.rirClear') : String(set.rir) }}
          testID={`set-rir-${exerciseIndex}-${setIndex}`}
        >
          <Text style={[styles.setRirValue, set.rir == null && styles.setRirEmpty]} maxFontSizeMultiplier={NUMERIC_FONT_CAP}>
            {set.rir == null ? '–' : String(set.rir)}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.setRirCell} />
      )}

      <TouchableOpacity
        style={styles.setDoneCell}
        // A checkbox with state, not a button that says "Done" whether or not
        // it is (UX_AUDIT S18-3). The cell is the 44pt target; the box inside
        // is what is drawn.
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!set.done }}
        accessibilityLabel={t('train.setDoneA11y', { n: label })}
        onPress={() => {
          const nowDone = !set.done;
          // Nothing typed and nothing to accept: a tick would mark the set done
          // while logging nothing, and the card's "0/2" disagreed with two
          // ticked boxes (Maestro 22). Ask for the number instead.
          // Said on screen too: a haptic and a focus move told a sighted
          // lifter nothing about WHY the tick did not land (Train re-score
          // 3). The toast is announced, so it replaces the old announce.
          if (nowDone && acceptCount == null && numOrUndef(count) == null) {
            haptics.warning();
            showToast(t(logStyle === 'time' ? 'train.enterTimeFirst' : 'train.enterRepsFirst'), {
              testID: 'train-toast',
            });
            countInputRef.current?.focus();
            return;
          }
          // The same for the LOAD of a weighted lift: no weight typed and none
          // to take from last time logged "0 × 8" for a barbell lift on the
          // first session of a starter, and for a lift whose PREVIOUS row was
          // another kind (L-N2 / J-N4, R50). Typing 0 is still a deliberate
          // entry; bodyweight and timed lifts have no load to ask for.
          if (nowDone && needsLoad(hasWeight, weight, previousSet)) {
            haptics.warning();
            showToast(t('train.enterWeightFirst'), { testID: 'train-toast' });
            weightInputRef.current?.focus();
            return;
          }
          if (!nowDone) {
            untick();
            return;
          }
          let done: WorkoutSet = { ...set, done: nowDone };
          const inserted: { count?: number; weight?: number } = {};
          // Ticking a set you have not typed into ACCEPTS what was prescribed
          // — or, failing that, what you did last time. This is the one-tap
          // path Strong and Hevy use, and the reason neither number is
          // pre-filled as a VALUE: nothing is logged until this tap, so
          // abandoning a session mid-way records only what was actually done.
          // Typed input always wins; an untick takes back only what this tick
          // accepted (`untick`), never what was typed.
          const accept = nowDone && acceptCount != null && numOrUndef(count) == null;
          if (accept) {
            setCount(String(acceptCount));
            inserted.count = acceptCount;
            done = logStyle === 'time' ? { ...done, durationSec: acceptCount } : { ...done, reps: acceptCount };
            // Deferred: the `done` patch below persists, and it reads the same
            // ref this one just updated, so one write carries both. Two
            // immediate writes would race for no benefit.
            dispatch(
              {
                type: 'patchSet',
                exerciseIndex,
                setIndex,
                patch: logStyle === 'time' ? { durationSec: acceptCount } : { reps: acceptCount },
              },
              { defer: true },
            );
          }
          // The LOAD comes along with it. A repeated set at no weight is not a
          // record of the set that was performed, and retyping the same 135
          // every session is the friction the PREVIOUS column exists to remove.
          if (nowDone && hasWeight && numOrUndef(weight) == null && previousSet?.weight != null) {
            setWeight(loadText(previousSet.weight));
            inserted.weight = previousSet.weight;
            done = { ...done, weight: previousSet.weight };
            dispatch(
              { type: 'patchSet', exerciseIndex, setIndex, patch: { weight: previousSet.weight } },
              { defer: true },
            );
          }
          accepted.current = inserted.count != null || inserted.weight != null ? inserted : null;
          void dispatch({ type: 'patchSet', exerciseIndex, setIndex, patch: { done: true } });
          // The haptic is the card's call: a tick, a record, or the last set
          // of the exercise each feel different (Train review item 25).
          onDone(setIndex, done);
        }}
        testID={`set-done-${exerciseIndex}-${setIndex}`}
      >
        <View style={[styles.doneBox, set.done && styles.doneBoxOn]}>
          <Ionicons name="checkmark" size={font.small + 2} style={[styles.doneCheck, set.done && styles.doneCheckOn]} />
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <View>
      {largeText && previous ? (
        // Hidden from screen readers like the column (L6): the fields' hints
        // say "Last time …".
        <Text
          style={styles.setPrevLine}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          testID={`set-prev-line-${exerciseIndex}-${setIndex}`}
        >
          {`${t('train.prevA11y')}: `}
          <Text testID={`set-prev-${exerciseIndex}-${setIndex}`}>{previous}</Text>
        </Text>
      ) : null}
      {/* Swipe-left to delete — the gesture the whole category uses for this.
          The permanent `✕` it replaces was a seventh target on every row: the
          smallest, the most destructive, and directly beside the one control
          tapped after every single set. The set sheet carries the same action
          as a labelled row, and the set number carries it as an accessibility
          action, which is what keeps it reachable by VoiceOver and by anyone
          who does not know the gesture. */}
      <ReanimatedSwipeable
        ref={swipeRef}
        friction={2}
        rightThreshold={40}
        overshootRight={false}
        // The swipe REVEALS; the tap deletes. Deleting on
        // `onSwipeableOpen` would make an over-enthusiastic scroll on a wet
        // screen destroy a logged set — stricter than the `✕` this replaces,
        // not looser, which would be the wrong trade for the one gesture
        // added to the busiest screen in the app. The tap's delete then comes
        // with an Undo toast (the session's `onRemove`), as Today's does.
        renderRightActions={() => (
          <TouchableOpacity
            style={styles.swipeDelete}
            onPress={() => {
              haptics.tap();
              remove();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('train.removeSetNamedA11y', { n: label })}
            testID={`set-swipe-delete-${exerciseIndex}-${setIndex}`}
          >
            {/* Words as well as the bin, and the set's own label: the swipe
                slides "1c" off-screen, so the action names what it deletes
                (L-N15, R69). */}
            <View style={SWIPE_DELETE_BODY}>
              <Ionicons name="trash-outline" size={18} color={colors.onFill} />
              <Text style={[styles.prBadgeText, { color: colors.onFill }]} maxFontSizeMultiplier={1.4} numberOfLines={1}>
                {t('train.deleteSetShort', { n: label })}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      >
        {row}
      </ReanimatedSwipeable>

      {/* ± steppers for the field that has the keyboard — 2.5 lb / 1.25 kg,
          one rep. Under the row rather than in it: the row is already the
          densest line on a 360dp screen, and these only matter while typing. */}
      {focused ? (
        <View ref={stepRowRef} style={styles.stepRow} testID={`set-steps-${exerciseIndex}-${setIndex}`}>
          {focused === 'weight' ? (
            <>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => stepWeight(-1)}
                accessibilityRole="button"
                accessibilityLabel={t('train.weightDownA11y', { step: stepLabel })}
                testID={`set-weight-down-${exerciseIndex}-${setIndex}`}
              >
                <Text style={styles.stepText}>{`−${step}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => stepWeight(1)}
                accessibilityRole="button"
                accessibilityLabel={t('train.weightUpA11y', { step: stepLabel })}
                testID={`set-weight-up-${exerciseIndex}-${setIndex}`}
              >
                <Text style={styles.stepText}>{`+${step}`}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => stepCount(-1)}
                accessibilityRole="button"
                accessibilityLabel={t('train.repsDownA11y')}
                testID={`set-count-down-${exerciseIndex}-${setIndex}`}
              >
                <Text style={styles.stepText}>{logStyle === 'time' ? '−5s' : '−1'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => stepCount(1)}
                accessibilityRole="button"
                accessibilityLabel={t('train.repsUpA11y')}
                testID={`set-count-up-${exerciseIndex}-${setIndex}`}
              >
                <Text style={styles.stepText}>{logStyle === 'time' ? '+5s' : '+1'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
});
