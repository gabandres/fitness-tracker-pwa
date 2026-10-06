import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  BODY_FAT_PCT_BOUNDS,
  type BodyFatMethod,
  type Measurement,
  type UnitSystem,
  dayKeyAt,
  implausibleMeasurementFields,
  measureBoundsFor,
  measureUnit,
  parseMeasureToIn,
  parseYmd,
  toDisplayMeasure,
  MIDNIGHT,
} from '@macrolog/core';
import { BottomSheet, type SheetCloseVia } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { KeyboardBar, useKeyboardBarProps } from '@/components/KeyboardBar';
import { type I18nKey, type Locale, useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { formatNumber } from '@/lib/date-format';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { DayStepper } from './DayStepper';

export type MeasureKey = 'waist' | 'neck' | 'hip' | 'chest' | 'bicep';
export const MEASURE_FIELDS: { key: MeasureKey; labelKey: I18nKey }[] = [
  { key: 'waist', labelKey: 'measure.waist' },
  { key: 'neck', labelKey: 'measure.neck' },
  { key: 'hip', labelKey: 'measure.hip' },
  { key: 'chest', labelKey: 'measure.chest' },
  { key: 'bicep', labelKey: 'measure.bicep' },
];

/** A stored number as the field shows it — the locale's decimal mark, no
 *  grouping, at most one decimal. */
function fieldNumber(n: number, locale: Locale): string {
  return formatNumber(n, locale, { useGrouping: false, maximumFractionDigits: 1 });
}

/** Noon of a date key — a measurement is "on Sep 28", not at an instant, and
 *  noon cannot drift across midnight under a DST change. */
function noonOf(key: string): Date {
  const d = parseYmd(key);
  d.setHours(12, 0, 0, 0);
  return d;
}

/**
 * Add or edit one tape measurement (plus, behind the ADR-0043 flag, a measured
 * body-fat %). Add and edit stay ONE component reading its initial values from
 * the row, so they cannot drift into two field lists (the mistake called out
 * on `toMeasurementPatch`).
 *
 * The Body review's additions (U9, U10, A3, P1, P4):
 *
 * - **Last value as placeholder** ("Last: 33.3") — the number you measured
 *   last time is the one you are checking against, and it was nowhere on the
 *   sheet.
 * - **Autofocus + a field chain**: waist opens focused, Return moves to the
 *   next field, and on iOS a ‹ › Done bar rides above the decimal pad
 *   (`KeyboardBar`), because the decimal pad has no Return key at all.
 * - **A date** (the day stepper): a measurement taken yesterday can say so.
 * - **Labelled fields**: "Waist, centimeters", not a bare "text field, 84";
 *   the method chips are radio buttons in a named group.
 * - **Guarded** while dirty: a swipe down asks before discarding typed values.
 * - **Closes on the local write** (`pending-body.ts`), like the weigh-in.
 * - **Remove** under Save when editing a row (re-score 3), like the weigh-in
 *   sheet; the caller's receipt carries Undo.
 */
export function MeasurementSheet({
  visible,
  initial,
  latest,
  todayKey,
  onSave,
  onDelete,
  onClose,
  unitSystem,
  showBodyFat = false,
}: {
  /** The measured body-fat % field (ADR-0043, flag-gated). When false the
   *  sheet is exactly what it was, and an edit never names the field — so a
   *  stored DXA value on the row survives (`toMeasurementPatch`). */
  showBodyFat?: boolean;
  visible: boolean;
  /** The row being edited, or null when adding. */
  initial: Measurement | null;
  /** Every saved row, newest first — where "Last: 33.3" comes from. */
  latest: readonly Measurement[];
  todayKey: string;
  /** `date` is passed when the stepper moved the row (or for every add). */
  onSave: (entry: Omit<Measurement, 'id' | 'date'>, date: Date | undefined) => Promise<void> | void;
  /** Remove the row being edited; the caller closes the sheet and shows the
   *  Undo receipt. Absent, or adding, = no Remove button. */
  onDelete?: (m: Measurement) => void;
  onClose: () => void;
  /** Measurements are STORED in inches; this decides what the user sees and
   *  what their typing means. */
  unitSystem: UnitSystem;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [seed, setSeed] = useState<Record<string, string>>({});
  const [bodyFat, setBodyFat] = useState('');
  const [bfMethod, setBfMethod] = useState<BodyFatMethod | null>(null);
  const [dateKey, setDateKey] = useState(todayKey);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const refs = useRef<Record<string, TextInput | null>>({});
  const unitName = t(measureUnit(unitSystem) === 'cm' ? 'body.unitCmLong' : 'body.unitInLong');
  const initialKey = initial ? dayKeyAt(initial.date, MIDNIGHT) : todayKey;

  useEffect(() => {
    if (!visible) return;
    // Prefill from the row being edited so the sheet shows what is already
    // stored — an edit form that opens blank reads as "start over", and
    // saving it would wipe every field the user didn't retype.
    // In the user's decimal mark (Body re-score, bug 8): "84,5" in Brazil,
    // like the rows and the keypad. Ungrouped so it parses straight back.
    const next = initial
      ? MEASURE_FIELDS.reduce<Record<string, string>>((acc, f) => {
          const v = initial[f.key];
          if (v != null) acc[f.key] = fieldNumber(toDisplayMeasure(v, unitSystem), locale);
          return acc;
        }, {})
      : {};
    setVals(next);
    setSeed(next);
    setBodyFat(initial?.bodyFatPct != null ? fieldNumber(initial.bodyFatPct, locale) : '');
    setBfMethod(initial?.bodyFatMethod ?? null);
    setDateKey(initial ? dayKeyAt(initial.date, MIDNIGHT) : todayKey);
    setBusy(false);
    setSaveErr(false);
    // Autofocus the first field on ADD (U9). Deferred past the sheet's spring,
    // like `useDeferredFocus`; an edit opens unfocused because it starts from
    // values the user is reviewing, not typing.
    if (!initial) {
      const timer = setTimeout(() => refs.current.waist?.focus(), 300);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [visible, initial, unitSystem, todayKey, locale]);

  /** The user's unit in, inches out — storage is always inches. */
  function parse(s: string): number | undefined {
    return parseMeasureToIn(s, unitSystem) ?? undefined;
  }

  const entry = MEASURE_FIELDS.reduce<Record<string, number>>((acc, f) => {
    const n = parse(vals[f.key] ?? '');
    if (n != null) acc[f.key] = n;
    return acc;
  }, {});
  // Per-field plausibility, shared with the PWA and mirrored in
  // firestore.rules. A 15in chest is a neck reading in the wrong field, and it
  // silently moves the body-fat estimate — one shared range cannot catch it.
  const implausible = implausibleMeasurementFields(entry);
  // The measured %BF: a number in band AND a method, or nothing at all.
  const bfText = bodyFat.trim().replace(',', '.');
  const bfNum = bfText === '' ? undefined : Number(bfText);
  const [bfMin, bfMax] = BODY_FAT_PCT_BOUNDS;
  const bfOutOfRange = bfNum != null && !(bfNum >= bfMin && bfNum <= bfMax);
  const bfNeedsMethod = bfNum != null && !bfOutOfRange && bfMethod == null;
  // A method with no number would save as "no measured value" without a word.
  // Editing a row that HAD one is the exception: emptying it is how it clears.
  const bfNeedsValue = showBodyFat && bfNum == null && bfMethod != null && initial?.bodyFatPct == null;
  const bodyFatEntry: Partial<Measurement> = !showBodyFat
    ? {}
    : bfNum != null && !bfOutOfRange && bfMethod
      ? { bodyFatPct: Math.round(bfNum * 10) / 10, bodyFatMethod: bfMethod }
      : // Named, undefined: an edit that emptied the field clears it.
        { bodyFatPct: undefined };
  const hasAny = Object.keys(entry).length > 0 || bodyFatEntry.bodyFatPct != null;
  const valid = hasAny && implausible.length === 0 && !bfOutOfRange && !bfNeedsMethod && !bfNeedsValue;
  const rangeHint = bfOutOfRange
    ? t('measure.bodyFatRange', { min: bfMin, max: bfMax })
    : bfNeedsMethod
      ? t('measure.bodyFatNeedsMethod')
      : bfNeedsValue
        ? t('measure.bodyFatNeedsValue')
        : implausible.length
          ? t('body.measureRange', {
              field: t(MEASURE_FIELDS.find((f) => f.key === implausible[0])!.labelKey),
              min: measureBoundsFor(implausible[0], unitSystem).min,
              max: measureBoundsFor(implausible[0], unitSystem).max,
              unit: measureUnit(unitSystem),
            })
          : null;
  // The method chips count too (re-score, bug 9): a swipe-down dropped a
  // changed method without asking.
  const dirty =
    MEASURE_FIELDS.some((f) => (vals[f.key] ?? '') !== (seed[f.key] ?? '')) ||
    bodyFat !== (initial?.bodyFatPct != null ? fieldNumber(initial.bodyFatPct, locale) : '') ||
    bfMethod !== (initial?.bodyFatMethod ?? null) ||
    dateKey !== initialKey;

  // Spoken when it appears (A9) — the hint replaces the resting instructions,
  // which a screen-reader user would otherwise never hear change.
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    if (rangeHint && rangeHint !== spoken.current) announce(rangeHint);
    spoken.current = rangeHint;
  }, [visible, rangeHint]);

  /** "Last: 33.3" — the newest saved value for this site, other than the row
   *  being edited (its own value is already IN the field). */
  function lastFor(key: MeasureKey): string | null {
    const row = latest.find((m) => m.id !== initial?.id && m[key] != null);
    const v = row?.[key];
    return v != null ? formatNumber(toDisplayMeasure(v, unitSystem), locale) : null;
  }

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setSaveErr(false);
    // A rejected write used to escape as an unhandled rejection; then (bug 2)
    // an offline one never settled at all. `onSave` now resolves once the row
    // is parked on disk, so the only failure that reaches here is one where
    // nothing at all was recorded — the typed values stay to retry.
    try {
      // An edit passes a date only when the stepper moved it; an add only
      // when it is for ANOTHER day — today's add keeps "now", so two tapes
      // taken today still order by when they were taken.
      const moved = initial ? dateKey !== initialKey : dateKey !== todayKey;
      await onSave({ ...entry, ...bodyFatEntry } as Omit<Measurement, 'id' | 'date'>, moved ? noonOf(dateKey) : undefined);
    } catch {
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

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onRequestClose={requestClose}
      native
      detents={[0.6, 1]}
      guarded={dirty}
      backdropTestID="measure-sheet-backdrop"
    >
      <Text style={styles.sheetTitle} accessibilityRole="header">
        {initial ? t('body.editMeasurement') : t('body.addMeasurement')}
      </Text>
      <DayStepper dateKey={dateKey} onChange={setDateKey} maxKey={todayKey} testIDPrefix="measure" />
      <Text style={styles.sheetHint} testID="measure-hint">
        {rangeHint ?? t('body.measureHint', { unit: measureUnit(unitSystem) })}
      </Text>
      <MeasureFields
        vals={vals}
        setVals={setVals}
        refs={refs}
        lastFor={lastFor}
        unitName={unitName}
        styles={styles}
        placeholderColor={colors.faint}
        hasBodyFat={showBodyFat}
      />
      {showBodyFat ? (
        <View style={styles.bfBlock} testID="measure-bodyfat-block">
          <Text style={styles.fieldLabel}>{t('measure.bodyFat')}</Text>
          <View style={styles.bfRow}>
            <SheetTextInput
              ref={(r) => {
                refs.current.bodyFat = r;
              }}
              style={[styles.measureInput, styles.bfInput]}
              placeholder="—"
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              value={bodyFat}
              onChangeText={setBodyFat}
              accessibilityLabel={t('measure.bodyFatA11y')}
              testID="measure-bodyfat"
            />
            <View style={styles.bfChips} accessibilityRole="radiogroup" accessibilityLabel={t('measure.methodGroup')}>
              {(['dxa', 'other'] as BodyFatMethod[]).map((m) => {
                const on = bfMethod === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[styles.bfChip, on && styles.bfChipOn]}
                    onPress={() => setBfMethod(on ? null : m)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, selected: on }}
                    testID={`measure-bf-${m}`}
                  >
                    <Text style={[styles.bfChipText, on && styles.bfChipTextOn]}>
                      {m === 'dxa' ? t('measure.methodDxa') : t('measure.methodOther')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <Text style={styles.bfFieldHint}>{t('measure.bodyFatHint')}</Text>
        </View>
      ) : null}
      {saveErr ? (
        <Text style={[styles.sheetHint, styles.sheetNoteBad]} accessibilityRole="alert" testID="measure-save-error">
          {t('body.saveErr')}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.save, !valid && styles.saveDisabled]}
        onPress={save}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid || busy, busy }}
        testID="measure-save"
      >
        {busy ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.saveText}>{t('common.save')}</Text>}
      </TouchableOpacity>
      {initial?.id && onDelete ? (
        <TouchableOpacity
          style={styles.delete}
          onPress={() => onDelete(initial)}
          disabled={busy}
          accessibilityRole="button"
          testID="measure-delete"
        >
          <Text style={styles.deleteText}>{t('body.deleteMeasurement')}</Text>
        </TouchableOpacity>
      ) : null}
    </BottomSheet>
  );
}

/**
 * The five tape fields. Split out so each field can call `useKeyboardBarProps`
 * for its OWN accessory id (one `InputAccessoryView` per input — see the note
 * at the top of `KeyboardBar.tsx` for why a shared id leaves every input but
 * the first with no bar).
 */
function MeasureFields({
  vals,
  setVals,
  refs,
  lastFor,
  unitName,
  styles,
  placeholderColor,
  hasBodyFat,
}: {
  vals: Record<string, string>;
  setVals: (fn: (v: Record<string, string>) => Record<string, string>) => void;
  refs: React.MutableRefObject<Record<string, TextInput | null>>;
  lastFor: (key: MeasureKey) => string | null;
  unitName: string;
  styles: ReturnType<typeof createStyles>;
  placeholderColor: string;
  hasBodyFat: boolean;
}) {
  return (
    <View style={styles.measureGrid}>
      {MEASURE_FIELDS.map((f, i) => (
        <MeasureField
          key={f.key}
          field={f}
          value={vals[f.key] ?? ''}
          onChange={(text) => setVals((v) => ({ ...v, [f.key]: text }))}
          inputRef={(r) => {
            refs.current[f.key] = r;
          }}
          onPrev={i > 0 ? () => refs.current[MEASURE_FIELDS[i - 1].key]?.focus() : undefined}
          onNext={
            i < MEASURE_FIELDS.length - 1
              ? () => refs.current[MEASURE_FIELDS[i + 1].key]?.focus()
              : hasBodyFat
                ? () => refs.current.bodyFat?.focus()
                : undefined
          }
          last={lastFor(f.key)}
          unitName={unitName}
          styles={styles}
          placeholderColor={placeholderColor}
        />
      ))}
    </View>
  );
}

function MeasureField({
  field,
  value,
  onChange,
  inputRef,
  onPrev,
  onNext,
  last,
  unitName,
  styles,
  placeholderColor,
}: {
  field: { key: MeasureKey; labelKey: I18nKey };
  value: string;
  onChange: (text: string) => void;
  inputRef: (r: TextInput | null) => void;
  onPrev?: () => void;
  onNext?: () => void;
  last: string | null;
  unitName: string;
  styles: ReturnType<typeof createStyles>;
  placeholderColor: string;
}) {
  const t = useT();
  const barId = `measure-${field.key}-bar`;
  const barProps = useKeyboardBarProps(barId);
  const label = t(field.labelKey);
  return (
    <View style={styles.measureField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <SheetTextInput
        ref={inputRef}
        // NOT a `flex: 1` input: the parent is a column with auto height, so
        // flex:1 resolves to flexBasis:0 on the vertical axis and collapses the
        // box to its padding — the digits were typed and saved, but clipped
        // out of view (2026-08-05).
        style={styles.measureInput}
        placeholder={last ? t('body.measureLast', { n: last }) : '0'}
        placeholderTextColor={placeholderColor}
        keyboardType="decimal-pad"
        value={value}
        onChangeText={onChange}
        returnKeyType={onNext ? 'next' : 'done'}
        onSubmitEditing={onNext}
        blurOnSubmit={!onNext}
        accessibilityLabel={t('body.measureInputA11y', { field: label, unit: unitName })}
        testID={`measure-${field.key}`}
        {...barProps}
      />
      <KeyboardBar nativeID={barId} onPrev={onPrev} onNext={onNext} />
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.md },
    sheetHint: { fontSize: font.small, color: colors.muted, marginVertical: space.md },
    sheetNoteBad: { color: colors.danger },
    measureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
    measureField: { width: '47%', gap: space.xs },
    fieldLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    // Same visual language as the weigh-in field minus its `flex: 1`.
    measureInput: {
      alignSelf: 'stretch',
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      // `lineStrong` (A8) — see the weigh-in sheet.
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      fontSize: font.h3,
      color: colors.ink,
    },
    bfBlock: { gap: space.xs, marginTop: space.md },
    bfRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
    bfInput: { flex: 1, minWidth: 96 },
    bfChips: { flexDirection: 'row', gap: space.sm },
    bfChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, minHeight: TARGET, justifyContent: 'center' },
    bfChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    bfChipText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    bfChipTextOn: { color: colors.onInk },
    bfFieldHint: { fontSize: font.tiny, color: colors.muted },
    save: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center', marginTop: space.lg, minHeight: 56, justifyContent: 'center' },
    saveDisabled: { opacity: 0.4 },
    saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
    delete: { alignItems: 'center', justifyContent: 'center', minHeight: TARGET, marginTop: space.xs },
    deleteText: { color: colors.danger, fontWeight: '700', fontSize: font.small },
  });

/** "Waist 33.3 in · Neck 15 in" — localized field names, in the user's unit. */
export function measureLine(
  m: Measurement,
  t: (k: I18nKey, p?: Record<string, string | number>) => string,
  unitSystem: UnitSystem,
  showBodyFat: boolean,
  locale: Parameters<typeof formatNumber>[1],
): string {
  // `${label} ${v}` printed the STORED INCHES raw, with no unit and no
  // conversion, so this line was byte-identical in pounds mode and kilograms
  // mode (measured 2026-09-22). A metric user read "Waist 33.3" as
  // centimetres, which is a thigh. Numbers through `formatNumber` (C2): pt-BR
  // writes 84,5.
  const parts = MEASURE_FIELDS.flatMap((f) => {
    const v = m[f.key];
    if (v == null) return [];
    return [`${t(f.labelKey)} ${formatNumber(toDisplayMeasure(v, unitSystem), locale)} ${measureUnit(unitSystem)}`];
  });
  if (showBodyFat && m.bodyFatPct != null) {
    const method = m.bodyFatMethod === 'dxa' ? t('measure.methodDxa') : t('measure.methodOther');
    parts.push(`${formatNumber(m.bodyFatPct, locale)}% (${method})`);
  }
  return parts.join(' · ') || '—';
}
