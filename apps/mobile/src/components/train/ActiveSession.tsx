import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import {
  addActionsFor,
  exerciseIsFullyDone,
  formatLoad,
  looksLikeSameEffort,
  restAfterSet,
  sessionHasLoggedWork,
  sessionVolume,
  setRowLabels,
} from '@macrolog/core';
import type { TrainState } from '@/hooks/useTrain';
import { useRestTimer } from '@/hooks/useRestTimer';
import { NATIVE_SHEETS } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { OfflineBanner } from '@/components/OfflineBanner';
import { CardioBlockCard } from '@/components/train/CardioBlockCard';
import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';
import { RestNotifySheet } from '@/components/train/RestNotifySheet';
import { decideRestNotifyPriming, markRestNotifyPrimed } from '@/components/train/rest-notify-priming';
import { SetRowSheet } from '@/components/train/SetRowSheet';
import { ExerciseMenuSheet, type ExerciseMenuAction } from '@/components/train/ExerciseMenuSheet';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { useIsOffline } from '@/lib/connectivity';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { requestNotificationPermission } from '@/lib/reminders';
import * as restActivity from '@/lib/rest-timer-activity';
import { subscribeIntentInbox, takeIntentInbox } from '../../../modules/intent-inbox';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { AddExerciseSheet } from './AddExerciseSheet';
import { CardioPickerSheet } from './CardioPickerSheet';
import { ExerciseCard } from './ExerciseCard';
import { chainOrder, useInputChain } from './input-chain';
import { RestPickerSheet } from './RestPickerSheet';
import {
  DEFAULT_REST_CLUSTER_SEC,
  DEFAULT_REST_MINI_SEC,
  clock,
  recommendationFor,
} from './train-summary';
import { createStyles } from './train-styles';

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

/** When a rest of `secs` started now will end, epoch ms. Out here because the
 *  clock is impure, and the compiler will not have it inside the component. */
const restDeadline = (secs: number) => Date.now() + secs * 1000;

/** Large text: at 1.5× and up the set row's cells cannot share one line. */
const LARGE_TEXT_SCALE = 1.5;

type MenuFor = { kind: 'exercise'; index: number } | { kind: 'session' } | null;

/**
 * The live workout: a sticky header, the exercise cards, cardio, the rest bar
 * and every sheet the session opens — ONE of each (Train review item 31).
 */
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
  const { dispatch, commitActive } = train;

  const [addFor, setAddFor] = useState<{ index: number; name: string } | 'add' | null>(null);
  const [cardioPickerOpen, setCardioPickerOpen] = useState(false);
  const [setSheet, setSetSheet] = useState<{ exerciseIndex: number; setIndex: number } | null>(null);
  const [menu, setMenu] = useState<MenuFor>(null);
  const [liftFor, setLiftFor] = useState<number | null>(null);
  const [restPickerFor, setRestPickerFor] = useState<number | null>(null);
  const [platesOpen, setPlatesOpen] = useState<number | null>(null);
  /** Per-exercise rest for THIS workout, by exercise id (stable across a
   *  move), seconds. Set from the ⋯ menu's "Rest timer". */
  const [restOverride, setRestOverride] = useState<Record<string, number>>({});
  const rest = useRestTimer();
  /** Length of the countdown running now, for the progress track. */
  const [restTotal, setRestTotal] = useState(0);
  /** Set when the user ends a rest (Skip, −30 past zero), so only a rest
   *  that RAN OUT is announced as over. */
  const restStoppedByUser = useRef(false);
  // The one-time "buzz when rest is over" priming (UX_AUDIT S18-10). Opened
  // by the FIRST rest start on this device when the OS has not been asked
  // yet; both answers record it as shown (`rest-notify-priming.ts`).
  const [restNotifyOpen, setRestNotifyOpen] = useState(false);
  const restNotifyAsked = useRef(false);

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
    restStoppedByUser.current = false;
    rest.start(secs);
    setRestTotal(secs);
    // Lock-screen countdown (Train review item 20): the rest Live Activity on
    // iOS, a no-op wherever its native module is absent.
    restActivity.start(restDeadline(secs), ex.name, locale);
    announce(t('train.restStartedA11y', { time: clock(secs) }));
    // Decided once per session mount; the stored flag makes it once per device.
    if (!restNotifyAsked.current) {
      restNotifyAsked.current = true;
      void decideRestNotifyPriming().then((show) => {
        if (show) setRestNotifyOpen(true);
      });
    }
  };

  // A rest that RAN OUT is announced; a skipped one is not. The timer's own
  // haptic covers sighted users; this is the VoiceOver/TalkBack half
  // (Train review item 18).
  const prevRemaining = useRef(rest.remaining);
  useEffect(() => {
    if (prevRemaining.current > 0 && rest.remaining === 0) {
      if (!restStoppedByUser.current) announce(t('train.restDoneTitle'));
      restActivity.end();
    }
    prevRemaining.current = rest.remaining;
  }, [rest.remaining, t]);
  useEffect(() => () => restActivity.end(), []);

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
    const drain = () => {
      void takeIntentInbox(['rest']).then((actions) => {
        if (!alive) return;
        for (const action of actions) {
          if (action.kind !== 'rest') continue;
          const out = restActivity.applyRestInboxAction(action);
          if (!out) continue;
          if (out.type === 'skip') {
            // Silent, like the in-app skip: no buzz, no "rest over" announcement.
            restStoppedByUser.current = true;
            restRef.current.stop();
            continue;
          }
          restStoppedByUser.current = false;
          restRef.current.start(out.seconds);
          setRestTotal((total) => Math.max(total, out.seconds));
          // The app's own tick had already closed this rest (and its Activity)
          // before the drain ran — put the Lock Screen countdown back too.
          if (out.type === 'resume') restActivity.start(out.endsAt, out.exerciseName, out.locale);
        }
      });
    };
    drain();
    const unsubscribe = subscribeIntentInbox(drain);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') drain();
    });
    return () => {
      alive = false;
      unsubscribe();
      appState.remove();
    };
  }, []);

  function adjustRest(delta: number) {
    haptics.tap();
    const next = Math.max(0, rest.remaining + delta);
    if (next === 0) restStoppedByUser.current = true;
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
  const onSetDone = useCallback(
    (exerciseIndex: number, setIndex: number, info: { pr: boolean; complete: boolean }) => {
      // A record or the last set of the lift is a success; any other tick is
      // a tick (Train review items 25, 35).
      if (info.pr || info.complete) haptics.success();
      else haptics.tap();
      startRestRef.current(exerciseIndex, setIndex);
    },
    [],
  );

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

  // ── The ⋯ menus ──
  const sessionActions: ExerciseMenuAction[] = train.editingExisting
    ? [
        {
          key: 'add-exercise',
          icon: 'add-circle-outline',
          labelKey: 'train.addExerciseTitle',
          onPress: () => handoff(() => setAddFor('add')),
        },
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
          onPress: () => handoff(() => setAddFor('add')),
        },
        {
          key: 'add-cardio',
          icon: 'walk-outline',
          labelKey: 'cardio.add',
          onPress: () => handoff(() => setCardioPickerOpen(true)),
        },
        {
          key: 'discard',
          icon: 'trash-outline',
          labelKey: 'train.discardWorkout',
          destructive: true,
          onPress: () => handoff(confirmDiscard),
        },
      ];

  function exerciseActions(index: number): ExerciseMenuAction[] {
    const ex = session.exercises[index];
    if (!ex) return [];
    const templateRow = templateRowFor(ex.exerciseId);
    const catalogEx = train.catalog.find((e) => e.id === ex.exerciseId) ?? null;
    const style = ex.logStyle ?? 'weight-reps';
    // Which add-actions this lift can use (ADR-0040), through core's
    // precedence (template -> catalog -> inference) so an undeclared legacy
    // template keeps every affordance it was written with.
    const canAdd = addActionsFor(
      templateRow?.setStructure
        ?? catalogEx?.setStructure
        ?? (ex.sets.some((x) => x.kind === 'activation') ? undefined : 'straight'),
    );
    const engineHasCall = catalogEx != null
      && recommendationFor(train, ex.exerciseId, templateRow, ex).action !== 'none';
    const n = session.exercises.length;
    const override = restOverride[ex.exerciseId];
    return [
      ...(index > 0
        ? [{
            key: 'move-up',
            icon: 'arrow-up-outline' as const,
            labelKey: 'train.moveUp' as I18nKey,
            onPress: () => {
              train.moveExerciseInActive(index, index - 1);
              setExpanded(index - 1);
            },
          }]
        : []),
      ...(index < n - 1
        ? [{
            key: 'move-down',
            icon: 'arrow-down-outline' as const,
            labelKey: 'train.moveDown' as I18nKey,
            onPress: () => {
              train.moveExerciseInActive(index, index + 1);
              setExpanded(index + 1);
            },
          }]
        : []),
      {
        key: 'replace',
        icon: 'swap-horizontal-outline',
        labelKey: 'train.replaceExercise',
        onPress: () =>
          handoff(() => {
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
          }),
      },
      ...(canAdd.cluster
        ? [{
            key: 'cluster',
            icon: 'layers-outline' as const,
            labelKey: 'train.addCluster' as I18nKey,
            descKey: 'train.addClusterDesc' as I18nKey,
            onPress: () => void dispatch({ type: 'addCluster', exerciseIndex: index }),
          }]
        : []),
      ...(canAdd.block
        ? [{
            key: 'block',
            icon: 'layers-outline' as const,
            labelKey: 'train.addBlock' as I18nKey,
            descKey: 'train.addBlockDesc' as I18nKey,
            onPress: () => void dispatch({ type: 'addBlock', exerciseIndex: index }),
          }]
        : []),
      ...(style === 'weight-reps'
        ? [{
            key: 'plates',
            icon: 'barbell-outline' as const,
            labelKey: (platesOpen === index ? 'train.hidePanel' : 'train.platesWarmup') as I18nKey,
            onPress: () => setPlatesOpen((o) => (o === index ? null : index)),
          }]
        : []),
      {
        key: 'rest',
        icon: 'timer-outline',
        labelKey: 'train.restTimer',
        desc: t('train.restTimerDesc', { time: clock(override ?? restFallback(index)) }),
        onPress: () => handoff(() => setRestPickerFor(index)),
      },
      ...(engineHasCall
        ? [{
            key: 'lift',
            icon: 'options-outline' as const,
            labelKey: 'train.lift.title' as I18nKey,
            onPress: () => handoff(() => setLiftFor(index)),
          }]
        : []),
      {
        key: 'remove',
        icon: 'trash-outline',
        labelKey: 'train.removeExercise',
        destructive: true,
        onPress: () => {
          setPlatesOpen(null);
          void dispatch({ type: 'removeExercise', exerciseIndex: index });
        },
      },
    ];
  }

  const menuEx = menu?.kind === 'exercise' ? session.exercises[menu.index] : undefined;
  const sheetEx = setSheet ? session.exercises[setSheet.exerciseIndex] : undefined;
  const sheetSet = setSheet ? sheetEx?.sets[setSheet.setIndex] ?? null : null;
  const sheetLabel = setSheet && sheetEx ? setRowLabels(sheetEx.sets)[setSheet.setIndex] ?? '' : '';
  const liftEx = liftFor != null ? session.exercises[liftFor] : undefined;
  const liftCatalogEx = liftEx ? train.catalog.find((e) => e.id === liftEx.exerciseId) ?? null : null;
  const restEx = restPickerFor != null ? session.exercises[restPickerFor] : undefined;

  const title = session.templateName || t('train.workout');
  const restProgress = restTotal > 0 ? Math.min(1, Math.max(0, 1 - rest.remaining / restTotal)) : 0;

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
          <Text style={styles.sessionMeta} numberOfLines={1}>
            {train.editingExisting
              ? formatDate(session.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })
              : <ElapsedClock startedAt={session.date} />}
            {volume > 0 ? ` · ${formatLoad(volume, unitSystem, 0)}` : ''}
            {session.exercises.length > 0
              ? ` · ${t('train.progress', { done: doneCount, total: session.exercises.length })}`
              : ''}
          </Text>
          {offline ? (
            <View style={styles.syncRow} testID="session-saved-offline">
              <Ionicons name="phone-portrait-outline" size={12} color={colors.muted} />
              <Text style={styles.syncText}>{t('train.savedOnPhoneShort')}</Text>
            </View>
          ) : train.saving ? (
            <Text style={styles.syncText}>{t('common.saving')}</Text>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => setMenu({ kind: 'session' })}
          accessibilityRole="button"
          accessibilityLabel={t('train.sessionMenuA11y')}
          testID="session-menu"
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.muted} />
        </TouchableOpacity>
        {train.editingExisting ? (
          <TouchableOpacity
            style={styles.headerPrimary}
            onPress={() => void train.finishEdit()}
            accessibilityRole="button"
            testID="done-editing"
          >
            <Text style={styles.headerPrimaryText}>{t('train.doneEditing')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.headerPrimary}
            onPress={pressFinish}
            accessibilityRole="button"
            testID="finish-workout"
          >
            <Text style={styles.headerPrimaryText}>{t('train.finish')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        // A drag through the list puts the keyboard away, the way every
        // logger behaves; tapping a set's own field still keeps it.
        keyboardDismissMode="on-drag"
      >
        {/* Failures during the workout are said HERE, on the workout — they
            used to render only on the idle screen, so a refused write left
            "Saving…" on screen and said nothing (Train review bug 3). */}
        {train.error ? (
          <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="session-error">
            <Text style={[styles.error, { flex: 1 }]}>
              {train.errorKind === 'save' ? t('train.workoutSaveErr') : t('train.loadErr')}
            </Text>
            <TouchableOpacity
              style={styles.errorBtn}
              onPress={() => {
                train.clearError();
                void commitActive();
              }}
              accessibilityRole="button"
              testID="session-retry"
            >
              <Text style={styles.discardText}>{t('common.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {/* Offline, a queued write IS saved — on this phone, until the signal
            comes back — and the banner says so in those words. */}
        {offline ? (
          <View style={styles.syncRow} accessibilityRole="text" testID="session-offline-note">
            <Text style={styles.sheetHint}>{t('train.savedOnPhone')}</Text>
          </View>
        ) : null}
        <OfflineBanner />

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
            platesOpen={platesOpen === exIdx}
            largeText={largeText}
            dispatch={dispatch}
            commitActive={commitActive}
            chain={chain}
            onToggle={onToggle}
            onOpenMenu={onOpenMenu}
            onOpenSetSheet={onOpenSetSheet}
            onOpenLift={onOpenLift}
            onSetDone={onSetDone}
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
            }}
          />
        ))}

        <TouchableOpacity
          style={styles.addExBtn}
          onPress={() => setAddFor('add')}
          accessibilityRole="button"
          testID="add-exercise"
        >
          <View style={styles.addExRow}>
            <Ionicons name="add" size={18} color={colors.muted} />
            <Text style={styles.addExText}>{t('train.addExercise')}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.addExBtn}
          onPress={() => setCardioPickerOpen(true)}
          accessibilityRole="button"
          testID="add-cardio"
        >
          <View style={styles.addExRow}>
            <Ionicons name="add" size={18} color={colors.muted} />
            <Text style={styles.addExText}>{t('cardio.add')}</Text>
          </View>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Rest countdown — floats above the tab bar AND clear of the raised
          Log button, so it stays visible while the session scrolls. */}
      {rest.remaining > 0 ? (
        <View style={styles.restBarFloat} testID="rest-bar">
          <View style={styles.restTrackWrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={styles.restTrack} />
            <View style={[styles.restFill, { width: `${Math.round(restProgress * 100)}%` }]} testID="rest-progress" />
          </View>
          <View style={styles.restBarRow}>
            <Text style={styles.restLabel}>{`${t('train.rest')} · ${rest.label}`}</Text>
            <View style={styles.restActions}>
              {/* 44-pt targets (UX_AUDIT S18-15): the text is small on purpose
                  inside a floating bar, so the box around it does the work. */}
              <TouchableOpacity
                onPress={() => adjustRest(-30)}
                style={styles.restBtn}
                accessibilityRole="button"
                accessibilityLabel={t('train.restMinusA11y')}
                testID="rest-minus"
              >
                <Text style={styles.restPlus}>−30s</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => adjustRest(30)}
                style={styles.restBtn}
                accessibilityRole="button"
                accessibilityLabel={t('train.restPlusA11y')}
                testID="rest-plus"
              >
                <Text style={styles.restPlus}>+30s</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  restStoppedByUser.current = true;
                  rest.stop();
                }}
                style={styles.restBtn}
                accessibilityRole="button"
                testID="rest-skip"
              >
                <Text style={styles.restSkip}>{t('train.skip')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
          if (target) void dispatch({ type: 'removeSet', exerciseIndex: target.exerciseIndex, setIndex: target.setIndex });
        }}
      />

      <ExerciseMenuSheet
        visible={menu != null && (menu.kind === 'session' || menuEx != null)}
        name={menu?.kind === 'exercise' ? menuEx?.name ?? '' : title}
        onClose={() => setMenu(null)}
        actions={menu?.kind === 'exercise' ? exerciseActions(menu.index) : menu ? sessionActions : []}
        testIDPrefix={menu?.kind === 'session' ? 'session-menu' : 'ex-menu'}
      />

      <LiftSettingsSheet
        visible={liftCatalogEx != null}
        exercise={liftCatalogEx}
        rec={liftEx ? recommendationFor(train, liftEx.exerciseId, templateRowFor(liftEx.exerciseId), liftEx) : null}
        onClose={() => setLiftFor(null)}
        onSave={(patch) => (liftCatalogEx?.id ? train.editCatalogExercise(liftCatalogEx.id, patch) : Promise.resolve())}
      />

      <RestPickerSheet
        visible={restEx != null}
        name={restEx?.name ?? ''}
        current={restEx ? restOverride[restEx.exerciseId] ?? null : null}
        fallback={restPickerFor != null ? restFallback(restPickerFor) : restMini}
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
 * The session's elapsed time, ticking once a second. Its own component so the
 * tick re-renders one Text, not the whole workout.
 */
function ElapsedClock({ startedAt }: { startedAt: Date }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = clock((now - startedAt.getTime()) / 1000);
  return (
    <Text accessibilityLabel={t('train.elapsedA11y', { time })} testID="session-elapsed">
      {time}
    </Text>
  );
}
