import { useEffect, useState } from 'react';
import {
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
import { MEAL_TYPES, type DailyLog, type LogEntry, type MealType } from '@macrolog/core';
import { colors, font, radius, space } from '@/theme';

interface Props {
  visible: boolean;
  /** The row being edited, or null when adding. */
  editing: DailyLog | null;
  onSave: (entry: LogEntry) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onClose: () => void;
}

/** Keep numeric fields as raw strings so partial input ("12.", "1.5")
 *  binds cleanly; parse only on save (see the decimal-input gotcha). */
function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function EntrySheet({ visible, editing, onSave, onDelete, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [mealType, setMealType] = useState<MealType | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(editing?.mealLabel ?? '');
    setCalories(editing?.calories != null ? String(editing.calories) : '');
    setProtein(editing?.protein != null ? String(editing.protein) : '');
    setCarbs(editing?.carbs != null ? String(editing.carbs) : '');
    setFat(editing?.fat != null ? String(editing.fat) : '');
    setMealType(editing?.mealType);
    setBusy(false);
  }, [visible, editing]);

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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetWrap}
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{editing ? 'Edit entry' : 'Add food'}</Text>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <Field label="Name (optional)">
              <TextInput
                style={styles.input}
                placeholder="e.g. Chicken & rice"
                placeholderTextColor={colors.faint}
                value={label}
                onChangeText={setLabel}
                testID="entry-label"
              />
            </Field>

            <Field label="Calories">
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
              <Field label="Protein (g)" style={styles.third}>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={colors.faint} keyboardType="numeric" value={protein} onChangeText={setProtein} testID="entry-protein" />
              </Field>
              <Field label="Carbs (g)" style={styles.third}>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={colors.faint} keyboardType="numeric" value={carbs} onChangeText={setCarbs} testID="entry-carbs" />
              </Field>
              <Field label="Fat (g)" style={styles.third}>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={colors.faint} keyboardType="numeric" value={fat} onChangeText={setFat} testID="entry-fat" />
              </Field>
            </View>

            <Field label="Meal (optional)">
              <View style={styles.chips}>
                {MEAL_TYPES.map((mt) => {
                  const on = mealType === mt;
                  return (
                    <TouchableOpacity
                      key={mt}
                      style={[styles.chip, on && styles.chipOn]}
                      onPress={() => setMealType(on ? undefined : mt)}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{mt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Field>
          </ScrollView>

          <View style={styles.actions}>
            {editing && onDelete ? (
              <TouchableOpacity style={styles.delete} onPress={onDelete} testID="entry-delete">
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.save, !canSave && styles.saveDisabled]}
              onPress={save}
              disabled={!canSave || busy}
              testID="entry-save"
            >
              <Text style={styles.saveText}>{editing ? 'Save' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
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
