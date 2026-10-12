import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Switch, Text, useWindowDimensions, View } from 'react-native';
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
  structureOf,
  toDisplayLoad,
} from '@macrolog/core';
import { CATEGORY_REP_RANGES, EXERCISE_CATEGORIES } from '@macrolog/core/workout';
import { BottomSheet } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { SheetHeader } from '@/components/SheetHeader';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { showToast } from '@/components/Toast';
import { createStyles } from '@/components/train/train-styles';
import { MuscleChips, MuscleCreditLine } from '@/components/train/MuscleChips';
import type { MuscleGroup } from '@macrolog/core/workout';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import type {
  EffortStandard, Exercise, ExerciseCategory, ExercisePatch, ProgressionRule, SetStructure,
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

/** The template row a draft was opened from: its name, a stack's fallback
 *  step (`progression.incrementLb`), and what it is programmed as — the
 *  cluster-credit line reads that (train-ux J-N1). */
export interface LiftTemplateRow {
  name?: string;
  progression?: Partial<ProgressionRule>;
  setStructure?: SetStructure;
  plannedSets?: readonly { kind: string }[];
}

/** Structures whose sets the weekly "Myo-rep clusters by muscle" counts. */
const CLUSTERED: ReadonlySet<SetStructure> = new Set(['myoreps', 'rest-pause', 'cluster']);

/**
 * Whether this lift has or plans clusters — the gate on the "Myo-rep clusters
 * by muscle counts it as …" line (train-ux J-N1). For a straight-set Bench
 * Press of a lifter who has never programmed a cluster, that line named a
 * metric their home does not even show. Template row → catalog → inference,
 * the engine's own order (core `structureOf`).
 */
export function liftPlansClusters(
  exercise: Pick<Exercise, 'setStructure'> | null | undefined,
  templateRow: LiftTemplateRow | null | undefined,
): boolean {
  return CLUSTERED.has(structureOf(templateRow ?? undefined, exercise ?? undefined));
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

/** What opens the draft: the lift, the row it was opened from, and the two
 *  ways out. `active` is the sheet's `visible` / the editor's sub-page being
 *  shown — each rising edge re-reads the lift into a fresh draft. */
export interface LiftSettingsDraftArgs {
  active: boolean;
  exercise: Exercise | null;
  /** The template row the settings were opened from, if any: a stack's
   *  fallback step and the cluster-credit gate read it. */
  templateRow?: LiftTemplateRow | null;
  onClose: () => void;
  onSave: (patch: ExercisePatch) => Promise<void>;
}

/**
 * The lift-settings draft and its two exits, apart from any chrome (train-ux
 * X6/T26): the sheet wraps it in a `BottomSheet`, and the template editor
 * shows it as an in-sheet page — both need `dirty` and `requestClose` at
 * render time (a sheet's `guarded`, the editor's Back row), so the state lives
 * in a hook the host calls rather than inside the form.
 */
export function useLiftSettingsDraft({ active, exercise, templateRow, onClose, onSave }: LiftSettingsDraftArgs) {
  const t = useT();
  const unitSystem = useUnitSystem();

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
  /** The catalog's muscle tags, primary first (`muscles[0]`) — editable here
   *  since 2026-10-11 so a superset warning built on a wrong tag can be fixed
   *  from the template editor that shows it. */
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [initial, setInitial] = useState({ min: '', max: '', steps: '', bar: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
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
    setMuscles(exercise?.muscles ?? []);
    setSaving(false);
  }, [active, exercise, unitSystem]);

  const name = exercise?.name ?? templateRow?.name ?? '';
  const inferred = inferCategory(name);
  const effectiveCategory = category ?? inferred;
  const categoryRange = CATEGORY_REP_RANGES[effectiveCategory];

  // Parse the draft once; the effective block and save() both read it.
  const rangeTyped = minText.trim() !== '' || maxText.trim() !== '';
  // A blank end is the category default's end — what its "auto" placeholder
  // says (train-ux F6). A typed 7 over a blank max used to be flagged in red
  // and then held Save disabled behind "enter both ends"; it is 7–12 on a
  // compound, said in the hint and saved as such.
  const typedRange = {
    min: minText.trim() === '' ? categoryRange.min : intOrNull(minText) ?? NaN,
    max: maxText.trim() === '' ? categoryRange.max : intOrNull(maxText) ?? NaN,
  };
  const rangeOk = !rangeTyped || isValidRepRange(typedRange);
  const rangeHalf = rangeTyped && (minText.trim() === '' || maxText.trim() === '');
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
    if (muscles.join(',') !== (exercise?.muscles ?? []).join(',')) patch.muscles = muscles;
    return patch;
  }

  // Anything the lifter changed and has not saved — what a swipe-down or
  // Cancel would throw away.
  const dirty = active && exercise != null && Object.keys(buildPatch()).length > 0;

  /** Close, asking first when there are unsaved changes. `false` = stay open. */
  function requestClose(): boolean {
    if (!dirty) {
      onClose();
      return true;
    }
    confirm({
      title: t('train.lift.discardTitle', { name: name || t('train.lift.title') }),
      confirmText: t('train.discard'),
      destructive: true,
      onConfirm: onClose,
      // Both hosts are native sheets (the editor's page, the stand-alone
      // sheet): on iOS the system action sheet, not a sheet on a sheet
      // (R30/R31, F2). Android keeps the branded confirm, as the editor does.
      native: Platform.OS === 'ios',
    });
    return false;
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

  return {
    exercise, templateRow, name, inferred, effectiveCategory, categoryRange, config,
    category, setCategory, minText, setMinText, maxText, setMaxText, steps, setSteps,
    bar, setBar, standard, setStandard, loadable, setLoadable, microplates, setMicroplates,
    muscles, setMuscles, rangeTyped, typedRange, rangeOk, rangeHalf, parsedSteps, barOk,
    saving, canSave, dirty, requestClose, save,
  };
}

export type LiftSettingsDraft = ReturnType<typeof useLiftSettingsDraft>;

/**
 * The settings themselves — every field and the resolved block — with no sheet
 * and no scroll view around them: the sheet below scrolls it under its header,
 * the template editor scrolls it under a Back row.
 *
 * One way out and one Save per host (R31; train-ux E-N4, J-N9). The SHEET's
 * header carries Cancel + Save and its foot repeats only Save, at the end of
 * a long form — never a second Cancel. The editor's PAGE (`mode="page"`) has
 * the Back row as its exit and the header's Save, so no foot at all — and it
 * says that this Save writes the LIFT, at once: a later "Discard changes" on
 * the template does not undo it, and nothing on the page said so.
 *
 * The header's title is the lift's name; "Lift settings" is the line under it
 * (H-N15: "Cancel  Lift settings" read as one phrase, the name a muted
 * afterthought).
 */
export function LiftSettingsForm({ draft, mode }: { draft: LiftSettingsDraft; mode?: 'sheet' | 'page' }) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const unit = loadUnit(unitSystem);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const doneKey = useDoneKeyProps();
  // The rep-range fields grow with the text size: a fixed 84 pt clipped two
  // digits at AX5 (train-ux X9). Capped at 2× so the row still fits.
  const { fontScale } = useWindowDimensions();
  const bandWidth = Math.round(84 * Math.min(Math.max(fontScale, 1), 2));
  /** At accessibility sizes the chips take a row each: two to a row, a
   *  one-word label wider than its chip ("Bodyweight") broke mid-word
   *  (train-ux F3, the Exercise-edit precedent). */
  const stackChips = fontScale >= 1.6;
  const page = mode === 'page';
  const {
    exercise, templateRow, name, inferred, effectiveCategory, categoryRange, config,
    category, setCategory, minText, setMinText, maxText, setMaxText, steps, setSteps,
    bar, setBar, standard, setStandard, loadable, setLoadable, microplates, setMicroplates,
    muscles, setMuscles, rangeTyped, typedRange, rangeOk, rangeHalf, parsedSteps, barOk,
    saving, canSave, save,
  } = draft;
  const showCredit = liftPlansClusters(exercise, templateRow);
  const fmt = (lb: number) => formatLoad(lb, unitSystem);
  const effortLabel = t(config.effortStandard === 'failure' ? 'train.lift.effortFailure' : 'train.lift.effortRir1');

  return (
    <View style={styles.sheetStack}>
    {/* The header names the lift; this says what of it is being edited. */}
    {name ? <Text style={styles.sheetHint} testID="lift-subtitle">{t('train.lift.title')}</Text> : null}
    {page && name ? (
      <Text style={styles.liftHint} testID="lift-scope-hint">{t('train.lift.scopeHint', { name })}</Text>
    ) : null}

    {/* ── Muscles: primary first. Superset pairings and the cluster count read it. ── */}
    <View style={styles.liftSection} testID="lift-muscles">
      <Text style={styles.fieldLabel}>{t('train.musclesLabel')}</Text>
      <Text style={styles.sheetHint}>{t('train.musclesPrimaryHint')}</Text>
      <MuscleChips value={muscles} onChange={setMuscles} testIDPrefix="lift-muscle" />
      {/* Only for a lift that has or plans clusters — the metric counts
          nothing else (J-N1). */}
      {showCredit ? <MuscleCreditLine name={name} muscles={muscles} testID="lift-muscle-credit" /> : null}
    </View>

    {/* ── Category: "Auto" clears the field and says what it inferred ── */}
    <View style={styles.liftSection}>
      <Text style={styles.liftLabel}>{t('train.lift.category')}</Text>
      <View style={[styles.styleRow, stackChips ? { flexDirection: 'column' } : styles.styleRowWrap, { marginTop: 0 }]} accessibilityRole="radiogroup">
        {([null, ...EXERCISE_CATEGORIES] as const).map((c) => {
          const on = category === c;
          return (
            <Touchable
              key={c ?? 'auto'}
              style={[styles.styleChip, !stackChips && styles.styleChipHalf, on && styles.styleChipOn]}
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
          style={[styles.input, styles.liftBandInput, { width: bandWidth }]}
          keyboardType="number-pad"
          // "auto", not the default's digits: a grey "6" beside "Leave empty
          // to use it" read as a typed value (train-ux X9). The hint below
          // names the default.
          placeholder={t('train.lift.repRangeAutoPh')}
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
          style={[styles.input, styles.liftBandInput, { width: bandWidth }]}
          keyboardType="number-pad"
          placeholder={t('train.lift.repRangeAutoPh')}
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
        {!rangeOk
          ? t('train.lift.repRangeInvalid')
          : rangeHalf
            ? t('train.lift.repRangeFilled', { min: typedRange.min, max: typedRange.max })
            : t('train.lift.repRangeDefault', { min: categoryRange.min, max: categoryRange.max })}
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
      <View style={[styles.styleRow, stackChips && { flexDirection: 'column' }, { marginTop: 0 }]} accessibilityRole="radiogroup">
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
      {/* Equipment is read off the name and nothing here can change it, so
          say where it came from — and when the name said nothing, say that
          instead of "Equipment: other" (train-ux X7). */}
      <Text style={styles.liftEffectiveLine} testID="lift-effective-equipment">
        {config.equipment === 'other'
          ? t('train.lift.eff.equipmentUnknown', { step: fmt(config.stepLb) })
          : `${t('train.lift.eff.equipment', { equipment: t(EQUIPMENT_KEY[config.equipment]) })}${t('train.lift.eff.fromName')}`}
      </Text>
      {/* An unrecognised name's line above already says the default step:
          "Step: 5 lb" under it said it twice (H-N15). */}
      {(config.equipment === 'bodyweight' && !config.loadable) || (config.equipment === 'other' && !config.loadSteps) ? null : (
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

    {/* The sheet's foot repeats only Save, at the end of a long form; the
        header's Cancel is the one way out (J-N9). The page has no foot: Back
        and the header's Save (E-N4). */}
    {page ? null : (
      <View style={styles.footerBtns}>
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
    )}
    </View>
  );
}

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
 * The "What Ignia uses to suggest weights" block is `resolveEngineConfig`
 * over the draft, the same resolution the engine runs — so what the sheet
 * shows is what the next recommendation reads, not a parallel guess.
 *
 * Cancel and Save sit in the header and Save again at the foot (train-ux X5,
 * J-N9), and a swipe-down with unsaved changes asks first — it discarded them
 * silently.
 *
 * This is the thin sheet around `useLiftSettingsDraft` + `LiftSettingsForm`,
 * for the live session and the home screen. The template editor does NOT use
 * it: there the same form is a page inside the editor's own sheet, so it never
 * stacks a second sheet over the first (train-ux X6/T26/J7).
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
  /** The template row the sheet was opened from, if any: a stack's
   *  fallback step and the cluster-credit gate read it. */
  templateRow?: LiftTemplateRow | null;
  /** Retired with the derived rep band — the sheet shows the resolved
   *  configuration instead. Accepted so existing callers still compile. */
  rec?: Recommendation | null;
  onClose: () => void;
  onSave: (patch: ExercisePatch) => Promise<void>;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const draft = useLiftSettingsDraft({ active: visible, exercise, templateRow, onClose, onSave });

  return (
    <BottomSheet
      native
      visible={visible}
      onClose={onClose}
      guarded={draft.dirty}
      onRequestClose={() => draft.requestClose()}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      <View style={styles.sheetStack}>
      <SheetHeader
        title={draft.name || t('train.lift.title')}
        leading={{ label: t('common.cancel'), onPress: () => void draft.requestClose(), testID: 'lift-cancel' }}
        trailing={{ label: t('common.save'), onPress: () => void draft.save(), disabled: !draft.canSave, testID: 'lift-save-header' }}
      />
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <LiftSettingsForm draft={draft} />
      </ScrollView>
      </View>
    </BottomSheet>
  );
}
