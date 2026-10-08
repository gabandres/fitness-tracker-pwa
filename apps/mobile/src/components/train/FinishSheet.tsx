import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Touchable } from './Touchable';
import Animated from 'react-native-reanimated';
import { SheetTextInput } from '@/components/SheetTextInput';
import {
  type ActivationFinding,
  type Recommendation,
  type TemplateLoadChange,
  applyTemplateChanges,
  bodyWeightUnit,
  checkWeightEntry,
  finishProgression,
  finishSummary,
  formatLoad,
  parseWeightToLb,
  proposeTemplateChanges,
  sessionActivationIssues,
  weightBoundsFor,
} from '@macrolog/core';
import { BottomSheet } from '@/components/BottomSheet';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { confirm } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import type { TemplateExercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import { useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { announce } from '@/lib/a11y';
import { isOffline } from '@/lib/connectivity';
import * as haptics from '@/lib/haptics';
import { enterUp, usePulse } from '@/lib/motion';
import { recordPositiveMoment } from '@/lib/reviewPrompt';
import { useTheme, useThemedStyles } from '@/lib/theme-context';
import { useUnitSystem } from '@/lib/use-unit-system';
import { numOrUndef } from './train-shared';
import { type FinishCall, activationIssueKey, finishCalls } from './train-summary';
import { createStyles } from './train-styles';
import { reasonText, recommendationText } from './recommendation-text';

/**
 * Finish a workout: what it was (time, volume, sets, records, and how it
 * compares with last time), then Complete. Body weight and sleep are behind
 * one optional row (Train review item 34) — they were the sheet's whole
 * content, and they are the least of what finishing a workout is about.
 *
 * Complete no longer waits on the network (Train review bug 2): `onFinish`
 * resolves as soon as the finish is recorded on the device. It resolves
 * `false` only when that failed too, and then the sheet stays up with the
 * typed values and an error line, and Complete is the retry.
 *
 * "Next session" (2026-10-07) lists the engine's call for every lift that has
 * one, read with this workout counted as the newest: the call, the new load,
 * the reps to expect and the reason. When the session came from a template,
 * the calls that would move its load can be applied — all of them, or the
 * ones left switched on. With "Auto-apply progression" on they are applied
 * at Complete instead, and the sheet says so; with it off the template never
 * moves without the tap.
 */
export function FinishSheet({
  visible,
  session,
  recentSessions,
  onFinish,
  onClose,
  invalid,
  calls = [],
  proposed = [],
  templateName = null,
  autoApply = false,
  onApply,
}: {
  visible: boolean;
  session: WorkoutSession;
  recentSessions: readonly WorkoutSession[];
  /** Lifts whose activation could not be read. Reported, never blocking. A
   *  lift that also has a call below is reported there, once. */
  invalid: ActivationFinding[];
  /** The engine's call per lift, from the history including this session. */
  calls?: FinishCall[];
  /** The template moves those calls imply (empty without a template). */
  proposed?: TemplateLoadChange[];
  /** The template the session came from, when it still exists. */
  templateName?: string | null;
  /** The lifter's "Auto-apply progression": applied at Complete, no button. */
  autoApply?: boolean;
  /** Apply these changes to the template now. Resolves false on failure. */
  onApply?: (changes: TemplateLoadChange[]) => Promise<boolean>;
  /** Resolves `false` when the save failed and the sheet should stay open. */
  onFinish: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<boolean | void> | boolean | void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const doneKey = useDoneKeyProps();
  // Body weight only — the LOADS on this screen (volume, PRs, plate math) are
  // converted where they are shown. F3 is about the weight of the person.
  const unitSystem = useUnitSystem();
  const [bodyweight, setBodyweight] = useState('');
  const [sleep, setSleep] = useState('');
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [weightErr, setWeightErr] = useState('');
  const [saveErr, setSaveErr] = useState('');
  // Per-lift Apply toggles (default on) and what has been applied this opening.
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const [applied, setApplied] = useState<ReadonlySet<string>>(() => new Set());
  const [applying, setApplying] = useState(false);
  // The clock the summary is read at, taken when the sheet opens: a duration
  // that ticks while you decide whether to add your body weight is noise.
  const [openedAt, setOpenedAt] = useState(() => Date.now());

  useEffect(() => {
    if (visible) {
      setBodyweight('');
      setSleep('');
      setExtrasOpen(false);
      setBusy(false);
      setWeightErr('');
      setSaveErr('');
      setOpenedAt(Date.now());
      setOff(new Set());
      setApplied(new Set());
      setApplying(false);
    }
  }, [visible]);

  const changeFor = useMemo(() => new Map(proposed.map((c) => [c.exerciseId, c])), [proposed]);
  // A lift with a call is reported in the call list; the old block keeps
  // only the findings for lifts the engine had nothing to say about.
  const called = useMemo(() => new Set(calls.map((c) => c.exerciseId)), [calls]);
  const invalidRest = invalid.filter((f) => !called.has(f.exerciseId));
  const pending = proposed.filter((c) => !applied.has(c.exerciseId));
  const selected = pending.filter((c) => !off.has(c.exerciseId));
  const canApply = templateName != null && !autoApply && onApply != null;

  async function apply() {
    if (!onApply || applying || selected.length === 0) return;
    setApplying(true);
    try {
      const ok = await onApply(selected);
      if (ok) {
        haptics.success();
        setApplied((cur) => new Set([...cur, ...selected.map((c) => c.exerciseId)]));
      }
    } catch (e) {
      // A catch that resets and rethrows, then the same reset after it: the
      // `finally` this was cannot be lowered by React Compiler, which skipped
      // the whole sheet. Same effect — reset on both paths, the error still
      // propagates.
      setApplying(false);
      throw e;
    }
    setApplying(false);
  }

  const summary = useMemo(
    () => finishSummary(session, recentSessions, openedAt),
    [session, recentSessions, openedAt],
  );
  const vsLast = summary.previousVolume && summary.previousVolume > 0 && summary.volume > 0
    ? Math.round(((summary.volume - summary.previousVolume) / summary.previousVolume) * 100)
    : null;
  const typed = bodyweight.trim() !== '' || sleep.trim() !== '';

  // A record is the best thing a workout can end on, and it was one trophy
  // line among the stats (Train re-score, delight). It now leads the sheet: a
  // heading, a trophy that bounces once (skipped under reduce motion — the
  // haptic carries it), a success haptic. Once per opening.
  const prCount = summary.prs.length;
  const [trophyPulse, triggerTrophy] = usePulse(1.3);
  const celebrated = useRef(false);
  useEffect(() => {
    if (!visible) {
      celebrated.current = false;
      return;
    }
    if (prCount > 0 && !celebrated.current) {
      celebrated.current = true;
      triggerTrophy();
      haptics.success();
    }
  }, [visible, prCount, triggerTrophy]);

  async function finish() {
    if (busy) return;
    // Same gate the Body tab applies (`checkWeightEntry`): this sheet mirrors
    // its value into `dailyWeights`, and it accepted 11 lb once. A typo is
    // rejected here, in the sheet, rather than silently dropped by the writer.
    const lb = parseWeightToLb(bodyweight, unitSystem);
    if (lb != null && !checkWeightEntry(lb).ok) {
      const b = weightBoundsFor(unitSystem);
      const msg = t('body.weightRange', { min: b.min, max: b.max, unit: bodyWeightUnit(unitSystem) });
      setWeightErr(msg);
      announce(msg, { androidHasLiveRegion: true });
      return;
    }
    setWeightErr('');
    setSaveErr('');
    setBusy(true);
    // Built before the `try`: React Compiler cannot lower the `??` inside one.
    const extras = {
      bodyweight: lb ?? undefined,
      sleepHours: numOrUndef(sleep),
    };
    try {
      const ok = await onFinish(extras);
      if (ok === false) setSaveErr(t('train.workoutSaveErr'));
    } catch (e) {
      // Reset and rethrow, then reset after: see `apply`.
      setBusy(false);
      throw e;
    }
    setBusy(false);
  }

  return (
    <BottomSheet
      native
      detents={[0.5, 1]}
      // Guarded once something is typed: a swipe then asks instead of
      // throwing the number away.
      guarded={typed}
      onRequestClose={() => {
        if (!typed) {
          onClose();
          return true;
        }
        confirm({
          title: t('train.discardChangesTitle'),
          confirmText: t('train.discard'),
          destructive: true,
          onConfirm: onClose,
        });
        return false;
      }}
      visible={visible}
      onClose={onClose}
      contentStyle={styles.sheetBody}
      maxHeight="80%"
    >
      {/* Scroll so the numeric keyboard can't hide the Complete button
          (KeyboardAvoidingView under-lifts inside a bottom-sheet Modal). */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.finishScroll}
      >
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('train.finishTitle')}</Text>

        {prCount > 0 ? (
          <Animated.View entering={enterUp(0)} style={styles.prHero} testID="finish-pr-hero">
            <Animated.View style={trophyPulse}>
              <Ionicons name="trophy" size={34} color={colors.accent} />
            </Animated.View>
            <Text style={styles.prHeroText} accessibilityRole="header">
              {prCount === 1 ? t('train.prHeadOne') : t('train.prHeadMany', { n: prCount })}
            </Text>
          </Animated.View>
        ) : null}

        <View style={styles.summaryGrid} testID="finish-summary">
          <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summaryTime')}: ${t('train.summaryMinutes', { n: summary.durationMin })}`}>
            <Text style={styles.summaryValue}>{t('train.summaryMinutes', { n: summary.durationMin })}</Text>
            <Text style={styles.summaryLabel}>{t('train.summaryTime')}</Text>
          </View>
          <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summaryVolume')}: ${formatLoad(summary.volume, unitSystem, 0)}`}>
            <Text style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatLoad(summary.volume, unitSystem, 0)}
            </Text>
            <Text style={styles.summaryLabel}>{t('train.summaryVolume')}</Text>
          </View>
          <View style={styles.summaryTile} accessible accessibilityLabel={`${t('train.summarySets')}: ${summary.sets}`}>
            <Text style={styles.summaryValue}>{summary.sets}</Text>
            <Text style={styles.summaryLabel}>{t('train.summarySets')}</Text>
          </View>
        </View>

        {summary.prs.map((pr) => (
          <View key={pr.exerciseId} style={styles.syncRow} testID={`finish-pr-${pr.exerciseId}`}>
            <Ionicons name="trophy-outline" size={16} color={colors.accent} />
            <Text style={styles.summaryBest}>
              {t('train.summaryNewBest', { name: pr.name, weight: formatLoad(pr.weight, unitSystem), reps: pr.reps })}
            </Text>
          </View>
        ))}
        {/* No record to lead with: name the best set instead — the one line
            of a finished workout worth reading twice (Train re-score 3). */}
        {prCount === 0 && summary.topSet ? (
          <View style={styles.syncRow} testID="finish-top-set">
            <Ionicons name="barbell-outline" size={16} color={colors.muted} />
            <Text style={styles.summaryBest}>
              {t('train.summaryTopSet', {
                name: summary.topSet.name,
                weight: formatLoad(summary.topSet.weight, unitSystem),
                reps: summary.topSet.reps,
              })}
            </Text>
          </View>
        ) : null}
        {vsLast != null && vsLast !== 0 ? (
          <Text style={styles.summaryLine} testID="finish-vs-last">
            {t('train.summaryVsLast', { delta: `${vsLast > 0 ? '+' : '−'}${Math.abs(vsLast)}%` })}
          </Text>
        ) : null}

        {/* Lifts with nothing logged are dropped by the save. Said here, while
            they can still be done, rather than letting a forgotten lift
            vanish from the record (Train re-score 3). Never blocking. */}
        {summary.unstarted.length > 0 ? (
          <View style={styles.invalidBox} testID="finish-unstarted">
            <Ionicons name="alert-circle-outline" size={18} color={colors.muted} />
            <Text style={[styles.invalidHint, { flex: 1, marginTop: 0 }]}>
              {plural(t, locale, 'train.unstarted', summary.unstarted.length, {
                names: summary.unstarted.join(', '),
              })}
            </Text>
          </View>
        ) : null}

        {calls.length > 0 ? (
          <View testID="finish-calls">
            <Text style={styles.invalidHeading} accessibilityRole="header">{t('train.rec.finish.heading')}</Text>
            {calls.map((c) => (
              <FinishCallRow
                key={c.exerciseId}
                call={c}
                change={changeFor.get(c.exerciseId)}
                toggle={canApply && changeFor.has(c.exerciseId) && !applied.has(c.exerciseId)}
                on={!off.has(c.exerciseId)}
                applied={applied.has(c.exerciseId)}
                onToggle={() =>
                  setOff((cur) => {
                    const next = new Set(cur);
                    if (next.has(c.exerciseId)) next.delete(c.exerciseId);
                    else next.add(c.exerciseId);
                    return next;
                  })
                }
              />
            ))}
            {calls.some((c) => c.rec.action === 'repeat-invalid') ? (
              <Text style={styles.invalidHint}>{t('train.invalidHint')}</Text>
            ) : null}
            {templateName != null && autoApply && proposed.length > 0 ? (
              <Text style={styles.sheetHint} testID="finish-auto-apply">
                {t('train.rec.finish.auto', { template: templateName })}
              </Text>
            ) : null}
            {canApply && pending.length > 0 ? (
              <Touchable
                style={[styles.callApplyBtn, (selected.length === 0 || applying) && styles.btnDisabled]}
                onPress={apply}
                disabled={selected.length === 0 || applying}
                accessibilityRole="button"
                accessibilityState={{ disabled: selected.length === 0 || applying, busy: applying }}
                testID="finish-apply"
              >
                <Text style={styles.callApplyText}>{t('train.rec.finish.apply', { n: selected.length })}</Text>
              </Touchable>
            ) : null}
            {templateName != null && applied.size > 0 ? (
              <Text style={styles.callApplied} testID="finish-applied">
                {t('train.rec.finish.applied', { template: templateName })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {invalidRest.length > 0 ? (
          <View style={styles.invalidBox} testID="finish-invalid-activations">
            <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.invalidHeading}>{t('train.invalidHeading')}</Text>
              {invalidRest.map((f) => (
                <Text key={f.exerciseId} style={styles.invalidRow}>
                  <Text style={styles.invalidName}>{f.name}</Text>
                  {' — '}
                  {t(activationIssueKey(f.issue))}
                </Text>
              ))}
              <Text style={styles.invalidHint}>{t('train.invalidHint')}</Text>
            </View>
          </View>
        ) : null}

        <Touchable
          style={styles.moreRow}
          onPress={() => setExtrasOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: extrasOpen }}
          testID="finish-extras"
        >
          <Text style={styles.moreText}>{t('train.finishExtras')}</Text>
          <Ionicons name={extrasOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
        </Touchable>

        {extrasOpen ? (
          <>
            <Text style={styles.sheetHint}>{t('train.finishHint')}</Text>
            <View style={styles.finishRow}>
              <View style={styles.finishField}>
                <Text style={styles.fieldLabel}>
                  {t('train.bodyweight', { unit: bodyWeightUnit(unitSystem) })}
                </Text>
                <SheetTextInput
                  style={styles.input}
                  placeholder="—"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={bodyweight}
                  onChangeText={setBodyweight}
                  selectTextOnFocus
                  {...doneKey}
                  // The placeholder is a dash; without a label a screen
                  // reader announced the field as "dash" (UX_AUDIT S20).
                  accessibilityLabel={t('train.bodyweight', { unit: bodyWeightUnit(unitSystem) })}
                  testID="finish-bodyweight"
                />
                {weightErr ? (
                  <Text
                    style={[styles.sheetHint, { color: colors.danger }]}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    testID="finish-bodyweight-error"
                  >
                    {weightErr}
                  </Text>
                ) : null}
              </View>
              <View style={styles.finishField}>
                <Text style={styles.fieldLabel}>{t('train.sleepH')}</Text>
                <SheetTextInput
                  style={styles.input}
                  placeholder="—"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={sleep}
                  onChangeText={setSleep}
                  selectTextOnFocus
                  {...doneKey}
                  accessibilityLabel={t('train.sleepHoursA11y')}
                  testID="finish-sleep"
                />
              </View>
            </View>
          </>
        ) : null}

        {saveErr ? (
          <Text
            style={[styles.sheetHint, { color: colors.danger }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="finish-save-error"
          >
            {saveErr}
          </Text>
        ) : null}

        {/* The button IS the retry: a failed save leaves the sheet open with
            the typed values and the error line above, and tapping Complete
            again re-runs the same write (`s18-train-finish.test.tsx`). */}
        <Touchable
          style={styles.finishBtn}
          onPress={finish}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          testID="finish-confirm"
        >
          <Text style={styles.finishText}>{busy ? t('common.saving') : t('train.complete')}</Text>
        </Touchable>
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * One lift's call on the finish sheet: name and headline ("35 lb ·
 * INCREASE"), the rep target, what to expect at a new load, the reason, and —
 * when the call would move the template — the move itself with its toggle.
 */
function FinishCallRow({
  call,
  change,
  toggle,
  on,
  applied,
  onToggle,
}: {
  call: FinishCall;
  change?: TemplateLoadChange;
  /** Offer the per-lift Apply toggle. */
  toggle: boolean;
  on: boolean;
  applied: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const text = recommendationText(call.rec, unitSystem, t);
  if (!text) return null;
  const moves = text.call === 'increase' || text.call === 'drop';
  const fmt = (lb: number) => formatLoad(lb, unitSystem);
  return (
    <View style={styles.callRow} testID={`finish-call-${call.exerciseId}`}>
      <View style={styles.callMain}>
        <View style={styles.callHead}>
          <Text style={styles.callName}>{call.name}</Text>
          <Text style={[styles.callChip, moves && styles.callChipMove]} testID={`finish-call-${call.exerciseId}-headline`}>
            {text.headline}
          </Text>
        </View>
        {text.target ? <Text style={styles.recTarget}>{text.target}</Text> : null}
        {text.expect ? <Text style={styles.recNote}>{text.expect}</Text> : null}
        <Text style={styles.recReason}>{text.reason}</Text>
        {text.stall.length > 0 ? <Text style={styles.recNote}>{text.stall[0]}</Text> : null}
        {change ? (
          <Text style={styles.recNote} testID={`finish-change-${call.exerciseId}`}>
            {change.from != null
              ? t('train.rec.finish.change', { from: fmt(change.from), to: fmt(change.to) })
              : t('train.rec.finish.changeNew', { to: fmt(change.to) })}
          </Text>
        ) : null}
      </View>
      {toggle ? (
        <Touchable
          style={styles.callToggle}
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: on }}
          accessibilityLabel={t('train.rec.finish.toggleA11y', { name: call.name })}
          testID={`finish-toggle-${call.exerciseId}`}
        >
          <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.teal : colors.faint} />
        </Touchable>
      ) : applied ? (
        <View style={styles.callToggle}>
          <Ionicons name="checkmark-circle" size={22} color={colors.teal} />
        </View>
      ) : null}
    </View>
  );
}

/** The template draft `saveTemplate` writes: the whole doc minus its id and
 *  stamps, with `exercises` replaced whole — `loadLog` included, since the
 *  write is a full overwrite of the array. */
function templateDraftWith(tpl: WorkoutTemplate, exercises: TemplateExercise[]) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...draft } = tpl;
  return { ...draft, exercises };
}

/**
 * The Finish sheet as the SCREEN mounts it, wired to the hook.
 *
 * Owned by the screen rather than by `ActiveSession` because finishing
 * unmounts the session, and a native sheet has to be closed by an owner that
 * is still mounted. It holds the last live session while it closes, so its
 * content does not blank mid-animation.
 *
 * It also owns the engine's calls at the finish boundary: computed here with
 * the session counted as the newest completed one, applied to the template
 * through the hook's `saveTemplate` (the same path the rest picker's "Keep
 * for this lift" writes) — on the Apply tap, or at Complete when the lifter
 * has auto-apply on. Never otherwise.
 */
export function TrainFinishSheet({
  train,
  visible,
  onClose,
  onShare,
}: {
  train: Pick<TrainState, 'active' | 'editingExisting' | 'templates' | 'recentSessions' | 'finishWorkout'>
    & Partial<Pick<TrainState, 'catalog' | 'saveTemplate' | 'trainingPhase' | 'autoApplyProgression'>>;
  visible: boolean;
  onClose: () => void;
  /** Share the workout just finished — offered on the "Workout saved" receipt. */
  onShare?: (session: WorkoutSession) => void;
}) {
  const t = useT();
  const unitSystem = useUnitSystem();
  const live = train.active && !train.editingExisting ? train.active : null;
  // What the sheet shows, followed ONLY while it is open. This component is
  // mounted for the whole live session, and `train.active` is a new object on
  // every keystroke — so following it while closed re-ran `finishSummary`
  // and `sessionActivationIssues` (every set of every lift, plus the PR scan
  // over recent sessions) on each digit typed into a set row, for a sheet
  // nobody could see (UX_AUDIT S20). Held after close, so the content does
  // not blank mid-animation, and null until the first open, so the sheet is
  // not even mounted before then.
  //
  // Derived during render (React's "previous value" pattern), not in an
  // effect: an effect would paint one frame of the stale session first.
  const [held, setHeld] = useState<{
    session: WorkoutSession;
    recent: readonly WorkoutSession[];
    templates: TrainState['templates'];
  } | null>(null);
  if (
    visible &&
    live &&
    (held?.session !== live || held.recent !== train.recentSessions || held.templates !== train.templates)
  ) {
    setHeld({ session: live, recent: train.recentSessions, templates: train.templates });
  }
  const session = held?.session ?? null;
  const recentSessions = held?.recent;
  const templates = held?.templates;
  const template = session && templates ? templates.find((tpl) => tpl.id === session.templateId) ?? null : null;
  // Lifts whose activation set cannot be read as a progression input. Judged
  // against the template the session was STARTED from, which is the only way
  // "logged as straight sets where a cluster was prescribed" is detectable —
  // the session alone carries no prescription. An ad-hoc session (no template)
  // still gets the RIR checks, just not that one.
  const invalid = useMemo(
    () => (session ? sessionActivationIssues(session.exercises, template) : []),
    [session, template],
  );
  const catalog = train.catalog;
  const phase = train.trainingPhase ?? 'cut';
  const calls = useMemo(
    () =>
      session && recentSessions
        ? finishCalls({ session, recentSessions, catalog: catalog ?? [], template, phase, now: session.date.getTime() })
        : [],
    [session, recentSessions, catalog, template, phase],
  );
  const recs = useMemo(() => new Map<string, Recommendation>(calls.map((c) => [c.exerciseId, c.rec])), [calls]);
  // The sentence the lifter read is the one the template's `loadLog` keeps.
  const reasonFor = (rec: Recommendation) => reasonText(rec, unitSystem, t);
  // The same sentence as `reasonFor`, built in here from `t` and the unit it
  // closes over: naming the per-render `reasonFor` needed an eslint-disable,
  // and that alone made React Compiler skip the whole screen.
  const proposed = useMemo(
    () =>
      template
        ? proposeTemplateChanges(template.exercises, recs, (rec) => reasonText(rec, unitSystem, t))
        : [],
    [template, recs, t, unitSystem],
  );
  const autoApply = train.autoApplyProgression === true;
  const canWrite = template?.id != null && train.saveTemplate != null;

  /** Write a template's rows whole; false (and a toast) when it did not land. */
  async function writeRows(tpl: WorkoutTemplate, rows: TemplateExercise[]): Promise<boolean> {
    if (!tpl.id || !train.saveTemplate) return false;
    try {
      await train.saveTemplate(templateDraftWith(tpl, rows), tpl.id);
      return true;
    } catch {
      haptics.warning();
      showToast(t('train.rec.finish.applyErr'), { testID: 'train-toast' });
      return false;
    }
  }

  if (!session || !recentSessions) return null;
  return (
    <FinishSheet
      visible={visible}
      session={session}
      recentSessions={recentSessions}
      onClose={onClose}
      // Reported at the finish boundary, where the whole session is in view
      // and a lift can still be repeated — not as a mid-set interruption.
      // Never gates the save: an unreadable set is still training that
      // happened, and refusing to store it would lose the evidence.
      invalid={invalid}
      calls={calls}
      proposed={canWrite ? proposed : []}
      templateName={canWrite ? template?.name ?? null : null}
      autoApply={autoApply}
      onApply={(changes) => {
        // The template as it stands NOW, not as the sheet opened on it.
        const tpl = train.templates.find((x) => x.id === session.templateId);
        if (!tpl) return Promise.resolve(false);
        return writeRows(tpl, applyTemplateChanges(tpl.exercises, changes, { at: new Date(), by: 'engine' }));
      }}
      onFinish={async (extras) => {
        // `finishWorkout` answers `false` when it could not record the
        // finish at all (the hook's boolean contract); a legacy void resolve
        // reads as success. On failure the sheet stays up with the typed
        // values, says so, and does NOT spend a rating prompt.
        const ok: unknown = await train.finishWorkout(extras);
        if (ok === false) return false;
        // Auto-apply: the one path that moves a template without a tap, and
        // only because the lifter turned it on. `finishProgression` returns
        // `applied: null` with it off — the template is left exactly as it is.
        const tpl = canWrite ? train.templates.find((x) => x.id === session.templateId) : undefined;
        let updated: string | null = null;
        if (tpl) {
          const { applied } = finishProgression({
            rows: tpl.exercises, recs, autoApply, at: new Date(), reasonFor,
          });
          if (applied) {
            updated = tpl.name;
            // Behind the receipt, like the finish itself: a refusal toasts.
            void writeRows(tpl, applied);
          }
        }
        onClose();
        haptics.success();
        // A finish recorded offline IS saved — on this phone, until the
        // signal returns — and the receipt says it in those words.
        // Share rides on the receipt — the moment a finished workout is worth
        // showing someone, and the one place it costs nothing to offer.
        const finished = session;
        const saved = isOffline() ? t('train.savedOnPhone') : t('train.workoutSaved');
        showToast(
          updated ? `${saved} · ${t('train.rec.finish.updated', { template: updated })}` : saved,
          onShare
            ? { action: { label: t('train.share'), onPress: () => onShare(finished) }, testID: 'train-toast' }
            : undefined,
        );
        // Finishing a workout is the app's clearest "that went well" beat —
        // the best place to spend one of iOS's few rating requests.
        // Fire-and-forget; it self-throttles and no-ops until the user has
        // enough qualifying days.
        void recordPositiveMoment();
        return true;
      }}
    />
  );
}
