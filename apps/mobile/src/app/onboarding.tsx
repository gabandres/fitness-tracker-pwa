import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  type ActivityLevel,
  type DailyLog,
  type GoalDirection,
  LOG_WINDOW_ROWS,
  type OnboardingV2Submission,
  HEIGHT_IN_MAX,
  HEIGHT_IN_MIN,
  type Sex,
  type UnitSystem,
  WEIGHT_MAX_LB,
  WEIGHT_MIN_LB,
  bodyWeightUnit,
  computeProtein,
  dailyTargets,
  dayBoundaryOf,
  dayKeyAt,
  goalWeightIssue,
  isStorableWeight,
  profileAfterOnboarding,
  isPlausibleAge,
  isPlausibleHeightIn,
  measureUnit,
  onboardingPace,
  onboardingSeed,
  paceOffsetKcal,
  parseMeasureToIn,
  parseWeightToLb,
  toDisplayMeasure,
  toDisplayWeight,
  validateCalorieTarget,
  validateProteinTarget,
  weightBoundsFor,
} from '@macrolog/core';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { getAllDailyWeights, getLatestDailyWeight, getRecentLogs, saveOnboardingV2, setUnitSystem } from '@/lib/ledger';
import { writeDailyMetric } from '@/lib/ledger-ops';
import { useCalendarToday } from '@/hooks/useDayKey';
import { setRemindersEnabled } from '@/lib/reminders';
import { holdTour } from '@/lib/tour';
import { DEFAULT_MEAL_REMINDERS, STREAK_RISK_HOUR, STREAK_RISK_MINUTE } from '@macrolog/core';
import { track } from '@/lib/analytics';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { CountUpText, PressScale } from '@/lib/motion';
import { deviceUnitSystem, useUnitSystem } from '@/lib/use-unit-system';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, TARGET, type } from '@/theme';

/** No 'welcome' step since 2026-10-06 (UX review S21 #11): `WelcomeIntro`
 *  already greets everyone in front of sign-in, so a second greeting here was
 *  a screen whose only job was the 16+ checkbox. That attestation now sits on
 *  the goal step — the first one a first run cannot skip. */
type StepId = 'goal' | 'weight' | 'goalWeight' | 'body' | 'activity' | 'plan' | 'reminders' | 'firstLog';
const ORDER: StepId[] = ['goal', 'weight', 'goalWeight', 'body', 'activity', 'plan'];
/** Steps that get a progress dot. */
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
  // Comma accepted as the decimal point (pt-BR keyboards) — see EntrySheet.
  const t = s.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ── Pure glue, exported for `onboarding-input-bounds.test.ts` ───────────
// Expo Router only reads the default export of a route file; named exports
// are how the gating below gets pinned without rendering the whole wizard.

/** The 16+ attestation (UX_AUDIT S18-9) gates the goal step, the first step
 *  and the one a first run cannot skip — it lived on a separate welcome step
 *  until 2026-10-06. A redo from Settings is an existing user, so it is never
 *  re-asked and never shown. */
export function ageGateOpen(isRedo: boolean, ageConfirmed: boolean): boolean {
  return isRedo || ageConfirmed;
}

/** Height typed in the user's OWN unit → whole inches, or null when it is
 *  not a usable number. Metric is one `cm` field; US is feet + inches, where
 *  0 inches is a legal answer (`intOrNull`, not `numOrUndef`). Whole inches
 *  so a metric answer round-trips into the ft/in prefill cleanly — 175 cm is
 *  69 in, not 68.897637 in shown as "5 ft 8.897637 in". */
export function parseHeightInput(
  unitSystem: UnitSystem,
  input: { cm: string; feet: string; inches: string },
): number | null {
  if (unitSystem === 'metric') {
    const inches = parseMeasureToIn(input.cm, 'metric');
    return inches == null ? null : Math.round(inches);
  }
  const ft = intOrNull(input.feet);
  const inch = intOrNull(input.inches);
  // 0–11 only: "5 ft 14 in" is not a height anyone means, and folding it into
  // 74 in silently saved a number the user never typed (audit 2026-10-15).
  // `inchesOutOfRange` lets the screens say why it was refused.
  return ft != null && inch != null && !inchesOutOfRange(input.inches) ? ft * 12 + inch : null;
}

/** The inches box holds a whole number above 11 — refused by
 *  `parseHeightInput`, and worth its own message: the generic height band
 *  ("between 3 ft 4 in and 8 ft 0 in") reads as wrong to someone who typed
 *  5 ft 14 in, which is inside it. */
export function inchesOutOfRange(inches: string): boolean {
  const inch = intOrNull(inches);
  return inch != null && inch > 11;
}

/** `HEIGHT_IN_MIN..MAX` said in the user's unit: `102–243 cm`, or
 *  `3 ft 4 in – 8 ft 0 in`. A US user told "between 40 and 96" has been
 *  handed inches with no label. */
export function heightBandFor(
  unitSystem: UnitSystem,
  units: { ft: string; in: string },
): { min: string; max: string } {
  if (unitSystem === 'metric') {
    return {
      min: `${Math.ceil(toDisplayMeasure(HEIGHT_IN_MIN, 'metric'))} cm`,
      max: `${Math.floor(toDisplayMeasure(HEIGHT_IN_MAX, 'metric'))} cm`,
    };
  }
  const say = (total: number) => `${Math.floor(total / 12)} ${units.ft} ${total % 12} ${units.in}`;
  return { min: say(HEIGHT_IN_MIN), max: say(HEIGHT_IN_MAX) };
}

/** A parsed weight is only advanceable inside the plausible band that
 *  `firestore.rules` and `weightBoundsFor` share (UX_AUDIT S18-11) — "1800"
 *  used to build a plan for an 1,800 lb person and die at the rules two
 *  steps later, with the error blaming the connection. */
export function weightInBand(weightLbs: number | null | undefined): weightLbs is number {
  return weightLbs != null && weightLbs >= WEIGHT_MIN_LB && weightLbs <= WEIGHT_MAX_LB;
}

// `KeyboardAvoidingView` comes from react-native-keyboard-controller, NOT from
// react-native. RN's own version was built for iOS and reads the keyboard frame
// straight from the system notification, which iOS 26 reports inconsistently
// (Apple forums 800310 / 814154) — that is the "spacing is much larger" the
// input screens were showing. The library normalises the frame across both
// platforms and is already a dependency, with <KeyboardProvider> mounted at the
// app root, so this costs nothing new. `behavior="padding"` on BOTH
// platforms: under <KeyboardProvider> Android does not resize the window for
// the IME, so adjustResize alone left fields and footers behind the keyboard
// (emulator, 2026-10-06).
export default function Onboarding() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user, profile, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // A completed profile only reaches this screen via Settings → "Redo setup":
  // it returns to Settings when done.
  //
  // LATCHED at mount, not derived. The first run's own save flips
  // `profileCompleted`, and a derived flag turned the rest of that run into a
  // redo: a failed age stamp after a good save was never retried (the stamp is
  // first-run only), `onboarding_complete` never fired, reminders and the
  // first log were skipped, and the sign-out control became the redo's Cancel
  // X (audit 2026-10-15). Whether this run is a redo is decided by how it
  // STARTED; the gate only ever opens a first run on a confirmed profile, so
  // the value at mount is the right one.
  const [isRedo] = useState(() => !!profile?.profileCompleted);
  // The unit the profile reads in today (`undefined` → 'us', see the hook).
  const storedUnit = useUnitSystem();
  // The unit THIS run asks in. A redo, or a profile that already carries an
  // explicit choice, keeps exactly what it had. A NEW user with nothing stored
  // gets the phone's region (UX review S21 #3): `useUnitSystem`'s 'us'
  // fallback asked every pt-BR user their weight in pounds. The weight and
  // body steps carry a toggle, and the choice is written on save.
  const [unitSystem, setUnitChoice] = useState<UnitSystem>(() =>
    isRedo || profile?.unitSystem ? storedUnit : deviceUnitSystem(),
  );
  const weightUnit = bodyWeightUnit(unitSystem);

  const [step, setStep] = useState<StepId>('goal');
  const [dir, setDir] = useState<1 | -1>(1);

  // ── Funnel instrumentation (`@macrolog/core/usage-events`) ───────────
  // Half of the first fortnight's signups never fired `onboarding_complete`
  // and nothing could say where they stopped. Three markers carve the run:
  // start (also counts federated arrivals, which `signup` deliberately does
  // not — see auth.tsx), reaching the body step (the sex/height/age asks),
  // and reaching the plan. First arrival per run only, so Back/forward
  // passes cannot double-count; a redo via Settings → Redo setup is not a
  // funnel entry and counts nothing.
  const trackedSteps = useRef<Set<StepId>>(new Set());
  useEffect(() => {
    if (isRedo || trackedSteps.current.has(step)) return;
    trackedSteps.current.add(step);
    if (step === 'goal') track('onboarding_start');
    else if (step === 'body') track('onboarding_step_body');
    else if (step === 'plan') track('onboarding_step_plan');
  }, [step, isRedo]);
  const [weight, setWeight] = useState('');
  // ── The weight a redo already knows (2026-10-15) ──
  // A redo asked for the current weight with an empty box, then threw the
  // answer away — it only fed the plan's numbers. Now the box starts at the
  // latest weigh-in, and a number the user CHANGES is saved as today's
  // weigh-in on Save. An untouched prefill is never written: it is an old
  // reading, and filing it under today would put a fake point in the trend.
  const [latestLb, setLatestLb] = useState<number | null>(null);
  const [weightTouched, setWeightTouched] = useState(false);
  // The same inputs Today's target is computed from, read ONCE for the plan
  // preview below. A redo only: a first run has no history to preview.
  const [history, setHistory] = useState<{ logs: DailyLog[]; weights: Record<string, number> } | null>(null);
  const uid = user?.uid;
  useEffect(() => {
    if (!uid || !isRedo) return;
    let alive = true;
    getLatestDailyWeight(uid)
      .then((lb) => {
        if (!alive || lb == null) return;
        setLatestLb(lb);
        setWeight((typed) => (typed.trim() === '' ? String(toDisplayWeight(lb, unitSystem)) : typed));
      })
      .catch((e: unknown) => captureError(e, { where: 'onboarding.latestWeight' }));
    Promise.all([getRecentLogs(uid, LOG_WINDOW_ROWS), getAllDailyWeights(uid)])
      .then(([logs, weights]) => {
        if (alive) setHistory({ logs, weights });
      })
      .catch((e: unknown) => captureError(e, { where: 'onboarding.history' }));
    return () => {
      alive = false;
    };
  }, [uid, isRedo, unitSystem]);
  function typeWeight(v: string) {
    setWeightTouched(true);
    setWeight(v);
  }
  const [goal, setGoal] = useState<GoalDirection | null>(profile?.goalDirection ?? null);
  const [targetWeight, setTargetWeight] = useState(() => {
    const g = profile?.targetWeightLbs ?? profile?.goalWeightLbs;
    // Stored in pounds; shown in the unit this run asks in.
    return g != null ? String(toDisplayWeight(g, unitSystem)) : '';
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
  // The metric answer to the same question (UX_AUDIT S18-8): one `cm` field.
  // A metric user typing 175 into a `maxLength={1}` feet box got "1".
  const [heightCm, setHeightCm] = useState(
    profile?.heightIn ? String(Math.round(toDisplayMeasure(profile.heightIn, 'metric'))) : '',
  );
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(profile?.activityLevel ?? null);
  // Set by the "Skip" link on either of the two new steps. It hides them from
  // navigation and from the dots; it does NOT discard the values, because a
  // redo arrives with them prefilled and skipping past an answer you already
  // gave should not un-answer it.
  const [skippedBody, setSkippedBody] = useState(false);
  // The 16+ attestation (S18-9). §S13 marked it done, but that was the retired
  // web wizard: mobile never wrote `ageConfirmedAt`. Required on the goal
  // step because it is the one a first run cannot skip; `ageGateOpen`.
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  const metric = unitSystem === 'metric';
  const heightIn = parseHeightInput(unitSystem, { cm: heightCm, feet, inches });
  const heightTyped = metric ? heightCm.trim() !== '' : feet.trim() !== '' || inches.trim() !== '';
  const ageNum = intOrNull(age);
  const heightValid = isPlausibleHeightIn(heightIn);
  const ageValid = isPlausibleAge(ageNum);
  const bodyComplete = sex != null && heightValid && ageValid;

  // Typed in the user's own unit, stored in pounds. Typing `68` on a metric
  // profile used to build a plan for a 68 lb person (UX_AUDIT F3).
  const weightLbs = parseWeightToLb(weight, unitSystem) ?? undefined;
  const weightOk = weightInBand(weightLbs);
  // Skip the goal-weight step for "maintain" (there's no target to hit).
  const skipGoalWeight = goal === 'maintain';
  const targetWeightLbs = parseWeightToLb(targetWeight, unitSystem);
  // Goal weight is OPTIONAL (2026-10-15): nothing downstream needs it — the
  // rules allow a cut with none and the target math never reads it — yet Lose
  // and Gain could not continue without one. Blank means "no goal weight". A
  // typed one must be plausible AND on the right side of the current weight.
  const targetBlank = targetWeight.trim() === '';
  const targetDirIssue = goalWeightIssue(goal, weightLbs, targetWeightLbs);
  const targetWeightOk = targetBlank || (weightInBand(targetWeightLbs) && targetDirIssue == null);
  const weightBand = weightBoundsFor(unitSystem);
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
  // What each number read when its editor opened. A number tapped open and
  // left as it was is not an edit — it used to be, and it flipped the save to
  // custom on a tap.
  const [kcalBase, setKcalBase] = useState<number | null>(null);
  const [proteinBase, setProteinBase] = useState<number | null>(null);
  const kcalTyped = kcalDraft != null ? (numOrUndef(kcalDraft) ?? null) : null;
  const proteinTyped = proteinDraft != null ? (numOrUndef(proteinDraft) ?? null) : null;
  const kcalEdited = kcalDraft != null && kcalTyped !== kcalBase;
  const proteinEdited = proteinDraft != null && proteinTyped !== proteinBase;
  const edited = kcalEdited || proteinEdited;

  // Today's weigh-in, when Save will write one: a first run's answer, or a
  // redo whose prefilled weight the user changed.
  const writesWeighIn =
    weightLbs != null &&
    isStorableWeight(weightLbs) &&
    (latestLb == null || (weightTouched && Math.abs(weightLbs - latestLb) >= 0.05));

  // ONE submission, for the preview and for the save, so the two cannot
  // disagree. Values for a number the user did not change are the seed; a
  // redo never writes those (`toOnboardingV2Patch`), a first run does.
  const submission: OnboardingV2Submission | null =
    weightLbs != null && goal
      ? {
          weightLbs,
          goalDirection: goal,
          targetWeightLbs: skipGoalWeight || targetBlank ? undefined : (targetWeightLbs ?? undefined),
          manualCaloriesTarget: (kcalEdited ? kcalTyped : suggestedKcal) ?? 0,
          manualProteinTarget: (proteinEdited ? proteinTyped : suggestedProtein) ?? 0,
          // The Mifflin-St Jeor set. Passed unconditionally — `toOnboardingV2Patch`
          // is the one place that decides whether a complete set was collected.
          // Undefined means "skipped or half-answered", and none of the five is
          // then written.
          sex: sex ?? undefined,
          heightIn: heightIn ?? undefined,
          age: ageNum ?? undefined,
          activityLevel: activity ?? undefined,
          targetPaceLbsPerWeek: pace,
          targetMode: edited ? 'custom' : 'auto',
          isRedo,
          edited: { kcal: kcalEdited, protein: proteinEdited },
          previousTargetMode: profile?.targetMode,
        }
      : null;

  // ── What Save will actually do (2026-10-15) ──
  // A redo's plan step showed the onboarding seed — 2,110 kcal / 110 g on the
  // owner's account — while the save kept a measured target of 1,850 and a
  // custom 140 g. It now shows the target chain run over the profile AS IT
  // WILL BE (`profileAfterOnboarding`, the same patch the save writes) and
  // this user's own history, with the weigh-in Save is about to file.
  const calendarToday = useCalendarToday();
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);
  const weighInKey = dayKeyAt(calendarToday, boundary);
  // Until the history read lands there is no preview, and the plan shows the
  // seed as it always did — never a preview built on no data, which would
  // read as a seed-mode 1,800.
  const previewProfile =
    isRedo && step === 'plan' && profile && submission && history ? profileAfterOnboarding(profile, submission) : null;
  const preview =
    previewProfile && history
      ? dailyTargets(
          previewProfile,
          history.logs,
          writesWeighIn && weightLbs != null ? { ...history.weights, [weighInKey]: weightLbs } : history.weights,
          calendarToday,
        )
      : null;

  const kcal = kcalDraft != null ? kcalTyped : (preview?.calorieTarget ?? suggestedKcal);
  const protein = proteinDraft != null ? proteinTyped : (preview?.proteinTarget ?? suggestedProtein);
  // BOTH numbers are validated. Protein used to be unchecked here on the
  // reasoning that "the estimator's own clamp catches anything wild on the way
  // out" — it does not, because the clamp is server-side: `firestore.rules`
  // rejects a protein target >= 1000, `onFinish` maps permission-denied to
  // "verify your email first", and a verified user on the last step of
  // onboarding was told to go and check their inbox with no way forward.
  // Clearing the field was the other half: protein went null, `canAdvance`
  // still read true because only kcal was checked, and the CTA rendered fully
  // enabled over an `onFinish` that returned silently. Found 2026-09-22.
  const kcalCheck = validateCalorieTarget(kcal, { profile });
  const proteinCheck = validateProteinTarget(protein);

  function openEditor(which: 'kcal' | 'protein') {
    haptics.tap();
    setEditing(which);
    // Start from the number on screen — on a redo that is the preview, not
    // the seed.
    if (which === 'kcal' && kcalDraft == null) {
      setKcalBase(kcal);
      setKcalDraft(String(kcal ?? ''));
    }
    if (which === 'protein' && proteinDraft == null) {
      setProteinBase(protein);
      setProteinDraft(String(protein ?? ''));
    }
  }

  // The basis line for a redo, read off the preview: whose number it is, and
  // what it was built from.
  const redoBasis: string | null = !preview
    ? null
    : preview.calorieSource === 'user' && !kcalEdited
      ? t('onboarding.planBasisOwn')
      : preview.calorieSource === 'auto' && preview.tdee.source === 'measured'
        ? t('onboarding.planBasisMeasured', { n: formatNumber(preview.tdee.trueTdee, locale) })
        : preview.calorieSource === 'auto' && preview.tdee.source === 'formula'
          ? t('onboarding.planBasis', { n: formatNumber(preview.tdee.trueTdee, locale) })
          : null;
  // An automatic target the floor is holding up: maintenance minus the pace
  // lands under it.
  const redoFloor =
    preview != null &&
    preview.calorieSource === 'auto' &&
    preview.tdee.source !== 'seed' &&
    Math.round(preview.tdee.trueTdee - paceOffsetKcal(pace, goal ?? undefined)) < preview.calorieTarget;

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
    return ORDER[idx] ?? from;
  }

  const canAdvance =
    (step === 'goal' && goal != null && ageGateOpen(isRedo, ageConfirmed)) ||
    (step === 'weight' && weightOk) ||
    (step === 'goalWeight' && targetWeightOk) ||
    (step === 'body' && bodyComplete) ||
    (step === 'activity' && activity != null) ||
    // A typed calorie number has to clear the floor before it can be saved —
    // otherwise `dailyTargets` clamps it on the way out and hands the user a
    // number they did not choose, which is the exact defect being fixed.
    (step === 'plan' && (!kcalEdited || kcalCheck.ok) && (!proteinEdited || proteinCheck.ok)) ||
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

  /** The lb/kg (ft-in/cm) toggle on the weight and body steps — first run
   *  only. What is already typed is CONVERTED, not cleared or reinterpreted:
   *  80 typed as kg stays 80 kg (176.4 lb), it does not become 80 lb. Storage
   *  is pounds and inches whatever the toggle says; the unit only decides how
   *  the typed text is parsed, and the choice is written on save. */
  function switchUnit(next: UnitSystem): void {
    if (next === unitSystem) return;
    haptics.tap();
    const convert = (typed: string): string => {
      const lb = parseWeightToLb(typed, unitSystem);
      return lb == null ? typed : String(toDisplayWeight(lb, next));
    };
    setWeight(convert(weight));
    setTargetWeight(convert(targetWeight));
    const h = parseHeightInput(unitSystem, { cm: heightCm, feet, inches });
    if (h != null) {
      if (next === 'metric') {
        setHeightCm(String(Math.round(toDisplayMeasure(h, 'metric'))));
      } else {
        setFeet(String(Math.floor(h / 12)));
        setInches(String(h % 12));
      }
    }
    setUnitChoice(next);
  }

  /** First run only: sign out is a destructive tap from a screen with unsaved
   *  answers, so it asks first (S18-6). The sheet's host is mounted below for
   *  this screen alone — `ConfirmHost` lives in the `(app)` layout, which is
   *  not on the stack during a first run. */
  function onSignOut(): void {
    haptics.tap();
    confirm({
      title: t('settings.signOut'),
      body: t('settings.signOutConfirm'),
      confirmText: t('settings.signOut'),
      destructive: true,
      onConfirm: () => {
        signOut().catch((e) => captureError(e, { where: 'onboarding.signOut' }));
      },
    });
  }

  /** The attestation stamp. A SECOND write after `saveOnboardingV2`, not a
   *  field on it: `OnboardingV2Submission` (packages/core) has no slot for it
   *  and this change does not edit core or `ledger.ts`. It cannot go BEFORE
   *  the save either — `isValidProfileInitial` in `firestore.rules` does not
   *  list `ageConfirmedAt`, only the Completed branch does, and the save is
   *  what flips `profileCompleted`. `serverTimestamp()` satisfies the rules'
   *  `is timestamp`. */
  async function stampAgeConfirmed(uid: string): Promise<void> {
    await updateDoc(doc(db, 'users', uid), { ageConfirmedAt: serverTimestamp() });
  }

  async function onFinish() {
    if (busy || !user || !goal || weightLbs == null || !submission) return;
    // Defence in depth: `canAdvance` already gates the CTA on both checks, so
    // this is unreachable from the button. It sets an error rather than
    // returning silently, because a bare `return` here is what made a live-
    // looking CTA do nothing at all.
    if (kcal == null || protein == null || (kcalEdited && !kcalCheck.ok) || (proteinEdited && !proteinCheck.ok)) {
      setError(t('targets.errNumber'));
      return;
    }
    setError(null);
    setBusy(true);
    // The try statement as an async body with `.catch` chained on: the React
    // Compiler skips a component holding conditionals inside a `try`, and
    // this is the whole onboarding flow. The redo's early `return` still ends
    // the body, and any failure in it still lands in the same handler.
    await (async () => {
      await saveOnboardingV2(user.uid, submission);
      // The weight answer as a real weigh-in — see `writesWeighIn`. After the
      // profile write, and not fatal: the plan is saved either way, and Body
      // is where a missed weigh-in gets entered.
      if (writesWeighIn) {
        await writeDailyMetric(user.uid, 'weight', weighInKey, Math.round(weightLbs * 10) / 10).catch((e) =>
          captureError(e, { where: 'onboarding.weighIn' }),
        );
      }
      // First run only: the unit the plan was asked in becomes the profile's.
      // Only when it differs from what the profile already reads as — an
      // absent field already reads 'us'. Not fatal: the plan is saved in
      // pounds either way, and Settings → Units is the fallback.
      if (!isRedo && unitSystem !== storedUnit) {
        await setUnitSystem(user.uid, unitSystem).catch((e) =>
          captureError(e, { where: 'onboarding.setUnitSystem' }),
        );
      }
      // First run only — an existing user was never asked, and the field is
      // the attestation's timestamp, not a "profile saved" stamp.
      if (!isRedo && ageConfirmed) await stampAgeConfirmed(user.uid);
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
    })().catch((e: unknown) => {
      // A permission-denied here means the email isn't verified (the rules
      // block the write) — surface that instead of blaming the connection.
      // With the verify-email gate in place this is a rare fallback, but the
      // token can lag verification by up to an hour.
      const code = (e as { code?: string })?.code;
      setError(t(code === 'permission-denied' ? 'onboarding.saveErrVerify' : 'onboarding.saveErr'));
      setBusy(false);
    });
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
    await setRemindersEnabled(true)
      .then((granted) => {
        if (granted) haptics.success();
      })
      .catch(() => {
        // Permission prompt failing must never trap someone in onboarding.
      })
      .finally(() => {
        setBusy(false);
        goFirstLog();
      });
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
  // Goal is the first step for everyone now, so nothing sits behind it.
  const showBack = step !== 'goal' && step !== 'reminders' && step !== 'firstLog';

  // Android hardware back follows the on-screen controls (09-22 item): it
  // quit the app from the middle of the wizard, losing every answer. Where
  // the back chevron shows, it steps back; on a redo's first step it is the
  // Cancel X; after the save (reminders, first log) there is nothing to go
  // back to, so it is consumed. Only a first run's first step lets the OS
  // have it — leaving the app there is what back means.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (showBack) {
        go(-1);
        return true;
      }
      if (step === 'reminders' || step === 'firstLog') return true;
      if (isRedo) {
        router.replace('/settings');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });
  // The unit toggle: a first-run choice. A redo keeps the profile's unit and
  // sees the screen exactly as before (Settings owns the unit for them).
  const unitToggle = !isRedo;
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
          which is why it is the worst of them. The same geometry holds on
          Android: under <KeyboardProvider> the window does not resize for the
          IME (it did nothing there until 2026-10-06, and the keyboard covered
          the fields), so padding is the behavior on both platforms. */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={-insets.bottom}
        style={styles.fill}
      >
        {/* Top bar: back + progress dots. */}
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
              Settings → Redo setup: the user already has data, so offer a plain
              Cancel back to Settings instead of a destructive sign-out. */}
          {isRedo ? (
            <PressScale
              style={[styles.back, styles.backEnd]}
              scaleTo={0.9}
              onPress={() => { haptics.tap(); router.replace('/settings'); }}
              testID="onboarding-cancel"
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Ionicons name="close" size={24} color={colors.faint} />
            </PressScale>
          ) : (
            <PressScale
              style={[styles.back, styles.backEnd]}
              scaleTo={0.9}
              onPress={onSignOut}
              testID="onboarding-signout"
              accessibilityRole="button"
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
          {step === 'goal' ? (
            <View style={styles.step}>
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.goalQ')}</Text>
              <View style={styles.goals} accessibilityRole="radiogroup" accessibilityLabel={t('onboarding.goalQ')}>
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
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      testID={`onboarding-goal-${g.key}`}
                    >
                      {/* The selected icon sits on `heroTrack`, which is dark in
                          BOTH themes — so `heroText`, not `onInk` (near-black
                          in dark mode: 1.31:1, UX review S21 #2). */}
                      <View style={[styles.goalIcon, on && styles.goalIconOn]}>
                        <Ionicons name={g.icon} size={24} color={on ? colors.heroText : colors.ink} />
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
              {/* Required, and said to be: the CTA below stays disabled until
                  this is checked, and a greyed button with no stated reason is
                  a locked door. Apple 5.1.4 / GDPR-K want the attestation
                  itself; `ageConfirmedAt` is the record of it. First run only —
                  it lived on a welcome step of its own until 2026-10-06. */}
              {!isRedo ? (
                <View style={styles.attestWrap}>
                  <PressScale
                    style={styles.attestRow}
                    scaleTo={0.98}
                    onPress={() => {
                      haptics.tap();
                      setAgeConfirmed((v) => !v);
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: ageConfirmed }}
                    accessibilityLabel={t('onboarding.ageAttest')}
                    testID="onboarding-age-attest"
                  >
                    <Ionicons
                      name={ageConfirmed ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={ageConfirmed ? colors.accent : colors.muted}
                    />
                    <Text style={styles.attestText}>{t('onboarding.ageAttest')}</Text>
                  </PressScale>
                  {!ageConfirmed ? (
                    <Text style={styles.attestHint} testID="onboarding-age-attest-hint">
                      {t('onboarding.ageAttestRequired')}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {step === 'weight' ? (
            <View style={styles.step}>
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.weightQ')}</Text>
              {unitToggle ? (
                <UnitToggle
                  value={unitSystem}
                  onChange={switchUnit}
                  label={t('onboarding.units')}
                  options={[
                    { value: 'us', text: bodyWeightUnit('us'), a11y: t('onboarding.unitLb') },
                    { value: 'metric', text: bodyWeightUnit('metric'), a11y: t('onboarding.unitKg') },
                  ]}
                  styles={styles}
                  testID="onboarding-unit-weight"
                />
              ) : null}
              <BigInput value={weight} onChangeText={typeWeight} placeholder={String(toDisplayWeight(180, unitSystem))} unit={weightUnit} label={t('onboarding.weightQ')} styles={styles} colors={colors} testID="onboarding-weight" />
              {isRedo && latestLb != null ? (
                <Text style={styles.stepSub} testID="onboarding-weight-prefilled">
                  {t(writesWeighIn ? 'onboarding.weightNewWeighIn' : 'onboarding.weightPrefilled')}
                </Text>
              ) : null}
              {weight.trim() !== '' && !weightOk ? (
                <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="onboarding-weight-error">
                  {t('onboarding.weightRange', { min: weightBand.min, max: weightBand.max, unit: weightUnit })}
                </Text>
              ) : null}
            </View>
          ) : null}

          {step === 'goalWeight' ? (
            <View style={styles.step}>
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.goalWeightQ')}</Text>
              <Text style={styles.stepSub}>{t('onboarding.goalWeightOptional')}</Text>
              <BigInput value={targetWeight} onChangeText={setTargetWeight} placeholder={String(toDisplayWeight(165, unitSystem))} unit={weightUnit} label={t('onboarding.goalWeightQ')} styles={styles} colors={colors} testID="onboarding-target-weight" />
              {!targetBlank && !targetWeightOk ? (
                <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="onboarding-target-weight-error">
                  {!weightInBand(targetWeightLbs)
                    ? t('onboarding.weightRange', { min: weightBand.min, max: weightBand.max, unit: weightUnit })
                    : t(targetDirIssue === 'notAbove' ? 'onboarding.goalWeightAbove' : 'onboarding.goalWeightBelow', {
                        w: `${weight.trim()} ${weightUnit}`,
                      })}
                </Text>
              ) : null}
              <SkipLink
                label={t('onboarding.goalWeightSkip')}
                onPress={() => {
                  setTargetWeight('');
                  go(1);
                }}
                styles={styles}
                testID="onboarding-skip-goal-weight"
              />
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
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.bodyQ')}</Text>
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
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
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
                <View style={styles.labelRow}>
                  <Text style={styles.label}>{t('refine.height')}</Text>
                  {unitToggle ? (
                    <UnitToggle
                      value={unitSystem}
                      onChange={switchUnit}
                      label={t('onboarding.units')}
                      options={[
                        { value: 'us', text: `${t('refine.feet')} / ${t('refine.inches')}`, a11y: t('onboarding.unitFtIn') },
                        { value: 'metric', text: measureUnit('metric'), a11y: t('onboarding.unitCm') },
                      ]}
                      styles={styles}
                      testID="onboarding-unit-height"
                    />
                  ) : null}
                </View>
                {metric ? (
                  <View style={styles.row}>
                    <View style={styles.unitInput}>
                      <TextInput
                        style={styles.input}
                        placeholder="175"
                        placeholderTextColor={colors.faint}
                        keyboardType="numeric"
                        value={heightCm}
                        onChangeText={setHeightCm}
                        maxLength={5}
                        accessibilityLabel={t('onboarding.heightCm')}
                        testID="onboarding-height-cm"
                      />
                      <Text style={styles.unit}>{measureUnit('metric')}</Text>
                    </View>
                  </View>
                ) : (
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
                )}
                {heightTyped && !heightValid ? (
                  <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="onboarding-height-error">
                    {!metric && inchesOutOfRange(inches)
                      ? t('onboarding.heightInchesRange')
                      : t('onboarding.heightRange', heightBandFor(unitSystem, { ft: t('refine.feet'), in: t('refine.inches') }))}
                  </Text>
                ) : null}
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
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.activityQ')}</Text>
              <View style={styles.activityCol}>
                {ACTIVITY.map((a) => {
                  const on = activity === a.value;
                  return (
                    <PressScale
                      key={a.value}
                      style={[styles.activityRow, on && styles.activityRowOn]}
                      scaleTo={0.98}
                      onPress={() => { haptics.tap(); setActivity(a.value); }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
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
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.planQ')}</Text>
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
                    valueText={kcal != null ? formatNumber(kcal, locale) : null}
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
                    valueText={protein != null ? `${formatNumber(protein, locale)} g` : null}
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
                {isRedo && redoBasis != null
                  ? redoBasis
                  : seed?.basis === 'formula' && seed.maintenance != null
                    ? t('onboarding.planBasis', { n: formatNumber(seed.maintenance, locale) })
                    : t('onboarding.planBasisRough')}
              </Text>
              {(isRedo ? redoFloor && !kcalEdited : seed?.floorBinding && !edited) ? (
                <Text style={styles.planSub} testID="onboarding-plan-floor">
                  {t('onboarding.planFloor', { n: formatNumber((kcal ?? 0), locale) })}
                </Text>
              ) : null}
              <Text style={styles.planSub}>
                {t('onboarding.planSub')} {t('targets.editHint')}
              </Text>
              {/* Every rejection says WHY. Only `belowFloor` was rendered before,
                  so an above-ceiling or cleared number greyed the CTA with
                  nothing on screen to explain it. */}
              {kcalEdited && !kcalCheck.ok ? (
                <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="onboarding-kcal-error">
                  {kcalCheck.issue?.kind === 'belowFloor'
                    ? t('targets.errBelowFloor', { n: formatNumber(kcalCheck.issue.floor, locale) })
                    : kcalCheck.issue?.kind === 'aboveCeiling'
                      ? t('targets.errAboveCeiling', { n: formatNumber(kcalCheck.issue.ceiling, locale) })
                      : t('targets.errNumber')}
                </Text>
              ) : null}
              {proteinEdited && (!kcalEdited || kcalCheck.ok) && !proteinCheck.ok ? (
                <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="onboarding-protein-error">
                  {proteinCheck.issue?.kind === 'belowFloor'
                    ? t('targets.errProteinMin', { n: formatNumber(proteinCheck.issue.floor, locale) })
                    : proteinCheck.issue?.kind === 'aboveCeiling'
                      ? t('targets.errProteinMax', { n: formatNumber(proteinCheck.issue.ceiling, locale) })
                      : t('targets.errNumber')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {step === 'reminders' ? (
            <View style={styles.step} testID="onboarding-reminders">
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.remindersQ')}</Text>
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
              <Text style={styles.question} accessibilityRole="header">{t('onboarding.firstLogQ')}</Text>
              <Text style={styles.planSub}>{t('onboarding.firstLogBody')}</Text>
              <View style={styles.planPanel}>
                <Text style={styles.reminderRow}>{t('onboarding.firstLogSearch')}</Text>
                <Text style={styles.reminderRow}>{t('onboarding.firstLogPhoto')}</Text>
                <Text style={styles.reminderRow}>{t('onboarding.firstLogType')}</Text>
              </View>
              <Text style={styles.planSub}>{t('onboarding.firstLogNote')}</Text>
            </View>
          ) : null}

          {error ? (
            <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="onboarding-error">
              {error}
            </Text>
          ) : null}
        </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          {step === 'reminders' ? (
            <PressScale style={styles.ctaGhost} scaleTo={0.98} disabled={busy} onPress={goFirstLog} accessibilityRole="button" accessibilityState={{ disabled: busy }} testID="onboarding-reminders-skip">
              <Text style={styles.ctaGhostText}>{t('onboarding.remindersNotNow')}</Text>
            </PressScale>
          ) : null}
          {step === 'firstLog' ? (
            <PressScale style={styles.ctaGhost} scaleTo={0.98} disabled={busy} onPress={leaveOnboarding} accessibilityRole="button" accessibilityState={{ disabled: busy }} testID="onboarding-first-log-later">
              <Text style={styles.ctaGhostText}>{t('onboarding.firstLogLater')}</Text>
            </PressScale>
          ) : null}
          <PressScale
            style={[styles.cta, !canAdvance && styles.ctaDisabled]}
            scaleTo={0.98}
            disabled={!canAdvance || busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAdvance || busy, busy }}
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
                {step === 'firstLog'
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
      {/* First run only. A redo is pushed ON TOP of the `(app)` layout, whose
          own host is registered — a second one here would take the slot and
          null it on unmount, leaving Settings' confirms dead. */}
      {!isRedo ? <ConfirmHost /> : null}
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
  valueText,
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
  /** The number as read aloud ("1,850", "140 g"). The button used to announce
   *  only "Calories" — the one thing on it a sighted user reads is the number. */
  valueText: string | null;
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
          maxFontSizeMultiplier={1.4}
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
          accessibilityLabel={valueText ? `${label}, ${valueText}` : label}
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
  testID = 'onboarding-skip-body',
}: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  testID?: string;
}) {
  return (
    <PressScale
      style={styles.skip}
      scaleTo={0.96}
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      <Text style={styles.skipText}>{label}</Text>
    </PressScale>
  );
}

/**
 * The first-run unit toggle — two segments, one choice. A radio group rather
 * than a switch: "lb" vs "kg" is a pick between two named things, and each
 * segment says what it is to a screen reader (`Pounds`, not "l b").
 */
function UnitToggle({
  value,
  onChange,
  label,
  options,
  styles,
  testID,
}: {
  value: UnitSystem;
  onChange: (next: UnitSystem) => void;
  label: string;
  options: { value: UnitSystem; text: string; a11y: string }[];
  styles: ReturnType<typeof createStyles>;
  testID: string;
}) {
  return (
    <View style={styles.unitToggle} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressScale
            key={o.value}
            style={[styles.unitSeg, on && styles.unitSegOn]}
            scaleTo={0.96}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={o.a11y}
            testID={`${testID}-${o.value}`}
          >
            <Text style={[styles.unitSegText, on && styles.unitSegTextOn]}>{o.text}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

function BigInput({
  value,
  onChangeText,
  placeholder,
  unit,
  label,
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
  /** The question the field answers — its accessible name (S18-3). A 72-pt
   *  number with no label reads as "text field" and nothing else. */
  label: string;
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
        accessibilityLabel={label}
        // 72 pt × the largest accessibility size overflows the row; 1.4 keeps
        // the number and its unit on one line (S18-7).
        maxFontSizeMultiplier={1.4}
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
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: space.md, minHeight: 44 },
    back: { width: TARGET, height: TARGET, alignItems: 'flex-start', justifyContent: 'center' },
    // The right-hand button's glyph sits against the screen edge, as the
    // back chevron does on the left; the box grows inward.
    backEnd: { alignItems: 'flex-end' },
    dots: { flexDirection: 'row', gap: space.xs },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.line },
    dotOn: { width: 22, backgroundColor: colors.ink },
    dotDone: { backgroundColor: colors.accent },
    // flexGrow centres the step when it fits and scrolls it when it doesn't.
    stepScroll: { flexGrow: 1, justifyContent: 'center' },
    // maxWidth keeps the form readable rather than edge-to-edge on an iPad.
    stepWrap: { paddingHorizontal: space.xl, paddingVertical: space.lg, width: '100%', maxWidth: 480, alignSelf: 'center' },
    // The 16+ attestation row under the goal cards.
    attestWrap: { alignSelf: 'stretch', gap: space.xs },
    attestRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      minHeight: TARGET,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      backgroundColor: colors.card,
    },
    attestText: { flex: 1, fontSize: font.body, color: colors.ink, fontWeight: '600' },
    attestHint: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
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
    // On the selected card's `ink` fill, so `onInk` — `heroMuted` was right
    // only in light mode, where ink is dark; in dark mode ink is the light
    // off-white and it measured 2.41:1 (UX review S21 #2). `onInk` is
    // 17.5:1 (light) / 16.6:1 (dark); the label/hint hierarchy is carried by
    // size and family, not by a dimmer colour.
    goalHintOn: { color: colors.onInk },
    // Sub-line under a step question (why we are asking).
    stepSub: { fontSize: font.body, color: colors.muted, lineHeight: font.body * 1.4, marginTop: -space.md },
    // Labelled form fields, mirroring Settings → Refine targets so the two
    // screens that ask these four questions look like the same question.
    field: { gap: space.xs },
    label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
    // The lb/kg · ft-in/cm toggle (first run only). Each segment is a full
    // touch target on its own.
    unitToggle: {
      flexDirection: 'row',
      alignSelf: 'center',
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.pill,
      padding: 2,
      backgroundColor: colors.inputBg,
    },
    unitSeg: { minHeight: TARGET, minWidth: TARGET + space.md, paddingHorizontal: space.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    unitSegOn: { backgroundColor: colors.ink },
    unitSegText: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
    unitSegTextOn: { color: colors.onInk },
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
      // `lineStrong`, not `line`: a text field's edge is what identifies it as
      // one (WCAG 1.4.11, ≥3:1). `line` measured ~1.2:1; `lineStrong` is
      // 3.7:1 light / 3.3:1 dark on `inputBg` (theme.ts).
      borderColor: colors.lineStrong,
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
    // Under a labelled field, so left-aligned and without the centred slot's top margin.
    fieldError: { color: colors.danger, fontSize: font.small },
    // Same maxWidth as stepWrap so the CTA lines up with the step on an iPad.
    footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
    cta: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    ctaDisabled: { opacity: 0.4 },
    ctaText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    ctaGhost: { paddingVertical: space.md, alignItems: 'center', marginBottom: space.xs },
    ctaGhostText: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
    // On the HERO PANEL, which is dark in BOTH themes — so `heroText`, the
    // panel's own text token. History: `colors.ink` was ink-on-ink and
    // invisible in light theme (LG VS988, 2026-09-02); the fix to `onInk`
    // then made it invisible in DARK theme, where `onInk` is the near-black
    // canvas — 1.02:1, both panels blank (UX review S21 #1). `heroText` does
    // not invert, because the panel does not. Pinned by
    // `firstrun-s21-hero-panel.test.tsx`.
    reminderRow: { fontSize: font.body, color: colors.heroText, paddingVertical: space.xs, textAlign: 'center' },
  });
