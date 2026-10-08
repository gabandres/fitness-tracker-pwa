import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  type ActivityLevel,
  type Sex,
  activityMultiplier as activityMultiplierFor,
  basalMifflinStJeor,
  bodyWeightUnit,
  lbToKg,
  measureUnit,
  toDisplayMeasure,
  isPlausibleAge,
  isPlausibleHeightIn,
  paceReality,
} from '@macrolog/core';
import { heightBandFor, parseHeightInput } from '@/app/onboarding';
import { useUnitSystem } from '@/lib/use-unit-system';
import { useActivitySuggestion } from '@/lib/activity-suggestion';
import { useAuth } from '@/lib/auth';
import { useDailyTargets } from '@/hooks/useDailyTargets';
import { getLatestDailyWeight, saveRefinedTargets } from '@/lib/ledger';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { formatNumber } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { Touchable } from '@/components/Touchable';

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
export default function RefineTargets() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { user, profile } = useAuth();
  // Set when the Trends correction card sends the user here: the screen opens
  // already on the suggested bucket, so accepting is just Save.
  // (Trends still passes `from=trends`; nothing needs it any more.)
  const { suggested } = useLocalSearchParams<{ suggested?: ActivityLevel }>();

  // Save returns to whichever screen opened this one — Settings, Trends' activity
  // card or Body's body-fat card. Until S21-1 this was a hidden TAB route whose
  // back went to the tab navigator's first route (Today), so it replaced its
  // way back to an opener named in a `from` param and hooked Android's
  // hardware back to do the same. It is a root stack route now: back — the
  // header's, the edge-swipe, the hardware key — pops to the opener on its own,
  // and Save does the same. A cold open has nothing beneath it: Today.
  const leave = useCallback(
    () => (router.canGoBack() ? router.back() : router.replace('/(app)')),
    [router],
  );

  const unitSystem = useUnitSystem();
  const metric = unitSystem === 'metric';

  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [feet, setFeet] = useState(profile?.heightIn ? String(Math.floor(profile.heightIn / 12)) : '');
  const [inches, setInches] = useState(profile?.heightIn ? String(profile.heightIn % 12) : '');
  // Metric height is ONE `cm` field (S18-8) — same parser and band as
  // onboarding's body step, so the two screens cannot disagree about it.
  const [heightCm, setHeightCm] = useState(
    profile?.heightIn ? String(Math.round(toDisplayMeasure(profile.heightIn, 'metric'))) : '',
  );
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(
    suggested ?? profile?.activityLevel ?? null,
  );
  const [pace, setPace] = useState<number>(profile?.targetPaceLbsPerWeek ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heightIn = parseHeightInput(unitSystem, { cm: heightCm, feet, inches });
  const heightTyped = metric ? heightCm.trim() !== '' : feet.trim() !== '' || inches.trim() !== '';
  const ageNum = intOrNull(age);

  // Bands live in `@macrolog/core/profile-bounds`, not here: onboarding's body
  // step asks the same two questions since F1/F2, and `firestore.rules` spells
  // the same numbers out a third time. A client band looser than the server's
  // is a write that vanishes; tighter is a value the user cannot enter for no
  // stated reason.
  const heightValid = isPlausibleHeightIn(heightIn);
  const ageValid = isPlausibleAge(ageNum);

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
    // Computed ahead of the write rather than inside a `try`: the React
    // Compiler skips a component with a conditional inside a try/catch, and
    // nothing here can throw (pure math that returns null on bad input).
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
    })
      .then(() => {
        // Drop any remembered "no" so a future window is free to suggest that
        // bucket again.
        if (accepting) accept();
        haptics.success();
        leave();
      })
      .catch(() => {
        setError(t('refine.saveErr'));
        setBusy(false);
      });
  }

  // The pace as the user reads it: their weight unit, their decimal separator
  // ("0,23 kg/sem", "0.50 lb/wk"). It printed `toFixed(2)` under a hardcoded
  // "lb" to every user until S21-6. The stepper still moves in quarter-pounds —
  // that is what is stored — only the display converts.
  const paceText = (lb: number) =>
    `${formatNumber(metric ? lbToKg(lb) : lb, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${bodyWeightUnit(unitSystem)}/${t('body.perWeek')}`;

  // The header is the shared native one (root `_layout.tsx`, S21-9).
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {/* `automaticOffset`: the view now sits under a native header, and the
          library measures where it is on screen rather than assuming the top. */}
      <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.fill}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>{t('refine.subtitle')}</Text>

          <View style={styles.field}>
            <Text style={styles.label} accessibilityRole="header">{t('refine.sex')}</Text>
            <View style={styles.segment}>
              {(['male', 'female'] as Sex[]).map((s) => {
                const on = sex === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.segBtn, on && styles.segBtnOn]}
                    onPress={() => { haptics.tap(); setSex(s); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    testID={`refine-sex-${s}`}
                  >
                    <Text style={[styles.segText, on && styles.segTextOn]}>{s === 'male' ? t('refine.male') : t('refine.female')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label} accessibilityRole="header">{t('refine.height')}</Text>
            {metric ? (
              <View style={styles.row}>
                <View style={styles.unitInput}>
                  <TextInput style={styles.input} placeholder="175" placeholderTextColor={colors.faint} keyboardType="numeric" value={heightCm} onChangeText={setHeightCm} maxLength={5} accessibilityLabel={t('onboarding.heightCm')} testID="refine-height-cm" />
                  <Text style={styles.unit}>{measureUnit('metric')}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <View style={styles.unitInput}>
                  <TextInput style={styles.input} placeholder="5" placeholderTextColor={colors.faint} keyboardType="numeric" value={feet} onChangeText={setFeet} accessibilityLabel={t('refine.feet')} testID="refine-feet" />
                  <Text style={styles.unit}>{t('refine.feet')}</Text>
                </View>
                <View style={styles.unitInput}>
                  <TextInput style={styles.input} placeholder="10" placeholderTextColor={colors.faint} keyboardType="numeric" value={inches} onChangeText={setInches} accessibilityLabel={t('refine.inches')} testID="refine-inches" />
                  <Text style={styles.unit}>{t('refine.inches')}</Text>
                </View>
              </View>
            )}
            {heightTyped && !heightValid ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="refine-height-error">
                {t('onboarding.heightRange', heightBandFor(unitSystem, { ft: t('refine.feet'), in: t('refine.inches') }))}
              </Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label} accessibilityRole="header">{t('refine.age')}</Text>
            <TextInput style={[styles.input, styles.ageInput]} placeholder="30" placeholderTextColor={colors.faint} keyboardType="numeric" value={age} onChangeText={setAge} accessibilityLabel={t('refine.age')} testID="refine-age" />
          </View>

          <View style={styles.field}>
            <Text style={styles.label} accessibilityRole="header">{t('refine.activity')}</Text>
            <View style={styles.activityCol}>
              {ACTIVITY.map((a) => {
                const on = selected === a.value;
                return (
                  <TouchableOpacity
                    key={a.value}
                    style={[styles.activityRow, on && styles.activityRowOn]}
                    onPress={() => chooseActivity(a.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
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
                <Touchable
                  style={styles.healthBtn}
                  onPress={async () => { haptics.tap(); await connect(); }}
                  disabled={connecting}
                  accessibilityRole="button"
                  accessibilityLabel={t('refine.activityConnectCta')}
                  accessibilityState={{ disabled: connecting, busy: connecting }}
                  testID="refine-activity-connect-cta"
                >
                  {connecting ? (
                    <ActivityIndicator color={colors.onInk} />
                  ) : (
                    <Text style={styles.healthBtnText}>{t('refine.activityConnectCta')}</Text>
                  )}
                </Touchable>
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
            <Text style={styles.label} accessibilityRole="header">{t('refine.pace')}</Text>
            <View style={styles.paceRow}>
              <TouchableOpacity style={styles.step} onPress={() => setPace((p) => Math.max(0, Math.round((p - 0.25) * 100) / 100))} accessibilityRole="button" accessibilityLabel={t('settings.stepLower', { what: t('refine.pace') })} testID="refine-pace-minus">
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.paceValue} testID="refine-pace">
                {pace === 0 ? t('refine.maintain') : paceText(pace)}
              </Text>
              <TouchableOpacity style={styles.step} onPress={() => setPace((p) => Math.min(2, Math.round((p + 0.25) * 100) / 100))} accessibilityRole="button" accessibilityLabel={t('settings.stepRaise', { what: t('refine.pace') })} testID="refine-pace-plus">
                <Text style={styles.stepText}>+</Text>
              </TouchableOpacity>
            </View>
            {paceLimit ? (
              <Text style={styles.paceNote} testID="refine-pace-floor">
                {paceLimit.effectivePace > 0
                  ? t('refine.paceFloorCapped', {
                      floor: formatNumber(paceLimit.floor, locale),
                      pace: paceText(paceLimit.effectivePace),
                    })
                  : t('refine.paceFloorNoDeficit', {
                      floor: formatNumber(paceLimit.floor, locale),
                      maintenance: formatNumber(paceLimit.maintenance, locale),
                    })}
              </Text>
            ) : null}
          </View>

          {error ? (
            <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="refine-error">
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Touchable
            style={[styles.save, !canSave && styles.saveDisabled]}
            onPress={onSave}
            disabled={!canSave}
            accessibilityRole="button"
            // Named while the label is swapped for a spinner, too.
            accessibilityLabel={t('refine.save')}
            accessibilityState={{ disabled: !canSave, busy }}
            testID="refine-save"
          >
            {busy ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.saveText}>{t('refine.save')}</Text>}
          </Touchable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  body: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl, gap: space.lg },
  subtitle: { fontSize: font.body, color: colors.muted, marginTop: space.xs },
  field: { gap: space.xs },
  label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  segment: { flexDirection: 'row', gap: space.sm },
  segBtn: { flex: 1, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingVertical: space.md, alignItems: 'center', backgroundColor: colors.inputBg },
  segBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontSize: font.body, color: colors.muted, fontWeight: '600' },
  segTextOn: { color: colors.onInk },
  row: { flexDirection: 'row', gap: space.md },
  unitInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    // `lineStrong`: a field's edge is a control boundary (WCAG 1.4.11, 3:1) —
    // `line` measured 1.26:1 (S21-6).
    borderColor: colors.lineStrong,
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
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.inputBg,
  },
  activityRowOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  hint: { fontSize: font.small, color: colors.muted, marginTop: space.xs },
  healthPrompt: { marginTop: space.xs, gap: space.sm, alignItems: 'flex-start' },
  // 48 tall — it was ~33 (S21-6); 44pt iOS / 48dp Android is the floor, and
  // one number clears both.
  healthBtn: { backgroundColor: colors.ink, borderRadius: radius.md, minHeight: 48, justifyContent: 'center', paddingHorizontal: space.lg, minWidth: 140, alignItems: 'center' },
  healthBtnText: { color: colors.onInk, fontSize: font.small, fontWeight: '700' },
  activityText: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  activityTextOn: { color: colors.onInk },
  paceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: TARGET, height: TARGET, borderRadius: TARGET / 2, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg },
  stepText: { fontSize: font.h2, color: colors.ink, fontWeight: '700' },
  paceValue: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  paceNote: { fontSize: font.small, color: colors.ink, marginTop: space.sm },
  error: { color: colors.danger, fontSize: font.small },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  save: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
