import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  type ActivityLevel,
  type GoalDirection,
  type Sex,
  bodyWeightUnit,
  computeProtein,
  isPlausibleAge,
  isPlausibleHeightIn,
  onboardingPace,
  onboardingSeed,
  parseWeightToLb,
  toDisplayWeight,
  validateCalorieTarget,
} from '@macrolog/core';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { saveOnboardingV2 } from '@/lib/ledger';
import { setRemindersEnabled } from '@/lib/reminders';
import { holdTour } from '@/lib/tour';
import { DEFAULT_MEAL_REMINDERS, STREAK_RISK_HOUR, STREAK_RISK_MINUTE } from '@macrolog/core';
import { track } from '@/lib/analytics';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { CountUpText, PressScale } from '@/lib/motion';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, type } from '@/theme';

type StepId = 'welcome' | 'goal' | 'weight' | 'goalWeight' | 'body' | 'activity' | 'plan' | 'reminders' | 'firstLog';
const ORDER: StepId[] = ['welcome', 'goal', 'weight', 'goalWeight', 'body', 'activity', 'plan'];
/** Steps that get a progress dot (welcome is a greeting, not a form step). */
const DOT_STEPS: StepId[] = ['goal', 'weight', 'goalWeight', 'body', 'activity', 'plan'];

/** Same five buckets, same order, as Settings -> Refine targets. */
const ACTIVITY: { value: ActivityLevel; labelKey: I18nKey }[] = [
  { value: 'sedentary', labelKey: 'activity.sedentary' },
  { value: 'light', labelKey: 'activity.light' },
  { value: 'moderate', labelKey: 'activity.moderate' },
  { value: 'active', labelKey: 'activity.active' },
  { value: 'very_active', labelKey: 'activity.very_active' },
];

const GOALS: { key: GoalDirection; labelKey: I18nKey; hintKey: I18nKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'lose', labelKey: 'goal.lose', hintKey: 'goal.loseHint', icon: 'trending-down-outline' },
  { key: 'maintain', labelKey: 'goal.maintain', hintKey: 'goal.maintainHint', icon: 'swap-horizontal-outline' },
  { key: 'gain', labelKey: 'goal.gain', hintKey: 'goal.gainHint', icon: 'trending-up-outline' },
];

/** Refine-targets' parser, not `numOrUndef`: 0 is a legal number of INCHES,
 *  and `numOrUndef` rejects it. */
function intOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// `KeyboardAvoidingView` comes from react-native-keyboard-controller, NOT from
// react-native. RN's own version was built for iOS and reads the keyboard frame
// straight from the system notification, which iOS 26 reports inconsistently
// (Apple forums 800310 / 814154) — that is the "spacing is much larger" the
// input screens were showing. The library normalises the frame across both
// platforms and is already a dependency, with <KeyboardProvider> mounted at the
// app root, so this costs nothing new. Same props, so `behavior` stays
// iOS-only: Android relies on windowSoftInputMode=adjustResize and must not
// also be padded.
export default function Onboarding() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user, profile, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const unitSystem = useUnitSystem();
  const weightUnit = bodyWeightUnit(unitSystem);
  // A completed profile only reaches this screen via Settings → "Edit goals":
  // skip the welcome greeting and return to Settings when done.
  const isRedo = !!profile?.profileCompleted;

  const [step, setStep] = useState<StepId>(isRedo ? 'goal' : 'welcome');
  const [dir, setDir] = useState<1 | -1>(1);

  // ── Funnel instrumentation (`@macrolog/core/usage-events`) ───────────
  // Half of the first fortnight's signups never fired `onboarding_complete`
  // and nothing could say where they stopped. Three markers carve the run:
  // start (also counts federated arrivals, which `signup` deliberately does
  // not — see auth.tsx), reaching the body step (the sex/height/age asks),
  // and reaching the plan. First arrival per run only, so Back/forward
  // passes cannot double-count; a redo via Settings → Edit goals is not a
  // funnel entry and counts nothing.
  const trackedSteps = useRef<Set<StepId>>(new Set());
  useEffect(() => {
    if (isRedo || trackedSteps.current.has(step)) return;
    trackedSteps.current.add(step);
    if (step === 'welcome') track('onboarding_start');
    else if (step === 'body') track('onboarding_step_body');
    else if (step === 'plan') track('onboarding_step_plan');
  }, [step, isRedo]);
  const [weight, setWeight] = useState('');
  const [goal, setGoal] = useState<GoalDirection | null>(profile?.goalDirection ?? null);
  const [targetWeight, setTargetWeight] = useState(() => {
    const g = profile?.targetWeightLbs ?? profile?.goalWeightLbs;
    // Stored in pounds; shown in whatever the profile reads in.
    const u = profile?.unitSystem === 'metric' ? 'metric' : 'us';
    return g != null ? String(toDisplayWeight(g, u)) : '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── The four Mifflin-St Jeor inputs (UX_AUDIT F1/F2) ─────────────────
  // Prefilled from the profile so a redo, or anyone who already visited
  // Settings → Refine targets, is not asked twice. Same fields, same bands and
  // the same five buckets as that screen — the bands come from
  // `@macrolog/core/profile-bounds` precisely so the two cannot drift apart or
  // from `firestore.rules`.
  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [feet, setFeet] = useState(profile?.heightIn ? String(Math.floor(profile.heightIn / 12)) : '');
  const [inches, setInches] = useState(profile?.heightIn ? String(profile.heightIn % 12) : '');
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(profile?.activityLevel ?? null);
  // Set by the "Skip" link on either of the two new steps. It hides them from
  // navigation and from the dots; it does NOT discard the values, because a
  // redo arrives with them prefilled and skipping past an answer you already
  // gave should not un-answer it.
  const [skippedBody, setSkippedBody] = useState(false);

  const ft = intOrNull(feet);
  const inch = intOrNull(inches);
  const heightIn = ft != null && inch != null ? ft * 12 + inch : null;
  const ageNum = intOrNull(age);
  const heightValid = isPlausibleHeightIn(heightIn);
  const ageValid = isPlausibleAge(ageNum);
  const bodyComplete = sex != null && heightValid && ageValid;

  // Typed in the user's own unit, stored in pounds. Typing `68` on a metric
  // profile used to build a plan for a 68 lb person (UX_AUDIT F3).
  const weightLbs = parseWeightToLb(weight, unitSystem) ?? undefined;
  // Onboarding has no pace control, so the pace is derived: 1 lb/wk for a cut
  // unless the user already dialled one in Refine, 0 otherwise. See
  // `onboardingPace` for why "gain" persists 0 rather than a surplus.
  const pace = onboardingPace(goal ?? 'maintain', profile?.targetPaceLbsPerWeek);
  // **The fix.** Mifflin-St Jeor when the four answers are in hand, weight ×
  // constant when they are not. The old call was `computeKcal(weightLbs, goal)`
  // unconditionally, which is sex-blind and over-fed women by up to 27%.
  const seed =
    weightLbs && goal
      ? onboardingSeed({
          weightLbs,
          goal,
          sex,
          heightIn,
          age: ageNum,
          activityLevel: activity,
          paceLbsPerWeek: pace,
          calorieFloor: profile?.calorieFloor,
        })
      : null;
  const suggestedKcal = seed?.kcal ?? null;
  const suggestedProtein = weightLbs ? computeProtein(weightLbs) : null;

  // The plan step USED to be read-only, and that is the whole of a real user's
  // second complaint: the app computed a calorie goal for him and offered
  // nowhere to put the number he wanted (UX_AUDIT, Abdiel Medina, 2026-08-21).
  // Tapping either number opens it for editing; an edited number is what makes
  // the save `targetMode: 'custom'` rather than 'auto', so accepting the
  // suggestion still behaves exactly as it did.
  const [editing, setEditing] = useState<'kcal' | 'protein' | null>(null);
  const [kcalDraft, setKcalDraft] = useState<string | null>(null);
  const [proteinDraft, setProteinDraft] = useState<string | null>(null);

  const kcal = kcalDraft != null ? (numOrUndef(kcalDraft) ?? null) : suggestedKcal;
  const protein = proteinDraft != null ? (numOrUndef(proteinDraft) ?? null) : suggestedProtein;
  const edited = kcalDraft != null || proteinDraft != null;
  // Only the calorie number is checked against the floor here. Protein has no
  // safety floor concept in onboarding, and the estimator's own clamp catches
  // anything wild on the way out.
  const kcalCheck = validateCalorieTarget(kcal, { profile });

  function openEditor(which: 'kcal' | 'protein') {
    haptics.tap();
    setEditing(which);
    if (which === 'kcal' && kcalDraft == null) setKcalDraft(String(suggestedKcal ?? ''));
    if (which === 'protein' && proteinDraft == null) setProteinDraft(String(suggestedProtein ?? ''));
  }

  // Skip the goal-weight step for "maintain" (there's no target to hit).
  const skipGoalWeight = goal === 'maintain';
  /** Steps navigation and the dots both walk straight past. */
  function isSkipped(s: StepId): boolean {
    if (s === 'goalWeight') return skipGoalWeight;
    if (s === 'body' || s === 'activity') return skippedBody;
    return false;
  }
  // A loop rather than the single `if` this replaced: two skippable steps sit
  // next to each other now, and "maintain" plus a skipped body is three in a
  // row. One conditional bump would land on the middle of them.
  function neighbor(from: StepId, delta: 1 | -1): StepId {
    let idx = ORDER.indexOf(from) + delta;
    while (ORDER[idx] && isSkipped(ORDER[idx])) idx += delta;
    if (ORDER[idx] === 'welcome' && isRedo) return from; // redo can't go before goal
    return ORDER[idx] ?? from;
  }

  const canAdvance =
    step === 'welcome' ||
    (step === 'goal' && goal != null) ||
    (step === 'weight' && weightLbs != null) ||
    (step === 'goalWeight' && parseWeightToLb(targetWeight, unitSystem) != null) ||
    (step === 'body' && bodyComplete) ||
    (step === 'activity' && activity != null) ||
    // A typed calorie number has to clear the floor before it can be saved —
    // otherwise `dailyTargets` clamps it on the way out and hands the user a
    // number they did not choose, which is the exact defect being fixed.
    (step === 'plan' && (!edited || kcalCheck.ok)) ||
    step === 'reminders' ||
    step === 'firstLog';

  function go(delta: 1 | -1) {
    haptics.tap();
    setDir(delta);
    // Back out of the plan after skipping = "actually, ask me". Un-skip and
    // land on the FIRST of the two steps that were passed over, not the last:
    // arriving on the activity question having never been asked the body one
    // is how a back button becomes a maze.
    if (delta === -1 && step === 'plan' && skippedBody) {
      setSkippedBody(false);
      setStep('body');
      return;
    }
    setStep((s) => neighbor(s, delta));
  }

  /** Give up on the body/activity pair and take the weight-only estimate. */
  function skipBody() {
    haptics.tap();
    setSkippedBody(true);
    setDir(1);
    setStep('plan');
  }

  async function onFinish() {
    if (busy || !user || !goal || weightLbs == null || kcal == null || protein == null) return;
    setError(null);
    setBusy(true);
    try {
      await saveOnboardingV2(user.uid, {
        weightLbs,
        goalDirection: goal,
        targetWeightLbs: skipGoalWeight
          ? undefined
          : (parseWeightToLb(targetWeight, unitSystem) ?? undefined),
        manualCaloriesTarget: kcal,
        manualProteinTarget: protein,
        // The Mifflin-St Jeor set. Passed unconditionally — `toOnboardingV2Patch`
        // is the one place that decides whether a complete set was collected,
        // so the screen does not get a second, subtly different opinion about
        // it. Undefined here means "skipped or half-answered", and none of the
        // five is then written.
        sex: sex ?? undefined,
        heightIn: heightIn ?? undefined,
        age: ageNum ?? undefined,
        activityLevel: activity ?? undefined,
        targetPaceLbsPerWeek: pace,
        // Accepting the computed plan stays 'auto' — those numbers are a seed
        // and the estimator should take over once it has data. Only a number
        // the user actually typed becomes theirs to keep.
        targetMode: edited ? 'custom' : 'auto',
      });
      // Only on a first run: a redo is a target change by an existing user,
      // and counting it would inflate the one funnel step this exists to answer.
      if (!isRedo) track('onboarding_complete');
      haptics.success();
      if (isRedo) {
        router.replace('/settings');
        return;
      }
      // First run only: the plan is saved; the one thing left to ask is
      // whether Ignia may nudge at meal times. Measured 2026-08-30: two of
      // the four organic installs that week logged 10 and 22 meals on day 0
      // and never came back on day 1 — and nobody had reminders on, because
      // the switch lived in Settings. This is the day-1 lever, asked once,
      // with the OS permission prompt only after a yes.
      setBusy(false);
      setDir(1);
      setStep('reminders');
    } catch (e) {
      // A permission-denied here means the email isn't verified (the rules
      // block the write) — surface that instead of blaming the connection.
      // With the verify-email gate in place this is a rare fallback, but the
      // token can lag verification by up to an hour.
      const code = (e as { code?: string })?.code;
      setError(t(code === 'permission-denied' ? 'onboarding.saveErrVerify' : 'onboarding.saveErr'));
      setBusy(false);
    }
  }

  /** Locale-formatted wall-clock time for the reminder preview rows. */
  function clock(hour: number, minute: number): string {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  }

  function leaveOnboarding(): void {
    router.replace('/(app)');
  }

  /** The last step (retention lever 1, `STATUS.md` §3): offer the first log
   *  before Today is ever seen empty. Measured 2026-09-02: 19 of 30 signups
   *  never reached three logs, and the research is one-sided — a meaningful
   *  action in session one is worth 2–3× at D30. Reminders stay BEFORE this
   *  step because the first-log CTA leaves onboarding for Today. */
  function goFirstLog(): void {
    setDir(1);
    setStep('firstLog');
  }

  /** Yes to reminders: ask the OS, and whatever it says, move on. A denied
   *  permission leaves the switch off (setRemindersEnabled handles that) and
   *  the user lands where they were going anyway. */
  async function onEnableReminders(): Promise<void> {
    setBusy(true);
    try {
      const granted = await setRemindersEnabled(true);
      if (granted) haptics.success();
    } catch {
      // Permission prompt failing must never trap someone in onboarding.
    } finally {
      setBusy(false);
      goFirstLog();
    }
  }

  /** Land on Today with the add sheet already open (the `openAdd` nonce the
   *  tab bar, the widget and the scan screen all use). The guided tour is
   *  held until that sheet closes, so it offers itself after the first log
   *  rather than on top of it. */
  function onFirstLog(): void {
    holdTour();
    haptics.tap();
    router.replace({ pathname: '/(app)', params: { openAdd: String(Date.now()) } });
  }

  const entering = (dir === 1 ? FadeInRight : FadeInLeft).duration(motion.dur.base).reduceMotion(ReduceMotion.System);
  const showBack = step !== 'welcome' && step !== 'reminders' && step !== 'firstLog' && !(isRedo && step === 'goal');
  const dots = DOT_STEPS.filter((s) => !isSkipped(s));
  const dotIndex = dots.indexOf(step);
  const dotTotal = dots.length;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/* `keyboardVerticalOffset` cancels a double-count that is iOS-only and
          was reported as "spacing is much larger" on the input screens.
          `SafeAreaView` above already reserves `insets.bottom` for the home
          indicator, and `behavior="padding"` then adds the keyboard height
          MEASURED FROM THE SCREEN BOTTOM — a span that already contains those
          same points. The two stack and the content lifts an inset too far.
          This screen is the only one of the five carrying the 'bottom' edge,
          which is why it is the worst of them. Zero on Android, where the
          behavior is undefined and nothing is added in the first place. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={-insets.bottom}
        style={styles.fill}
      >
        {/* Top bar: back + progress dots (hidden on the welcome greeting). */}
        <View style={styles.topBar}>
          {showBack ? (
            <PressScale
              style={styles.back}
              scaleTo={0.9}
              onPress={() => go(-1)}
              testID="onboarding-back"
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <Ionicons name="chevron-back" size={26} color={colors.ink} />
            </PressScale>
          ) : (
            <View style={styles.back} />
          )}
          {dotIndex >= 0 ? (
            <View style={styles.dots}>
              {Array.from({ length: dotTotal }).map((_, i) => (
                <View key={i} style={[styles.dot, i === dotIndex && styles.dotOn, i < dotIndex && styles.dotDone]} />
              ))}
            </View>
          ) : null}
          {/* Escape hatch. First run: sign out (e.g. wrong account). Redo from
              Settings → Edit goals: the user already has data, so offer a plain
              Cancel back to Settings instead of a destructive sign-out. */}
          {isRedo ? (
            <PressScale
              style={styles.back}
              scaleTo={0.9}
              onPress={() => { haptics.tap(); router.replace('/settings'); }}
              testID="onboarding-cancel"
              accessibilityLabel={t('common.cancel')}
            >
              <Ionicons name="close" size={24} color={colors.faint} />
            </PressScale>
          ) : (
            <PressScale
              style={styles.back}
              scaleTo={0.9}
              onPress={() => { void signOut(); }}
              testID="onboarding-signout"
              accessibilityLabel={t('settings.signOut')}
            >
              <Ionicons name="log-out-outline" size={22} color={colors.faint} />
            </PressScale>
          )}
        </View>

        {/* Scrollable so a tall step (goal cards, the plan summary) can never be
            clipped on a short/large viewport — the iPad failure mode Apple
            rejected on sign-in. The footer CTA stays pinned below. */}
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.stepScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <Animated.View key={step} entering={entering} style={styles.stepWrap}>
          {step === 'welcome' ? (
            <View style={styles.welcome}>
              <BrandMark />
              <Text style={styles.welcomeTitle}>{t('onboarding.titleNew')}</Text>
              <Text style={styles.welcomeBody}>{t('onboarding.welcomeBody')}</Text>
            </View>
          ) : null}

          {step === 'goal' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.goalQ')}</Text>
              <View style={styles.goals}>
                {GOALS.map((g) => {
                  const on = goal === g.key;
                  return (
                    <PressScale
                      key={g.key}
                      style={[styles.goalCard, on && styles.goalCardOn]}
                      scaleTo={0.97}
                      onPress={() => {
                        haptics.tap();
                        setGoal(g.key);
                      }}
                      testID={`onboarding-goal-${g.key}`}
                    >
                      <View style={[styles.goalIcon, on && styles.goalIconOn]}>
                        <Ionicons name={g.icon} size={24} color={on ? colors.onInk : colors.ink} />
                      </View>
                      <View style={styles.goalText}>
                        <Text style={[styles.goalLabel, on && styles.goalLabelOn]}>{t(g.labelKey)}</Text>
                        <Text style={[styles.goalHint, on && styles.goalHintOn]}>{t(g.hintKey)}</Text>
                      </View>
                      {on ? <Ionicons name="checkmark-circle" size={22} color={colors.onInk} /> : null}
                    </PressScale>
                  );
                })}
              </View>
            </View>
          ) : null}

          {step === 'weight' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.weightQ')}</Text>
              <BigInput value={weight} onChangeText={setWeight} placeholder={String(toDisplayWeight(180, unitSystem))} unit={weightUnit} styles={styles} colors={colors} testID="onboarding-weight" />
            </View>
          ) : null}

          {step === 'goalWeight' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.goalWeightQ')}</Text>
              <BigInput value={targetWeight} onChangeText={setTargetWeight} placeholder={String(toDisplayWeight(165, unitSystem))} unit={weightUnit} styles={styles} colors={colors} testID="onboarding-target-weight" />
            </View>
          ) : null}

          {/* ── The two steps F1/F2 added ──────────────────────────────
              Sex, height and age on one screen; activity on the next. Both
              are SKIPPABLE, and that is deliberate: someone who will not state
              a sex must still be able to finish onboarding, and the seed falls
              back to the old weight-only heuristic for them. What is not
              defensible is silently producing a worse number without saying
              so — hence the basis line on the plan step. */}
          {step === 'body' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.bodyQ')}</Text>
              <Text style={styles.stepSub}>{t('onboarding.bodyWhy')}</Text>

              <View style={styles.field}>
                <Text style={styles.label}>{t('refine.sex')}</Text>
                <View style={styles.segment}>
                  {(['male', 'female'] as Sex[]).map((s) => {
                    const on = sex === s;
                    return (
                      <PressScale
                        key={s}
                        style={[styles.segBtn, on && styles.segBtnOn]}
                        scaleTo={0.97}
                        onPress={() => { haptics.tap(); setSex(s); }}
                        accessibilityRole="button"
                        testID={`onboarding-sex-${s}`}
                      >
                        <Text style={[styles.segText, on && styles.segTextOn]}>
                          {s === 'male' ? t('refine.male') : t('refine.female')}
                        </Text>
                      </PressScale>
                    );
                  })}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('refine.height')}</Text>
                <View style={styles.row}>
                  <View style={styles.unitInput}>
                    <TextInput
                      style={styles.input}
                      placeholder="5"
                      placeholderTextColor={colors.faint}
                      keyboardType="numeric"
                      value={feet}
                      onChangeText={setFeet}
                      maxLength={1}
                      accessibilityLabel={t('refine.feet')}
                      testID="onboarding-feet"
                    />
                    <Text style={styles.unit}>{t('refine.feet')}</Text>
                  </View>
                  <View style={styles.unitInput}>
                    <TextInput
                      style={styles.input}
                      placeholder="10"
                      placeholderTextColor={colors.faint}
                      keyboardType="numeric"
                      value={inches}
                      onChangeText={setInches}
                      maxLength={2}
                      accessibilityLabel={t('refine.inches')}
                      testID="onboarding-inches"
                    />
                    <Text style={styles.unit}>{t('refine.inches')}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t('refine.age')}</Text>
                <TextInput
                  style={[styles.input, styles.ageInput]}
                  placeholder="30"
                  placeholderTextColor={colors.faint}
                  keyboardType="numeric"
                  value={age}
                  onChangeText={setAge}
                  maxLength={3}
                  accessibilityLabel={t('refine.age')}
                  testID="onboarding-age"
                />
              </View>

              <SkipLink label={t('onboarding.skipBody')} onPress={skipBody} styles={styles} />
            </View>
          ) : null}

          {step === 'activity' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.activityQ')}</Text>
              <View style={styles.activityCol}>
                {ACTIVITY.map((a) => {
                  const on = activity === a.value;
                  return (
                    <PressScale
                      key={a.value}
                      style={[styles.activityRow, on && styles.activityRowOn]}
                      scaleTo={0.98}
                      onPress={() => { haptics.tap(); setActivity(a.value); }}
                      accessibilityRole="button"
                      testID={`onboarding-activity-${a.value}`}
                    >
                      <Text style={[styles.activityText, on && styles.activityTextOn]}>{t(a.labelKey)}</Text>
                      {on ? <Ionicons name="checkmark" size={18} color={colors.onInk} /> : null}
                    </PressScale>
                  );
                })}
              </View>
              <SkipLink label={t('onboarding.skipBody')} onPress={skipBody} styles={styles} />
            </View>
          ) : null}

          {step === 'plan' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.planQ')}</Text>
              <View style={styles.planPanel} testID="onboarding-preview">
                <View style={styles.planRow}>
                  <PlanStat
                    editing={editing === 'kcal'}
                    value={kcal}
                    draft={kcalDraft ?? ''}
                    onChangeDraft={setKcalDraft}
                    onOpen={() => openEditor('kcal')}
                    onBlur={() => setEditing(null)}
                    label={t('onboarding.calories')}
                    styles={styles}
                    colors={colors}
                    testID="onboarding-kcal"
                  />
                  <View style={styles.planDivider} />
                  <PlanStat
                    editing={editing === 'protein'}
                    value={protein}
                    suffix="g"
                    draft={proteinDraft ?? ''}
                    onChangeDraft={setProteinDraft}
                    onOpen={() => openEditor('protein')}
                    onBlur={() => setEditing(null)}
                    label={t('onboarding.protein')}
                    styles={styles}
                    colors={colors}
                    testID="onboarding-protein"
                  />
                </View>
              </View>
              {/* The affordance has to be SAID. A tappable number that looks
                  like a readout is a feature nobody finds — which is how this
                  screen shipped for months with the plumbing already in it. */}
              {/* Say what the number was built from. A user asked to trust a
                  calorie target is owed the basis of it — and the skipped case
                  has to say plainly that it is the rougher of the two, or the
                  skip becomes a silent downgrade. */}
              <Text style={styles.planSub} testID="onboarding-plan-basis">
                {seed?.basis === 'formula' && seed.maintenance != null
                  ? t('onboarding.planBasis', { n: formatNumber(seed.maintenance, locale) })
                  : t('onboarding.planBasisRough')}
              </Text>
              {seed?.floorBinding && !edited ? (
                <Text style={styles.planSub} testID="onboarding-plan-floor">
                  {t('onboarding.planFloor', { n: formatNumber((kcal ?? 0), locale) })}
                </Text>
              ) : null}
              <Text style={styles.planSub}>
                {t('onboarding.planSub')} {t('targets.editHint')}
              </Text>
              {edited && !kcalCheck.ok && kcalCheck.issue?.kind === 'belowFloor' ? (
                <Text style={styles.error} testID="onboarding-kcal-error">
                  {t('targets.errBelowFloor', { n: formatNumber(kcalCheck.issue.floor, locale) })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {step === 'reminders' ? (
            <View style={styles.step} testID="onboarding-reminders">
              <Text style={styles.question}>{t('onboarding.remindersQ')}</Text>
              <Text style={styles.planSub}>{t('onboarding.remindersBody')}</Text>
              <View style={styles.planPanel}>
                <Text style={styles.reminderRow}>{t('onboarding.remindersLunch', { t: clock(DEFAULT_MEAL_REMINDERS.lunch.hour, DEFAULT_MEAL_REMINDERS.lunch.minute) })}</Text>
                <Text style={styles.reminderRow}>{t('onboarding.remindersDinner', { t: clock(DEFAULT_MEAL_REMINDERS.dinner.hour, DEFAULT_MEAL_REMINDERS.dinner.minute) })}</Text>
                <Text style={styles.reminderRow}>{t('onboarding.remindersStreak', { t: clock(STREAK_RISK_HOUR, STREAK_RISK_MINUTE) })}</Text>
              </View>
              <Text style={styles.planSub}>{t('onboarding.remindersNote')}</Text>
            </View>
          ) : null}

          {step === 'firstLog' ? (
            <View style={styles.step} testID="onboarding-first-log">
              <Text style={styles.question}>{t('onboarding.firstLogQ')}</Text>
              <Text style={styles.planSub}>{t('onboarding.firstLogBody')}</Text>
              <View style={styles.planPanel}>
                <Text style={styles.reminderRow}>{t('onboarding.firstLogSearch')}</Text>
                <Text style={styles.reminderRow}>{t('onboarding.firstLogPhoto')}</Text>
                <Text style={styles.reminderRow}>{t('onboarding.firstLogType')}</Text>
              </View>
              <Text style={styles.planSub}>{t('onboarding.firstLogNote')}</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          {step === 'reminders' ? (
            <PressScale style={styles.ctaGhost} scaleTo={0.98} disabled={busy} onPress={goFirstLog} testID="onboarding-reminders-skip">
              <Text style={styles.ctaGhostText}>{t('onboarding.remindersNotNow')}</Text>
            </PressScale>
          ) : null}
          {step === 'firstLog' ? (
            <PressScale style={styles.ctaGhost} scaleTo={0.98} disabled={busy} onPress={leaveOnboarding} testID="onboarding-first-log-later">
              <Text style={styles.ctaGhostText}>{t('onboarding.firstLogLater')}</Text>
            </PressScale>
          ) : null}
          <PressScale
            style={[styles.cta, !canAdvance && styles.ctaDisabled]}
            scaleTo={0.98}
            disabled={!canAdvance || busy}
            onPress={
              step === 'firstLog' ? onFirstLog
              : step === 'reminders' ? onEnableReminders
              : step === 'plan' ? onFinish
              : () => go(1)
            }
            testID={
              step === 'firstLog' ? 'onboarding-first-log-cta'
              : step === 'reminders' ? 'onboarding-reminders-on'
              : step === 'plan' ? 'onboarding-save'
              : 'onboarding-next'
            }
          >
            {busy ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.ctaText}>
                {step === 'welcome'
                  ? t('onboarding.welcomeCta')
                  : step === 'firstLog'
                    ? t('onboarding.firstLogCta')
                  : step === 'reminders'
                    ? t('onboarding.remindersOn')
                  : step === 'plan'
                    ? isRedo
                      ? t('onboarding.saveEdit')
                      : t('onboarding.saveNew')
                    : t('onboarding.continue')}
              </Text>
            )}
          </PressScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * One number on the plan panel: a big count-up that becomes a text field when
 * tapped.
 *
 * It stays inside the hero panel rather than opening a sheet, because the
 * thing being edited is the thing on screen — a modal here would hide the
 * other number and the goal it belongs to. `selectTextOnFocus` means the first
 * keystroke replaces the suggestion rather than appending to it, which is what
 * someone who already knows their number expects.
 */
function PlanStat({
  editing,
  value,
  suffix,
  draft,
  onChangeDraft,
  onOpen,
  onBlur,
  label,
  styles,
  colors,
  testID,
}: {
  editing: boolean;
  value: number | null;
  suffix?: string;
  draft: string;
  onChangeDraft: (v: string) => void;
  onOpen: () => void;
  onBlur: () => void;
  label: string;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  testID: string;
}) {
  return (
    <View style={styles.planStat}>
      {editing ? (
        <TextInput
          style={styles.planInput}
          value={draft}
          onChangeText={onChangeDraft}
          onBlur={onBlur}
          keyboardType="number-pad"
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={onBlur}
          accessibilityLabel={label}
          testID={`${testID}-input`}
        />
      ) : (
        <PressScale
          scaleTo={0.96}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={undefined}
          testID={testID}
        >
          <View style={styles.planValueRow}>
            <CountUpText value={value ?? 0} suffix={suffix} style={styles.planValue} />
            <Ionicons name="pencil" size={14} color={colors.heroMuted} style={styles.planPencil} />
          </View>
        </PressScale>
      )}
      <Text style={styles.planLabel}>{label}</Text>
    </View>
  );
}

/**
 * The escape hatch on the body and activity steps.
 *
 * Understated on purpose: the four answers are what make the calorie target
 * correct, so the CTA is the path. But a required sex question is a locked
 * front door for anyone who will not answer it, and the app is unusable behind
 * it — so the way past has to exist and has to be findable.
 */
function SkipLink({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <PressScale
      style={styles.skip}
      scaleTo={0.96}
      onPress={onPress}
      accessibilityRole="button"
      testID="onboarding-skip-body"
    >
      <Text style={styles.skipText}>{label}</Text>
    </PressScale>
  );
}

function BigInput({
  value,
  onChangeText,
  placeholder,
  unit,
  styles,
  colors,
  testID,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  /** `lb` or `kg` — was a hardcoded literal, which is the whole of F3's first
   *  sentence. */
  unit: string;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  testID: string;
}) {
  return (
    <View style={styles.bigInputRow}>
      <TextInput
        style={styles.bigInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType="numeric"
        autoFocus
        selectTextOnFocus
        maxLength={5}
        testID={testID}
      />
      <Text style={styles.bigUnit}>{unit}</Text>
    </View>
  );
}

const createStyles = ({ colors, shadow }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    fill: { flex: 1 },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: space.md, height: 44 },
    back: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
    dots: { flexDirection: 'row', gap: space.xs },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.line },
    dotOn: { width: 22, backgroundColor: colors.ink },
    dotDone: { backgroundColor: colors.accent },
    // flexGrow centres the step when it fits and scrolls it when it doesn't.
    stepScroll: { flexGrow: 1, justifyContent: 'center' },
    // maxWidth keeps the form readable rather than edge-to-edge on an iPad.
    stepWrap: { paddingHorizontal: space.xl, paddingVertical: space.lg, width: '100%', maxWidth: 480, alignSelf: 'center' },
    // Welcome greeting.
    welcome: { alignItems: 'center', gap: space.lg },
    welcomeTitle: { fontFamily: type.display, fontSize: 34, color: colors.ink, textAlign: 'center', marginTop: space.md },
    welcomeBody: { fontSize: font.h3, color: colors.muted, textAlign: 'center', lineHeight: font.h3 * 1.45, paddingHorizontal: space.md },
    // A form step.
    step: { gap: space.xl },
    question: { fontFamily: type.display, fontSize: 30, color: colors.ink, lineHeight: 36 },
    // Goal cards.
    goals: { gap: space.md },
    goalCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.lg,
      padding: space.lg,
      backgroundColor: colors.card,
    },
    goalCardOn: { backgroundColor: colors.ink, borderColor: colors.ink, ...shadow.e2 },
    goalIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
    goalIconOn: { backgroundColor: colors.heroTrack },
    goalText: { flex: 1, gap: 2 },
    goalLabel: { fontFamily: type.heading, fontSize: font.h3, color: colors.ink },
    goalLabelOn: { color: colors.onInk },
    goalHint: { fontSize: font.small, color: colors.muted },
    goalHintOn: { color: colors.heroMuted },
    // Sub-line under a step question (why we are asking).
    stepSub: { fontSize: font.body, color: colors.muted, lineHeight: font.body * 1.4, marginTop: -space.md },
    // Labelled form fields, mirroring Settings → Refine targets so the two
    // screens that ask these four questions look like the same question.
    field: { gap: space.xs },
    label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    segment: { flexDirection: 'row', gap: space.sm },
    segBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center', backgroundColor: colors.inputBg },
    segBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    segText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
    segTextOn: { color: colors.onInk },
    row: { flexDirection: 'row', gap: space.sm },
    unitInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      fontSize: font.h3,
      color: colors.ink,
      flex: 1,
      minWidth: 0,
    },
    unit: { fontSize: font.small, color: colors.muted },
    ageInput: { flex: 0, width: 120 },
    activityCol: { gap: space.sm },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      backgroundColor: colors.inputBg,
    },
    activityRowOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    activityText: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
    activityTextOn: { color: colors.onInk },
    skip: { alignSelf: 'center', paddingVertical: space.sm, paddingHorizontal: space.md },
    skipText: { fontSize: font.small, color: colors.muted, textDecorationLine: 'underline' },
    // Big numeric input.
    bigInputRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.sm },
    bigInput: { fontFamily: type.display, fontSize: 72, color: colors.ink, textAlign: 'center', minWidth: 140, padding: 0 },
    bigUnit: { fontSize: font.h1, color: colors.muted, marginBottom: space.lg },
    // Plan reveal.
    planPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xxl, paddingHorizontal: space.lg, ...shadow.e2 },
    planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    planStat: { flex: 1, alignItems: 'center', gap: space.xs },
    planValue: { fontFamily: type.display, fontSize: 44, color: colors.heroText },
    planValueRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    planPencil: { opacity: 0.7 },
    planInput: {
      fontFamily: type.display,
      fontSize: 44,
      color: colors.heroText,
      textAlign: 'center',
      minWidth: 120,
      borderBottomWidth: 2,
      borderBottomColor: colors.heroTrack,
      paddingVertical: 0,
    },
    planLabel: { fontSize: font.body, color: colors.heroMuted },
    planDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.heroTrack, marginVertical: space.sm },
    planSub: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.md },
    error: { color: colors.danger, fontSize: font.small, textAlign: 'center', marginTop: space.md },
    // Same maxWidth as stepWrap so the CTA lines up with the step on an iPad.
    footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
    cta: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    ctaDisabled: { opacity: 0.4 },
    ctaText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    ctaGhost: { paddingVertical: space.md, alignItems: 'center', marginBottom: space.xs },
    ctaGhostText: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
    reminderRow: { fontSize: font.body, color: colors.ink, paddingVertical: space.xs, textAlign: 'center' },
  });
