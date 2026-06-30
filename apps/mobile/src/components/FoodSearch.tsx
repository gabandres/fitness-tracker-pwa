import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  type FoodDetail,
  type FoodSearchHit,
  type ServingOption,
  getFoodDetail,
  searchFoods,
  sortServings,
} from '@/lib/foodSearch';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

/** What the user picked — prefills the manual entry form. */
export interface FoodEstimate {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel: string;
}

interface Props {
  unitSystem?: 'us' | 'metric';
  onPick: (estimate: FoodEstimate) => void;
  /** Optional explicit "Cancel" affordance. Omit when the search panel is
   *  the sheet's root (the sheet's own drag-to-dismiss replaces it). */
  onCancel?: () => void;
  /** Rendered to the right of the search field — e.g. scan / recipe icons. */
  headerRight?: ReactNode;
  /** Rendered below the search field when the query is empty (idle), instead
   *  of the "type 2 characters" hint — used to host recents / quick-add. */
  emptyContent?: ReactNode;
}

type Phase = 'idle' | 'searching' | 'results' | 'detail-loading' | 'portion-pick' | 'error';

/** Global food-database search, mirroring the PWA food-search component:
 *  type ≥2 chars → debounced searchFoods → tap result → getFoodDetail →
 *  pick a serving (× multiplier) → emit a FoodEstimate the sheet bounces
 *  back into the manual form for review. */
export function FoodSearch({ unitSystem = 'us', onPick, onCancel, headerRight, emptyContent }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [hits, setHits] = useState<FoodSearchHit[]>([]);
  const [detail, setDetail] = useState<FoodDetail | null>(null);
  const [multiplier, setMultiplier] = useState(1);
  const [errorMsg, setErrorMsg] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against a slow earlier query resolving after a newer keystroke.
  const reqId = useRef(0);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function onChange(text: string) {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    const q = text.trim();
    if (q.length < 2) {
      setPhase('idle');
      setHits([]);
      return;
    }
    setPhase('searching');
    debounce.current = setTimeout(() => void runSearch(q), 350);
  }

  async function runSearch(q: string) {
    const id = ++reqId.current;
    try {
      const results = await searchFoods(q);
      if (id !== reqId.current) return; // stale
      setHits(results);
      setPhase('results');
    } catch (e) {
      if (id !== reqId.current) return;
      setErrorMsg(t(messageKey(e)));
      setPhase('error');
    }
  }

  async function openDetail(hit: FoodSearchHit) {
    haptics.tap();
    setPhase('detail-loading');
    setMultiplier(1);
    try {
      const d = await getFoodDetail(hit.source, hit.id);
      setDetail(d);
      setPhase('portion-pick');
    } catch (e) {
      setErrorMsg(t(messageKey(e)));
      setPhase('error');
    }
  }

  function pickServing(s: ServingOption) {
    haptics.success();
    const m = multiplier;
    onPick({
      calories: Math.round(s.kcal * m),
      protein: s.protein != null ? Math.round(s.protein * m) : undefined,
      carbs: s.carbs != null ? Math.round(s.carbs * m) : undefined,
      fat: s.fat != null ? Math.round(s.fat * m) : undefined,
      mealLabel: detail?.description ?? '',
    });
  }

  // ── Portion picker ──
  if (phase === 'portion-pick' && detail) {
    const servings = sortServings(detail.servings, unitSystem);
    return (
      <View style={styles.wrap}>
        <TouchableOpacity onPress={() => setPhase('results')} style={styles.back} hitSlop={8}>
          <Text style={styles.backText}>{t('food.results')}</Text>
        </TouchableOpacity>
        <Text style={styles.detailTitle} numberOfLines={2}>{detail.description}</Text>
        {detail.brand ? <Text style={styles.brand}>{detail.brand}</Text> : null}

        <View style={styles.multRow}>
          <Text style={styles.multLabel}>{t('food.quantity')}</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.step} onPress={() => setMultiplier((m) => Math.max(0.5, Math.round((m - 0.5) * 10) / 10))}>
              <Text style={styles.stepText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.multValue}>{multiplier}×</Text>
            <TouchableOpacity style={styles.step} onPress={() => setMultiplier((m) => Math.round((m + 0.5) * 10) / 10)}>
              <Text style={styles.stepText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {servings.map((s, i) => (
            <Pressable key={`${s.label}-${i}`} style={styles.serving} onPress={() => pickServing(s)}>
              <View style={styles.servingMain}>
                <Text style={styles.servingLabel}>{s.label}</Text>
                <Text style={styles.servingMacros}>
                  {Math.round(s.kcal * multiplier)} kcal · P {Math.round(s.protein * multiplier)}g
                </Text>
              </View>
              <Text style={styles.servingPick}>{t('food.add')}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Search + results ──
  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder={t('food.placeholder')}
          placeholderTextColor={colors.faint}
          value={query}
          onChangeText={onChange}
          autoCorrect={false}
          testID="food-search-input"
        />
        {headerRight}
        {onCancel ? (
          <TouchableOpacity onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {phase === 'searching' || phase === 'detail-loading' ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : phase === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.error}>{errorMsg}</Text>
          {query.trim().length >= 2 ? (
            <TouchableOpacity onPress={() => void runSearch(query.trim())}><Text style={styles.retry}>{t('common.retry')}</Text></TouchableOpacity>
          ) : null}
        </View>
      ) : phase === 'results' ? (
        hits.length === 0 ? (
          <View style={styles.center}><Text style={styles.muted}>{t('food.noMatches')}</Text></View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {hits.map((h) => (
              <Pressable key={`${h.source}-${h.id}`} style={styles.hit} onPress={() => openDetail(h)}>
                <Text style={styles.hitDesc} numberOfLines={2}>{h.description}</Text>
                {h.brand ? <Text style={styles.hitBrand}>{h.brand}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        )
      ) : emptyContent != null ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {emptyContent}
        </ScrollView>
      ) : (
        <View style={styles.center}><Text style={styles.muted}>{t('food.typeMore')}</Text></View>
      )}
    </View>
  );
}

/** Map a callable error to a user message. The functions attach an
 *  ErrorCode in details; surface the not-configured case specifically since
 *  it's an operator action, not retryable. */
function messageKey(e: unknown): I18nKey {
  const code = (e as { details?: { code?: string } })?.details?.code;
  return code === 'food_api_not_configured' ? 'food.notConfigured' : 'food.failed';
}

const styles = StyleSheet.create({
  wrap: { minHeight: 320, gap: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  search: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
  },
  cancel: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  scroll: { maxHeight: 360 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xl, gap: space.sm },
  muted: { fontSize: font.small, color: colors.muted },
  error: { fontSize: font.small, color: colors.danger, textAlign: 'center' },
  retry: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  hit: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  hitDesc: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  hitBrand: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  back: { paddingVertical: space.xs },
  backText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  detailTitle: { fontSize: font.h3, color: colors.ink, fontWeight: '800' },
  brand: { fontSize: font.small, color: colors.muted },
  multRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  multLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white,
  },
  stepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  multValue: { fontSize: font.body, color: colors.ink, fontWeight: '700', minWidth: 44, textAlign: 'center' },
  serving: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  servingMain: { flex: 1, gap: 2 },
  servingLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  servingMacros: { fontSize: font.small, color: colors.muted },
  servingPick: { fontSize: font.small, color: colors.accent, fontWeight: '700', marginLeft: space.md },
});
