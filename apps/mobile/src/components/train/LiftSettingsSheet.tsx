import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  type Equipment,
  type Recommendation,
  type UnitSystem,
  formatLoad,
  inferCategory,
  isValidRepRange,
  loadUnit,
  parseLoadToLb,
  resolveEngineConfig,
  toDisplayLoad,
} from '@macrolog/core';
import { CATEGORY_REP_RANGES, EXERCISE_CATEGORIES } from '@macrolog/core/workout';
import { BottomSheet } from '@/components/BottomSheet';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { showToast } from '@/components/Toast';
import { createStyles } from '@/components/train/train-styles';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type {
  EffortStandard, Exercise, ExerciseCategory, ExercisePatch, ProgressionRule,
} from '@/lib/workout';

/** The rules' bound on `smithBarEffectiveLb` (firestore.rules isValidExercise). */
const SMITH_BAR_MAX_LB = 200;

const CATEGORY_KEY: Record<ExerciseCategory, I18nKey> = {
  compound: 'train.lift.cat.compound',
  isolation: 'train.lift.cat.isolation',
  core: 'train.lift.cat.core',
  bodyweight: 'train.lift.cat.bodyweight',
};

const EQUIPMENT_KEY: Record<Equipment, I18nKey> = {
  dumbbell: 'train.lift.equip.dumbbell',
  stack: 'train.lift.equip.stack',
  smith: 'train.lift.equip.smith',
  barbell: 'train.lift.equip.barbell',
  plate: 'train.lift.equip.plate',
  bodyweight: 'train.lift.equip.bodyweight',
  other: 'train.lift.equip.other',
};

/** Which load-step hint a lift's equipment gets. A stack is the one kind with
 *  no default (machines differ); dumbbells and the Smith machine step by the
 *  default increment. */
function stepsHintKey(equipment: Equipment): I18nKey {
  if (equipment === 'stack') return 'train.lift.stepsHint.stack';
  if (equipment === 'dumbbell') return 'train.lift.stepsHint.dumbbell';
  if (equipment === 'smith') return 'train.lift.stepsHint.smith';
  return 'train.lift.stepsHint.other';
}

const intOrNull = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/** "10, 15 20" → pounds, ascending and de-duplicated, plus whatever did not
 *  parse — said back to the lifter rather than silently dropped. */
export function parseLoadSteps(
  text: string,
  unitSystem: UnitSystem,
): { loads: number[]; bad: string[] } {
  const tokens = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const loads: number[] = [];
  const bad: string[] = [];
  for (const tok of tokens) {
    const lb = parseLoadToLb(tok, unitSystem);
    if (lb == null) bad.push(tok);
    else loads.push(Math.round(lb * 100) / 100);
  }
  return { loads: [...new Set(loads)].sort((a, b) => a - b), bad };
}

const stepsText = (loads: readonly number[] | undefined, unitSystem: UnitSystem) =>
  (loads ?? []).map((x) => String(toDisplayLoad(x, unitSystem))).join(', ');

/**
 * Per-lift configuration — everything the rewritten progression engine reads
 * off the catalog exercise (2026-10-07): the category (and so the default rep
 * range), a rep-range override, the loads the equipment can actually be set
 * to, a Smith machine's effective bar weight, the effort standard of the
 * activation set, whether a bodyweight lift can take added load, and
 * microplates. All are catalog properties — a property of the lift, not of
 * the template row — so this writes through `editCatalogExercise`.
 *
 * Every field has a default the engine falls back to, and the sheet shows it
 * rather than a blank: "Auto (Compound)", "Category default: 6–12 reps", the
 * equipment's step. Returning a field to its default sends `null`, which
 * DELETES it from the doc (`editExercise`), so no stale override is left
 * behind. Only the fields the lifter actually changed are written — a metric
 * user's loads are not round-tripped through kilograms on an unrelated save.
 *
 * The "What the engine uses" block is `resolveEngineConfig` over the draft,
 * the same resolution the engine runs — so what the sheet shows is what the
 * next recommendation reads, not a parallel guess.
 */
export function LiftSettingsSheet({
  visible,
  exercise,
  templateRow,
  onClose,
  onSave,
}: {
  visible: boolean;
  exercise: Exercise | null;
  /** The template row the sheet was opened from, if any. Only a stack's
   *  fallback step reads it (`progression.incrementLb`). */
  templateRow?: { name?: string; progression?: Partial<ProgressionRule> } | null;
  /** Retired with the derived rep band — the sheet shows the resolved
   *  configuration instead. Accepted so existing callers still compile. */
  rec?: Recommendation | null;
  onClose: () => void;
  onSave: (patch: ExercisePatch) => Promise<void>;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const unit = loadUnit(unitSystem);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const doneKey = useDoneKeyProps();

  // The draft. Text buffers for the numeric fields, so a half-typed value
  // survives a keystroke, and the as-opened text to tell "changed" from
  // "re-rendered".
  const [category, setCategory] = useState<ExerciseCategory | null>(null);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [steps, setSteps] = useState('');
  const [bar, setBar] = useState('');
  const [standard, setStandard] = useState<EffortStandard>('failure');
  const [loadable, setLoadable] = useState(false);
  const [microplates, setMicroplates] = useState(false);
  const [initial, setInitial] = useState({ min: '', max: '', steps: '', bar: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const range = isValidRepRange(exercise?.repRange) ? exercise!.repRange! : null;
    const init = {
      min: range ? String(range.min) : '',
      max: range ? String(range.max) : '',
      steps: stepsText(exercise?.availableLoads, unitSystem),
      bar: exercise?.smithBarEffectiveLb != null ? String(toDisplayLoad(exercise.smithBarEffectiveLb, unitSystem)) : '',
    };
    setCategory(exercise?.category ?? null);
    setMinText(init.min);
    setMaxText(init.max);
    setSteps(init.steps);
    setBar(init.bar);
    setInitial(init);
    setStandard(exercise?.effortStandard ?? 'failure');
    setLoadable(exercise?.loadable === true);
    setMicroplates(exercise?.microplates === true);
    setSaving(false);
  }, [visible, exercise, unitSystem]);

  const name = exercise?.name ?? templateRow?.name ?? '';
  const inferred = inferCategory(name);
  const effectiveCategory = category ?? inferred;
  const categoryRange = CATEGORY_REP_RANGES[effectiveCategory];

  // Parse the draft once; the effective block and save() both read it.
  const rangeTyped = minText.trim() !== '' || maxText.trim() !== '';
  const typedRange = { min: intOrNull(minText) ?? NaN, max: intOrNull(maxText) ?? NaN };
  const rangeOk = !rangeTyped || isValidRepRange(typedRange);
  const parsedSteps = useMemo(() => parseLoadSteps(steps, unitSystem), [steps, unitSystem]);
  const barLb = bar.trim() ? parseLoadToLb(bar, unitSystem) : null;
  const barOk = !bar.trim() || (barLb != null && barLb <= SMITH_BAR_MAX_LB);

  const config = resolveEngineConfig(
    {
      name,
      logStyle: exercise?.logStyle,
      assisted: exercise?.assisted,
      category: category ?? undefined,
      repRange: rangeTyped && rangeOk ? typedRange : undefined,
      availableLoads: parsedSteps.loads.length ? parsedSteps.loads : undefined,
      smithBarEffectiveLb: barOk && barLb != null ? barLb : undefined,
      effortStandard: standard,
      loadable,
      microplates,
    },
    templateRow,
  );
  const canSave = !!exercise?.id && rangeOk && parsedSteps.bad.length === 0 && barOk && !saving;

  /** Only what changed; `null` returns a field to its default. */
  function buildPatch(): ExercisePatch {
    const patch: ExercisePatch = {};
    if (category !== (exercise?.category ?? null)) patch.category = category;
    if (minText !== initial.min || maxText !== initial.max) {
      patch.repRange = rangeTyped ? typedRange : null;
    }
    if (steps !== initial.steps) patch.availableLoads = parsedSteps.loads.length ? parsedSteps.loads : null;
    if (bar !== initial.bar) patch.smithBarEffectiveLb = barLb;
    if (standard !== (exercise?.effortStandard ?? 'failure')) patch.effortStandard = standard;
    // Absent reads as false, so OFF is a delete rather than a stored `false`.
    if (loadable !== (exercise?.loadable === true)) patch.loadable = loadable ? true : null;
    if (microplates !== (exercise?.microplates === true)) patch.microplates = microplates ? true : null;
    return patch;
  }

  async function save() {
    if (!canSave) return;
    haptics.tap();
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(patch);
      onClose();
    } catch {
      // A refused write is said, not left as an unhandled rejection and a
      // sheet that does nothing (Train review bug 7's twin).
      haptics.warning();
      showToast(t('train.exerciseSaveErr'));
    }
    // After the try/catch, not in a `finally`: React Compiler cannot lower a
    // `finally` and skips the whole component. Nothing above can throw past
    // the catch, so this still runs on both paths.
    setSaving(false);
  }

  const fmt = (lb: number) => formatLoad(lb, unitSystem);
  const effortLabel = t(config.effortStandard === 'failure' ? 'train.lift.effortFailure' : 'train.lift.effortRir1');

  return (
    <BottomSheet native visible={visible} onClose={onClose} contentStyle={styles.sheetBody} maxHeight="80%">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.sheetStack}>
      <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.lift.title')}</Text>
      {name ? <Text style={styles.sheetHint}>{name}</Text> : null}

      {/* ── Category: "Auto" clears the field and says what it inferred ── */}
      <View style={styles.liftSection}>
        <Text style={styles.liftLabel}>{t('train.lift.category')}</Text>
        <View style={[styles.styleRow, styles.styleRowWrap, { marginTop: 0 }]} accessibilityRole="radiogroup">
          {([null, ...EXERCISE_CATEGORIES] as const).map((c) => {
            const on = category === c;
            return (
              <Touchable
                key={c ?? 'auto'}
                style={[styles.styleChip, styles.styleChipHalf, on && styles.styleChipOn]}
                onPress={() => setCategory(c)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={`lift-category-${c ?? 'auto'}`}
              >
                <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>
                  {c ? t(CATEGORY_KEY[c]) : t('train.lift.categoryAuto', { inferred: t(CATEGORY_KEY[inferred]) })}
                </Text>
              </Touchable>
            );
          })}
        </View>
        <Text style={styles.liftHint}>{t('train.lift.categoryHint')}</Text>
      </View>

      {/* ── Rep range: empty is the category default, shown ── */}
      <View style={styles.liftSection}>
        <Text style={styles.liftLabel}>{t('train.lift.repRange')}</Text>
        <View style={styles.liftBandRow}>
          <SheetTextInput
            style={[styles.input, styles.liftBandInput]}
            keyboardType="number-pad"
            placeholder={String(categoryRange.min)}
            placeholderTextColor={colors.faint}
            value={minText}
            onChangeText={(v) => setMinText(v.replace(/[^\d]/g, ''))}
            maxLength={3}
            {...doneKey}
            accessibilityLabel={t('train.lift.repRangeMinA11y')}
            testID="lift-range-min"
          />
          <Text style={styles.liftBandUnit}>{t('train.lift.repRangeTo')}</Text>
          <SheetTextInput
            style={[styles.input, styles.liftBandInput]}
            keyboardType="number-pad"
            placeholder={String(categoryRange.max)}
            placeholderTextColor={colors.faint}
            value={maxText}
            onChangeText={(v) => setMaxText(v.replace(/[^\d]/g, ''))}
            maxLength={3}
            {...doneKey}
            accessibilityLabel={t('train.lift.repRangeMaxA11y')}
            testID="lift-range-max"
          />
        </View>
        <Text style={rangeOk ? styles.liftHint : styles.error} testID="lift-range-hint">
          {rangeOk
            ? t('train.lift.repRangeDefault', { min: categoryRange.min, max: categoryRange.max })
            : t('train.lift.repRangeInvalid')}
        </Text>
        {rangeTyped ? (
          <Touchable
            style={styles.liftClear}
            onPress={() => { setMinText(''); setMaxText(''); }}
            accessibilityRole="button"
            testID="lift-range-clear"
          >
            <Text style={styles.liftClearText}>{t('train.lift.repRangeClear')}</Text>
          </Touchable>
        ) : null}
      </View>

      {/* ── Load steps: the loads the equipment can actually be set to ── */}
      {config.equipment !== 'bodyweight' || config.loadable ? (
        <View style={styles.liftSection}>
          <Text style={styles.liftLabel}>{t('train.lift.steps')} ({unit})</Text>
          <SheetTextInput
            style={styles.input}
            keyboardType="numbers-and-punctuation"
            placeholder={t('train.lift.stepsPh')}
            placeholderTextColor={colors.faint}
            value={steps}
            onChangeText={setSteps}
            {...doneKey}
            accessibilityLabel={t('train.lift.stepsA11y', { unit })}
            testID="lift-steps"
          />
          {parsedSteps.bad.length > 0 ? (
            <Text style={styles.error} testID="lift-steps-error">
              {t('train.lift.stepsInvalid', { bad: parsedSteps.bad.join(', ') })}
            </Text>
          ) : null}
          <Text style={styles.liftHint} testID="lift-steps-hint">
            {t(stepsHintKey(config.equipment), { step: fmt(config.stepLb) })}
          </Text>
        </View>
      ) : null}

      {/* ── Smith bar: only for a Smith machine ── */}
      {config.equipment === 'smith' ? (
        <View style={styles.liftSection}>
          <Text style={styles.liftLabel}>{t('train.lift.smithBar')} ({unit})</Text>
          <SheetTextInput
            style={[styles.input, styles.liftBandInput]}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={colors.faint}
            value={bar}
            onChangeText={setBar}
            maxLength={6}
            {...doneKey}
            accessibilityLabel={t('train.lift.smithBarA11y', { unit })}
            testID="lift-smith-bar"
          />
          {barOk ? null : (
            <Text style={styles.error}>{t('train.lift.smithBarInvalid', { max: fmt(SMITH_BAR_MAX_LB) })}</Text>
          )}
          <Text style={styles.liftHint}>{t('train.lift.smithBarHint')}</Text>
        </View>
      ) : null}

      {/* ── Effort standard of the activation set (ADR-0039) ── */}
      <View style={styles.liftSection}>
        <Text style={styles.liftLabel}>{t('train.lift.effort')}</Text>
        <View style={[styles.styleRow, { marginTop: 0 }]} accessibilityRole="radiogroup">
          {(['failure', 'rir1'] as const).map((s) => {
            const on = standard === s;
            return (
              <Touchable
                key={s}
                style={[styles.styleChip, on && styles.styleChipOn]}
                onPress={() => setStandard(s)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, checked: on }}
                testID={`lift-effort-${s}`}
              >
                <Text style={[styles.styleChipText, on && styles.styleChipTextOn]}>
                  {t(s === 'failure' ? 'train.lift.effortFailure' : 'train.lift.effortRir1')}
                </Text>
              </Touchable>
            );
          })}
        </View>
        <Text style={styles.liftHint}>{t('train.lift.effortHint')}</Text>
      </View>

      {/* ── Two switches: added load (bodyweight lifts only), microplates ── */}
      {effectiveCategory === 'bodyweight' ? (
        <View style={styles.liftToggleRow}>
          <View style={styles.liftToggleText}>
            <Text style={styles.liftToggleLabel}>{t('train.lift.loadable')}</Text>
            <Text style={styles.liftHint}>{t('train.lift.loadableHint')}</Text>
          </View>
          <Switch
            value={loadable}
            onValueChange={setLoadable}
            trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
            accessibilityLabel={t('train.lift.loadable')}
            testID="lift-loadable"
          />
        </View>
      ) : null}
      <View style={styles.liftToggleRow}>
        <View style={styles.liftToggleText}>
          <Text style={styles.liftToggleLabel}>{t('train.lift.microplates')}</Text>
          <Text style={styles.liftHint}>{t('train.lift.microplatesHint')}</Text>
        </View>
        <Switch
          value={microplates}
          onValueChange={setMicroplates}
          trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
          accessibilityLabel={t('train.lift.microplates')}
          testID="lift-microplates"
        />
      </View>

      {/* ── The resolved configuration: what the next recommendation reads ── */}
      <View style={styles.liftEffective} testID="lift-effective">
        <Text style={styles.liftLabel}>{t('train.lift.effective')}</Text>
        <Text style={styles.liftEffectiveLine}>
          {t('train.lift.eff.category', {
            category: t(CATEGORY_KEY[config.category]),
            source: t(config.categorySource === 'set' ? 'train.lift.eff.categorySet' : 'train.lift.eff.categoryInferred'),
          })}
        </Text>
        <Text style={styles.liftEffectiveLine}>
          {t('train.lift.eff.range', {
            min: config.repRange.min,
            max: config.repRange.max,
            source: t(config.repRangeSource === 'set' ? 'train.lift.eff.rangeSet' : 'train.lift.eff.rangeDefault'),
          })}
        </Text>
        <Text style={styles.liftEffectiveLine}>
          {t('train.lift.eff.equipment', { equipment: t(EQUIPMENT_KEY[config.equipment]) })}
        </Text>
        {config.equipment === 'bodyweight' && !config.loadable ? null : (
          <Text style={styles.liftEffectiveLine} testID="lift-effective-steps">
            {config.loadSteps
              ? t('train.lift.eff.steps', { steps: `${stepsText(config.loadSteps, unitSystem)} ${unit}` })
              : t(config.stepsUnknown ? 'train.lift.eff.stepGuess' : 'train.lift.eff.step', { step: fmt(config.stepLb) })}
          </Text>
        )}
        {config.smithBarEffectiveLb != null ? (
          <Text style={styles.liftEffectiveLine}>{t('train.lift.eff.bar', { bar: fmt(config.smithBarEffectiveLb) })}</Text>
        ) : null}
        {config.approximate ? (
          <Text style={styles.liftEffectiveLine} testID="lift-effective-approximate">{t('train.lift.eff.approximate')}</Text>
        ) : null}
        <Text style={styles.liftEffectiveLine}>{t('train.lift.eff.effort', { effort: effortLabel })}</Text>
        {config.loadable && config.category === 'bodyweight' ? (
          <Text style={styles.liftEffectiveLine}>{t('train.lift.loadable')}</Text>
        ) : null}
        {config.microplates ? <Text style={styles.liftEffectiveLine}>{t('train.lift.microplates')}</Text> : null}
        {config.assisted ? <Text style={styles.liftEffectiveLine}>{t('train.lift.eff.assisted')}</Text> : null}
      </View>

      <Touchable
        style={[styles.finishBtn, !canSave && styles.btnDisabled]}
        onPress={save}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave, busy: saving }}
        testID="lift-save"
      >
        <Text style={styles.finishText}>{t('train.lift.save')}</Text>
      </Touchable>
      </View>
      </ScrollView>
    </BottomSheet>
  );
}
