import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Touchable } from './Touchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addActionsFor,
  exerciseIsFullyDone,
  formatLoad,
  looksLikeSameEffort,
  nextUnfinishedExercise,
  restAfterSet,
  sessionHasLoggedWork,
  sessionVolume,
  setRowLabels,
} from '@macrolog/core';
import type { TrainState } from '@/hooks/useTrain';
import { useRestCountdown, useRestTimer } from '@/hooks/useRestTimer';
import { NATIVE_SHEETS } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import { CardioBlockCard } from '@/components/train/CardioBlockCard';
import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';
import { RestNotifySheet } from '@/components/train/RestNotifySheet';
import { decideRestNotifyPriming, markRestNotifyPrimed } from '@/components/train/rest-notify-priming';
import { SetRowSheet } from '@/components/train/SetRowSheet';
import { ExerciseMenuSheet, type ExerciseMenuAction } from '@/components/train/ExerciseMenuSheet';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { tabBarOverlap } from '@/lib/glass';
import { RevealAboveKeyboardContext, useRevealAboveKeyboard } from './reveal-above-keyboard';
import { publishRestEndsAt } from '@/lib/active-workout-signal';
import { useIsOffline } from '@/lib/connectivity';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { requestNotificationPermission } from '@/lib/reminders';
import * as restActivity from '@/lib/rest-timer-activity';
import { subscribeIntentInbox, takeIntentInbox } from '../../../modules/intent-inbox';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type { Exercise, SessionExercise } from '@/lib/workout';
import { AddExerciseSheet } from './AddExerciseSheet';
import { CardioPickerSheet } from './CardioPickerSheet';
import { ExerciseCard } from './ExerciseCard';
import { ExerciseDetailSheet } from './ExerciseDetailSheet';
import { chainOrder, useInputChain } from './input-chain';
import { ReorderExercisesSheet } from './ReorderExercisesSheet';
import { RestPickerSheet } from './RestPickerSheet';
import {
  DEFAULT_REST_CLUSTER_SEC,
  DEFAULT_REST_MINI_SEC,
  clock,
  liftAllowsCluster,
  musclesAllowingCluster,
  recentSleepHours,
  recommendationFor,
  spokenDuration,
} from './train-summary';
import { createStyles } from './train-styles';
import { MenuButton, hasNativeMenuButton } from '@/components/MenuButton';
import { toMenuButtonActions } from './exercise-menu-native';

/**
 * A native sheet cannot be presented while another is still dismissing, and a
 * confirm asked from a closing sheet is hosted INSIDE it and goes with it. So
 * a menu row that opens a sheet or asks a question does it once the menu has
 * gone. The JS sheets never needed this (two RN Modals stack), and get none.
 */
const SHEET_HANDOFF_MS = 350;
const handoff = (run: () => void) => {
  if (NATIVE_SHEETS) setTimeout(run, SHEET_HANDOFF_MS);
  else run();
};
/**
 * The same, for a row picked from a ⋯ MENU. Where the binary has the system
 * pull-down (`hasNativeMenuButton`) every ⋯ pick comes from it — the sheet is
 * only its fallback — and a native menu has already closed when its pick fires
 * (`MenuButton`), so there is nothing to wait out: those picks paid 350 ms for
 * no reason (Train re-score 3, bug 5). A confirm still hands off with
 * {@link handoff}: that one IS a sheet going away.
 */
const menuHandoff = (run: () => void) => {
  if (hasNativeMenuButton) run();
  else handoff(run);
};

/** The rows an exercise's ⋯ can carry. */
type ExerciseMenuKey =
  | 'move-up' | 'move-down' | 'history' | 'replace' | 'cluster' | 'block'
  | 'plates' | 'rest' | 'rest-now' | 'lift' | 'remove';

/**
 * What one exercise's ⋯ offers, as plain values. The rows are built from this
 * and nothing else, so the open card's native menu can be rebuilt only when
 * one of these moves — it was a fresh array on every keystroke, which broke
 * the open card's memo and re-sent the menu across the bridge each time
 * (Train re-score 3, performance).
 */
interface ExerciseMenuShape {
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** The lift is in the catalog, so it has a history to show. */
  history: boolean;
  cluster: boolean;
  block: boolean;
  /** `null`: not a loaded lift, so no plate panel at all. */
  platesOpen: boolean | null;
  /** "1:30 after each set". */
  restDesc: string;
  /** "1:30" — what "Start rest now" will run. */
  restNow: string;
  /** The engine has a call to tune. */
  lift: boolean;
}

/** The ⋯ rows for a shape, each pressing through `run`. */
function exerciseMenuActions(shape: ExerciseMenuShape, run: (key: ExerciseMenuKey) => void): ExerciseMenuAction[] {
  const row = (
    key: ExerciseMenuKey,
    icon: ExerciseMenuAction['icon'],
    labelKey: I18nKey,
    extra: Partial<ExerciseMenuAction> = {},
  ): ExerciseMenuAction => ({ key, icon, labelKey, onPress: () => run(key), ...extra });
  return [
    ...(shape.canMoveUp ? [row('move-up', 'arrow-up-outline', 'train.moveUp')] : []),
    ...(shape.canMoveDown ? [row('move-down', 'arrow-down-outline', 'train.moveDown')] : []),
    // Strong's in-workout History tab, Hevy's tap on the name: what this lift
    // did before, without leaving the workout (Train re-score 3).
    ...(shape.history ? [row('history', 'stats-chart-outline', 'train.exHistoryMenu')] : []),
    row('replace', 'swap-horizontal-outline', 'train.replaceExercise'),
    ...(shape.cluster ? [row('cluster', 'layers-outline', 'train.addCluster', { descKey: 'train.addClusterDesc' })] : []),
    ...(shape.block ? [row('block', 'layers-outline', 'train.addBlock', { descKey: 'train.addBlockDesc' })] : []),
    ...(shape.platesOpen != null
      ? [row('plates', 'barbell-outline', shape.platesOpen ? 'train.hidePanel' : 'train.platesWarmup')]
      : []),
    // A rest on demand. The countdown otherwise starts only from a ticked
    // set, so a lifter who logs after the set (or rests between two lifts, or
    // between attempts on one) had no way to time it (UX_AUDIT S20).
    row('rest-now', 'hourglass-outline', 'train.startRestNow', { desc: shape.restNow }),
    row('rest', 'timer-outline', 'train.restTimer', { desc: shape.restDesc }),
    ...(shape.lift ? [row('lift', 'options-outline', 'train.lift.title')] : []),
    row('remove', 'trash-outline', 'train.removeExercise', { destructive: true }),
  ];
}

/** The open card's ⋯ as native rows, rebuilt only when its shape changes —
 *  `shapeKey` is the shape as JSON, so the memo compares one string. */
function useOpenMenuActions(
  shapeKey: string | null,
  run: (index: number, key: ExerciseMenuKey) => void,
  t: TFn,
) {
  return useMemo(() => {
    if (shapeKey == null) return undefined;
    const shape = JSON.parse(shapeKey) as ExerciseMenuShape;
    return toMenuButtonActions(exerciseMenuActions(shape, (key) => run(shape.index, key)), t);
  }, [shapeKey, run, t]);
}

/** When a rest of `secs` started now will end, epoch ms. Out here because the
 *  clock is impure, and the compiler will not have it inside the component. */
const restDeadline = (secs: number) => Date.now() + secs * 1000;

/** Large text: at 1.5× and up the set row's cells cannot share one line. */
const LARGE_TEXT_SCALE = 1.5;

/** How long after a lift's last set is ticked its card hands over to the next
 *  unfinished one — long enough to see the tick land and feel the haptic. */
const AUTO_ADVANCE_MS = 400;

/**
 * Per-exercise rests chosen from the ⋯ menu, by session id. Module state, so a
 * choice survives this component remounting mid-workout (a Retry, a reopen of
 * the tab) — it lived in `useState` alone and was lost every time (Train
 * re-score). A restart still forgets it; "Keep for this lift" in the picker is
 * the durable version, written to the template.
 */
const restOverridesBySession = new Map<string, Record<string, number>>();

type MenuFor = { kind: 'exercise'; index: number } | { kind: 'session' } | null;

/**
 * The live workout: a sticky header, the exercise cards, cardio, the rest bar
 * and every sheet the session opens — ONE of each (Train review item 31).
 */
/** The workout list: a plain ScrollView on iOS (see `automaticallyAdjustKeyboardInsets`
 *  where it is used), keyboard-aware on Android. Same ref and props either way. */
const SessionScroll = (Platform.OS === 'android' ? KeyboardAwareScrollView : ScrollView) as typeof ScrollView;

export function ActiveSession({
  train,
  bestByEx,
  onFinish,
}: {
  train: TrainState;
  /** Best estimated-1RM per exercise, from completed history. */
  bestByEx: Record<string, number>;
  /** Open the Finish sheet. It lives on the screen, not here: finishing
   *  unmounts this component, and a native sheet must be dismissed by an
   *  owner that is still mounted. */
  onFinish: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  const offline = useIsOffline();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= LARGE_TEXT_SCALE;
  const session = train.active!;
  const { dispatch, commitActive, undoRemoval } = train;
  // Set rows reveal their ± steppers above the keyboard through this.
  const scrollRef = useRef<ScrollView>(null);
  const keyboardReveal = useRevealAboveKeyboard(scrollRef);

  const [addFor, setAddFor] = useState<{ index: number; name: string } | 'add' | null>(null);
  const [cardioPickerOpen, setCardioPickerOpen] = useState(false);
  const [setSheet, setSetSheet] = useState<{ exerciseIndex: number; setIndex: number } | null>(null);
  const [menu, setMenu] = useState<MenuFor>(null);
  const [liftFor, setLiftFor] = useState<number | null>(null);
  const [restPickerFor, setRestPickerFor] = useState<number | null>(null);
  const [platesOpen, setPlatesOpen] = useState<number | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  /** The lift whose history the ⋯ menu opened, read-only. */
  const [historyFor, setHistoryFor] = useState<Exercise | null>(null);
  /** Per-exercise rest for THIS workout, by exercise id (stable across a
   *  move), seconds. Set from the ⋯ menu's "Rest timer"; mirrored into
   *  {@link restOverridesBySession} so a remount keeps it. */
  const [restOverride, setRestOverrideState] = useState<Record<string, number>>(
    () => (session.id ? restOverridesBySession.get(session.id) : undefined) ?? {},
  );
  const setRestOverride = (update: (cur: Record<string, number>) => Record<string, number>) => {
    setRestOverrideState((cur) => {
      const next = update(cur);
      if (session.id) restOverridesBySession.set(session.id, next);
      return next;
    });
  };
  // Only a rest that RAN OUT is announced as over — a skip, a −30 past zero
  // and a replace never reach `onElapsed`. And not one that ran out while the
  // phone was locked: the notification already said it (Train re-score bug 8).
  // The timer's own haptic covers sighted users; this is the VoiceOver/TalkBack
  // half (Train review item 18).
  const rest = useRestTimer({
    onElapsed: ({ late }) => {
      if (!late) announce(t('train.restDoneTitle'));
    },
  });
  /** Length of the countdown running now, for the progress track. */
  const [restTotal, setRestTotal] = useState(0);
  // The one-time "buzz when rest is over" priming (UX_AUDIT S18-10). Opened
  // by the FIRST rest start on this device when the OS has not been asked
  // yet; both answers record it as shown (`rest-notify-priming.ts`).
  const [restNotifyOpen, setRestNotifyOpen] = useState(false);
  // State, not a ref: the rest path is reachable from the ⋯ menu's rows,
  // which are built during render, and the compiler will not have a ref read
  // anywhere a render-time closure can reach.
  const [restNotifyAsked, setRestNotifyAsked] = useState(false);

  /**
   * Indices of blocks that overlap another block on this session in time.
   *
   * A SUGGESTION surfaced on the card, never an automatic merge (ADR-0026
   * decision 4): a false positive destroys a real training record, so the app
   * points at the pair and the person decides. The usual shape is one run
   * logged by hand and the same run detected by a ring.
   */
  const overlappingCardio = useMemo(() => {
    const blocks = session.cardio ?? [];
    const hits = new Set<number>();
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        if (looksLikeSameEffort(blocks[i], blocks[j])) {
          hits.add(i);
          hits.add(j);
        }
      }
    }
    return hits;
  }, [session.cardio]);
  // Accordion: one exercise expanded at a time so a 9-exercise session stays
  // scannable. Start on the first unfinished exercise.
  const [expanded, setExpanded] = useState<number | null>(() => {
    const i = session.exercises.findIndex((ex) => !exerciseIsFullyDone(ex));
    return i >= 0 ? i : 0;
  });
  const doneCount = session.exercises.filter(exerciseIsFullyDone).length;
  const volume = sessionVolume(session);
  /** The header's line after the clock: volume, then progress. */
  const metaParts = [
    ...(volume > 0 ? [formatLoad(volume, unitSystem, 0)] : []),
    ...(session.exercises.length > 0
      ? [t('train.progress', { done: doneCount, total: session.exercises.length })]
      : []),
  ];

  // Weight → reps → the next row, across the open card (`input-chain.ts`).
  const chain = useInputChain(() => chainOrder(train.active?.exercises ?? [], (i) => i === expanded));

  // Rest duration comes from the source template (mini sets get the shorter
  // rest); ad-hoc sessions fall back to the named defaults.
  const tpl = train.templates.find((tt) => tt.id === session.templateId);
  const restMini = tpl?.restMiniSec ?? DEFAULT_REST_MINI_SEC;
  const restCluster = tpl?.restClusterSec ?? DEFAULT_REST_CLUSTER_SEC;
  // Plain, not `useCallback`: the compiler memoizes it, and a manual memo
  // keyed on a value derived by `find` made it skip this whole component.
  const templateRowFor = (exerciseId: string) => tpl?.exercises.find((te) => te.exerciseId === exerciseId);
  // What the engine reads beyond the log (2026-10-07): which muscles the
  // weekly volume rules allow one more cluster, and the stall checklist's
  // sleep and mini-rest facts. The volume audit walks the week's sessions, so
  // it runs once here, not once per card; the cards get primitives.
  const phase = train.trainingPhase ?? 'cut';
  // The week is anchored on the session's start — pure, and close enough to
  // "now" for a seven-day window.
  const sessionStart = session.date.getTime();
  const clusterMuscles = useMemo(
    () => musclesAllowingCluster(train.recentSessions, train.catalog, phase, sessionStart),
    [train.recentSessions, train.catalog, phase, sessionStart],
  );
  const sleepHours = useMemo(() => recentSleepHours(train.recentSessions), [train.recentSessions]);
  /** The mini-set rest a lift is prescribed — its row's, else the template's.
   *  Unknown on an ad-hoc session: the stall check then says "no data". */
  const prescribedMiniRest = (exerciseId: string) => templateRowFor(exerciseId)?.restMiniSec ?? tpl?.restMiniSec;
  const recExtrasFor = (exerciseId: string) => {
    const restMiniSec = prescribedMiniRest(exerciseId);
    return {
      volumeAllowsCluster: liftAllowsCluster(clusterMuscles, train.catalog, exerciseId),
      stallContext: {
        ...(sleepHours != null ? { sleepHours } : {}),
        ...(restMiniSec != null ? { restMiniSec } : {}),
      },
    };
  };
  /** What a rest after this exercise's sets runs to with no override. */
  const restFallback = (exerciseIndex: number) => {
    const ex = session.exercises[exerciseIndex];
    return (ex && templateRowFor(ex.exerciseId)?.restMiniSec) ?? restMini;
  };

  // The rest that follows a set is decided by the set that comes NEXT (core
  // `restAfterSet`), and an exercise may carry its own mini-set rest — a
  // bodyweight cluster cannot shed load between efforts, so its intra-cluster
  // rest is longer than a loaded lift's without moving the template default.
  // A rest chosen from the ⋯ menu for this workout wins over both.
  const startRest = (exerciseIndex: number, setIndex: number) => {
    const ex = train.active?.exercises[exerciseIndex];
    if (!ex) return;
    const override = restOverride[ex.exerciseId];
    const mini = override ?? templateRowFor(ex.exerciseId)?.restMiniSec ?? restMini;
    const secs = restAfterSet(ex.sets, setIndex, { mini, cluster: override ?? restCluster });
    runRest(secs, ex.name);
  };

  /** "Start rest now" from an exercise's ⋯: the rest this lift's sets get —
   *  its ⋯ override, else its template row's, else the template's. */
  const startManualRest = (exerciseIndex: number) => {
    const ex = train.active?.exercises[exerciseIndex];
    if (!ex) return;
    haptics.tap();
    runRest(restOverride[ex.exerciseId] ?? restFallback(exerciseIndex), ex.name);
  };

  /** Run a rest of `secs`: the bar, the Lock Screen, the announcement and the
   *  one-time notification priming — one path for a ticked set and a manual
   *  start, so the two cannot drift. */
  const runRest = (secs: number, name: string) => {
    rest.start(secs);
    setRestTotal(secs);
    // Lock-screen countdown (Train review item 20): the rest Live Activity on
    // iOS, a no-op wherever its native module is absent.
    restActivity.start(restDeadline(secs), name, locale);
    announce(t('train.restStartedA11y', { time: clock(secs) }));
    // Decided once per session mount; the stored flag makes it once per device.
    if (!restNotifyAsked) {
      setRestNotifyAsked(true);
      void decideRestNotifyPriming().then((show) => {
        if (show) setRestNotifyOpen(true);
      });
    }
  };

  // Whenever a rest stops — skipped, run out, cut to zero — the Lock Screen
  // countdown goes with it. Keyed on the deadline, which moves on start, stop
  // and run-out only, never once a second.
  const prevEndsAt = useRef(rest.endsAt);
  useEffect(() => {
    if (prevEndsAt.current != null && rest.endsAt == null) restActivity.end();
    prevEndsAt.current = rest.endsAt;
    // The rest rides on the "Workout · 12:34" pill too, from any tab.
    publishRestEndsAt(rest.endsAt);
  }, [rest.endsAt]);
  useEffect(() => () => {
    restActivity.end();
    publishRestEndsAt(null);
  }, []);

  /** What the Lock Screen re-arms with if a resumed rest has to be put back
   *  after a restart: the lift whose set was ticked last, read once. Native
   *  does not report the title it is showing. */
  const [restoreTitle] = useState(() => {
    const ticked = [...session.exercises].reverse().find((ex) => ex.sets.some((x) => x.done));
    return { name: ticked?.name ?? session.exercises[0]?.name ?? '', locale };
  });

  // The Lock Screen's own "+30 s" / "Skip" (the rest Live Activity's buttons).
  // They run natively while JS may be suspended and move the Activity and the
  // pending notification themselves; what they cannot move is THIS bar, so they
  // leave a note in the intent inbox and this applies it — on mount, on
  // foreground, and the moment the inbox rings (`lib/rest-timer-activity.ts`
  // `applyRestInboxAction` decides; `targets/_shared/IntentInbox.swift` has the
  // hand-off). Read through a ref so the listeners register once.
  const restRef = useRef(rest);
  useEffect(() => {
    restRef.current = rest;
  });
  useEffect(() => {
    let alive = true;
    // First, a rest the Lock Screen is still counting from before a JS restart
    // (an iOS memory kill, an OTA reload while locked): put the bar back and
    // re-adopt the Activity so Finish and the buttons reach it again — or clear
    // a stale "Rest over" face nobody would (Train re-score bug 2). The drain
    // waits for it, so a Lock Screen +30 s queued meanwhile retargets the
    // restored rest instead of being judged against nothing.
    const reconciled = restActivity
      .reconcileWithNative(restoreTitle.name, restoreTitle.locale)
      .then((out) => {
        if (!alive || !out) return;
        restRef.current.start(out.seconds);
        setRestTotal(out.seconds);
      });
    const drain = () => {
      void takeIntentInbox(['rest']).then((actions) => {
        if (!alive) return;
        for (const action of actions) {
          if (action.kind !== 'rest') continue;
          const out = restActivity.applyRestInboxAction(action);
          if (!out) continue;
          if (out.type === 'skip') {
            // Silent, like the in-app skip: no buzz, no "rest over" announcement.
            restRef.current.stop();
            continue;
          }
          restRef.current.start(out.seconds);
          setRestTotal((total) => Math.max(total, out.seconds));
          // The app's own tick had already closed this rest (and its Activity)
          // before the drain ran — put the Lock Screen countdown back too.
          if (out.type === 'resume') restActivity.start(out.endsAt, out.exerciseName, out.locale);
        }
      });
    };
    void reconciled.then(drain);
    const unsubscribe = subscribeIntentInbox(drain);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain();
    });
    return () => {
      alive = false;
      unsubscribe();
      appState.remove();
    };
  }, [restoreTitle]);

  function adjustRest(delta: number) {
    haptics.tap();
    const next = Math.max(0, rest.remainingNow() + delta);
    rest.start(next);
    if (delta > 0) setRestTotal((total) => Math.max(total + delta, next));
    if (next > 0) restActivity.update(restDeadline(next));
  }

  async function answerRestNotify(allow: boolean) {
    setRestNotifyOpen(false);
    await markRestNotifyPrimed();
    if (!allow) return;
    // Granted: arm the countdown that surfaced the sheet — it started before
    // permission existed, so its own schedule resolved null.
    if (await requestNotificationPermission()) rest.rearm();
  }

  // A failed save is said once, with a warning haptic (Train review item 25).
  useEffect(() => {
    if (train.error && train.errorKind === 'save') haptics.warning();
  }, [train.error, train.errorKind]);

  const onToggle = useCallback((exerciseIndex: number) => {
    haptics.tap();
    setExpanded((cur) => (cur === exerciseIndex ? null : exerciseIndex));
  }, []);
  const onOpenMenu = useCallback((index: number) => setMenu({ kind: 'exercise', index }), []);
  const onOpenSetSheet = useCallback(
    (exerciseIndex: number, setIndex: number) => setSetSheet({ exerciseIndex, setIndex }),
    [],
  );
  const onOpenLift = useCallback((index: number) => setLiftFor(index), []);
  // Read through a ref: the callback keeps one identity for the memoized
  // cards, and the rest it starts reads the overrides of THIS render.
  const startRestRef = useRef(startRest);
  useEffect(() => {
    startRestRef.current = startRest;
  });
  // The live session, for callbacks that keep one identity for the memoized
  // cards but must act on the exercises as they stand when they fire.
  const exercisesRef = useRef(session.exercises);
  useEffect(() => {
    exercisesRef.current = session.exercises;
  });
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);
  const onSetDone = useCallback(
    (exerciseIndex: number, setIndex: number, info: { pr: boolean; complete: boolean }) => {
      // A record or the last set of the lift is a success; any other tick is
      // a tick (Train review items 25, 35).
      if (info.pr || info.complete) haptics.success();
      else haptics.tap();
      startRestRef.current(exerciseIndex, setIndex);
      // The lift is done: open the next unfinished one, the way Strong and
      // Hevy move on by themselves — it used to take a collapse and a tap.
      // Only if this card is still the open one when the beat is up; a lifter
      // who has already opened another card meant to.
      if (info.complete) {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(() => {
          advanceTimer.current = null;
          const next = nextUnfinishedExercise(exercisesRef.current, exerciseIndex);
          if (next != null) setExpanded((cur) => (cur === exerciseIndex ? next : cur));
        }, AUTO_ADVANCE_MS);
      }
    },
    [],
  );

  // Removals come with an Undo, as Today's do (Train re-score bug 3 and the
  // set-delete gap): the swipe, the rotor action and the set sheet all land
  // here. What was removed is kept in the toast's closure and put back by
  // core's `undoRemoval` — by exercise id, so a move in between cannot send a
  // set into the wrong lift.
  const onRemoveSet = useCallback(
    (exerciseIndex: number, setIndex: number) => {
      const ex = exercisesRef.current[exerciseIndex];
      const removed = ex?.sets[setIndex];
      if (!ex || !removed) return;
      void dispatch({ type: 'removeSet', exerciseIndex, setIndex });
      showToast(t('train.setRemoved'), {
        action: {
          label: t('common.undo'),
          onPress: () => undoRemoval({ kind: 'set', exerciseIndex, exerciseId: ex.exerciseId, setIndex, set: removed }),
        },
        testID: 'train-toast',
      });
    },
    [dispatch, undoRemoval, t],
  );
  function removeExercise(index: number) {
    const ex: SessionExercise | undefined = session.exercises[index];
    if (!ex) return;
    setPlatesOpen(null);
    void dispatch({ type: 'removeExercise', exerciseIndex: index });
    showToast(t('train.exerciseRemoved', { name: ex.name }), {
      action: {
        label: t('common.undo'),
        onPress: () => {
          undoRemoval({ kind: 'exercise', index, exercise: ex });
          setExpanded(index);
        },
      },
      testID: 'train-toast',
    });
  }

  function pressFinish() {
    // Nothing logged → offer the discard it really is (Train review bug 10):
    // finishing an empty session wrote a completed workout and kept the
    // streak alive.
    if (!sessionHasLoggedWork(session)) {
      confirm({
        title: t('train.nothingLoggedTitle'),
        body: t('train.nothingLoggedBody'),
        confirmText: t('train.discard'),
        destructive: true,
        onConfirm: () => void train.discardWorkout(),
      });
      return;
    }
    // No `await` on a commit first: the finish writes the whole session, and
    // offline that commit resolved only when the signal came back — Finish
    // did nothing until then (Train review bug 2).
    onFinish();
  }

  function confirmDiscard() {
    // Confirmed, like deleting a logged session: Discard deletes the
    // in-progress doc and nothing brings it back (UX_AUDIT S18-6).
    confirm({
      title: t('train.discard'),
      body: t('train.discardConfirm'),
      confirmText: t('train.discard'),
      destructive: true,
      onConfirm: () => void train.discardWorkout(),
    });
  }

  /** Move an exercise and keep the open card on the lift that was open. */
  function moveExercise(from: number, to: number) {
    train.moveExerciseInActive(from, to);
    setExpanded((cur) => {
      if (cur == null) return cur;
      if (cur === from) return to;
      if (from < cur && to >= cur) return cur - 1;
      if (from > cur && to <= cur) return cur + 1;
      return cur;
    });
  }

  // ── The ⋯ menus ──
  const reorderAction: ExerciseMenuAction[] = session.exercises.length > 1
    ? [{
        key: 'reorder',
        icon: 'reorder-three-outline',
        labelKey: 'train.reorderExercises',
        onPress: () => menuHandoff(() => setReorderOpen(true)),
      }]
    : [];
  const sessionActions: ExerciseMenuAction[] = train.editingExisting
    ? [
        {
          key: 'add-exercise',
          icon: 'add-circle-outline',
          labelKey: 'train.addExerciseTitle',
          onPress: () => menuHandoff(() => setAddFor('add')),
        },
        ...reorderAction,
        {
          // Editing a past workout: no destructive Discard (that deletes the
          // whole session). Cancel reverts to the pre-edit state.
          key: 'cancel-editing',
          icon: 'arrow-undo-outline',
          labelKey: 'common.cancel',
          onPress: () => void train.cancelEdit(),
        },
      ]
    : [
        {
          key: 'add-exercise',
          icon: 'add-circle-outline',
          labelKey: 'train.addExerciseTitle',
          onPress: () => menuHandoff(() => setAddFor('add')),
        },
        ...reorderAction,
        {
          key: 'add-cardio',
          icon: 'walk-outline',
          labelKey: 'cardio.add',
          onPress: () => menuHandoff(() => setCardioPickerOpen(true)),
        },
        {
          key: 'discard',
          icon: 'trash-outline',
          labelKey: 'train.discardWorkout',
          destructive: true,
          onPress: () => menuHandoff(confirmDiscard),
        },
      ];

  /** The catalog entry behind a session exercise, if it has one. */
  const catalogFor = (exerciseId: string): Exercise | null =>
    train.catalog.find((e) => e.id === exerciseId) ?? null;

  function exerciseMenuShape(index: number): ExerciseMenuShape | null {
    const ex = session.exercises[index];
    if (!ex) return null;
    const templateRow = templateRowFor(ex.exerciseId);
    const catalogEx = catalogFor(ex.exerciseId);
    // Which add-actions this lift can use (ADR-0040), through core's
    // precedence (template -> catalog -> inference) so an undeclared legacy
    // template keeps every affordance it was written with.
    const canAdd = addActionsFor(
      templateRow?.setStructure
        ?? catalogEx?.setStructure
        ?? (ex.sets.some((x) => x.kind === 'activation') ? undefined : 'straight'),
    );
    const override = restOverride[ex.exerciseId];
    return {
      index,
      canMoveUp: index > 0,
      canMoveDown: index < session.exercises.length - 1,
      history: catalogEx != null,
      cluster: canAdd.cluster,
      block: canAdd.block,
      platesOpen: (ex.logStyle ?? 'weight-reps') === 'weight-reps' ? platesOpen === index : null,
      restDesc: t('train.restTimerDesc', { time: clock(override ?? restFallback(index)) }),
      restNow: clock(override ?? restFallback(index)),
      lift: catalogEx != null
        && recommendationFor(
          { recentSessions: train.recentSessions, catalog: train.catalog },
          ex.exerciseId,
          templateRow,
          ex,
        ).action !== 'none',
    };
  }

  /** What one ⋯ row does — for the exercise as it stands when it fires. */
  function runExerciseAction(index: number, key: ExerciseMenuKey) {
    const ex = session.exercises[index];
    if (!ex) return;
    switch (key) {
      case 'move-up':
        moveExercise(index, index - 1);
        return;
      case 'move-down':
        moveExercise(index, index + 1);
        return;
      case 'history': {
        const catalogEx = catalogFor(ex.exerciseId);
        if (catalogEx) menuHandoff(() => setHistoryFor(catalogEx));
        return;
      }
      case 'replace':
        menuHandoff(() => {
          const open = () => setAddFor({ index, name: ex.name });
          // Replacing throws the logged sets away; say so first.
          if (ex.sets.some((s) => s.reps != null || s.durationSec != null)) {
            confirm({
              title: t('train.replaceLoggedTitle', { name: ex.name }),
              body: t('train.replaceLoggedBody'),
              confirmText: t('train.replace'),
              destructive: true,
              onConfirm: () => handoff(open),
            });
          } else open();
        });
        return;
      case 'cluster':
        void dispatch({ type: 'addCluster', exerciseIndex: index });
        return;
      case 'block':
        void dispatch({ type: 'addBlock', exerciseIndex: index });
        return;
      case 'plates':
        setPlatesOpen((o) => (o === index ? null : index));
        return;
      case 'rest':
        menuHandoff(() => setRestPickerFor(index));
        return;
      case 'rest-now':
        startManualRest(index);
        return;
      case 'lift':
        menuHandoff(() => setLiftFor(index));
        return;
      case 'remove':
        removeExercise(index);
        return;
    }
  }
  // One identity for the open card's memoized menu; each pick runs against
  // THIS render's session, read through the ref.
  const runExerciseActionRef = useRef(runExerciseAction);
  useEffect(() => {
    runExerciseActionRef.current = runExerciseAction;
  });
  const runStable = useCallback((index: number, key: ExerciseMenuKey) => runExerciseActionRef.current(index, key), []);
  const openShape = expanded != null ? exerciseMenuShape(expanded) : null;
  const openMenuActions = useOpenMenuActions(openShape ? JSON.stringify(openShape) : null, runStable, t);

  /** The fallback sheet's rows for one exercise. */
  const exerciseMenuActionsAt = (index: number): ExerciseMenuAction[] => {
    const shape = exerciseMenuShape(index);
    return shape ? exerciseMenuActions(shape, (key) => runExerciseAction(index, key)) : [];
  };
  const menuEx = menu?.kind === 'exercise' ? session.exercises[menu.index] : undefined;
  const sheetEx = setSheet ? session.exercises[setSheet.exerciseIndex] : undefined;
  const sheetSet = setSheet ? sheetEx?.sets[setSheet.setIndex] ?? null : null;
  const sheetLabel = setSheet && sheetEx ? setRowLabels(sheetEx.sets)[setSheet.setIndex] ?? '' : '';
  const liftEx = liftFor != null ? session.exercises[liftFor] : undefined;
  const liftCatalogEx = liftEx ? train.catalog.find((e) => e.id === liftEx.exerciseId) ?? null : null;
  const restEx = restPickerFor != null ? session.exercises[restPickerFor] : undefined;

  const title = session.templateName || t('train.workout');
  // "Keep for this lift" writes the rest onto the template row this lift came
  // from — only offered when there is one to write to.
  const restTemplateRow = restEx && tpl?.id ? templateRowFor(restEx.exerciseId) : undefined;
  async function saveRestForLift(exerciseId: string, seconds: number) {
    if (!tpl?.id) return;
    const { id, createdAt: _c, updatedAt: _u, ...draft } = tpl;
    try {
      await train.saveTemplate(
        {
          ...draft,
          exercises: tpl.exercises.map((te) => (te.exerciseId === exerciseId ? { ...te, restMiniSec: seconds } : te)),
        },
        id,
      );
      showToast(t('train.restSaved', { template: tpl.name }), { testID: 'train-toast' });
    } catch {
      haptics.warning();
      showToast(t('train.exerciseSaveErr'), { testID: 'train-toast' });
    }
  }

  return (
    <>
      {/* The session header — sticky, outside the scroll (Train review item
          5): what this workout is, how long it has run, how much has been
          lifted, where the writes are, and Finish where every other tracker
          keeps it. Discard moved into ⋯: a destructive action does not sit
          beside the one you came to press. */}
      <View style={styles.sessionHeader} testID="session-header">
        <View style={styles.sessionHeaderMain}>
          <Text style={styles.sessionEyebrow} accessibilityRole="header">
            {train.editingExisting ? t('train.editingSession') : t('train.inProgress')}
          </Text>
          <Text style={styles.sessionTitle} numberOfLines={1}>{title}</Text>
          {train.editingExisting ? (
            <Text style={styles.sessionMeta} numberOfLines={1}>
              {[formatDate(session.date, locale, { weekday: 'short', month: 'short', day: 'numeric' }), ...metaParts].join(' · ')}
            </Text>
          ) : (
            <ElapsedClock startedAt={session.date} parts={metaParts} />
          )}
          {/* Offline is said ONCE, in the note at the top of the list below.
              It was said three times — here, in that note, and in the app's
              OfflineBanner (whose copy is about MEALS) — on one screen
              (UX_AUDIT S20). "Saving…" stays: it is a different fact, and
              offline it would never clear, so it is not shown then. */}
          {!offline && train.saving ? (
            <Text style={styles.syncText}>{t('common.saving')}</Text>
          ) : null}
        </View>
        {/* A pull-down menu on tap — the system menu where the binary has it
            (S20); otherwise the session sheet below, from the same rows. */}
        <MenuButton
          style={styles.headerIconBtn}
          title={session.templateName ?? undefined}
          actions={toMenuButtonActions(sessionActions, t)}
          accessibilityLabel={t('train.sessionMenuA11y')}
          testID="session-menu"
          iconColor={colors.muted}
          onFallbackPress={() => setMenu({ kind: 'session' })}
        />
        {train.editingExisting ? (
          <Touchable
            style={styles.headerPrimary}
            onPress={() => void train.finishEdit()}
            accessibilityRole="button"
            testID="done-editing"
          >
            <Text style={styles.headerPrimaryText}>{t('train.doneEditing')}</Text>
          </Touchable>
        ) : (
          <Touchable
            style={styles.headerPrimary}
            onPress={pressFinish}
            accessibilityRole="button"
            testID="finish-workout"
          >
            <Text style={styles.headerPrimaryText}>{t('train.finish')}</Text>
          </Touchable>
        )}
      </View>

      <SessionScroll
        ref={scrollRef}
        onScroll={keyboardReveal.onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        // A drag through the list puts the keyboard away, the way every
        // logger behaves; tapping a set's own field still keeps it.
        keyboardDismissMode="on-drag"
        // iOS: pad for the keyboard and scroll the focused set field above it
        // (and above its ‹ › Done bar, which iOS counts as keyboard). Without
        // it a low set's field opened under the number pad, and dragging to
        // reveal it put the keyboard away (Impeccable audit, 2026-10-05).
        // Same prop as sign-in. iOS-only: under <KeyboardProvider> Android does
        // NOT resize the window for the IME, so there the list is
        // KeyboardAwareScrollView (`SessionScroll`), which does the same job.
        automaticallyAdjustKeyboardInsets
      >
        <RevealAboveKeyboardContext.Provider value={keyboardReveal.reveal}>
          {/* Failures during the workout are said HERE, on the workout — they
              used to render only on the idle screen, so a refused write left
              "Saving…" on screen and said nothing (Train review bug 3). */}
          {train.error ? (
            <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="session-error">
              <Text style={[styles.error, { flex: 1 }]}>
                {train.errorKind === 'save' ? t('train.workoutSaveErr') : t('train.loadErr')}
              </Text>
              <Touchable
                style={styles.errorBtn}
                onPress={() => {
                  train.clearError();
                  void commitActive();
                }}
                accessibilityRole="button"
                testID="session-retry"
              >
                <Text style={styles.discardText}>{t('common.retry')}</Text>
              </Touchable>
            </View>
          ) : null}
          {/* Offline, a queued write IS saved — on this phone, until the signal
              comes back — and this note says so in those words. The one
              offline message on the screen: the generic OfflineBanner is not
              mounted here, because its copy promises that MEALS are saved. */}
          {offline ? (
            <View
              style={styles.syncRow}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="session-offline-note"
            >
              <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
              <Text style={[styles.sheetHint, { flex: 1 }]}>{t('train.savedOnPhone')}</Text>
            </View>
          ) : null}

          {session.exercises.length === 0 && (session.cardio ?? []).length === 0 ? (
            <Text style={styles.empty}>{t('train.addFirst')}</Text>
          ) : null}
          {session.exercises.map((ex, exIdx) => (
            <ExerciseCard
              key={`${ex.exerciseId}-${exIdx}`}
              exercise={ex}
              exerciseIndex={exIdx}
              collapsed={expanded !== exIdx}
              recentSessions={train.recentSessions}
              catalog={train.catalog}
              templateRow={templateRowFor(ex.exerciseId)}
              best={bestByEx[ex.exerciseId]}
              volumeAllowsCluster={liftAllowsCluster(clusterMuscles, train.catalog, ex.exerciseId)}
              sleepHours={sleepHours}
              restMiniSec={prescribedMiniRest(ex.exerciseId)}
              platesOpen={platesOpen === exIdx}
              largeText={largeText}
              dispatch={dispatch}
              commitActive={commitActive}
              chain={chain}
              onToggle={onToggle}
              onOpenMenu={onOpenMenu}
              menuActions={expanded === exIdx ? openMenuActions : undefined}
              onOpenSetSheet={onOpenSetSheet}
              onOpenLift={onOpenLift}
              onSetDone={onSetDone}
              onRemoveSet={onRemoveSet}
            />
          ))}

          {(session.cardio ?? []).map((block, i) => (
            <CardioBlockCard
              key={`cardio-${block.sourceId ?? i}`}
              block={block}
              index={i}
              overlaps={overlappingCardio.has(i)}
              onPatch={(patch, opts) =>
                void dispatch({ type: 'patchCardio', blockIndex: i, patch }, opts)
              }
              onCommit={() => void commitActive()}
              onRemove={() => {
                haptics.tap();
                void dispatch({ type: 'removeCardio', blockIndex: i });
                // The same Undo a set or an exercise gets: a block imported
                // from Health, with its ring's numbers, was one stray tap from
                // gone with no way back from the workout (UX_AUDIT S20).
                showToast(t('cardio.removed'), {
                  action: {
                    label: t('common.undo'),
                    onPress: () => undoRemoval({ kind: 'cardio', index: i, block }),
                  },
                  testID: 'train-toast',
                });
              }}
            />
          ))}

          <Touchable
            style={styles.addExBtn}
            onPress={() => setAddFor('add')}
            accessibilityRole="button"
            testID="add-exercise"
          >
            <View style={styles.addExRow}>
              <Ionicons name="add" size={18} color={colors.muted} />
              <Text style={styles.addExText}>{t('train.addExercise')}</Text>
            </View>
          </Touchable>

          <Touchable
            style={styles.addExBtn}
            onPress={() => setCardioPickerOpen(true)}
            accessibilityRole="button"
            testID="add-cardio"
          >
            <View style={styles.addExRow}>
              <Ionicons name="add" size={18} color={colors.muted} />
              <Text style={styles.addExText}>{t('cardio.add')}</Text>
            </View>
          </Touchable>
          <View style={{ height: 40 }} />
        </RevealAboveKeyboardContext.Provider>
      </SessionScroll>

      {/* Rest countdown — floats above the tab bar AND clear of the raised
          Log button, so it stays visible while the session scrolls. Its own
          component: the second-by-second redraw belongs to the bar, not to
          the whole workout (Train re-score, performance). */}
      {rest.endsAt != null ? (
        <RestBar
          endsAt={rest.endsAt}
          total={restTotal}
          onAdjust={adjustRest}
          onSkip={rest.stop}
        />
      ) : null}

      <RestNotifySheet
        visible={restNotifyOpen}
        onAllow={() => void answerRestNotify(true)}
        onNotNow={() => void answerRestNotify(false)}
      />

      <SetRowSheet
        visible={sheetSet != null}
        set={sheetSet}
        label={sheetLabel}
        onClose={() => setSetSheet(null)}
        onKind={(kind) => {
          if (setSheet) void dispatch({ type: 'setSetKind', exerciseIndex: setSheet.exerciseIndex, setIndex: setSheet.setIndex, kind });
          setSetSheet(null);
        }}
        onRir={(rir) => {
          if (setSheet) {
            void dispatch(
              { type: 'patchSet', exerciseIndex: setSheet.exerciseIndex, setIndex: setSheet.setIndex, patch: { rir } },
              { defer: true },
            );
            void commitActive();
          }
          setSetSheet(null);
        }}
        onRemove={() => {
          const target = setSheet;
          setSetSheet(null);
          if (target) onRemoveSet(target.exerciseIndex, target.setIndex);
        }}
      />

      <ExerciseMenuSheet
        visible={menu != null && (menu.kind === 'session' || menuEx != null)}
        name={menu?.kind === 'exercise' ? menuEx?.name ?? '' : title}
        onClose={() => setMenu(null)}
        actions={
          menu?.kind === 'exercise'
            ? exerciseMenuActionsAt(menu.index)
            : menu ? sessionActions : []
        }
        testIDPrefix={menu?.kind === 'session' ? 'session-menu' : 'ex-menu'}
      />

      <LiftSettingsSheet
        visible={liftCatalogEx != null}
        exercise={liftCatalogEx}
        rec={liftEx
          ? recommendationFor(train, liftEx.exerciseId, templateRowFor(liftEx.exerciseId), liftEx, recExtrasFor(liftEx.exerciseId))
          : null}
        onClose={() => setLiftFor(null)}
        onSave={(patch) => (liftCatalogEx?.id ? train.editCatalogExercise(liftCatalogEx.id, patch) : Promise.resolve())}
      />

      <RestPickerSheet
        visible={restEx != null}
        name={restEx?.name ?? ''}
        current={restEx ? restOverride[restEx.exerciseId] ?? null : null}
        fallback={restPickerFor != null ? restFallback(restPickerFor) : restMini}
        saveTo={restTemplateRow && tpl ? tpl.name : null}
        onSave={(seconds) => {
          if (restEx) void saveRestForLift(restEx.exerciseId, seconds);
        }}
        onClose={() => setRestPickerFor(null)}
        onPick={(seconds) => {
          if (!restEx) return;
          setRestOverride((cur) => {
            const next = { ...cur };
            if (seconds == null) delete next[restEx.exerciseId];
            else next[restEx.exerciseId] = seconds;
            return next;
          });
        }}
      />

      {/* What this lift did before — the catalog sheet, read-only: editing,
          merging or deleting an exercise is not a mid-set job. */}
      <ExerciseDetailSheet
        visible={historyFor != null}
        exercise={historyFor}
        train={train}
        readOnly
        onClose={() => setHistoryFor(null)}
      />

      <ReorderExercisesSheet
        visible={reorderOpen}
        exercises={session.exercises}
        onMove={moveExercise}
        onClose={() => setReorderOpen(false)}
      />

      <AddExerciseSheet
        visible={addFor != null}
        train={train}
        replace={addFor && addFor !== 'add' ? addFor : null}
        onClose={() => setAddFor(null)}
      />
      <CardioPickerSheet
        visible={cardioPickerOpen}
        onClose={() => setCardioPickerOpen(false)}
        onPick={(modality) => void dispatch({ type: 'addCardio', modality })}
      />
    </>
  );
}

/**
 * The floating rest bar: progress, `Rest · 1:23`, −30 s / +30 s / Skip.
 *
 * Owns the per-second tick (`useRestCountdown`) so the redraw is this bar's
 * alone — when it lived in `ActiveSession`, every second of every rest
 * re-rendered the whole workout. Says "10 seconds of rest left" once on the
 * way down: the bar was announced when the rest began and when it ended, and
 * nothing in between, so a screen-reader user had to go and look.
 */
function RestBar({
  endsAt,
  total,
  onAdjust,
  onSkip,
}: {
  endsAt: number;
  /** Length of the whole countdown, seconds — the progress track's 100%. */
  total: number;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  // Above the floating glass tab bar on iOS 26, which covers the tab's foot.
  const lift = tabBarOverlap(useSafeAreaInsets().bottom);
  const { remaining, label } = useRestCountdown(endsAt);
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
  const prev = useRef(remaining);
  useEffect(() => {
    if (prev.current > REST_WARN_SEC && remaining <= REST_WARN_SEC && remaining > 0) {
      announce(t('train.restTenA11y'));
    }
    prev.current = remaining;
  }, [remaining, t]);
  return (
    <View style={[styles.restBarFloat, lift > 0 && { marginBottom: lift }]} testID="rest-bar">
      <View style={styles.restTrackWrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.restTrack} />
        <View style={[styles.restFill, { width: `${Math.round(progress * 100)}%` }]} testID="rest-progress" />
      </View>
      <View style={styles.restBarRow}>
        <Text style={styles.restLabel} testID="rest-label">{`${t('train.rest')} · ${label}`}</Text>
        <View style={styles.restActions}>
          {/* 44-pt targets (UX_AUDIT S18-15): the text is small on purpose
              inside a floating bar, so the box around it does the work. */}
          <Touchable
            onPress={() => onAdjust(-30)}
            style={styles.restBtn}
            accessibilityRole="button"
            accessibilityLabel={t('train.restMinusA11y')}
            testID="rest-minus"
          >
            <Text style={styles.restPlus}>{t('train.restMinusShort')}</Text>
          </Touchable>
          <Touchable
            onPress={() => onAdjust(30)}
            style={styles.restBtn}
            accessibilityRole="button"
            accessibilityLabel={t('train.restPlusA11y')}
            testID="rest-plus"
          >
            <Text style={styles.restPlus}>{t('train.restPlusShort')}</Text>
          </Touchable>
          <Touchable
            onPress={onSkip}
            style={styles.restBtn}
            accessibilityRole="button"
            testID="rest-skip"
          >
            <Text style={styles.restSkip}>{t('train.skip')}</Text>
          </Touchable>
        </View>
      </View>
    </View>
  );
}

/** The one mid-rest announcement, seconds left. */
const REST_WARN_SEC = 10;

/**
 * The session header's meta line — elapsed time, then `parts` (volume,
 * progress) — ticking once a second. Its own component so the tick re-renders
 * one Text, not the whole workout.
 *
 * The WHOLE line, not just the clock: the clock used to be a Text nested in
 * the header's Text, and iOS drops a nested Text's accessibility label, so
 * VoiceOver read "12:34" — a time of day — instead of the elapsed label
 * (Train re-score 3). One Text with one composed label says "Elapsed time:
 * 12 minutes 34 seconds, 2,450 lb, 2 of 5 done".
 */
function ElapsedClock({ startedAt, parts }: { startedAt: Date; parts: readonly string[] }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = (now - startedAt.getTime()) / 1000;
  const spoken = t('train.elapsedA11y', { time: spokenDuration(secs, t, locale) });
  return (
    <Text
      style={styles.sessionMeta}
      numberOfLines={1}
      accessibilityLabel={[spoken, ...parts].join(', ')}
      testID="session-elapsed"
    >
      {[clock(secs), ...parts].join(' · ')}
    </Text>
  );
}
