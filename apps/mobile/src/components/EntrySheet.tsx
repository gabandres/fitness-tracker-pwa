import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  MEAL_TYPES,
  type DailyLog,
  type LogEntry,
  type MealPreset,
  type MealType,
} from '@macrolog/core';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { FoodSearch } from '@/components/FoodSearch';
import { RecipeBuilder } from '@/components/RecipeBuilder';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

interface Props {
  visible: boolean;
  /** The row being edited, or null when adding. */
  editing: DailyLog | null;
  onSave: (entry: LogEntry) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onClose: () => void;
  /** Quick-add data + handlers. Only surfaced when adding (not editing). */
  presets?: MealPreset[];
  recentEntries?: DailyLog[];
  onSavePreset?: (preset: Omit<MealPreset, 'id'>) => Promise<void> | void;
  onDeletePreset?: (id: string) => Promise<void> | void;
  onHideRecent?: (label: string) => Promise<void> | void;
  /** Portion-display preference for the food-search serving sort. */
  unitSystem?: 'us' | 'metric';
}

/** Keep numeric fields as raw strings so partial input ("12.", "1.5")
 *  binds cleanly; parse only on save (see the decimal-input gotcha). */
function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

const SHEET_OFFSCREEN = Dimensions.get('window').height;

export function EntrySheet({
  visible,
  editing,
  onSave,
  onDelete,
  onClose,
  presets = [],
  recentEntries = [],
  onSavePreset,
  onDeletePreset,
  onHideRecent,
  unitSystem = 'us',
}: Props) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [mealType, setMealType] = useState<MealType | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  // 'manual' is the form; 'search' swaps in the food-database panel. Only
  // reachable when adding (editing always stays on the manual form).
  const [mode, setMode] = useState<'manual' | 'search' | 'recipe'>('manual');
  const [scannerOpen, setScannerOpen] = useState(false);

  // Keep the Modal mounted through the exit animation. `anim` drives both the
  // backdrop fade and the sheet's translateY (0 = hidden, 1 = shown), so the
  // dim stays full-screen and static while only the sheet slides up.
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setLabel(editing?.mealLabel ?? '');
    setCalories(editing?.calories != null ? String(editing.calories) : '');
    setProtein(editing?.protein != null ? String(editing.protein) : '');
    setCarbs(editing?.carbs != null ? String(editing.carbs) : '');
    setFat(editing?.fat != null ? String(editing.fat) : '');
    setMealType(editing?.mealType);
    setBusy(false);
    setManage(false);
    setMode('manual');
  }, [visible, editing]);

  /** Prefill the form from a quick-add chip (preset or recent meal). The
   *  user lands on a populated manual form so they can tweak before saving,
   *  matching the PWA's "bounce to manual segment" behavior. */
  function prefill(src: { calories: number; protein?: number; carbs?: number; fat?: number; mealLabel?: string }) {
    haptics.tap();
    setLabel(src.mealLabel ?? '');
    setCalories(String(src.calories));
    setProtein(src.protein != null ? String(src.protein) : '');
    setCarbs(src.carbs != null ? String(src.carbs) : '');
    setFat(src.fat != null ? String(src.fat) : '');
  }

  const showQuickAdd = !editing && (presets.length > 0 || recentEntries.length > 0);
  const canSavePreset =
    !editing && onSavePreset != null && label.trim().length > 0 && numOrUndef(calories) != null;

  async function saveAsPreset() {
    const cal = numOrUndef(calories);
    if (!onSavePreset || !label.trim() || cal == null) return;
    haptics.tap();
    await onSavePreset({
      name: label.trim(),
      calories: cal,
      protein: numOrUndef(protein),
      carbs: numOrUndef(carbs),
      fat: numOrUndef(fat),
    });
  }

  // Memoize the animated nodes + style objects so they keep a stable identity
  // across the re-renders that every keystroke triggers. Recreating the
  // interpolation / style object each render makes Animated re-process the
  // native node per character, which stutters typing.
  const backdropStyle = useMemo(() => [styles.backdrop, { opacity: anim }], [anim]);
  const sheetStyle = useMemo(
    () => [
      styles.sheet,
      {
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [SHEET_OFFSCREEN, 0],
            }),
          },
        ],
      },
    ],
    [anim],
  );

  const calNum = numOrUndef(calories);
  const canSave = calNum != null && calNum > 0;

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    const entry: LogEntry = {
      calories: calNum!,
      protein: numOrUndef(protein),
      carbs: numOrUndef(carbs),
      fat: numOrUndef(fat),
      mealLabel: label.trim() || undefined,
      mealType,
      // Preserve the original time when editing; new entries default to now.
      timestamp: editing?.date,
    };
    try {
      await onSave(entry);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={onClose}>
      <Animated.View style={backdropStyle}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <Animated.View style={sheetStyle}>
          <View style={styles.handle} />
          <Text style={styles.title}>{editing ? t('entry.editTitle') : t('entry.addTitle')}</Text>

          {!editing && mode === 'manual' ? (
            <>
              <View style={styles.discoverRow}>
                <TouchableOpacity style={styles.searchEntry} onPress={() => { haptics.tap(); setMode('search'); }} testID="open-food-search">
                  <Text style={styles.searchEntryText}>{t('entry.searchDb')}</Text>
                </TouchableOpacity>
                {Platform.OS !== 'web' ? (
                  <TouchableOpacity style={styles.scanEntry} onPress={() => { haptics.tap(); setScannerOpen(true); }} testID="open-barcode">
                    <Text style={styles.searchEntryText}>{t('entry.scan')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity style={styles.recipeEntry} onPress={() => { haptics.tap(); setMode('recipe'); }} testID="open-recipe">
                <Text style={styles.searchEntryText}>{t('entry.buildRecipe')}</Text>
              </TouchableOpacity>
            </>
          ) : null}

          {mode === 'search' ? (
            <FoodSearch
              unitSystem={unitSystem}
              onCancel={() => setMode('manual')}
              onPick={(est) => {
                prefill({
                  calories: est.calories,
                  protein: est.protein,
                  carbs: est.carbs,
                  fat: est.fat,
                  mealLabel: est.mealLabel,
                });
                setMode('manual');
              }}
            />
          ) : mode === 'recipe' ? (
            <RecipeBuilder
              onCancel={() => setMode('manual')}
              onApply={(est) => {
                prefill({
                  calories: est.calories,
                  protein: est.protein,
                  mealLabel: est.mealLabel,
                });
                setMode('manual');
              }}
            />
          ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            {showQuickAdd ? (
              <View style={styles.quickAdd}>
                <View style={styles.quickHeader}>
                  <Text style={styles.fieldLabel}>{t('entry.quickAdd')}</Text>
                  {presets.length > 0 && (onDeletePreset || onHideRecent) ? (
                    <TouchableOpacity onPress={() => setManage((m) => !m)} hitSlop={8}>
                      <Text style={[styles.manageText, manage && styles.manageTextOn]}>
                        {manage ? t('common.done') : t('common.manage')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View style={styles.chips}>
                  {presets.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.qChip, manage && styles.qChipManage]}
                      onPress={() =>
                        manage
                          ? p.id && onDeletePreset?.(p.id)
                          : prefill({ calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, mealLabel: p.name })
                      }
                    >
                      {manage ? <Text style={styles.qChipX}>✕</Text> : null}
                      <Text style={[styles.qChipText, manage && styles.qChipTextManage]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.qChipKcal}>{p.calories}</Text>
                    </TouchableOpacity>
                  ))}
                  {recentEntries.map((r) => (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.qChip, styles.qChipRecent, manage && styles.qChipManage]}
                      onPress={() =>
                        manage
                          ? r.mealLabel && onHideRecent?.(r.mealLabel)
                          : prefill(r)
                      }
                    >
                      {manage ? <Text style={styles.qChipX}>✕</Text> : null}
                      <Text style={[styles.qChipText, manage && styles.qChipTextManage]} numberOfLines={1}>
                        {r.mealLabel}
                      </Text>
                      <Text style={styles.qChipKcal}>{r.calories}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <Field label={t('entry.name')}>
              <TextInput
                style={styles.input}
                placeholder={t('entry.namePlaceholder')}
                placeholderTextColor={colors.faint}
                value={label}
                onChangeText={setLabel}
                testID="entry-label"
              />
            </Field>

            <Field label={t('entry.calories')}>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={calories}
                onChangeText={setCalories}
                testID="entry-calories"
              />
            </Field>

            <View style={styles.row}>
              <Field label={t('entry.proteinG')} style={styles.third}>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={colors.faint} keyboardType="numeric" value={protein} onChangeText={setProtein} testID="entry-protein" />
              </Field>
              <Field label={t('entry.carbsG')} style={styles.third}>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={colors.faint} keyboardType="numeric" value={carbs} onChangeText={setCarbs} testID="entry-carbs" />
              </Field>
              <Field label={t('entry.fatG')} style={styles.third}>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={colors.faint} keyboardType="numeric" value={fat} onChangeText={setFat} testID="entry-fat" />
              </Field>
            </View>

            <Field label={t('entry.meal')}>
              <View style={styles.chips}>
                {MEAL_TYPES.map((mt) => {
                  const on = mealType === mt;
                  return (
                    <TouchableOpacity
                      key={mt}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setMealType(on ? undefined : mt)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`meal.${mt}`)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Field>

            {canSavePreset ? (
              <TouchableOpacity style={styles.savePreset} onPress={saveAsPreset} testID="save-preset">
                <Text style={styles.savePresetText}>{t('entry.savePreset')}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
          )}

          {mode === 'manual' ? (
            <View style={styles.actions}>
              {editing && onDelete ? (
                <TouchableOpacity style={styles.delete} onPress={onDelete} testID="entry-delete">
                  <Text style={styles.deleteText}>{t('entry.delete')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.save, !canSave && styles.saveDisabled]}
                onPress={save}
                disabled={!canSave || busy}
                testID="entry-save"
              >
                <Text style={styles.saveText}>{editing ? t('common.save') : t('entry.add')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>

      {scannerOpen ? (
        <BarcodeScanner
          visible={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onPick={(est) => {
            setScannerOpen(false);
            prefill({
              calories: est.calories,
              protein: est.protein,
              carbs: est.carbs,
              fat: est.fat,
              mealLabel: est.mealLabel,
            });
          }}
        />
      ) : null}
    </Modal>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    paddingTop: space.md,
    maxHeight: '88%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.md },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.md },
  form: { gap: space.md, paddingBottom: space.md },
  quickAdd: { gap: space.xs },
  quickHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  manageText: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  manageTextOn: { color: colors.danger },
  qChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.white,
    maxWidth: '100%',
  },
  qChipRecent: { borderStyle: 'dashed' },
  qChipManage: { borderColor: colors.danger },
  qChipX: { fontSize: font.small, color: colors.danger, fontWeight: '700' },
  qChipText: { fontSize: font.small, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  qChipTextManage: { color: colors.danger },
  qChipKcal: { fontSize: font.tiny, color: colors.muted },
  savePreset: { alignSelf: 'flex-start', paddingVertical: space.xs },
  savePresetText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  discoverRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  searchEntry: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  scanEntry: {
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  recipeEntry: {
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginBottom: space.md,
    backgroundColor: colors.white,
  },
  searchEntryText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  row: { flexDirection: 'row', gap: space.sm },
  third: { flex: 1 },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: font.small, color: colors.muted, textTransform: 'capitalize' },
  chipTextOn: { color: colors.white },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.md, alignItems: 'center' },
  delete: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  save: {
    flex: 1,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
});
