import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  MUSCLE_GROUPS,
  computeExercisePRs,
  exerciseSeriesPoints,
  formatLoad,
  loadUnit,
  toDisplayLoad,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { AccessibleChart } from '@/components/charts/AccessibleChart';
import { audioGraphDescriptor } from '@/components/charts/audio-graph';
import { confirm } from '@/components/ConfirmSheet';
import { Sparkline } from '@/components/Sparkline';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { type I18nKey, useLocale, useT } from '@/i18n';
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
export function ExerciseDetailSheet({
  visible,
  exercise,
  train,
  onClose,
}: {
  visible: boolean;
  exercise: Exercise | null;
  train: Pick<
    TrainState,
    'recentSessions' | 'catalog' | 'editCatalogExercise' | 'deleteCatalogExercise' | 'mergeCatalogExercises'
  >;
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
    } finally {
      setBusy(false);
    }
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
      onConfirm: () => void run(() => train.mergeCatalogExercises(fromId, toId), 'train.mergeCatalogExercises'),
    });
  }

  return (
    <BottomSheet native detents={[0.6, 1]} visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{exercise?.name}</Text>

        {mode === 'edit' ? (
          <>
            <Text style={[styles.fieldLabel, { marginTop: space.sm }]}>{t('train.exerciseName')}</Text>
            <SheetTextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholderTextColor={colors.faint}
              testID="edit-exercise-name"
            />
            <View style={styles.styleRow} accessibilityRole="radiogroup">
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
            <Text style={styles.sheetHint}>{t('train.musclesHint')}</Text>
            <View style={styles.kindChips}>
              {MUSCLE_GROUPS.map((m) => {
                const on = editMuscles.includes(m);
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.kindChip, on && styles.kindChipOn]}
                    hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
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
              <TouchableOpacity style={styles.discardBtn} onPress={() => setMode('view')} accessibilityRole="button">
                <Text style={styles.discardText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.finishBtn, (!editName.trim() || busy) && styles.btnDisabled]}
                onPress={saveEdit}
                disabled={!editName.trim() || busy}
                accessibilityRole="button"
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
            <TouchableOpacity style={[styles.discardBtn, { marginTop: space.md }]} onPress={() => setMode('view')} accessibilityRole="button">
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
                      <Sparkline values={series} color={colors.ring} />
                    </AccessibleChart>
                  </View>
                ) : null}

                <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.history')}</Text>
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
              <TouchableOpacity style={styles.manageBtn} onPress={() => setMode('edit')} accessibilityRole="button" testID="exercise-edit">
                <Text style={styles.manageLink}>{t('train.edit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manageBtn} onPress={() => setMode('merge')} accessibilityRole="button" testID="exercise-merge">
                <Text style={styles.manageLink}>{t('train.merge')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manageBtn} onPress={() => setConfirmDel(true)} accessibilityRole="button" testID="exercise-delete">
                <Text style={[styles.manageLink, styles.manageDanger]}>{t('train.delete')}</Text>
              </TouchableOpacity>
            </View>
            {confirmDel ? (
              <View style={styles.confirmRow}>
                <Text style={styles.panelHint}>{t('train.deleteExercise')}</Text>
                <View style={styles.confirmBtns}>
                  <TouchableOpacity style={styles.manageBtn} onPress={() => setConfirmDel(false)} accessibilityRole="button">
                    <Text style={styles.manageLink}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.manageBtn}
                    onPress={doDelete}
                    disabled={busy}
                    accessibilityRole="button"
                    testID="exercise-delete-confirm"
                  >
                    <Text style={[styles.manageLink, styles.manageDanger]}>{t('train.delete')}</Text>
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
