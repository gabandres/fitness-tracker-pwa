import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { finishSummary, formatLoad, sessionCounts } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { useLocale, useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { DEFAULT_LOG_STYLE, type WorkoutSession } from '@/lib/workout';
import { space } from '@/theme';
import { sessionSummary, setLine } from './train-summary';
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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.finishScroll} testID="session-detail">
          <View>
            <Text style={styles.sessionEyebrow}>
              {formatDate(session.date, locale, { weekday: 'long', month: 'short', day: 'numeric' })}
            </Text>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {session.templateName || t('train.workout')}
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
              const line = setLine(ex, ex.logStyle ?? DEFAULT_LOG_STYLE, unitSystem);
              return (
                // Name over its sets, full width. The name used to borrow the
                // history table's 56pt DATE column, so "Romanian deadlift"
                // broke into four lines beside its numbers (UX_AUDIT S20).
                <View key={`${ex.exerciseId}-${i}`} style={styles.detailExRow} accessible>
                  <Text style={styles.detailExName} numberOfLines={2}>{ex.name}</Text>
                  <Text style={styles.detailSets}>{line || t('train.detailNoSets')}</Text>
                </View>
              );
            })}
          </View>

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
      ) : null}
    </BottomSheet>
  );
}
