import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { finishSummary, formatLoad, otherSetCells, sessionCounts } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { DEFAULT_LOG_STYLE, type WorkoutSession } from '@/lib/workout';
import { space } from '@/theme';
import { sessionSummary, setLine } from './train-summary';
import { SessionSupersetReport } from './SupersetReport';
import { createStyles } from './train-styles';

/**
 * One logged workout, READ-ONLY: what was lifted, the records set in it, and
 * Edit / Share / Delete (Train re-score, usability).
 *
 * Tapping a history row used to drop straight into edit mode — the live
 * session's chrome, every field a target, on a workout from last Tuesday that
 * the user only wanted to look at. Strong and Hevy open a detail page with
 * Edit inside it; so does this. Records are judged against the sessions BEFORE
 * this one, so an old workout is not credited with a PR it set at the time
 * and has since been beaten — nor denied one by a later session.
 *
 * Owned by the idle screen, rendered whether or not it is open (a native sheet
 * must be closed by a mounted owner). Its actions close it first; the owner
 * runs them once the sheet has gone (`afterSheet`).
 */
export function SessionDetailSheet({
  visible,
  session,
  history,
  onClose,
  onEdit,
  onShare,
  onDelete,
}: {
  visible: boolean;
  /** The workout to show — kept by the owner while the sheet closes, so the
   *  content does not blank mid-animation. */
  session: WorkoutSession | null;
  /** The completed history the tab holds, newest first. */
  history: readonly WorkoutSession[];
  onClose: () => void;
  onEdit: (s: WorkoutSession) => void;
  onShare: (s: WorkoutSession) => void;
  onDelete: (s: WorkoutSession) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const unitSystem = useUnitSystem();
  const summary = useMemo(() => {
    if (!session) return null;
    const at = session.date.getTime();
    const before = history.filter((s) => s.id !== session.id && s.date.getTime() < at);
    return finishSummary(session, before, at);
  }, [session, history]);
  const counts = session ? sessionCounts(session) : { exercises: 0, sets: 0 };

  return (
    <BottomSheet
      native
      detents={[0.6, 1]}
      visible={visible && session != null}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="85%"
    >
      {session && summary ? (
        <View style={styles.sheetStack}>
        {/* A visible Done, pinned above the scroll (train-ux H7): the sheet
            opens to a full-height detent where the grabber was the only way
            out. */}
        <SheetHeader
          title={session.templateName || t('train.workout')}
          trailing={{ label: t('common.done'), onPress: onClose, testID: 'session-detail-done' }}
        />
        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.finishScroll} testID="session-detail">
          <View>
            {/* The date, in teal: in the light theme's red it read as an
                alert beside the danger-red Delete (train-ux J8). */}
            <Text style={[styles.sessionEyebrow, { color: colors.teal }]}>
              {formatDate(session.date, locale, { weekday: 'long', month: 'short', day: 'numeric' })}
            </Text>
            <Text style={styles.sheetHint}>{sessionSummary(session, t)}</Text>
          </View>

          <View style={styles.summaryGrid}>
            <View
              style={styles.summaryTile}
              accessible
              accessibilityLabel={`${t('train.summaryVolume')}: ${formatLoad(summary.volume, unitSystem, 0)}`}
            >
              <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
                {formatLoad(summary.volume, unitSystem, 0)}
              </Text>
              <Text style={styles.summaryLabel}>{t('train.summaryVolume')}</Text>
            </View>
            <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summarySets')}: ${counts.sets}`}>
              <Text style={styles.summaryValue}>{counts.sets}</Text>
              <Text style={styles.summaryLabel}>{t('train.summarySets')}</Text>
            </View>
          </View>

          {summary.prs.map((pr) => (
            <View key={pr.exerciseId} style={styles.syncRow} testID={`detail-pr-${pr.exerciseId}`}>
              <Ionicons name="trophy-outline" size={16} color={colors.accent} />
              <Text style={styles.summaryBest}>
                {t('train.summaryNewBest', { name: pr.name, weight: formatLoad(pr.weight, unitSystem), reps: pr.reps })}
              </Text>
            </View>
          ))}

          <View>
            {session.exercises.map((ex, i) => {
              const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
              const line = setLine(ex, style, unitSystem);
              // Warm-up, drop and mobility sets, on a muted line of their own:
              // the "12 sets" tile counts every logged set, and a list of the
              // working ones alone showed nine under it (train-ux H3).
              const others = otherSetCells(ex, style, unitSystem)
                .map((c) => `${t(OTHER_KIND_KEY[c.kind])} ${c.cell}`)
                .join(' · ');
              return (
                // Name over its sets, full width. The name used to borrow the
                // history table's 56pt DATE column, so "Romanian deadlift"
                // broke into four lines beside its numbers (UX_AUDIT S20).
                <View key={`${ex.exerciseId}-${i}`} style={styles.detailExRow} accessible>
                  <Text style={styles.detailExName} numberOfLines={2}>{ex.name}</Text>
                  {line || !others ? <Text style={styles.detailSets}>{line || t('train.detailNoSets')}</Text> : null}
                  {others ? (
                    <Text style={[styles.detailSets, { color: colors.muted }]} testID={`detail-other-sets-${i}`}>{others}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>

          <SessionSupersetReport sessions={history} session={session} />

          <Touchable
            style={styles.finishBtn}
            onPress={() => onEdit(session)}
            accessibilityRole="button"
            testID="session-detail-edit"
          >
            <Text style={styles.finishText}>{t('train.detailEdit')}</Text>
          </Touchable>
          <View style={[styles.manageRow, { marginTop: space.xs }]}>
            <Touchable
              style={styles.manageBtn}
              onPress={() => onShare(session)}
              accessibilityRole="button"
              testID="session-detail-share"
            >
              <Text style={styles.manageLink}>{t('train.share')}</Text>
            </Touchable>
            <Touchable
              style={styles.manageBtn}
              onPress={() => onDelete(session)}
              accessibilityRole="button"
              testID="session-detail-delete"
            >
              <Text style={[styles.manageLink, styles.manageDanger]}>{t('train.delete')}</Text>
            </Touchable>
          </View>
        </ScrollView>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const OTHER_KIND_KEY: Record<'warmup' | 'drop' | 'mobility', I18nKey> = {
  warmup: 'train.kind.warmup',
  drop: 'train.kind.drop',
  mobility: 'train.kind.mobility',
};
