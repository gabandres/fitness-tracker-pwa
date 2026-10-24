import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { RIR_MAX, RIR_MIN, clampRir } from '@macrolog/core';
import type { SetKind, WorkoutSet } from '@/lib/workout';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
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
/** A kind row's name and description beside its check. */
const KIND_ROW_LINE = { flexDirection: 'row', alignItems: 'center', gap: 8 } as const;

export function SetRowSheet({
  visible,
  set,
  label,
  onClose,
  onKind,
  onRir,
  onRemove,
  kinds,
  rirOnly = false,
}: {
  visible: boolean;
  /** The quick RIR picker (S-v2, 2026-10-24): opened by the tick on the LAST
   *  working set of a straight rir1/rir2 lift (core `lastSetRirRequired`).
   *  Only the 0–5 scale — no set kinds, no "No RIR", no Remove: this set's
   *  RIR is the one Finish will not complete without. */
  rirOnly?: boolean;
  set: WorkoutSet | null;
  /** The set kinds this lift can use — a straight lift gets Warm-up, Working
   *  and Drop, not the cluster vocabulary that pushed RIR and Remove below
   *  the detent (L9). The set's own kind is always shown. Absent: all. */
  kinds?: readonly SetKind[];
  /** The row label — "2" for a straight set, "2a/2b/2c" for a cluster. */
  label: string;
  onClose: () => void;
  onKind: (kind: SetKind) => void;
  onRir: (rir: number | undefined) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  // RIR is meaningful on real working effort, not warmups/back-offs.
  // `continuation` carries it too: a rest-pause continuation is taken to
  // failure, so the reading is as meaningful there as on the activation.
  const showRir = rirOnly
    || set?.kind === 'working' || set?.kind === 'activation'
    || set?.kind === 'mini' || set?.kind === 'continuation';

  // The sheet is ALWAYS rendered, and only its content depends on `set`: a
  // native sheet is dismissed by its owner's `visible` turning false, and an
  // owner that returned null instead (the old `if (!set) return null`, hit
  // the moment a removed set left the index empty) would leave the system
  // sheet up and blank. One instance for the whole session now (Train review
  // item 31), native, sized to its rows.
  // Up to seven set kinds, the RIR chips and Remove scroll at most text sizes, so a height detent with room to expand suits them better than sizing to content.
  return (
    <BottomSheet native detents={[0.75, 1]} visible={visible && set != null} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      {set ? (
      <>
      {/* `BottomSheet` CLAMPS height and does not scroll — every other sheet
          in Train supplies its own ScrollView and this one has to as well.
          Seven set-kind rows (each a name plus a description), the RIR
          explainer, eight chips and a remove row do not fit in 80% of a
          720dp screen, and without this the RIR half and Remove sit below
          the fold with nothing able to reach them. Exactly the failure
          `BottomSheet`'s own `flexShrink` comment documents. */}
      {/* A visible way out (v3 QA item 6). Every choice here applies on
          tap, so it is Done. Outside the scroll, so it never leaves. */}
      <SheetHeader
        title={rirOnly ? t('train.rirRequiredTitle', { n: label }) : t('train.setSheetTitle', { n: label })}
        trailing={{ label: t('common.done'), onPress: onClose, testID: 'set-sheet-done' }}
      />
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

      {rirOnly ? null : (
      <>
      <Text style={styles.fieldLabel}>{t('train.setType')}</Text>
      {/* Rows, not a chip wrap: "Activation" and "Mini" are cluster-training
          vocabulary, and a bare chip label teaches nobody what they are. */}
      <View accessibilityRole="radiogroup">
      {SET_KINDS.filter((k) => !kinds || kinds.includes(k.value) || k.value === set.kind).map((k) => {
        const on = set.kind === k.value;
        return (
          <Touchable
            key={k.value}
            style={[styles.kindRow, on && styles.kindRowOn]}
            onPress={() => {
              haptics.tap();
              onKind(k.value);
            }}
            // A choice of one, with the current one said as selected — they
            // were unlabelled buttons (Train review item 18).
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            testID={`set-sheet-kind-${k.value}`}
          >
            {/* A check on the chosen kind, not colour and a faint fill alone
                (L-N13, R16/R18). The radio state already says it aloud. */}
            <View style={KIND_ROW_LINE}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.kindRowName, on && styles.kindRowNameOn]}>{t(k.labelKey)}</Text>
                <Text style={styles.kindRowDesc}>{t(k.descKey)}</Text>
              </View>
              {on ? (
                <Ionicons
                  name="checkmark"
                  size={20}
                  color={colors.ink}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  testID={`set-sheet-kind-${k.value}-check`}
                />
              ) : null}
            </View>
          </Touchable>
        );
      })}
      </View>
      </>
      )}

      {showRir ? (
        <>
          <Text style={[styles.fieldLabel, rirOnly ? null : styles.setSheetGap]}>{t('train.rirPrompt')}</Text>
          {/* The acronym expanded once, where it is being answered — the
              glossary button in the header should not be the only place the
              tab explains its own vocabulary. */}
          <Text style={styles.sheetHint}>{t('train.rirExplain')}</Text>
          {rirOnly ? <Text style={styles.sheetHint}>{t('train.rirRequiredHint')}</Text> : null}
          <View style={styles.kindChips} accessibilityRole="radiogroup">
            {rirOnly ? null : (
            <Touchable
              style={[styles.kindChip, set.rir == null && styles.kindChipOn]}
              onPress={() => {
                haptics.tap();
                onRir(undefined);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: set.rir == null, checked: set.rir == null }}
              testID="set-sheet-rir-none"
            >
              <Text style={[styles.kindChipText, set.rir == null && styles.kindChipTextOn]}>
                {t('train.rirClear')}
              </Text>
            </Touchable>
            )}
            {RIR_CHOICES.map((v) => {
              const on = set.rir === v;
              return (
                <Touchable
                  key={v}
                  style={[styles.kindChip, on && styles.kindChipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, checked: on }}
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
                </Touchable>
              );
            })}
          </View>
        </>
      ) : null}

      {rirOnly ? null : (
      <Touchable
        style={styles.moreRemove}
        onPress={() => {
          haptics.tap();
          onRemove();
        }}
        accessibilityRole="button"
        testID="set-sheet-remove"
      >
        <Text style={styles.moreRemoveText}>{t('train.removeSet')}</Text>
      </Touchable>
      )}
      <View style={styles.setSheetTail} />
      </ScrollView>
      </>
      ) : null}
    </BottomSheet>
  );
}
