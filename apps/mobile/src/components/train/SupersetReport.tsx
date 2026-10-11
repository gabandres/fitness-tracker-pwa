import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import {
  exerciseSupersetReport,
  formatLoad,
  sessionSupersetReport,
  type ReportSide,
} from '@macrolog/core';
import { useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { space } from '@/theme';
import type { WorkoutSession } from '@/lib/workout';
import { createStyles } from './train-styles';

/** A number in the reader's locale ("8,5" in pt-BR), one decimal at most. */
function useNumbers() {
  const locale = useLocale();
  const t = useT();
  const fmt = (x: number) => formatNumber(x, locale, { maximumFractionDigits: 1 });
  return {
    /** Shown: the value, or "—" for nothing recorded. */
    show: (x: number | undefined) => (x == null ? '—' : fmt(x)),
    /** Spoken: the value, or "not recorded" — a screen reader says "em dash". */
    say: (x: number | undefined) => (x == null ? t('train.supersetReport.none') : fmt(x)),
    /** A change with a real minus sign (U+2212), "+1,5" / "−2". */
    signed: (x: number | undefined) => (x == null ? '—' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(x))}`),
    pct: (x: number | undefined) => (x == null ? '—' : formatNumber(x, locale, { style: 'percent', maximumFractionDigits: 0 })),
    points: (x: number | undefined) =>
      x == null ? '—' : t('train.supersetReport.points', { n: `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(Math.round(x * 100)))}` }),
  };
}

/**
 * Is the superset costing this lift reps? (core `exerciseSupersetReport`.)
 *
 * The last three unpaired sessions beside every superset session, on the four
 * numbers the 2026-10-11 spec names. One stacked block per metric rather than
 * a four-column grid: the grid broke words mid-word at 360dp in Spanish at the
 * default text size and fell apart at any accessibility size. Each block is
 * ONE screen-reader stop that names both sides. The warning leads, because it
 * is the one thing on the sheet that asks for an action.
 */
export function ExerciseSupersetReport({ sessions, exerciseId }: { sessions: readonly WorkoutSession[]; exerciseId: string }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  const n = useNumbers();
  const r = useMemo(() => exerciseSupersetReport(sessions, exerciseId), [sessions, exerciseId]);
  if (!r) return null;

  const metric = (
    label: string,
    pick: (s: ReportSide) => number | undefined,
    delta: string,
    format: (x: number | undefined) => string,
    say: (x: number | undefined) => string,
  ) => (
    <View
      style={styles.reportMetric}
      accessible
      accessibilityLabel={t('train.supersetReport.rowA11y', {
        metric: label, a: say(pick(r.straight)), b: say(pick(r.superset)), delta,
      })}
    >
      <Text style={styles.reportMetricLabel}>{label}</Text>
      <Text style={styles.reportMetricValue}>
        {t('train.supersetReport.metricLine', { a: format(pick(r.straight)), b: format(pick(r.superset)), delta })}
      </Text>
    </View>
  );

  return (
    <View testID="exercise-superset-report" style={{ gap: space.sm }}>
      <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.supersetReport.title')}</Text>
      {r.flag ? (
        <View style={styles.reportFlag} testID="superset-report-flag" accessible>
          <Ionicons name="alert-circle-outline" size={18} color={colors.accent} />
          <Text style={[styles.reportFlagText, { flex: 1 }]}>
            {plural(t, locale, 'train.supersetReport.flag', r.costlySessions.length)}
          </Text>
        </View>
      ) : null}
      {r.straight.sessions === 0 ? (
        <Text style={styles.sheetHint} testID="superset-report-no-base">{t('train.supersetReport.noBase')}</Text>
      ) : (
        <>
          <Text style={styles.sheetHint}>{t('train.supersetReport.sides', { a: r.straight.sessions, b: r.superset.sessions })}</Text>
          {r.sameLoad ? (
            <Text style={styles.reportMetricValue} testID="superset-report-same-load">
              {t('train.supersetReport.sameLoad', {
                load: formatLoad(r.sameLoad.load, unitSystem),
                a: n.show(r.sameLoad.straight),
                b: n.show(r.sameLoad.superset),
                delta: n.signed(r.sameLoad.delta),
              })}
            </Text>
          ) : null}
          {metric(t('train.supersetReport.activation'), (s) => s.activationRepsAvg, n.signed(r.delta.activationReps), n.show, n.say)}
          {metric(t('train.supersetReport.firstMini'), (s) => s.firstMiniRepsAvg, n.signed(r.delta.firstMiniReps), n.show, n.say)}
          {metric(t('train.supersetReport.validity'), (s) => s.validityRate, n.points(r.delta.validityRate), n.pct, n.pct)}
          {metric(t('train.supersetReport.duration'), (s) => s.durationMinAvg, n.signed(r.delta.durationMin), n.show, n.say)}
          <Text style={styles.reportNote}>{t('train.supersetReport.mixNote')}</Text>
          <Text style={styles.reportNote}>{t('train.supersetReport.legend')}</Text>
        </>
      )}
    </View>
  );
}

/**
 * One superset session against the last three unpaired sessions of its
 * template (core `sessionSupersetReport`): its duration — said plainly when
 * there is nothing timed to compare with, never "— min" — and, per paired
 * lift, activation and first mini-set at the load used, against unpaired
 * sessions at that same load, with the lift's warning when it is up.
 */
export function SessionSupersetReport({ sessions, session }: { sessions: readonly WorkoutSession[]; session: WorkoutSession }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  const n = useNumbers();
  const r = useMemo(() => sessionSupersetReport(sessions, session), [sessions, session]);
  if (!r) return null;
  const min = r.durationMin;
  return (
    <View testID="session-superset-report" style={{ gap: space.sm }}>
      <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.supersetReport.title')}</Text>
      {min != null ? (
        <Text style={styles.reportMetricValue} testID="session-superset-time">
          {r.straightTimedSessions > 0 && r.straightDurationMinAvg != null
            ? plural(t, locale, 'train.supersetReport.sessionTime', r.straightTimedSessions, {
                min: n.show(min), base: n.show(r.straightDurationMinAvg),
              })
            : t('train.supersetReport.sessionTimeNoBase', { min: n.show(min) })}
        </Text>
      ) : null}
      {r.exercises.map((e) => {
        const status = e.valid === false
          ? t('train.supersetReport.liftInvalid')
          : e.deltaAtLoad == null
            ? t('train.supersetReport.liftNoBase')
            : t('train.supersetReport.liftDelta', { delta: n.signed(e.deltaAtLoad) });
        return (
          <View key={e.exerciseId} style={styles.reportMetric} accessible>
            <Text style={styles.reportMetricValue}>
              {`${t('train.supersetReport.liftLine', {
                label: e.label ?? '',
                name: e.name,
                load: e.load != null ? formatLoad(e.load, unitSystem) : '—',
                reps: n.show(e.activationRepsAvg),
                mini: n.show(e.firstMiniRepsAvg),
              })} · ${status}`}
            </Text>
            {e.flag ? (
              <View style={styles.reportFlag}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.accent} />
                <Text style={[styles.reportFlagText, { flex: 1 }]}>{t('train.supersetReport.flagShort', { name: e.name })}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
