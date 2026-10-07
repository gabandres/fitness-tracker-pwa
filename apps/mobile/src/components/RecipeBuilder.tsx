import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useA11yFocus } from '@/lib/use-a11y-focus';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

export interface RecipeEstimate {
  calories: number;
  protein?: number;
  mealLabel: string;
}

interface Props {
  onApply: (estimate: RecipeEstimate) => void;
  onCancel: () => void;
  /** Whether anything has been typed — the add sheet asks before a stray
   *  backdrop tap throws a half-built recipe away. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface Ingredient {
  name: string;
  calories: string;
  protein: string;
}

function num(s: string): number | null {
  // A comma is a decimal point here, not a rejection: pt-BR keyboards (and
  // iOS decimal pads under a Brazilian region) type `12,5`, and `Number()`
  // reads that as NaN. Same normalisation core's unit parsers already do.
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Stateless recipe calculator (mirrors the PWA recipe-builder): list
 *  ingredients (kcal + optional protein) and a serving count, then emit one
 *  serving's totals to prefill the manual form. Not persisted — "save as
 *  preset" on the prefilled form is the reuse path. */
export function RecipeBuilder({ onApply, onCancel, onDirtyChange }: Props) {
  // Opens in place of the add sheet's browse view; tell the screen reader.
  const titleRef = useA11yFocus('recipe');
  // The number fields set no return key, so on an iPhone's decimal pad
  // there was no way to put the keyboard away and reach "Use this". This
  // gives them RN's Done toolbar, in the user's language (KeyboardBar.tsx).
  const kbProps = useDoneKeyProps();
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
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

  const dirty =
    name.trim() !== '' || ingredients.some((ing) => ing.name.trim() || ing.calories.trim() || ing.protein.trim());
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
        <Text ref={titleRef} style={styles.title} accessibilityRole="header">{t('recipe.title')}</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={12} accessibilityRole="button">
          <Text style={styles.cancel}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>

      <SheetTextInput
        style={styles.input}
        placeholder={t('recipe.namePlaceholder')}
        placeholderTextColor={colors.faint}
        value={name}
        onChangeText={setName}
        accessibilityLabel={t('recipe.namePlaceholder')}
        testID="recipe-name"
      />

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        <View style={styles.colHead}>
          <Text style={[styles.colLabel, styles.colName]}>{t('recipe.ingredient')}</Text>
          <Text style={[styles.colLabel, styles.colNum]}>{t('recipe.kcal')}</Text>
          {/* Spelled out (S18-17): "P" is jargon on a first read and a letter
              to a screen reader. Shrinks to fit the narrow column. */}
          <Text style={[styles.colLabel, styles.colNum]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {t('recipe.proteinShort')}
          </Text>
          <View style={styles.colDel} />
        </View>
        {ingredients.map((ing, i) => (
          <View key={i} style={styles.ingRow}>
            <SheetTextInput
              style={[styles.input, styles.colName]}
              placeholder={t('recipe.ingredient')}
              placeholderTextColor={colors.faint}
              value={ing.name}
              onChangeText={(v) => setIng(i, 'name', v)}
              accessibilityLabel={t('recipe.ingredientA11y', { n: i + 1 })}
              testID={`recipe-ing-name-${i}`}
            />
            <SheetTextInput
              style={[styles.input, styles.colNum]}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              {...kbProps}
              value={ing.calories}
              onChangeText={(v) => setIng(i, 'calories', v)}
              accessibilityLabel={t('recipe.kcalA11y', { n: i + 1 })}
              testID={`recipe-ing-kcal-${i}`}
            />
            <SheetTextInput
              style={[styles.input, styles.colNum]}
              placeholder="0"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              {...kbProps}
              value={ing.protein}
              onChangeText={(v) => setIng(i, 'protein', v)}
              accessibilityLabel={t('recipe.proteinA11y', { n: i + 1 })}
            />
            <TouchableOpacity
              style={styles.colDel}
              onPress={() => removeIng(i)}
              // 24dp column + 10 each side = 44 (S18-15); the row is ~44 tall.
              hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.remove')}
            >
              <Ionicons name="close" size={font.small + 2} color={colors.danger} />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.addIng} onPress={addIng} hitSlop={8} accessibilityRole="button" testID="recipe-add-ing">
          <Text style={styles.addIngText}>{t('recipe.addIngredient')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.servingsBox}>
          <Text style={styles.fieldLabel}>{t('recipe.servings')}</Text>
          <SheetTextInput
            style={[styles.input, styles.servingsInput]}
            placeholder="1"
            placeholderTextColor={colors.faint}
            keyboardType="numeric"
            {...kbProps}
            value={servings}
            onChangeText={setServings}
            accessibilityLabel={t('recipe.servings')}
            testID="recipe-servings"
          />
        </View>
        <View style={styles.perServing}>
          <Text style={styles.fieldLabel}>{t('recipe.perServing')}</Text>
          <Text style={styles.perValue} testID="recipe-per-serving">
            {formatNumber(perServing.kcal, locale)} {t('today.kcal')}
            {perServing.protein != null ? ` · ${t('entry.proteinAmount', { n: perServing.protein })}` : ''}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.apply, !canApply && styles.applyDisabled]}
        onPress={apply}
        disabled={!canApply}
        accessibilityRole="button"
        testID="recipe-apply"
      >
        <Text style={styles.applyText}>{t('recipe.useThis')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  // `flexShrink` here and on `scroll`: with the keyboard up the sheet is
  // shorter than the builder, and a fixed-height list pushed "Use this" half
  // under the keyboard at six ingredients (Android QA, UX_AUDIT S22). The list
  // is what gives up the height; the footer and the button stay whole.
  wrap: { minHeight: 320, gap: space.sm, flexShrink: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.h3, color: colors.ink, fontWeight: '800' },
  cancel: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  scroll: { maxHeight: 280, flexShrink: 1 },
  colHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  colLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  colName: { flex: 1 },
  colNum: { width: 56, textAlign: 'center' },
  colDel: { width: 24, alignItems: 'center' },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    // `lineStrong`: an input's edge has to clear 3:1 (WCAG 1.4.11).
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: font.body,
    color: colors.ink,
  },
  del: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  addIng: { paddingVertical: space.sm },
  addIngText: { fontSize: font.small, color: colors.teal, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginTop: space.xs },
  servingsBox: { gap: space.xs },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  servingsInput: { width: 90, textAlign: 'center' },
  perServing: { alignItems: 'flex-end', gap: space.xs },
  perValue: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  apply: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.sm },
  applyDisabled: { opacity: 0.4 },
  applyText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
