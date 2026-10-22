import { memo, useEffect, useState } from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  computeExercisePRs,
  exerciseSeriesPoints,
  formatLoad,
  loadChangesFor,
  loadUnit,
  toDisplayLoad,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { AccessibleChart } from '@/components/charts/AccessibleChart';
import { audioGraphDescriptor } from '@/components/charts/audio-graph';
import { confirm } from '@/components/ConfirmSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { Sparkline } from '@/components/Sparkline';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { useLocale, useT } from '@/i18n';
import { isOffline } from '@/lib/connectivity';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import {
  DEFAULT_LOG_STYLE,
  type Exercise,
  type LogStyle,
  type MuscleGroup,
  type SessionExercise,
} from '@/lib/workout';
import { space } from '@/theme';
import { LOG_STYLES, logStyleKey } from './train-shared';
import { setLine } from './train-summary';
import { ExerciseSupersetReport } from './SupersetReport';
import { MuscleChips, MuscleCreditLine } from './MuscleChips';
import { liftPlansClusters } from './LiftSettingsSheet';
import { createStyles } from './train-styles';

/**
 * One catalog exercise: its records, its trend, its history — and editing,
 * merging and deleting it.
 *
 * The three catalog writes used to have no `catch` (Train review bug 7): a
 * refused write was an unhandled rejection in Sentry and a sheet that just
 * sat there. Each now says so in a toast, with a warning haptic. Merge — which
 * rewrites every workout and template that names the exercise, on one tap —
 * now asks first, and refuses offline: it has to read every session to know
 * what to rewrite, and an offline read sees only the few in memory, so it
 * would rewrite some and orphan the rest.
 */
// `memo`: mounted for a whole live session beside cards that re-render on
// every set edit; `ActiveSession` hands it only stable fields, so a closed
// sheet skips those renders.
export const ExerciseDetailSheet = memo(function ExerciseDetailSheet({
  visible,
  exercise,
  train,
  readOnly = false,
  onClose,
}: {
  visible: boolean;
  exercise: Exercise | null;
  /** Records, trend and history only — no Edit / Merge / Delete. How the
   *  live session opens it from a lift's ⋯: managing the catalog is not a
   *  mid-set job, and a delete there would orphan the card being logged. */
  readOnly?: boolean;
  train: Pick<
    TrainState,
    'recentSessions' | 'catalog' | 'editCatalogExercise' | 'deleteCatalogExercise' | 'mergeCatalogExercises'
  > & {
    /** Read for the load log. Optional so a caller that never loaded
     *  templates still renders the rest of the history. */
    templates?: TrainState['templates'];
  };
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const unitSystem = useUnitSystem();
  const { colors, scheme } = useTheme();
  const stackChips = useWindowDimensions().fontScale >= 1.3;
  const [mode, setMode] = useState<'view' | 'edit' | 'merge'>('view');
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
  // Dated, so the chart's audio graph can name each session; the values alone
  // are `exerciseSeries`.
  const points = exerciseSeriesPoints(rows, style);
  const series = points.map((p) => p.value);
  /** One point of `series` in the user's words, for the chart's text
   *  alternative — a load in their unit, a hold in seconds, or a rep count. */
  const fmtPoint = (v: number) =>
    style === 'weight-reps' ? formatLoad(v, unitSystem, 0) : style === 'time' ? `${Math.round(v)}s` : String(Math.round(v));
  const metric = style === 'time' ? t('train.trendHold') : style === 'bodyweight' ? t('train.trendReps') : t('train.trendE1rm');
  /**
   * The chart's spoken summary and its audio graph (Train re-score bug 5).
   *
   * It borrowed Body's weight sentence, so an e1RM trend read "Weight, last 6
   * days, 100 to 110 , trending up" — sessions called days, an empty unit
   * slot, and a lift called body weight. Its own sentence names the metric and
   * counts sessions; the unit rides in the formatted points. The descriptor
   * gives VoiceOver's rotor "Audio Graph" over the same points, in the user's
   * unit, one stop per session named by its date.
   */
  const chart = series.length >= 2
    ? (() => {
        const first = series[0] as number;
        const last = series[series.length - 1] as number;
        const summary = t('a11y.chart.lift', {
          metric,
          sessions: series.length,
          from: fmtPoint(first),
          to: fmtPoint(last),
          trend: t(last < first ? 'a11y.trend.down' : last > first ? 'a11y.trend.up' : 'a11y.trend.flat'),
        });
        const labels = points.map((p) => formatDate(p.date, locale, { month: 'short', day: 'numeric' }));
        const descriptor = audioGraphDescriptor({
          title: metric,
          summary,
          xTitle: t('train.chartSessionAxis'),
          xLabels: labels,
          yTitle: metric,
          unit: style === 'weight-reps' ? loadUnit(unitSystem) : style === 'time' ? 's' : undefined,
          decimals: 0,
          series: [
            {
              name: metric,
              values: series.map((v) => (style === 'weight-reps' ? Math.round(toDisplayLoad(v, unitSystem)) : v)),
            },
          ],
          pointLabels: points.map((p, i) => `${labels[i]}: ${fmtPoint(p.value)}`),
        });
        return { summary, descriptor };
      })()
    : null;
  const prs = computeExercisePRs(history);
  /**
   * Every move of this lift's template load, newest first: when it moved,
   * from what to what, whether the engine or the lifter moved it, why, and in
   * which template. Read from the `loadLog` each template row carries
   * (`progression-apply.ts`) — the sessions above say what was LIFTED, this
   * says what was PLANNED and who changed the plan.
   */
  const loadChanges = exercise?.id ? loadChangesFor(train.templates ?? [], exercise.id).reverse() : [];
  const others = exercise ? train.catalog.filter((e) => e.id !== exercise.id) : [];

  /** Run one catalog write; a refusal is said, not swallowed. */
  async function run(write: () => Promise<void>, where: string) {
    if (busy) return;
    setBusy(true);
    try {
      await write();
      onClose();
    } catch (e) {
      haptics.warning();
      showToast(t('train.exerciseSaveErr'));
      captureError(e, { where });
    }
    // After the try/catch, not in a `finally`: React Compiler cannot lower a
    // `finally` and skips the whole component. Nothing above can throw past
    // the catch, so this still runs on both paths.
    setBusy(false);
  }

  function saveEdit() {
    if (!exercise?.id || !editName.trim()) return;
    const id = exercise.id;
    void run(
      () => train.editCatalogExercise(id, { name: editName.trim(), logStyle: editStyle, muscles: editMuscles }),
      'train.editCatalogExercise',
    );
  }

  function doDelete() {
    if (!exercise?.id) return;
    const id = exercise.id;
    void run(() => train.deleteCatalogExercise(id), 'train.deleteCatalogExercise');
  }

  /** The same confirm sheet Merge uses, naming the lift and what goes with it
   *  — it was an inline "Delete this exercise?" link pair (train-ux X11). */
  function askDelete() {
    if (!exercise?.id) return;
    confirm({
      title: t('train.deleteExerciseTitle', { name: exercise.name }),
      body: t('train.deleteExerciseBody'),
      confirmText: t('train.delete'),
      destructive: true,
      // Asked over this native sheet: the system dialog, not a sheet on a
      // sheet (R30/R31, train-ux F2).
      native: true,
      onConfirm: doDelete,
    });
  }

  // Edits typed in edit mode and not saved — what a swipe-down would lose.
  const dirty =
    visible &&
    mode === 'edit' &&
    exercise != null &&
    (editName !== exercise.name ||
      editStyle !== (exercise.logStyle ?? 'weight-reps') ||
      editMuscles.join(',') !== (exercise.muscles ?? []).join(','));

  /** Close, asking first over unsaved edits (train-ux X5). `false` = stay. */
  function requestClose(): boolean {
    if (!dirty) {
      onClose();
      return true;
    }
    confirm({
      title: t('train.lift.discardTitle', { name: exercise?.name ?? '' }),
      confirmText: t('train.discard'),
      destructive: true,
      // iOS only, like the template editor's discard: the Android re-present
      // after a drag-dismiss has only been verified with the branded confirm.
      native: Platform.OS === 'ios',
      onConfirm: onClose,
    });
    return false;
  }

  function askMerge(target: Exercise) {
    if (!exercise?.id || !target.id) return;
    if (isOffline()) {
      haptics.warning();
      showToast(t('train.mergeOffline'));
      return;
    }
    const fromId = exercise.id;
    const toId = target.id;
    confirm({
      title: t('train.mergeConfirmTitle', { name: target.name }),
      body: t('train.mergeConfirmBody', { from: exercise.name, name: target.name }),
      confirmText: t('train.merge'),
      destructive: true,
      native: true,
      onConfirm: () => void run(() => train.mergeCatalogExercises(fromId, toId), 'train.mergeCatalogExercises'),
    });
  }

  return (
    <BottomSheet
      native
      detents={[0.6, 1]}
      visible={visible}
      onClose={onClose}
      guarded={dirty}
      onRequestClose={() => requestClose()}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      <View style={styles.sheetStack}>
      {/* Pinned, with a visible way out in every mode (train-ux H7/X5): Done
          while viewing; Cancel + Save while editing; Cancel while merging. */}
      <SheetHeader
        title={exercise?.name ?? ''}
        leading={mode === 'view' ? undefined : { label: t('common.cancel'), onPress: () => setMode('view'), testID: 'exercise-cancel-header' }}
        trailing={
          mode === 'view'
            ? { label: t('common.done'), onPress: onClose, testID: 'exercise-done' }
            : mode === 'edit'
              ? { label: busy ? t('common.saving') : t('common.save'), onPress: saveEdit, disabled: !editName.trim() || busy, testID: 'save-exercise' }
              : undefined
        }
      />
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {mode === 'edit' ? (
          <>
            <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.exerciseName')}</Text>
            <SheetTextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholderTextColor={colors.faint}
              accessibilityLabel={t('train.exerciseName')}
              testID="edit-exercise-name"
            />
            {/* Stacked at large text: three chips in one row broke
                "Bodyweight" mid-word (train-ux v5 QA). */}
            <View style={[styles.styleRow, stackChips && { flexDirection: 'column' }]} accessibilityRole="radiogroup">
              {LOG_STYLES.map((ls) => {
                const on = editStyle === ls.value;
                return (
                  <TouchableOpacity
                    key={ls.value}
                    style={[styles.styleChip, on && styles.styleChipOn]}
                    onPress={() => setEditStyle(ls.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, checked: on }}
                  >
                    <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>{t(ls.labelKey)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.fieldLabel, { marginTop: space.md }]}>{t('train.musclesLabel')}</Text>
            <Text style={styles.sheetHint}>{t('train.musclesPrimaryHint')}</Text>
            <MuscleChips value={editMuscles} onChange={setEditMuscles} />
            {/* Only where the weekly cluster count can read it (train-ux
                re-score J-N1) — the same rule Lift settings uses. Cancel and
                Save live in the header alone (J-N9): two of each read as two
                different actions. */}
            {liftPlansClusters(exercise, null) ? (
              <MuscleCreditLine name={editName.trim() || (exercise?.name ?? '')} muscles={editMuscles} testID="exercise-muscle-credit" />
            ) : null}
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
                  onPress={() => askMerge(e)}
                  disabled={busy}
                  accessibilityRole="button"
                  testID={`merge-into-${e.id}`}
                >
                  <Text style={styles.catalogName}>{e.name}</Text>
                  <Text style={styles.catalogStyle}>{t(logStyleKey(e.logStyle))}</Text>
                </TouchableOpacity>
              ))
            )}
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

                {chart ? (
                  <View style={styles.chartWrap}>
                    <Text style={styles.panelLabel}>{metric}</Text>
                    <AccessibleChart
                      descriptor={chart.descriptor}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={chart.summary}
                      testID="exercise-chart"
                    >
                      {/* `ring` is a fill colour: as a 2pt stroke on the light
                          sheet it measured 2.54:1, under WCAG 1.4.11's 3:1 for a
                          graphic that carries meaning. Light uses teal (4.9:1 on
                          card) — it was `accent`, the brand red the PR trophy
                          and the warnings also wore (train-ux J8); dark keeps
                          `ring` (6.0:1). */}
                      <Sparkline values={series} color={scheme === 'light' ? colors.teal : colors.ring} />
                    </AccessibleChart>
                    {/* The numbers the line is drawn from, for sighted readers
                        too (train-ux X14); the chart's label already says them
                        to a screen reader. */}
                    <Text
                      style={styles.liftHint}
                      importantForAccessibility="no"
                      accessibilityElementsHidden
                      testID="exercise-trend-range"
                    >
                      {t('train.trendRange', {
                        from: fmtPoint(series[0] as number),
                        to: fmtPoint(series[series.length - 1] as number),
                        n: series.length,
                      })}
                    </Text>
                  </View>
                ) : null}

                {/* Above History, not below it: the history list runs to every
                    session in the window, and a report under it went unseen. */}
                {exercise?.id ? <ExerciseSupersetReport sessions={train.recentSessions} exerciseId={exercise.id} name={exercise.name} /> : null}

                <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.history')}</Text>
                {rows.map((r, i) => {
                  const date = formatDate(r.date, locale, { month: 'short', day: 'numeric' });
                  const sets = setLine(r.ex, style, unitSystem);
                  // One screen-reader stop per session, date then sets
                  // (train-ux X15).
                  return (
                    <View key={i} style={styles.detailRow} accessible accessibilityLabel={`${date}: ${sets}`}>
                      <Text style={styles.detailDate}>{date}</Text>
                      <Text style={styles.detailSets}>{sets}</Text>
                    </View>
                  );
                })}
              </>
            )}

            {loadChanges.length > 0 ? (
              <View testID="exercise-load-log">
                <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">
                  {t('train.loadLog.title')}
                </Text>
                {loadChanges.map((c, i) => (
                  <View key={`${c.at}-${i}`} style={styles.loadLogRow} testID={`exercise-load-change-${i}`}>
                    <View style={styles.loadLogHead}>
                      <Text style={styles.detailDate}>
                        {formatDate(new Date(c.at), locale, { month: 'short', day: 'numeric' })}
                      </Text>
                      <Text style={styles.loadLogMove}>
                        {c.from != null
                          ? t('train.loadLog.move', { from: formatLoad(c.from, unitSystem), to: formatLoad(c.to, unitSystem) })
                          : t('train.loadLog.set', { to: formatLoad(c.to, unitSystem) })}
                      </Text>
                    </View>
                    <Text style={styles.loadLogMeta}>
                      {t('train.loadLog.meta', {
                        by: t(c.by === 'engine' ? 'train.loadLog.byEngine' : 'train.loadLog.byUser'),
                        template: c.template,
                      })}
                    </Text>
                    {/* Stored as shown at the time, in the language of the
                        time — a record, not a key to re-render. */}
                    {c.reason ? <Text style={styles.loadLogMeta}>{c.reason}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {readOnly ? null : (
              // Wraps at large text: in one row "Delete" ran off the sheet as
              // "Del" and could not be tapped (QA R2 iOS, AX5).
              <View style={[styles.manageRow, stackChips && { flexWrap: 'wrap' }]}>
                <TouchableOpacity style={styles.manageBtn} onPress={() => setMode('edit')} accessibilityRole="button" testID="exercise-edit">
                  <Text style={styles.manageLink}>{t('train.edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.manageBtn} onPress={() => setMode('merge')} accessibilityRole="button" testID="exercise-merge">
                  <Text style={styles.manageLink}>{t('train.merge')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.manageBtn} onPress={askDelete} disabled={busy} accessibilityRole="button" testID="exercise-delete">
                  <Text style={[styles.manageLink, styles.manageDanger]}>{t('train.delete')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      </View>
    </BottomSheet>
  );
});

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
