import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { STARTER_TEMPLATES, type SeedTemplate, seedTemplateName } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useThemedStyles } from '@/lib/theme-context';
import type { WorkoutTemplate } from '@/lib/workout';
import { createStyles } from './train-styles';
import { isClusterSeed, orderStarters, starterPreview, starterPreviewParts } from './template-draft';

/** The shipped starter splits — the cold-start helper. */
export function StarterTemplatesSheet({
  visible,
  train,
  onClose,
  onEditTemplate,
}: {
  visible: boolean;
  train: Pick<TrainState, 'templates' | 'cloneStarterTemplate'>;
  onClose: () => void;
  /** Open a just-added starter in the editor — the toast's "Edit". Without
   *  it the toast confirms the add and offers nothing. */
  onEditTemplate?: (tpl: WorkoutTemplate) => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const locale = useLocale();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** The latest list, for the toast's Edit: the clone lands through the
   *  templates listener after the sheet has closed. */
  const templatesRef = useRef(train.templates);
  useEffect(() => {
    templatesRef.current = train.templates;
  }, [train.templates]);

  // Hide starters the user has already cloned (matched by stable seedKey, so
  // it holds across a locale switch). Falls back to the localized name for
  // clones made before seedKey existed.
  const cloned = new Set<string>();
  for (const tpl of train.templates) {
    if (tpl.seedKey) cloned.add(tpl.seedKey);
  }
  const available = orderStarters(STARTER_TEMPLATES.filter(
    (seed) =>
      !cloned.has(seed.key) &&
      !train.templates.some((tpl) => !tpl.seedKey && tpl.name.toLowerCase() === seedTemplateName(seed, locale).toLowerCase()),
  ));

  useEffect(() => {
    if (visible) setBusyKey(null);
  }, [visible]);

  async function use(seed: SeedTemplate) {
    if (busyKey) return;
    haptics.tap();
    setBusyKey(seed.key);
    const name = seedTemplateName(seed, locale);
    let added = false;
    try {
      await train.cloneStarterTemplate(seed);
      added = true;
    } catch (e) {
      // It had no `catch` (Train review bug 7): a refused write was an
      // unhandled rejection and a button stuck on "Saving…".
      haptics.warning();
      showToast(t('train.starterErr'));
      captureError(e, { where: 'train.cloneStarterTemplate' });
    }
    // After the try/catch, not in a `finally`: React Compiler cannot lower a
    // `finally` and skips the whole component. Nothing above can throw past
    // the catch, so this still runs on both paths.
    setBusyKey(null);
    if (!added) return;
    onClose();
    // Said, and shown: the sheet closing was the only sign it worked
    // (H9/T19). The Edit action is the next thing a starter is for. Outside
    // the `try` for the same compiler reason: it cannot lower a conditional
    // expression inside one.
    const msg = t('train.starterAdded', { name });
    const edit = onEditTemplate;
    showToast(msg, edit ? {
      action: {
        label: t('common.edit'),
        onPress: () => {
          const tpl = templatesRef.current.find((x) => x.seedKey === seed.key);
          if (tpl) edit(tpl);
        },
      },
    } : undefined);
    announce(msg);
  }

  return (
    <BottomSheet native visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      {/* A visible way out, outside the scroll (H7): the sheet opens full
          height with only a grabber. */}
      <SheetHeader
        title={t('train.starterTitle')}
        trailing={{ label: t('common.done'), onPress: onClose, testID: 'starters-done' }}
      />
      {/* `styles.list`'s gap, applied to the SCROLL CONTENT. The rows were
          mapped straight into the ScrollView, so nothing separated them and
          five bordered cards read as one striped block — while the
          identical `tplRow` on the Train screen itself sits inside
          `styles.list` and is spaced. The gap belongs to the container, not
          to `tplRow`: putting a margin on the row would double the spacing
          in the list that is already correct. */}
      <ScrollView
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.starterList}
      >
        <Text style={styles.sheetHint}>{t('train.starterHint')}</Text>
        {available.length === 0 ? (
          <Text style={styles.sheetEmpty}>{t('train.starterAllCloned')}</Text>
        ) : null}
        {available.map((seed) => {
          const name = seedTemplateName(seed, locale);
          const count = `${seed.exercises.length} ${seed.exercises.length === 1 ? t('train.exerciseOne') : t('train.exerciseMany')}`;
          const preview = starterPreview(seed, locale);
          const parts = starterPreviewParts(seed, locale);
          const advanced = isClusterSeed(seed);
          return (
            <View key={seed.key} style={styles.tplRow} testID={`starter-row-${seed.key}`}>
              {/* The row's content is its LABEL, one stop: it sat in the Add
                  button's hint, so with hints off a starter was only "Add
                  Push Day" — what H8 fixed on the template cards (H-N8). */}
              <View
                style={styles.tplMain}
                accessible
                accessibilityLabel={[name, advanced ? t('train.starterAdvanced') : null, count, preview].filter(Boolean).join(', ')}
                testID={`starter-info-${seed.key}`}
              >
                <Text style={styles.histDate}>{name}</Text>
                {advanced ? (
                  <Text style={styles.supersetTag} testID={`starter-advanced-${seed.key}`}>{t('train.starterAdvanced')}</Text>
                ) : null}
                {/* The names truncate; "+n" sits outside them, so it is never cut. */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4 }} testID={`starter-preview-${seed.key}`}>
                  <Text style={[styles.histSub, { flexShrink: 1 }]} numberOfLines={2}>
                    {parts.head ? `${count} · ${parts.head}` : count}
                  </Text>
                  {parts.more > 0 ? (
                    <Text style={styles.histSub} testID={`starter-more-${seed.key}`}>{`+${parts.more}`}</Text>
                  ) : null}
                </View>
              </View>
              <Touchable
                style={styles.tplStart}
                onPress={() => use(seed)}
                disabled={busyKey != null}
                accessibilityRole="button"
                accessibilityLabel={`${t('train.starterAdd')} ${name}`}
                testID={`use-starter-${seed.key}`}
              >
                <Text style={styles.tplStartText}>{busyKey === seed.key ? t('common.saving') : t('train.starterAdd')}</Text>
              </Touchable>
            </View>
          );
        })}
        <View style={{ height: 24 }} />
      </ScrollView>
    </BottomSheet>
  );
}
