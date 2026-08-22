import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
import {
  TARGET_PROTEIN_MAX,
  TARGET_PROTEIN_MIN,
  type TargetIssue,
  type TargetMode,
  validateCalorieTarget,
  validateProteinTarget,
} from '@macrolog/core';
import { useDailyTargets } from '@/hooks/useDailyTargets';
import { type I18nKey, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { saveTargetMode } from '@/lib/ledger';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Daily targets — Automatic, or the user's own numbers.
 *
 * ## Why this screen exists
 *
 * A real user asked for it in plain words (UX_AUDIT, Abdiel Medina,
 * 2026-08-21): the calorie goal was computed for him and there was no way to
 * put in the amount he wanted. He was right twice over — there was no input
 * control anywhere, and the `manualCaloriesTarget` the onboarding plan step
 * wrote was a SEED that a measured estimate silently replaced a fortnight
 * later.
 *
 * ## What it deliberately does NOT do
 *
 * Turning on Custom does not stop the estimator. It keeps running and its
 * answer stays on screen under the calorie field — which is the point of an
 * explicit mode rather than a hidden override: the user sees both their own
 * number and what we measure, and picks. Refine targets no longer wipes what
 * they typed, so the switch is reversible in both directions.
 *
 * Per-field, too: leaving protein blank hands protein back to the estimator,
 * where it keeps tracking body weight. Owning your calories should not freeze
 * your protein at whatever it happened to be the day you typed a number.
 */
const MODES: TargetMode[] = ['auto', 'custom'];

function numOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** One place that turns a core `TargetIssue` into copy, so two fields cannot
 *  describe the same problem in two different ways. */
function issueText(
  issue: TargetIssue | null,
  t: (k: I18nKey, p?: Record<string, string | number>) => string,
): string | null {
  if (!issue) return null;
  switch (issue.kind) {
    case 'belowFloor':
      return t('targets.errBelowFloor', { n: issue.floor });
    case 'aboveCeiling':
      return t('targets.errAboveCeiling', { n: issue.ceiling });
    case 'notANumber':
      return t('targets.errNotANumber');
    case 'aggressive':
      return t('targets.warnAggressive', { pct: issue.pctUnder, n: issue.measured });
  }
}

export default function DailyTargetsScreen() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { user, profile } = useAuth();
  const router = useRouter();
  const view = useDailyTargets();

  const [mode, setMode] = useState<TargetMode>(profile?.targetMode === 'custom' ? 'custom' : 'auto');
  const computed = view.loaded ? view.targets : null;
  const [kcal, setKcal] = useState(() => String(profile?.manualCaloriesTarget ?? ''));
  const [protein, setProtein] = useState(() => String(profile?.manualProteinTarget ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The measured maintenance, when there IS one. `useDailyTargets` runs the
  // full chain, so this is the same estimate Trends shows — not a second
  // opinion computed here.
  const measured = useMemo(() => {
    const tdee = computed?.tdee;
    if (!tdee || tdee.source !== 'measured' || !tdee.reliable) return null;
    return Math.round(tdee.trueTdee);
  }, [computed]);

  const kcalNum = numOrNull(kcal);
  const proteinNum = numOrNull(protein);
  const kcalCheck = validateCalorieTarget(kcalNum, { profile, measuredTdee: measured });
  // Protein is OPTIONAL in custom mode — blank hands it back to the estimator,
  // so an empty box is not an error here.
  const proteinCheck = protein.trim() === '' ? null : validateProteinTarget(proteinNum);

  const custom = mode === 'custom';
  const canSave = !custom || (kcalCheck.ok && (proteinCheck?.ok ?? true));

  function pickMode(next: TargetMode) {
    haptics.tap();
    setMode(next);
    // Switching to Custom with nothing stored starts from what they are on
    // today, so the first thing they see is their real number rather than an
    // empty field to guess into.
    if (next === 'custom' && kcal.trim() === '' && computed) {
      setKcal(String(computed.calorieTarget));
    }
  }

  async function onSave() {
    if (busy || !user || !canSave) return;
    setError(null);
    setBusy(true);
    try {
      await saveTargetMode(
        user.uid,
        mode,
        custom
          ? { calories: kcalNum, protein: protein.trim() === '' ? null : proteinNum }
          : // Automatic: the MODE alone changes. The stored numbers are left
            // exactly where they are, which is what makes this switch
            // reversible without retyping anything.
            {},
      );
      haptics.success();
      router.back();
    } catch {
      setError(t('targets.saveErr'));
      setBusy(false);
    }
  }

  const kcalMsg = custom ? issueText(kcalCheck.issue, t) : null;
  const kcalBlocking = custom && !kcalCheck.ok;
  const proteinBad = custom && proteinCheck != null && !proteinCheck.ok;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="targets-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('targets.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.segment}>
            {MODES.map((m) => {
              const on = mode === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.segBtn, on && styles.segBtnOn]}
                  onPress={() => pickMode(m)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  testID={`targets-mode-${m}`}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>
                    {t(m === 'auto' ? 'targets.modeAuto' : 'targets.modeCustom')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.subtitle}>{t(custom ? 'targets.customBody' : 'targets.autoBody')}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('targets.calories')}</Text>
            {custom ? (
              <View style={styles.unitInput}>
                <TextInput
                  style={[styles.input, kcalBlocking && styles.inputBad]}
                  keyboardType="number-pad"
                  value={kcal}
                  onChangeText={setKcal}
                  placeholder="2000"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel={t('targets.calories')}
                  testID="targets-kcal"
                />
                <Text style={styles.unit}>{t('targets.caloriesUnit')}</Text>
              </View>
            ) : (
              <Text style={styles.autoValue} testID="targets-kcal-auto">
                {computed ? `${computed.calorieTarget.toLocaleString()} ${t('targets.caloriesUnit')}` : '—'}
              </Text>
            )}
            {kcalMsg ? (
              <Text style={[styles.note, kcalBlocking && styles.noteBad]} testID="targets-kcal-note">
                {kcalMsg}
              </Text>
            ) : null}
            {/* Shown in BOTH modes on purpose: in Custom it is the honest
                second opinion beside the user's own number, and in Automatic
                it explains where the number above came from. */}
            <Text style={styles.note} testID="targets-measured">
              {measured != null
                ? t('targets.measuredNote', { n: measured.toLocaleString() })
                : t('targets.measuredNotYet')}
            </Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('targets.protein')}</Text>
            {custom ? (
              <View style={styles.unitInput}>
                <TextInput
                  style={[styles.input, proteinBad && styles.inputBad]}
                  keyboardType="number-pad"
                  value={protein}
                  onChangeText={setProtein}
                  placeholder={computed ? String(computed.proteinTarget) : '150'}
                  placeholderTextColor={colors.faint}
                  accessibilityLabel={t('targets.protein')}
                  testID="targets-protein"
                />
                <Text style={styles.unit}>{t('targets.proteinUnit')}</Text>
              </View>
            ) : (
              <Text style={styles.autoValue} testID="targets-protein-auto">
                {computed ? `${computed.proteinTarget} ${t('targets.proteinUnit')}` : '—'}
              </Text>
            )}
            {proteinBad ? (
              <Text style={[styles.note, styles.noteBad]} testID="targets-protein-note">
                {t('targets.errProteinRange', { min: TARGET_PROTEIN_MIN, max: TARGET_PROTEIN_MAX })}
              </Text>
            ) : null}
            {custom ? (
              // The per-field escape hatch, said in words rather than left to
              // be discovered: an empty box is a choice here, not a mistake.
              <Text style={styles.note}>{t('targets.autoProtein')}</Text>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.save, (!canSave || busy) && styles.saveDisabled]}
            disabled={!canSave || busy}
            onPress={onSave}
            testID="targets-save"
          >
            {busy ? (
              <ActivityIndicator color={colors.onInk} />
            ) : (
              <Text style={styles.saveText}>{t('targets.save')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    fill: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
    title: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '800', color: colors.ink },
    body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg },
    subtitle: { fontSize: font.body, color: colors.muted },
    segment: { flexDirection: 'row', gap: space.sm },
    segBtn: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingVertical: space.md,
      alignItems: 'center',
      backgroundColor: colors.inputBg,
    },
    segBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    segText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
    segTextOn: { color: colors.onInk },
    field: { gap: space.xs },
    label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    unitInput: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      fontSize: font.h3,
      color: colors.ink,
      flex: 1,
    },
    inputBad: { borderColor: colors.danger },
    unit: { fontSize: font.body, color: colors.muted },
    autoValue: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
    note: { fontSize: font.small, color: colors.muted },
    noteBad: { color: colors.danger },
    error: { color: colors.danger, fontSize: font.small },
    footer: {
      paddingHorizontal: space.xl,
      paddingTop: space.md,
      paddingBottom: space.lg,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    save: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    saveDisabled: { opacity: 0.4 },
    saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
  });
