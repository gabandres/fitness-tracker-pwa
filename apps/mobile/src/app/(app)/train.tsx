import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrain } from '@/hooks/useTrain';
import { useRestTimer } from '@/hooks/useRestTimer';
import type {
  Exercise,
  LogStyle,
  SessionExercise,
  TemplateDraft,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from '@/lib/workout';
import { DEFAULT_LOG_STYLE, isLoggedSet, sessionVolume } from '@/lib/workout';
import { type SeedTemplate, STARTER_TEMPLATES, seedTemplateName } from '@macrolog/core';
import {
  type ProgressionSuggestion,
  computeExercisePRs,
  computePlateLoad,
  estimateOneRepMax,
  generateWarmup,
  isWorkingSet,
  suggestProgression,
} from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { Sparkline } from '@/components/Sparkline';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText, enterUp, springLayout, usePulse } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Idle-hero numbers: workouts + total volume logged in the last 7 days,
 *  plus the heaviest working set ever (the "top set" chip). */
function trainHeroStats(sessions: WorkoutSession[]) {
  const weekAgo = Date.now() - WEEK_MS;
  let count = 0;
  let volume = 0;
  let topSet = 0;
  for (const s of sessions) {
    if (s.date.getTime() >= weekAgo) {
      count += 1;
      volume += sessionVolume(s);
    }
    for (const ex of s.exercises) {
      const pr = computeExercisePRs([ex]);
      if (pr.maxWeight > topSet) topSet = pr.maxWeight;
    }
  }
  return { count, volume, topSet };
}

/** Best estimated-1RM per exercise across all sessions — the signature the PR
 *  celebration diffs against to detect a fresh personal record. */
function bestE1RMByExercise(sessions: WorkoutSession[]): Record<string, number> {
  const rows = new Map<string, SessionExercise[]>();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const arr = rows.get(ex.exerciseId) ?? [];
      arr.push(ex);
      rows.set(ex.exerciseId, arr);
    }
  }
  const out: Record<string, number> = {};
  for (const [id, exRows] of rows) out[id] = computeExercisePRs(exRows).bestE1RM;
  return out;
}

const LOG_STYLES: { value: LogStyle; labelKey: I18nKey }[] = [
  { value: 'weight-reps', labelKey: 'logStyle.weightReps' },
  { value: 'bodyweight', labelKey: 'logStyle.bodyweight' },
  { value: 'time', labelKey: 'logStyle.time' },
];

const SET_KINDS: { value: WorkoutSet['kind']; labelKey: I18nKey }[] = [
  { value: 'warmup', labelKey: 'train.kind.warmup' },
  { value: 'working', labelKey: 'train.kind.working' },
  { value: 'activation', labelKey: 'train.kind.activation' },
  { value: 'mini', labelKey: 'train.kind.mini' },
  { value: 'drop', labelKey: 'train.kind.drop' },
];

export default function Train() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const train = useTrain();

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
    if (prev) {
      const improved = Object.entries(bestByEx).some(([id, e1rm]) => e1rm > (prev[id] ?? 0));
      if (improved) {
        haptics.success();
        triggerPrPulse();
      }
    }
    prevBest.current = bestByEx;
  }, [bestByEx, train.loading, triggerPrPulse]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('nav.train')}</Text>
        <HeaderAvatar />
      </View>
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
  const styles = useThemedStyles(createStyles);
  // null = closed; a template = edit it; {} = create new.
  const [editing, setEditing] = useState<WorkoutTemplate | Record<string, never> | null>(null);
  const [detailEx, setDetailEx] = useState<Exercise | null>(null);
  const [startersOpen, setStartersOpen] = useState(false);
  const stats = useMemo(() => trainHeroStats(train.recentSessions), [train.recentSessions]);

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
                  {s.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
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
/** One metric point per completed session for an exercise, oldest-first
 *  (for the sparkline). Metric by logStyle: e1RM (weight-reps), max reps
 *  (bodyweight), max hold (time). Sessions with no qualifying set drop out. */
function exerciseSeries(history: SessionExercise[], style: LogStyle): number[] {
  const pts: number[] = [];
  for (const ex of history) {
    let metric = 0;
    for (const s of ex.sets) {
      if (!isWorkingSet(s)) continue;
      if (style === 'time') metric = Math.max(metric, s.durationSec ?? 0);
      else if (style === 'bodyweight') metric = Math.max(metric, s.reps ?? 0);
      else metric = Math.max(metric, estimateOneRepMax(s.weight, s.reps));
    }
    if (metric > 0) pts.push(Math.round(metric));
  }
  return pts.reverse(); // history is newest-first → oldest-first for the chart
}

/** Working-set summary line for one logged exercise, by logStyle. */
function setLine(ex: SessionExercise, style: LogStyle): string {
  const parts = ex.sets
    .filter(isWorkingSet)
    .map((s) => {
      if (style === 'time') return s.durationSec != null ? `${s.durationSec}s` : null;
      if (style === 'bodyweight') return s.reps != null ? `${s.reps}` : null;
      return s.weight != null && s.reps != null ? `${s.weight}×${s.reps}` : null;
    })
    .filter((p): p is string => p != null);
  return parts.join('   ');
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
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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
        <View style={styles.sheet}>
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
                <View style={[styles.styleRow, { marginTop: space.sm }]}>
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
                          <PrCard label={t('train.prE1rm')} value={`${Math.round(prs.bestE1RM)} lb`} />
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
                          {r.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
        </View>
      </View>
    </Modal>
  );
}

function PrCard({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.prCard}>
      <Text style={styles.prValue}>{value}</Text>
      <Text style={styles.prLabel}>{label}</Text>
    </View>
  );
}

/** Every set in the exercise is logged — drives the collapsed check badge and
 *  the "N of M done" session progress. */
function exFullyDone(ex: SessionExercise): boolean {
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
  return ex.sets.length > 0 && ex.sets.every((s) => isLoggedSet(s, style));
}

function sessionSummary(s: WorkoutSession, t: TFn): string {
  const exCount = s.exercises.length;
  const setCount = s.exercises.reduce(
    (n, ex) => n + ex.sets.filter((set) => isLoggedSet(set, ex.logStyle ?? DEFAULT_LOG_STYLE)).length,
    0,
  );
  const ex = `${exCount} ${exCount === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
  const sets = `${setCount} ${setCount === 1 ? t('train.setOne') : t('train.setMany')}`;
  return `${ex} · ${sets}`;
}

function templateSummary(tpl: WorkoutTemplate, t: TFn): string {
  const exCount = tpl.exercises.length;
  const setCount = tpl.exercises.reduce((n, ex) => n + ex.plannedSets.length, 0);
  const ex = `${exCount} ${exCount === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
  const sets = `${setCount} ${setCount === 1 ? t('train.setOne') : t('train.setMany')}`;
  return `${ex} · ${sets}`;
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
    const i = session.exercises.findIndex((ex) => !exFullyDone(ex));
    return i >= 0 ? i : 0;
  });
  const doneCount = session.exercises.filter(exFullyDone).length;

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

        {rest.remaining > 0 ? (
          <View style={styles.restBar} testID="rest-bar">
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
        }}
      />
    </>
  );
}

/** History rows for one exercise across recent completed sessions, newest
 *  first (recentSessions is already newest-first). */
function exerciseHistory(recent: WorkoutSession[], exerciseId: string): SessionExercise[] {
  const out: SessionExercise[] = [];
  for (const s of recent) {
    const match = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (match) out.push(match);
  }
  return out;
}

function lastHint(sug: ProgressionSuggestion, style: LogStyle, t: TFn): string | null {
  if (style === 'time') return sug.lastDurationSec != null ? `${t('train.last')}: ${sug.lastDurationSec}s` : null;
  if (style === 'bodyweight') return sug.lastReps != null ? `${t('train.last')}: ${sug.lastReps} ${t('train.reps')}` : null;
  if (sug.lastWeight != null && sug.lastReps != null) return `${t('train.last')}: ${sug.lastWeight} × ${sug.lastReps}`;
  return null;
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
    <Animated.View style={styles.exCard} layout={springLayout}>
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
        <>
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
        </>
      )}
    </Animated.View>
  );
}

function logStyleKey(style: LogStyle | undefined): I18nKey {
  return style === 'bodyweight' ? 'logStyle.bodyweight' : style === 'time' ? 'logStyle.time' : 'logStyle.weightReps';
}

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
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
  const [rir, setRir] = useState(set.rir != null ? String(set.rir) : '');
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [kindOpen, setKindOpen] = useState(false);

  const commit = () => train.commitActive();
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
        placeholder="0"
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
        <TextInput
          style={[styles.setInput, styles.setRirCell]}
          placeholder="–"
          placeholderTextColor={colors.faint}
          keyboardType="numeric"
          value={rir}
          onChangeText={(t) => {
            setRir(t);
            train.editSet(exerciseIndex, setIndex, { rir: numOrUndef(t) });
          }}
          onEndEditing={commit}
          testID={`set-rir-${exerciseIndex}-${setIndex}`}
        />
      ) : (
        <View style={styles.setRirCell} />
      )}

      <TouchableOpacity
        style={[styles.setDoneCell, styles.doneBox, set.done && styles.doneBoxOn]}
        onPress={() => {
          haptics.tap();
          const nowDone = !set.done;
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
        <View style={styles.kindChips}>
          {SET_KINDS.map((k) => {
            const on = set.kind === k.value;
            return (
              <TouchableOpacity
                key={k.value}
                style={[styles.kindChip, on && styles.kindChipOn]}
                onPress={() => {
                  haptics.tap();
                  train.setSetKind(exerciseIndex, setIndex, k.value);
                  setKindOpen(false);
                }}
                testID={`set-kind-${exerciseIndex}-${setIndex}-${k.value}`}
              >
                <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>{t(k.labelKey)}</Text>
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{t('train.addExerciseTitle')}</Text>

          <TextInput
            style={styles.input}
            placeholder={t('train.exerciseName')}
            placeholderTextColor={colors.faint}
            value={name}
            onChangeText={setName}
            autoFocus
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
        </View>
      </KeyboardAvoidingView>
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Template editor ────────────────────────────────────────────
interface DraftEx {
  exerciseId: string;
  name: string;
  logStyle: LogStyle;
  targetLoad: string; // string buffer; parsed on save
  setCount: number;
}

function TemplateEditorModal({
  visible,
  train,
  template,
  onClose,
}: {
  visible: boolean;
  train: ReturnType<typeof useTrain>;
  template: WorkoutTemplate | null;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<DraftEx[]>([]);
  const [exName, setExName] = useState('');
  const [exStyle, setExStyle] = useState<LogStyle>('weight-reps');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(template?.name ?? '');
    setNotes(template?.notes ?? '');
    setExercises(
      (template?.exercises ?? []).map((ex) => ({
        exerciseId: ex.exerciseId,
        name: ex.name,
        logStyle: ex.logStyle ?? 'weight-reps',
        targetLoad: ex.targetLoad != null ? String(ex.targetLoad) : '',
        setCount: Math.max(1, ex.plannedSets.length),
      })),
    );
    setExName('');
    setExStyle('weight-reps');
    setBusy(false);
  }, [visible, template]);

  const trimmedEx = exName.trim();
  const matches = trimmedEx
    ? train.catalog.filter((e) => e.name.toLowerCase().includes(trimmedEx.toLowerCase())).slice(0, 5)
    : [];

  function appendEx(exercise: Pick<DraftEx, 'exerciseId' | 'name' | 'logStyle'>) {
    setExercises((prev) => [...prev, { ...exercise, targetLoad: '', setCount: 3 }]);
    setExName('');
  }

  function addFromCatalog(c: Exercise) {
    haptics.tap();
    appendEx({ exerciseId: c.id!, name: c.name, logStyle: c.logStyle ?? 'weight-reps' });
  }

  async function addFreeType() {
    if (!trimmedEx || busy) return;
    haptics.tap();
    setBusy(true);
    try {
      const id = await train.addCatalogExercise(trimmedEx, exStyle);
      appendEx({ exerciseId: id, name: trimmedEx, logStyle: exStyle });
    } finally {
      setBusy(false);
    }
  }

  function patchEx(index: number, patch: Partial<DraftEx>) {
    setExercises((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function removeEx(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
  }

  const canSave = name.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const draft: TemplateDraft = {
        name: name.trim(),
        notes: notes.trim() || undefined,
        exercises: exercises.map((d) => ({
          exerciseId: d.exerciseId,
          name: d.name,
          logStyle: d.logStyle,
          targetLoad: numOrUndef(d.targetLoad),
          plannedSets: Array.from({ length: Math.max(1, d.setCount) }, () => ({ kind: 'working' as const })),
        })),
      };
      await train.saveTemplate(draft, template?.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!template?.id || busy) return;
    setBusy(true);
    try {
      await train.deleteTemplate(template.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{template ? t('train.editTemplate') : t('train.newTemplateTitle')}</Text>

            <Text style={styles.fieldLabel}>{t('train.templateName')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('train.templateNamePh')}
              placeholderTextColor={colors.faint}
              value={name}
              onChangeText={setName}
              testID="template-name"
            />

            <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.templateNotes')}</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder={t('train.templateNotesPh')}
              placeholderTextColor={colors.faint}
              value={notes}
              onChangeText={setNotes}
              multiline
              testID="template-notes"
            />

            <Text style={[styles.fieldLabel, { marginTop: space.md }]}>{t('train.templateExercises')}</Text>
            {exercises.length === 0 ? (
              <Text style={styles.empty}>{t('train.templateNoEx')}</Text>
            ) : (
              exercises.map((d, i) => (
                <View key={`${d.exerciseId}-${i}`} style={styles.tplExRow}>
                  <View style={styles.tplExMain}>
                    <Text style={styles.tplExName}>{d.name}</Text>
                    <Text style={styles.tplExMeta}>{t(logStyleKey(d.logStyle))}</Text>
                  </View>
                  {d.logStyle !== 'bodyweight' ? (
                    <TextInput
                      style={styles.tplLoadInput}
                      placeholder={t('train.target')}
                      placeholderTextColor={colors.faint}
                      keyboardType="numeric"
                      value={d.targetLoad}
                      onChangeText={(v) => patchEx(i, { targetLoad: v })}
                      testID={`template-load-${i}`}
                    />
                  ) : null}
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => patchEx(i, { setCount: Math.max(1, d.setCount - 1) })}
                      testID={`template-set-minus-${i}`}
                    >
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepCount}>{d.setCount}</Text>
                    <TouchableOpacity
                      style={styles.stepBtn}
                      onPress={() => patchEx(i, { setCount: Math.min(20, d.setCount + 1) })}
                      testID={`template-set-plus-${i}`}
                    >
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => removeEx(i)} hitSlop={6} style={styles.setDel}>
                    <Text style={styles.setDelText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}

            <TextInput
              style={[styles.input, { marginTop: space.sm }]}
              placeholder={t('train.addExercisePh')}
              placeholderTextColor={colors.faint}
              value={exName}
              onChangeText={setExName}
              testID="template-add-exercise"
            />
            {trimmedEx ? (
              <>
                <View style={styles.styleRow}>
                  {LOG_STYLES.map((ls) => {
                    const on = exStyle === ls.value;
                    return (
                      <TouchableOpacity
                        key={ls.value}
                        style={[styles.styleChip, on && styles.styleChipOn]}
                        onPress={() => setExStyle(ls.value)}
                      >
                        <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {matches.map((e) => (
                  <TouchableOpacity key={e.id} style={styles.catalogRow} onPress={() => addFromCatalog(e)}>
                    <Text style={styles.catalogName}>{e.name}</Text>
                    <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.createRow} onPress={addFreeType} testID="template-create-exercise">
                  <Text style={styles.createText}>{t('train.addNamed', { name: trimmedEx })}</Text>
                </TouchableOpacity>
              </>
            ) : null}

            <View style={styles.editorBtns}>
              {template ? (
                <TouchableOpacity style={styles.discardBtn} onPress={remove} disabled={busy} testID="delete-template">
                  <Text style={styles.discardText}>{t('common.remove')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.finishBtn, !canSave && styles.btnDisabled]}
                onPress={save}
                disabled={!canSave}
                testID="save-template"
              >
                <Text style={styles.finishText}>{busy ? t('common.saving') : t('common.save')}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = ({ colors, scheme, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  title: { fontFamily: type.display, fontSize: font.h1, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: space.xl },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.xl, gap: space.md },
  error: { color: colors.danger, fontSize: font.small },
  empty: { fontSize: font.small, color: colors.muted },
  sectionTitle: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink, marginTop: space.sm },
  // Hero panel — the Today skeleton (ADR-0014 §7): shared dark canvas, the one
  // big number (workouts this week) with volume + top-set chips beneath.
  heroPanel: {
    backgroundColor: colors.heroPanel,
    borderRadius: radius.xl,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    gap: space.xs,
    ...shadow.e2,
  },
  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
  heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
  heroUnit: { fontSize: font.h3, color: colors.heroMuted, marginBottom: space.sm },
  heroCaption: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small },
  heroHint: { textAlign: 'center', color: colors.heroMuted, fontSize: font.small, marginTop: space.xs },
  heroChips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm },
  trendChip: {
    fontSize: font.small,
    color: colors.heroMuted,
    backgroundColor: colors.heroTrack,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  trendChipValue: { color: colors.heroText, fontFamily: type.heading },
  startBtn: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  startBtnText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  list: { gap: space.sm },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  histMain: { gap: 2 },
  histHint: { fontSize: font.tiny, color: colors.muted, marginBottom: space.xs },
  histDate: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  histSub: { fontSize: font.small, color: colors.muted },
  histVol: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  // active
  activeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  activeText: { fontSize: font.small, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  savingText: { fontSize: font.tiny, color: colors.faint },
  progressText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  exHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  exName: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
  exCount: { backgroundColor: colors.inputBg, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 3, minWidth: 44, alignItems: 'center' },
  exCountText: { fontSize: font.small, fontWeight: '800', color: colors.muted },
  exDone: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  exChevron: { marginLeft: 2 },
  exRemoveRow: { alignSelf: 'flex-start', paddingVertical: space.sm, marginTop: space.xs },
  exCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.xs,
  },
  exRemove: { fontSize: font.tiny, color: colors.danger, fontWeight: '700', textTransform: 'uppercase' },
  setHeadRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setHeadCell: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  setNumCell: { width: 24 },
  setNum: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  setNumCluster: { color: colors.accent, fontWeight: '800' },
  kindPicker: { paddingVertical: space.sm, gap: space.xs },
  kindPickerLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  kindChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    backgroundColor: colors.inputBg,
  },
  kindChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  kindChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  kindChipTextOn: { color: colors.onInk },
  setInputCell: { width: 62, textAlign: 'center' },
  setRirCell: { width: 40, textAlign: 'center' },
  setInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.ink,
  },
  setDoneCell: { width: 32, alignItems: 'center' },
  doneBox: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  doneBoxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  doneCheck: { color: colors.line, fontWeight: '800' },
  doneCheckOn: { color: colors.onInk },
  setDel: { paddingHorizontal: space.xs },
  setDelText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  addSetRow: { flexDirection: 'row', gap: space.xl },
  addSetBtn: { paddingVertical: space.sm },
  addSetText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  addExBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  addExText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  footerBtns: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  discardBtn: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  discardText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  finishBtn: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  finishText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  // modal
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    gap: space.sm,
    maxHeight: '80%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.sm },
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  sheetHint: { fontSize: font.small, color: colors.muted },
  sheetEmpty: { fontSize: font.small, color: colors.muted, paddingVertical: space.lg, textAlign: 'center' },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
  },
  styleRow: { flexDirection: 'row', gap: space.sm },
  styleChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  styleChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  styleChipText: { fontSize: font.tiny, color: colors.muted, fontWeight: '600' },
  styleChipTextOn: { color: colors.onInk },
  createRow: { paddingVertical: space.sm },
  createText: { fontSize: font.body, color: colors.accent, fontWeight: '700' },
  catalogList: { maxHeight: 220 },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  catalogName: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  catalogStyle: { fontSize: font.tiny, color: colors.muted },
  finishRow: { flexDirection: 'row', gap: space.md },
  finishField: { flex: 1, gap: space.xs },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  // templates
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  sectionActions: { flexDirection: 'row', gap: space.lg },
  sectionAction: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  tplRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  tplMain: { flex: 1, gap: 2 },
  tplStart: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  tplStartText: { color: colors.onInk, fontWeight: '700', fontSize: font.small },
  // template editor
  notesInput: { minHeight: 56, textAlignVertical: 'top' },
  tplExRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tplExMain: { flex: 1, gap: 2 },
  tplExName: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  tplExMeta: { fontSize: font.tiny, color: colors.muted },
  tplLoadInput: {
    width: 56,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    textAlign: 'center',
    fontSize: font.small,
    color: colors.ink,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  stepBtnText: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  stepCount: { width: 20, textAlign: 'center', fontSize: font.small, color: colors.ink, fontWeight: '700' },
  editorBtns: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  btnDisabled: { opacity: 0.4 },
  // plates & warm-up panel
  ghost: { fontSize: font.tiny, color: colors.muted, marginTop: 1 },
  bumpChip: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    backgroundColor: colors.ring,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  bumpText: { fontSize: font.tiny, color: colors.white, fontWeight: '800' },
  panelToggle: { paddingVertical: space.xs, alignSelf: 'flex-start' },
  panelToggleText: { fontSize: font.tiny, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  panel: {
    backgroundColor: colors.paper,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    gap: 2,
  },
  panelLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  plateText: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  panelHint: { fontSize: font.small, color: colors.muted },
  warmRow: { fontSize: font.small, color: colors.ink },
  // rest timer bar
  restBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.sm,
  },
  restLabel: { color: colors.onInk, fontWeight: '800', fontSize: font.body },
  restActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  restPlus: { color: colors.onInk, fontWeight: '700', fontSize: font.small, opacity: 0.85 },
  restSkip: { color: colors.ring, fontWeight: '800', fontSize: font.small, textTransform: 'uppercase', letterSpacing: 0.5 },
  // exercise library + detail
  exLibRow: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 2,
  },
  prRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  prCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    gap: 2,
  },
  prValue: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  prLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  chartWrap: { marginTop: space.md, gap: space.xs },
  detailRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  detailDate: { width: 56, fontSize: font.small, color: colors.muted, fontWeight: '700' },
  detailSets: { flex: 1, fontSize: font.small, color: colors.ink },
  manageRow: { flexDirection: 'row', gap: space.xl, marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line },
  manageLink: { fontSize: font.small, color: colors.accent, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  manageDanger: { color: colors.danger },
  confirmRow: { marginTop: space.md, gap: space.sm },
  confirmBtns: { flexDirection: 'row', gap: space.xl },
});
