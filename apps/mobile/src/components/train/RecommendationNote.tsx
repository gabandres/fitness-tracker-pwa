import { Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recommendation } from '@macrolog/core';
import { useT } from '@/i18n';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { createStyles } from '@/components/train/train-styles';
import { recommendationText } from '@/components/train/recommendation-text';

/**
 * The engine's call for one exercise: load · ACTION, the reason with its
 * numbers, last session's activation, and the stall diagnosis when there is
 * one. Rendered on the active-session card and under a template before the
 * session starts (progression engine layer 6).
 *
 * `onAccept` is offered only on an actionable load change — the chip is the
 * same "tap to take the suggestion" affordance the double-progression bump
 * had, and it only ever patches the first working set of the LIVE session.
 * A "repeat" or "hold" is a sentence, not a chip: there is nothing to accept.
 */
export function RecommendationNote({
  rec,
  compact = false,
  onAccept,
  testID,
}: {
  rec: Recommendation;
  /** One line (headline + reason) for the template list. */
  compact?: boolean;
  onAccept?: (load: number) => void;
  testID?: string;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const text = recommendationText(rec, unitSystem, t);
  if (!text) return null;

  const invalid = rec.action === 'repeat-invalid';
  const canAccept = text.tappable && onAccept && rec.load != null;

  return (
    <View style={compact ? styles.recCompact : styles.recBlock} testID={testID}>
      <View style={styles.recHeadRow}>
        {invalid ? (
          <Ionicons name="alert-circle-outline" size={15} color={colors.muted} />
        ) : null}
        {canAccept ? (
          <TouchableOpacity
            style={styles.bumpChip}
            onPress={() => onAccept(rec.load as number)}
            testID={testID ? `${testID}-accept` : undefined}
          >
            <Text style={styles.bumpText}>{text.headline}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.recHeadline, invalid && styles.recHeadlineInvalid]}>{text.headline}</Text>
        )}
      </View>
      {text.reason ? <Text style={styles.recReason}>{text.reason}</Text> : null}
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
