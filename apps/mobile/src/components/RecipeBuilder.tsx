import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

export interface RecipeEstimate {
  calories: number;
  protein?: number;
  mealLabel: string;
}

interface Props {
  onApply: (estimate: RecipeEstimate) => void;
  onCancel: () => void;
}

interface Ingredient {
  name: string;
  calories: string;
  protein: string;
}

function num(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Stateless recipe calculator (mirrors the PWA recipe-builder): list
 *  ingredients (kcal + optional protein) and a serving count, then emit one
 *  serving's totals to prefill the manual form. Not persisted — "save as
 *  preset" on the prefilled form is the reuse path. */
export function RecipeBuilder({ onApply, onCancel }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [servings, setServings] = useState('1');
  const [ingredients, setIngredients] = useState<Ingredient[]>([
    { name: '', calories: '', protein: '' },
    { name: '', calories: '', protein: '' },
  ]);

  const totals = useMemo(() => {
    let kcal = 0;
    let protein = 0;
    let hasProtein = false;
    for (const ing of ingredients) {
      const c = num(ing.calories);
      if (c != null) kcal += c;
      const p = num(ing.protein);
      if (p != null) {
        hasProtein = true;
        protein += p;
      }
    }
    return { kcal, protein: hasProtein ? protein : null };
  }, [ingredients]);

  const servingCount = num(servings);
  const perServing = useMemo(() => {
    if (servingCount == null || servingCount <= 0) return { kcal: 0, protein: null as number | null };
    return {
      kcal: Math.round(totals.kcal / servingCount),
      protein: totals.protein != null ? Math.round(totals.protein / servingCount) : null,
    };
  }, [totals, servingCount]);

  const canApply = totals.kcal > 0 && servingCount != null && servingCount > 0;

  function setIng(idx: number, field: keyof Ingredient, value: string) {
    setIngredients((list) => list.map((ing, i) => (i === idx ? { ...ing, [field]: value } : ing)));
  }
  function addIng() {
    setIngredients((list) => [...list, { name: '', calories: '', protein: '' }]);
  }
  function removeIng(idx: number) {
    setIngredients((list) => (list.length <= 1 ? list : list.filter((_, i) => i !== idx)));
  }

  function apply() {
    if (!canApply) return;
    haptics.success();
    onApply({
      calories: perServing.kcal,
      protein: perServing.protein ?? undefined,
      mealLabel: name.trim(),
    });
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('recipe.title')}</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={8}>
          <Text style={styles.cancel}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        placeholder={t('recipe.namePlaceholder')}
        placeholderTextColor={colors.faint}
        value={name}
        onChangeText={setName}
        testID="recipe-name"
      />

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <View style={styles.colHead}>
          <Text style={[styles.colLabel, styles.colName]}>{t('recipe.ingredient')}</Text>
          <Text style={[styles.colLabel, styles.colNum]}>{t('recipe.kcal')}</Text>
          <Text style={[styles.colLabel, styles.colNum]}>{t('recipe.proteinShort')}</Text>
          <View style={styles.colDel} />
        </View>
        {ingredients.map((ing, i) => (
          <View key={i} style={styles.ingRow}>
            <TextInput
              style={[styles.input, styles.colName]}
              placeholder={t('recipe.ingredient')}
              placeholderTextColor={colors.faint}
              value={ing.name}
              onChangeText={(v) => setIng(i, 'name', v)}
              testID={`recipe-ing-name-${i}`}
            />
            <TextInput
              style={[styles.input, styles.colNum]}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={ing.calories}
              onChangeText={(v) => setIng(i, 'calories', v)}
              testID={`recipe-ing-kcal-${i}`}
            />
            <TextInput
              style={[styles.input, styles.colNum]}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={ing.protein}
              onChangeText={(v) => setIng(i, 'protein', v)}
            />
            <TouchableOpacity style={styles.colDel} onPress={() => removeIng(i)} hitSlop={6}>
              <Text style={styles.del}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.addIng} onPress={addIng} testID="recipe-add-ing">
          <Text style={styles.addIngText}>{t('recipe.addIngredient')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.servingsBox}>
          <Text style={styles.fieldLabel}>{t('recipe.servings')}</Text>
          <TextInput
            style={[styles.input, styles.servingsInput]}
            placeholder="1"
            placeholderTextColor={colors.faint}
            keyboardType="numeric"
            value={servings}
            onChangeText={setServings}
            testID="recipe-servings"
          />
        </View>
        <View style={styles.perServing}>
          <Text style={styles.fieldLabel}>{t('recipe.perServing')}</Text>
          <Text style={styles.perValue} testID="recipe-per-serving">
            {perServing.kcal} kcal{perServing.protein != null ? ` · ${perServing.protein}g` : ''}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.apply, !canApply && styles.applyDisabled]}
        onPress={apply}
        disabled={!canApply}
        testID="recipe-apply"
      >
        <Text style={styles.applyText}>{t('recipe.useThis')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 320, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.h3, color: colors.ink, fontWeight: '800' },
  cancel: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  scroll: { maxHeight: 280 },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  colLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  colName: { flex: 1 },
  colNum: { width: 56, textAlign: 'center' },
  colDel: { width: 24, alignItems: 'center' },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.ink,
  },
  del: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  addIng: { paddingVertical: space.sm },
  addIngText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginTop: space.xs },
  servingsBox: { gap: space.xs },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  servingsInput: { width: 90, textAlign: 'center' },
  perServing: { alignItems: 'flex-end', gap: space.xs },
  perValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  apply: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.sm },
  applyDisabled: { opacity: 0.4 },
  applyText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
});
