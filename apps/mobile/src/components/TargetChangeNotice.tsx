import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { type DailyTargetRecord, type TargetChangeReason, type UnitSystem, formatBodyWeight } from '@macrolog/core';
import { type TFn, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/** The sentence for one reason, in the user's units and language. */
function reasonLine(r: TargetChangeReason, unitSystem: UnitSystem, kcal: (n: number) => string, t: TFn): string {
  switch (r.kind) {
    case 'weight':
      return t('targetNotice.why.weight', {
        perKg: r.perKg,
        from: formatBodyWeight(r.fromLb, unitSystem),
        to: formatBodyWeight(r.toLb, unitSystem),
      });
    case 'protein-per-kg':
      return t('targetNotice.why.perKg', { from: r.from, to: r.to });
    case 'maintenance':
      return t('targetNotice.why.maintenance', { from: kcal(r.from), to: kcal(r.to) });
    case 'pace':
      return t('targetNotice.why.pace', {
        from: formatBodyWeight(r.from, unitSystem),
        to: formatBodyWeight(r.to, unitSystem),
      });
    case 'calorie-floor':
      return t('targetNotice.why.floor', { from: kcal(r.from), to: kcal(r.to) });
    case 'user-cleared':
      return t('targetNotice.why.userCleared');
    case 'user-set':
      return t('targetNotice.why.userSet');
    case 'recalculated':
      return t('targetNotice.why.recalculated');
  }
}

/**
 * "Your target changed" — the notice every AUTOMATIC target change owes
 * (owner, 2026-10-08: no silent changes). Old value → new value, then why,
 * from the stored day record (`useTargetHistory`). Sits directly under the
 * hero whose number it explains, outside the one-nudge queue: an
 * unexplained move of the number the user eats against is not a nudge that
 * can wait its turn.
 */
export function TargetChangeNotice({
  record,
  unitSystem,
  onAck,
  onSetOwn,
}: {
  record: DailyTargetRecord | null;
  unitSystem: UnitSystem;
  onAck: (date: string) => void;
  onSetOwn: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const change = record?.change;
  if (!record || !change) return null;

  const kcal = (n: number) => formatNumber(Math.round(n), locale);
  const lines: string[] = [];
  if (change.protein) lines.push(t('targetNotice.protein', { from: change.protein.from, to: change.protein.to }));
  if (change.kcal) lines.push(t('targetNotice.kcal', { from: kcal(change.kcal.from), to: kcal(change.kcal.to) }));

  return (
    <View style={styles.card} testID="target-change-notice" accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">{t('targetNotice.title')}</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.fromTo} testID="target-change-from-to">{line}</Text>
      ))}
      {change.reasons.map((r) => {
        const line = reasonLine(r, unitSystem, kcal, t);
        return <Text key={line} style={styles.why} testID="target-change-why">{line}</Text>;
      })}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.cta}
          onPress={() => {
            haptics.tap();
            onAck(record.date);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('targetNotice.ack')}
          testID="target-change-ack"
        >
          <Text style={styles.ctaText}>{t('targetNotice.ack')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => {
            haptics.tap();
            onSetOwn();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('targetNotice.setOwn')}
          testID="target-change-set-own"
        >
          <Text style={styles.secondaryText}>{t('targetNotice.setOwn')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.xs,
  },
  title: { fontSize: font.body, color: colors.ink, fontWeight: '800' },
  fromTo: { fontSize: font.small, color: colors.ink, fontWeight: '600', lineHeight: 20, fontVariant: ['tabular-nums'] },
  why: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  cta: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: TARGET,
    justifyContent: 'center',
  },
  ctaText: { fontSize: font.small, fontWeight: '800', color: colors.onFill },
  secondary: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.lg,
    minHeight: TARGET,
    justifyContent: 'center',
  },
  secondaryText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
});
