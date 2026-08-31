import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { FoodSource } from '@macrolog/core';
import { trustForDataType } from '@macrolog/core';
import {
  type FoodDetail,
  type FoodSearchHit,
  type ServingOption,
  getFoodDetail,
  searchFoods,
  sortServings,
  warmFoodIndex,
} from '@/lib/foodSearch';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** What the user picked — prefills the manual entry form. */
export interface FoodEstimate {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel: string;
  /** Grams-first save context (ADR-0013). Search results resolve as
   *  `source:'text'` with the picked portion's gram weight — no barcode (the
   *  barcode path is the scanner), so a saved search food auto-ids. */
  serving?: {
    grams?: number;
    source: FoodSource;
    barcode?: string;
    brand?: string;
    name?: string;
  };
}

interface Props {
  unitSystem?: 'us' | 'metric';
  onPick: (estimate: FoodEstimate) => void;
  /** Optional explicit "Cancel" affordance. Omit when the search panel is
   *  the sheet's root (the sheet's own drag-to-dismiss replaces it). */
  onCancel?: () => void;
  /** Rendered to the right of the search field — e.g. scan / recipe icons. */
  headerRight?: ReactNode;
  /** Rendered INSIDE the search row, beside the keyboard-driven input — the
   *  mic is a peer of typing, not a sixth way to log. */
  micSlot?: ReactNode;
  /** Text dictated into the mic that resolved to a plain food search. */
  seedQuery?: string;
  /** Rendered below the search field when the query is empty (idle), instead
   *  of the "type 2 characters" hint — used to host recents / quick-add. */
  emptyContent?: ReactNode;
  /** Offered when a search returns nothing, with the text the user typed.
   *  A miss is the strongest signal someone wants to write the food
   *  themselves — and their name for it is already in the box, so making
   *  them clear the query and retype it is pure loss. */
  onCreateFromQuery?: (query: string) => void;
}

type Phase = 'idle' | 'searching' | 'results' | 'detail-loading' | 'portion-pick' | 'error';

/** Global food-database search, mirroring the PWA food-search component:
 *  type ≥2 chars → debounced searchFoods → tap result → getFoodDetail →
 *  pick a serving (× multiplier) → emit a FoodEstimate the sheet bounces
 *  back into the manual form for review. */
export function FoodSearch({
  unitSystem = 'us',
  onPick,
  onCancel,
  headerRight,
  micSlot,
  seedQuery,
  emptyContent,
  onCreateFromQuery,
}: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  // A dictated bare food name arrives here rather than in the meal draft — see
  // `routeTranscript`. Keyed on the seed VALUE so saying the same thing twice
  // still re-applies, and so typing afterwards is never fought with.
  useEffect(() => {
    if (seedQuery) onChange(seedQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedQuery]);
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

  // Decode the bundled food index while the user is still reaching for the
  // field. Search is on-device now (Tier D), and the one-time decode is
  // ~70–140 ms on the LG G6 — small, but it would otherwise land on the first
  // keystroke, which is the one moment the user is watching. Deliberately here
  // and not at app start: this component mounts only when a search surface
  // opens, so a user who never searches never pays it.
  useEffect(() => {
    warmFoodIndex();
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
    setMultiplier(1);

    // Fast path: the search response already carried the portion picker, so the
    // picker opens with no network at all. `getFoodDetail` is a separate
    // callable and therefore separately cold — measured 2.83–3.79 s, paid on
    // every tap because it fires exactly once and never warms.
    if (hit.servings?.length) {
      setDetail({
        source: hit.source,
        id: hit.id,
        description: hit.description,
        brand: hit.brand,
        servings: hit.servings,
      });
      setPhase('portion-pick');
      return;
    }

    // Slow path, and it must stay: hits served from a pre-existing search cache
    // entry, or by a functions deploy older than this bundle, carry no servings.
    setPhase('detail-loading');
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
      // Grams-first context: the picked portion's gram weight × multiplier is
      // the eaten weight the emitted macros correspond to.
      serving: {
        grams: s.grams > 0 ? Math.round(s.grams * m * 10) / 10 : undefined,
        source: 'text' as FoodSource,
        brand: detail?.brand,
        name: detail?.description,
      },
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
        {micSlot}
        {onCancel ? (
          <TouchableOpacity onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {/* Below the row, full width, and ALWAYS rendered — including while the
          user is typing. `docs/research/mobile-manual-food-entry.md` is settled
          that a query removing the write-it-yourself affordance is a defect:
          typing is the strongest signal someone wants to write their own food.
          Only the mic goes inside the row, where it reads as a peer of the
          keyboard. */}
      {headerRight}

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
          <View style={styles.center}>
            <Text style={styles.muted}>{t('food.noMatches')}</Text>
            {onCreateFromQuery ? (
              <TouchableOpacity
                style={styles.createFromQuery}
                onPress={() => onCreateFromQuery(query.trim())}
                testID="create-from-query"
              >
                <Ionicons name="create-outline" size={18} color={colors.accent} />
                <Text style={styles.createFromQueryText} numberOfLines={2}>
                  {t('food.addYourself', { query: query.trim() })}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            {hits.map((h) => (
              <Pressable
                key={`${h.source}-${h.id}`}
                style={styles.hit}
                onPress={() => openDetail(h)}
                accessibilityRole="button"
                accessibilityLabel={`${h.description}${h.brand ? `, ${h.brand}` : ''}, ${t(trustLabelKey(h))}`}
              >
                <Text style={styles.hitDesc} numberOfLines={2}>{h.description}</Text>
                <View style={styles.hitMeta}>
                  {h.brand ? <Text style={styles.hitBrand}>{h.brand}</Text> : null}
                  {/* Where the number came from. Two databases feed this list —
                      lab-analyzed USDA rows and crowd-entered Open Food Facts
                      products — and until now they were indistinguishable, so a
                      measured value and a stranger's typo looked equally
                      authoritative. Cronometer sells "verified, not
                      crowdsourced" as its whole pitch; saying it plainly is
                      free, and it lets a user who cares choose. */}
                  <Text style={[styles.hitTrust, trustStyle(h, styles)]}>{t(trustLabelKey(h))}</Text>
                </View>
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

/** Badge copy for a hit's provenance. `suspect` wins over the source: a flagged
 *  number deserves a caveat even when USDA supplied it. */
function trustLabelKey(h: { dataType?: string; suspect?: boolean }): I18nKey {
  if (h.suspect) return 'food.trustCheck';
  switch (trustForDataType(h.dataType)) {
    case 'lab':
      return 'food.trustLab';
    case 'reference':
      return 'food.trustUsda';
    default:
      return 'food.trustCommunity';
  }
}

function trustStyle(
  h: { dataType?: string; suspect?: boolean },
  styles: ReturnType<typeof createStyles>,
) {
  if (h.suspect) return styles.hitTrustSuspect;
  return trustForDataType(h.dataType) === 'community' ? styles.hitTrustCommunity : styles.hitTrustGood;
}

/** Map a callable error to a user message. The functions attach an
 *  ErrorCode in details; surface the not-configured case specifically since
 *  it's an operator action, not retryable. */
function messageKey(e: unknown): I18nKey {
  const code = (e as { details?: { code?: string } })?.details?.code;
  return code === 'food_api_not_configured' ? 'food.notConfigured' : 'food.failed';
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { minHeight: 320, gap: space.sm },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  search: {
    flex: 1,
    backgroundColor: colors.inputBg,
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
  // The create-it-yourself escape hatch on a search miss. Sized like a real
  // button, not a hint: on a miss it is usually the action the user wants.
  createFromQuery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.inputBg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.xs,
    maxWidth: '100%',
  },
  createFromQueryText: { flexShrink: 1, fontSize: font.small, color: colors.accent, fontWeight: '700' },
  hit: {
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  hitDesc: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  hitBrand: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  hitMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  hitTrust: { fontSize: font.tiny, fontWeight: '600', marginTop: 2 },
  hitTrustGood: { color: colors.muted },
  hitTrustCommunity: { color: colors.faint },
  // Not `danger`: a flagged number is worth a second look, not an alarm, and the
  // calm positioning (UX_AUDIT §S12) rules out red for anything the user did
  // not do wrong.
  hitTrustSuspect: { color: colors.accent },
  back: { paddingVertical: space.xs },
  backText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  detailTitle: { fontSize: font.h3, color: colors.ink, fontWeight: '800' },
  brand: { fontSize: font.small, color: colors.muted },
  multRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  multLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg,
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
