import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type LogEntry, type ParsedFoodItem,
  parseMealDraft, parseMealUtterance,
} from '@macrolog/core';
import { announce } from '@/lib/a11y';
import { getFoodDetail, searchFoods } from '@/lib/foodSearch';
import { resolveOneItem } from '@/lib/mealResolution';
import { type Locale, useLocale, useT } from '@/i18n';
import { kcalOutOfRange, macroOutOfRange, parseDecimal } from '@/lib/entry-input';
import * as haptics from '@/lib/haptics';
import { useA11yFocus } from '@/lib/use-a11y-focus';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/** One resolved, editable draft row. Numeric fields stay strings so partial
 *  input binds cleanly (the decimal-input gotcha); parsed only on add. */
interface DraftRow {
  food: string;
  /** What the parser understood, in the user's own words. Empty when echoing
   *  it would only repeat the food name. */
  read: string;
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
  /**
   * An utterance dictated into the mic that the parser found quantities in.
   * Seeds the field so the user sees exactly what was heard and can correct it
   * before anything is resolved — never auto-submitted.
   */
  seedText?: string;
  /** Whether there is typed text or a draft to lose — the add sheet asks
   *  before a stray backdrop tap discards it. */
  onDirtyChange?: (dirty: boolean) => void;
}

type Phase = 'input' | 'resolving' | 'review' | 'error';

/**
 * A row's number fields as the write will see them, or why it cannot be
 * written (audit #14). Read through `parseDecimal`, so a pt-BR `12,5` is 12.5
 * — `parseMealDraft`'s own `Number()` read it as NaN and dropped the macro.
 *
 * Calories are REQUIRED on every row. "Add all" used to coerce a blank to 0,
 * so a no-match row ("No match — enter values") the user never filled was
 * logged as a 0-kcal entry, and a row the draft parser refused was dropped
 * from the batch with nothing said. A typed `0` stays a real entry (black
 * coffee, U7); a blank does not.
 */
function rowNumbers(r: DraftRow, locale: Locale):
  | { ok: true; calories: number; protein?: number; carbs?: number; fat?: number }
  | { ok: false } {
  const read = (s: string): number | undefined | null => {
    if (s.trim() === '') return undefined;
    return parseDecimal(s, locale) ?? null; // null = typed but not a number
  };
  const calories = read(r.calories);
  const protein = read(r.protein);
  const carbs = read(r.carbs);
  const fat = read(r.fat);
  if (calories == null || kcalOutOfRange(calories)) return { ok: false };
  for (const m of [protein, carbs, fat]) if (m === null || macroOutOfRange(m ?? undefined)) return { ok: false };
  return {
    ok: true,
    calories,
    ...(protein != null ? { protein } : {}),
    ...(carbs != null ? { carbs } : {}),
    ...(fat != null ? { fat } : {}),
  };
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
export function MealText({ forDate, onAddMany, onCancel, seedText, onDirtyChange }: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [query, setQuery] = useState(seedText ?? '');
  const [phase, setPhase] = useState<Phase>('input');
  // Opens in place of the add sheet's browse view, and swaps input ↔ review
  // in place too; each lands the screen reader on the heading.
  const titleRef = useA11yFocus(phase);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);

  const dirty = query.trim() !== '' || rows.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function resolve() {
    const items = parseMealUtterance(query);
    if (items.length === 0) {
      setPhase('error');
      return;
    }
    setPhase('resolving');
    await Promise.all(items.map(resolveItem))
      .then((resolved) => {
        setRows(resolved);
        setPhase('review');
      })
      .catch(() => setPhase('error'));
  }

  /** Resolve one item; a miss yields a blank, flagged row rather than a drop.
   *  The resolution policy itself lives in `lib/mealResolution.ts`, where it
   *  can be tested against the real shipped index without React. */
  async function resolveItem(item: ParsedFoodItem): Promise<DraftRow> {
    // `.catch` on an async body rather than `try/catch`: the conditionals in
    // here, inside a try statement, made the React Compiler skip MealText.
    return (async (): Promise<DraftRow> => {
      const r = await resolveOneItem(item, { search: searchFoods, detail: getFoodDetail });
      // 0-calorie resolution = degenerate DB entry (e.g. a milligram serving);
      // show an honest "enter values" row, not a fake-precise zero.
      if (!r || r.calories <= 0) return blankRow(item);
      return {
        food: item.food,
        read: readingOf(item),
        servingLabel: gramsLabel(r.grams, r.servingLabel),
        calories: String(r.calories),
        protein: r.protein != null ? String(r.protein) : '',
        carbs: r.carbs != null ? String(r.carbs) : '',
        fat: r.fat != null ? String(r.fat) : '',
        assumed: r.assumed,
        matched: true,
      };
    })().catch(() => blankRow(item));
  }

  function blankRow(item: ParsedFoodItem): DraftRow {
    return { food: item.food, read: readingOf(item), servingLabel: '', calories: '', protein: '', carbs: '', fat: '', assumed: false, matched: false };
  }

  /**
   * Echo back what the parser understood, before anything is written — the
   * step that makes the photo-scan flow feel trustworthy, and what
   * `ParsedFoodItem.raw` was put there for.
   *
   * It deliberately shows the user's OWN words rather than a rendering of
   * `{quantity, unit}`: a canonical unit would need a translated name for all
   * 20 of them in three locales to say something the user already typed. When
   * the utterance carried no quantity or unit, `raw` is just the food name
   * again — say nothing rather than repeat the title.
   */
  function readingOf(item: ParsedFoodItem): string {
    const raw = item.raw.trim();
    return raw.toLowerCase() === item.food ? '' : raw;
  }

  function gramsLabel(grams: number | null, servingLabel: string): string {
    const parts: string[] = [];
    if (grams != null) parts.push(`≈${t('unit.grams', { n: String(grams) })}`);
    // The per-100 g row is the scaling BASIS, not a serving anyone picked —
    // printing it renders "≈7.1 g · 100 g", which reads like a contradiction.
    if (servingLabel && !/^100\s*g$/i.test(servingLabel)) parts.push(servingLabel);
    return parts.join(' · ');
  }

  function editRow(i: number, field: 'calories' | 'protein' | 'carbs' | 'fat', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** Rows that cannot be written as they stand — named under the list, and
   *  "Add all" waits for them (audit #14). */
  const needs = rows.filter((r) => !rowNumbers(r, locale).ok);
  const needNames = needs.map((r) => r.food).join(', ');

  async function addAll() {
    if (busy || rows.length === 0) return;
    if (needs.length) {
      haptics.warning();
      announce(t('mealText.needsValues', { names: needNames }));
      return;
    }
    setBusy(true);
    haptics.success();
    // An async body with `.finally`, not `try/finally`: the React Compiler
    // skips a component holding the statement form. `busy` still clears on
    // success and failure, and a rejection still reaches the caller.
    await (async () => {
      // Build each entry through the shared core seam so the label, the
      // timestamp and the empty-row rule match the PWA. Every row here has
      // already passed `rowNumbers`, so none is coerced or dropped.
      const entries: LogEntry[] = [];
      for (const r of rows) {
        const n = rowNumbers(r, locale);
        if (!n.ok) continue;
        const res = parseMealDraft({ ...n, mealLabel: r.food, timestamp: forDate });
        if (res.ok) entries.push(res.draft.entry);
      }
      await onAddMany(entries);
    })().finally(() => setBusy(false));
  }

  // ── Review + edit ──
  if (phase === 'review') {
    return (
      <View style={styles.wrap}>
        <View style={styles.head}>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">{t('entry.describeMeal')}</Text>
          <TouchableOpacity onPress={() => { setRows([]); setPhase('input'); }} hitSlop={12} accessibilityRole="button">
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
                  {row.read ? (
                    <Text style={styles.read} numberOfLines={1}>{t('mealText.read', { text: row.read })}</Text>
                  ) : null}
                  {row.servingLabel ? <Text style={styles.cardSub}>{row.servingLabel}</Text> : null}
                </View>
                {/* 17dp glyph + 14dp slop each side = 45pt (S18-15). */}
                <TouchableOpacity onPress={() => removeRow(i)} hitSlop={14} accessibilityRole="button" accessibilityLabel={t('common.remove')}>
                  <Ionicons name="close" size={font.body} color={colors.muted} />
                </TouchableOpacity>
              </View>
              {row.assumed || !row.matched ? (
                <View style={styles.warnRow}>
                  <Ionicons name="alert-circle-outline" size={font.small} color={colors.danger} />
                  <Text style={styles.warn}>{t(row.assumed ? 'mealText.assumed' : 'mealText.noMatch')}</Text>
                </View>
              ) : null}
              <View style={styles.macroRow}>
                {/* Words, not P/C/F codes (S18-17): the codes are jargon on a
                    first read and letters to a screen reader. */}
                <MacroField label={t('macro.kcal')} food={row.food} value={row.calories} onChange={(v) => editRow(i, 'calories', v)} />
                <MacroField label={t('macro.protein')} food={row.food} value={row.protein} onChange={(v) => editRow(i, 'protein', v)} />
                <MacroField label={t('macro.carbs')} food={row.food} value={row.carbs} onChange={(v) => editRow(i, 'carbs', v)} />
                <MacroField label={t('macro.fat')} food={row.food} value={row.fat} onChange={(v) => editRow(i, 'fat', v)} />
              </View>
            </View>
          ))}
        </ScrollView>
        {needs.length ? (
          <Text style={styles.warn} accessibilityLiveRegion="polite" testID="mealtext-needs">
            {t('mealText.needsValues', { names: needNames })}
          </Text>
        ) : null}
        <TouchableOpacity
          style={[styles.add, (rows.length === 0 || busy || needs.length > 0) && styles.addDisabled]}
          onPress={addAll}
          disabled={rows.length === 0 || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: rows.length === 0 || busy || needs.length > 0, busy }}
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
      {/* Title left, Cancel right — the same header the recipe sheets use, so
          every EntrySheet mode dismisses from one place (UX_AUDIT S16-7). */}
      <View style={styles.head}>
        <Text ref={titleRef} style={styles.title} accessibilityRole="header">{t('entry.describeMeal')}</Text>
        <TouchableOpacity onPress={onCancel} style={styles.cancelBtn} hitSlop={{ left: 12, right: 12 }} accessibilityRole="button">
          <Text style={styles.back}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </View>
      <SheetTextInput
        style={styles.input}
        placeholder={t('mealText.placeholder')}
        placeholderTextColor={colors.faint}
        value={query}
        onChangeText={(v) => { setQuery(v); if (phase === 'error') setPhase('input'); }}
        autoCorrect
        multiline
        accessibilityLabel={t('entry.describeMeal')}
        testID="mealtext-input"
      />
      <Text style={styles.hint}>{phase === 'error' ? t('mealText.noItems') : t('mealText.hint')}</Text>
      <TouchableOpacity
        style={[styles.add, (query.trim().length < 2 || phase === 'resolving') && styles.addDisabled]}
        onPress={resolve}
        disabled={query.trim().length < 2 || phase === 'resolving'}
        accessibilityRole="button"
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

function MacroField({ label, food, value, onChange }: { label: string; food: string; value: string; onChange: (v: string) => void }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // No return key was set, so an iPhone decimal pad offered no way to put the
  // keyboard away; this is RN's Done toolbar, localized (KeyboardBar.tsx).
  const kbProps = useDoneKeyProps();
  return (
    <View style={styles.macroField}>
      <Text style={styles.macroLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
      <SheetTextInput
        style={styles.macroInput}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.faint}
        {...kbProps}
        // Which food, too: every card has the same four fields, and "kcal"
        // alone left a screen-reader user guessing which row they were in.
        accessibilityLabel={`${label}, ${food}`}
      />
    </View>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  /** A real 44/48 target around the text (it measured ~19 dp with only a
   *  hitSlop, which TalkBack and Switch Access do not see — UX_AUDIT S22);
   *  the negative margin keeps the header row its old height. */
  cancelBtn: { minHeight: TARGET, minWidth: TARGET, justifyContent: 'center', alignItems: 'flex-end', marginVertical: -space.sm },
  wrap: { minHeight: 320, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
  back: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
  hint: { fontSize: font.small, color: colors.muted },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
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
  read: { fontSize: font.tiny, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
  cardSub: { fontSize: font.tiny, color: colors.muted, marginTop: 2 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  warn: { fontSize: font.tiny, color: colors.danger, fontWeight: '600' },
  macroRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  macroField: { flex: 1, gap: 2 },
  macroLabel: { fontSize: font.tiny, color: colors.muted, textAlign: 'center' },
  // A word ("Proteína") has to fit where a letter did; the four fields split
  // the row equally, so the label shrinks before it wraps.
  macroInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
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
