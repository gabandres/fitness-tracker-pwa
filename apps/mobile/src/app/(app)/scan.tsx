import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  findRepeatCandidates,
  hasUngroundedItems,
  rescaleScannedItem,
  sumScannedMacros,
  type CustomFood,
  type RepeatCandidate,
  type ScannedFoodItem,
} from '@macrolog/core';
import { HeaderAvatar } from '@/components/HeaderAvatar';
import { useToday } from '@/hooks/useToday';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import {
  analyzeMealPhoto,
  encodeMealPhoto,
  pickMealPhoto,
  scanErrorMessage,
  type ScanSource,
} from '@/lib/mealScan';
import { quotaResetLabel } from '@/lib/date-format';
import { track } from '@/lib/analytics';
import { clearLogTimer, startLogTimer } from '@/lib/log-timer';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

/**
 * `describe` sits between picking the photo and sending it (ADR-0029 item 1).
 *
 * It costs one tap on a flow that had none, which is a real price, and it is
 * paid for twice over:
 *
 * 1. It is the only moment a note can exist. The note has to travel WITH the
 *    image — the model reads both together — so there is no way to collect it
 *    during `analyzing`, when the call has already left.
 * 2. It is where repeat detection runs, BEFORE any model call. A note that
 *    matches My Foods can end the flow with zero tokens spent and zero quota
 *    consumed, which turns the extra tap from a tax into a shortcut.
 *
 * The ADR proposed collecting the note pre-capture, on the reasoning that it
 * frames the shot. The owner's actual workflow is photo-first, and the ADR's own
 * instruction was to settle this by trying it rather than arguing — so it is
 * post-capture, where the user can see what they are describing.
 */
type Phase = 'intro' | 'describe' | 'analyzing' | 'review';
const PORTION_STEPS = [0.5, 1, 1.5, 2] as const;

/**
 * Images per scan (ADR-0029 item 5). Must match `MAX_PHOTOS` in
 * `functions/src/analyze-photo.ts`, which rejects anything above it — this
 * copy exists to stop the user reaching that rejection, not to enforce it.
 */
const MAX_PHOTOS = 3;

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
  // `customFoods` is already on this hook, so repeat detection adds NO new
  // Firestore subscription (ADR-0016's per-hook model, unchanged).
  const { addEntry, customFoods } = useToday();

  // Seconds-per-log stopwatch (`lib/log-timer.ts`): the scan screen is a
  // logging surface, so the clock runs from the intro to the review's Add —
  // the wait a person actually experiences, model round-trip included.
  useEffect(() => {
    startLogTimer();
    return () => clearLogTimer();
  }, []);

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ScannedFoodItem[]>([]);
  const [mealName, setMealName] = useState('');
  const [lowConf, setLowConf] = useState(false);
  // The server has always returned this and the app has never shown it, so a
  // user met the daily cap as a wall rather than as a countdown.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** Which portion chip is active. 1× is the scan as returned. */
  const [portion, setPortion] = useState(1);
  /** The just-captured frame, shown under the progress so the wait has a subject. */
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<ScanStep>('preparing');
  /** The user's own words about this meal (ADR-0029 item 1). Optional, always. */
  const [note, setNote] = useState('');
  /**
   * The picked photos, held while the user is on the describe step.
   *
   * Up to {@link MAX_PHOTOS} of ONE meal (ADR-0029 item 5). Every image is
   * charged against the daily quota separately, so the count is shown wherever
   * it can be — a free user spending all three daily scans on one meal should
   * know that before tapping Analyze, not after.
   */
  const [pendingUris, setPendingUris] = useState<string[]>([]);

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

    // Stop here. The photo is picked; the note and the repeat check happen
    // before anything is sent, which is the whole point of the step.
    // Appending, not replacing: this is also the "add another angle" path.
    setPendingUris((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, uri]));
    if (phase !== 'describe') setNote('');
    setPhase('describe');
  }

  /** Drop one pending photo. Removing the last one returns to the intro. */
  function removePending(index: number) {
    haptics.tap();
    setPendingUris((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.length) setPhase('intro');
      return next;
    });
  }

  /**
   * Send the pending photo, with whatever the user typed.
   *
   * Everything below the picker is unchanged from before the describe step
   * existed, including the ordering that made the wait legible: the phase flips
   * and the captured frame renders first, and the encode runs behind it.
   */
  async function onAnalyze() {
    const uris = pendingUris;
    if (!uris.length) return;
    haptics.tap();

    setPreview(uris[0]);
    setStep('preparing');
    setPhase('analyzing');

    try {
      track('photo_scan');
      // Encoded in parallel — three sequential resizes on a mid device is
      // three times the dead air, and they do not depend on each other.
      const encoded = (await Promise.all(uris.map(encodeMealPhoto))).filter(
        (b): b is string => typeof b === 'string' && b.length > 0,
      );
      if (!encoded.length) throw new Error('encode');

      setStep('reading');
      const scan = await analyzeMealPhoto(encoded, locale, note);
      if (!scan.items.length) throw new Error('empty');

      setStep('resolving');
      setItems(scan.items);
      setPortion(1);
      setMealName(defaultMealName(scan.items, t('scan.mealName')));
      setLowConf(scan.confidence === 'low');
      setRemaining(scan.photosRemaining ?? null);
      setPhase('review');
      haptics.success();
    } catch (e) {
      // Say what actually went wrong. This used to be a bare `catch {}` that
      // rendered "Couldn't read that photo" for every failure — including the
      // daily quota, which is not about the photo and which retaking it can
      // only make worse. See `scanErrorMessage`.
      const { key, params } = scanErrorMessage(e);
      setError(t(key, { ...params, time: quotaResetLabel(locale) }));
      setPhase('intro');
      haptics.warning();
    } finally {
      setPreview(null);
      setPendingUris([]);
    }
  }

  /**
   * Log a prior food straight from the describe step (ADR-0029 item 3).
   *
   * **No model call, no quota slot, no spend.** The macros are ones this person
   * entered and kept, which is better evidence for their own food than anything
   * a vision model produces from a photograph of it.
   *
   * The stated quantity is applied only when the note actually stated one —
   * `findRepeatCandidates` returns `null` rather than 1 for an unstated amount,
   * so "greek yogurt" logs one stored serving and "2 cups of greek yogurt" does
   * not silently become one.
   */
  async function logRepeat(c: RepeatCandidate<CustomFood>) {
    if (saving) return;
    haptics.tap();
    setSaving(true);
    try {
      const mult = c.quantity != null && c.quantity > 0 ? c.quantity : 1;
      const f = c.food;
      await addEntry({
        calories: Math.round(f.calories * mult),
        protein: Math.round((f.protein ?? 0) * mult),
        carbs: Math.round((f.carbs ?? 0) * mult),
        fat: Math.round((f.fat ?? 0) * mult),
        mealLabel: f.name,
      });
      haptics.success();
      router.replace('/(app)');
    } finally {
      setSaving(false);
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
        // The ONE place a photo-scanned row is distinguishable from a typed one
        // (#109). It is what `first-scan` is awarded on, so it is set here and
        // nowhere else — `logRepeat` above deliberately does NOT set it: that
        // path makes no model call, spends no quota and reads no photograph,
        // and marking it `photo` would award the milestone to somebody who
        // never took one.
        source: 'photo',
      });
      haptics.success();
      router.replace('/(app)'); // back to Today — rings re-sweep to the new total
    } finally {
      setSaving(false);
    }
  }

  const total = sumScannedMacros(items);
  const ungrounded = hasUngroundedItems(items);
  /** Any item whose grams came off a scale in the photo (ADR-0029 item 2/4). */
  const anyMeasured = items.some((i) => i.measured);
  /**
   * Prior foods this note plausibly names. Recomputed as the user types, which
   * is free — the matcher is pure, runs over the already-subscribed My Foods
   * list, and makes no network call.
   *
   * It returns `[]` for most notes on purpose. See `meal-repeat.ts`: a wrong
   * "you logged this before" is worse than no suggestion, because it is offered
   * at the moment the user is least likely to check it.
   */
  const repeats = findRepeatCandidates(note, customFoods);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <PressScale style={styles.back} onPress={() => router.back()} scaleTo={0.9} testID="scan-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </PressScale>
        <Text style={styles.title}>{t('scan.title')}</Text>
        <HeaderAvatar />
      </View>

      {phase === 'describe' ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* One photo fills the width; several become a strip. A single
              image is the overwhelmingly common case and should not be shrunk
              into a gallery to accommodate a case the user has not chosen. */}
          {pendingUris.length === 1 ? (
            <Image source={{ uri: pendingUris[0] }} style={styles.notePreview} resizeMode="cover" />
          ) : (
            <View style={styles.shotRow}>
              {pendingUris.map((uri, i) => (
                <View key={uri} style={styles.shotWrap}>
                  <Image source={{ uri }} style={styles.shot} resizeMode="cover" />
                  <PressScale
                    style={styles.shotRemove}
                    scaleTo={0.9}
                    onPress={() => removePending(i)}
                    testID={`scan-shot-remove-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.remove')}
                  >
                    <Ionicons name="close" size={14} color={colors.onInk} />
                  </PressScale>
                </View>
              ))}
            </View>
          )}

          {pendingUris.length < MAX_PHOTOS ? (
            <PressScale
              style={styles.addShot}
              scaleTo={0.97}
              onPress={() => onCapture('library')}
              testID="scan-add-photo"
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={colors.ink} />
              <Text style={styles.addShotText}>
                {t('scan.addPhoto', { n: MAX_PHOTOS - pendingUris.length })}
              </Text>
            </PressScale>
          ) : null}

          {pendingUris.length > 1 ? (
            <View style={styles.hintRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
              <Text style={styles.hintText}>{t('scan.multiCost', { n: pendingUris.length })}</Text>
            </View>
          ) : null}

          <Animated.View entering={enterUp(0)}>
            <Text style={styles.noteTitle}>{t('scan.noteTitle')}</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder={t('scan.notePlaceholder')}
              placeholderTextColor={colors.faint}
              multiline
              maxLength={250}
              testID="scan-note"
            />
            <Text style={styles.noteHelp}>{t('scan.noteHelp')}</Text>
          </Animated.View>

          {/* Repeat detection (ADR-0029 item 3). Shown only when the matcher is
              confident, which is rarely — see meal-repeat.ts. Tapping one logs
              the user's OWN stored macros and never calls the model. */}
          {repeats.length ? (
            <Animated.View style={styles.repeatBox} entering={enterUp(1)}>
              <Text style={styles.repeatTitle}>{t('scan.repeatTitle')}</Text>
              {repeats.map((c) => (
                <PressScale
                  key={c.food.id ?? c.food.name}
                  style={styles.repeatRow}
                  scaleTo={0.97}
                  onPress={() => logRepeat(c)}
                  testID={`scan-repeat-${c.food.id ?? c.food.name}`}
                  accessibilityRole="button"
                >
                  <View style={styles.repeatMain}>
                    <Text style={styles.repeatName} numberOfLines={1}>{c.food.name}</Text>
                    <Text style={styles.repeatMeta} numberOfLines={1}>
                      {Math.round(c.food.calories)} kcal
                      {c.brandMatched && c.food.brand
                        ? ` · ${t('scan.repeatBrand', { brand: c.food.brand })}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.repeatUse}>{t('scan.repeatUse')}</Text>
                </PressScale>
              ))}
            </Animated.View>
          ) : null}

          <PressScale
            style={styles.noteAnalyze}
            scaleTo={0.97}
            onPress={onAnalyze}
            testID="scan-analyze"
            accessibilityRole="button"
          >
            <Text style={styles.noteAnalyzeText}>{t('scan.noteAnalyze')}</Text>
          </PressScale>
          <PressScale
            style={styles.noteRetake}
            scaleTo={0.97}
            onPress={() => { haptics.tap(); setPhase('intro'); setPendingUris([]); setNote(''); }}
            testID="scan-describe-cancel"
          >
            <Text style={styles.noteRetakeText}>{t('scan.retake')}</Text>
          </PressScale>
        </ScrollView>
      ) : phase === 'analyzing' ? (
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
              <Animated.View style={styles.hintRow} entering={enterUp(4)}>
                <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
                <Text style={styles.hintText}>{t('scan.estimateHint')}</Text>
              </Animated.View>
            ) : null}

            {anyMeasured ? (
              <Animated.View style={styles.hintRow} entering={enterUp(4)}>
                <Ionicons name="scale-outline" size={16} color={colors.muted} />
                <Text style={styles.hintText}>{t('scan.measuredHint')}</Text>
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
            {remaining != null && remaining <= 2 ? (
              <Text style={styles.remaining}>{t('scan.remaining', { n: remaining })}</Text>
            ) : null}
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
        {/* A weighed portion and a guessed one must not look the same
            (ADR-0029 item 4). `grams` is the only number the model contributes
            and every macro scales off it, so this is the difference between a
            measurement and an estimate — the same distinction ADR-0027 insisted
            on for a 2022 menu figure shown as today's. Rendered ALONGSIDE the
            source line, not instead of it: they answer different questions
            (where the macros came from vs where the weight came from). */}
        {item.measured ? (
          <View style={styles.measuredRow}>
            <Ionicons name="scale-outline" size={13} color={colors.teal} />
            <Text style={styles.measuredText}>{t('scan.measured' as never)}</Text>
          </View>
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
    remaining: { color: colors.muted, fontSize: font.small, textAlign: 'center', marginTop: space.xs },
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
    hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
    hintText: { flex: 1, fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },

    // ── The describe step (ADR-0029 item 1) ───────────────────────
    noteTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink, marginBottom: space.sm },
    noteInput: {
      minHeight: 84,
      textAlignVertical: 'top',
      backgroundColor: colors.inputBg,
      borderRadius: radius.md,
      padding: space.md,
      fontSize: font.body,
      color: colors.ink,
    },
    noteHelp: { fontSize: font.small, color: colors.muted, marginTop: space.xs, lineHeight: font.small * 1.4 },
    /**
     * The photo fills the width on this step, unlike the 200×200 `preview` the
     * ANALYZING step uses. Different job: there the image is a subject for the
     * wait, here it is the thing the user is about to describe, and describing
     * a thumbnail with half the screen empty beside it reads as a broken layout.
     */
    notePreview: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.card },
    shotRow: { flexDirection: 'row', gap: space.sm },
    shotWrap: { flex: 1, aspectRatio: 1 },
    shot: { width: '100%', height: '100%', borderRadius: radius.md, backgroundColor: colors.card },
    shotRemove: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addShot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.line,
      paddingVertical: space.md,
    },
    addShotText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    noteAnalyze: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    noteAnalyzeText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    /**
     * **Its own style, and NOT `styles.retake`.** That one carries
     * `paddingHorizontal` and no `paddingVertical`, which works only because
     * the review screen puts it in a flex ROW beside `add` — row stretch gives
     * it `add`'s height for free. Reused standalone in this column it collapses
     * to bare text height and renders as a squashed full-width pill, which is
     * exactly how it shipped on 2026-08-26 and what the owner reported.
     *
     * Metrics are deliberately `noteAnalyze`'s, minus the fill: same
     * `paddingVertical`, same radius, so the two buttons read as a pair.
     */
    noteRetake: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingVertical: space.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noteRetakeText: { fontSize: font.h3, fontWeight: '700', color: colors.ink },

    // ── Repeat detection (ADR-0029 item 3) ────────────────────────
    repeatBox: { gap: space.sm },
    repeatTitle: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    repeatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
    },
    repeatMain: { flex: 1, gap: 2 },
    repeatName: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    repeatMeta: { fontSize: font.small - 1, color: colors.muted },
    repeatUse: { fontSize: font.small, fontWeight: '700', color: colors.accent },

    // ── A weighed portion, marked (ADR-0029 items 2 + 4) ──────────
    measuredRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    measuredText: { fontSize: font.small - 1, color: colors.teal, fontWeight: '700' },
    footer: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
    retake: { paddingHorizontal: space.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
    retakeText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    add: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    addDisabled: { opacity: 0.5 },
    addText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
  });
}
