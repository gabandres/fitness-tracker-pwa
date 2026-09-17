import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
// Swipe-to-delete on a set row. No `GestureHandlerRootView` is added here —
// the app root already mounts one (`src/app/_layout.tsx`), and this screen is
// not inside a Modal, which is the case that needs its own (see the template
// editor, where RNGH cannot see the app's root through the native modal view).
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrain } from '@/hooks/useTrain';
import { useRestTimer } from '@/hooks/useRestTimer';
import type {
  Exercise,
  LogStyle,
  MuscleGroup,
  SessionExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '@/lib/workout';
import { DEFAULT_LOG_STYLE, isLoggedSet } from '@/lib/workout';
import {
  type UnitSystem,
  barFor,
  formatLoad,
  loadUnit,
  parseLoadToLb,
  platesFor,
  toDisplayLoad,
  bodyWeightUnit,
  parseWeightToLb,
  type SeedTemplate,
  MOBILITY_SEED_KEYS,
  MUSCLE_GROUPS,
  RIR_MAX,
  RIR_MIN,
  STARTER_TEMPLATES,
  clampRir,
  checkWeightEntry,
  clampSetLoad,
  restAfterSet,
  weightBoundsFor,
  seedTemplateName,
  setRowLabels,
  // Cardio (ADR-0025 / ADR-0026): the modality list the picker renders, the
  // per-session cardio total the summary line appends, and the overlap
  // heuristic that SUGGESTS a duplicate without ever merging one.
  CARDIO_MODALITIES,
  looksLikeSameEffort,
  sessionCardioSec,
} from '@macrolog/core';
import type { CardioModality } from '@macrolog/core/cardio';
import {
  type ProgressionSuggestion,
  computeExercisePRs,
  computePlateLoad,
  generateWarmup,
  isWorkingSet,
  suggestProgression,
} from '@macrolog/core';
// What to train next, what you did last time, and what a declared structure
// implies — the three questions this screen asks that core now answers
// (`train-plan.ts`), so none of them is decided inside a renderer.
import {
  type NextUp,
  type SeedExercise,
  addActionsFor,
  nextTemplateUp,
  previousCell,
  previousSets,
  structureOf,
  templateLastPerformed,
} from '@macrolog/core';
// Why a load recommendation is being withheld, and the session-level roll-up
// of the same check. The app must not suggest a load off an activation set it
// cannot read — see `activation-validity.ts`.
import {
  type ActivationFinding,
  type ActivationIssue,
  sessionActivationIssues,
} from '@macrolog/core';
// The progression engine (validity gate → activation-only progression →
// increment check → stall diagnosis) and its weekly cluster count. Core
// decides; `RecommendationNote` renders. See `progression-engine.ts`.
import {
  type Recommendation,
  recommend,
  recommendOptionsFor,
  weeklyClusterAudit,
} from '@macrolog/core';
import { RecommendationNote } from '@/components/train/RecommendationNote';
import { LiftSettingsSheet } from '@/components/train/LiftSettingsSheet';
import { ExerciseSearchList } from '@/components/train/ExerciseSearchList';
import { ExerciseLibrarySheet } from '@/components/train/ExerciseLibrarySheet';
import { ExerciseMenuSheet, type ExerciseMenuAction } from '@/components/train/ExerciseMenuSheet';
import { NextUpCard } from '@/components/train/NextUpCard';
import { SetRowSheet } from '@/components/train/SetRowSheet';
import { confirm } from '@/components/ConfirmSheet';
// Train derivations — shared with the Angular Train tab so the two cannot
// disagree about the same numbers (`@macrolog/core/train-view`).
import {
  bestE1RMByExercise,
  exerciseHistory,
  exerciseIsFullyDone,
  exerciseSeries,
  improvedExercises,
  lastPerformed,
  sessionCounts,
  sessionVolume,
  templateCounts,
  trainHeroStats,
  workingSetCells,
} from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
// Train's own siblings. The route kept the screen and the in-session surfaces;
// the template editor, the stylesheet and the shared label maps moved out when
// this file passed 2,300 lines — three times the size of any other screen, and
// against a web Train tab that has been split since it was written.
import { TemplateEditorModal } from '@/components/train/TemplateEditorModal';
import {
  CREATION_STYLES, LOG_STYLES, type CreationStyle,
  kindLabelKey, logStyleFor, logStyleKey, numOrUndef, setKindFor,
} from '@/components/train/train-shared';
import { BottomSheet } from '@/components/BottomSheet';
import { CardioBlockCard } from '@/components/train/CardioBlockCard';
import { useUnitSystem } from '@/lib/use-unit-system';
import { createStyles } from '@/components/train/train-styles';
import { Sparkline } from '@/components/Sparkline';
import { TrainGlossary } from '@/components/TrainGlossary';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, smoothLayout, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { font, space } from '@/theme';
import { formatDate } from '@/lib/date-format';

export default function Train() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const train = useTrain();
  const [glossaryOpen, setGlossaryOpen] = useState(false);

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
        <Text style={styles.title}>{t('nav.train')}</Text>
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
      {train.loading ? (
        <View style={styles.fill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : train.active ? (
        <ActiveSession train={train} />
      ) : (
        <StartView train={train} heroPulse={prPulse} />
      )}
    </SafeAreaView>
  );
}

// ─── Idle: hero summary + start button + templates + history ────
function StartView({
  train,
  heroPulse,
}: {
  train: ReturnType<typeof useTrain>;
  heroPulse: ReturnType<typeof usePulse>[0];
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  // null = closed; a template = edit it; {} = create new.
  const [editing, setEditing] = useState<WorkoutTemplate | Record<string, never> | null>(null);
  const [detailEx, setDetailEx] = useState<Exercise | null>(null);
  const [startersOpen, setStartersOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // The cluster audit is a six-chip block that used to sit ABOVE the primary
  // action. Collapsed to its one-line verdict, with the chips one tap away.
  const [auditOpen, setAuditOpen] = useState(false);
  const stats = useMemo(
    () => trainHeroStats(train.recentSessions, Date.now()),
    [train.recentSessions],
  );
  // Weekly volume in CLUSTERS (progression engine layer 5) — the rest-pause
  // range is 2-6 per muscle per week, and a cluster counts once, never as
  // the three sets it replaces.
  const audit = useMemo(
    () => weeklyClusterAudit(train.recentSessions, train.catalog, Date.now()),
    [train.recentSessions, train.catalog],
  );
  const [nextOpen, setNextOpen] = useState<string | null>(null);
  // Which template to offer, and when each was last completed. Both are pure
  // and live in core (`train-plan.ts`); this screen only renders them.
  const nextUp = useMemo(
    () => nextTemplateUp(train.templates, train.recentSessions, Date.now()),
    [train.templates, train.recentSessions],
  );
  const lastByTemplate = useMemo(
    () => templateLastPerformed(train.recentSessions),
    [train.recentSessions],
  );

  function confirmDeleteSession(id: string, label: string) {
    // Long-press used to delete a logged workout outright — undiscoverable
    // AND unconfirmed, on the one surface where the data cannot be recovered.
    confirm({
      title: t('train.deleteSessionTitle'),
      body: t('train.deleteSessionBody', { name: label }),
      confirmText: t('common.remove'),
      destructive: true,
      onConfirm: () => void train.deleteSession(id),
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.body}>
      {train.error ? <Text style={styles.error}>{t('train.loadErr')}</Text> : null}

      {/* Hero panel — the Today skeleton (ADR-0014 §7): workouts this week is
          the one big number; volume + top set live inside as chips. */}
      <Animated.View entering={enterUp(0)}>
      <Animated.View style={[styles.heroPanel, heroPulse]} testID="train-hero">
        <Text style={styles.heroCaption}>{t('train.thisWeek')}</Text>
        <View style={styles.hero}>
          <CountUpText value={stats.count} style={styles.heroValue} testID="week-workouts" />
          <Text style={styles.heroUnit}>
            {stats.count === 1 ? t('train.workoutUnit') : t('train.workoutsUnit')}
          </Text>
        </View>
        {stats.count === 0 ? (
          <Text style={styles.heroHint}>{t('train.weekEmpty')}</Text>
        ) : (
          <View style={styles.heroChips}>
            {stats.volume > 0 ? (
              <Text style={styles.trendChip}>
                {t('train.weekVolume')}  <Text style={styles.trendChipValue}>{formatLoad(stats.volume, unitSystem, 0)}</Text>
              </Text>
            ) : null}
            {stats.topSet > 0 ? (
              <Text style={styles.trendChip}>
                {t('train.topSet')}  <Text style={styles.trendChipValue}>{formatLoad(stats.topSet, unitSystem, 0)}</Text>
              </Text>
            ) : null}
          </View>
        )}
      </Animated.View>
      </Animated.View>

      {/* The one question a training home screen exists to answer. The
          full-width primary here used to be "Start workout", which starts an
          EMPTY session — the rarest path anyone takes, given the most
          prominent control on the tab. */}
      {nextUp ? (
        <NextUpCard
          next={nextUp}
          onStart={() => train.startFromTemplate(nextUp.template)}
          onEdit={() => setEditing(nextUp.template)}
        />
      ) : (
        <View style={styles.nextCard} testID="next-up-empty">
          <Text style={styles.nextCaption}>{t('train.nextUp')}</Text>
          <Text style={styles.nextMeta}>{t('train.noTemplates')}</Text>
          <TouchableOpacity style={styles.startBtn} onPress={() => setStartersOpen(true)} testID="next-up-starters">
            <Text style={styles.startBtnText}>{t('train.starters')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Demoted, not removed. An empty session and a bare run are both real
          things to want; neither is what you came to the tab to do. */}
      <View style={styles.secondaryRow}>
        <TouchableOpacity
          onPress={() => {
            haptics.tap();
            train.startWorkout();
          }}
          hitSlop={8}
          testID="start-workout"
        >
          <Text style={styles.secondaryLink}>{t('train.startEmpty')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setLibraryOpen(true)} hitSlop={8} testID="open-library">
          <Text style={styles.secondaryLink}>{t('train.library')}</Text>
        </TouchableOpacity>
      </View>

      {audit.clusters > 0 ? (
        <View style={styles.auditWrap} testID="cluster-audit">
          <TouchableOpacity
            style={styles.auditLine}
            onPress={() => setAuditOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: auditOpen }}
            testID="cluster-audit-toggle"
          >
            <Text style={styles.auditTitle}>{t('train.audit.title')}</Text>
            <Text style={styles.auditLineText} numberOfLines={1}>
              {'  '}
              {t('train.audit.summary', {
                n: audit.clusters,
                inRange: audit.muscles.filter((m) => m.status === 'in-range').length,
                total: audit.muscles.length,
              })}
            </Text>
            <Ionicons
              name={auditOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.faint}
            />
          </TouchableOpacity>
          {auditOpen ? (
            <>
              <View style={styles.auditRow}>
                {audit.muscles.map((m) => (
                  <View
                    key={m.muscle}
                    style={[styles.auditChip, m.status !== 'in-range' && styles.auditChipOff]}
                    testID={`cluster-audit-${m.muscle}`}
                  >
                    <Text style={styles.auditMuscle}>{t(`train.muscle.${m.muscle}` as I18nKey)}</Text>
                    <Text style={styles.auditCount}>
                      {m.clusters} · {t(m.status === 'below' ? 'train.audit.below' : m.status === 'above' ? 'train.audit.above' : 'train.audit.inRange')}
                    </Text>
                  </View>
                ))}
              </View>
              <Text style={styles.auditHint}>
                {audit.unattributed.length > 0
                  ? t('train.audit.unattributed', { names: audit.unattributed.join(', ') })
                  : t('train.audit.hint')}
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('train.templates')}</Text>
        <View style={styles.sectionActions}>
          <TouchableOpacity onPress={() => setStartersOpen(true)} hitSlop={8} testID="browse-starters">
            <Text style={styles.sectionAction}>{t('train.starters')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditing({})} hitSlop={8} testID="new-template">
            <Text style={styles.sectionAction}>{t('train.newTemplate')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {train.templates.length === 0 ? (
        <Text style={styles.empty}>{t('train.noTemplates')}</Text>
      ) : (
        <View style={styles.list}>
          {train.templates.map((tpl) => (
            <View key={tpl.id} style={styles.tplWrap}>
            <View style={styles.tplRow} testID={`template-${tpl.id}`}>
              <Pressable style={styles.tplMain} onPress={() => setEditing(tpl)} testID={`edit-template-${tpl.id}`}>
                <Text style={styles.histDate}>{tpl.name}</Text>
                {/* "3 exercises · 12 sets · last Tue". The counts alone could
                    not tell you which of four templates you are due for, which
                    is the question the list is actually being scanned for. */}
                <Text style={styles.histSub}>
                  {templateSummary(tpl, t)}
                  {tpl.id && lastByTemplate[tpl.id]
                    ? ` · ${t('train.tplLast', { day: formatDate(lastByTemplate[tpl.id], locale, { month: 'short', day: 'numeric' }) })}`
                    : ` · ${t('train.nextNever')}`}
                </Text>
                {/* The engine's calls for this template, BEFORE the session
                    starts — the spec's layer 6 surface. Collapsed by default
                    so the list stays a list; one tap opens it. */}
                <TouchableOpacity
                  onPress={() => setNextOpen((cur) => (cur === tpl.id ? null : tpl.id ?? null))}
                  hitSlop={8}
                  testID={`next-session-${tpl.id}`}
                >
                  <Text style={styles.tplNextToggle}>
                    {nextOpen === tpl.id ? t('train.rec.hide') : t('train.rec.nextSession')}
                  </Text>
                </TouchableOpacity>
              </Pressable>
              <TouchableOpacity
                style={styles.tplStart}
                onPress={() => {
                  haptics.tap();
                  train.startFromTemplate(tpl);
                }}
                testID={`start-template-${tpl.id}`}
              >
                <Text style={styles.tplStartText}>{t('train.startTpl')}</Text>
              </TouchableOpacity>
            </View>
            {nextOpen === tpl.id ? <TemplateNextSession train={train} template={tpl} /> : null}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('train.history')}</Text>
      {train.recentSessions.length === 0 ? (
        <Text style={styles.empty}>{t('train.noWorkouts')}</Text>
      ) : (
        <View style={styles.list}>
          {train.recentSessions.length > 0 ? (
            <Text style={styles.histHint}>{t('train.editHint')}</Text>
          ) : null}
          {train.recentSessions.map((s) => (
            <Pressable
              key={s.id}
              style={styles.histRow}
              testID={`session-${s.id}`}
              onPress={() => train.reopenSession(s)}
              onLongPress={() =>
                s.id &&
                confirmDeleteSession(
                  s.id,
                  formatDate(s.date, locale, { month: 'short', day: 'numeric' }),
                )
              }
            >
              <View style={styles.histMain}>
                <Text style={styles.histDate}>
                  {formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
                <Text style={styles.histSub}>{sessionSummary(s, t)}</Text>
              </View>
              {sessionVolume(s) > 0 ? <Text style={styles.histVol}>{formatLoad(sessionVolume(s), unitSystem, 0)}</Text> : null}
            </Pressable>
          ))}
        </View>
      )}

      {/* The catalog used to render here in full, unbounded, as the sixth
          stacked section of the home screen. A library is a lookup surface —
          you arrive at it with a movement in mind — so it is one row and a
          searchable sheet (`ExerciseLibrarySheet`). */}
      <Pressable
        style={styles.exLibRow}
        onPress={() => setLibraryOpen(true)}
        testID="exercise-library-row"
      >
        <Text style={styles.histDate}>{t('train.exercises')}</Text>
        <Text style={styles.histSub}>
          {t('train.libraryCount', { n: train.catalog.length })}
        </Text>
      </Pressable>

      <TemplateEditorModal
        visible={editing !== null}
        train={train}
        template={editing && 'id' in editing ? (editing as WorkoutTemplate) : null}
        onClose={() => setEditing(null)}
      />
      <ExerciseDetailModal
        visible={detailEx !== null}
        exercise={detailEx}
        train={train}
        onClose={() => setDetailEx(null)}
      />
      <StarterTemplatesModal
        visible={startersOpen}
        train={train}
        onClose={() => setStartersOpen(false)}
      />
      <ExerciseLibrarySheet
        visible={libraryOpen}
        catalog={train.catalog}
        onClose={() => setLibraryOpen(false)}
        onOpenExercise={(e) => {
          setLibraryOpen(false);
          setDetailEx(e);
        }}
        onAddSeed={async (seed) => {
          await train.addLibraryExercise(seed);
        }}
      />
    </ScrollView>
  );
}

// ─── Starter templates (cold-start helper) ──────────────────────
function StarterTemplatesModal({
  visible,
  train,
  onClose,
}: {
  visible: boolean;
  train: ReturnType<typeof useTrain>;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const locale = useLocale();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Hide starters the user has already cloned (matched by stable seedKey, so
  // it holds across a locale switch). Falls back to the localized name for
  // clones made before seedKey existed.
  const cloned = new Set<string>();
  for (const tpl of train.templates) {
    if (tpl.seedKey) cloned.add(tpl.seedKey);
  }
  const available = STARTER_TEMPLATES.filter(
    (seed) =>
      !cloned.has(seed.key) &&
      !train.templates.some((tpl) => !tpl.seedKey && tpl.name.toLowerCase() === seedTemplateName(seed, locale).toLowerCase()),
  );

  useEffect(() => {
    if (visible) setBusyKey(null);
  }, [visible]);

  async function use(seed: SeedTemplate) {
    if (busyKey) return;
    haptics.tap();
    setBusyKey(seed.key);
    try {
      await train.cloneStarterTemplate(seed);
      onClose();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
          {/* `styles.list`'s gap, applied to the SCROLL CONTENT. The rows were
              mapped straight into the ScrollView, so nothing separated them and
              five bordered cards read as one striped block — while the
              identical `tplRow` on the Train screen itself sits inside
              `styles.list` and is spaced. The gap belongs to the container, not
              to `tplRow`: putting a margin on the row would double the spacing
              in the list that is already correct. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.starterList}
          >
            <Text style={styles.sheetTitle}>{t('train.starterTitle')}</Text>
            <Text style={styles.sheetHint}>{t('train.starterHint')}</Text>
            {available.length === 0 ? (
              <Text style={styles.sheetEmpty}>{t('train.starterAllCloned')}</Text>
            ) : null}
            {available.map((seed) => (
              <View key={seed.key} style={styles.tplRow}>
                <View style={styles.tplMain}>
                  <Text style={styles.histDate}>{seedTemplateName(seed, locale)}</Text>
                  <Text style={styles.histSub}>
                    {`${seed.exercises.length} ${seed.exercises.length === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.tplStart}
                  onPress={() => use(seed)}
                  disabled={busyKey != null}
                  testID={`use-starter-${seed.key}`}
                >
                  <Text style={styles.tplStartText}>{busyKey === seed.key ? t('common.saving') : t('train.use')}</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
    </BottomSheet>
  );
}

// ─── Per-exercise history + e1RM ────────────────────────────────
/** Working-set summary line for one logged exercise, by logStyle. The cells
 *  come from core; the separator is this app's spacing. */
function setLine(ex: SessionExercise, style: LogStyle, unitSystem: UnitSystem): string {
  return workingSetCells(ex, style, unitSystem).join('   ');
}

function ExerciseDetailModal({
  visible,
  exercise,
  train,
  onClose,
}: {
  visible: boolean;
  exercise: Exercise | null;
  train: ReturnType<typeof useTrain>;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const { colors } = useTheme();
  const [mode, setMode] = useState<'view' | 'edit' | 'merge'>('view');
  const [confirmDel, setConfirmDel] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStyle, setEditStyle] = useState<LogStyle>('weight-reps');
  // Muscle groups were WRITE-ONCE and only by `cloneStarterTemplate`: every
  // other creation path wrote `muscles: []`, and no screen could set them
  // afterwards. `weeklyClusterAudit` then reported the gap in an
  // "unattributed" line the user had no way to act on. Creation now inherits
  // them from the library; this is how the exercises created before that get
  // fixed.
  const [editMuscles, setEditMuscles] = useState<MuscleGroup[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && exercise) {
      setMode('view');
      setConfirmDel(false);
      setEditName(exercise.name);
      setEditStyle(exercise.logStyle ?? 'weight-reps');
      setEditMuscles(exercise.muscles ?? []);
      setBusy(false);
    }
  }, [visible, exercise]);

  const style = exercise?.logStyle ?? DEFAULT_LOG_STYLE;
  const rows = exercise
    ? train.recentSessions
        .map((s) => ({ date: s.date, ex: s.exercises.find((e) => e.exerciseId === exercise.id) }))
        .filter((r): r is { date: Date; ex: SessionExercise } => r.ex != null)
    : [];
  const history = rows.map((r) => r.ex);
  const series = exerciseSeries(history, style);
  const prs = computeExercisePRs(history);
  const others = exercise ? train.catalog.filter((e) => e.id !== exercise.id) : [];

  async function saveEdit() {
    if (!exercise?.id || !editName.trim() || busy) return;
    setBusy(true);
    try {
      await train.editCatalogExercise(exercise.id, {
        name: editName.trim(),
        logStyle: editStyle,
        muscles: editMuscles,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!exercise?.id || busy) return;
    setBusy(true);
    try {
      await train.deleteCatalogExercise(exercise.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function doMerge(targetId: string) {
    if (!exercise?.id || busy) return;
    setBusy(true);
    try {
      await train.mergeCatalogExercises(exercise.id, targetId);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{exercise?.name}</Text>

            {mode === 'edit' ? (
              <>
                <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.exerciseName')}</Text>
                <TextInput
                  style={styles.input}
                  value={editName}
                  onChangeText={setEditName}
                  placeholderTextColor={colors.faint}
                  testID="edit-exercise-name"
                />
                <View style={styles.styleRow}>
                  {LOG_STYLES.map((ls) => {
                    const on = editStyle === ls.value;
                    return (
                      <TouchableOpacity
                        key={ls.value}
                        style={[styles.styleChip, on && styles.styleChipOn]}
                        onPress={() => setEditStyle(ls.value)}
                      >
                        <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[styles.fieldLabel, { marginTop: space.md }]}>{t('train.musclesLabel')}</Text>
                <Text style={styles.sheetHint}>{t('train.musclesHint')}</Text>
                <View style={styles.kindChips}>
                  {MUSCLE_GROUPS.map((m) => {
                    const on = editMuscles.includes(m);
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[styles.kindChip, on && styles.kindChipOn]}
                        onPress={() => {
                          haptics.tap();
                          setEditMuscles((cur) =>
                            cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m],
                          );
                        }}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        testID={`edit-muscle-${m}`}
                      >
                        <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>
                          {t(`train.muscle.${m}` as I18nKey)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.editorBtns}>
                  <TouchableOpacity style={styles.discardBtn} onPress={() => setMode('view')}>
                    <Text style={styles.discardText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.finishBtn, (!editName.trim() || busy) && styles.btnDisabled]}
                    onPress={saveEdit}
                    disabled={!editName.trim() || busy}
                    testID="save-exercise"
                  >
                    <Text style={styles.finishText}>{busy ? t('common.saving') : t('common.save')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : mode === 'merge' ? (
              <>
                <Text style={[styles.panelLabel, { marginTop: space.sm }]}>{t('train.mergeInto')}</Text>
                {others.length === 0 ? (
                  <Text style={styles.empty}>{t('train.noSaved')}</Text>
                ) : (
                  others.map((e) => (
                    <TouchableOpacity
                      key={e.id}
                      style={styles.catalogRow}
                      onPress={() => e.id && doMerge(e.id)}
                      testID={`merge-into-${e.id}`}
                    >
                      <Text style={styles.catalogName}>{e.name}</Text>
                      <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
                    </TouchableOpacity>
                  ))
                )}
                <TouchableOpacity style={[styles.discardBtn, { marginTop: space.md }]} onPress={() => setMode('view')}>
                  <Text style={styles.discardText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {history.length === 0 ? (
                  <Text style={styles.empty}>{t('train.noExHistory')}</Text>
                ) : (
                  <>
                    <View style={styles.prRow}>
                      {style === 'weight-reps' ? (
                        <>
                          <PrCard label={t('train.prWeight')} value={formatLoad(prs.maxWeight, unitSystem, 0)} />
                          <PrCard label={t('train.prE1rm')} value={formatLoad(Math.round(prs.bestE1RM), unitSystem, 0)} hint={t('train.e1rmHint')} />
                        </>
                      ) : null}
                      {style === 'bodyweight' ? <PrCard label={t('train.prReps')} value={`${prs.maxReps}`} /> : null}
                      {style === 'time' ? <PrCard label={t('train.prHold')} value={`${prs.maxDurationSec}s`} /> : null}
                    </View>

                    {series.length >= 2 ? (
                      <View style={styles.chartWrap}>
                        <Text style={styles.panelLabel}>
                          {style === 'time' ? t('train.trendHold') : style === 'bodyweight' ? t('train.trendReps') : t('train.trendE1rm')}
                        </Text>
                        <Sparkline values={series} color={colors.ring} />
                      </View>
                    ) : null}

                    <Text style={[styles.panelLabel, { marginTop: space.md }]}>{t('train.history')}</Text>
                    {rows.map((r, i) => (
                      <View key={i} style={styles.detailRow}>
                        <Text style={styles.detailDate}>
                          {formatDate(r.date, locale, { month: 'short', day: 'numeric' })}
                        </Text>
                        <Text style={styles.detailSets}>{setLine(r.ex, style, unitSystem)}</Text>
                      </View>
                    ))}
                  </>
                )}

                <View style={styles.manageRow}>
                  <TouchableOpacity onPress={() => setMode('edit')} testID="exercise-edit">
                    <Text style={styles.manageLink}>{t('train.edit')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setMode('merge')} testID="exercise-merge">
                    <Text style={styles.manageLink}>{t('train.merge')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmDel(true)} testID="exercise-delete">
                    <Text style={[styles.manageLink, styles.manageDanger]}>{t('common.remove')}</Text>
                  </TouchableOpacity>
                </View>
                {confirmDel ? (
                  <View style={styles.confirmRow}>
                    <Text style={styles.panelHint}>{t('train.deleteExercise')}</Text>
                    <View style={styles.confirmBtns}>
                      <TouchableOpacity onPress={() => setConfirmDel(false)} hitSlop={6}>
                        <Text style={styles.manageLink}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={doDelete} hitSlop={6} disabled={busy} testID="exercise-delete-confirm">
                        <Text style={[styles.manageLink, styles.manageDanger]}>{t('common.remove')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </>
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
    </BottomSheet>
  );
}

function PrCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.prCard}>
      <Text style={styles.prValue}>{value}</Text>
      <Text style={styles.prLabel}>{label}</Text>
      {/* "e1RM" is an abbreviation of an abbreviation; the number means
          nothing without a line saying what it is. */}
      {hint ? <Text style={styles.prHint}>{hint}</Text> : null}
    </View>
  );
}

/** "3 exercises · 12 sets" from the counts core derived. Pluralization is
 *  per-locale, which is why the counting and the wording are separate. */
function countsLine({ exercises, sets }: { exercises: number; sets: number }, t: TFn): string {
  const ex = `${exercises} ${exercises === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
  const st = `${sets} ${sets === 1 ? t('train.setOne') : t('train.setMany')}`;
  return `${ex} · ${st}`;
}

/**
 * "3 exercises · 12 sets · 32 min cardio".
 *
 * The cardio clause is APPENDED rather than folded into the counts, which is
 * the summary-line form of ADR-0025's rule: `sessionCounts` walks
 * `exercises[]` and must keep walking only that, so a session with cardio must
 * not report more sets than it has.
 *
 * A cardio-only session drops the "0 exercises · 0 sets" prefix entirely —
 * a run is not a lifting day with nothing in it.
 */
function sessionSummary(s: WorkoutSession, t: TFn): string {
  const minutes = Math.round(sessionCardioSec(s) / 60);
  const cardio = minutes > 0
    ? `${minutes} ${t('cardio.durationUnit')} ${t('cardio.title').toLowerCase()}`
    : '';
  const counts = sessionCounts(s);
  if (counts.exercises === 0 && cardio) return cardio;
  const line = countsLine(counts, t);
  return cardio ? `${line} · ${cardio}` : line;
}

function templateSummary(tpl: WorkoutTemplate, t: TFn): string {
  return countsLine(templateCounts(tpl), t);
}

/**
 * The engine's call for one exercise, from the completed history the tab
 * already holds. The prescription (cluster or not, rep target, increment)
 * comes from the template row; the equipment (`availableLoads`, `assisted`)
 * from the catalog exercise. An ad-hoc session exercise has no template row,
 * so its own sets say whether it is clustered and its snapshotted
 * `progression` supplies the band.
 */
function recommendationFor(
  train: ReturnType<typeof useTrain>,
  exerciseId: string,
  templateRow: WorkoutTemplate['exercises'][number] | null | undefined,
  sessionEx?: SessionExercise,
): Recommendation {
  const completed = train.recentSessions.filter((s) => s.status === 'completed');
  const history = exerciseHistory(completed, exerciseId);
  const catalogEx = train.catalog.find((e) => e.id === exerciseId) ?? null;
  const opts = templateRow
    ? recommendOptionsFor(templateRow, catalogEx)
    : {
        // No template row: this is an ad-hoc exercise, so its own sets are the
        // only statement of intent there is — both for `expectsCluster` and,
        // via the fallback list, for the ADR-0040 structure.
        ...recommendOptionsFor(null, catalogEx, sessionEx?.sets),
        expectsCluster: sessionEx?.sets.some((x) => x.kind === 'activation') ?? false,
        ...(sessionEx?.progression ? { progression: sessionEx.progression } : {}),
      };
  return recommend(history, opts);
}

/** Every exercise of a template with its recommendation, one line each. */
function TemplateNextSession({
  train,
  template,
}: {
  train: ReturnType<typeof useTrain>;
  template: WorkoutTemplate;
}) {
  const styles = useThemedStyles(createStyles);
  const rows = useMemo(
    () =>
      template.exercises
        .map((row) => ({ row, rec: recommendationFor(train, row.exerciseId, row) }))
        .filter((r) => r.rec.action !== 'none'),
    [train, template],
  );
  // One lift-settings sheet for the list, keyed on the exercise it is open
  // for — the effort standard and the band override are catalog properties,
  // and this list is where a "calibrating" line invites the question.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const open = rows.find((r) => r.row.exerciseId === settingsFor);
  const openEx = open ? train.catalog.find((e) => e.id === open.row.exerciseId) ?? null : null;
  if (rows.length === 0) return null;
  return (
    <View style={styles.tplNext} testID={`next-session-list-${template.id}`}>
      {rows.map(({ row, rec }) => (
        <View key={row.exerciseId} style={styles.tplNextRow}>
          <Text style={styles.tplNextName}>{row.name}</Text>
          <RecommendationNote
            rec={rec}
            compact
            testID={`rec-${template.id}-${row.exerciseId}`}
            onSettings={train.catalog.some((e) => e.id === row.exerciseId) ? () => setSettingsFor(row.exerciseId) : undefined}
          />
        </View>
      ))}
      <LiftSettingsSheet
        visible={openEx != null}
        exercise={openEx}
        rec={open?.rec ?? null}
        onClose={() => setSettingsFor(null)}
        onSave={(patch) => (openEx?.id ? train.editCatalogExercise(openEx.id, patch) : Promise.resolve())}
      />
    </View>
  );
}

// ─── Active session logger ──────────────────────────────────────
function ActiveSession({ train }: { train: ReturnType<typeof useTrain> }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const session = train.active!;
  const [addOpen, setAddOpen] = useState(false);
  const [cardioPickerOpen, setCardioPickerOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const rest = useRestTimer();

  // Lifts whose activation set cannot be read as a progression input. Judged
  // against the template the session was STARTED from, which is the only way
  // "logged as straight sets where a cluster was prescribed" is detectable —
  // the session alone carries no prescription. An ad-hoc session (no template)
  // still gets the RIR checks, just not that one.
  const invalidActivations = useMemo(
    () =>
      sessionActivationIssues(
        session.exercises,
        train.templates.find((tpl) => tpl.id === session.templateId) ?? null,
      ),
    [session.exercises, session.templateId, train.templates],
  );

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

  // Rest duration comes from the source template (mini sets get the shorter
  // rest); ad-hoc sessions fall back to sensible defaults.
  const tpl = train.templates.find((tt) => tt.id === session.templateId);
  const restMini = tpl?.restMiniSec ?? 60;
  const restCluster = tpl?.restClusterSec ?? 120;
  // The rest that follows a set is decided by the set that comes NEXT (core
  // `restAfterSet`), and an exercise may carry its own mini-set rest — a
  // bodyweight cluster cannot shed load between efforts, so its intra-cluster
  // rest is longer than a loaded lift's without moving the template default.
  const startRest = (exerciseIndex: number, setIndex: number) => {
    const ex = session.exercises[exerciseIndex];
    if (!ex) return;
    const override = tpl?.exercises.find((te) => te.exerciseId === ex.exerciseId)?.restMiniSec;
    rest.start(restAfterSet(ex.sets, setIndex, { mini: override ?? restMini, cluster: restCluster }));
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.activeBanner}>
          <Text style={styles.activeText}>
            {train.editingExisting ? t('train.editingSession') : t('train.inProgress')}
          </Text>
          {train.saving ? (
            <Text style={styles.savingText}>{t('common.saving')}</Text>
          ) : session.exercises.length > 0 ? (
            <Text style={styles.progressText}>{t('train.progress', { done: doneCount, total: session.exercises.length })}</Text>
          ) : null}
        </View>

        {session.exercises.length === 0 ? (
          <Text style={styles.empty}>{t('train.addFirst')}</Text>
        ) : (
          session.exercises.map((ex, exIdx) => (
            <ExerciseCard
              key={`${ex.exerciseId}-${exIdx}`}
              train={train}
              exerciseIndex={exIdx}
              collapsed={expanded !== exIdx}
              onToggle={() => {
                haptics.tap();
                setExpanded((cur) => (cur === exIdx ? null : exIdx));
              }}
              onSetDone={(setIdx) => startRest(exIdx, setIdx)}
            />
          ))
        )}

        {(session.cardio ?? []).map((block, i) => (
          <CardioBlockCard
            key={`cardio-${block.sourceId ?? i}`}
            block={block}
            index={i}
            overlaps={overlappingCardio.has(i)}
            onPatch={(patch, opts) =>
              void train.dispatch({ type: 'patchCardio', blockIndex: i, patch }, opts)
            }
            onCommit={() => void train.commitActive()}
            onRemove={() => {
              haptics.tap();
              void train.dispatch({ type: 'removeCardio', blockIndex: i });
            }}
          />
        ))}

        <TouchableOpacity style={styles.addExBtn} onPress={() => setAddOpen(true)} testID="add-exercise">
          <Text style={styles.addExText}>{t('train.addExercise')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.addExBtn}
          onPress={() => setCardioPickerOpen(true)}
          testID="add-cardio"
        >
          <Text style={styles.addExText}>{t('cardio.add')}</Text>
        </TouchableOpacity>

        <View style={styles.footerBtns}>
          {train.editingExisting ? (
            // Editing a past workout: no destructive Discard (that deletes the
            // whole session). Cancel reverts to the pre-edit state; Done saves.
            <>
              <TouchableOpacity
                style={styles.discardBtn}
                onPress={() => train.cancelEdit()}
                testID="cancel-editing"
              >
                <Text style={styles.discardText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.finishBtn}
                onPress={() => train.finishEdit()}
                testID="done-editing"
              >
                <Text style={styles.finishText}>{t('train.doneEditing')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.discardBtn} onPress={() => train.discardWorkout()} testID="discard-workout">
                <Text style={styles.discardText}>{t('train.discard')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.finishBtn}
                onPress={async () => {
                  await train.commitActive();
                  setFinishOpen(true);
                }}
                testID="finish-workout"
              >
                <Text style={styles.finishText}>{t('train.finish')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Rest countdown — floats above the tab bar so it stays visible while
          the session scrolls (was buried inline in the scroll flow before). */}
      {rest.remaining > 0 ? (
        <View style={styles.restBarFloat} testID="rest-bar">
          <Text style={styles.restLabel}>{`${t('train.rest')} · ${rest.label}`}</Text>
          <View style={styles.restActions}>
            <TouchableOpacity onPress={() => rest.start(rest.remaining + 30)} hitSlop={6} testID="rest-plus">
              <Text style={styles.restPlus}>+30s</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => rest.stop()} hitSlop={6} testID="rest-skip">
              <Text style={styles.restSkip}>{t('train.skip')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <AddExerciseModal
        visible={addOpen}
        train={train}
        onClose={() => setAddOpen(false)}
      />
      <CardioPickerSheet
        visible={cardioPickerOpen}
        onClose={() => setCardioPickerOpen(false)}
        onPick={(modality) => void train.dispatch({ type: 'addCardio', modality })}
      />
      <FinishModal
        visible={finishOpen}
        onClose={() => setFinishOpen(false)}
        // Reported at the finish boundary, where the whole session is in view
        // and a lift can still be repeated — not as a mid-set interruption.
        // Never gates the save: an unreadable set is still training that
        // happened, and refusing to store it would lose the evidence.
        invalid={invalidActivations}
        onFinish={async (extras) => {
          await train.finishWorkout(extras);
          setFinishOpen(false);
          // Finishing a workout is the app's clearest "that went well"
          // beat — the best place to spend one of iOS's few rating
          // requests. Fire-and-forget; it self-throttles and no-ops
          // until the user has enough qualifying days.
          void recordPositiveMoment();
        }}
      />
    </>
  );
}

/** One i18n key per reason a progression read was rejected. A `Record` rather
 *  than a switch so adding an `ActivationIssue` without a string is a compile
 *  error — the union is small and its members are user-facing. */
const ACTIVATION_ISSUE_KEYS: Record<ActivationIssue, I18nKey> = {
  'rir-too-easy': 'train.invalidRirEasy',
  'rir-missing': 'train.invalidRirMissing',
  'not-clustered': 'train.invalidNotClustered',
};
const activationIssueKey = (issue: ActivationIssue): I18nKey => ACTIVATION_ISSUE_KEYS[issue];

/**
 * "Last: 135 x 8" — the ghost hint, shown on a COLLAPSED card only.
 *
 * It used to be the exercise's whole memory: one aggregate line at the card
 * head, where Hevy, Strong and Boostcamp all put last session's numbers on
 * EVERY set row. An aggregate cannot answer "what do I put in row 3", which is
 * the question being asked. The per-row answer is the PREVIOUS column
 * (`previousCell`); this survives as the one-line summary a collapsed row can
 * fit, which is exactly what an aggregate is good for.
 */
function lastHint(sug: ProgressionSuggestion, style: LogStyle, t: TFn): string | null {
  const last = lastPerformed(sug, style);
  if (!last) return null;
  const prefix = `${t('train.last')}: `;
  if (last.style === 'time') return `${prefix}${last.durationSec}s`;
  if (last.style === 'bodyweight') return `${prefix}${last.reps} ${t('train.reps')}`;
  return `${prefix}${last.weight} × ${last.reps}`;
}

function ExerciseCard({
  train,
  exerciseIndex,
  collapsed,
  onToggle,
  onSetDone,
}: {
  train: ReturnType<typeof useTrain>;
  exerciseIndex: number;
  collapsed: boolean;
  onToggle: () => void;
  onSetDone?: (setIndex: number) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const { colors } = useTheme();
  const ex = train.active!.exercises[exerciseIndex];
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
  const setLabels = useMemo(() => setRowLabels(ex.sets), [ex.sets]);
  const [panelOpen, setPanelOpen] = useState(false);

  // Set progress drives the collapsed-row badge (a check when every set is
  // logged, else "done/total") so a long session stays scannable at a glance.
  const totalSets = ex.sets.length;
  const loggedCount = ex.sets.filter((s) => isLoggedSet(s, style)).length;
  const allDone = totalSets > 0 && loggedCount === totalSets;

  // "Last time" ghost + deterministic +load bump. The progression rule is
  // snapshotted from the source template onto the session exercise (ad-hoc
  // exercises carry none → ghost only, no bump).
  const history = useMemo(
    () => exerciseHistory(train.recentSessions, ex.exerciseId),
    [train.recentSessions, ex.exerciseId],
  );
  const sug = suggestProgression(history, ex.progression, style);
  const ghost = lastHint(sug, style, t);
  const bumpTo = sug.bumped ? sug.suggestedWeight : undefined;
  // The progression engine's call. On a clustered lift it REPLACES the
  // double-progression bump and the blocked note below (it subsumes both: the
  // RIR band is its layer 1, the bump its layer 2). A straight-set lift gets
  // `action: 'none'` and keeps exactly what it had.
  const templateRow = train.templates
    .find((tpl) => tpl.id === train.active?.templateId)
    ?.exercises.find((e) => e.exerciseId === ex.exerciseId);
  const rec = useMemo(
    () => recommendationFor(train, ex.exerciseId, templateRow, ex),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- history + catalog are what change it
    [train.recentSessions, train.catalog, ex.exerciseId, templateRow, ex.progression],
  );
  const engineHasCall = rec.action !== 'none';
  const [liftOpen, setLiftOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const catalogEx = train.catalog.find((e) => e.id === ex.exerciseId) ?? null;
  // Last session's sets, positionally — row 3 compares against row 3. This is
  // the PREVIOUS column every competitor puts on every row and this app had
  // only as one aggregate line at the card head.
  const prevSets = useMemo(() => previousSets(history), [history]);
  // Which add-actions this lift can use (ADR-0040). The card used to show the
  // union of every structure's needs — `+ Add set` AND `+ Add cluster` — under
  // every exercise, including the straight-set ones that can use neither.
  // Resolved through core's precedence (template -> catalog -> inference) so
  // an undeclared legacy template keeps every affordance it was written with.
  const canAdd = addActionsFor(
    templateRow?.setStructure
      ?? catalogEx?.setStructure
      ?? (ex.sets.some((x) => x.kind === 'activation') ? undefined : 'straight'),
  );
  // When core withheld a recommendation because the last activation was
  // unreadable, SAY so. Silence and "no bump today" look identical otherwise,
  // and the second one is a claim about the training rather than about the data.
  const blockedNote = sug.blockedBy ? t(activationIssueKey(sug.blockedBy)) : null;

  // Plate + warm-up math keys off the first loaded set's weight, else the
  // snapshotted target load. Barbell-only (weight-reps).
  const keyWeight = ex.sets.find((s) => (s.weight ?? 0) > 0)?.weight ?? ex.targetLoad;
  const showPanel = style === 'weight-reps';
  // Solved in the DISPLAY unit with that unit's own bar and plates — a metric
  // gym's bar is 20 kg and its smallest plate is 1.25 kg, and converting a
  // pound solve afterwards yields 20.4 kg plates nobody owns. See
  // `load-units.ts` for why this module exists separately from body weight.
  const load =
    panelOpen && keyWeight && keyWeight > 0
      ? computePlateLoad(toDisplayLoad(keyWeight, unitSystem), barFor(unitSystem), platesFor(unitSystem))
      : null;
  // Same rule as the plate solve directly above, and it was missed on the
  // first pass: the ladder is BUILT from plate loads, so running it in pounds
  // and rendering the result next to a kg working set produced `45 x 10` under
  // `WORKING SET · 100 KG`. Caught on the device.
  const warm =
    panelOpen && keyWeight && keyWeight > 0
      ? generateWarmup(toDisplayLoad(keyWeight, unitSystem), barFor(unitSystem), platesFor(unitSystem))
      : [];

  return (
    <Animated.View style={styles.exCard} layout={smoothLayout}>
      <View style={styles.exHeadRow}>
      <TouchableOpacity
        style={styles.exHead}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        testID={`exercise-head-${exerciseIndex}`}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.exName}>{ex.name}</Text>
          {/* Only while collapsed: an open card shows last session per ROW,
              and repeating an aggregate above it is two answers to one
              question. */}
          {collapsed && ghost ? <Text style={styles.ghost}>{ghost}</Text> : null}
        </View>
        {allDone ? (
          <View style={styles.exDone}>
            <Ionicons name="checkmark" size={15} color={colors.onInk} />
          </View>
        ) : totalSets > 0 ? (
          <View style={styles.exCount}>
            <Text style={styles.exCountText}>{loggedCount}/{totalSets}</Text>
          </View>
        ) : null}
        <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={20} color={colors.faint} style={styles.exChevron} />
      </TouchableOpacity>
      {/* One overflow control in place of four permanent inline ones. Only on
          an open card: a collapsed row is a list item, not a form. */}
      {collapsed ? null : (
        <TouchableOpacity
          style={styles.exMoreBtn}
          onPress={() => setMenuOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('train.exMenuA11y', { name: ex.name })}
          testID={`exercise-menu-${exerciseIndex}`}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </TouchableOpacity>
      )}
      </View>

      {collapsed ? null : (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          {engineHasCall && catalogEx ? (
            <LiftSettingsSheet
              visible={liftOpen}
              exercise={catalogEx}
              rec={rec}
              onClose={() => setLiftOpen(false)}
              onSave={(patch) => train.editCatalogExercise(catalogEx.id as string, patch)}
            />
          ) : null}
          {engineHasCall ? (
            <RecommendationNote
              rec={rec}
              testID={`recommendation-${exerciseIndex}`}
              onSettings={catalogEx ? () => setLiftOpen(true) : undefined}
              onAccept={(load) => {
                haptics.tap();
                // Same affordance the bump had: the accepted load lands on
                // every working set that has no weight yet, so a cluster's
                // minis inherit it too.
                ex.sets.forEach((s, idx) => {
                  if (isWorkingSet(s) && (s.weight ?? 0) === 0) {
                    train.dispatch({ type: 'patchSet', exerciseIndex, setIndex: idx, patch: { weight: load } });
                  }
                });
              }}
            />
          ) : bumpTo != null ? (
            <TouchableOpacity
              style={styles.bumpChip}
              onPress={() => {
                haptics.tap();
                const idx = ex.sets.findIndex((s) => isWorkingSet(s));
                if (idx >= 0) {
                  train.dispatch({
                    type: 'patchSet',
                    exerciseIndex,
                    setIndex: idx,
                    patch: { weight: bumpTo },
                  });
                }
              }}
              testID={`bump-${exerciseIndex}`}
            >
              <Text style={styles.bumpText}>
                {t('train.bumpTo', { weight: formatLoad(bumpTo, unitSystem) })}
              </Text>
            </TouchableOpacity>
          ) : blockedNote ? (
            <View style={styles.blockedRow} testID={`progression-blocked-${exerciseIndex}`}>
              <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
              <Text style={styles.blockedText}>{blockedNote}</Text>
            </View>
          ) : null}

      {/* Row labels are derived from the whole sequence, not the index: a
          cluster takes one set number with lettered sub-sets (2a/2b/2c). */}
      <View style={styles.setHeadRow}>
        <Text style={[styles.setHeadCell, styles.setNumCell]}>#</Text>
        {/* PREVIOUS. The single highest-leverage cell on the screen and the
            one this app did not have: it turns logging from a decision into a
            comparison — match it or beat it. */}
        <Text style={[styles.setHeadCell, styles.setPrevCell, styles.setPrevText]} numberOfLines={1} adjustsFontSizeToFit>
          {t('train.prevShort')}
        </Text>
        {/* The column header IS the unit, so it stops being a fixed string. */}
        {style === 'weight-reps' ? <Text style={[styles.setHeadCell, styles.setInputCell]}>{loadUnit(unitSystem)}</Text> : null}
        {style === 'time' ? (
          <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.sec')}</Text>
        ) : (
          <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.reps')}</Text>
        )}
        {/* One line, shrink-to-fit: the RIR column is the narrowest in the row
            and es-PR's "FALTAN" wrapped to "FALTA / N" at 6.9" width
            (seen in the 2026-09-05 store captures). */}
        <Text style={[styles.setHeadCell, styles.setRirCell]} numberOfLines={1} adjustsFontSizeToFit>
          {t('train.rirShort')}
        </Text>
        <View style={styles.setDoneCell} />
      </View>

      {ex.sets.map((set, setIdx) => (
        <SetRow
          key={setIdx}
          train={train}
          exerciseIndex={exerciseIndex}
          setIndex={setIdx}
          set={set}
          logStyle={style}
          label={setLabels[setIdx]}
          // Positional: row 3 against row 3. Comparing against the nth WORKING
          // set instead would silently re-point the moment a warm-up is added
          // or dropped, and a comparison that moves is worse than none.
          previous={previousCell(prevSets[setIdx], style, unitSystem)}
          previousSet={prevSets[setIdx]}
          onDone={onSetDone}
        />
      ))}

      {/* The ONE action taken mid-set stays on the card. Everything else moved
          into the overflow menu — burying the most frequent action to tidy the
          rarest ones is the same mistake in the other direction. */}
      <TouchableOpacity
        style={styles.addSetBtn}
        onPress={() => train.dispatch({ type: 'addSet', exerciseIndex })}
        testID={`add-set-${exerciseIndex}`}
      >
        <Text style={styles.addSetText}>{t('train.addSet')}</Text>
      </TouchableOpacity>

      {showPanel ? (
        <>
          {panelOpen ? (
            <View style={styles.panel} testID={`plates-panel-${exerciseIndex}`}>
              {keyWeight && keyWeight > 0 ? (
                <>
                  <Text style={styles.panelLabel}>{`${t('train.workingSet')} · ${formatLoad(keyWeight, unitSystem)}`}</Text>
                  <Text style={styles.plateText}>
                    {load && load.perSide.length
                      ? `${load.perSide.map((p) => `${p.plate}×${p.count}`).join('   ')}  ${t('train.perSidePlates')}`
                      : t('train.barOnly')}
                  </Text>
                  {load && load.remainder > 0 ? (
                    <Text style={styles.panelHint}>{`+${load.remainder} ${t('train.short')}`}</Text>
                  ) : null}
                  {warm.length ? (
                    <>
                      <Text style={[styles.panelLabel, { marginTop: space.sm }]}>{t('train.warmupLabel')}</Text>
                      {warm.map((w, i) => (
                        <Text key={i} style={styles.warmRow}>
                          {`${w.weight} × ${w.reps}${w.pct != null ? `   ${Math.round(w.pct * 100)}%` : ''}`}
                        </Text>
                      ))}
                    </>
                  ) : null}
                </>
              ) : (
                <Text style={styles.panelHint}>{t('train.enterWeight')}</Text>
              )}
            </View>
          ) : null}
        </>
      ) : null}

          <ExerciseMenuSheet
            visible={menuOpen}
            name={ex.name}
            onClose={() => setMenuOpen(false)}
            actions={[
              ...(canAdd.cluster
                ? [{
                    key: 'cluster',
                    icon: 'layers-outline' as const,
                    labelKey: 'train.addCluster' as I18nKey,
                    descKey: 'train.addClusterDesc' as I18nKey,
                    onPress: () => void train.dispatch({ type: 'addCluster', exerciseIndex }),
                  }]
                : []),
              ...(canAdd.block
                ? [{
                    key: 'block',
                    icon: 'layers-outline' as const,
                    labelKey: 'train.addBlock' as I18nKey,
                    descKey: 'train.addBlockDesc' as I18nKey,
                    onPress: () => void train.dispatch({ type: 'addBlock', exerciseIndex }),
                  }]
                : []),
              ...(showPanel
                ? [{
                    key: 'plates',
                    icon: 'barbell-outline' as const,
                    labelKey: (panelOpen ? 'train.hidePanel' : 'train.platesWarmup') as I18nKey,
                    onPress: () => setPanelOpen((o) => !o),
                  }]
                : []),
              ...(engineHasCall && catalogEx
                ? [{
                    key: 'lift',
                    icon: 'options-outline' as const,
                    labelKey: 'train.lift.title' as I18nKey,
                    onPress: () => setLiftOpen(true),
                  }]
                : []),
              {
                key: 'remove',
                icon: 'trash-outline' as const,
                labelKey: 'train.removeExercise' as I18nKey,
                destructive: true,
                onPress: () => void train.dispatch({ type: 'removeExercise', exerciseIndex }),
              },
            ] satisfies ExerciseMenuAction[]}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

function SetRow({
  train,
  exerciseIndex,
  setIndex,
  set,
  logStyle,
  label,
  previous,
  previousSet,
  onDone,
}: {
  train: ReturnType<typeof useTrain>;
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
  onDone?: (setIndex: number) => void;
}) {
  const unitSystem = useUnitSystem();
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
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // ONE sheet in place of the set-kind and RIR expanders, which both opened
  // INSIDE the set list and pushed every row below them down — a layout jump
  // mid-logging, on a screen used one-handed with wet hands.
  const [sheetOpen, setSheetOpen] = useState(false);

  const commit = () => train.commitActive();
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

  // Closed after a delete taken from the sheet, so the row that slides up into
  // this slot is not already swiped open.
  const swipeRef = useRef<SwipeableMethods>(null);
  const remove = () => {
    swipeRef.current?.close();
    return train.dispatch({ type: 'removeSet', exerciseIndex, setIndex });
  };

  const row = (
    <View style={styles.setRow}>
      <TouchableOpacity
        style={styles.setNumCell}
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('train.setTypeA11y', { n: label, kind: t(kindLabelKey(set.kind)) })}
        testID={`set-kind-${exerciseIndex}-${setIndex}`}
      >
        <Text style={[styles.setNum, set.group != null && styles.setNumCluster]}>{label}</Text>
      </TouchableOpacity>

      {/* PREVIOUS — read-only on purpose. It is the number to match or beat,
          and making it a field would invite typing into last week. */}
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
        >
          {previous ?? '—'}
        </Text>
      </View>

      {logStyle === 'weight-reps' ? (
        <TextInput
          style={[styles.setInput, styles.setInputCell]}
          placeholder={
            previousSet?.weight != null
              ? String(toDisplayLoad(previousSet.weight, unitSystem))
              : '0'
          }
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
          value={weight}
          onChangeText={(v) => {
            setWeight(v);
            train.dispatch(
              {
                type: 'patchSet',
                exerciseIndex,
                setIndex,
                // Through the shared ceiling (@macrolog/core) for the same
                // reason RIR is: `parseLoadToLb` only converts units and
                // rejects negatives, so a mistyped 12750 was storable (#85).
                patch: { weight: clampSetLoad(parseLoadToLb(v, unitSystem)) },
              },
              { defer: true },
            );
          }}
          onEndEditing={commit}
          testID={`set-weight-${exerciseIndex}-${setIndex}`}
        />
      ) : null}

      <TextInput
        style={[styles.setInput, styles.setInputCell]}
        placeholder={acceptCount != null ? String(acceptCount) : '0'}
        placeholderTextColor={colors.faint}
        keyboardType="numeric"
        value={count}
        onChangeText={(v) => {
          setCount(v);
          const n = numOrUndef(v);
          train.dispatch(
            {
              type: 'patchSet',
              exerciseIndex,
              setIndex,
              patch: logStyle === 'time' ? { durationSec: n } : { reps: n },
            },
            { defer: true },
          );
        }}
        onEndEditing={commit}
        testID={`set-count-${exerciseIndex}-${setIndex}`}
      />

      {showRir ? (
        // A bare numeric box asked the user to know both the acronym and that
        // 0 is the hard end of the scale. Tapping opens the labelled picker in
        // the set sheet, so the scale explains itself.
        <TouchableOpacity
          style={[styles.setInput, styles.setRirCell, styles.setRirBtn]}
          onPress={() => setSheetOpen(true)}
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
          <Text style={[styles.setRirValue, set.rir == null && styles.setRirEmpty]}>
            {set.rir == null ? '–' : String(set.rir)}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.setRirCell} />
      )}

      <TouchableOpacity
        style={[styles.setDoneCell, styles.doneBox, set.done && styles.doneBoxOn]}
        accessibilityLabel={t('common.done')}
        onPress={() => {
          haptics.tap();
          const nowDone = !set.done;
          // Ticking a set you have not typed into ACCEPTS what was prescribed
          // — or, failing that, what you did last time. This is the one-tap
          // path Strong and Hevy use, and the reason neither number is
          // pre-filled as a VALUE: nothing is logged until this tap, so
          // abandoning a session mid-way records only what was actually done.
          // Typed input always wins; untick never erases.
          const accept = nowDone && acceptCount != null && numOrUndef(count) == null;
          if (accept) {
            setCount(String(acceptCount));
            // Deferred: the `done` patch below persists, and it reads the same
            // ref this one just updated, so one write carries both. Two
            // immediate writes would race for no benefit.
            train.dispatch(
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
          if (
            nowDone && logStyle === 'weight-reps'
            && numOrUndef(weight) == null && previousSet?.weight != null
          ) {
            setWeight(String(toDisplayLoad(previousSet.weight, unitSystem)));
            train.dispatch(
              { type: 'patchSet', exerciseIndex, setIndex, patch: { weight: previousSet.weight } },
              { defer: true },
            );
          }
          train.dispatch({ type: 'patchSet', exerciseIndex, setIndex, patch: { done: nowDone } });
          if (nowDone) onDone?.(setIndex); // start the rest countdown
        }}
        testID={`set-done-${exerciseIndex}-${setIndex}`}
      >
        <Ionicons name="checkmark" size={font.small + 2} style={[styles.doneCheck, set.done && styles.doneCheckOn]} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View>
      {/* Swipe-left to delete — the gesture the whole category uses for this.
          The permanent `✕` it replaces was a seventh target on every row: the
          smallest, the most destructive, and directly beside the one control
          tapped after every single set. The set sheet carries the same action
          as a labelled row, which is what keeps it reachable by VoiceOver and
          by anyone who does not know the gesture. */}
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

      <SetRowSheet
        visible={sheetOpen}
        set={set}
        label={label}
        onClose={() => setSheetOpen(false)}
        onKind={(kind) => {
          train.dispatch({ type: 'setSetKind', exerciseIndex, setIndex, kind });
          setSheetOpen(false);
        }}
        onRir={(rir) => {
          train.dispatch(
            { type: 'patchSet', exerciseIndex, setIndex, patch: { rir } },
            { defer: true },
          );
          void commit();
          setSheetOpen(false);
        }}
        onRemove={() => {
          setSheetOpen(false);
          void remove();
        }}
      />
    </View>
  );
}

/** Modality → i18n key. Lives here rather than in `train-shared` because the
 *  picker is the only consumer; `CardioBlockCard` keeps its own copy for the
 *  same reason the set-kind labels are duplicated between screen and sheet. */
const CARDIO_MODALITY_KEY: Record<CardioModality, I18nKey> = {
  run: 'cardio.modality.run',
  walk: 'cardio.modality.walk',
  ride: 'cardio.modality.ride',
  swim: 'cardio.modality.swim',
  row: 'cardio.modality.row',
  elliptical: 'cardio.modality.elliptical',
  stair: 'cardio.modality.stair',
  hike: 'cardio.modality.hike',
  sport: 'cardio.modality.sport',
  other: 'cardio.modality.other',
};

// ─── Cardio modality picker ─────────────────────────────────────

/**
 * Pick what the effort was; the card then collects the numbers.
 *
 * Two steps rather than one long form because the modality is the only field
 * with no sensible default — everything else on a cardio block is optional, and
 * a run carrying just a duration is already a complete record. Uses
 * `<BottomSheet>` like every other sheet here; `sheets-are-one-component.test.ts`
 * fails the build on a hand-rolled slide Modal.
 */
function CardioPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (modality: CardioModality) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <Text style={styles.sheetTitle}>{t('cardio.pickModality')}</Text>
      <View style={styles.modalityChips}>
        {CARDIO_MODALITIES.map((m) => (
          <TouchableOpacity
            key={m}
            style={styles.kindChip}
            testID={`cardio-modality-${m}`}
            onPress={() => {
              haptics.tap();
              onPick(m);
              onClose();
            }}
          >
            <Text style={styles.kindChipText}>{t(CARDIO_MODALITY_KEY[m])}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

// ─── Add-exercise modal ─────────────────────────────────────────
function AddExerciseModal({
  visible,
  train,
  onClose,
}: {
  visible: boolean;
  train: ReturnType<typeof useTrain>;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const addExerciseInputRef = useDeferredFocus(visible);
  const [name, setName] = useState('');
  // A CreationStyle, not a LogStyle: the fourth option is `mobility`, which
  // means a timed exercise WHOSE SETS are mobility. Same seam as the template
  // editor's chip row — this is the other door onto the same defect, and
  // fixing only one leaves a stretch added mid-session able to take a
  // duration PR (ADR-0028).
  const [logStyle, setLogStyle] = useState<CreationStyle>('weight-reps');

  useEffect(() => {
    if (visible) {
      setName('');
      setLogStyle('weight-reps');
    }
  }, [visible]);

  const trimmed = name.trim();

  async function add(exName: string, style: CreationStyle, exerciseId?: string) {
    haptics.tap();
    await train.addExerciseToActive(exName, logStyleFor(style), exerciseId, setKindFor(style));
    onClose();
  }

  async function addSeed(seed: SeedExercise) {
    haptics.tap();
    await train.addLibraryExerciseToActive(seed);
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
          <Text style={styles.sheetTitle}>{t('train.addExerciseTitle')}</Text>

          <TextInput
            ref={addExerciseInputRef}
            style={styles.input}
            placeholder={t('train.exerciseName')}
            placeholderTextColor={colors.faint}
            value={name}
            onChangeText={setName}
            testID="exercise-name"
          />

          <View style={[styles.styleRow, styles.styleRowWrap]}>
            {CREATION_STYLES.map((ls) => {
              const on = logStyle === ls.value;
              return (
                <TouchableOpacity
                  key={ls.value}
                  style={[styles.styleChip, styles.styleChipHalf, on && styles.styleChipOn]}
                  onPress={() => setLogStyle(ls.value)}
                  testID={`logstyle-${ls.value}`}
                >
                  <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {trimmed ? (
            <TouchableOpacity style={styles.createRow} onPress={() => add(trimmed, logStyle)} testID="create-exercise">
              <Text style={styles.createText}>{t('train.addNamed', { name: trimmed })}</Text>
            </TouchableOpacity>
          ) : null}

          {/* The user's catalog AND the shipped library, one list. The
              library half is the fix for the free-type path minting a
              movement with `muscles: []` that no screen could then edit. */}
          <ScrollView style={styles.catalogList} keyboardShouldPersistTaps="handled">
            <ExerciseSearchList
              query={name}
              catalog={train.catalog}
              testIDPrefix="add-ex"
              // A seeded mobility movement stays mobility when re-added from
              // the catalog, whatever the chips happen to be showing.
              onPickCatalog={(e) =>
                void add(
                  e.name,
                  e.seedKey != null && MOBILITY_SEED_KEYS.has(e.seedKey)
                    ? 'mobility'
                    : (e.logStyle ?? 'weight-reps'),
                  e.id,
                )
              }
              onPickSeed={(seed) => void addSeed(seed)}
            />
          </ScrollView>
    </BottomSheet>
  );
}

// ─── Finish modal ───────────────────────────────────────────────
function FinishModal({
  visible,
  onFinish,
  onClose,
  invalid,
}: {
  /** Lifts whose activation could not be read. Reported, never blocking. */
  invalid: ActivationFinding[];
  visible: boolean;
  onFinish: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // Body weight only — the LOADS on this screen (volume, PRs, plate math) stay
  // in pounds on purpose. F3 is about the weight of the person, and converting
  // barbell loads is a separate job with its own plate maths.
  const unitSystem = useUnitSystem();
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState('');
  const [busy, setBusy] = useState(false);
  const [weightErr, setWeightErr] = useState('');

  useEffect(() => {
    if (visible) {
      setBodyweight('');
      setSleep('');
      setBusy(false);
      setWeightErr('');
    }
  }, [visible]);

  async function finish() {
    if (busy) return;
    // Same gate the Body tab applies (`checkWeightEntry`): this sheet mirrors
    // its value into `dailyWeights`, and it accepted 11 lb once. A typo is
    // rejected here, in the sheet, rather than silently dropped by the writer.
    const lb = parseWeightToLb(bodyweight, unitSystem);
    if (lb != null && !checkWeightEntry(lb).ok) {
      const b = weightBoundsFor(unitSystem);
      setWeightErr(t('body.weightRange', { min: b.min, max: b.max, unit: bodyWeightUnit(unitSystem) }));
      return;
    }
    setWeightErr('');
    setBusy(true);
    try {
      await onFinish({
        bodyweight: lb ?? undefined,
        sleepHours: numOrUndef(sleep),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
          {/* Scroll so the numeric keyboard can't hide the Complete button
              (KeyboardAvoidingView under-lifts inside a bottom-sheet Modal). */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.finishScroll}
          >
          <Text style={styles.sheetTitle}>{t('train.finishTitle')}</Text>
          <Text style={styles.sheetHint}>{t('train.finishHint')}</Text>

          <View style={styles.finishRow}>
            <View style={styles.finishField}>
              <Text style={styles.fieldLabel}>
                {t('train.bodyweight', { unit: bodyWeightUnit(unitSystem) })}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="—"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={bodyweight}
                onChangeText={setBodyweight}
                testID="finish-bodyweight"
              />
              {weightErr ? (
                <Text style={[styles.sheetHint, { color: colors.danger }]} testID="finish-bodyweight-error">
                  {weightErr}
                </Text>
              ) : null}
            </View>
            <View style={styles.finishField}>
              <Text style={styles.fieldLabel}>{t('train.sleepH')}</Text>
              <TextInput
                style={styles.input}
                placeholder="—"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={sleep}
                onChangeText={setSleep}
                testID="finish-sleep"
              />
            </View>
          </View>

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

          <TouchableOpacity style={styles.finishBtn} onPress={finish} disabled={busy} testID="finish-confirm">
            <Text style={styles.finishText}>{busy ? t('common.saving') : t('train.complete')}</Text>
          </TouchableOpacity>
          </ScrollView>
    </BottomSheet>
  );
}

// ─── Template editor ────────────────────────────────────────────
// Mirrors the PWA's EditExercise (template-editor.component.ts): the row