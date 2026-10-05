import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  type UnitSystem,
  WEIGH_IN_MIN_DATE_KEY,
  bodyWeightUnit,
  checkWeightEntry,
  parseYmd,
  parseWeightToLb,
  previousWeighIn,
  sameDisplayedWeight,
  toDisplayWeight,
  weightBoundsFor,
} from '@macrolog/core';
import { BottomSheet, type SheetCloseVia } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { formatDate, formatNumber } from '@/lib/date-format';
import { useDeferredFocus } from '@/lib/use-deferred-focus';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';
import { DayStepper } from './DayStepper';

/**
 * Weigh-in entry — today's, a past day's, or a missed day's.
 *
 * **Deliberately the same sheet, and the same input rules, as logging water**
 * (`DailyMetrics.tsx`): a prefilled field that selects on focus, a `done`
 * return key that saves, and a note line under the field that says what is
 * about to change (the current value at rest, `from → to` once something is
 * typed, the out-of-range band when it is out of range). What is NOT copied is
 * water's add/set toggle — weight replaces, and "add 5 lb" is not a thing
 * anyone means.
 *
 * What the Body review added (2026-10-04):
 *
 * - **A day stepper** (U2). The sheet could only write today, so a forgotten
 *   morning had no way in. The title names the day being written (C3 / bug 4):
 *   "Edit weigh-in · Sep 28", never "Today" for a past row.
 * - **Display precision** (bug 3). The field is prefilled with the ROUNDED
 *   display value, so a kilogram user opening 180 lb sees 81.6 — which parses
 *   back to 179.897 lb. Compared exactly, the untouched field read
 *   "81.6 → 81.6 kg" and Save rewrote the row with the drifted value. Now
 *   changes are judged at the precision the user can see, and saving an
 *   unchanged value writes nothing.
 * - **An outlier check** (U7). A weight more than `WEIGHT_DELTA_WARN_LB` from
 *   the PREVIOUS weigh-in (not today's — a past-row correction is judged
 *   against its own neighbour) asks once: the note names the gap and Save
 *   becomes "Save anyway". A typo'd 1180 reaching the TDEE regression is the
 *   thing `checkWeightEntry`'s `prev` argument was always for.
 * - **Closes on the local write** (bug 2). `onSave` resolves once the weigh-in
 *   is on disk (`pending-body.ts`), not when Firestore answers, so an offline
 *   save no longer leaves a dead button. A failure to even park stays here.
 * - **Native sheet, guarded** (P1 / U10): `fit` detent on iOS, and a swipe
 *   down with typed digits asks before discarding them.
 */
export function WeightSheet({
  visible,
  initialDateKey,
  todayKey,
  weights,
  unitSystem,
  onSave,
  onClose,
}: {
  visible: boolean;
  /** The day the sheet opens on — a tapped row's, or today. */
  initialDateKey: string;
  todayKey: string;
  /** `dateKey → lb`: prefill for whichever day is selected, and the previous
   *  weigh-in the outlier check compares against. */
  weights: Readonly<Record<string, number>>;
  /** Display/entry unit only. `onSave` always receives POUNDS — see
   *  `body-weight-units.ts` for why the store never learns about kilograms. */
  unitSystem: UnitSystem;
  onSave: (weightLb: number, dateKey: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const doneKey = useDoneKeyProps();
  const inputRef = useDeferredFocus(visible);
  const [dateKey, setDateKey] = useState(initialDateKey);
  const [value, setValue] = useState('');
  /** The text the field was last PREFILLED with — "dirty" means it differs. */
  const [prefill, setPrefill] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [outlierOk, setOutlierOk] = useState(false);
  const unit = bodyWeightUnit(unitSystem);
  const bounds = weightBoundsFor(unitSystem);

  const shownText = (lb: number | undefined): string =>
    lb != null ? String(toDisplayWeight(lb, unitSystem)) : '';

  // Seeded once per open, from the instant the sheet opened: a weights
  // snapshot landing while the sheet is up must not overwrite typing (the
  // FastSheet seed-effect lesson). So `weights` reaches the seed through a
  // ref — read at open, never a reason to re-run.
  const weightsAtOpen = useRef(weights);
  useEffect(() => {
    weightsAtOpen.current = weights;
  });
  useEffect(() => {
    if (!visible) return;
    const lb = weightsAtOpen.current[initialDateKey];
    const text = lb != null ? String(toDisplayWeight(lb, unitSystem)) : '';
    setDateKey(initialDateKey);
    setValue(text);
    setPrefill(text);
    setBusy(false);
    setSaveErr(false);
    setOutlierOk(false);
  }, [visible, initialDateKey, unitSystem]);

  function changeDay(next: string) {
    setDateKey(next);
    setOutlierOk(false);
    setSaveErr(false);
    // An untouched field follows the day; typed digits stay — they are the
    // person's, and the day is what they are correcting.
    if (value === prefill) {
      const text = shownText(weights[next]);
      setValue(text);
      setPrefill(text);
    }
  }

  const existing = weights[dateKey] ?? null;
  const prev = previousWeighIn(weights, dateKey);
  const isToday = dateKey === todayKey;
  const dayName = formatDate(parseYmd(dateKey), locale, { month: 'short', day: 'numeric' });

  // `n` is POUNDS from here down, whatever the field says — one conversion, at
  // the boundary, so every check and every call below stays in the stored unit.
  const n = parseWeightToLb(value, unitSystem) ?? Number.NaN;
  const typed = Number.isFinite(n);
  const range = typed ? checkWeightEntry(n) : null;
  const valid = range?.ok === true;
  const outOfRange = value.trim() !== '' && !valid;
  const unchanged = valid && existing != null && sameDisplayedWeight(n, existing, unitSystem);
  const delta = valid && prev ? checkWeightEntry(n, prev.weightLb) : null;
  const outlier = !unchanged && delta?.ok === false && delta.reason === 'large-delta' ? delta : null;
  const dirty = value !== prefill;

  const fmt = (lb: number) => formatNumber(toDisplayWeight(lb, unitSystem), locale);
  const note: { text: string; tone: 'bad' | 'warn' | 'plain' } = outOfRange
    ? { text: t('body.weightRange', { min: bounds.min, max: bounds.max, unit }), tone: 'bad' }
    : outlier && prev
      ? {
          text: t('body.outlier', {
            n: formatNumber(toDisplayWeight(outlier.deltaLb, unitSystem), locale),
            unit,
            date: formatDate(parseYmd(prev.dateKey), locale, { month: 'short', day: 'numeric' }),
          }),
          tone: 'warn',
        }
      : valid && existing != null && !unchanged
        ? { text: t('body.weightPreview', { from: fmt(existing), to: fmt(n), unit }), tone: 'plain' }
        : valid && existing == null && prev
          ? { text: t('body.weightPreview', { from: fmt(prev.weightLb), to: fmt(n), unit }), tone: 'plain' }
          : existing != null
            ? {
                text: isToday ? t('body.weightToday', { n: fmt(existing), unit }) : t('body.weightWas', { n: fmt(existing), unit }),
                tone: 'plain',
              }
            : prev
              ? { text: t('body.weightLast', { n: fmt(prev.weightLb), unit }), tone: 'plain' }
              : { text: t('body.weightFirst'), tone: 'plain' };

  // Validation is SPOKEN, not only painted (A9). Once per distinct message, so
  // a reader is told when the band is crossed, not on every keystroke inside it.
  const spoken = useRef('');
  useEffect(() => {
    if (!visible) return;
    const msg = note.tone === 'plain' ? '' : note.text;
    if (msg && msg !== spoken.current) announce(msg);
    spoken.current = msg;
  }, [visible, note.tone, note.text]);

  const canSave = valid && !busy;

  async function save() {
    if (!canSave) return;
    // Nothing to write: closing is the whole of saving an unchanged value
    // (bug 3 — this used to rewrite 180 as 179.897).
    if (unchanged) {
      onClose();
      return;
    }
    if (outlier && !outlierOk) {
      setOutlierOk(true);
      return;
    }
    setBusy(true);
    setSaveErr(false);
    try {
      await onSave(n, dateKey);
    } catch {
      // Only reachable when the weigh-in could not even be parked on disk —
      // nothing was recorded, so the typed value stays here to retry.
      setSaveErr(true);
      announce(t('body.saveErr'));
    } finally {
      setBusy(false);
    }
  }

  function requestClose(_via: SheetCloseVia): boolean {
    if (!dirty || busy) {
      onClose();
      return true;
    }
    confirm({
      title: t('body.discardTitle'),
      body: t('body.discardBody'),
      confirmText: t('body.discard'),
      cancelText: t('body.keepEditing'),
      destructive: true,
      onConfirm: onClose,
    });
    return false;
  }

  const title =
    existing != null
      ? isToday
        ? t('body.updateWeight')
        : t('body.editWeighInTitle', { date: dayName })
      : isToday
        ? t('body.logWeight')
        : t('body.logWeighInTitle', { date: dayName });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onRequestClose={requestClose}
      native
      detents="fit"
      guarded={dirty}
      backdropTestID="weight-sheet-backdrop"
    >
      <Text style={styles.sheetTitle} accessibilityRole="header" testID="weight-title">
        {title}
      </Text>
      <DayStepper
        dateKey={dateKey}
        onChange={changeDay}
        maxKey={todayKey}
        minKey={WEIGH_IN_MIN_DATE_KEY}
        testIDPrefix="weight"
      />
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={String(toDisplayWeight(180, unitSystem))}
          placeholderTextColor={colors.faint}
          // `decimal-pad` (P4): a weigh-in carries a decimal, and this is the
          // keypad with one and nothing else. Water keeps `number-pad`: same
          // rule (the keypad the values need), different values.
          keyboardType="decimal-pad"
          value={value}
          selectTextOnFocus
          {...doneKey}
          onChangeText={(text) => {
            setValue(text);
            setOutlierOk(false);
          }}
          accessibilityLabel={t('body.weightInputA11y', { unit: t(unit === 'kg' ? 'body.unitKgLong' : 'body.unitLbLong') })}
          testID="weight-input"
          onSubmitEditing={save}
        />
        <Text style={styles.inputUnit}>{unit}</Text>
      </View>
      <Text
        style={[styles.sheetNote, note.tone === 'bad' && styles.sheetNoteBad, note.tone === 'warn' && styles.sheetNoteWarn]}
        testID="weight-note"
      >
        {note.text}
      </Text>
      {saveErr ? (
        <Text style={[styles.sheetNote, styles.sheetNoteBad]} accessibilityRole="alert" testID="weight-save-error">
          {t('body.saveErr')}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.save, !valid && styles.saveDisabled]}
        onPress={save}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave, busy }}
        testID="weight-save"
      >
        {busy ? (
          <ActivityIndicator color={colors.onInk} />
        ) : (
          <Text style={styles.saveText}>{outlier && outlierOk ? t('body.saveAnyway') : t('common.save')}</Text>
        )}
      </TouchableOpacity>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.md },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
    input: {
      flex: 1,
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      // `lineStrong`, not `line` (A8): the hairline is 1.26:1 against a white
      // field in light and the dark field is 1.09:1 against paper — a control
      // boundary has to reach 3:1 (WCAG 1.4.11).
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      fontSize: font.h2,
      color: colors.ink,
    },
    inputUnit: { fontSize: font.h3, color: colors.muted },
    // Same two styles, same names, as the water/sleep sheets in DailyMetrics —
    // the note line under a one-field sheet reads identically wherever it is.
    sheetNote: { fontSize: font.small, color: colors.muted, marginTop: space.xs, textAlign: 'center' },
    sheetNoteBad: { color: colors.danger },
    sheetNoteWarn: { color: colors.accent },
    save: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingVertical: space.lg,
      alignItems: 'center',
      marginTop: space.lg,
      minHeight: 56,
      justifyContent: 'center',
    },
    saveDisabled: { opacity: 0.4 },
    saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  });
