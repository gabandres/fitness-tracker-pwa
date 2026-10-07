import { Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recommendation } from '@macrolog/core';
import { useT } from '@/i18n';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { createStyles } from '@/components/train/train-styles';
import { recommendationText } from '@/components/train/recommendation-text';

/** Calls whose load is worth a tap even when it does not move: a hold or a
 *  repeat at a load the session was NOT pre-filled with (the 10/6 crunch —
 *  "Repeat 25" over sets seeded at the template's 30). */
const ACCEPTABLE_WHEN_DIFFERENT = new Set<Recommendation['action']>(['hold', 'build-reps', 'repeat-invalid']);

/**
 * The engine's call for one exercise: load · ACTION, "Target: ≥ N reps", the
 * reason with its numbers, what to expect at a new load, and the stall
 * diagnosis when there is one. Rendered on the active-session card and under
 * a template before the session starts (progression engine layer 6).
 *
 * `onAccept` is offered when the call names a load to take: an increase or a
 * drop-back always, and a hold or repeat when its load differs from the
 * `seededLoad` the session's sets were pre-filled with. Taking it lands on
 * every untouched set of the LIVE session (`loadTargetIndices`). A hold at
 * the seeded load is a sentence, not a chip: there is nothing to accept.
 *
 * `onSettings` opens the lift's settings (effort standard, rep range). It sits
 * on the note because the note is where the call is read, which is where the
 * question arises.
 */
export function RecommendationNote({
  rec,
  compact = false,
  seededLoad,
  onAccept,
  onSettings,
  testID,
}: {
  rec: Recommendation;
  /** Headline, target and reason only — for the template list. */
  compact?: boolean;
  /** The load the live session's sets were seeded with (template targetLoad). */
  seededLoad?: number;
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
  const differsFromSeed = rec.load != null && seededLoad != null && Math.abs(rec.load - seededLoad) >= 0.01;
  const canAccept = onAccept != null && rec.load != null
    && (text.tappable || (ACCEPTABLE_WHEN_DIFFERENT.has(rec.action) && differsFromSeed));

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
