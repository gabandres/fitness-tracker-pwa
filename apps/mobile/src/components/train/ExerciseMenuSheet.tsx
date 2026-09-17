import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { BottomSheet } from '@/components/BottomSheet';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { createStyles } from './train-styles';

export interface ExerciseMenuAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: I18nKey;
  /** Explains what it does, for the ones that are gym jargon. */
  descKey?: I18nKey;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * The per-exercise `⋯` menu during a live session.
 *
 * ## What it replaced
 *
 * An expanded exercise card carried, permanently and inline: `+ Add set`,
 * `+ Add cluster`, a `Plates & warm-up` toggle and a `Remove` row — the union
 * of every structure's needs, shown to everyone, under every exercise. Hevy,
 * Strong and Boostcamp all keep exactly one always-visible button (add a set)
 * and put everything else behind a single overflow control, which is most of
 * why their cards read as a list of sets rather than as a form.
 *
 * `+ Add set` deliberately stays on the card. It is the one action taken
 * mid-set, and burying the most frequent action to tidy the rarest ones would
 * be the same mistake in the other direction.
 *
 * The caller supplies the actions because which ones exist is structure-
 * dependent (`addActionsFor`, ADR-0040) and because two of them — the plate
 * panel and lift settings — are state on the card, not writes.
 */
export function ExerciseMenuSheet({
  visible,
  name,
  actions,
  onClose,
}: {
  visible: boolean;
  name: string;
  actions: ExerciseMenuAction[];
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      {/* Same reason as `SetRowSheet`: `BottomSheet` clamps and does not
          scroll. Five rows fit on any phone at default type, and do not at
          the largest accessibility text size. */}
      <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.sheetTitle}>{name}</Text>
      {actions.map((a) => (
        <TouchableOpacity
          key={a.key}
          style={styles.menuRow}
          onPress={() => {
            haptics.tap();
            // Close first: every one of these either opens another sheet or
            // changes the card behind this one, and leaving the menu up over
            // the result is how a "did that work?" tap becomes two.
            onClose();
            a.onPress();
          }}
          accessibilityRole="button"
          testID={`ex-menu-${a.key}`}
        >
          <Ionicons
            name={a.icon}
            size={18}
            color={a.destructive ? colors.danger : colors.muted}
          />
          <View style={styles.menuMain}>
            <Text style={[styles.menuLabel, a.destructive && styles.menuLabelDanger]}>
              {t(a.labelKey)}
            </Text>
            {a.descKey ? <Text style={styles.menuDesc}>{t(a.descKey)}</Text> : null}
          </View>
        </TouchableOpacity>
      ))}
      <View style={styles.setSheetTail} />
      </ScrollView>
    </BottomSheet>
  );
}
