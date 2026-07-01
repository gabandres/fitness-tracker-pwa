import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
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
import { useLocale, useT } from '@/i18n';
import { starterFoods } from '@/lib/starterFoods';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

interface Props {
  visible: boolean;
  /** The row being edited, or null when adding. */
  editing: DailyLog | null;
  onSave: (entry: LogEntry) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onClose: () => void;
  presets?: MealPreset[];
  recentEntries?: DailyLog[];
  onSavePreset?: (preset: Omit<MealPreset, 'id'>) => Promise<void> | void;
  onDeletePreset?: (id: string) => Promise<void> | void;
  onHideRecent?: (label: string) => Promise<void> | void;
  /** Portion-display preference for the food-search serving sort. */
  unitSystem?: 'us' | 'metric';
  /** When set (and NOT editing), a new/relogged entry is stamped to local
   *  noon on this YYYY-MM-DD instead of "now" — for adding food to a past
   *  day from the day-detail screen. */
  dateKey?: string;
}

/** Local noon on a YYYY-MM-DD. Noon (not midnight) so a backdated entry can't
 *  bleed into the previous day under a negative UTC offset — matches the CSV
 *  import default. */
function noonOf(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
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

/** Search-first add-food sheet, on a plain RN <Modal> (animationType "slide"
 *  is OS-driven, so it doesn't stutter while typing — unlike the old custom
 *  Animated translateY). Adding opens on a BROWSE view (search + recents +
 *  scan/recipe icons); the manual macro form is a secondary CUSTOM mode
 *  (also used when editing). Search portion / recipe / barcode prefill CUSTOM
 *  for review. Recents/presets are one-tap relog. */
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
  dateKey,
}: Props) {
  const t = useT();
  const locale = useLocale();
  // Which date a saved/relogged entry lands on: the edited row's own date,
  // else local noon on `dateKey` (past-day add), else undefined ("now").
  const forDate = editing?.date ?? (dateKey ? noonOf(dateKey) : undefined);
  const [label, setLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [mealType, setMealType] = useState<MealType | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [mode, setMode] = useState<'browse' | 'custom' | 'recipe'>('browse');
  const [scannerOpen, setScannerOpen] = useState(false);

  // Keep the Modal mounted through the exit animation. `anim` (0 = hidden,
  // 1 = shown) drives the backdrop opacity (fades IN PLACE, full-screen) and
  // the sheet's translateY (slides up) independently — so the dim doesn't drag
  // up with the sheet the way Modal's built-in `animationType="slide"` does.
  // Native driver → the slide stays smooth even while typing.
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  // Track the keyboard height so the sheet's WHITE stays pinned to the screen
  // bottom (fills behind the keyboard) while only the CONTENT lifts above it —
  // no grey "cutout" between the sheet and the keyboard (the artifact a
  // KeyboardAvoidingView wrapper produced by floating the whole sheet up).
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useMemo(() => [styles.backdrop, { opacity: anim }], [anim]);
  const sheetStyle = useMemo(
    () => [
      styles.sheet,
      { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_OFFSCREEN, 0] }) }] },
    ],
    [anim],
  );

  // Reset form + mode whenever the sheet (re)opens.
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
    setMode(editing ? 'custom' : 'browse');
  }, [visible, editing]);

  /** Prefill the manual form from an estimate (search portion, recipe,
   *  barcode) and move to CUSTOM for review before saving. */
  const prefill = useCallback(
    (src: { calories: number; protein?: number; carbs?: number; fat?: number; mealLabel?: string }) => {
      haptics.tap();
      setLabel(src.mealLabel ?? '');
      setCalories(String(src.calories));
      setProtein(src.protein != null ? String(src.protein) : '');
      setCarbs(src.carbs != null ? String(src.carbs) : '');
      setFat(src.fat != null ? String(src.fat) : '');
      setMealType(undefined);
      setMode('custom');
    },
    [],
  );

  /** One-tap relog: log a known entry (recent / preset) and close. On a past
   *  day, restamp it to that day rather than keeping the source's date. */
  function quickLog(entry: LogEntry) {
    haptics.success();
    void onSave(forDate ? { ...entry, timestamp: forDate } : entry);
    onClose();
  }

  const calNum = numOrUndef(calories);
  const canSave = calNum != null && calNum > 0;
  const canSavePreset = onSavePreset != null && label.trim().length > 0 && calNum != null;

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
      timestamp: forDate,
    };
    try {
      await onSave(entry);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function saveAsPreset() {
    if (!onSavePreset || !label.trim() || calNum == null) return;
    haptics.tap();
    await onSavePreset({
      name: label.trim(),
      calories: calNum,
      protein: numOrUndef(protein),
      carbs: numOrUndef(carbs),
      fat: numOrUndef(fat),
    });
  }

  function openCustomBlank() {
    haptics.tap();
    setLabel('');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setMealType(undefined);
    setMode('custom');
  }

  // ── Browse empty-state: recents + presets + custom-food link ──
  const browseEmpty = (
    <View style={styles.browse}>
      {recentEntries.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel}>{t('entry.recent')}</Text>
            {onHideRecent ? (
              <TouchableOpacity onPress={() => setManage((m) => !m)} hitSlop={8}>
                <Text style={[styles.manageText, manage && styles.manageOn]}>
                  {manage ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {recentEntries.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.row}
              testID={`recent-${r.id}`}
              onPress={() =>
                manage
                  ? r.mealLabel && onHideRecent?.(r.mealLabel)
                  : quickLog({ calories: r.calories, protein: r.protein ?? undefined, mealLabel: r.mealLabel ?? undefined })
              }
            >
              <Text style={styles.rowName} numberOfLines={1}>{r.mealLabel}</Text>
              {manage ? <Text style={styles.rowRemove}>✕</Text> : <Text style={styles.rowKcal}>{r.calories}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {presets.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel}>{t('entry.quickAdd')}</Text>
            {onDeletePreset ? (
              <TouchableOpacity onPress={() => setManage((m) => !m)} hitSlop={8}>
                <Text style={[styles.manageText, manage && styles.manageOn]}>
                  {manage ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {presets.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.row}
              testID={`preset-${p.id}`}
              onPress={() =>
                manage
                  ? p.id && onDeletePreset?.(p.id)
                  : quickLog({ calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, mealLabel: p.name })
              }
            >
              <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
              {manage ? <Text style={styles.rowRemove}>✕</Text> : <Text style={styles.rowKcal}>{p.calories}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {recentEntries.length === 0 && presets.length === 0 ? (
        <View style={styles.group}>
          <Text style={styles.groupLabel}>{t('entry.suggested')}</Text>
          <View style={styles.starterWrap}>
            {starterFoods(locale).map((f) => (
              <TouchableOpacity
                key={f.label}
                style={styles.starterChip}
                testID={`starter-${f.label}`}
                onPress={() => prefill({ calories: f.calories, protein: f.protein, mealLabel: f.label })}
              >
                <Text style={styles.starterLabel} numberOfLines={1}>{f.label}</Text>
                <Text style={styles.starterKcal}>{f.calories}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <TouchableOpacity style={styles.customLink} testID="create-custom" onPress={openCustomBlank}>
        <Ionicons name="create-outline" size={18} color={colors.accent} />
        <Text style={styles.customLinkText}>{t('entry.customFood')}</Text>
      </TouchableOpacity>
    </View>
  );

  const headerIcons = (
    <View style={styles.iconRow}>
      {Platform.OS !== 'web' ? (
        <TouchableOpacity style={styles.iconBtn} onPress={() => { haptics.tap(); setScannerOpen(true); }} testID="open-barcode">
          <Ionicons name="barcode-outline" size={22} color={colors.ink} />
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={styles.iconBtn} onPress={() => { haptics.tap(); setMode('recipe'); }} testID="open-recipe">
        <Ionicons name="calculator-outline" size={22} color={colors.ink} />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={backdropStyle}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID="entry-backdrop" />
      </Animated.View>
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <Animated.View style={[sheetStyle, { paddingBottom: kbHeight > 0 ? kbHeight + space.sm : space.xxl }]}>
          <View style={styles.handle} />

            {mode === 'browse' ? (
              <FoodSearch
                unitSystem={unitSystem}
                headerRight={headerIcons}
                emptyContent={browseEmpty}
                onPick={(est) => prefill(est)}
              />
            ) : mode === 'recipe' ? (
              <RecipeBuilder onCancel={() => setMode('browse')} onApply={(est) => prefill(est)} />
            ) : (
              <View style={styles.customWrap}>
                <View style={styles.customHead}>
                  {!editing ? (
                    <TouchableOpacity onPress={() => setMode('browse')} hitSlop={8} testID="custom-back">
                      <Ionicons name="chevron-back" size={22} color={colors.ink} />
                    </TouchableOpacity>
                  ) : (
                    <View style={{ width: 22 }} />
                  )}
                  <Text style={styles.title}>{editing ? t('entry.editTitle') : t('entry.addTitle')}</Text>
                  <View style={{ width: 22 }} />
                </View>

                <View style={styles.form}>
                  <Field label={t('entry.name')}>
                    <TextInputBase placeholder={t('entry.namePlaceholder')} value={label} onChangeText={setLabel} testID="entry-label" />
                  </Field>

                  <Field label={t('entry.calories')}>
                    <TextInputBase placeholder="0" keyboardType="numeric" value={calories} onChangeText={setCalories} testID="entry-calories" />
                  </Field>

                  <View style={styles.row3}>
                    <Field label={t('entry.proteinG')} style={styles.third}>
                      <TextInputBase placeholder="0" keyboardType="numeric" value={protein} onChangeText={setProtein} testID="entry-protein" />
                    </Field>
                    <Field label={t('entry.carbsG')} style={styles.third}>
                      <TextInputBase placeholder="0" keyboardType="numeric" value={carbs} onChangeText={setCarbs} testID="entry-carbs" />
                    </Field>
                    <Field label={t('entry.fatG')} style={styles.third}>
                      <TextInputBase placeholder="0" keyboardType="numeric" value={fat} onChangeText={setFat} testID="entry-fat" />
                    </Field>
                  </View>

                  <Field label={t('entry.meal')}>
                    <View style={styles.chips}>
                      {MEAL_TYPES.map((mt) => {
                        const on = mealType === mt;
                        return (
                          <TouchableOpacity key={mt} style={[styles.chip, on && styles.chipOn]} onPress={() => setMealType(on ? undefined : mt)}>
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
                </View>

                <View style={styles.actions}>
                  {editing && onDelete ? (
                    <TouchableOpacity style={styles.delete} onPress={onDelete} testID="entry-delete">
                      <Text style={styles.deleteText}>{t('entry.delete')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={[styles.save, !canSave && styles.saveDisabled]} onPress={save} disabled={!canSave || busy} testID="entry-save">
                    <Text style={styles.saveText}>{editing ? t('common.save') : t('entry.add')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Animated.View>
        </View>

      {scannerOpen ? (
        <BarcodeScanner
          visible={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onPick={(est) => {
            setScannerOpen(false);
            prefill({ calories: est.calories, protein: est.protein, carbs: est.carbs, fat: est.fat, mealLabel: est.mealLabel });
          }}
        />
      ) : null}
    </Modal>
  );
}

/** Plain text input styled to the sheet — shared look for the custom form. */
function TextInputBase(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput style={styles.input} placeholderTextColor={colors.faint} {...props} />;
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
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    maxHeight: '94%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.sm },
  // browse
  browse: { gap: space.lg, paddingTop: space.sm },
  group: { gap: space.xs },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  manageText: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  manageOn: { color: colors.danger },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowName: { fontSize: font.body, color: colors.ink, fontWeight: '600', flex: 1, marginRight: space.md },
  rowKcal: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  rowRemove: { fontSize: font.body, color: colors.danger, fontWeight: '700' },
  customLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  customLinkText: { fontSize: font.body, color: colors.accent, fontWeight: '700' },
  starterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  starterChip: {
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
  starterLabel: { fontSize: font.small, color: colors.ink, fontWeight: '600', flexShrink: 1 },
  starterKcal: { fontSize: font.tiny, color: colors.muted },
  iconRow: { flexDirection: 'row', gap: space.xs },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  // custom
  customWrap: { flexShrink: 1 },
  customHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  form: { gap: space.md, paddingBottom: space.md },
  row3: { flexDirection: 'row', gap: space.sm },
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
  savePreset: { alignSelf: 'flex-start', paddingVertical: space.xs },
  savePresetText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.md, alignItems: 'center' },
  delete: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  save: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
});
