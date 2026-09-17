import { Text, TouchableOpacity, View } from 'react-native';
import type { NextUp } from '@macrolog/core';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/date-format';
import { useLocale } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles } from '@/lib/theme-context';
import { createStyles } from './train-styles';

/**
 * The home screen's answer to "what am I doing today".
 *
 * ## The problem it solves
 *
 * The most prominent control on the Train tab used to be a full-width
 * **Start workout** button that started an *empty* session — the rarest path
 * anyone takes. The thing people actually want, "start Push A", was a small
 * chip on a template row, three sections down, under a hero and a six-chip
 * audit. Meanwhile the template rows said only "3 exercises · 12 sets": no
 * last-performed date, no order, nothing that answers the question.
 *
 * Every tracker that reads as intuitive answers it on the home screen —
 * Boostcamp's most-quoted user line is "just click start on whatever day is
 * next in my routine". `nextTemplateUp` decides which one that is (least
 * recently performed, never-performed first) and the reasoning for that choice
 * lives with it in core.
 *
 * ## Why the date is on the card
 *
 * "Last done Tue" is what makes the suggestion checkable. A card that just
 * asserts "Push A" is a decision the app made and did not show its work for,
 * and the one thing this project will not do is state a number without saying
 * where it came from.
 */
export function NextUpCard({
  next,
  onStart,
  onEdit,
}: {
  next: NextUp;
  onStart: () => void;
  onEdit: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);

  const when =
    next.daysAgo == null
      ? t('train.nextNever')
      : next.daysAgo === 0
        ? t('train.nextToday')
        : next.daysAgo === 1
          ? t('train.nextYesterday')
          : // Past a week a weekday name stops being useful ("last Tue" three
            // weeks on is a lie a date is not), so switch to a day count.
            next.daysAgo <= 7 && next.lastPerformed
            ? t('train.nextLast', {
                day: formatDate(next.lastPerformed, locale, { weekday: 'long' }),
              })
            : t('train.nextDaysAgo', { n: next.daysAgo });

  return (
    <View style={styles.nextCard} testID="next-up">
      <Text style={styles.nextCaption}>{t('train.nextUp')}</Text>
      <TouchableOpacity
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('train.nextEditA11y', { name: next.template.name })}
        testID="next-up-edit"
      >
        <Text style={styles.nextName}>{next.template.name}</Text>
        <Text style={styles.nextMeta}>{when}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.startBtn}
        onPress={() => {
          haptics.tap();
          onStart();
        }}
        testID="next-up-start"
      >
        <Text style={styles.startBtnText}>{t('train.startNamed', { name: next.template.name })}</Text>
      </TouchableOpacity>
    </View>
  );
}
