import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type GoalDirection, computeKcal, computeProtein } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { saveOnboardingV2 } from '@/lib/ledger';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, type } from '@/theme';

const GOALS: { key: GoalDirection; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { key: 'lose', labelKey: 'goal.lose', hintKey: 'goal.loseHint' },
  { key: 'maintain', labelKey: 'goal.maintain', hintKey: 'goal.maintainHint' },
  { key: 'gain', labelKey: 'goal.gain', hintKey: 'goal.gainHint' },
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
  const { user, profile } = useAuth();
  const router = useRouter();
  // A completed profile only reaches this screen via Settings → "Edit goals".
  const isRedo = !!profile?.profileCompleted;

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
  const canSave = weightLbs != null && goal != null && !busy;

  async function onSave() {
    if (!canSave || !user || !goal || weightLbs == null || kcal == null || protein == null) return;
    setError(null);
    setBusy(true);
    try {
      await saveOnboardingV2(user.uid, {
        weightLbs,
        goalDirection: goal,
        targetWeightLbs: goal === 'maintain' ? undefined : numOrUndef(targetWeight),
        manualCaloriesTarget: kcal,
        manualProteinTarget: protein,
      });
      haptics.success();
      // Redo came from Settings → return there (back() can't restore the
      // href:null Settings screen across the group boundary). A first-time
      // user moves into the app (the gate no longer auto-redirects here).
      router.replace(isRedo ? '/settings' : '/(app)');
    } catch {
      setError(t('onboarding.saveErr'));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Animated.Text style={styles.brand} entering={enterUp(0)}>
            {isRedo ? t('onboarding.titleEdit') : t('onboarding.titleNew')}
          </Animated.Text>
          <Animated.Text style={styles.tagline} entering={enterUp(1)}>
            {t('onboarding.tagline')}
          </Animated.Text>

          <Animated.View style={styles.field} entering={enterUp(2)}>
            <Text style={styles.label}>{t('onboarding.currentWeight')}</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 180"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              testID="onboarding-weight"
            />
          </Animated.View>

          <Animated.View style={styles.field} entering={enterUp(3)}>
            <Text style={styles.label}>{t('onboarding.goal')}</Text>
            <View style={styles.goals}>
              {GOALS.map((g) => {
                const on = goal === g.key;
                return (
                  <PressScale
                    key={g.key}
                    style={[styles.goal, on ? styles.goalOn : null]}
                    onPress={() => {
                      haptics.tap();
                      setGoal(g.key);
                    }}
                    testID={`onboarding-goal-${g.key}`}
                  >
                    <Text style={[styles.goalLabel, on && styles.goalLabelOn]}>{t(g.labelKey)}</Text>
                    <Text style={[styles.goalHint, on && styles.goalHintOn]}>{t(g.hintKey)}</Text>
                  </PressScale>
                );
              })}
            </View>
          </Animated.View>

          {goal && goal !== 'maintain' ? (
            <View style={styles.field}>
              <Text style={styles.label}>{t('onboarding.goalWeight')}</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 165"
                placeholderTextColor={colors.faint}
                keyboardType="numeric"
                value={targetWeight}
                onChangeText={setTargetWeight}
                testID="onboarding-target-weight"
              />
            </View>
          ) : null}

          {kcal != null && protein != null ? (
            <Animated.View style={styles.preview} testID="onboarding-preview" entering={enterUp(0)}>
              <Text style={styles.previewTitle}>{t('onboarding.targets')}</Text>
              <View style={styles.previewRow}>
                <View style={styles.previewStat}>
                  <Text style={styles.previewValue}>{kcal.toLocaleString()}</Text>
                  <Text style={styles.previewLabel}>{t('onboarding.calories')}</Text>
                </View>
                <View style={styles.previewStat}>
                  <Text style={styles.previewValue}>{protein}g</Text>
                  <Text style={styles.previewLabel}>{t('onboarding.protein')}</Text>
                </View>
              </View>
              <Text style={styles.previewNote}>{t('onboarding.refineNote')}</Text>
            </Animated.View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {isRedo ? (
            <TouchableOpacity style={styles.cancel} onPress={() => router.replace('/settings')} testID="onboarding-cancel">
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.save, !canSave && styles.saveDisabled]}
            onPress={onSave}
            disabled={!canSave}
            testID="onboarding-save"
          >
            {busy ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.saveText}>{isRedo ? t('onboarding.saveEdit') : t('onboarding.saveNew')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors, shadow }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  body: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xl, gap: space.lg },
  brand: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
  tagline: { fontSize: font.body, color: colors.muted, marginTop: -space.sm, marginBottom: space.sm },
  field: { gap: space.xs },
  label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: font.h3,
    color: colors.ink,
  },
  goals: { flexDirection: 'row', gap: space.sm },
  goal: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    gap: 2,
  },
  goalOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  goalLabel: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  goalLabelOn: { color: colors.onInk },
  goalHint: { fontSize: font.tiny, color: colors.faint },
  goalHintOn: { color: colors.line },
  preview: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.sm,
    ...shadow.e1,
  },
  previewTitle: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  previewRow: { flexDirection: 'row', gap: space.xl },
  previewStat: { gap: 2 },
  previewValue: { fontFamily: type.display, fontSize: font.h1, color: colors.ink },
  previewLabel: { fontSize: font.small, color: colors.muted },
  previewNote: { fontSize: font.small, color: colors.faint },
  error: { color: colors.danger, fontSize: font.small },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  cancel: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  cancelText: { color: colors.muted, fontWeight: '700', fontSize: font.body },
  save: {
    flex: 1,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
