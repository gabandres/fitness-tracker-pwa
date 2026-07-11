import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { parseRecipeFromHtml, type ParsedRecipe } from '@macrolog/core';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import type { RecipeEstimate } from '@/components/RecipeBuilder';

interface Props {
  onApply: (estimate: RecipeEstimate) => void;
  onCancel: () => void;
}

const FETCH_TIMEOUT_MS = 8000;
// A browser-ish UA — some recipe sites 403 the default RN agent.
const UA = 'Mozilla/5.0 (compatible; IgniaRecipeImporter/1.0; +https://ignia.fit)';

/**
 * Recipe-URL import (mobile). Unlike the web, React Native's fetch is not
 * CORS-bound, so the app fetches the recipe page directly and parses its
 * JSON-LD via the shared core parser (`parseRecipeFromHtml`) — no Cloud
 * Function needed. When the page publishes nutrition, one serving is emitted
 * to prefill the manual form (same path as the recipe builder).
 */
export function RecipeImport({ onApply, onCancel }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParsedRecipe | null>(null);

  const perServingKcal = result?.perServing?.calories ?? 0;
  const perServingProtein = result?.perServing?.protein ?? null;
  const canApply = perServingKcal > 0;

  async function fetchRecipe() {
    const raw = url.trim();
    if (!raw || loading) return;
    let href: string;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
      href = u.href;
    } catch {
      setError(t('recipeImport.errInvalidUrl'));
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(href, {
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const html = await res.text();
      const parsed = parseRecipeFromHtml(html);
      if (!parsed || parsed.perServing?.calories == null) {
        setError(t('recipeImport.noNutrition'));
        return;
      }
      haptics.success();
      setResult(parsed);
    } catch {
      setError(t('recipeImport.errFetch'));
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  function apply() {
    if (!result || !canApply) return;
    haptics.success();
    onApply({
      calories: perServingKcal,
      protein: perServingProtein ?? undefined,
      mealLabel: result.name.trim(),
    });
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('recipeImport.title')}</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={8}>
          <Text style={styles.cancel}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.desc}>{t('recipeImport.desc')}</Text>

      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.urlInput]}
          placeholder={t('recipeImport.urlPlaceholder')}
          placeholderTextColor={colors.faint}
          value={url}
          onChangeText={(v) => { setUrl(v); if (error) setError(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={fetchRecipe}
          testID="recipe-import-url"
        />
        <TouchableOpacity
          style={[styles.fetchBtn, (loading || !url.trim()) && styles.btnDisabled]}
          onPress={fetchRecipe}
          disabled={loading || !url.trim()}
          testID="recipe-import-fetch"
        >
          <Text style={styles.fetchText}>
            {loading ? t('recipeImport.fetching') : t('recipeImport.fetch')}
          </Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.resultScroll}>
          <View style={styles.resultCard}>
            <Text style={styles.resultName}>{result.name || t('recipeImport.untitled')}</Text>
            <Text style={styles.resultMeta}>
              {perServingKcal} kcal
              {perServingProtein != null ? ` · ${perServingProtein}${t('recipeImport.proteinUnit')}` : ''}
              {' '}{t('recipeImport.perServing')}
              {result.servings ? ` · ${t('recipeImport.servings', { n: result.servings })}` : ''}
            </Text>
            {result.ingredients.length ? (
              <Text style={styles.resultIng}>
                {t('recipeImport.ingredientCount', { n: result.ingredients.length })}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      ) : null}

      {result ? (
        <TouchableOpacity
          style={[styles.apply, !canApply && styles.btnDisabled]}
          onPress={apply}
          disabled={!canApply}
          testID="recipe-import-apply"
        >
          <Text style={styles.applyText}>{t('recipeImport.useThis')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { minHeight: 320, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.h3, color: colors.ink, fontWeight: '800' },
  cancel: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  desc: { fontSize: font.small, color: colors.muted, lineHeight: 18 },
  row: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    color: colors.ink,
    fontSize: font.body,
  },
  urlInput: { flex: 1 },
  fetchBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  btnDisabled: { opacity: 0.4 },
  fetchText: { fontSize: font.small, fontWeight: '800', color: colors.ink },
  error: { fontSize: font.small, color: colors.danger, lineHeight: 18 },
  resultScroll: { maxHeight: 180 },
  resultCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  resultName: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
  resultMeta: { fontSize: font.small, color: colors.muted },
  resultIng: { fontSize: font.small, color: colors.faint, marginTop: 2 },
  apply: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  applyText: { fontSize: font.body, fontWeight: '800', color: colors.white },
});
