import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { PER_SESSION_PLATEAU, plannedVolume, weeklyVolume, type VolumeMuscle } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { space } from '@/theme';
import type { Exercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import { createStyles } from './train-styles';

/**
 * Weekly fractional volume per muscle (Program v2, 2026-10-11; core
 * `volume-credits.ts`): every logged cluster of the last 7 days credits its
 * primary muscle 1.0 and each secondary 0.5. Lowest first, beside what the
 * templates plan for a week; then each session's totals, with any muscle over
 * {@link PER_SESSION_PLATEAU} flagged. Always "clusters (myo-rep)", never
 * "sets": there is no validated conversion between the two.
 */
export function WeeklyVolumeSheet({
  visible,
  onClose,
  sessions,
  catalog,
  templates,
  now,
}: {
  visible: boolean;
  onClose: () => void;
  sessions: readonly WorkoutSession[];
  catalog: readonly Exercise[];
  templates: readonly WorkoutTemplate[];
  now: number;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const report = useMemo(() => weeklyVolume(sessions, catalog, now), [sessions, catalog, now]);
  const planned = useMemo(
    () => new Map(plannedVolume(templates, catalog).map((m) => [m.muscle, m])),
    [templates, catalog],
  );
  const n = (x: number) => formatNumber(x, locale, { maximumFractionDigits: 1 });
  const muscle = (m: VolumeMuscle) => t(`train.volume.muscle.${m}` as I18nKey);
  const nameOf = (id?: string) => sessions.find((s) => s.id === id)?.templateName ?? t('train.volume.session');

  return (
    <BottomSheet native detents={[0.75, 1]} visible={visible} onClose={onClose} contentStyle={styles.sheetBody} backdropTestID="weekly-volume-backdrop">
      <ScrollView showsVerticalScrollIndicator testID="weekly-volume">
        <View style={{ gap: space.sm, paddingBottom: space.xl }}>
          <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.volume.title')}</Text>
          <Text style={styles.sheetHint}>{t('train.volume.hint')}</Text>
          <Text style={styles.panelLabel}>{t('train.volume.columns')}</Text>
          {report.week.map((m) => {
            const plan = planned.get(m.muscle);
            return (
              <View
                key={m.muscle}
                style={styles.reportMetric}
                accessible
                accessibilityLabel={t('train.volume.rowA11y', {
                  muscle: muscle(m.muscle), direct: n(m.direct), fractional: n(m.fractional), planned: n(plan?.fractional ?? 0),
                })}
                testID={`weekly-volume-${m.muscle}`}
              >
                <Text style={styles.reportMetricLabel}>{muscle(m.muscle)}</Text>
                <Text style={styles.reportMetricValue}>
                  {t('train.volume.row', { direct: n(m.direct), fractional: n(m.fractional), planned: n(plan?.fractional ?? 0) })}
                </Text>
              </View>
            );
          })}
          {report.unattributed.length ? (
            <Text style={styles.reportNote}>{t('train.volume.unattributed', { names: report.unattributed.join(', ') })}</Text>
          ) : null}

          <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.volume.perSession')}</Text>
          {report.perSession.length === 0 ? <Text style={styles.sheetHint}>{t('train.volume.none')}</Text> : null}
          {report.perSession.map((s) => (
            <View key={`${s.sessionId ?? ''}${s.date.getTime()}`} style={styles.reportMetric} testID={`weekly-volume-session-${s.sessionId ?? s.date.getTime()}`}>
              <Text style={styles.reportMetricLabel}>
                {`${nameOf(s.sessionId)} · ${formatDate(s.date, locale, { weekday: 'short', month: 'short', day: 'numeric' })}`}
              </Text>
              <Text style={styles.reportMetricValue}>
                {[...s.muscles].reverse().filter((m) => m.fractional > 0).map((m) => `${muscle(m.muscle)} ${n(m.fractional)}`).join(' · ')}
              </Text>
              {s.overPlateau.map((m) => (
                <View key={m} style={styles.reportFlag} testID={`weekly-volume-plateau-${m}`}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.accent} />
                  <Text style={[styles.reportFlagText, { flex: 1 }]}>
                    {t('train.volume.plateau', { muscle: muscle(m), n: n(s.muscles.find((x) => x.muscle === m)?.fractional ?? 0), max: PER_SESSION_PLATEAU })}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </BottomSheet>
  );
}
