import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Touchable } from '@/components/Touchable';
import type { TrendsAnswer } from '@/components/charts/trend-copy';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * The first thing on Trends (UX_AUDIT S24-5, 2026-11-19): the answer, then the
 * method. `trendsAnswer` (`charts/trend-copy.ts`) decides what there is to
 * say; this only draws it.
 *
 * Two faces. With a week of food logged: one or two plain sentences — which
 * way the weight is going, and how the eating compares with the target. Below
 * that gate: the two things that produce those sentences, each a row that
 * opens the sheet which does it, with its own count. A row is a button only
 * while it is not done.
 */
export function TrendsAnswerCard({
  answer,
  onLogFood,
  onLogWeight,
}: {
  answer: TrendsAnswer;
  onLogFood: () => void;
  onLogWeight: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  if (answer.kind === 'sentence') {
    if (!answer.weight && !answer.eating) return null;
    return (
      <View style={styles.card} testID="trends-answer">
        <Text style={styles.kicker} accessibilityRole="header">{t('trends.answer.title')}</Text>
        {answer.weight ? <Text style={styles.sentence} testID="trends-answer-weight">{answer.weight}</Text> : null}
        {answer.eating ? <Text style={styles.sentence} testID="trends-answer-eating">{answer.eating}</Text> : null}
        {answer.needsWeighIns ? (
          <Touchable
            style={styles.link}
            onPress={() => { haptics.tap(); onLogWeight(); }}
            accessibilityRole="button"
            accessibilityLabel={t('trends.answer.weighToSee')}
            testID="trends-answer-weigh"
          >
            <Text style={styles.linkText}>{t('trends.answer.weighToSee')}</Text>
          </Touchable>
        ) : null}
      </View>
    );
  }

  const rows = [
    {
      key: 'food',
      label: t('trends.answer.stepFood', { needed: answer.foodNeeded }),
      count: t('trends.answer.stepCount', { n: answer.foodDays, needed: answer.foodNeeded }),
      done: answer.foodDays >= answer.foodNeeded,
      run: onLogFood,
    },
    {
      key: 'weigh',
      label: t('trends.answer.stepWeigh'),
      count: t('trends.answer.stepCount', { n: answer.weighIns, needed: answer.weighInsNeeded }),
      done: answer.weighIns >= answer.weighInsNeeded,
      run: onLogWeight,
    },
  ];
  return (
    <View style={styles.card} testID="trends-checklist">
      <Text style={styles.kicker} accessibilityRole="header">{t('trends.answer.checklistTitle')}</Text>
      <Text style={styles.body}>{t('trends.answer.checklistBody')}</Text>
      {rows.map((r) => {
        const inner = (
          <>
            <Ionicons
              name={r.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={r.done ? colors.teal : colors.faint}
            />
            <Text style={[styles.stepLabel, r.done && styles.stepDone]}>{r.label}</Text>
            <Text style={styles.stepCount}>{r.count}</Text>
            {r.done ? null : <Ionicons name="chevron-forward" size={16} color={colors.faint} />}
          </>
        );
        const a11y = `${r.label}, ${r.count}`;
        return r.done ? (
          <View key={r.key} style={styles.step} accessible accessibilityLabel={a11y} testID={`trends-step-${r.key}`}>
            {inner}
          </View>
        ) : (
          <Touchable
            key={r.key}
            style={styles.step}
            onPress={() => { haptics.tap(); r.run(); }}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            testID={`trends-step-${r.key}`}
          >
            {inner}
          </Touchable>
        );
      })}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      gap: space.xs,
    },
    kicker: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
    sentence: { fontSize: font.body, color: colors.ink, fontWeight: '700', lineHeight: 24 },
    body: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    link: { alignSelf: 'flex-start', minHeight: TARGET, justifyContent: 'center' },
    linkText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
    step: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
    stepLabel: { flex: 1, fontSize: font.body, color: colors.ink, fontWeight: '600' },
    stepDone: { color: colors.muted },
    stepCount: { fontSize: font.small, color: colors.muted, fontVariant: ['tabular-nums'] },
  });
