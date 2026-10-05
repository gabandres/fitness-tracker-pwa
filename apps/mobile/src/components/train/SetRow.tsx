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
  defaultIncrement,
  loadUnit,
  parseLoadToLb,
  setBeatsBest,
  toDisplayLoad,
} from '@macrolog/core';
import type { LogStyle, WorkoutSet } from '@/lib/workout';
import type { TrainState } from '@/hooks/useTrain';
import { KeyboardBar, useKeyboardBarProps } from '@/components/KeyboardBar';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { font } from '@/theme';
import type { ChainField, InputChain } from './input-chain';
import { kindLabelKey, numOrUndef } from './train-shared';
import { createStyles } from './train-styles';

/** The fixed-width numeric cells stop scaling here, so the row still fits
 *  at the largest Dynamic Type sizes (Train review item 17). */
const NUMERIC_FONT_CAP = 1.6;

/** One step of the ± buttons in the TRAINING unit: the smallest plate pair a
 *  gym has (2 × 1.25 lb is not a thing; 2.5 lb and 1.25 kg are). Half of
 *  core's default progression increment, which is the same pair of plates. */
const weightStep = (unitSystem: Parameters<typeof defaultIncrement>[0]) => defaultIncrement(unitSystem) / 2;

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
  /** The last row of the card: its reps field ends the keyboard chain. */
  isLastSet: boolean;
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
  isLastSet,
  best,
  largeText,
  dispatch,
  commitActive,
  onDone,
  onOpenSheet,
  chain,
}: SetRowProps) {
  const unitSystem = useUnitSystem();
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // Local string buffers so partial decimal input binds cleanly; the parsed
  // value is pushed into the session state via a deferred dispatch, persisted
  // on blur.
  //
  // The BUFFER is in the training unit and the dispatch is in POUNDS — the one
  // conversion, at the one boundary. Everything downstream (volume, e1RM,
  // progression) keeps working on a single scale (UX_AUDIT F3).
  const [weight, setWeight] = useState(
    set.weight != null ? String(toDisplayLoad(set.weight, unitSystem)) : '',
  );
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
  useEffect(() => {
    const typed = clampSetLoad(parseLoadToLb(weight, unitSystem));
    const same =
      typed == null || set.weight == null
        ? typed == null && set.weight == null
        : toDisplayLoad(typed, unitSystem) === toDisplayLoad(set.weight, unitSystem);
    if (!same) setWeight(set.weight != null ? String(toDisplayLoad(set.weight, unitSystem)) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.weight, unitSystem]);
  useEffect(() => {
    const stored = logStyle === 'time' ? set.durationSec : set.reps;
    if (numOrUndef(count) !== stored) setCount(stored != null ? String(stored) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.reps, set.durationSec, logStyle]);
  /** Which of this row's fields has the keyboard — it shows the ± steppers. */
  const [focused, setFocused] = useState<ChainField | null>(null);

  // What the template prescribed for this set, if it came from one. Shown as
  // the placeholder rather than the value: a target the lifter has not
  // confirmed is not a logged set (see WorkoutSet.targetReps).
  const target = logStyle === 'time' ? set.targetDurationSec : set.targetReps;
  // Falls back to what was actually done last time. This is the half the
  // one-tap path was missing: a PRESCRIBED set could be accepted with a tick,
  // but an ad-hoc or unprescribed one had nothing to accept and had to be
  // typed — which is most rows, for most users, on most sessions.
  const acceptCount =
    target ?? (logStyle === 'time' ? previousSet?.durationSec : previousSet?.reps);
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
  const remove = () => {
    swipeRef.current?.close();
    return dispatch({ type: 'removeSet', exerciseIndex, setIndex });
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

  function writeWeight(text: string) {
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
    setCount(text);
    const n = numOrUndef(text);
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
    writeWeight(String(next));
  }

  function stepCount(dir: 1 | -1) {
    haptics.tap();
    const from = numOrUndef(count) ?? acceptCount ?? 0;
    // A hold steps by five seconds; nobody adjusts a plank by one.
    writeCount(String(Math.max(0, from + dir * (logStyle === 'time' ? 5 : 1))));
  }

  const step = weightStep(unitSystem);
  const stepLabel = `${step} ${loadUnit(unitSystem)}`;

  const row = (
    <View style={styles.setRow}>
      <TouchableOpacity
        style={styles.setNumCell}
        onPress={() => onOpenSheet(exerciseIndex, setIndex)}
        accessibilityRole="button"
        accessibilityLabel={t('train.setTypeA11y', { n: label, kind: t(kindLabelKey(set.kind)) })}
        accessibilityHint={t('train.setSheetHint')}
        // The sheet's three jobs, reachable without opening it (Train review
        // item 14): VoiceOver's actions rotor, TalkBack's actions menu.
        accessibilityActions={[
          { name: 'activate' },
          { name: 'delete', label: t('train.removeSet') },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') onOpenSheet(exerciseIndex, setIndex);
          if (e.nativeEvent.actionName === 'delete') void remove();
        }}
        testID={`set-kind-${exerciseIndex}-${setIndex}`}
      >
        <Text style={[styles.setNum, set.group != null && styles.setNumCluster]} maxFontSizeMultiplier={NUMERIC_FONT_CAP}>
          {label}
        </Text>
      </TouchableOpacity>

      {/* PREVIOUS — read-only on purpose. It is the number to match or beat,
          and making it a field would invite typing into last week. At large
          text it moves to its own line above the row instead. */}
      {largeText ? null : (
        <View
          style={styles.setPrevCell}
          accessible
          accessibilityLabel={`${t('train.prevA11y')} ${previous ?? t('train.prevNone')}`}
          testID={`set-prev-${exerciseIndex}-${setIndex}`}
        >
          <Text
            style={[styles.setPrevText, !previous && styles.setPrevEmpty]}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={NUMERIC_FONT_CAP}
          >
            {previous ?? '—'}
          </Text>
        </View>
      )}

      {hasWeight ? (
        <>
          <TextInput
            ref={(r) => chain.register(weightSlot, r)}
            style={[styles.setInput, styles.setInputCell]}
            placeholder={
              previousSet?.weight != null
                ? String(toDisplayLoad(previousSet.weight, unitSystem))
                : '0'
            }
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
            accessibilityLabel={t('train.setWeightA11y', { n: label })}
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
        ref={(r) => chain.register(countSlot, r)}
        style={[styles.setInput, styles.setInputCell]}
        placeholder={acceptCount != null ? String(acceptCount) : '0'}
        placeholderTextColor={colors.faint}
        keyboardType="numeric"
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
        accessibilityLabel={
          logStyle === 'time'
            ? t('train.setDurationA11y', { n: label })
            : t('train.setRepsA11y', { n: label })
        }
        testID={`set-count-${exerciseIndex}-${setIndex}`}
      />
      <KeyboardBar
        nativeID={countBarId}
        onPrev={countHasPrev ? () => chain.prev(countSlot) : undefined}
        onNext={countHasNext ? () => chain.next(countSlot) : undefined}
      />

      {showRir ? (
        // A bare numeric box asked the user to know both the acronym and that
        // 0 is the hard end of the scale. Tapping opens the labelled picker in
        // the set sheet, so the scale explains itself.
        <TouchableOpacity
          style={[styles.setInput, styles.setRirCell, styles.setRirBtn]}
          onPress={() => onOpenSheet(exerciseIndex, setIndex)}
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
          let done: WorkoutSet = { ...set, done: nowDone };
          // Ticking a set you have not typed into ACCEPTS what was prescribed
          // — or, failing that, what you did last time. This is the one-tap
          // path Strong and Hevy use, and the reason neither number is
          // pre-filled as a VALUE: nothing is logged until this tap, so
          // abandoning a session mid-way records only what was actually done.
          // Typed input always wins; untick never erases.
          const accept = nowDone && acceptCount != null && numOrUndef(count) == null;
          if (accept) {
            setCount(String(acceptCount));
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
            setWeight(String(toDisplayLoad(previousSet.weight, unitSystem)));
            done = { ...done, weight: previousSet.weight };
            dispatch(
              { type: 'patchSet', exerciseIndex, setIndex, patch: { weight: previousSet.weight } },
              { defer: true },
            );
          }
          void dispatch({ type: 'patchSet', exerciseIndex, setIndex, patch: { done: nowDone } });
          // The haptic is the card's call: a tick, a record, or the last set
          // of the exercise each feel different (Train review item 25).
          if (nowDone) onDone(setIndex, done);
          else haptics.tap();
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
        <Text style={styles.setPrevLine} accessibilityLabel={`${t('train.prevA11y')} ${previous}`}>
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
        // screen destroy a logged set with no undo — stricter than the `✕`
        // this replaces, not looser, which would be the wrong trade for the
        // one gesture added to the busiest screen in the app.
        renderRightActions={() => (
          <TouchableOpacity
            style={styles.swipeDelete}
            onPress={() => {
              haptics.tap();
              void remove();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('train.removeSet')}
            testID={`set-swipe-delete-${exerciseIndex}-${setIndex}`}
          >
            <Ionicons name="trash-outline" size={18} color={colors.onInk} />
          </TouchableOpacity>
        )}
      >
        {row}
      </ReanimatedSwipeable>

      {isPr ? (
        <View
          style={[styles.prBadge, { alignSelf: 'flex-end' }]}
          accessible
          accessibilityLabel={t('train.prBadgeA11y')}
          testID={`set-pr-${exerciseIndex}-${setIndex}`}
        >
          <Text style={styles.prBadgeText}>{t('train.prBadge')}</Text>
        </View>
      ) : null}

      {/* ± steppers for the field that has the keyboard — 2.5 lb / 1.25 kg,
          one rep. Under the row rather than in it: the row is already the
          densest line on a 360dp screen, and these only matter while typing. */}
      {focused ? (
        <View style={styles.stepRow} testID={`set-steps-${exerciseIndex}-${setIndex}`}>
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
