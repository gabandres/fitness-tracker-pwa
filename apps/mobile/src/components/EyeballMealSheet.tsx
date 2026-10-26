import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { LogEntry } from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { SheetTextInput } from '@/components/SheetTextInput';
import { useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * "Eyeballed meal" (travel mode, 2026-10-26): a meal with no label, no scale
 * and no database entry — name it, size it by eye, log it. The sizes are the
 * owner's defaults (S ≈ 300 kcal / 20 g protein, M ≈ 550 / 35, L ≈ 850 / 45)
 * and every number stays editable on the entry. The row is stored with
 * `estimateQuality: 'eyeballed'` (and `proteinFirst` when the plate was built
 * from its protein), so the export and any later analysis can tell it apart
 * from a weighed meal. The maintenance fit never reads a travel day anyway.
 */
export const EYEBALL_SIZES = {
  S: { kcal: 300, protein: 20 },
  M: { kcal: 550, protein: 35 },
  L: { kcal: 850, protein: 45 },
} as const;
export type EyeballSize = keyof typeof EYEBALL_SIZES;

/** The entry an eyeballed meal saves as. Exported for the test. */
export function eyeballEntry(input: { name: string; kcal: number; protein: number; proteinFirst: boolean }): LogEntry {
  return {
    calories: Math.round(input.kcal),
    protein: Math.round(input.protein),
    ...(input.name.trim() ? { mealLabel: input.name.trim() } : {}),
    estimateQuality: 'eyeballed',
    ...(input.proteinFirst ? { proteinFirst: true } : {}),
  };
}

const parse = (v: string) => {
  const x = Number(v.replace(',', '.'));
  return Number.isFinite(x) ? x : NaN;
};

export function EyeballMealSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (entry: LogEntry) => Promise<unknown>;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [size, setSize] = useState<EyeballSize>('M');
  const [kcal, setKcal] = useState(String(EYEBALL_SIZES.M.kcal));
  const [protein, setProtein] = useState(String(EYEBALL_SIZES.M.protein));
  const [proteinFirst, setProteinFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const k = parse(kcal);
  const p = parse(protein);
  const valid = k >= 0 && k < 20000 && p >= 0 && p < 1000;

  function pick(s: EyeballSize) {
    haptics.selection();
    setSize(s);
    setKcal(String(EYEBALL_SIZES[s].kcal));
    setProtein(String(EYEBALL_SIZES[s].protein));
  }

  function reset() {
    setName('');
    pick('M');
    setProteinFirst(true);
    setFailed(false);
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSave(eyeballEntry({ name, kcal: k, protein: p, proteinFirst }));
      haptics.success();
      reset();
      onClose();
    } catch {
      setFailed(true);
      announce(t('travel.eyeball.saveErr'));
    }
    setBusy(false);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} native detents="fit" backdropTestID="eyeball-backdrop">
      <Text style={styles.title} accessibilityRole="header">{t('travel.eyeball.title')}</Text>
      <Text style={styles.hint}>{t('travel.eyeball.hint')}</Text>

      <SheetTextInput
        style={styles.input}
        placeholder={t('travel.eyeball.namePlaceholder')}
        placeholderTextColor={colors.faint}
        value={name}
        onChangeText={setName}
        maxLength={100}
        accessibilityLabel={t('travel.eyeball.name')}
        testID="eyeball-name"
      />

      <View style={styles.sizes} accessibilityRole="radiogroup">
        {(Object.keys(EYEBALL_SIZES) as EyeballSize[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.size, size === s && styles.sizeOn]}
            onPress={() => pick(s)}
            accessibilityRole="radio"
            accessibilityState={{ selected: size === s }}
            accessibilityLabel={t('travel.eyeball.sizeA11y', { size: s, kcal: EYEBALL_SIZES[s].kcal, protein: EYEBALL_SIZES[s].protein })}
            testID={`eyeball-size-${s}`}
          >
            <Text style={[styles.sizeLetter, size === s && styles.sizeLetterOn]}>{s}</Text>
            <Text style={[styles.sizeSub, size === s && styles.sizeLetterOn]}>
              {`${EYEBALL_SIZES[s].kcal} · ${EYEBALL_SIZES[s].protein} g`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.numbers}>
        <View style={styles.field}>
          <Text style={styles.label}>{t('travel.eyeball.kcal')}</Text>
          <SheetTextInput
            style={styles.input}
            keyboardType="number-pad"
            value={kcal}
            onChangeText={setKcal}
            selectTextOnFocus
            accessibilityLabel={t('travel.eyeball.kcal')}
            testID="eyeball-kcal"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{t('travel.eyeball.protein')}</Text>
          <SheetTextInput
            style={styles.input}
            keyboardType="number-pad"
            value={protein}
            onChangeText={setProtein}
            selectTextOnFocus
            accessibilityLabel={t('travel.eyeball.protein')}
            testID="eyeball-protein"
          />
        </View>
      </View>

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('travel.eyeball.proteinFirst')}</Text>
        <Switch
          value={proteinFirst}
          onValueChange={setProteinFirst}
          accessibilityLabel={t('travel.eyeball.proteinFirst')}
          testID="eyeball-protein-first"
        />
      </View>

      {failed ? (
        <Text style={styles.err} accessibilityRole="alert">{t('travel.eyeball.saveErr')}</Text>
      ) : null}

      <TouchableOpacity
        style={[styles.save, !valid && styles.saveDisabled]}
        onPress={save}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy, busy }}
        testID="eyeball-save"
      >
        {busy ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.saveText}>{t('travel.eyeball.save')}</Text>}
      </TouchableOpacity>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
    hint: { fontSize: font.small, color: colors.muted, marginTop: space.xs, marginBottom: space.md },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      fontSize: font.body,
      color: colors.ink,
    },
    sizes: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    size: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: space.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      minHeight: TARGET,
      justifyContent: 'center',
    },
    sizeOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    sizeLetter: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
    sizeLetterOn: { color: colors.onInk },
    sizeSub: { fontSize: font.tiny, color: colors.muted },
    numbers: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
    field: { flex: 1, gap: space.xs },
    label: { fontSize: font.small, color: colors.muted },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, minHeight: TARGET },
    switchLabel: { fontSize: font.body, color: colors.ink, flex: 1 },
    err: { fontSize: font.small, color: colors.danger, marginTop: space.xs, textAlign: 'center' },
    save: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
      marginTop: space.lg,
      minHeight: 56,
      justifyContent: 'center',
    },
    saveDisabled: { opacity: 0.4 },
    saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  });
