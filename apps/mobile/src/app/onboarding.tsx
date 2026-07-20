import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type GoalDirection, computeKcal, computeProtein } from '@macrolog/core';
import { BrandMark } from '@/components/BrandMark';
import { useAuth } from '@/lib/auth';
import { saveOnboardingV2 } from '@/lib/ledger';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { CountUpText, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, motion, radius, space, type } from '@/theme';

type StepId = 'welcome' | 'goal' | 'weight' | 'goalWeight' | 'plan';
const ORDER: StepId[] = ['welcome', 'goal', 'weight', 'goalWeight', 'plan'];
/** Steps that get a progress dot (welcome is a greeting, not a form step). */
const DOT_STEPS: StepId[] = ['goal', 'weight', 'goalWeight', 'plan'];

const GOALS: { key: GoalDirection; labelKey: I18nKey; hintKey: I18nKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'lose', labelKey: 'goal.lose', hintKey: 'goal.loseHint', icon: 'trending-down-outline' },
  { key: 'maintain', labelKey: 'goal.maintain', hintKey: 'goal.maintainHint', icon: 'swap-horizontal-outline' },
  { key: 'gain', labelKey: 'goal.gain', hintKey: 'goal.gainHint', icon: 'trending-up-outline' },
];

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function Onboarding() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  // A completed profile only reaches this screen via Settings → "Edit goals":
  // skip the welcome greeting and return to Settings when done.
  const isRedo = !!profile?.profileCompleted;

  const [step, setStep] = useState<StepId>(isRedo ? 'goal' : 'welcome');
  const [dir, setDir] = useState<1 | -1>(1);
  const [weight, setWeight] = useState('');
  const [goal, setGoal] = useState<GoalDirection | null>(profile?.goalDirection ?? null);
  const [targetWeight, setTargetWeight] = useState(() => {
    const g = profile?.targetWeightLbs ?? profile?.goalWeightLbs;
    return g != null ? String(g) : '';
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weightLbs = numOrUndef(weight);
  const kcal = weightLbs && goal ? computeKcal(weightLbs, goal) : null;
  const protein = weightLbs ? computeProtein(weightLbs) : null;

  // Skip the goal-weight step for "maintain" (there's no target to hit).
  const skipGoalWeight = goal === 'maintain';
  function neighbor(from: StepId, delta: 1 | -1): StepId {
    let idx = ORDER.indexOf(from) + delta;
    if (ORDER[idx] === 'goalWeight' && skipGoalWeight) idx += delta;
    if (ORDER[idx] === 'welcome' && isRedo) return from; // redo can't go before goal
    return ORDER[idx] ?? from;
  }

  const canAdvance =
    step === 'welcome' ||
    (step === 'goal' && goal != null) ||
    (step === 'weight' && weightLbs != null) ||
    (step === 'goalWeight' && numOrUndef(targetWeight) != null) ||
    step === 'plan';

  function go(delta: 1 | -1) {
    haptics.tap();
    setDir(delta);
    setStep((s) => neighbor(s, delta));
  }

  async function onFinish() {
    if (busy || !user || !goal || weightLbs == null || kcal == null || protein == null) return;
    setError(null);
    setBusy(true);
    try {
      await saveOnboardingV2(user.uid, {
        weightLbs,
        goalDirection: goal,
        targetWeightLbs: skipGoalWeight ? undefined : numOrUndef(targetWeight),
        manualCaloriesTarget: kcal,
        manualProteinTarget: protein,
      });
      haptics.success();
      router.replace(isRedo ? '/settings' : '/(app)');
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

  const entering = (dir === 1 ? FadeInRight : FadeInLeft).duration(motion.dur.base).reduceMotion(ReduceMotion.System);
  const showBack = step !== 'welcome' && !(isRedo && step === 'goal');
  const dotIndex = DOT_STEPS.filter((s) => !(s === 'goalWeight' && skipGoalWeight)).indexOf(step);
  const dotTotal = DOT_STEPS.filter((s) => !(s === 'goalWeight' && skipGoalWeight)).length;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        {/* Top bar: back + progress dots (hidden on the welcome greeting). */}
        <View style={styles.topBar}>
          {showBack ? (
            <PressScale style={styles.back} scaleTo={0.9} onPress={() => go(-1)} testID="onboarding-back">
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
              <BigInput value={weight} onChangeText={setWeight} placeholder="180" styles={styles} colors={colors} testID="onboarding-weight" />
            </View>
          ) : null}

          {step === 'goalWeight' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.goalWeightQ')}</Text>
              <BigInput value={targetWeight} onChangeText={setTargetWeight} placeholder="165" styles={styles} colors={colors} testID="onboarding-target-weight" />
            </View>
          ) : null}

          {step === 'plan' ? (
            <View style={styles.step}>
              <Text style={styles.question}>{t('onboarding.planQ')}</Text>
              <View style={styles.planPanel} testID="onboarding-preview">
                <View style={styles.planRow}>
                  <View style={styles.planStat}>
                    <CountUpText value={kcal ?? 0} style={styles.planValue} />
                    <Text style={styles.planLabel}>{t('onboarding.calories')}</Text>
                  </View>
                  <View style={styles.planDivider} />
                  <View style={styles.planStat}>
                    <CountUpText value={protein ?? 0} suffix="g" style={styles.planValue} />
                    <Text style={styles.planLabel}>{t('onboarding.protein')}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.planSub}>{t('onboarding.planSub')}</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Animated.View>
        </ScrollView>

        <View style={styles.footer}>
          <PressScale
            style={[styles.cta, !canAdvance && styles.ctaDisabled]}
            scaleTo={0.98}
            disabled={!canAdvance || busy}
            onPress={step === 'plan' ? onFinish : () => go(1)}
            testID={step === 'plan' ? 'onboarding-save' : 'onboarding-next'}
          >
            {busy ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.ctaText}>
                {step === 'welcome'
                  ? t('onboarding.welcomeCta')
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

function BigInput({
  value,
  onChangeText,
  placeholder,
  styles,
  colors,
  testID,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
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
      <Text style={styles.bigUnit}>lb</Text>
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
    // Big numeric input.
    bigInputRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.sm },
    bigInput: { fontFamily: type.display, fontSize: 72, color: colors.ink, textAlign: 'center', minWidth: 140, padding: 0 },
    bigUnit: { fontSize: font.h1, color: colors.muted, marginBottom: space.lg },
    // Plan reveal.
    planPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xxl, paddingHorizontal: space.lg, ...shadow.e2 },
    planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    planStat: { flex: 1, alignItems: 'center', gap: space.xs },
    planValue: { fontFamily: type.display, fontSize: 44, color: colors.heroText },
    planLabel: { fontSize: font.body, color: colors.heroMuted },
    planDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.heroTrack, marginVertical: space.sm },
    planSub: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.md },
    error: { color: colors.danger, fontSize: font.small, textAlign: 'center', marginTop: space.md },
    // Same maxWidth as stepWrap so the CTA lines up with the step on an iPad.
    footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
    cta: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    ctaDisabled: { opacity: 0.4 },
    ctaText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
  });
