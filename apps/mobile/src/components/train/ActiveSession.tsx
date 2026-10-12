import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useReducedMotion } from 'react-native-reanimated';
import { Touchable } from './Touchable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addActionsFor,
  exerciseIsFullyDone,
  formatLoad,
  looksLikeSameEffort,
  nextUnfinishedExercise,
  groupRest,
  isSupersetted,
  moveBlockAware,
  restAfterSetInFlow,
  roundRestWithFloor,
  CLUSTER_ESTIMATE_SEC,
  DEFAULT_TRANSITION_REST_SEC,
  supersetGroups,
  supersetTags,
  sessionHasLoggedWork,
  sessionVolume,
  setRowLabels,
  structureOf,
  type RestKind,
} from '@macrolog/core';
import type { TrainState } from '@/hooks/useTrain';
import { useRestCountdown, useRestTimer } from '@/hooks/useRestTimer';
import { NATIVE_SHEETS } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { UNDO_TOAST_MS, showToast } from '@/components/Toast';
import { CardioBlockCard } from '@/components/train/CardioBlockCard';
import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';
import { RestNotifySheet } from '@/components/train/RestNotifySheet';
import { decideRestNotifyPriming, markRestNotifyPrimed } from '@/components/train/rest-notify-priming';
import { SetRowSheet } from '@/components/train/SetRowSheet';
import { ExerciseMenuSheet, type ExerciseMenuAction } from '@/components/train/ExerciseMenuSheet';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { announce, isScreenReaderOn } from '@/lib/a11y';
import { noteFocusTrigger, useReturnFocusOnClose } from '@/lib/return-focus';
import { tabBarOverlap } from '@/lib/glass';
import { nowMs } from '@/lib/clock';
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
import { DEFAULT_LOG_STYLE, isLoggedSet, type Exercise, type SessionExercise, type SetKind } from '@/lib/workout';
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
  sideRecommendationsFor,
  spokenDuration,
} from './train-summary';
import { createStyles } from './train-styles';
import { space } from '@/theme';
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
  | 'plates' | 'rest' | 'rest-now' | 'lift' | 'remove' | 'unpair-today';

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
  /** In a superset: "Unpair for today"'s description; null otherwise. */
  unpairToday: string | null;
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
    // A superset done unpaired for ONE workout — the load-test advice the
    // template editor gives, actionable without editing the template.
    ...(shape.unpairToday ? [row('unpair-today', 'git-branch-outline', 'train.superset.unpairToday', { desc: shape.unpairToday })] : []),
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

/** The sticky session header's title and meta stop growing here. Uncapped,
 *  at accessibility sizes the header alone took a third of the screen and,
 *  with the rest bar, left about one and a half set rows (L-N8 / J-N5, R12).
 *  The set list below keeps growing; the chrome around it does not. */
const HEADER_FONT_CAP = 1.4;
/** Its buttons stop a little later, as the sheet headers' do. */
const HEADER_BUTTON_CAP = 1.6;

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
 * A ref that holds the latest `value`, written after each commit — for a
 * callback that keeps one identity but must act on this render's closure.
 * The same `useRef` + effect the screen wrote inline, behind a hook boundary:
 * inline, the effect's `ref.current = fn` made React Compiler treat a call
 * through the ref as a call of `fn` itself, so it could not keep the
 * callback's `useCallback` and skipped the whole session screen. The ref is
 * one object for the life of the component, so listing it as a dependency
 * changes nothing.
 */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

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
  onOpenGlossary,
}: {
  train: TrainState;
  /** Best estimated-1RM per exercise, from completed history. */
  bestByEx: Record<string, number>;
  /** Open the Finish sheet. It lives on the screen, not here: finishing
   *  unmounts this component, and a native sheet must be dismissed by an
   *  owner that is still mounted. */
  onFinish: () => void;
  /** The Train glossary — in the session ⋯ while a workout runs, because the
   *  page header that carried its "?" is not shown then (L4). */
  onOpenGlossary: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  const offline = useIsOffline();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= LARGE_TEXT_SCALE;
  const reduceMotion = useReducedMotion();
  const session = train.active!;
  const { dispatch, commitActive, undoRemoval } = train;
  // Set rows reveal their ± steppers above the keyboard through this.
  const scrollRef = useRef<ScrollView>(null);
  const keyboardReveal = useRevealAboveKeyboard(scrollRef);

  const [addFor, setAddFor] = useState<{ index: number; name: string } | 'add' | null>(null);
  /** How many exercises the session had when Add opened: an add appends, so
   *  the first new card lands at this index (L-N10). */
  const [addBase, setAddBase] = useState(0);
  const openAdd = () => {
    setAddBase(session.exercises.length);
    setAddFor('add');
  };
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
  /** When each lift's last set was ticked this workout (exercise id → ms). */
  const [lastSetAt, setLastSetAt] = useState<Record<string, number>>({});
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
  /** What the running rest leads into, inside a superset ("A2 · Leg Curls"),
   *  so both stations can be set up during it. Null outside one. State, not a
   *  ref, for the reason `restNotifyAsked` below gives. */
  const [restNext, setRestNext] = useState<string | null>(null);
  /** "Switch to A2" / "Round 2 of 3" over the countdown; null for an ordinary rest. */
  const [restHeading, setRestHeading] = useState<string | null>(null);
  /** The card the running rest leads into — it carries the "Up next" badge. */
  const [restTarget, setRestTarget] = useState<number | null>(null);
  /** The lift whose set started the running rest — a tap on the countdown
   *  opens ITS rest picker (L16). */
  const [restFrom, setRestFrom] = useState<number | null>(null);
  /** Which rest is running, and whose: a superset's switch or round rest, or
   *  one lift's own rest between its clusters / after it (`owner`). A tap on
   *  the countdown opens the picker on THAT rest, so it can say which one it
   *  edits and show the value running (L16 follow-up). */
  const [restRunning, setRestRunning] = useState<{ kind: RestKind; owner: number } | null>(null);
  /** The picker was opened from the countdown: mark the running rest's row. */
  const [restPickerRunning, setRestPickerRunning] = useState<{ kind: RestKind; owner: number } | null>(null);
  const rest = useRestTimer({
    onElapsed: ({ late }) => {
      if (!late) {
        announce(restNext
          ? t('train.superset.restOverA11y', { next: restNext })
          : t('train.restDoneTitle'));
      }
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
  /** "A1" per card from the REAL groups — a partner removed or replaced leaves
   *  no stale tag, and the rest bar and the cards always agree. */
  const sessionTags = useMemo(() => supersetTags(session.exercises), [session.exercises]);
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
  //
  // Inside a superset the flow decides instead (core `restAfterSetInFlow`):
  // A1 → transition → A2 → round → A1, a leftover cluster on its own rest, and
  // the mini-set rest inside a cluster unchanged. The group's two rests were
  // snapshotted onto the session at start, so the template is not consulted.
  /** One exercise's ordinary rests, every override already applied. In a
   *  superset the ⋯ override is the GROUP's rest (switch and round, below) —
   *  never the mini-set rest, which would break the myo-rep protocol. */
  const restSecondsFor = (exerciseIndex: number) => {
    const ex = train.active?.exercises[exerciseIndex];
    // Real membership (a partner removed leaves the field behind on the lift
    // that stays): a lone lift's override applies to its own rests again.
    const exercises = train.active?.exercises ?? [];
    const paired = ex != null && isSupersetted(exercises, exerciseIndex);
    // A paired lift's own between-cluster / after-exercise rest, picked from
    // the countdown (its leftover round runs on it) — never its mini rest.
    const override = ex ? (paired ? restOverride[ownKey(ex.exerciseId)] : restOverride[ex.exerciseId]) : undefined;
    const row = ex ? templateRowFor(ex.exerciseId) : undefined;
    // After the lift's last set, the row's rest before the NEXT exercise (90 s
    // into the same muscle, 60 s across, 2026-10-09) — the template's cluster
    // rest when the row states none.
    const afterExercise = override ?? row?.restAfterSec;
    return {
      mini: (paired ? undefined : override) ?? row?.restMiniSec ?? restMini,
      // Program v2: a row may rest its own clusters differently (the lateral
      // raise's 60 s into its second cluster on a 105 s day).
      cluster: override ?? ex?.restClusterSec ?? row?.restClusterSec ?? restCluster,
      ...(afterExercise != null ? { afterExercise } : {}),
    };
  };
  /** A superset's rests chosen for this workout from the ⋯ picker — kept in
   *  the same per-session override map under reserved keys, so they survive
   *  a remount the same way a lift's own override does. */
  const groupKey = (group: string, field: 'transition' | 'round') => `~${group}.${field}`;
  /** A superset member's own between-cluster rest (same map, reserved key). */
  const ownKey = (exerciseId: string) => `~own.${exerciseId}`;
  /** A lift's between-cluster rest and its rest after the lift, with no
   *  override — what the picker's "Default" names. */
  const baseOwnRest = (exerciseIndex: number) => {
    const ex = session.exercises[exerciseIndex];
    const row = ex ? templateRowFor(ex.exerciseId) : undefined;
    const cluster = ex?.restClusterSec ?? row?.restClusterSec ?? restCluster;
    return { cluster, afterExercise: row?.restAfterSec ?? cluster };
  };
  /** The session's exercises as the flow reads them: group overrides applied. */
  const flowRows = (exercises: readonly SessionExercise[]) => exercises.map((e) => {
    if (!e.supersetGroup) return e;
    const tr = restOverride[groupKey(e.supersetGroup, 'transition')];
    const ro = restOverride[groupKey(e.supersetGroup, 'round')];
    return tr == null && ro == null ? e : { ...e, ...(tr != null ? { transitionRestSec: tr } : {}), ...(ro != null ? { roundRestSec: ro } : {}) };
  });
  /** `lead`: what the tick logged ("Set 2 logged, 190 lb, 8 reps."), spoken
   *  in the same announcement as the rest — two announcements cancel each
   *  other on iOS. */
  const startRest = (exerciseIndex: number, setIndex: number, lead?: string) => {
    const exercises = train.active?.exercises;
    const ex = exercises?.[exerciseIndex];
    if (!exercises || !ex) return null;
    // When each lift's last set was ticked — what the minimum-rest rule below
    // measures from (in memory only: a set carries no timestamp).
    // Only ever reached from a tap (set done), never from render.
    const now = nowMs();
    setLastSetAt((m) => ({ ...m, [ex.exerciseId]: now }));
    const rows = flowRows(exercises);
    const flow = restAfterSetInFlow(
      rows, exerciseIndex, setIndex, restSecondsFor,
      // What is already logged is skipped: a lifter who did A2 first is not
      // sent back to it.
      (e, i) => i !== setIndex || e !== exerciseIndex ? exercises[e]?.sets[i]?.done === true : true,
    );
    const into = flow.next && flow.next.exerciseIndex !== exerciseIndex ? exercises[flow.next.exerciseIndex] : undefined;
    const tagsNow = supersetTags(rows);
    const nextTag = flow.next ? tagsNow[flow.next.exerciseIndex] : undefined;
    // Name the next station during a superset rest, so both can be set up.
    // A leftover round (the partner has no clusters left): say so, or
    // "Round 3/3" reads like an ordinary round and the lifter walks to a
    // station that is done. Said on the two-line Next row — the heading is
    // one line beside the timer and would cut it off.
    const alone = flow.kind === 'cluster' && flow.round != null && nextTag != null;
    const nextEx = flow.next ? exercises[flow.next.exerciseIndex] : undefined;
    const nextLabel = alone && nextEx
      ? t('train.superset.nextAlone', { next: `${nextTag} · ${nextEx.name}` })
      : into && (tagsNow[exerciseIndex] != null || nextTag != null)
        ? (nextTag ? `${nextTag} · ${into.name}` : into.name)
        : null;
    const heading = flow.kind === 'transition' && nextTag
      ? t('train.superset.switchTo')
      : (flow.kind === 'round' || alone) && flow.round
        ? t('train.superset.roundNext', { n: flow.round.n, total: flow.round.total })
        : null;
    // Spoken: "Round 2 of 3" — "2/3" can be read as a fraction or a date.
    const spokenHeading = flow.round && heading && flow.kind !== 'transition'
      // A leftover round says "its partner is done" in the Next line — once.
      ? t('train.superset.roundA11y', { n: flow.round.n, total: flow.round.total })
      : heading;
    // Program v2: a member with a minimum rest between its OWN clusters
    // (A1/B1, 90 s) gets the round rest stretched when the partner's cluster
    // and the transition took less — measured from when its last set was
    // ticked, else estimated as the transition plus one 70 s cluster.
    let seconds = flow.seconds;
    const back = flow.kind === 'round' && nextEx ? nextEx : undefined;
    if (back?.minClusterRestSec != null) {
      const at = lastSetAt[back.exerciseId];
      const since = at != null ? (now - at) / 1000 : (rows[exerciseIndex].transitionRestSec ?? DEFAULT_TRANSITION_REST_SEC) + CLUSTER_ESTIMATE_SEC;
      seconds = roundRestWithFloor(flow.seconds, back.minClusterRestSec, since);
    }
    runRest(seconds, ex.name, nextLabel, heading, into && nextLabel ? flow.next!.exerciseIndex : null, {
      spokenHeading, from: exerciseIndex, lead,
      // A between-cluster rest is the NEXT unit's lift's own (core: a leftover
      // unit of the partner runs on the partner's cluster rest).
      running: { kind: flow.kind, owner: flow.kind === 'cluster' ? flow.next?.exerciseIndex ?? exerciseIndex : exerciseIndex },
    });
    return { ...flow, seconds };
  };

  /** "Start rest now" from an exercise's ⋯. After a lift's cluster ends,
   *  the flow's rest (a superset's switch or round, with the next station);
   *  otherwise the rest this lift's sets get — its ⋯ override, else its
   *  template row's, else the template's. */
  const startManualRest = (exerciseIndex: number) => {
    const ex = train.active?.exercises[exerciseIndex];
    if (!ex) return;
    haptics.tap();
    const lastDone = ex.sets.reduce((acc, x, i) => (x.done ? i : acc), -1);
    const paired = isSupersetted(train.active!.exercises, exerciseIndex);
    if (lastDone >= 0 && paired) {
      const flow = restAfterSetInFlow(flowRows(train.active!.exercises), exerciseIndex, lastDone, restSecondsFor);
      if (flow.kind !== 'intra') {
        startRest(exerciseIndex, lastDone);
        return;
      }
    }
    // A superset member's mini-set rest is never the ⋯ override (that is the
    // group's rest now).
    runRest((paired ? undefined : restOverride[ex.exerciseId]) ?? restFallback(exerciseIndex), ex.name, null, null, null, { from: exerciseIndex });
  };
  /** What "Start rest now" will run for this lift, as the ⋯ row says it. */
  const manualRestSeconds = (exerciseIndex: number) => {
    const ex = session.exercises[exerciseIndex];
    if (!ex) return restMini;
    const lastDone = ex.sets.reduce((acc, x, i) => (x.done ? i : acc), -1);
    const paired = sessionTags[exerciseIndex] != null;
    if (lastDone >= 0 && paired) {
      const flow = restAfterSetInFlow(flowRows(session.exercises), exerciseIndex, lastDone, restSecondsFor);
      if (flow.kind !== 'intra') return flow.seconds;
    }
    return (paired ? undefined : restOverride[ex.exerciseId]) ?? restFallback(exerciseIndex);
  };

  /** Run a rest of `secs`: the bar, the Lock Screen, the notification, the
   *  announcement and the one-time notification priming — one path for a
   *  ticked set and a manual start, so the two cannot drift. In a superset the
   *  Lock Screen, the notification and the announcement name the NEXT station
   *  — with the phone on a bench, that is the screen the lifter sees. */
  const runRest = (
    secs: number,
    name: string,
    next: string | null,
    heading: string | null,
    target: number | null,
    opts: { spokenHeading?: string | null; from: number; lead?: string; running?: { kind: RestKind; owner: number } },
  ) => {
    const { spokenHeading } = opts;
    const nextLine = next ? t('train.superset.nextUp', { next }) : undefined;
    rest.start(secs, nextLine);
    setRestTotal(secs);
    setRestNext(next);
    setRestHeading(heading);
    setRestTarget(target);
    setRestFrom(opts.from);
    setRestRunning(opts.running ?? null);
    // Lock-screen countdown (Train review item 20): the rest Live Activity on
    // iOS, a no-op wherever its native module is absent.
    restActivity.start(restDeadline(secs), nextLine ?? name, locale);
    const restText = next
      ? t('train.superset.restA11y', { heading: spokenHeading ?? heading ?? t('train.rest'), time: spokenDuration(secs, t, locale), next })
      : t('train.restStartedA11y', { time: spokenDuration(secs, t, locale) });
    announce(opts.lead ? `${opts.lead} ${restText}` : restText);
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
  /** The running rest's notification text, for the Lock Screen's +30 s (read
   *  in an effect, never during render). */
  const restNextLine = useRef<string | undefined>(undefined);
  useEffect(() => {
    restRef.current = rest;
    restNextLine.current = restNext ? t('train.superset.nextUp', { next: restNext }) : undefined;
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
          restRef.current.start(out.seconds, restNextLine.current);
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
    // Keep "Next: A2 · …" on the rest-over notification through ±30 s.
    rest.start(next, restNext ? t('train.superset.nextUp', { next: restNext }) : undefined);
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
  const startRestRef = useLatest(startRest);
  // The live session, for callbacks that keep one identity for the memoized
  // cards but must act on the exercises as they stand when they fire.
  const exercisesRef = useRef(session.exercises);
  useEffect(() => {
    exercisesRef.current = session.exercises;
  });
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Each card's y in the list, for scrolling a superset partner into view. */
  const cardY = useRef(new Map<number, number>());
  /** A card to scroll to on its next layout (the auto-advanced partner). */
  const scrollTo = useRef<number | null>(null);
  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);
  const onSetDone = useCallback(
    (exerciseIndex: number, setIndex: number, info: { pr: boolean; complete: boolean; logged?: string }) => {
      // A record or the last set of the lift is a success; any other tick is
      // a tick (Train review items 25, 35).
      if (info.pr || info.complete) haptics.success();
      else haptics.tap();
      const flow = startRestRef.current(exerciseIndex, setIndex, info.logged);
      // Inside a superset, the cluster just finished hands over to the
      // partner: open its card (A1 → A2 → A1), on the same beat and with the
      // same courtesy as below.
      const partner = flow?.next && flow.next.exerciseIndex !== exerciseIndex
        && (flow.kind === 'transition' || flow.kind === 'round'
          || (flow.kind === 'cluster' && exercisesRef.current[exerciseIndex]?.supersetGroup != null))
        ? flow.next.exerciseIndex
        : null;
      if (partner != null) {
        // A screen reader keeps its focus: collapsing the card that holds it
        // would drop VoiceOver twice a round. The announcement already named
        // the next station.
        if (isScreenReaderOn()) return;
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(() => {
          advanceTimer.current = null;
          setExpanded((cur) => {
            if (cur !== exerciseIndex) return cur;
            // Bring the partner's card into view once it has re-laid out — a
            // position read now is from before the finished card collapsed,
            // and overshot to the bottom of the list on the simulator.
            scrollTo.current = partner;
            return partner;
          });
        }, AUTO_ADVANCE_MS);
        return;
      }
      // The lift is done: open the next unfinished one, the way Strong and
      // Hevy move on by themselves — it used to take a collapse and a tap.
      // Only if this card is still the open one when the beat is up; a lifter
      // who has already opened another card meant to.
      if (info.complete) {
        if (advanceTimer.current) clearTimeout(advanceTimer.current);
        advanceTimer.current = setTimeout(() => {
          advanceTimer.current = null;
          const next = nextUnfinishedExercise(exercisesRef.current, exerciseIndex);
          if (next == null) return;
          setExpanded((cur) => {
            if (cur !== exerciseIndex) return cur;
            // Into view, as the superset hand-off above does (L7): the next
            // lift opened below the fold and the lifter had to go find it.
            scrollTo.current = next;
            return next;
          });
        }, AUTO_ADVANCE_MS);
      }
    },
    [startRestRef],
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
      // Which set, of which lift — read before the removal relabels the rest
      // (L-N14: "Set removed" named neither).
      const n = setRowLabels(ex.sets)[setIndex] ?? String(setIndex + 1);
      void dispatch({ type: 'removeSet', exerciseIndex, setIndex });
      showToast(t('train.setRemovedNamed', { n, name: ex.name }), {
        action: {
          label: t('common.undo'),
          onPress: () => undoRemoval({ kind: 'set', exerciseIndex, exerciseId: ex.exerciseId, setIndex, set: removed }),
        },
        durationMs: UNDO_TOAST_MS,
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
      durationMs: UNDO_TOAST_MS,
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
    // in-progress doc and nothing brings it back (UX_AUDIT S18-6). The
    // question names the workout and what goes with it (L12, R43).
    const logged = session.exercises.reduce(
      (n, ex) => n + ex.sets.filter((x) => isLoggedSet(x, ex.logStyle ?? DEFAULT_LOG_STYLE)).length,
      0,
    );
    confirm({
      title: t('train.discardWorkoutNamedTitle', { name: title }),
      body: logged > 0 ? plural(t, locale, 'train.discardWorkoutLost', logged) : t('train.discardConfirm'),
      confirmText: t('train.discard'),
      destructive: true,
      onConfirm: () => void train.discardWorkout(),
    });
  }

  /** Move an exercise and keep the open card on the lift that was open. */
  function moveExercise(from: number, to: number) {
    // The open card follows its exercise by identity (its sets array), not
    // by arithmetic on two indices — a superset moves as a block now.
    const openSets = expanded != null ? session.exercises[expanded]?.sets : undefined;
    const r = train.moveExerciseInActive(from, to);
    // The moved card stays open where it lands; any other open card is
    // re-found by identity once the moved list arrives.
    if (expanded === from) setExpanded(r.newIndex);
    if (openSets && r.newIndex !== from) setPendingOpen({ sets: openSets, list: session.exercises });
    if (r.left) {
      const { name, group, before: prev } = r.left;
      const msg = t('train.superset.leftGroup', { name, group });
      showToast(msg, { testID: 'train-toast', durationMs: UNDO_TOAST_MS, action: {
        label: t('common.undo'),
        onPress: () => {
          setFollowOpen(true);
          train.undoMove(prev);
        },
      } });
    }
  }
  /** The sets array of the card to keep open across a move. State, not a ref:
   *  this path is reachable from the ⋯ rows built during render. */
  const [pendingOpen, setPendingOpen] = useState<{ sets: SessionExercise['sets']; list: readonly SessionExercise[] } | null>(null);
  // Derived during render once the moved list arrives (React's "previous
  // value" pattern, as RestPickerSheet does) — not in an effect, which would
  // paint a frame with the wrong card open.
  if (pendingOpen && session.exercises !== pendingOpen.list) {
    const i = session.exercises.findIndex((e) => e.sets === pendingOpen.sets);
    setPendingOpen(null);
    if (i >= 0 && i !== expanded) setExpanded(i);
  }
  /** An Undo of a move: the open card follows its lift by identity — the
   *  Undo keeps each lift's sets array, so it can be re-found. */
  const [followOpen, setFollowOpen] = useState(false);
  const [listSeen, setListSeen] = useState(session.exercises);
  if (listSeen !== session.exercises) {
    if (followOpen) {
      const sets = expanded != null ? listSeen[expanded]?.sets : undefined;
      const i = sets ? session.exercises.findIndex((e) => e.sets === sets) : -1;
      if (i >= 0 && i !== expanded) setExpanded(i);
      setFollowOpen(false);
    }
    setListSeen(session.exercises);
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
  // The page header's "?" is hidden during a workout (L4); this is its home.
  const glossaryAction: ExerciseMenuAction = {
    key: 'glossary',
    icon: 'help-circle-outline',
    labelKey: 'train.glossaryMenu',
    onPress: () => menuHandoff(onOpenGlossary),
  };
  const sessionActions: ExerciseMenuAction[] = train.editingExisting
    ? [
        {
          key: 'add-exercise',
          icon: 'add-circle-outline',
          labelKey: 'train.addExerciseTitle',
          onPress: () => menuHandoff(openAdd),
        },
        ...reorderAction,
        glossaryAction,
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
          onPress: () => menuHandoff(openAdd),
        },
        ...reorderAction,
        {
          key: 'add-cardio',
          icon: 'walk-outline',
          labelKey: 'cardio.add',
          onPress: () => menuHandoff(() => setCardioPickerOpen(true)),
        },
        glossaryAction,
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
    const canAdd = canAddFor(index);
    const override = restOverride[ex.exerciseId];
    const tagsNow = supersetTags(session.exercises);
    const group = tagsNow[index] ? ex.supersetGroup : undefined;
    const rests = group ? groupRest(flowRows(session.exercises), group) : undefined;
    return {
      index,
      // The card already names the pair; the row's subtitle no longer
      // repeats it and truncates (L8).
      unpairToday: group ? t('train.superset.unpairTodayDesc') : null,
      // Only when the move does something: a superset moves as one block.
      canMoveUp: moveBlockAware(session.exercises, index, -1).newIndex !== index,
      canMoveDown: moveBlockAware(session.exercises, index, 1).newIndex !== index,
      history: catalogEx != null,
      cluster: canAdd.cluster,
      block: canAdd.block,
      platesOpen: (ex.logStyle ?? 'weight-reps') === 'weight-reps' ? platesOpen === index : null,
      restDesc: rests
        ? t('train.superset.restDesc', { switch: `${rests.transitionRestSec} s`, round: `${rests.roundRestSec} s` })
        : t('train.restTimerDesc', { time: clock(override ?? restFallback(index)) }),
      restNow: clock(manualRestSeconds(index)),
      // Only where the card has no gear of its own: a single call's note
      // carries one, the per-side notes do not (L8 — the row duplicated the
      // gear and pushed Remove below the fold).
      lift: catalogEx != null
        && (() => {
          const sides = sideRecommendationsFor(
            { recentSessions: train.recentSessions, catalog: train.catalog },
            ex.exerciseId,
            templateRow,
            ex,
          );
          return sides != null && (['L', 'R'] as const).some((k) => sides[k] != null && sides[k]!.action !== 'none');
        })(),
    };
  }

  /** The structure this lift DECLARES (ADR-0040): template row, then
   *  catalog. `undefined` = undeclared — nothing inferred here. */
  function declaredStructureFor(index: number) {
    const ex = session.exercises[index];
    if (!ex) return undefined;
    return templateRowFor(ex.exerciseId)?.setStructure ?? catalogFor(ex.exerciseId)?.setStructure;
  }

  /** Which add-actions this lift can use (ADR-0040), through core's
   *  precedence (template -> catalog -> inference) so an undeclared legacy
   *  template keeps every affordance it was written with. */
  function canAddFor(index: number) {
    const ex = session.exercises[index];
    return addActionsFor(
      declaredStructureFor(index)
        ?? (ex?.sets.some((x) => x.kind === 'activation') ? undefined : 'straight'),
    );
  }

  /** The set kinds the set sheet offers for this lift (L9): the cluster
   *  vocabulary only where a DECLARED structure can add a cluster or block,
   *  a mobility hold only on a timed lift. The set's own kind is always kept
   *  by the sheet. An undeclared lift keeps the cluster vocabulary: the set
   *  sheet is the only path that turns a lift added mid-workout into a
   *  rest-pause or myo-rep lift (ADR-0040/0041 — undeclared means "infer",
   *  and inference reads exactly the kinds picked here; Maestro flow 22). */
  function setKindsFor(index: number): SetKind[] {
    const ex = session.exercises[index];
    if (!ex) return [];
    const declared = declaredStructureFor(index);
    const canAdd = declared === undefined ? { cluster: true, block: true } : addActionsFor(declared);
    return [
      'warmup',
      'working',
      ...(canAdd.cluster || canAdd.block ? (['activation', 'mini', 'continuation'] as const) : []),
      'drop',
      ...((ex.logStyle ?? DEFAULT_LOG_STYLE) === 'time' ? (['mobility'] as const) : []),
    ];
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
        menuHandoff(() => {
          setRestPickerRunning(null);
          setRestPickerFor(index);
        });
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
      case 'unpair-today': {
        const group = ex.supersetGroup;
        if (!group) return;
        haptics.tap();
        // What Undo puts back, by exercise id.
        const fields = Object.fromEntries(session.exercises.filter((e) => e.supersetGroup === group).map((e) => [e.exerciseId, {
          supersetGroup: e.supersetGroup, pairPosition: e.pairPosition, transitionRestSec: e.transitionRestSec, roundRestSec: e.roundRestSec,
        }]));
        const keyTr = groupKey(group, 'transition');
        const keyRo = groupKey(group, 'round');
        const picked = { tr: restOverride[keyTr], ro: restOverride[keyRo] };
        void dispatch({ type: 'unpairGroup', group });
        // The group's picked rests go with it — they would otherwise become
        // the lifts' own mini-set rest.
        setRestOverride((cur) => {
          const next = { ...cur };
          delete next[groupKey(group, 'transition')];
          delete next[groupKey(group, 'round')];
          return next;
        });
        const msg = t('train.superset.unpairedToday', { group });
        showToast(msg, {
          testID: 'train-toast',
          durationMs: UNDO_TOAST_MS,
          action: {
            label: t('common.undo'),
            onPress: () => {
              void dispatch({ type: 'restoreSuperset', fields });
              // …and so do the rests picked for it.
              setRestOverride((cur) => ({
                ...cur,
                ...(picked.tr != null ? { [keyTr]: picked.tr } : {}),
                ...(picked.ro != null ? { [keyRo]: picked.ro } : {}),
              }));
            },
          },
        });
        return;
      }
    }
  }
  // One identity for the open card's memoized menu; each pick runs against
  // THIS render's session, read through the ref.
  const runExerciseActionRef = useLatest(runExerciseAction);
  const runStable = useCallback(
    (index: number, key: ExerciseMenuKey) => runExerciseActionRef.current(index, key),
    [runExerciseActionRef],
  );
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
  // VoiceOver / TalkBack go back to the control that opened each sheet once
  // it has gone (J10; `lib/return-focus.ts`).
  useReturnFocusOnClose(sheetSet != null);
  useReturnFocusOnClose(restEx != null);
  useReturnFocusOnClose(addFor != null);

  // "Log a run" is a session holding one cardio block and nothing else: say
  // "Run", not "Workout" (L11).
  const soleCardio = session.exercises.length === 0 && session.cardio?.length === 1 ? session.cardio[0] : undefined;
  const title = session.templateName
    || (soleCardio ? t(`cardio.modality.${soleCardio.modality}` as I18nKey) : t('train.workout'));
  // "Keep for this lift" writes the rest onto the template row this lift came
  // from — only offered when there is one to write to.
  const restTemplateRow = restEx && tpl?.id ? templateRowFor(restEx.exerciseId) : undefined;
  /** "Keep for this superset": the group's rest on the template's LEADER row
   *  (`transitionRestSec` / `roundRestSec`) — never a lift's `restMiniSec`. */
  async function saveGroupRest(group: string, rests: { transition?: number; round?: number }) {
    if (!tpl?.id) return;
    const leaderId = (supersetGroups(session.exercises).get(group) ?? [])
      .map((m) => session.exercises[m.index].exerciseId)
      .find((id) => tpl.exercises.some((te) => te.exerciseId === id && te.pairPosition === 1))
      ?? session.exercises.find((e) => e.supersetGroup === group)?.exerciseId;
    const { id, createdAt: _c, updatedAt: _u, ...draft } = tpl;
    try {
      await train.saveTemplate(
        {
          ...draft,
          exercises: tpl.exercises.map((te) => (te.exerciseId === leaderId
            ? {
              ...te,
              ...(rests.transition != null ? { transitionRestSec: rests.transition } : {}),
              ...(rests.round != null ? { roundRestSec: rests.round } : {}),
            }
            : te)),
        },
        id,
      );
      showToast(t('train.restSaved', { template: tpl.name }), { testID: 'train-toast' });
    } catch {
      haptics.warning();
      showToast(t('train.exerciseSaveErr'), { testID: 'train-toast' });
    }
  }

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
      {/* At accessibility text sizes the buttons wrap under the title: beside
          it, they squeezed "IN PROGRESS" into one letter column and the
          title to "Q…" (device pass, 2026-10-11). */}
      <View style={[styles.sessionHeader, largeText && styles.sessionHeaderWrap]} testID="session-header">
        <View style={[styles.sessionHeaderMain, largeText && styles.sessionHeaderMainFull]}>
          {/* At large text the eyebrow goes (L-N8): Finish / Done editing
              beside it already says what state this is, and the title takes
              the header role in its place. */}
          {largeText ? null : (
            <Text style={styles.sessionEyebrow} accessibilityRole="header" testID="session-eyebrow">
              {train.editingExisting ? t('train.editingSession') : t('train.inProgress')}
            </Text>
          )}
          <Text
            style={styles.sessionTitle}
            numberOfLines={1}
            maxFontSizeMultiplier={HEADER_FONT_CAP}
            accessibilityRole={largeText ? 'header' : undefined}
            testID="session-title"
          >
            {title}
          </Text>
          {train.editingExisting ? (
            <Text style={styles.sessionMeta} numberOfLines={largeText ? 1 : 2} adjustsFontSizeToFit={largeText} maxFontSizeMultiplier={HEADER_FONT_CAP}>
              {[formatDate(session.date, locale, { weekday: 'short', month: 'short', day: 'numeric' }), ...metaParts].join(' · ')}
            </Text>
          ) : (
            <ElapsedClock startedAt={session.date} parts={metaParts} compact={largeText} />
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
            <Text style={styles.headerPrimaryText} maxFontSizeMultiplier={HEADER_BUTTON_CAP}>{t('train.doneEditing')}</Text>
          </Touchable>
        ) : (
          <Touchable
            style={styles.headerPrimary}
            onPress={pressFinish}
            accessibilityRole="button"
            testID="finish-workout"
          >
            <Text style={styles.headerPrimaryText} maxFontSizeMultiplier={HEADER_BUTTON_CAP}>{t('train.finish')}</Text>
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
          {session.exercises.map((ex, exIdx) => {
            const group = sessionTags[exIdx] ? ex.supersetGroup : undefined;
            const leads = group != null && sessionTags[exIdx]?.endsWith('1');
            const rests = leads && group ? groupRest(flowRows(session.exercises), group) : undefined;
            return (
            <View
              key={`${ex.exerciseId}-${exIdx}`}
              // Inside a superset the cards sit close (3pt), so a pair reads as
              // one block and the next group starts visibly apart.
              style={group && sessionTags[exIdx + 1] && session.exercises[exIdx + 1]?.supersetGroup === group ? { marginBottom: -(space.md - 3) } : undefined}
              onLayout={(e) => {
                const y = e.nativeEvent.layout.y;
                cardY.current.set(exIdx, y);
                if (scrollTo.current === exIdx) {
                  scrollTo.current = null;
                  scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: !reduceMotion });
                }
              }}
            >
            {rests && group ? (
              <Text style={styles.supersetHeader} accessibilityRole="header" testID={`superset-header-${group}`}>
                {t('train.superset.groupHeader', { group, switch: clock(rests.transitionRestSec), round: clock(rests.roundRestSec) })}
              </Text>
            ) : null}
            <ExerciseCard
              exercise={ex}
              supersetTag={sessionTags[exIdx]}
              supersetPartners={group ? (supersetGroups(session.exercises).get(group) ?? []).filter((m) => m.index !== exIdx).map((m) => session.exercises[m.index].name).join(', ') : undefined}
              upNext={rest.endsAt != null && restTarget === exIdx}
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
            </View>
            );
          })}

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
                  durationMs: UNDO_TOAST_MS,
                  testID: 'train-toast',
                });
              }}
            />
          ))}

          <Touchable
            style={styles.addExBtn}
            onPress={(e) => {
              noteFocusTrigger(e?.currentTarget);
              openAdd();
            }}
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
          next={restNext}
          heading={restHeading}
          stacked={largeText}
          onAdjust={adjustRest}
          onSkip={rest.stop}
          onChangeRest={restFrom != null && session.exercises[restFrom] ? () => {
            setRestPickerRunning(restRunning);
            setRestPickerFor(restFrom);
          } : undefined}
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
        kinds={setSheet ? setKindsFor(setSheet.exerciseIndex) : undefined}
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
        // The row the recommendation read, so the sheet's step matches it.
        templateRow={liftEx ? templateRowFor(liftEx.exerciseId) ?? null : null}
        rec={liftEx
          ? recommendationFor(train, liftEx.exerciseId, templateRowFor(liftEx.exerciseId), liftEx, recExtrasFor(liftEx.exerciseId))
          : null}
        onClose={() => setLiftFor(null)}
        onSave={(patch) => (liftCatalogEx?.id ? train.editCatalogExercise(liftCatalogEx.id, patch) : Promise.resolve())}
      />

      <RestPickerSheet
        visible={restEx != null}
        superset={restPickerFor != null && sessionTags[restPickerFor] && restEx?.supersetGroup ? (() => {
          const group = restEx.supersetGroup;
          const base = groupRest(session.exercises, group);
          return {
            group,
            transition: restOverride[groupKey(group, 'transition')] ?? null,
            round: restOverride[groupKey(group, 'round')] ?? null,
            transitionFallback: base.transitionRestSec,
            roundFallback: base.roundRestSec,
            onPick: (field: 'transition' | 'round', seconds: number | null) => setRestOverride((cur) => {
              const next = { ...cur };
              if (seconds == null) delete next[groupKey(group, field)];
              else next[groupKey(group, field)] = seconds;
              return next;
            }),
            onSave: (rests: { transition?: number; round?: number }) => void saveGroupRest(group, rests),
            // Opened from the countdown: mark the rest running, and offer the
            // lift's OWN rest when that is what runs (a leftover round / the
            // rest after the superset) — the group's two rests never set it.
            running: restPickerRunning
              ? restPickerRunning.kind === 'transition' || restPickerRunning.kind === 'round'
                ? restPickerRunning.kind
                : restPickerRunning.kind === 'intra' ? null : 'own'
              : null,
            own: (() => {
              const r = restPickerRunning;
              const ownerEx = r ? session.exercises[r.owner] : undefined;
              if (!r || !ownerEx || (r.kind !== 'cluster' && r.kind !== 'after-exercise')) return null;
              const base = baseOwnRest(r.owner);
              const key = ownKey(ownerEx.exerciseId);
              // "Next cluster" only where the lift IS clustered; a straight
              // lift's own rest comes before its next SET (v3 QA item 4).
              const row = templateRowFor(ownerEx.exerciseId);
              const structure = structureOf(row, catalogFor(ownerEx.exerciseId) ?? undefined, row?.plannedSets ?? ownerEx.sets);
              const clustered = structure === 'myoreps' || structure === 'rest-pause' || structure === 'cluster';
              const beforeKey = clustered ? 'train.superset.ownClusterRestLabel' : 'train.superset.ownSetRestLabel';
              return {
                label: r.kind === 'cluster'
                  ? t(beforeKey, { name: ownerEx.name })
                  : t('train.superset.ownAfterRestLabel', { name: ownerEx.name }),
                current: restOverride[key] ?? null,
                fallback: r.kind === 'cluster' ? base.cluster : base.afterExercise,
                onPick: (seconds: number | null) => setRestOverride((cur) => {
                  const next = { ...cur };
                  if (seconds == null) delete next[key];
                  else next[key] = seconds;
                  return next;
                }),
              };
            })(),
          };
        })() : undefined}
        name={restEx?.name ?? ''}
        running={restPickerRunning != null}
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
        // The lift just added (the first, of several) opens, and scrolls into
        // view once it has laid out — as Strong and Hevy land you on it. It
        // arrived collapsed below the fold: a tap and a scroll to reach its
        // first set (L-N10 / J-N8). A replacement opens in its own slot.
        onAdded={() => {
          const at = addFor && addFor !== 'add' ? addFor.index : addBase;
          scrollTo.current = at;
          setExpanded(at);
        }}
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
  next,
  heading,
  stacked,
  onAdjust,
  onSkip,
  onChangeRest,
}: {
  endsAt: number;
  /** Length of the whole countdown, seconds — the progress track's 100%. */
  total: number;
  /** The superset station this rest leads into ("A2 · Leg Curls"), if any. */
  next?: string | null;
  /** "Switch stations" / "Round 2 of 3" — replaces the plain "Rest" label. */
  heading?: string | null;
  /** Large text: the buttons get their own row, so the label never pushes
   *  Skip off the bar. */
  stacked?: boolean;
  onAdjust: (deltaSec: number) => void;
  onSkip: () => void;
  /** Open the rest picker of the lift whose set started this rest — one tap
   *  on the countdown, as Strong does (L16). */
  onChangeRest?: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  // Above the floating glass tab bar on iOS 26, which covers the tab's foot.
  const lift = tabBarOverlap(useSafeAreaInsets().bottom);
  const locale = useLocale();
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
      {/* Its own full-width row: beside three 44pt buttons the station name
          was the part cut off at large text. */}
      {next ? (
        <Text style={styles.restNext} numberOfLines={2} testID="rest-next">{t('train.superset.nextUp', { next })}</Text>
      ) : null}
      <View style={[styles.restBarRow, stacked ? { flexDirection: 'column', alignItems: 'flex-start', gap: 4 } : null]}>
        {/* The countdown never wraps or truncates: the heading gives way first. */}
        <Touchable
          style={[styles.restLabelBtn, { flexDirection: 'row', flexShrink: 1 }]}
          onPress={(e) => {
            if (!onChangeRest) return;
            haptics.tap();
            noteFocusTrigger(e?.currentTarget);
            onChangeRest();
          }}
          disabled={!onChangeRest}
          accessibilityRole={onChangeRest ? 'button' : undefined}
          accessibilityLabel={`${heading ?? t('train.rest')}, ${spokenDuration(remaining, t, locale)}`}
          accessibilityHint={onChangeRest ? t('train.restChangeHint') : undefined}
          testID="rest-label"
        >
          <Text style={[styles.restLabel, { flexShrink: 1 }]} numberOfLines={1}>{`${heading ?? t('train.rest')} · `}</Text>
          <Text style={styles.restLabel}>{label}</Text>
        </Touchable>
        {/* Stacked, the three spread across the bar: 4pt apart they read as
            one string, "−30s+30sSKIP" (L-N9, R3). */}
        <View style={[styles.restActions, stacked ? { alignSelf: 'stretch', justifyContent: 'space-between', gap: space.md } : null]}>
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
function ElapsedClock({ startedAt, parts, compact }: {
  startedAt: Date;
  parts: readonly string[];
  /** Large text: one line that shrinks to fit, not two (L-N8). */
  compact?: boolean;
}) {
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
      // Two lines: in es-PR the progress at the end was cut ("0 de 5 hec…").
      // At large text one line that shrinks instead — the header is chrome.
      numberOfLines={compact ? 1 : 2}
      adjustsFontSizeToFit={compact}
      maxFontSizeMultiplier={HEADER_FONT_CAP}
      accessibilityLabel={[spoken, ...parts].join(', ')}
      testID="session-elapsed"
    >
      {[clock(secs), ...parts].join(' · ')}
    </Text>
  );
}
