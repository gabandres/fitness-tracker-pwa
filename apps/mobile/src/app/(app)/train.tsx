import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrain } from '@/hooks/useTrain';
import { useRestTimer } from '@/hooks/useRestTimer';
import type {
  Exercise,
  LogStyle,
  SessionExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '@/lib/workout';
import { DEFAULT_LOG_STYLE, isLoggedSet } from '@/lib/workout';
import {
  type SeedTemplate,
  RIR_MAX,
  RIR_MIN,
  STARTER_TEMPLATES,
  clampRir,
  seedTemplateName,
} from '@macrolog/core';
import {
  type ProgressionSuggestion,
  computeExercisePRs,
  computePlateLoad,
  generateWarmup,
  isWorkingSet,
  suggestProgression,
} from '@macrolog/core';
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
import { LOG_STYLES, SET_KINDS, logStyleKey, numOrUndef } from '@/components/train/train-shared';
import { createStyles } from '@/components/train/train-styles';
import { Sparkline } from '@/components/Sparkline';
import { TrainGlossary } from '@/components/TrainGlossary';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, smoothLayout, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useKeyboardSheetStyle } from '@/lib/use-keyboard-sheet-style';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { space } from '@/theme';
import { formatDate } from '@/lib/date-format';

/** The 0–5 RIR scale, spelled out one option per value. Derived from the
 *  bounds @macrolog/core owns so the picker can't drift from the clamp. */
const RIR_CHOICES: number[] = Array.from(
  { length: RIR_MAX - RIR_MIN + 1 },
  (_, i) => RIR_MIN + i,
);

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
  // null = closed; a template = edit it; {} = create new.
  const [editing, setEditing] = useState<WorkoutTemplate | Record<string, never> | null>(null);
  const [detailEx, setDetailEx] = useState<Exercise | null>(null);
  const [startersOpen, setStartersOpen] = useState(false);
  const stats = useMemo(
    () => trainHeroStats(train.recentSessions, Date.now()),
    [train.recentSessions],
  );

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
                {t('train.weekVolume')}  <Text style={styles.trendChipValue}>{stats.volume.toLocaleString()} lb</Text>
              </Text>
            ) : null}
            {stats.topSet > 0 ? (
              <Text style={styles.trendChip}>
                {t('train.topSet')}  <Text style={styles.trendChipValue}>{stats.topSet.toLocaleString()} lb</Text>
              </Text>
            ) : null}
          </View>
        )}
      </Animated.View>
      </Animated.View>

      <TouchableOpacity
        style={styles.startBtn}
        onPress={() => {
          haptics.tap();
          train.startWorkout();
        }}
        testID="start-workout"
      >
        <Text style={styles.startBtnText}>{t('train.start')}</Text>
      </TouchableOpacity>

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
            <View key={tpl.id} style={styles.tplRow} testID={`template-${tpl.id}`}>
              <Pressable style={styles.tplMain} onPress={() => setEditing(tpl)} testID={`edit-template-${tpl.id}`}>
                <Text style={styles.histDate}>{tpl.name}</Text>
                <Text style={styles.histSub}>{templateSummary(tpl, t)}</Text>
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
              onLongPress={() => s.id && train.deleteSession(s.id)}
            >
              <View style={styles.histMain}>
                <Text style={styles.histDate}>
                  {formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>
                <Text style={styles.histSub}>{sessionSummary(s, t)}</Text>
              </View>
              {sessionVolume(s) > 0 ? <Text style={styles.histVol}>{sessionVolume(s).toLocaleString()} lb</Text> : null}
            </Pressable>
          ))}
        </View>
      )}

      {train.catalog.length ? (
        <>
          <Text style={styles.sectionTitle}>{t('train.exercises')}</Text>
          <View style={styles.list}>
            {train.catalog.map((e) => (
              <Pressable
                key={e.id}
                style={styles.exLibRow}
                onPress={() => setDetailEx(e)}
                testID={`exercise-${e.id}`}
              >
                <Text style={styles.histDate}>{e.name}</Text>
                <Text style={styles.histSub}>{t(logStyleKey(e.logStyle))}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

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
  const es = useLocale() === 'es-PR';
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
      !train.templates.some((tpl) => !tpl.seedKey && tpl.name.toLowerCase() === seedTemplateName(seed, es).toLowerCase()),
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{t('train.starterTitle')}</Text>
            <Text style={styles.sheetHint}>{t('train.starterHint')}</Text>
            {available.length === 0 ? (
              <Text style={styles.sheetEmpty}>{t('train.starterAllCloned')}</Text>
            ) : null}
            {available.map((seed) => (
              <View key={seed.key} style={styles.tplRow}>
                <View style={styles.tplMain}>
                  <Text style={styles.histDate}>{seedTemplateName(seed, es)}</Text>
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
        </View>
      </View>
    </Modal>
  );
}

// ─── Per-exercise history + e1RM ────────────────────────────────
/** Working-set summary line for one logged exercise, by logStyle. The cells
 *  come from core; the separator is this app's spacing. */
function setLine(ex: SessionExercise, style: LogStyle): string {
  return workingSetCells(ex, style).join('   ');
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
  const { colors } = useTheme();
  const keyboardStyle = useKeyboardSheetStyle();
  const [mode, setMode] = useState<'view' | 'edit' | 'merge'>('view');
  const [confirmDel, setConfirmDel] = useState(false);
  const [editName, setEditName] = useState('');
  const [editStyle, setEditStyle] = useState<LogStyle>('weight-reps');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && exercise) {
      setMode('view');
      setConfirmDel(false);
      setEditName(exercise.name);
      setEditStyle(exercise.logStyle ?? 'weight-reps');
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
      await train.editCatalogExercise(exercise.id, { name: editName.trim(), logStyle: editStyle });
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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Animated.View style={[styles.sheet, keyboardStyle]}>
          <View style={styles.handle} />
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
                          <PrCard label={t('train.prWeight')} value={`${prs.maxWeight} lb`} />
                          <PrCard label={t('train.prE1rm')} value={`${Math.round(prs.bestE1RM)} lb`} hint={t('train.e1rmHint')} />
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
                        <Text style={styles.detailSets}>{setLine(r.ex, style)}</Text>
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
        </Animated.View>
      </View>
    </Modal>
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

function sessionSummary(s: WorkoutSession, t: TFn): string {
  return countsLine(sessionCounts(s), t);
}

function templateSummary(tpl: WorkoutTemplate, t: TFn): string {
  return countsLine(templateCounts(tpl), t);
}

// ─── Active session logger ──────────────────────────────────────
function ActiveSession({ train }: { train: ReturnType<typeof useTrain> }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const session = train.active!;
  const [addOpen, setAddOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const rest = useRestTimer();
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
  const startRest = (kind: WorkoutSet['kind']) => rest.start(kind === 'mini' ? restMini : restCluster);

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
              onSetDone={startRest}
            />
          ))
        )}

        <TouchableOpacity style={styles.addExBtn} onPress={() => setAddOpen(true)} testID="add-exercise">
          <Text style={styles.addExText}>{t('train.addExercise')}</Text>
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
      <FinishModal
        visible={finishOpen}
        onClose={() => setFinishOpen(false)}
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

/** "Last: 135 × 8" — the ghost hint. Core picks which numbers matter for the
 *  log style; this renders them in the user's language. */
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
  onSetDone?: (kind: WorkoutSet['kind']) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const ex = train.active!.exercises[exerciseIndex];
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
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

  // Plate + warm-up math keys off the first loaded set's weight, else the
  // snapshotted target load. Barbell-only (weight-reps).
  const keyWeight = ex.sets.find((s) => (s.weight ?? 0) > 0)?.weight ?? ex.targetLoad;
  const showPanel = style === 'weight-reps';
  const load = panelOpen && keyWeight && keyWeight > 0 ? computePlateLoad(keyWeight) : null;
  const warm = panelOpen && keyWeight && keyWeight > 0 ? generateWarmup(keyWeight) : [];

  return (
    <Animated.View style={styles.exCard} layout={smoothLayout}>
      <TouchableOpacity
        style={styles.exHead}
        onPress={onToggle}
        activeOpacity={0.7}
        testID={`exercise-head-${exerciseIndex}`}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.exName}>{ex.name}</Text>
          {ghost ? <Text style={styles.ghost}>{ghost}</Text> : null}
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

      {collapsed ? null : (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          {bumpTo != null ? (
            <TouchableOpacity
              style={styles.bumpChip}
              onPress={() => {
                haptics.tap();
                const idx = ex.sets.findIndex((s) => isWorkingSet(s));
                if (idx >= 0) {
                  train.applySetPatch(exerciseIndex, idx, { weight: bumpTo });
                }
              }}
              testID={`bump-${exerciseIndex}`}
            >
              <Text style={styles.bumpText}>{t('train.bumpTo', { weight: bumpTo })}</Text>
            </TouchableOpacity>
          ) : null}

      <View style={styles.setHeadRow}>
        <Text style={[styles.setHeadCell, styles.setNumCell]}>#</Text>
        {style === 'weight-reps' ? <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.lb')}</Text> : null}
        {style === 'time' ? (
          <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.sec')}</Text>
        ) : (
          <Text style={[styles.setHeadCell, styles.setInputCell]}>{t('train.reps')}</Text>
        )}
        <Text style={[styles.setHeadCell, styles.setRirCell]}>{t('train.rirShort')}</Text>
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
          number={setIdx + 1}
          onDone={onSetDone}
        />
      ))}

      <View style={styles.addSetRow}>
        <TouchableOpacity style={styles.addSetBtn} onPress={() => train.addSet(exerciseIndex)} testID={`add-set-${exerciseIndex}`}>
          <Text style={styles.addSetText}>{t('train.addSet')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addSetBtn} onPress={() => train.addCluster(exerciseIndex)} testID={`add-cluster-${exerciseIndex}`}>
          <Text style={styles.addSetText}>{t('train.addCluster')}</Text>
        </TouchableOpacity>
      </View>

      {showPanel ? (
        <>
          <TouchableOpacity
            style={styles.panelToggle}
            onPress={() => setPanelOpen((o) => !o)}
            testID={`plates-toggle-${exerciseIndex}`}
          >
            <Text style={styles.panelToggleText}>
              {panelOpen ? t('train.hidePanel') : t('train.platesWarmup')}
            </Text>
          </TouchableOpacity>
          {panelOpen ? (
            <View style={styles.panel} testID={`plates-panel-${exerciseIndex}`}>
              {keyWeight && keyWeight > 0 ? (
                <>
                  <Text style={styles.panelLabel}>{`${t('train.workingSet')} · ${keyWeight} lb`}</Text>
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

          <TouchableOpacity
            style={styles.exRemoveRow}
            onPress={() => train.removeExercise(exerciseIndex)}
            hitSlop={8}
            testID={`remove-ex-${exerciseIndex}`}
          >
            <Text style={styles.exRemove}>{t('common.remove')}</Text>
          </TouchableOpacity>
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
  number,
  onDone,
}: {
  train: ReturnType<typeof useTrain>;
  exerciseIndex: number;
  setIndex: number;
  set: WorkoutSet;
  logStyle: LogStyle;
  number: number;
  onDone?: (kind: WorkoutSet['kind']) => void;
}) {
  // Local string buffers so partial decimal input binds cleanly; the parsed
  // value is pushed into the session state via editSet, persisted on blur.
  const [weight, setWeight] = useState(set.weight != null ? String(set.weight) : '');
  const [count, setCount] = useState(
    logStyle === 'time'
      ? set.durationSec != null ? String(set.durationSec) : ''
      : set.reps != null ? String(set.reps) : '',
  );
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [kindOpen, setKindOpen] = useState(false);
  const [rirOpen, setRirOpen] = useState(false);

  const commit = () => train.commitActive();
  // What the template prescribed for this set, if it came from one. Shown as
  // the placeholder rather than the value: a target the lifter has not
  // confirmed is not a logged set (see WorkoutSet.targetReps).
  const target = logStyle === 'time' ? set.targetDurationSec : set.targetReps;
  // RIR is meaningful on real working effort, not warmups/back-offs.
  const showRir = set.kind === 'working' || set.kind === 'activation' || set.kind === 'mini';
  // Clustered sets show C1/C2 in place of the plain set number.
  const label = set.group != null ? `C${set.group}` : String(number);

  return (
   <View>
    <View style={styles.setRow}>
      <TouchableOpacity
        style={styles.setNumCell}
        onPress={() => setKindOpen((o) => !o)}
        testID={`set-kind-${exerciseIndex}-${setIndex}`}
      >
        <Text style={[styles.setNum, set.group != null && styles.setNumCluster]}>{label}</Text>
      </TouchableOpacity>

      {logStyle === 'weight-reps' ? (
        <TextInput
          style={[styles.setInput, styles.setInputCell]}
          placeholder="0"
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
          value={weight}
          onChangeText={(t) => {
            setWeight(t);
            train.editSet(exerciseIndex, setIndex, { weight: numOrUndef(t) });
          }}
          onEndEditing={commit}
          testID={`set-weight-${exerciseIndex}-${setIndex}`}
        />
      ) : null}

      <TextInput
        style={[styles.setInput, styles.setInputCell]}
        placeholder={target != null ? String(target) : '0'}
        placeholderTextColor={colors.faint}
        keyboardType="numeric"
        value={count}
        onChangeText={(t) => {
          setCount(t);
          const v = numOrUndef(t);
          train.editSet(exerciseIndex, setIndex, logStyle === 'time' ? { durationSec: v } : { reps: v });
        }}
        onEndEditing={commit}
        testID={`set-count-${exerciseIndex}-${setIndex}`}
      />

      {showRir ? (
        // A bare numeric box asked the user to know both the acronym and that
        // 0 is the hard end of the scale. Tapping opens the same labelled
        // chip picker the set-kind cell uses, so the scale explains itself.
        <TouchableOpacity
          style={[styles.setInput, styles.setRirCell, styles.setRirBtn]}
          onPress={() => setRirOpen((o) => !o)}
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
        onPress={() => {
          haptics.tap();
          const nowDone = !set.done;
          // Ticking a prescribed set you have not typed into ACCEPTS the
          // prescription — the one-tap path Strong/Hevy use, and the reason
          // targets are not pre-filled as values: nothing is logged until
          // this tap, so abandoning a session mid-way records only what was
          // actually done. Typed input always wins; untick never erases.
          const accept = nowDone && target != null && numOrUndef(count) == null;
          if (accept) {
            setCount(String(target));
            train.editSet(
              exerciseIndex,
              setIndex,
              logStyle === 'time' ? { durationSec: target } : { reps: target },
            );
          }
          train.applySetPatch(exerciseIndex, setIndex, { done: nowDone });
          if (nowDone) onDone?.(set.kind); // start the rest countdown
        }}
        testID={`set-done-${exerciseIndex}-${setIndex}`}
      >
        <Text style={[styles.doneCheck, set.done && styles.doneCheckOn]}>✓</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => train.removeSet(exerciseIndex, setIndex)} hitSlop={6} style={styles.setDel}>
        <Text style={styles.setDelText}>✕</Text>
      </TouchableOpacity>
    </View>

    {kindOpen ? (
      <View style={styles.kindPicker}>
        <Text style={styles.kindPickerLabel}>{t('train.setType')}</Text>
        {/* Rows, not a chip wrap: "Activation" and "Mini" are cluster-training
            vocabulary, and a bare chip label teaches nobody what they are. */}
        {SET_KINDS.map((k) => {
          const on = set.kind === k.value;
          return (
            <TouchableOpacity
              key={k.value}
              style={[styles.kindRow, on && styles.kindRowOn]}
              onPress={() => {
                haptics.tap();
                train.setSetKind(exerciseIndex, setIndex, k.value);
                setKindOpen(false);
              }}
              testID={`set-kind-${exerciseIndex}-${setIndex}-${k.value}`}
            >
              <Text style={[styles.kindRowName, on && styles.kindRowNameOn]}>{t(k.labelKey)}</Text>
              <Text style={styles.kindRowDesc}>{t(k.descKey)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    ) : null}

    {rirOpen ? (
      <View style={styles.kindPicker}>
        <Text style={styles.kindPickerLabel}>{t('train.rirPrompt')}</Text>
        <View style={styles.kindChips}>
          <TouchableOpacity
            style={[styles.kindChip, set.rir == null && styles.kindChipOn]}
            onPress={() => {
              haptics.tap();
              train.editSet(exerciseIndex, setIndex, { rir: undefined });
              commit();
              setRirOpen(false);
            }}
            testID={`set-rir-${exerciseIndex}-${setIndex}-none`}
          >
            <Text style={[styles.kindChipText, set.rir == null && styles.kindChipTextOn]}>
              {t('train.rirClear')}
            </Text>
          </TouchableOpacity>
          {RIR_CHOICES.map((v) => {
            const on = set.rir === v;
            return (
              <TouchableOpacity
                key={v}
                style={[styles.kindChip, on && styles.kindChipOn]}
                onPress={() => {
                  haptics.tap();
                  // Still through the shared 0–5 clamp (@macrolog/core) so the
                  // two loggers cannot disagree about what is storable.
                  train.editSet(exerciseIndex, setIndex, { rir: clampRir(v) });
                  commit();
                  setRirOpen(false);
                }}
                testID={`set-rir-${exerciseIndex}-${setIndex}-${v}`}
              >
                <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>
                  {t(`train.rirScale.${v}` as I18nKey)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    ) : null}
   </View>
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
  const keyboardStyle = useKeyboardSheetStyle();
  const addExerciseInputRef = useDeferredFocus(visible);
  const [name, setName] = useState('');
  const [logStyle, setLogStyle] = useState<LogStyle>('weight-reps');

  useEffect(() => {
    if (visible) {
      setName('');
      setLogStyle('weight-reps');
    }
  }, [visible]);

  const trimmed = name.trim();
  const matches = trimmed
    ? train.catalog.filter((e) => e.name.toLowerCase().includes(trimmed.toLowerCase())).slice(0, 6)
    : train.catalog.slice(0, 8);

  async function add(exName: string, exLogStyle: LogStyle, exerciseId?: string) {
    haptics.tap();
    await train.addExerciseToActive(exName, exLogStyle, exerciseId);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Animated.View style={[styles.sheet, keyboardStyle]}>
          <View style={styles.handle} />
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

          <View style={styles.styleRow}>
            {LOG_STYLES.map((ls) => {
              const on = logStyle === ls.value;
              return (
                <TouchableOpacity
                  key={ls.value}
                  style={[styles.styleChip, on && styles.styleChipOn]}
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

          <ScrollView style={styles.catalogList} keyboardShouldPersistTaps="handled">
            {matches.map((e) => (
              <TouchableOpacity
                key={e.id}
                style={styles.catalogRow}
                onPress={() => add(e.name, e.logStyle ?? 'weight-reps', e.id)}
              >
                <Text style={styles.catalogName}>{e.name}</Text>
                <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
              </TouchableOpacity>
            ))}
            {matches.length === 0 ? (
              <Text style={styles.empty}>{t('train.noSaved')}</Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Finish modal ───────────────────────────────────────────────
function FinishModal({
  visible,
  onFinish,
  onClose,
}: {
  visible: boolean;
  onFinish: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const keyboardStyle = useKeyboardSheetStyle();
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setBodyweight('');
      setSleep('');
      setBusy(false);
    }
  }, [visible]);

  async function finish() {
    if (busy) return;
    setBusy(true);
    try {
      await onFinish({ bodyweight: numOrUndef(bodyweight), sleepHours: numOrUndef(sleep) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap}>
        <Animated.View style={[styles.sheet, keyboardStyle]}>
          <View style={styles.handle} />
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
              <Text style={styles.fieldLabel}>{t('train.bodyweight')}</Text>
              <TextInput
                style={styles.input}
                placeholder="—"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={bodyweight}
                onChangeText={setBodyweight}
                testID="finish-bodyweight"
              />
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

          <TouchableOpacity style={styles.finishBtn} onPress={finish} disabled={busy} testID="finish-confirm">
            <Text style={styles.finishText}>{busy ? t('common.saving') : t('train.complete')}</Text>
          </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Template editor ────────────────────────────────────────────
// Mirrors the PWA's EditExercise (template-editor.component.ts): the row