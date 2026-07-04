import { Ionicons } from '@expo/vector-icons';
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
import type { ActivityLevel, Sex } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { saveRefinedTargets } from '@/lib/ledger';
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

  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [feet, setFeet] = useState(profile?.heightIn ? String(Math.floor(profile.heightIn / 12)) : '');
  const [inches, setInches] = useState(profile?.heightIn ? String(profile.heightIn % 12) : '');
  const [age, setAge] = useState(profile?.age != null ? String(profile.age) : '');
  const [activity, setActivity] = useState<ActivityLevel | null>(profile?.activityLevel ?? null);
  const [pace, setPace] = useState<number>(profile?.targetPaceLbsPerWeek ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ft = intOrNull(feet);
  const inch = intOrNull(inches);
  const heightIn = ft != null && inch != null ? ft * 12 + inch : null;
  const ageNum = intOrNull(age);

  const heightValid = heightIn != null && heightIn >= 40 && heightIn <= 96;
  const ageValid = ageNum != null && ageNum >= 13 && ageNum <= 120;
  const canSave = sex != null && heightValid && ageValid && activity != null && !busy;

  async function onSave() {
    if (!canSave || !user || sex == null || heightIn == null || ageNum == null || activity == null) return;
    setError(null);
    setBusy(true);
    try {
      await saveRefinedTargets(user.uid, {
        heightIn,
        age: ageNum,
        sex,
        activityLevel: activity,
        targetPaceLbsPerWeek: pace,
      });
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
                const on = activity === a.value;
                return (
                  <TouchableOpacity
                    key={a.value}
                    style={[styles.activityRow, on && styles.activityRowOn]}
                    onPress={() => { haptics.tap(); setActivity(a.value); }}
                    testID={`refine-activity-${a.value}`}
                  >
                    <Text style={[styles.activityText, on && styles.activityTextOn]}>{t(a.labelKey)}</Text>
                    {on ? <Ionicons name="checkmark" size={18} color={colors.onInk} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
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
  activityText: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  activityTextOn: { color: colors.onInk },
  paceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg },
  stepText: { fontSize: font.h2, color: colors.ink, fontWeight: '700' },
  paceValue: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  error: { color: colors.danger, fontSize: font.small },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  save: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: colors.onInk, fontWeight: '700', fontSize: font.h3 },
});
