import { Text, TouchableOpacity, View } from 'react-native';
import { CARDIO_MODALITIES } from '@macrolog/core';
import type { CardioModality } from '@macrolog/core/cardio';
import { BottomSheet } from '@/components/BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useThemedStyles } from '@/lib/theme-context';
import { CARDIO_MODALITY_KEY } from './train-summary';
import { createStyles } from './train-styles';

/**
 * Pick what the effort was; the card then collects the numbers.
 *
 * Two steps rather than one long form because the modality is the only field
 * with no sensible default — everything else on a cardio block is optional, and
 * a run carrying just a duration is already a complete record. Uses
 * `<BottomSheet>` like every other sheet here; `sheets-are-one-component.test.ts`
 * fails the build on a hand-rolled slide Modal. Native, sized to its chips.
 */
export function CardioPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (modality: CardioModality) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  return (
    <BottomSheet
      native
      detents="fit"
      visible={visible}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      <View style={styles.sheetStack}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('cardio.pickModality')}</Text>
        <View style={styles.modalityChips}>
          {CARDIO_MODALITIES.map((m) => (
            <TouchableOpacity
              key={m}
              style={styles.kindChip}
              // Compact chip; hitSlop lifts the ~22-pt box to 44.
              hitSlop={{ top: 11, bottom: 11, left: 4, right: 4 }}
              accessibilityRole="button"
              testID={`cardio-modality-${m}`}
              onPress={() => {
                haptics.tap();
                onPick(m);
                onClose();
              }}
            >
              <Text style={styles.kindChipText}>{t(CARDIO_MODALITY_KEY[m])}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}
