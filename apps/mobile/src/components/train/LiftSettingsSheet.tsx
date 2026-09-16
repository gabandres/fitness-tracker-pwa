import { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { type Recommendation, formatLoad, repBandFrom } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { createStyles } from '@/components/train/train-styles';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type { EffortStandard, Exercise, ExercisePatch } from '@/lib/workout';

/**
 * Per-lift settings the progression engine reads off the catalog exercise
 * (ADR-0039): the effort standard of the activation set, and an optional
 * manual rep band. Both are catalog properties — a property of the lift, not
 * of the template row — so this writes through `editCatalogExercise`.
 *
 * The band field takes ONE number, the add-load mark; the hold band is the
 * two reps under it (`repBandFrom`), the same shape the engine derives. An
 * empty field means automatic, and clearing a saved override sends
 * `targetRepBand: null` so the doc field is deleted rather than left behind.
 */
export function LiftSettingsSheet({
  visible,
  exercise,
  rec,
  onClose,
  onSave,
}: {
  visible: boolean;
  exercise: Exercise | null;
  /** The current recommendation, for the "automatic" line's numbers. */
  rec: Recommendation | null;
  onClose: () => void;
  onSave: (patch: ExercisePatch) => Promise<void>;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [standard, setStandard] = useState<EffortStandard>('failure');
  const [bandText, setBandText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStandard(exercise?.effortStandard ?? 'failure');
    setBandText(exercise?.targetRepBand ? String(exercise.targetRepBand.addLoadAt) : '');
    setSaving(false);
  }, [visible, exercise]);

  const cal = rec?.calibration;
  const typed = Number.parseInt(bandText, 10);
  const override = Number.isInteger(typed) && typed >= 1 && typed <= 100 ? repBandFrom(typed) : null;
  const hadOverride = exercise?.targetRepBand != null;

  // What "automatic" would mean right now, from the engine's own state.
  let autoLine: string;
  if (cal?.band && cal.source === 'derived') {
    autoLine = t('train.lift.bandDerived', {
      n: cal.validSessions,
      load: cal.load != null ? formatLoad(cal.load, unitSystem) : 'BW',
      lo: cal.band.holdLo, hi: cal.band.holdHi, at: cal.band.addLoadAt,
    });
  } else {
    autoLine = t('train.lift.bandCalibrating', { n: cal?.validSessions ?? 0, needed: cal?.needed ?? 3 });
  }

  async function save() {
    if (!exercise?.id) return;
    haptics.tap();
    setSaving(true);
    const patch: ExercisePatch = { effortStandard: standard };
    if (override) patch.targetRepBand = override;
    else if (hadOverride) patch.targetRepBand = null;
    try {
      await onSave(patch);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <Text style={styles.sheetTitle}>{t('train.lift.title')}</Text>
      {exercise ? <Text style={styles.sheetHint}>{exercise.name}</Text> : null}

      <View style={styles.liftSection}>
        <Text style={styles.liftLabel}>{t('train.lift.effort')}</Text>
        <View style={[styles.styleRow, { marginTop: 0 }]}>
          {(['failure', 'rir1'] as const).map((s) => {
            const on = standard === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.styleChip, on && styles.styleChipOn]}
                onPress={() => setStandard(s)}
                testID={`lift-effort-${s}`}
              >
                <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>
                  {t(s === 'failure' ? 'train.lift.effortFailure' : 'train.lift.effortRir1')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.liftHint}>{t('train.lift.effortHint')}</Text>
      </View>

      <View style={styles.liftSection}>
        <Text style={styles.liftLabel}>{t('train.lift.band')}</Text>
        <Text style={styles.liftHint} testID="lift-band-auto">
          {override
            ? t('train.lift.bandOverride', { at: override.addLoadAt, lo: override.holdLo, hi: override.holdHi })
            : autoLine}
        </Text>
        <View style={styles.liftBandRow}>
          <Text style={styles.liftBandUnit}>{t('train.lift.bandField')}</Text>
          <TextInput
            style={[styles.input, styles.liftBandInput]}
            keyboardType="number-pad"
            placeholder="—"
            placeholderTextColor={colors.faint}
            value={bandText}
            onChangeText={(v) => setBandText(v.replace(/[^\d]/g, ''))}
            maxLength={3}
            testID="lift-band-input"
          />
          <Text style={styles.liftBandUnit}>{t('train.lift.bandReps')}</Text>
        </View>
        <Text style={styles.liftHint}>{t('train.lift.bandHint')}</Text>
        {bandText ? (
          <TouchableOpacity style={styles.liftClear} onPress={() => setBandText('')} testID="lift-band-clear">
            <Text style={styles.liftClearText}>{t('train.lift.bandClear')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.finishBtn, saving && styles.btnDisabled]}
        onPress={save}
        disabled={saving || !exercise?.id}
        testID="lift-save"
      >
        <Text style={styles.finishText}>{t('train.lift.save')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}
