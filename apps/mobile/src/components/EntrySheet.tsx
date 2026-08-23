import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  MEAL_TYPES,
  type CustomFood,
  type DailyLog,
  type FoodSource,
  type LogEntry,
  type MealPreset,
  type MealType,
  buildCustomFood,
  buildMealPreset,
  scaleCustomFood,
} from '@macrolog/core';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import { BottomSheet } from '@/components/BottomSheet';
import { MicButton } from './MicButton';
import { FoodSearch } from '@/components/FoodSearch';
import { MealText } from '@/components/MealText';
import { RecipeBuilder } from '@/components/RecipeBuilder';
import { RecipeImport } from '@/components/RecipeImport';
import { useLocale, useT } from '@/i18n';
import { starterFoods } from '@/lib/starterFoods';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { formatDate } from '@/lib/date-format';

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
  /** Saved food library (My Foods, ADR-0013). */
  customFoods?: CustomFood[];
  onSaveCustomFood?: (food: Omit<CustomFood, 'id'>) => Promise<void> | void;
  onDeleteCustomFood?: (id: string) => Promise<void> | void;
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

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Keep numeric fields as raw strings so partial input ("12.", "1.5")
 *  binds cleanly; parse only on save (see the decimal-input gotcha). */
function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Grams-first save context carried from a search/scan pick (ADR-0013).
 *  Mirrors the web MacroEstimate.serving. */
type ServingCtx = {
  grams?: number;
  source: FoodSource;
  barcode?: string;
  brand?: string;
  name?: string;
};


/** Search-first add-food sheet, on a plain RN <Modal> (animationType "slide"
 *  is OS-driven, so it doesn't stutter while typing — unlike the old custom
 *  Animated translateY). Adding opens on a BROWSE view (search + recents +
 *  scan/recipe icons); the manual macro form is a secondary CUSTOM mode
 *  (also used when editing). Search portion / recipe / barcode prefill CUSTOM
 *  for review. Recents/presets are one-tap relog. */
/** How many rows the merged browse list shows. Recents used to cap at 5 and
 *  sat beside three other sections; one ranked list can afford more. */
const BROWSE_ROW_CAP = 12;

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
  customFoods = [],
  onSaveCustomFood,
  onDeleteCustomFood,
  unitSystem = 'us',
  dateKey,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // Which date a saved/relogged entry lands on: the edited row's own date,
  // else local noon on `dateKey` (past-day add), else undefined ("now").
  const forDate = editing?.date ?? (dateKey ? noonOf(dateKey) : undefined);
  const [label, setLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [mealType, setMealType] = useState<MealType | undefined>(undefined);
  // Editable entry date — lets the user MOVE an entry to another day (shown
  // only when editing or adding to a specific past day). Plain today-adds keep
  // the "now" timestamp and hide the row.
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const showDateRow = editing != null || dateKey != null;
  const [busy, setBusy] = useState(false);
  const [manage, setManage] = useState(false);
  const [mode, setMode] = useState<'browse' | 'custom' | 'recipe' | 'recipeImport' | 'meal'>('browse');
  /** The collapsed "more ways to log" list. Closed by default — that is the point. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** Dictated text, routed by `routeTranscript` to whichever surface fits. */
  const [searchSeed, setSearchSeed] = useState<string | undefined>(undefined);
  const [voiceSeed, setVoiceSeed] = useState<string | undefined>(undefined);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Camera permanently denied: the scanner can't prompt again, so we say so
  // here — in the app's own UI, not as a gate in front of an OS prompt
  // (App Review 5.1.1(iv), submission 5ba1c7f5).
  const [cameraDenied, setCameraDenied] = useState(false);
  // Serving context from the last search/scan prefill + the calories it
  // produced. If the user later edits calories the context is stale (a
  // different portion) → fall back to a manual serving:1 save.
  const [pendingServing, setPendingServing] = useState<{ ctx: ServingCtx; appliedCalories: number } | null>(null);

  // The mount-through-exit animation, the fade-in-place backdrop, the
  // drag-to-dismiss handle and the keyboard padding all live in
  // `<BottomSheet>` now. This file is where all four were invented — the
  // shared component was modelled on it — and keeping a second copy here is
  // how the two drift. It already had: the copy that stayed behind kept its
  // own `Keyboard` listeners and applied `paddingBottom: kbHeight || 32`,
  // which omits `insets.bottom` at rest. That is the exact expression that
  // put Save under the LG VS988's 48dp navigation bar and cost it taps near
  // its lower edge; `useKeyboardSheetPadding` has carried the fix since
  // 2026-08-22 and this sheet was not on it.

  // Reset form + mode whenever the sheet (re)opens.
  useEffect(() => {
    if (!visible) return;
    setLabel(editing?.mealLabel ?? '');
    setCalories(editing?.calories != null ? String(editing.calories) : '');
    setProtein(editing?.protein != null ? String(editing.protein) : '');
    setCarbs(editing?.carbs != null ? String(editing.carbs) : '');
    setFat(editing?.fat != null ? String(editing.fat) : '');
    setMealType(editing?.mealType);
    setEntryDate(editing?.date ?? (dateKey ? noonOf(dateKey) : new Date()));
    setBusy(false);
    setManage(false);
    setPendingServing(null);
    setMode(editing ? 'custom' : 'browse');
  }, [visible, editing, dateKey]);

  /** Shift the editable entry date by whole days (move-to-date), keeping the
   *  time-of-day. Clamped so you can't push an entry into the future. */
  function shiftEntryDate(deltaDays: number) {
    haptics.tap();
    setEntryDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + deltaDays);
      return next.getTime() > Date.now() ? prev : next;
    });
  }

  /** Prefill the manual form from an estimate (search portion, recipe,
   *  barcode) and move to CUSTOM for review before saving. */
  const prefill = useCallback(
    (src: {
      calories: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      mealLabel?: string;
      serving?: ServingCtx;
    }) => {
      haptics.tap();
      setLabel(src.mealLabel ?? '');
      setCalories(String(src.calories));
      setProtein(src.protein != null ? String(src.protein) : '');
      setCarbs(src.carbs != null ? String(src.carbs) : '');
      setFat(src.fat != null ? String(src.fat) : '');
      setMealType(undefined);
      // Remember the grams-first context so "Save to My Foods" can store a
      // gram-weighted, barcode-deduped food. Tied to these calories so a later
      // edit invalidates it (see saveAsCustomFood).
      setPendingServing(src.serving ? { ctx: src.serving, appliedCalories: src.calories } : null);
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
  const canSaveCustomFood = onSaveCustomFood != null && label.trim().length > 0 && calNum != null;

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
      timestamp: showDateRow ? entryDate : forDate,
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
    // buildMealPreset clamps into the isValidPreset rule bounds. Writing the
    // raw values here is what produced permission-denied in prod (Sentry
    // IGNIA-MOBILE-9): the rule rejects and the preset is silently lost.
    await onSavePreset(
      buildMealPreset({
        name: label.trim(),
        calories: calNum,
        protein: numOrUndef(protein),
        carbs: numOrUndef(carbs),
        fat: numOrUndef(fat),
      }),
    );
  }

  /** Save the current custom form as a reusable CustomFood. Grams-first +
   *  barcode-dedup when a search/scan supplied a gram weight (and the user
   *  hasn't edited the calories it produced); otherwise a manual serving:1
   *  save. Mirrors the PWA entry-form-manager.confirmSaveCustomFood.
   *  (customFoodDocId — the barcode-as-doc-id de-dup — is applied by the
   *  onSaveCustomFood handler in the hook.) */
  async function saveAsCustomFood() {
    if (!onSaveCustomFood || !label.trim() || calNum == null) return;
    haptics.tap();
    const name = label.trim();
    const p = numOrUndef(protein);
    const c = numOrUndef(carbs);
    const f = numOrUndef(fat);
    // The context is only valid if the calories still match the picked
    // portion — editing them means a different amount, so drop to manual.
    const ctx =
      pendingServing && pendingServing.appliedCalories === calNum ? pendingServing.ctx : null;

    let food: Omit<CustomFood, 'id'>;
    if (ctx?.grams != null) {
      // Grams-first: store the picked portion's gram weight + its macros.
      food = buildCustomFood(
        {
          name,
          brand: ctx.brand,
          barcode: ctx.barcode,
          source: ctx.source,
          serving: { grams: ctx.grams, calories: calNum, protein: p, carbs: c, fat: f },
        },
        new Date(),
      );
    } else {
      // No gram weight (manual entry, or a scan/search food whose DB lacked a
      // serving weight). Omitting `grams` is what selects the honest
      // serving:1 save; source/barcode/brand are kept so even a weightless
      // scan still de-dups by barcode. It goes through buildCustomFood so the
      // isValidCustomFood bounds are applied — hand-building this object
      // skipped them, Firestore rejected the write, and the food was silently
      // lost (Sentry IGNIA-MOBILE-A).
      food = buildCustomFood(
        {
          name,
          brand: ctx?.brand,
          barcode: ctx?.barcode,
          source: ctx?.source ?? 'manual',
          serving: { calories: calNum, protein: p, carbs: c, fat: f },
        },
        new Date(),
      );
    }
    await onSaveCustomFood(food);
  }

  /** Open the manual form. `name` prefills the label — used when the user
   *  arrives from a search miss, where they have already typed what the food
   *  is called and retyping it is pure loss. */
  function openCustomBlank(name = '') {
    haptics.tap();
    setLabel(name);
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
    setMealType(undefined);
    setPendingServing(null);
    setMode('custom');
  }

  /**
   * One ranked list, not four labelled sections.
   *
   * Browse used to stack Recent / My foods / Quick add / Suggested as four
   * peers, each with its own header, so nothing was ranked and the screen read
   * as a wall. The pattern every leading tracker converged on is a single
   * recency-ordered list with search pinned above it — and recency is the most
   * predictive signal for what someone is about to log.
   *
   * Recent and My foods are the same *intent* ("a food I have had before") and
   * differ only in provenance, so they merge, tagged. **Quick add stays a
   * separate pinned strip**: it is a genuinely different action — one tap, no
   * confirmation — and it is the same slot list the home-screen widget and the
   * Quick Settings tile fire, so demoting it would contradict surfaces already
   * shipped.
   *
   * `Suggested` starters still appear, but only when there is nothing else —
   * they are onboarding, not a competing section.
   */
  const browseRows = useMemo(() => {
    const rows: {
      key: string;
      name: string;
      kcal: number;
      tag?: string;
      onLog: () => void;
      onRemove?: () => void;
    }[] = [];
    for (const r of recentEntries) {
      rows.push({
        key: `recent-${r.id}`,
        name: r.mealLabel ?? '',
        kcal: r.calories,
        onLog: () =>
          quickLog({ calories: r.calories, protein: r.protein ?? undefined, mealLabel: r.mealLabel ?? undefined }),
        onRemove: r.mealLabel && onHideRecent ? () => onHideRecent(r.mealLabel as string) : undefined,
      });
    }
    for (const f of customFoods) {
      const m = scaleCustomFood(f, 1);
      rows.push({
        key: `customfood-${f.id}`,
        name: f.name,
        kcal: m.calories,
        tag: t('entry.myFoods'),
        onLog: () =>
          quickLog({ calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, mealLabel: f.name }),
        onRemove: f.id && onDeleteCustomFood ? () => onDeleteCustomFood(f.id as string) : undefined,
      });
    }
    return rows.slice(0, BROWSE_ROW_CAP);
  }, [recentEntries, customFoods, quickLog, onHideRecent, onDeleteCustomFood, t]);

  const browseEmpty = (
    <View style={styles.browse}>
      {/* Quick add — pinned, one tap, no confirmation. */}
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
          <View style={styles.presetStrip}>
            {presets.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.presetChip}
                testID={`preset-${p.id}`}
                onPress={() =>
                  manage
                    ? p.id && onDeletePreset?.(p.id)
                    : quickLog({ calories: p.calories, protein: p.protein, carbs: p.carbs, fat: p.fat, mealLabel: p.name })
                }
              >
                <Text style={styles.presetName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.presetKcal}>{manage ? '✕' : p.calories}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {/* Everything you have logged or saved, most recent first. */}
      {browseRows.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel}>{t('entry.recent')}</Text>
            {onHideRecent || onDeleteCustomFood ? (
              <TouchableOpacity onPress={() => setManage((m) => !m)} hitSlop={8}>
                <Text style={[styles.manageText, manage && styles.manageOn]}>
                  {manage ? t('common.done') : t('common.manage')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {browseRows.map((row) => (
            <TouchableOpacity
              key={row.key}
              style={styles.row}
              testID={row.key}
              onPress={() => (manage ? row.onRemove?.() : row.onLog())}
            >
              <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
              {row.tag ? <Text style={styles.rowTag}>{row.tag}</Text> : null}
              {manage && row.onRemove ? <Text style={styles.rowRemove}>✕</Text> : <Text style={styles.rowKcal}>{row.kcal}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {browseRows.length === 0 && presets.length === 0 ? (
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
    </View>
  );

  const headerIcons = (
    <>
    <View style={styles.iconRow}>
      {/* A plus, not a pencil. `create-outline` is Ionicons' pencil-on-a-square,
          and testers read it as "edit something that exists" — but this button
          opens a blank entry, which is the most common way into the sheet. A
          bare plus is the affordance people already expect for "jot one down".
          The label stays "Write it in": the icon carries the action, the words
          carry which of the four ways in this is. `testID` is unchanged on
          purpose — four Maestro flows and a unit test drive this button by it. */}
      <TouchableOpacity style={styles.primaryBtn} onPress={() => openCustomBlank()} testID="open-manual">
        <Ionicons name="add" size={20} color={colors.ink} />
        <Text style={styles.primaryBtnText}>{t('entry.writeItYourself')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => { haptics.tap(); setMoreOpen((v) => !v); }}
        accessibilityState={{ expanded: moreOpen }}
        testID="open-more"
      >
        <Ionicons name={moreOpen ? 'chevron-up' : 'ellipsis-horizontal'} size={18} color={colors.ink} />
        <Text style={styles.primaryBtnText}>{t('entry.moreWays')}</Text>
      </TouchableOpacity>
    </View>
    {moreOpen ? (
      <View style={styles.moreList}>
        <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('meal'); }} testID="open-mealtext">
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.ink} />
          <Text style={styles.moreRowText}>{t('entry.describeMeal')}</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' ? (
          <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); if (!cameraDenied) setScannerOpen(true); }} testID="open-barcode">
            <Ionicons name="barcode-outline" size={20} color={colors.ink} />
            <Text style={styles.moreRowText}>{t('entry.scanBarcode')}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('recipe'); }} testID="open-recipe">
          <Ionicons name="calculator-outline" size={20} color={colors.ink} />
          <Text style={styles.moreRowText}>{t('entry.recipeBuilder')}</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' ? (
          <TouchableOpacity style={styles.moreRow} onPress={() => { haptics.tap(); setMoreOpen(false); setMode('recipeImport'); }} testID="open-recipe-import">
            <Ionicons name="link-outline" size={20} color={colors.ink} />
            <Text style={styles.moreRowText}>{t('entry.importRecipe')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    ) : null}
    {cameraDenied ? (
      <View style={styles.camDenied}>
        <Text style={styles.camDeniedText}>{t('barcode.permNeeded')}</Text>
        <TouchableOpacity onPress={() => Linking.openSettings()} testID="barcode-perm-settings">
          <Text style={styles.camDeniedLink}>{t('barcode.openSettings')}</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    </>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} backdropTestID="entry-backdrop">
            {/* UX_AUDIT F4: this sheet had no title at all. Every other mode
                below announces itself ("Add food", "Edit entry"); the one most
                people land on opened with a bare search field and left them to
                infer what they were looking at. */}
            {mode === 'browse' ? (
              <>
              <Text style={styles.browseTitle}>{t('entry.browseTitle')}</Text>
              <FoodSearch
                unitSystem={unitSystem}
                seedQuery={searchSeed}
                micSlot={
                  <MicButton
                    onSearch={(text) => setSearchSeed(text)}
                    onMeal={(text) => { setVoiceSeed(text); setMode('meal'); }}
                  />
                }
                headerRight={headerIcons}
                emptyContent={browseEmpty}
                onPick={(est) => prefill(est)}
                onCreateFromQuery={(q) => openCustomBlank(q)}
              />
              </>
            ) : mode === 'recipe' ? (
              <RecipeBuilder onCancel={() => setMode('browse')} onApply={(est) => prefill(est)} />
            ) : mode === 'recipeImport' ? (
              <RecipeImport onCancel={() => setMode('browse')} onApply={(est) => prefill(est)} />
            ) : mode === 'meal' ? (
              <MealText
                forDate={forDate}
                seedText={voiceSeed}
                onCancel={() => { setVoiceSeed(undefined); setMode('browse'); }}
                onAddMany={async (entries) => {
                  for (const entry of entries) await onSave(entry);
                  onClose();
                }}
              />
            ) : (
              <View style={styles.customWrap}>
                <View style={styles.customHead}>
                  {!editing ? (
                    <TouchableOpacity
                      onPress={() => setMode('browse')}
                      hitSlop={8}
                      testID="custom-back"
                      accessibilityRole="button"
                      accessibilityLabel={t('common.back')}
                    >
                      <Ionicons name="chevron-back" size={22} color={colors.ink} />
                    </TouchableOpacity>
                  ) : (
                    <View style={{ width: 22 }} />
                  )}
                  <Text style={styles.title}>{editing ? t('entry.editTitle') : t('entry.addTitle')}</Text>
                  <View style={{ width: 22 }} />
                </View>

                {/* Scrolls so the fields can never push Save/Delete out of the
                    sheet when the keyboard is up — the actions row below stays
                    pinned and reachable. */}
                <ScrollView
                  style={styles.formScroll}
                  contentContainerStyle={styles.form}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
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

                  {showDateRow ? (
                    <Field label={t('entry.date')}>
                      <View style={styles.dateRow}>
                        <TouchableOpacity style={styles.dateStep} onPress={() => shiftEntryDate(-1)} testID="entry-date-prev">
                          <Text style={styles.dateStepText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.dateLabel} testID="entry-date">
                          {formatDate(entryDate, locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </Text>
                        <TouchableOpacity
                          style={[styles.dateStep, isSameDay(entryDate, new Date()) && styles.dateStepDisabled]}
                          onPress={() => shiftEntryDate(1)}
                          disabled={isSameDay(entryDate, new Date())}
                          testID="entry-date-next"
                        >
                          <Text style={styles.dateStepText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </Field>
                  ) : null}

                  {canSavePreset ? (
                    <TouchableOpacity style={styles.savePreset} onPress={saveAsPreset} testID="save-preset">
                      <Text style={styles.savePresetText}>{t('entry.savePreset')}</Text>
                    </TouchableOpacity>
                  ) : null}

                  {canSaveCustomFood ? (
                    <TouchableOpacity style={styles.savePreset} onPress={saveAsCustomFood} testID="save-customfood">
                      <Text style={styles.savePresetText}>{t('entry.saveMyFood')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>

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

      {/* Stays INSIDE the sheet, as it always was: a `<Modal>` renders in its
          own native view and takes no part in the parent's layout, and on iOS
          presenting one from within another is the supported way to stack
          them. Hoisting it to a sibling would change that for no gain. */}
      {scannerOpen ? (
        <BarcodeScanner
          visible={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDenied={() => {
            setScannerOpen(false);
            setCameraDenied(true);
          }}
          onPick={(est) => {
            setScannerOpen(false);
            prefill(est);
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

/** Plain text input styled to the sheet — shared look for the custom form. */
function TextInputBase(props: React.ComponentProps<typeof TextInput>) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  // Dynamic Type is honoured here, up to a cap.
  //
  // This used to be `allowFontScaling={false}`, which fixed a real bug the
  // wrong way: a large iOS text setting scaled the placeholder past the field's
  // fixed 52pt height and clipped it. Turning scaling off cured the clipping by
  // ignoring the accessibility setting entirely — in the app's most-used input,
  // for exactly the users who need it most.
  //
  // The field now grows instead (`minHeight`, see `input` below), and the
  // multiplier is capped at 1.4: past that the number pad and the macro grid
  // stop fitting side by side on a small phone, and a form that cannot be
  // completed is worse for the same user than one with slightly small text.
  return (
    <TextInput
      style={styles.input}
      placeholderTextColor={colors.faint}
      maxFontSizeMultiplier={1.4}
      {...props}
    />
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const createStyles = ({ scheme, colors, shadow }: Theme) => StyleSheet.create({
  fill: { flex: 1 },
  // backdrop / sheetWrap / sheet / grabZone / handle all moved to
  // `<BottomSheet>`, which this file's originals were copied into. Its
  // defaults are these values byte for byte, so the swap changes nothing here
  // except which file owns them.
  // browse
  browseTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.sm },
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
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  primaryBtnText: { fontSize: font.small, fontWeight: '600', color: colors.ink },
  moreList: { marginTop: space.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, overflow: 'hidden' },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.md },
  moreRowText: { fontSize: font.body, color: colors.ink },
  presetStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.ink },
  presetName: { fontSize: font.small, fontWeight: '600', color: colors.onInk, maxWidth: 150 },
  presetKcal: { fontSize: font.tiny, color: colors.onInk, opacity: 0.7 },
  rowTag: { fontSize: font.tiny, color: colors.muted, marginRight: space.sm },
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
    backgroundColor: colors.inputBg,
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
    backgroundColor: colors.inputBg,
  },
  // Camera-denied notice (shown in place, after the scan icon bows out).
  camDenied: { marginTop: space.sm, gap: 2 },
  camDeniedText: { fontSize: font.tiny, color: colors.muted },
  camDeniedLink: { fontSize: font.tiny, color: colors.ink, fontWeight: '700', textDecorationLine: 'underline' },
  // custom
  customWrap: { flexShrink: 1 },
  customHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  formScroll: { flexShrink: 1 },
  form: { gap: space.md, paddingBottom: space.md },
  row3: { flexDirection: 'row', gap: space.sm },
  third: { flex: 1 },
  fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    // `minHeight`, not `height`: the field has to be able to grow when Dynamic
    // Type scales its text (see TextInputBase). The floor keeps iOS centring the
    // placeholder deterministically at the default size, which is the RN quirk
    // the fixed height was originally working around.
    minHeight: 52,
    fontSize: font.body,
    color: colors.ink,
    textAlignVertical: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colors.inputBg,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: font.small, color: colors.muted, textTransform: 'capitalize' },
  chipTextOn: { color: colors.onInk },
  savePreset: { alignSelf: 'flex-start', paddingVertical: space.xs },
  savePresetText: { fontSize: font.small, color: colors.accent, fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  dateStep: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  dateStepDisabled: { opacity: 0.4 },
  dateStepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  dateLabel: { flex: 1, textAlign: 'center', fontSize: font.body, color: colors.ink, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: space.md, paddingTop: space.md, alignItems: 'center' },
  delete: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  save: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
