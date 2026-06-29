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
import { SafeAreaView } from 'react-native-safe-area-context';
import { type GoalDirection, computeKcal, computeProtein } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { saveOnboardingV2 } from '@/lib/ledger';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

const GOALS: { key: GoalDirection; label: string; hint: string }[] = [
  { key: 'lose', label: 'Lose fat', hint: 'Calorie deficit' },
  { key: 'maintain', label: 'Maintain', hint: 'Stay at weight' },
  { key: 'gain', label: 'Build', hint: 'Lean gain' },
];

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function Onboarding() {
  const { user, profile } = useAuth();
  const router = useRouter();
  // A completed profile only reaches this screen via Settings → "Edit goals".
  const isRedo = !!profile?.profileCompleted;

  const [weight, setWeight] = useState('');
  const [goal, setGoal] = useState<GoalDirection | null>(profile?.goalDirection ?? null);
  const [targetWeight, setTargetWeight] = useState(
    profile?.targetWeightLbs != null ? String(profile.targetWeightLbs) : '',
  );
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
      setError('Could not save. Check your connection and try again.');
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
          <Text style={styles.brand}>{isRedo ? 'Edit your goals' : 'Welcome to Macro Log'}</Text>
          <Text style={styles.tagline}>Two questions and you're set — we'll do the math.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Current weight (lb)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 180"
              placeholderTextColor={colors.faint}
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              testID="onboarding-weight"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Goal</Text>
            <View style={styles.goals}>
              {GOALS.map((g) => {
                const on = goal === g.key;
                return (
                  <TouchableOpacity
                    key={g.key}
                    style={[styles.goal, on && styles.goalOn]}
                    onPress={() => {
                      haptics.tap();
                      setGoal(g.key);
                    }}
                    testID={`onboarding-goal-${g.key}`}
                  >
                    <Text style={[styles.goalLabel, on && styles.goalLabelOn]}>{g.label}</Text>
                    <Text style={[styles.goalHint, on && styles.goalHintOn]}>{g.hint}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {goal && goal !== 'maintain' ? (
            <View style={styles.field}>
              <Text style={styles.label}>Goal weight (lb) — optional</Text>
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
            <View style={styles.preview} testID="onboarding-preview">
              <Text style={styles.previewTitle}>Your daily targets</Text>
              <View style={styles.previewRow}>
                <View style={styles.previewStat}>
                  <Text style={styles.previewValue}>{kcal.toLocaleString()}</Text>
                  <Text style={styles.previewLabel}>calories</Text>
                </View>
                <View style={styles.previewStat}>
                  <Text style={styles.previewValue}>{protein}g</Text>
                  <Text style={styles.previewLabel}>protein</Text>
                </View>
              </View>
              <Text style={styles.previewNote}>
                You can refine these anytime in Settings as your weight changes.
              </Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          {isRedo ? (
            <TouchableOpacity style={styles.cancel} onPress={() => router.replace('/settings')} testID="onboarding-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.save, !canSave && styles.saveDisabled]}
            onPress={onSave}
            disabled={!canSave}
            testID="onboarding-save"
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.saveText}>{isRedo ? 'Save goals' : 'Start tracking'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  body: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xl, gap: space.lg },
  brand: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
  tagline: { fontSize: font.body, color: colors.muted, marginTop: -space.sm, marginBottom: space.sm },
  field: { gap: space.xs },
  label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  input: {
    backgroundColor: colors.white,
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
    backgroundColor: colors.white,
    alignItems: 'center',
    gap: 2,
  },
  goalOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  goalLabel: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  goalLabelOn: { color: colors.white },
  goalHint: { fontSize: font.tiny, color: colors.faint },
  goalHintOn: { color: colors.line },
  preview: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.sm,
  },
  previewTitle: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  previewRow: { flexDirection: 'row', gap: space.xl },
  previewStat: { gap: 2 },
  previewValue: { fontSize: font.h1, fontWeight: '800', color: colors.ink },
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
  saveText: { color: colors.white, fontWeight: '700', fontSize: font.h3 },
});
