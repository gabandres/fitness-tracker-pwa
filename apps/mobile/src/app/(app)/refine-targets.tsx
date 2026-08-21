import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
  type ActivityLevel,
  type Sex,
  activityMultiplier as activityMultiplierFor,
  basalMifflinStJeor,
  paceReality,
} from '@macrolog/core';
import { useActivitySuggestion } from '@/lib/activity-suggestion';
import { useAuth } from '@/lib/auth';
import { useDailyTargets } from '@/hooks/useDailyTargets';
import { getLatestDailyWeight, saveRefinedTargets } from '@/lib/ledger';
import { type I18nKey, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

const ACTIVITY: { value: ActivityLevel; labelKey: I18nKey }[] = [
  { value: 'sedentary', labelKey: 'activity.sedentary' },
  { value: 'light', labelKey: 'activity.light' },
  { value: 'moderate', labelKey: 'activity.moderate' },
  { value: 'active', labelKey: 'activity.active' },
  { value: 'very_active', labelKey: 'activity.very_active' },
];

function intOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function RefineTargets() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  // Set when the Trends correction card sends the user here: the screen opens
  // already on the suggested bucket, so accepting is just Save.
  const { suggested } = useLocalSearchParams<{ suggested?: ActivityLevel }>();

  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [feet, setFeet] = useState(profile?.heightIn ? String(Math.floor(profile.heightIn / 12)) : '');
  const [inches, setInches] = useState(profile?.heightIn ? String(profile.heightIn % 12) : '');
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(
    suggested ?? profile?.activityLevel ?? null,
  );
  const [pace, setPace] = useState<number>(profile?.targetPaceLbsPerWeek ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ft = intOrNull(feet);
  const inch = intOrNull(inches);
  const heightIn = ft != null && inch != null ? ft * 12 + inch : null;
  const ageNum = intOrNull(age);

  const heightValid = heightIn != null && heightIn >= 40 && heightIn <= 96;
  const ageValid = ageNum != null && ageNum >= 13 && ageNum <= 120;

  // ── Activity pre-fill from imported Health activity ──────────────────
  // Only ever fills an EMPTY activity field. A stored activityLevel is never
  // swapped underneath someone who came here to edit their pace.
  const [touched, setTouched] = useState(false);
  const [weightLbs, setWeightLbs] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    // A rejection here used to vanish: no catch, so `weightLbs` stayed null,
    // `basalKcal` stayed 0, and the activity suggestion silently never
    // appeared. The screen still works without a weight — it just can't
    // pre-fill — so log and carry on rather than blocking on it.
    getLatestDailyWeight(user.uid)
      .then((w) => alive && setWeightLbs(w))
      .catch((e: unknown) => console.warn('refine-targets: latest weight unavailable', e));
    return () => {
      alive = false;
    };
  }, [user]);

  // Live basal off the FORM values, not the stored profile — the pre-fill
  // must track sex/height/age as the user fills them in. 0 until all three
  // are valid, which `suggestActivityLevel` reads as "can't decide yet".
  const basalKcal =
    sex != null && heightValid && ageValid && weightLbs != null
      ? basalMifflinStJeor({ heightIn: heightIn as number, age: ageNum as number, sex }, weightLbs)
      : 0;

  const { suggestion, guidance, decline, accept, connect, connecting, evidence } = useActivitySuggestion({
    uid: user?.uid,
    basalKcal,
    // Null at seed ⇒ no deadband: this is a pre-fill of an empty field rather
    // than a correction of a stated answer. When a bucket IS stored the
    // deadband applies as usual, and the pre-fill can't fire anyway (`activity`
    // starts non-null), so nothing is swapped underneath the user.
    currentBucket: profile?.activityLevel ?? null,
  });

  // Reactive until the first manual tap, then frozen: recomputing under a
  // user who has just chosen would fight them.
  const prefill = touched ? null : suggestion;
  /** What the form will actually save: an explicit tap, else the pre-fill. */
  const selected = activity ?? prefill;
  const showDisclosure = activity == null && prefill != null;

  function chooseActivity(value: ActivityLevel) {
    haptics.tap();
    // Overriding a live pre-fill IS a decline — the Trends card must not come
    // back later suggesting the bucket they just rejected by hand.
    if (prefill != null && value !== prefill) decline();
    setTouched(true);
    setActivity(value);
  }

  const canSave = sex != null && heightValid && ageValid && selected != null && !busy;

  // ── What the chosen pace actually delivers ───────────────────────────
  // The stepper above is a promise the target math is free to break:
  // `calculateTdee` clamps the target at `calorieFloor`, so a floor near
  // maintenance can turn 0.9 lb/wk into 0.04 and nothing on this screen says
  // so. Reports existing arithmetic — no target math changes here — and only
  // when the floor changes a number the user can see. Live against the
  // stepper, not the saved profile, so it answers "what would this do?".
  // No reality check until the targets are actually loaded — `paceReality`
  // already returns null for a seed TDEE, but that leaned on the seed being
  // the only empty-input result. Say it here instead of relying on it.
  const targetsView = useDailyTargets();
  const reality = targetsView.loaded
    ? paceReality(targetsView.targets.tdee, pace, profile)
    : null;
  const paceLimit = reality?.floorBinding ? reality : null;

  async function onSave() {
    if (!canSave || !user || sex == null || heightIn == null || ageNum == null || selected == null) return;
    setError(null);
    setBusy(true);
    try {
      // Saving a suggested bucket IS the accept.
      const accepting = selected === suggestion || selected === suggested;
      // When the user accepts, store the CONTINUOUS multiplier their own
      // device window implies rather than the bucket's rung. The bucket is
      // still saved — it is their stated answer and what copy says — but the
      // ladder cannot express the value the data supports, and on a real
      // account the nearest rung was 17.9% out where the continuous value is
      // 4.2% (ADR-0024). `undefined` on any other save leaves the stored
      // multiplier untouched; a manual bucket change clears it, because the
      // user has just overridden the measurement on purpose.
      const activityMultiplier = accepting
        ? evidence?.meanActiveKcal
          ? activityMultiplierFor(evidence.meanActiveKcal, basalKcal)
          : undefined
        : touched
          ? null
          : undefined;

      await saveRefinedTargets(user.uid, {
        heightIn,
        age: ageNum,
        sex,
        activityLevel: selected,
        activityMultiplier,
        targetPaceLbsPerWeek: pace,
      });
      // Drop any remembered "no" so a future window is free to suggest that
      // bucket again.
      if (accepting) accept();
      haptics.success();
      router.replace('/settings');
    } catch {
      setError(t('refine.saveErr'));
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="refine-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('refine.title')}</Text>
        <View style={{ width: 26 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>{t('refine.subtitle')}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t('refine.sex')}</Text>
            <View style={styles.segment}>
              {(['male', 'female'] as Sex[]).map((s) => {
                const on = sex === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.segBtn, on && styles.segBtnOn]}
                    onPress={() => { haptics.tap(); setSex(s); }}
                    testID={`refine-sex-${s}`}
                  >
                    <Text style={[styles.segText, on && styles.segTextOn]}>{s === 'male' ? t('refine.male') : t('refine.female')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('refine.height')}</Text>
            <View style={styles.row}>
              <View style={styles.unitInput}>
                <TextInput style={styles.input} placeholder="5" placeholderTextColor={colors.faint} keyboardType="numeric" value={feet} onChangeText={setFeet} testID="refine-feet" />
                <Text style={styles.unit}>{t('refine.feet')}</Text>
              </View>
              <View style={styles.unitInput}>
                <TextInput style={styles.input} placeholder="10" placeholderTextColor={colors.faint} keyboardType="numeric" value={inches} onChangeText={setInches} testID="refine-inches" />
                <Text style={styles.unit}>{t('refine.inches')}</Text>
              </View>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('refine.age')}</Text>
            <TextInput style={[styles.input, styles.ageInput]} placeholder="30" placeholderTextColor={colors.faint} keyboardType="numeric" value={age} onChangeText={setAge} testID="refine-age" />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('refine.activity')}</Text>
            <View style={styles.activityCol}>
              {ACTIVITY.map((a) => {
                const on = selected === a.value;
                return (
                  <TouchableOpacity
                    key={a.value}
                    style={[styles.activityRow, on && styles.activityRowOn]}
                    onPress={() => chooseActivity(a.value)}
                    testID={`refine-activity-${a.value}`}
                  >
                    <Text style={[styles.activityText, on && styles.activityTextOn]}>{t(a.labelKey)}</Text>
                    {on ? <Ionicons name="checkmark" size={18} color={colors.onInk} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            {showDisclosure ? (
              <Text style={styles.hint} testID="refine-activity-hint">
                {t('refine.activityFromHealth')}
              </Text>
            ) : null}

            {/* The connect ask lives HERE and nowhere else: this is the one
                moment the user is visibly guessing at the answer imported
                activity would give them. Progress / steps-only replace it once
                connected, so the field never carries two messages at once. */}
            {guidance.kind === 'connect' ? (
              <View style={styles.healthPrompt} testID="refine-activity-connect">
                <Text style={styles.hint}>{t('refine.activityConnect')}</Text>
                <TouchableOpacity
                  style={styles.healthBtn}
                  onPress={async () => { haptics.tap(); await connect(); }}
                  disabled={connecting}
                  testID="refine-activity-connect-cta"
                >
                  {connecting ? (
                    <ActivityIndicator color={colors.onInk} />
                  ) : (
                    <Text style={styles.healthBtnText}>{t('refine.activityConnectCta')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {guidance.kind === 'progress' ? (
              <Text style={styles.hint} testID="refine-activity-progress">
                {t('activity.windowProgress', {
                  days: String(guidance.usableDays),
                  needed: String(guidance.needed),
                })}
              </Text>
            ) : null}

            {guidance.kind === 'steps-only' ? (
              <Text style={styles.hint} testID="refine-activity-steps-only">
                {t(Platform.OS === 'android' ? 'activity.stepsOnlyAndroid' : 'activity.stepsOnlyIos')}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t('refine.pace')}</Text>
            <View style={styles.paceRow}>
              <TouchableOpacity style={styles.step} onPress={() => setPace((p) => Math.max(0, Math.round((p - 0.25) * 100) / 100))} testID="refine-pace-minus">
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.paceValue} testID="refine-pace">
                {pace === 0 ? t('refine.maintain') : `${pace.toFixed(2)} ${t('refine.paceUnit')}`}
              </Text>
              <TouchableOpacity style={styles.step} onPress={() => setPace((p) => Math.min(2, Math.round((p + 0.25) * 100) / 100))} testID="refine-pace-plus">
                <Text style={styles.stepText}>+</Text>
              </TouchableOpacity>
            </View>
            {paceLimit ? (
              <Text style={styles.paceNote} testID="refine-pace-floor">
                {paceLimit.effectivePace > 0
                  ? t('refine.paceFloorCapped', {
                      floor: paceLimit.floor.toLocaleString(),
                      pace: paceLimit.effectivePace.toFixed(2),
                    })
                  : t('refine.paceFloorNoDeficit', {
                      floor: paceLimit.floor.toLocaleString(),
                      maintenance: paceLimit.maintenance.toLocaleString(),
                    })}
              </Text>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.save, !canSave && styles.saveDisabled]} onPress={onSave} disabled={!canSave} testID="refine-save">
            {busy ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.saveText}>{t('refine.save')}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md },
  title: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '800', color: colors.ink },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg },
  subtitle: { fontSize: font.body, color: colors.muted, marginTop: space.xs },
  field: { gap: space.xs },
  label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  segment: { flexDirection: 'row', gap: space.sm },
  segBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center', backgroundColor: colors.inputBg },
  segBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  segTextOn: { color: colors.onInk },
  row: { flexDirection: 'row', gap: space.md },
  unitInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
  unit: { fontSize: font.body, color: colors.muted },
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
  hint: { fontSize: font.small, color: colors.muted, marginTop: space.xs },
  healthPrompt: { marginTop: space.xs, gap: space.sm, alignItems: 'flex-start' },
  healthBtn: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.lg, minWidth: 140, alignItems: 'center' },
  healthBtnText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
  activityText: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  activityTextOn: { color: colors.onInk },
  paceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg },
  stepText: { fontSize: font.h2, color: colors.ink, fontWeight: '700' },
  paceValue: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  paceNote: { fontSize: font.small, color: colors.ink, marginTop: space.sm },
  error: { color: colors.danger, fontSize: font.small },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  save: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
