import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { STARTER_TEMPLATES, type SeedTemplate, seedTemplateName } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useThemedStyles } from '@/lib/theme-context';
import { createStyles } from './train-styles';

/** The shipped starter splits — the cold-start helper. */
export function StarterTemplatesSheet({
  visible,
  train,
  onClose,
}: {
  visible: boolean;
  train: Pick<TrainState, 'templates' | 'cloneStarterTemplate'>;
  onClose: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const locale = useLocale();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Hide starters the user has already cloned (matched by stable seedKey, so
  // it holds across a locale switch). Falls back to the localized name for
  // clones made before seedKey existed.
  const cloned = new Set<string>();
  for (const tpl of train.templates) {
    if (tpl.seedKey) cloned.add(tpl.seedKey);
  }
  const available = STARTER_TEMPLATES.filter(
    (seed) =>
      !cloned.has(seed.key) &&
      !train.templates.some((tpl) => !tpl.seedKey && tpl.name.toLowerCase() === seedTemplateName(seed, locale).toLowerCase()),
  );

  useEffect(() => {
    if (visible) setBusyKey(null);
  }, [visible]);

  async function use(seed: SeedTemplate) {
    if (busyKey) return;
    haptics.tap();
    setBusyKey(seed.key);
    try {
      await train.cloneStarterTemplate(seed);
      onClose();
    } catch (e) {
      // It had no `catch` (Train review bug 7): a refused write was an
      // unhandled rejection and a button stuck on "Saving…".
      haptics.warning();
      showToast(t('train.starterErr'));
      captureError(e, { where: 'train.cloneStarterTemplate' });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <BottomSheet native visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      {/* `styles.list`'s gap, applied to the SCROLL CONTENT. The rows were
          mapped straight into the ScrollView, so nothing separated them and
          five bordered cards read as one striped block — while the
          identical `tplRow` on the Train screen itself sits inside
          `styles.list` and is spaced. The gap belongs to the container, not
          to `tplRow`: putting a margin on the row would double the spacing
          in the list that is already correct. */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.starterList}
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.starterTitle')}</Text>
        <Text style={styles.sheetHint}>{t('train.starterHint')}</Text>
        {available.length === 0 ? (
          <Text style={styles.sheetEmpty}>{t('train.starterAllCloned')}</Text>
        ) : null}
        {available.map((seed) => (
          <View key={seed.key} style={styles.tplRow}>
            <View style={styles.tplMain}>
              <Text style={styles.histDate}>{seedTemplateName(seed, locale)}</Text>
              <Text style={styles.histSub}>
                {`${seed.exercises.length} ${seed.exercises.length === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`}
              </Text>
            </View>
            <Touchable
              style={styles.tplStart}
              onPress={() => use(seed)}
              disabled={busyKey != null}
              accessibilityRole="button"
              accessibilityLabel={`${t('train.use')} ${seedTemplateName(seed, locale)}`}
              testID={`use-starter-${seed.key}`}
            >
              <Text style={styles.tplStartText}>{busyKey === seed.key ? t('common.saving') : t('train.use')}</Text>
            </Touchable>
          </View>
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </BottomSheet>
  );
}
