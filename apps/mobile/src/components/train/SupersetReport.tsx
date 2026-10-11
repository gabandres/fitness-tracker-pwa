import { useMemo } from 'react';
import { Text, View } from 'react-native';
import {
  exerciseSupersetReport,
  sessionSupersetReport,
  STRAIGHT_BASELINE_SESSIONS,
  type ReportSide,
} from '@macrolog/core';
import { useT } from '@/i18n';
import { useThemedStyles } from '@/lib/theme-context';
import { space } from '@/theme';
import type { WorkoutSession } from '@/lib/workout';
import { createStyles } from './train-styles';

/** "11", "8.5", or a dash for nothing measured — never a 0 for "unknown". */
const num = (x: number | undefined) => (x == null ? '—' : String(Math.round(x * 10) / 10));
const pct = (x: number | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const signed = (x: number | undefined) => (x == null ? '—' : `${x > 0 ? '+' : ''}${Math.round(x * 10) / 10}`);

/**
 * Is the superset costing this lift reps? (core `exerciseSupersetReport`.)
 * The last three straight-set sessions beside every superset session, on the
 * four numbers the 2026-10-11 spec names, and the flag when the activation
 * fell 2+ reps at the same load in 2+ superset sessions. Nothing renders for a
 * lift that has never been supersetted.
 */
export function ExerciseSupersetReport({ sessions, exerciseId }: { sessions: readonly WorkoutSession[]; exerciseId: string }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const r = useMemo(() => exerciseSupersetReport(sessions, exerciseId), [sessions, exerciseId]);
  if (!r) return null;
  const row = (label: string, pick: (s: ReportSide) => string, delta: string) => (
    <View style={styles.detailRow} accessible>
      <Text style={[styles.detailSets, { flex: 2 }]}>{label}</Text>
      <Text style={[styles.detailSets, { flex: 1 }]}>{pick(r.straight)}</Text>
      <Text style={[styles.detailSets, { flex: 1 }]}>{pick(r.superset)}</Text>
      <Text style={[styles.detailSets, { flex: 1 }]}>{delta}</Text>
    </View>
  );
  return (
    <View testID="exercise-superset-report">
      <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.supersetReport.title')}</Text>
      <View style={styles.detailRow}>
        <Text style={[styles.sheetHint, { flex: 2 }]} />
        <Text style={[styles.sheetHint, { flex: 1 }]}>{t('train.supersetReport.straight', { n: r.straight.sessions })}</Text>
        <Text style={[styles.sheetHint, { flex: 1 }]}>{t('train.supersetReport.superset', { n: r.superset.sessions })}</Text>
        <Text style={[styles.sheetHint, { flex: 1 }]}>Δ</Text>
      </View>
      {row(t('train.supersetReport.activation'), (s) => num(s.activationRepsAvg), signed(r.delta.activationReps))}
      {row(t('train.supersetReport.firstMini'), (s) => num(s.firstMiniRepsAvg), signed(r.delta.firstMiniReps))}
      {row(t('train.supersetReport.validity'), (s) => pct(s.validityRate), r.delta.validityRate == null ? '—' : `${signed(r.delta.validityRate * 100)}%`)}
      {row(t('train.supersetReport.duration'), (s) => num(s.durationMinAvg), signed(r.delta.durationMin))}
      {r.flag ? (
        <Text style={styles.supersetWarn} accessibilityRole="alert" testID="superset-report-flag">{t('train.supersetReport.flag')}</Text>
      ) : null}
    </View>
  );
}

/**
 * One superset session against the last three straight sessions of its
 * template (core `sessionSupersetReport`): its duration, and each supersetted
 * lift's activation reps beside its straight sessions at the same load.
 */
export function SessionSupersetReport({ sessions, session }: { sessions: readonly WorkoutSession[]; session: WorkoutSession }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const r = useMemo(() => sessionSupersetReport(sessions, session), [sessions, session]);
  if (!r) return null;
  return (
    <View testID="session-superset-report">
      <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.supersetReport.title')}</Text>
      {r.durationMin != null ? (
        <Text style={styles.detailSets}>
          {t('train.supersetReport.sessionTime', {
            min: num(r.durationMin),
            base: num(r.straightDurationMinAvg),
            n: Math.min(r.straightSessions, STRAIGHT_BASELINE_SESSIONS),
          })}
        </Text>
      ) : null}
      {r.exercises.map((e) => (
        <Text key={e.exerciseId} style={styles.detailSets}>
          {`${t('train.supersetReport.liftLine', { label: e.label ?? '', name: e.name, reps: num(e.activationRepsAvg) })} · ${
            e.deltaAtLoad == null ? t('train.supersetReport.noBase') : t('train.supersetReport.liftDelta', { delta: signed(e.deltaAtLoad) })
          }`}
        </Text>
      ))}
    </View>
  );
}
