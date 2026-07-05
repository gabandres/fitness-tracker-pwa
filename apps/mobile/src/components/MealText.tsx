import { useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import {
  type LogEntry, type ParsedFoodItem, parseMealDraft, parseMealUtterance, pickResolutionHit, resolveMealItem,
} from '@macrolog/core';
import { getFoodDetail, searchFoods } from '@/lib/foodSearch';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** One resolved, editable draft row. Numeric fields stay strings so partial
 *  input binds cleanly (the decimal-input gotcha); parsed only on add. */
interface DraftRow {
  food: string;
  servingLabel: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  assumed: boolean;
  matched: boolean;
}

interface Props {
  /** Timestamp to stamp each added entry with (past-day add), or undefined for "now". */
  forDate?: Date;
  /** Commit every draft row as its own diary entry. */
  onAddMany: (entries: LogEntry[]) => Promise<void> | void;
  onCancel: () => void;
}

type Phase = 'input' | 'resolving' | 'review' | 'error';

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Natural-language ("conversational") meal logging on mobile (ADR-0013 text
 * modality; parity with the PWA meal-text segment). Text-first: voice is a
 * native module that needs a dev build (like the barcode scanner / Google
 * Sign-In), so it's deferred to a later native adapter feeding this same
 * shared parser.
 *
 * The deterministic `@macrolog/core` parser decomposes the utterance into
 * `{qty, unit, food}` (never guessing macros); each food is resolved through
 * the same `searchFoods`/`getFoodDetail` database the search tab uses, scaled
 * by `resolveMealItem`, then presented as an EDITABLE draft the user confirms
 * with one "Add all" — never a fake-precise silent auto-commit.
 */
export function MealText({ forDate, onAddMany, onCancel }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    const items = parseMealUtterance(query);
    if (items.length === 0) {
      setPhase('error');
      return;
    }
    setPhase('resolving');
    try {
      const resolved = await Promise.all(items.map(resolveItem));
      setRows(resolved);
      setPhase('review');
    } catch {
      setPhase('error');
    }
  }

  /** Resolve one item; a miss yields a blank, flagged row rather than a drop. */
  async function resolveItem(item: ParsedFoodItem): Promise<DraftRow> {
    try {
      // Search wider than shown, then auto-pick a USDA generic so bare terms
      // ("eggs") don't resolve to a branded/high-fat product (see core).
      const hits = await searchFoods(item.food, 10);
      const hit = pickResolutionHit(hits);
      if (!hit) return blankRow(item);
      const detail = await getFoodDetail(hit.source, hit.id);
      const r = resolveMealItem(item, detail.servings);
      // 0-calorie resolution = degenerate DB entry (e.g. a milligram serving);
      // show an honest "enter values" row, not a fake-precise zero.
      if (!r || r.calories <= 0) return blankRow(item);
      return {
        food: item.food,
        servingLabel: gramsLabel(r.grams, r.servingLabel),
        calories: String(r.calories),
        protein: r.protein != null ? String(r.protein) : '',
        carbs: r.carbs != null ? String(r.carbs) : '',
        fat: r.fat != null ? String(r.fat) : '',
        assumed: r.assumed,
        matched: true,
      };
    } catch {
      return blankRow(item);
    }
  }

  function blankRow(item: ParsedFoodItem): DraftRow {
    return { food: item.food, servingLabel: '', calories: '', protein: '', carbs: '', fat: '', assumed: false, matched: false };
  }

  function gramsLabel(grams: number | null, servingLabel: string): string {
    const parts: string[] = [];
    if (grams != null) parts.push(`≈${grams} g`);
    if (servingLabel) parts.push(servingLabel);
    return parts.join(' · ');
  }

  function editRow(i: number, field: 'calories' | 'protein' | 'carbs' | 'fat', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function addAll() {
    if (busy || rows.length === 0) return;
    setBusy(true);
    haptics.success();
    try {
      // Build each entry through the shared core seam so macro coercion,
      // label, and timestamp match the PWA byte-for-byte. Blank calories
      // coerce to 0 so an unmatched-but-labelled row still logs (the user
      // fills the number in later) rather than being rejected.
      const entries: LogEntry[] = [];
      for (const r of rows) {
        const res = parseMealDraft({
          calories: numOrUndef(r.calories) ?? 0,
          protein: r.protein,
          carbs: r.carbs,
          fat: r.fat,
          mealLabel: r.food,
          timestamp: forDate,
        });
        if (res.ok) entries.push(res.draft.entry);
      }
      await onAddMany(entries);
    } finally {
      setBusy(false);
    }
  }

  // ── Review + edit ──
  if (phase === 'review') {
    return (
      <View style={styles.wrap}>
        <View style={styles.head}>
          <TouchableOpacity onPress={() => { setRows([]); setPhase('input'); }} hitSlop={8}>
            <Text style={styles.back}>{t('mealText.startOver')}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>{t('mealText.reviewHint')}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {rows.map((row, i) => (
            <View key={`${row.food}-${i}`} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{row.food}</Text>
                  {row.servingLabel ? <Text style={styles.cardSub}>{row.servingLabel}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => removeRow(i)} hitSlop={8}>
                  <Text style={styles.remove}>✕</Text>
                </TouchableOpacity>
              </View>
              {row.assumed ? (
                <Text style={styles.warn}>⚠ {t('mealText.assumed')}</Text>
              ) : !row.matched ? (
                <Text style={styles.warn}>⚠ {t('mealText.noMatch')}</Text>
              ) : null}
              <View style={styles.macroRow}>
                <MacroField label="kcal" value={row.calories} onChange={(v) => editRow(i, 'calories', v)} />
                <MacroField label="P" value={row.protein} onChange={(v) => editRow(i, 'protein', v)} />
                <MacroField label="C" value={row.carbs} onChange={(v) => editRow(i, 'carbs', v)} />
                <MacroField label="F" value={row.fat} onChange={(v) => editRow(i, 'fat', v)} />
              </View>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity
          style={[styles.add, (rows.length === 0 || busy) && styles.addDisabled]}
          onPress={addAll}
          disabled={rows.length === 0 || busy}
          testID="mealtext-add-all"
        >
          <Text style={styles.addText}>{t('mealText.addAll')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Input ──
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <TouchableOpacity onPress={onCancel} hitSlop={8}>
          <Text style={styles.back}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        placeholder={t('mealText.placeholder')}
        placeholderTextColor={colors.faint}
        value={query}
        onChangeText={(v) => { setQuery(v); if (phase === 'error') setPhase('input'); }}
        autoCorrect
        multiline
        testID="mealtext-input"
      />
      <Text style={styles.hint}>{phase === 'error' ? t('mealText.noItems') : t('mealText.hint')}</Text>
      <TouchableOpacity
        style={[styles.add, (query.trim().length < 2 || phase === 'resolving') && styles.addDisabled]}
        onPress={resolve}
        disabled={query.trim().length < 2 || phase === 'resolving'}
        testID="mealtext-parse"
      >
        {phase === 'resolving' ? (
          <ActivityIndicator color={colors.onInk} />
        ) : (
          <Text style={styles.addText}>{t('mealText.parse')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function MacroField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.macroField}>
      <Text style={styles.macroLabel}>{label}</Text>
      <TextInput
        style={styles.macroInput}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.faint}
      />
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  wrap: { minHeight: 320, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  hint: { fontSize: font.small, color: colors.muted },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: font.body,
    color: colors.ink,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  scroll: { maxHeight: 380 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.xs,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitleWrap: { flex: 1, marginRight: space.md },
  cardTitle: { fontSize: font.body, color: colors.ink, fontWeight: '700', textTransform: 'capitalize' },
  cardSub: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  remove: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  warn: { fontSize: font.tiny, color: colors.danger, fontWeight: '600' },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  macroField: { flex: 1, gap: 2 },
  macroLabel: { fontSize: font.tiny, color: colors.muted, textAlign: 'center' },
  macroInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: space.xs,
    fontSize: font.small,
    color: colors.ink,
    textAlign: 'center',
  },
  add: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.sm },
  addDisabled: { opacity: 0.4 },
  addText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
