import { Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { type Recommendation, formatLoad } from '@macrolog/core';
import { useT } from '@/i18n';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { createStyles } from '@/components/train/train-styles';
import { recommendationText } from '@/components/train/recommendation-text';

/**
 * The engine's call for one exercise: load · ACTION, "Target: ≥ N reps", the
 * reason with its numbers, what to expect at a new load, and the stall
 * diagnosis when there is one. Rendered on the active-session card and under
 * a template before the session starts (progression engine layer 6).
 *
 * The sets start at the call's load (`seedCallLoad`), so the headline is a
 * chip only when the untouched sets hold something else (`currentLoad`) —
 * the lifter switched to the template's load, or a mid-session add — and
 * tapping it puts the call's load back. When the template prescribes a
 * different load, a "Template: X" line under the headline is the other half
 * of that switch (owner, 2026-10-09: the card said HOLD 20 over sets at the
 * template's 25, with nothing saying where the 25 came from). Either tap
 * lands on every untouched set of the LIVE session (`loadTargetIndices`).
 *
 * `onSettings` opens the lift's settings (effort standard, rep range). It sits
 * on the note because the note is where the call is read, which is where the
 * question arises.
 */
export function RecommendationNote({
  rec,
  compact = false,
  currentLoad,
  templateLoad,
  onAccept,
  onSettings,
  testID,
}: {
  rec: Recommendation;
  /** Headline, target and reason only — for the template list. */
  compact?: boolean;
  /** What the live session's untouched sets hold now (`untouchedLoad`);
   *  absent when no set is left to move. */
  currentLoad?: number;
  /** The template's load for this lift (`SessionExercise.targetLoad`). */
  templateLoad?: number;
  onAccept?: (load: number) => void;
  onSettings?: () => void;
  testID?: string;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const text = recommendationText(rec, unitSystem, t);
  if (!text) return null;

  const invalid = rec.action === 'repeat-invalid';
  const differs = (a: number | undefined, b: number | undefined) => a != null && b != null && Math.abs(a - b) >= 0.01;
  const canAccept = onAccept != null && differs(rec.load, currentLoad);
  // Only beside a call that names a different load: a template that agrees
  // with the card has nothing to add.
  const showTemplate = !compact && templateLoad != null && differs(templateLoad, rec.load);
  const canUseTemplate = showTemplate && onAccept != null && differs(templateLoad, currentLoad);
  const templateLine = showTemplate ? t('train.rec.templateLoad', { load: formatLoad(templateLoad, unitSystem) }) : null;

  return (
    <View style={compact ? styles.recCompact : styles.recBlock} testID={testID}>
      <View style={styles.recHeadRow}>
        {invalid ? <Ionicons name="alert-circle-outline" size={15} color={colors.muted} /> : null}
        {canAccept ? (
          <TouchableOpacity
            style={styles.bumpChip}
            onPress={() => onAccept(rec.load as number)}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            testID={testID ? `${testID}-accept` : undefined}
          >
            <Text style={styles.bumpText}>{text.headline}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.recHeadline, invalid && styles.recHeadlineInvalid]}>{text.headline}</Text>
        )}
        {onSettings ? (
          <TouchableOpacity
            style={styles.recGear}
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel={t('train.rec.settings')}
            testID={testID ? `${testID}-settings` : undefined}
          >
            <Ionicons name="options-outline" size={16} color={colors.faint} />
          </TouchableOpacity>
        ) : null}
      </View>
      {templateLine ? (
        canUseTemplate ? (
          <TouchableOpacity
            onPress={() => onAccept?.(templateLoad as number)}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityHint={t('train.rec.templateLoadHint')}
            testID={testID ? `${testID}-template` : undefined}
          >
            <Text style={[styles.recNote, styles.recTemplateLink]}>{templateLine}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.recNote} testID={testID ? `${testID}-template` : undefined}>{templateLine}</Text>
        )
      ) : null}
      {text.target ? (
        <Text style={styles.recTarget} testID={testID ? `${testID}-target` : undefined}>{text.target}</Text>
      ) : null}
      {text.reason ? (
        <Text style={styles.recReason} testID={testID ? `${testID}-reason` : undefined}>{text.reason}</Text>
      ) : null}
      {!compact && text.expect ? (
        <Text style={styles.recNote} testID={testID ? `${testID}-expect` : undefined}>{text.expect}</Text>
      ) : null}
      {!compact
        ? text.notes.map((line, i) => (
            <Text key={i} style={styles.recNote} testID={testID ? `${testID}-note` : undefined}>{line}</Text>
          ))
        : null}
      {text.warnings.map((line, i) => (
        <View key={i} style={styles.recWarnRow} testID={testID ? `${testID}-warning` : undefined}>
          <Ionicons name="information-circle-outline" size={15} color={colors.ink} />
          <Text style={styles.recWarnText}>{line}</Text>
        </View>
      ))}
      {!compact && text.last ? <Text style={styles.recLast}>{text.last}</Text> : null}
      {!compact && text.stall.length > 0 ? (
        <View style={styles.recStall} testID={testID ? `${testID}-stall` : undefined}>
          {text.stall.map((line, i) => (
            <Text key={i} style={i === 0 ? styles.recStallHead : styles.recStallLine}>{line}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
