import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { hasUngroundedItems, rescaleScannedItem, sumScannedMacros, type ScannedFoodItem } from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { useToday } from '@/hooks/useToday';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { analyzeMealPhoto, encodeMealPhoto, pickMealPhoto, type ScanSource } from '@/lib/mealScan';
import { track } from '@/lib/analytics';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

type Phase = 'intro' | 'analyzing' | 'review';
const PORTION_STEPS = [0.5, 1, 1.5, 2] as const;

/**
 * The three things a scan actually does, in the order it does them, each named
 * for what the user gets rather than what the code calls.
 *
 * Naming the wait is the cheapest latency work available here. The server side
 * is ~7.4 s on a cold instance and roughly half of that is Cloud Run starting a
 * container — a cost the cost rules say we accept rather than pay `minInstances`
 * to avoid (see `functions/src/analyze-photo.ts`). Given a wait we are not
 * removing, the remaining lever is making it read as progress instead of as a
 * hang. `resolving` is genuinely brief; it is listed because a step that
 * appears and passes quickly still tells the user the thing is moving.
 */
const SCAN_STEPS = ['preparing', 'reading', 'resolving'] as const;
type ScanStep = (typeof SCAN_STEPS)[number];

const STEP_LABEL: Record<ScanStep, I18nKey> = {
  preparing: 'scan.stepPreparing',
  reading: 'scan.stepReading',
  resolving: 'scan.stepResolving',
};

/**
 * Photo scan review (ADR-0015 §1).
 *
 * The server returns an ITEMIZED result — each food it recognized, with a
 * portion in grams and macros resolved from the bundled USDA database — so this
 * screen edits a list, not a single black-box total. Editing an item's grams
 * rescales its macros linearly, which is the correction users actually need:
 * the vision model is good at naming food and imperfect at sizing it, and the
 * grams are now the only number it contributes.
 *
 * Items the database could not resolve (mofongo, pernil — regional dishes USDA
 * does not carry) fall back to the model's own numbers and are marked. That
 * distinction is worth showing: ADR-0015 measured LLM protein estimates at >60%
 * error, so a model-sourced row deserves less trust than a database-sourced one,
 * and presenting both identically would hide exactly the thing the architecture
 * exists to fix.
 *
 * The whole plate is still logged as ONE entry, summed. Splitting it into N
 * `DailyLog` rows would change what streaks, counts and the Today list mean for
 * a single meal; that is a product decision, not a consequence of itemizing the
 * review.
 */
export default function Scan() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { addEntry } = useToday();

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ScannedFoodItem[]>([]);
  const [mealName, setMealName] = useState('');
  const [lowConf, setLowConf] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Which portion chip is active. 1× is the scan as returned. */
  const [portion, setPortion] = useState(1);
  /** The just-captured frame, shown under the progress so the wait has a subject. */
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<ScanStep>('preparing');

  /**
   * Capture → analyze, with the waiting made legible.
   *
   * The ordering here is load-bearing. This used to `await captureMealPhoto()`
   * — picker AND resize AND base64 encode — before calling `setPhase`, so the
   * image work happened with the intro screen still rendered and no indicator
   * anywhere. On a mid device that is half a second to a second and a half in
   * which the app looks like it ignored the tap. Now the phase flips and the
   * captured frame renders the moment the picker returns; encoding runs behind
   * it.
   *
   * `step` drives the labelled progress. It is advanced from real transitions,
   * never a timer: a fake progress bar that finishes before the work does is
   * worse than a spinner, because it teaches users the app lies about waiting.
   */
  async function onCapture(source: ScanSource) {
    haptics.tap();
    setError(null);
    const uri = await pickMealPhoto(source);
    if (!uri) return; // cancelled or permission denied (no error banner on cancel)

    setPreview(uri);
    setStep('preparing');
    setPhase('analyzing');

    try {
      track('photo_scan');
      const base64 = await encodeMealPhoto(uri);
      if (!base64) throw new Error('encode');

      setStep('reading');
      const scan = await analyzeMealPhoto(base64, locale);
      if (!scan.items.length) throw new Error('empty');

      setStep('resolving');
      setItems(scan.items);
      setPortion(1);
      setMealName(defaultMealName(scan.items, t('scan.mealName')));
      setLowConf(scan.confidence === 'low');
      setPhase('review');
      haptics.success();
    } catch {
      setError(t('scan.failed'));
      setPhase('intro');
      haptics.warning();
    } finally {
      setPreview(null);
    }
  }

  /**
   * Portion chips scale the WHOLE plate — "that was a bigger serving than it
   * looks" — while per-item grams handle one food being off.
   *
   * ## The chips are ABSOLUTE, not multipliers on what is already there
   *
   * This used to be `scalePortion(it, mult)` applied to the current items,
   * which compounded: 1.5× twice was 2.25×, **1× was a no-op rather than a
   * reset**, and 0.5× then 1× left the plate permanently at half. Nothing on
   * screen said which portion was active, so the drift was invisible — reported
   * from a device 2026-08-08.
   *
   * Scaling by `next / portion` makes each chip mean what it says, makes them
   * idempotent, and keeps any per-item gram edits the user has already made
   * (they ride along proportionally, which is the intent — the chip is about
   * the serving, not about correcting one food).
   */
  function applyPortion(next: number) {
    if (next === portion) return;
    haptics.tap();
    const relative = next / portion;
    setItems((prev) => prev.map((it) => scalePortion(it, relative)));
    setPortion(next);
  }

  function editGrams(index: number, raw: string) {
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    setItems((prev) =>
      prev.map((it, i) => (i === index ? rescaleScannedItem(it, Number.isFinite(n) ? n : 0) : it)),
    );
  }

  function editName(index: number, value: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, name: value } : it)));
  }

  function removeItem(index: number) {
    haptics.tap();
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function onAdd() {
    if (!items.length || saving) return;
    setSaving(true);
    try {
      const total = sumScannedMacros(items);
      await addEntry({
        calories: Math.round(total.calories),
        protein: Math.round(total.protein),
        carbs: Math.round(total.carbs),
        fat: Math.round(total.fat),
        mealLabel: mealName.trim() || t('scan.mealName'),
      });
      haptics.success();
      router.replace('/(app)'); // back to Today — rings re-sweep to the new total
    } finally {
      setSaving(false);
    }
  }

  const total = sumScannedMacros(items);
  const ungrounded = hasUngroundedItems(items);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <PressScale style={styles.back} onPress={() => router.back()} scaleTo={0.9} testID="scan-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </PressScale>
        <Text style={styles.title}>{t('scan.title')}</Text>
        <HeaderAvatar />
      </View>

      {phase === 'analyzing' ? (
        <View style={styles.fill}>
          {/* The captured frame, so the wait has a subject and the user can see
              the app got the right photo without waiting to find out. */}
          {preview ? <Image source={{ uri: preview }} style={styles.preview} /> : null}
          <View style={styles.steps}>
            {SCAN_STEPS.map((s, i) => {
              const active = s === step;
              const done = SCAN_STEPS.indexOf(step) > i;
              return (
                <View key={s} style={styles.stepRow}>
                  {done ? (
                    <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
                  ) : active ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={colors.faint} />
                  )}
                  <Text
                    style={[
                      styles.stepText,
                      active && styles.stepTextOn,
                      done && styles.stepTextDone,
                    ]}
                  >
                    {t(STEP_LABEL[s])}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : phase === 'review' && items.length ? (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            {lowConf ? (
              <Animated.View style={styles.lowConf} entering={enterUp(0)}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.ink} />
                <Text style={styles.lowConfText}>{t('scan.lowConf')}</Text>
              </Animated.View>
            ) : null}

            {/* Hero total (the reward moment), on the shared dark panel. */}
            <Animated.View style={styles.heroPanel} entering={enterUp(lowConf ? 1 : 0)}>
              <View style={styles.hero}>
                <CountUpText value={Math.round(total.calories)} style={styles.heroValue} testID="scan-calories" />
                <Text style={styles.heroUnit}>kcal</Text>
              </View>
              <TextInput
                style={styles.nameInput}
                value={mealName}
                onChangeText={setMealName}
                placeholder={t('scan.mealName')}
                placeholderTextColor={colors.heroMuted}
                testID="scan-name"
              />
            </Animated.View>

            {/* Read-only macro totals — the editable numbers are the per-item
                grams below, since every macro is derived from them. */}
            <Animated.View style={styles.totalRow} entering={enterUp(2)}>
              <TotalChip label={t('history.protein')} value={total.protein} styles={styles} testID="scan-protein" />
              <TotalChip label={t('today.carbs')} value={total.carbs} styles={styles} testID="scan-carbs" />
              <TotalChip label={t('today.fat')} value={total.fat} styles={styles} testID="scan-fat" />
            </Animated.View>

            {/* Items */}
            <Animated.View entering={enterUp(3)} style={styles.itemsBlock}>
              <Text style={styles.section}>{t('scan.items')}</Text>
              {items.map((it, i) => (
                <ItemRow
                  key={`${i}-${it.fdcId ?? it.name}`}
                  item={it}
                  index={i}
                  styles={styles}
                  colors={colors}
                  t={t}
                  onName={editName}
                  onGrams={editGrams}
                  onRemove={removeItem}
                />
              ))}
            </Animated.View>

            {ungrounded ? (
              <Animated.View style={styles.noteRow} entering={enterUp(4)}>
                <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
                <Text style={styles.noteText}>{t('scan.estimateHint')}</Text>
              </Animated.View>
            ) : null}

            {/* Whole-plate portion */}
            <Animated.View entering={enterUp(5)}>
              <Text style={styles.section}>{t('scan.portion')}</Text>
              <View style={styles.portionRow}>
                {PORTION_STEPS.map((p) => (
                  <PressScale
                    key={p}
                    style={[styles.portionChip, p === portion && styles.portionChipOn]}
                    scaleTo={0.92}
                    onPress={() => applyPortion(p)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: p === portion }}
                    testID={`portion-${p}`}
                  >
                    <Text style={[styles.portionText, p === portion && styles.portionTextOn]}>
                      {p === 1 ? '1×' : `${p}×`}
                    </Text>
                  </PressScale>
                ))}
              </View>
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            <PressScale style={styles.retake} scaleTo={0.96} onPress={() => { haptics.tap(); setPhase('intro'); setItems([]); setPortion(1); }} testID="scan-retake">
              <Text style={styles.retakeText}>{t('scan.retake')}</Text>
            </PressScale>
            <PressScale style={[styles.add, saving && styles.addDisabled]} scaleTo={0.97} onPress={onAdd} disabled={saving} testID="scan-add">
              <Text style={styles.addText}>{saving ? t('common.saving') : t('scan.addToday')}</Text>
            </PressScale>
          </View>
        </>
      ) : (
        <View style={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Animated.View style={styles.introCard} entering={enterUp(0)}>
            <View style={styles.cameraCircle}>
              <Ionicons name="camera" size={40} color={colors.onInk} />
            </View>
            <Text style={styles.introHint}>{t('scan.hint')}</Text>
          </Animated.View>
          <Animated.View entering={enterUp(1)}>
            <PressScale style={styles.primary} scaleTo={0.97} onPress={() => onCapture('camera')} testID="scan-take">
              <Ionicons name="camera-outline" size={20} color={colors.onInk} />
              <Text style={styles.primaryText}>{t('scan.take')}</Text>
            </PressScale>
          </Animated.View>
          <Animated.View entering={enterUp(2)}>
            <PressScale style={styles.secondary} scaleTo={0.97} onPress={() => onCapture('library')} testID="scan-choose">
              <Ionicons name="images-outline" size={20} color={colors.ink} />
              <Text style={styles.secondaryText}>{t('scan.choose')}</Text>
            </PressScale>
          </Animated.View>
          {/* Manual/text entry stays free forever (ADR-0015) — one tap away via
              Today's existing add sheet (openAdd nonce). */}
          <Animated.View entering={enterUp(3)}>
            <PressScale
              style={styles.manual}
              scaleTo={0.97}
              onPress={() => {
                haptics.tap();
                router.replace({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
              }}
              testID="scan-manual"
            >
              <Ionicons name="create-outline" size={18} color={colors.muted} />
              <Text style={styles.manualText}>{t('scan.manual')}</Text>
            </PressScale>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

function ItemRow({
  item,
  index,
  styles,
  colors,
  t,
  onName,
  onGrams,
  onRemove,
}: {
  item: ScannedFoodItem;
  index: number;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  // Was `(k: never) => string` — a deliberate 'this row renders no copy'
  // marker. It now does: the remove button needs a label for VoiceOver, and a
  // label is copy.
  t: TFn;
  onName: (i: number, v: string) => void;
  onGrams: (i: number, v: string) => void;
  onRemove: (i: number) => void;
}) {
  const estimated = item.source === 'model';
  return (
    <View style={styles.itemRow} testID={`scan-item-${index}`}>
      <View style={styles.itemMain}>
        <TextInput
          style={styles.itemName}
          value={item.name}
          onChangeText={(v) => onName(index, v)}
          testID={`scan-item-name-${index}`}
        />
        <Text style={styles.itemMacros}>
          {Math.round(item.calories)} kcal · {Math.round(item.protein)}P · {Math.round(item.carbs)}C · {Math.round(item.fat)}F
        </Text>
        {estimated ? (
          <Text style={styles.itemEstimate}>{t('scan.sourceEstimate' as never)}</Text>
        ) : item.matchedDescription ? (
          <Text style={styles.itemMatched} numberOfLines={1}>
            {item.matchedDescription}
          </Text>
        ) : null}
      </View>
      <View style={styles.itemGramsWrap}>
        <TextInput
          style={styles.itemGrams}
          value={String(Math.round(item.grams))}
          onChangeText={(v) => onGrams(index, v)}
          keyboardType="numeric"
          selectTextOnFocus
          testID={`scan-item-grams-${index}`}
        />
        <Text style={styles.itemGramsUnit}>g</Text>
      </View>
      <PressScale
        style={styles.itemRemove}
        scaleTo={0.9}
        onPress={() => onRemove(index)}
        testID={`scan-item-remove-${index}`}
        accessibilityRole="button"
        accessibilityLabel={t('common.remove')}
      >
        <Ionicons name="close" size={18} color={colors.muted} />
      </PressScale>
    </View>
  );
}

function TotalChip({
  label,
  value,
  styles,
  testID,
}: {
  label: string;
  value: number;
  styles: ReturnType<typeof createStyles>;
  testID: string;
}) {
  return (
    <View style={styles.totalChip}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.totalValue} testID={testID}>
        {Math.round(value)}
      </Text>
    </View>
  );
}

/** Name the log entry after what is on the plate, not after "Meal". */
function defaultMealName(items: ScannedFoodItem[], fallback: string): string {
  const names = items.map((i) => i.name).filter(Boolean);
  if (names.length === 0) return fallback;
  if (names.length <= 2) return names.join(' + ');
  return `${names[0]} +${names.length - 1}`;
}

/** Scale one item by a portion factor. Grams-based where we have a portion;
 *  for a model-fallback whole-meal row (grams 0) the macros scale directly. */
function scalePortion(item: ScannedFoodItem, mult: number): ScannedFoodItem {
  if (item.grams > 0) return rescaleScannedItem(item, item.grams * mult);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...item,
    calories: Math.round(item.calories * mult),
    protein: round(item.protein * mult),
    carbs: round(item.carbs * mult),
    fat: round(item.fat * mult),
  };
}

function createStyles({ colors, shadow }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
    back: { padding: 2 },
    title: { flex: 1, fontFamily: type.display, fontSize: font.h2, color: colors.ink },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.xl },
    analyzing: { fontSize: font.body, color: colors.muted },
    preview: {
      width: 200,
      height: 200,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
    },
    // Left-aligned as a block, centred as a whole: a checklist whose rows start
    // at different x-positions reads as jitter rather than as progress.
    steps: { gap: space.md, alignSelf: 'center' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    stepText: { fontSize: font.body, color: colors.faint },
    stepTextOn: { color: colors.ink, fontWeight: '600' },
    stepTextDone: { color: colors.muted },
    body: { padding: space.xl, gap: space.md, flexGrow: 1 },
    error: { color: colors.danger, fontSize: font.small, textAlign: 'center' },
    // intro
    introCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
    cameraCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', ...shadow.e2 },
    introHint: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.lg, lineHeight: font.body * 1.4 },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg },
    primaryText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.lg },
    secondaryText: { color: colors.ink, fontSize: font.h3, fontWeight: '700' },
    manual: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.md },
    manualText: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
    // review
    lowConf: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
    lowConfText: { flex: 1, fontSize: font.small, color: colors.ink },
    heroPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm, ...shadow.e2 },
    hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs },
    heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
    heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
    nameInput: { minWidth: 160, textAlign: 'center', color: colors.heroText, fontFamily: type.heading, fontSize: font.h3, paddingVertical: space.xs },
    section: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.xs },
    portionRow: { flexDirection: 'row', gap: space.sm },
    portionChip: { flex: 1, alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.md },
    portionChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    portionText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    portionTextOn: { color: colors.onInk },
    macroLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    // totals
    totalRow: { flexDirection: 'row', gap: space.sm },
    totalChip: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: colors.inputBg, borderRadius: radius.md, paddingVertical: space.md },
    totalValue: { fontSize: font.h3, fontWeight: '700', color: colors.ink },
    // items
    itemsBlock: { gap: space.sm },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
    itemMain: { flex: 1, gap: 2 },
    itemName: { fontSize: font.body, fontWeight: '700', color: colors.ink, paddingVertical: 2 },
    itemMacros: { fontSize: font.small, color: colors.muted },
    itemMatched: { fontSize: font.small - 1, color: colors.muted, opacity: 0.8 },
    itemEstimate: { fontSize: font.small - 1, color: colors.accent, fontWeight: '700' },
    itemGramsWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    itemGrams: { minWidth: 52, textAlign: 'right', backgroundColor: colors.inputBg, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, fontSize: font.body, color: colors.ink },
    itemGramsUnit: { fontSize: font.small, color: colors.muted },
    itemRemove: { padding: 4 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
    noteText: { flex: 1, fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },
    footer: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
    retake: { paddingHorizontal: space.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
    retakeText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    add: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    addDisabled: { opacity: 0.5 },
    addText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
  });
}
