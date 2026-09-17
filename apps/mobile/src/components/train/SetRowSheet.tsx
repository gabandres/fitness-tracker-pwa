import { Text, TouchableOpacity, View } from 'react-native';
import { RIR_MAX, RIR_MIN, clampRir } from '@macrolog/core';
import type { SetKind, WorkoutSet } from '@/lib/workout';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { BottomSheet } from '@/components/BottomSheet';
import { useThemedStyles } from '@/lib/theme-context';
import { SET_KINDS } from './train-shared';
import { createStyles } from './train-styles';

/** The 0–5 RIR scale, spelled out one option per value. Derived from the
 *  bounds `@macrolog/core` owns so the picker can't drift from the clamp. */
const RIR_CHOICES: number[] = Array.from(
  { length: RIR_MAX - RIR_MIN + 1 },
  (_, i) => RIR_MIN + i,
);

/**
 * Everything about one set that is not a number you type: what kind of set it
 * is, how close to failure it was, and getting rid of it.
 *
 * ## Why a sheet and not the two inline expanders it replaces
 *
 * The set-kind picker and the RIR picker both expanded **inside the set list**,
 * pushing every row below them down. That is a layout jump in the middle of
 * logging, on a screen being used one-handed with 60–90 seconds of rest and
 * wet hands — the two conditions under which a moved tap target is worst. A
 * sheet costs the same one tap to open and moves nothing.
 *
 * ## Why Remove moved in here
 *
 * The set row carried six hit targets across ~360dp: the set number (a
 * picker), weight, reps, RIR (a picker), the done check, and a permanent ✕.
 * The ✕ was the smallest, the most destructive, and sat next to the one
 * control you tap after every single set. Swipe-left is the gesture the whole
 * category uses for this, and it is wired on the row; this row is the
 * discoverable and screen-reader-reachable path to the same thing.
 */
export function SetRowSheet({
  visible,
  set,
  label,
  onClose,
  onKind,
  onRir,
  onRemove,
}: {
  visible: boolean;
  set: WorkoutSet | null;
  /** The row label — "2" for a straight set, "2a/2b/2c" for a cluster. */
  label: string;
  onClose: () => void;
  onKind: (kind: SetKind) => void;
  onRir: (rir: number | undefined) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  if (!set) return null;

  // RIR is meaningful on real working effort, not warmups/back-offs.
  // `continuation` carries it too: a rest-pause continuation is taken to
  // failure, so the reading is as meaningful there as on the activation.
  const showRir =
    set.kind === 'working' || set.kind === 'activation'
    || set.kind === 'mini' || set.kind === 'continuation';

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <Text style={styles.sheetTitle}>{t('train.setSheetTitle', { n: label })}</Text>

      <Text style={styles.fieldLabel}>{t('train.setType')}</Text>
      {/* Rows, not a chip wrap: "Activation" and "Mini" are cluster-training
          vocabulary, and a bare chip label teaches nobody what they are. */}
      {SET_KINDS.map((k) => {
        const on = set.kind === k.value;
        return (
          <TouchableOpacity
            key={k.value}
            style={[styles.kindRow, on && styles.kindRowOn]}
            onPress={() => {
              haptics.tap();
              onKind(k.value);
            }}
            testID={`set-sheet-kind-${k.value}`}
          >
            <Text style={[styles.kindRowName, on && styles.kindRowNameOn]}>{t(k.labelKey)}</Text>
            <Text style={styles.kindRowDesc}>{t(k.descKey)}</Text>
          </TouchableOpacity>
        );
      })}

      {showRir ? (
        <>
          <Text style={[styles.fieldLabel, styles.setSheetGap]}>{t('train.rirPrompt')}</Text>
          {/* The acronym expanded once, where it is being answered — the
              glossary button in the header should not be the only place the
              tab explains its own vocabulary. */}
          <Text style={styles.sheetHint}>{t('train.rirExplain')}</Text>
          <View style={styles.kindChips}>
            <TouchableOpacity
              style={[styles.kindChip, set.rir == null && styles.kindChipOn]}
              onPress={() => {
                haptics.tap();
                onRir(undefined);
              }}
              testID="set-sheet-rir-none"
            >
              <Text style={[styles.kindChipText, set.rir == null && styles.kindChipTextOn]}>
                {t('train.rirClear')}
              </Text>
            </TouchableOpacity>
            {RIR_CHOICES.map((v) => {
              const on = set.rir === v;
              return (
                <TouchableOpacity
                  key={v}
                  style={[styles.kindChip, on && styles.kindChipOn]}
                  onPress={() => {
                    haptics.tap();
                    // Still through the shared 0–5 clamp (@macrolog/core) so
                    // the two loggers cannot disagree about what is storable.
                    onRir(clampRir(v));
                  }}
                  testID={`set-sheet-rir-${v}`}
                >
                  <Text style={[styles.kindChipText, on && styles.kindChipTextOn]}>
                    {t(`train.rirScale.${v}` as I18nKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}

      <TouchableOpacity
        style={styles.moreRemove}
        onPress={() => {
          haptics.tap();
          onRemove();
        }}
        accessibilityRole="button"
        testID="set-sheet-remove"
      >
        <Text style={styles.moreRemoveText}>{t('train.removeSet')}</Text>
      </TouchableOpacity>
      <View style={styles.setSheetTail} />
    </BottomSheet>
  );
}
