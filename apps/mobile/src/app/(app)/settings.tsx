import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { UnitSystem } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { setUnitSystem } from '@/lib/ledger';
import { DEFAULT_REMINDER_HOUR, getReminder, setReminder } from '@/lib/reminders';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

/** "8 PM" / "12 PM" / "12 AM" from a 0–23 hour. */
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

const GOAL_LABEL: Record<string, string> = {
  lose: 'Lose fat',
  maintain: 'Maintain',
  gain: 'Build',
};

export default function Settings() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [savingUnit, setSavingUnit] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(DEFAULT_REMINDER_HOUR);

  useEffect(() => {
    getReminder().then((r) => {
      setReminderEnabled(r.enabled);
      setReminderHour(r.hour);
    });
  }, []);

  async function toggleReminder(next: boolean) {
    haptics.tap();
    const applied = await setReminder(next, reminderHour);
    setReminderEnabled(applied);
  }

  async function bumpReminderHour(delta: number) {
    const next = (reminderHour + delta + 24) % 24;
    setReminderHour(next);
    if (reminderEnabled) await setReminder(true, next);
  }

  const unit: UnitSystem = profile?.unitSystem ?? 'us';
  const kcal = profile?.manualCaloriesTarget;
  const protein = profile?.manualProteinTarget;
  const goal = profile?.goalDirection ? GOAL_LABEL[profile.goalDirection] : null;

  async function pickUnit(next: UnitSystem) {
    if (next === unit || !user || savingUnit) return;
    haptics.tap();
    setSavingUnit(true);
    try {
      await setUnitSystem(user.uid, next);
    } finally {
      setSavingUnit(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="settings-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Goals</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.rowLabel}>Daily targets</Text>
              <Text style={styles.rowValue}>
                {kcal != null ? `${kcal.toLocaleString()} kcal` : '—'}
                {protein != null ? `  ·  ${protein}g protein` : ''}
              </Text>
              {goal ? <Text style={styles.rowSub}>Goal: {goal}</Text> : null}
            </View>
          </View>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => router.push('/onboarding')}
            testID="settings-edit-goals"
          >
            <Text style={styles.editBtnText}>Edit goals</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>Units</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>Portion display</Text>
          <View style={styles.segment}>
            {(['us', 'metric'] as UnitSystem[]).map((u) => {
              const on = unit === u;
              return (
                <TouchableOpacity
                  key={u}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                  onPress={() => pickUnit(u)}
                  testID={`settings-unit-${u}`}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                    {u === 'us' ? 'US (oz, lb)' : 'Metric (g, kg)'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.section}>Reminders</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Daily reminder</Text>
              <Text style={styles.rowValue}>Nudge to log your meals</Text>
            </View>
            <Switch
              value={reminderEnabled}
              onValueChange={toggleReminder}
              trackColor={{ true: colors.ink, false: colors.line }}
              testID="reminder-toggle"
            />
          </View>
          {reminderEnabled ? (
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Time</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.step} onPress={() => bumpReminderHour(-1)} testID="reminder-hour-minus">
                  <Text style={styles.stepText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.hourValue} testID="reminder-hour">{hourLabel(reminderHour)}</Text>
                <TouchableOpacity style={styles.step} onPress={() => bumpReminderHour(1)} testID="reminder-hour-plus">
                  <Text style={styles.stepText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.section}>Account</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>Signed in as</Text>
            <Text style={styles.rowValueRight}>{user?.email ?? '—'}</Text>
          </View>
          <TouchableOpacity style={styles.signOut} onPress={signOut} testID="settings-signout">
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  title: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '800', color: colors.ink },
  headerSpacer: { width: 26 },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.sm },
  section: {
    fontSize: font.small,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.md,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  rowValue: { fontSize: font.body, color: colors.muted, marginTop: 2 },
  rowValueRight: { fontSize: font.body, color: colors.muted, maxWidth: '60%', textAlign: 'right' },
  rowSub: { fontSize: font.small, color: colors.faint, marginTop: 2 },
  editBtn: {
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  editBtnText: { color: colors.ink, fontWeight: '700', fontSize: font.body },
  segment: { flexDirection: 'row', gap: space.sm },
  segmentBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  segmentBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segmentText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  segmentTextOn: { color: colors.white },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white,
  },
  stepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  hourValue: { fontSize: font.body, color: colors.ink, fontWeight: '700', minWidth: 56, textAlign: 'center' },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center' },
  signOutText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
});
