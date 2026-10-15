import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import {
  defaultVolumeView,
  PER_SESSION_PLATEAU,
  latestRotation,
  plannedHardSets,
  plannedVolume,
  rotationHardSets,
  rotationVolume,
  type VolumeMuscle,
  type VolumeView,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { SegmentedControl } from '@/components/charts/SegmentedControl';
import { SheetHeader } from '@/components/SheetHeader';
import { usePersistedTab } from '@/hooks/usePersistedTab';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { space } from '@/theme';
import type { Exercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import { createStyles } from './train-styles';
import { VOLUME_MUSCLE_KEY } from './volume-muscle-name';

/** Device-local, like Trends' faces (`usePersistedTab`, ADR-0034 d4): no
 *  profile field, no rules deploy. `auto` until the user picks a face. */
export const VOLUME_VIEW_KEY = 'train.volume.view';
const VIEW_VALID: readonly string[] = ['auto', 'sets', 'clusters'];

/** Copy that differs between the two faces; everything else is shared. */
const COPY: Record<VolumeView, { hint: I18nKey; empty: I18nKey; untrained: I18nKey; plateau: I18nKey }> = {
  clusters: { hint: 'train.volume.hint', empty: 'train.volume.empty', untrained: 'train.volume.untrained', plateau: 'train.volume.plateau' },
  sets: { hint: 'train.volume.sets.hint', empty: 'train.volume.sets.empty', untrained: 'train.volume.sets.untrained', plateau: 'train.volume.sets.plateau' },
};

/**
 * This week by muscle, in one of two units — never both in one figure
 * (S23-13, ADR-0046; core `volume-credits.ts`):
 *
 * - **Sets**: hard working sets (`weeklyHardSets`) — performed straight
 *   working sets; warm-ups and myo-rep clusters left out.
 * - **Clusters**: myo-rep clusters (`weeklyVolume`, Program v2 2026-10-11).
 *
 * Both credit the primary muscle 1.0 and each secondary 0.5 over the same
 * window — ONE ROTATION, the latest completed session of each planned
 * template (`latestRotation`, owner 2026-10-15; it was a rolling 7 days, which
 * a rotation shorter than a week overfilled) — so a muscle reads comparably on
 * either face and against the plan, which counts each template once. Lowest first, beside
 * what the templates plan for a week; then each session's totals, with any
 * muscle over {@link PER_SESSION_PLATEAU} flagged. The cluster face never
 * says "sets": there is no validated conversion between a cluster and a set,
 * and each face says the other's count exists rather than converting it.
 *
 * A **Sets | Clusters** switch picks the face. Until the user flips it the
 * sheet opens on Clusters for anyone who performed a cluster this week and on
 * Sets otherwise (`defaultVolumeView`); a flip is remembered on the device.
 *
 * Only muscles with something logged or planned get a row; the rest are one
 * line, and a face with nothing says so in one sentence (train-ux X2).
 */
export function WeeklyVolumeSheet({
  visible,
  onClose,
  sessions,
  catalog,
  templates,
}: {
  visible: boolean;
  onClose: () => void;
  sessions: readonly WorkoutSession[];
  catalog: readonly Exercise[];
  templates: readonly WorkoutTemplate[];
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const templateIds = useMemo(() => templates.flatMap((tp) => (tp.id ? [tp.id] : [])), [templates]);
  const rotation = useMemo(() => latestRotation(sessions, templateIds), [sessions, templateIds]);
  const clusters = useMemo(() => rotationVolume(sessions, catalog, templateIds), [sessions, catalog, templateIds]);
  const sets = useMemo(() => rotationHardSets(sessions, catalog, templateIds), [sessions, catalog, templateIds]);
  const plannedClusters = useMemo(
    () => new Map(plannedVolume(templates, catalog).map((m) => [m.muscle, m])),
    [templates, catalog],
  );
  const plannedSets = useMemo(
    () => new Map(plannedHardSets(templates, catalog).map((m) => [m.muscle, m])),
    [templates, catalog],
  );
  const [stored, setStored] = usePersistedTab(VOLUME_VIEW_KEY, VIEW_VALID, 'auto');
  const auto = defaultVolumeView({
    clusters: clusters.total,
    sets: sets.total,
    plannedClusters: [...plannedClusters.values()].some((m) => m.fractional > 0) ? 1 : 0,
    plannedSets: [...plannedSets.values()].some((m) => m.fractional > 0) ? 1 : 0,
  });
  const view: VolumeView = stored === 'sets' || stored === 'clusters' ? stored : auto;
  const report = view === 'sets' ? sets : clusters;
  const planned = view === 'sets' ? plannedSets : plannedClusters;
  const copy = COPY[view];

  const n = (x: number) => formatNumber(x, locale, { maximumFractionDigits: 1 });
  const muscle = (m: VolumeMuscle) => t(VOLUME_MUSCLE_KEY[m]);
  const nameOf = (id?: string) => sessions.find((s) => s.id === id)?.templateName ?? t('train.volume.session');
  const plannedOf = (m: VolumeMuscle) => planned.get(m)?.fractional ?? 0;
  const shown = report.week.filter((m) => m.fractional > 0 || plannedOf(m.muscle) > 0);
  const idle = report.week.filter((m) => !(m.fractional > 0 || plannedOf(m.muscle) > 0));
  // Each face names the other's count instead of converting it.
  const other = view === 'sets'
    ? (clusters.total > 0 ? t('train.volume.sets.clustersNote', { n: clusters.total }) : null)
    : (sets.total > 0 ? t('train.volume.straight', { n: sets.total }) : null);

  return (
    <BottomSheet native detents={[0.75, 1]} visible={visible} onClose={onClose} contentStyle={styles.sheetBody} backdropTestID="weekly-volume-backdrop">
      <View style={styles.sheetStack}>
      {/* Pinned above the scroll, with a visible Done (train-ux H7). */}
      <SheetHeader
        title={t('train.volume.title')}
        trailing={{ label: t('common.done'), onPress: onClose, testID: 'weekly-volume-done' }}
      />
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator testID="weekly-volume">
        <View style={{ gap: space.sm, paddingBottom: space.xl }}>
          <SegmentedControl<VolumeView>
            segments={[
              { key: 'sets', label: t('train.volume.view.sets'), testID: 'weekly-volume-view-sets' },
              { key: 'clusters', label: t('train.volume.view.clusters'), testID: 'weekly-volume-view-clusters' },
            ]}
            value={view}
            onChange={setStored}
            stretch
            accessibilityLabel={t('train.volume.viewLabel')}
            testID="weekly-volume-view"
          />
          <Text style={styles.sheetHint} testID="weekly-volume-hint">{t(copy.hint)}</Text>
          {rotation.length ? (
            <Text style={styles.sheetHint} testID="weekly-volume-rotation">
              {t('train.volume.rotation', {
                sessions: rotation
                  .map((s) => `${s.templateName ?? t('train.volume.session')} ${formatDate(s.date, locale, { month: 'short', day: 'numeric' })}`)
                  .join(' · '),
              })}
            </Text>
          ) : null}
          {shown.length === 0 ? (
            <Text style={styles.reportNote} testID="weekly-volume-empty">{t(copy.empty)}</Text>
          ) : (
            <>
              <Text style={styles.panelLabel}>{t('train.volume.columns')}</Text>
              {shown.map((m) => {
                const plan = plannedOf(m.muscle);
                return (
                  <View
                    key={m.muscle}
                    style={styles.reportMetric}
                    accessible
                    accessibilityLabel={t('train.volume.rowA11y', {
                      muscle: muscle(m.muscle), direct: n(m.direct), fractional: n(m.fractional), planned: n(plan),
                    })}
                    testID={`weekly-volume-${m.muscle}`}
                  >
                    <Text style={styles.reportMetricLabel}>{muscle(m.muscle)}</Text>
                    <Text style={styles.reportMetricValue}>
                      {t('train.volume.row', { direct: n(m.direct), fractional: n(m.fractional), planned: n(plan) })}
                    </Text>
                  </View>
                );
              })}
              {idle.length ? (
                <Text style={styles.reportNote} testID="weekly-volume-idle">
                  {t(copy.untrained, { names: idle.map((m) => muscle(m.muscle)).join(', ') })}
                </Text>
              ) : null}
            </>
          )}
          {other ? (
            <Text style={styles.reportNote} testID={view === 'sets' ? 'weekly-volume-clusters-note' : 'weekly-volume-straight'}>{other}</Text>
          ) : null}
          {report.unattributed.length ? (
            <Text style={styles.reportNote}>{t('train.volume.unattributed', { names: report.unattributed.join(', ') })}</Text>
          ) : null}

          {report.perSession.length ? (
            <Text style={[styles.panelLabel, { marginTop: space.md }]} accessibilityRole="header">{t('train.volume.perSession')}</Text>
          ) : null}
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
                  {/* An advisory, so the warning colour — not the brand red
                      the PR trophy wears (train-ux J8). */}
                  <Ionicons name="alert-circle-outline" size={16} color={colors.warn} />
                  <Text style={[styles.reportFlagText, { flex: 1 }]}>
                    {t(copy.plateau, { muscle: muscle(m), n: n(s.muscles.find((x) => x.muscle === m)?.fractional ?? 0), max: PER_SESSION_PLATEAU })}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      </View>
    </BottomSheet>
  );
}
