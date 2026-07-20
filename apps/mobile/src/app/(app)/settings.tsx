import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { type ImportParseError, type ImportParseResult, type UnitSystem, parseImportCsv } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { useDailyTargets } from '@/hooks/useDailyTargets';
import { importLogs, setCalorieFloor, setPreferredLocale, setUnitSystem, setWeeklyDigestOptIn } from '@/lib/ledger';
import { exportDataCsv } from '@/lib/dataExport';
import { deleteAccountForever } from '@/lib/deleteAccount';
import { isTipIapAvailable } from '@/lib/purchases';
import { TipSheet } from '@/components/TipSheet';
import { useHealthSync } from '@/lib/health-sync';
import { useSubscription, PRO_ENABLED } from '@/lib/subscription';
import { DEFAULT_REMINDER_HOUR, getReminder, setReminder, syncReminders } from '@/lib/reminders';
import { type I18nKey, type Locale, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** "8 PM" / "12 PM" / "12 AM" from a 0–23 hour. */
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

const GOAL_LABEL: Record<string, I18nKey> = {
  lose: 'goalShort.lose',
  maintain: 'goalShort.maintain',
  gain: 'goalShort.gain',
};

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es-PR', label: 'Español' },
];

// Calorie-floor stepper bounds (kcal). Kept in sync with the PWA settings.
const CALORIE_FLOOR_MIN = 1200;
const CALORIE_FLOOR_MAX = 3000;
const DEFAULT_CALORIE_FLOOR = 1500;

const IMPORT_ERR_KEY: Record<ImportParseError, I18nKey> = {
  'empty-file': 'settings.importErrEmpty',
  'no-header-match': 'settings.importErrHeader',
  'no-rows': 'settings.importErrRows',
};

/** Read a picked CSV's text cross-platform: fetch a blob URL on web, the
 *  expo-file-system File API on device. */
async function readCsvText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return res.text();
  }
  const { File } = await import('expo-file-system');
  return new File(uri).text();
}

export default function Settings() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors, preference, setPreference } = useTheme();
  const locale = useLocale();
  const { user, profile, signOut } = useAuth();
  const { isPro, proPreview, setProPreview } = useSubscription();
  const targets = useDailyTargets();
  const router = useRouter();
  const [savingUnit, setSavingUnit] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(DEFAULT_REMINDER_HOUR);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  /** Two-step confirm, then delete in-app (Apple 5.1.1(v)). The callable
   *  cascades Firestore + Storage + the Auth user; deleting the Auth user
   *  invalidates our token, so we sign out locally either way and let the
   *  root AuthGate return to the sign-in screen. */
  function confirmDeleteAccount() {
    if (deleting) return;
    haptics.tap();
    Alert.alert(t('settings.deleteAccount'), t('settings.deleteConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.deleteConfirmCta'),
        style: 'destructive',
        onPress: () => {
          Alert.alert(t('settings.deleteFinalTitle'), t('settings.deleteFinalBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.deleteFinalCta'), style: 'destructive', onPress: runDeleteAccount },
          ]);
        },
      },
    ]);
  }

  async function runDeleteAccount() {
    setDeleting(true);
    try {
      await deleteAccountForever();
    } catch (e) {
      setDeleting(false);
      Alert.alert(t('settings.deleteAccount'), t('settings.deleteFailed'));
      console.warn('deleteAccount failed', e);
      return;
    }
    try {
      await signOut();
    } catch {
      // The Auth user is already gone; a failed local sign-out is not fatal.
    }
    setDeleting(false);
  }

  async function onExport() {
    if (!user || exporting) return;
    haptics.tap();
    setExporting(true);
    setExportMsg(null);
    try {
      const { rows } = await exportDataCsv(user.uid);
      setExportMsg(t('settings.exportDone', { n: rows }));
    } catch {
      setExportMsg(t('settings.exportError'));
    } finally {
      setExporting(false);
    }
  }

  const [importPreview, setImportPreview] = useState<ImportParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function pickImport() {
    haptics.tap();
    setImportMsg(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', '*/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    try {
      const text = await readCsvText(res.assets[0].uri);
      const parsed = parseImportCsv(text);
      if (!parsed.ok) {
        setImportMsg(t(IMPORT_ERR_KEY[parsed.error]));
        return;
      }
      setImportPreview(parsed.result);
    } catch {
      setImportMsg(t('settings.importErrGeneric'));
    }
  }

  async function confirmImport() {
    if (!user || !importPreview || importing) return;
    setImporting(true);
    try {
      const n = await importLogs(user.uid, importPreview.entries);
      setImportPreview(null);
      setImportMsg(t('settings.importDone', { n }));
    } catch {
      setImportMsg(t('settings.importErrGeneric'));
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    getReminder().then((r) => {
      setReminderEnabled(r.enabled);
      setReminderHour(r.hour);
    });
  }, []);

  // Settings has no live streak/weigh-in state, so it schedules the baseline
  // (meal windows) immediately; the smart streak/weigh-in nudges fill in on the
  // next Today focus via useReminderSync.
  const NEUTRAL_STATE = { loggedToday: false, streak: 0, daysSinceWeighIn: null };

  async function toggleReminder(next: boolean) {
    haptics.tap();
    const applied = await setReminder(next, reminderHour);
    setReminderEnabled(applied);
    if (applied) await syncReminders(NEUTRAL_STATE, t);
  }

  async function bumpReminderHour(delta: number) {
    const next = (reminderHour + delta + 24) % 24;
    setReminderHour(next);
    if (reminderEnabled) {
      await setReminder(true, next);
      await syncReminders(NEUTRAL_STATE, t);
    }
  }

  // Calorie floor (kcal safety clamp). Seeded from the profile (1500 default
  // when unset); each ± step persists to Firestore. Bounds match the PWA.
  const calorieFloor = profile?.calorieFloor ?? DEFAULT_CALORIE_FLOOR;
  async function bumpCalorieFloor(delta: number) {
    if (!user) return;
    const next = Math.max(CALORIE_FLOOR_MIN, Math.min(CALORIE_FLOOR_MAX, calorieFloor + delta));
    if (next === calorieFloor) return;
    haptics.tap();
    await setCalorieFloor(user.uid, next);
  }

  const unit: UnitSystem = profile?.unitSystem ?? 'us';
  // Effective targets (TDEE chain), not the raw manual field — the latter is
  // deleted once the user refines into formula mode.
  const kcal = targets.calorieTarget > 0 ? targets.calorieTarget : null;
  const protein = targets.proteinTarget > 0 ? targets.proteinTarget : null;
  const goalKey = profile?.goalDirection ? GOAL_LABEL[profile.goalDirection] : null;

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

  async function pickLanguage(next: Locale) {
    if (next === locale || !user) return;
    haptics.tap();
    await setPreferredLocale(user.uid, next);
  }

  async function toggleDigest(next: boolean) {
    if (!user) return;
    haptics.tap();
    await setWeeklyDigestOptIn(user.uid, next);
  }

  const healthSync = useHealthSync(user?.uid);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  async function toggleHealth(next: boolean) {
    haptics.tap();
    if (next) {
      const ok = await healthSync.connect();
      setHealthMsg(ok ? t('settings.healthConnected') : t('settings.healthDenied'));
    } else {
      await healthSync.disconnect();
      setHealthMsg(null);
    }
  }
  async function onHealthSyncNow() {
    haptics.tap();
    const n = await healthSync.syncNow();
    setHealthMsg(t('settings.healthSynced', { n }));
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="settings-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('nav.settings')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{t('settings.goals')}</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.rowLabel}>{t('settings.dailyTargets')}</Text>
              <Text style={styles.rowValue}>
                {kcal != null ? `${kcal.toLocaleString()} ${t('settings.kcalUnit')}` : '—'}
                {protein != null ? `  ·  ${protein}${t('settings.proteinUnit')}` : ''}
              </Text>
              {goalKey ? <Text style={styles.rowSub}>{t('settings.goalPrefix', { goal: t(goalKey) })}</Text> : null}
            </View>
          </View>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => router.push('/onboarding')}
            testID="settings-edit-goals"
          >
            <Text style={styles.editBtnText}>{t('settings.editGoals')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.refineRow}
            onPress={() => router.push('/refine-targets')}
            testID="settings-refine"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.refine')}</Text>
              <Text style={styles.rowValue}>{t('settings.refineSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </TouchableOpacity>
        </View>

        {PRO_ENABLED ? (
        <>
        <Text style={styles.section}>{t('pro.title')}</Text>
        <View style={styles.card}>
          {isPro ? (
            <View style={styles.proActiveRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.good} />
              <Text style={styles.proActive}>{t('pro.active')}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.rowValue}>{t('pro.desc')}</Text>
              <View style={styles.proFeatures}>
                {[t('pro.featHistory'), t('pro.featLimits'), t('pro.featThemes'), t('pro.featTrends')].map((f) => (
                  <View key={f} style={styles.proFeatRow}>
                    <Ionicons name="checkmark" size={15} color={colors.accent} />
                    <Text style={styles.proFeat}>{f}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity style={[styles.exportBtn, styles.proUnlockBtn]} disabled testID="pro-unlock">
                <Ionicons name="lock-open-outline" size={16} color={colors.onInk} />
                <Text style={styles.exportBtnText}>{t('pro.unlock')} · {t('pro.unlockSoon')}</Text>
              </TouchableOpacity>
            </>
          )}
          <View style={styles.importDivider} />
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('pro.preview')}</Text>
              <Text style={styles.rowValue}>{t('pro.previewSub')}</Text>
            </View>
            <Switch
              value={proPreview}
              onValueChange={(v) => setProPreview(v)}
              trackColor={{ true: colors.tealSolid, false: colors.line }}
              testID="pro-preview-toggle"
            />
          </View>
        </View>
        </>
        ) : null}


        {/* Tips (ADR-0015). App Review 3.1.1 (submission fe0a9963): a tip tied to
            a digital app must use In-App Purchase, not an external link — so on a
            native iOS build we open the IAP TipSheet. Android (and Expo Go) keep
            the external, no-cut altruistic link, which Play permits.
            TODO: swap the placeholder URL for the real Stripe Payment Link. */}
        <Text style={styles.section}>{t('settings.support')}</Text>
        <View style={styles.card}>
          <Text style={styles.rowValue}>{t('settings.supportBody')}</Text>
          <TouchableOpacity
            style={[styles.exportBtn, { marginTop: space.md }]}
            onPress={() =>
              isTipIapAvailable()
                ? setShowTip(true)
                : Linking.openURL('https://ignia.fit/tip')
            }
            testID="settings-support"
          >
            <Ionicons name="heart-outline" size={16} color={colors.onInk} />
            <Text style={styles.exportBtnText}>{t('settings.supportBtn')}</Text>
          </TouchableOpacity>
        </View>
        <TipSheet visible={showTip} onClose={() => setShowTip(false)} />

        {/* Legal — Apple 5.1.1(i) requires the privacy policy to be reachable
            inside the app, and 1.4.1 wants a medical disclaimer on a health
            app. The Open Food Facts credit satisfies ODbL attribution (5.2.2). */}
        <Text style={styles.section}>{t('settings.legal')}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://ignia.fit/privacy')}
            testID="settings-privacy"
          >
            <Text style={styles.rowLabel}>{t('settings.privacyPolicy')}</Text>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://ignia.fit/terms')}
            testID="settings-terms"
          >
            <Text style={styles.rowLabel}>{t('settings.termsOfUse')}</Text>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://ignia.fit/support')}
            testID="settings-help"
          >
            <Text style={styles.rowLabel}>{t('settings.supportHelp')}</Text>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </TouchableOpacity>
          <Text style={styles.legalNote}>{t('settings.medicalDisclaimer')}</Text>
          <Text style={styles.legalNote}>{t('settings.dataCredit')}</Text>
        </View>

        <Text style={styles.section}>{t('settings.units')}</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.portionDisplay')}</Text>
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
                    {u === 'us' ? t('settings.unitUs') : t('settings.unitMetric')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.section}>{t('settings.appearance')}</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.theme')}</Text>
          <View style={styles.segment}>
            {(
              [
                { value: 'system', labelKey: 'settings.themeSystem' },
                { value: 'light', labelKey: 'settings.themeLight' },
                { value: 'dark', labelKey: 'settings.themeDark' },
              ] as const
            ).map((opt) => {
              const on = preference === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                  onPress={() => {
                    haptics.tap();
                    setPreference(opt.value);
                  }}
                  testID={`settings-theme-${opt.value}`}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{t(opt.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.section}>{t('settings.language')}</Text>
        <View style={styles.card}>
          <View style={styles.segment}>
            {LANGUAGES.map((l) => {
              const on = locale === l.value;
              return (
                <TouchableOpacity
                  key={l.value}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                  onPress={() => pickLanguage(l.value)}
                  testID={`settings-lang-${l.value}`}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{l.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.section}>{t('settings.reminders')}</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.dailyReminder')}</Text>
              <Text style={styles.rowValue}>{t('settings.reminderSub')}</Text>
            </View>
            <Switch
              value={reminderEnabled}
              onValueChange={toggleReminder}
              trackColor={{ true: colors.tealSolid, false: colors.line }}
              testID="reminder-toggle"
            />
          </View>
          {reminderEnabled ? (
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>{t('settings.time')}</Text>
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
          {reminderEnabled ? (
            <Text style={styles.rowValue}>{t('settings.reminderTimeHint')}</Text>
          ) : null}

          <View style={styles.digestRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.weeklyDigest')}</Text>
              <Text style={styles.rowValue}>{t('settings.weeklyDigestSub')}</Text>
            </View>
            <Switch
              value={!!profile?.weeklyDigestOptIn}
              onValueChange={toggleDigest}
              trackColor={{ true: colors.tealSolid, false: colors.line }}
              testID="digest-toggle"
            />
          </View>
        </View>

        {healthSync.available ? (
          <>
            <Text style={styles.section}>{t('settings.healthSection')}</Text>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>
                    {Platform.OS === 'ios' ? t('settings.healthConnectIos') : t('settings.healthConnectAndroid')}
                  </Text>
                  <Text style={styles.rowValue}>{t('settings.healthSub')}</Text>
                </View>
                <Switch
                  value={healthSync.connected}
                  onValueChange={toggleHealth}
                  trackColor={{ true: colors.tealSolid, false: colors.line }}
                  testID="health-toggle"
                />
              </View>
              {healthSync.connected ? (
                <View style={styles.digestRow}>
                  <Text style={styles.rowValue}>{t('settings.healthSyncHint')}</Text>
                  <TouchableOpacity
                    onPress={onHealthSyncNow}
                    disabled={healthSync.syncing}
                    style={[styles.exportBtn, healthSync.syncing && styles.exportBtnDisabled]}
                    testID="health-sync-now"
                  >
                    <Text style={styles.exportBtnText}>
                      {healthSync.syncing ? t('common.saving') : t('settings.healthSyncNow')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {healthMsg ? <Text style={styles.exportMsg}>{healthMsg}</Text> : null}
            </View>
          </>
        ) : null}

        <Text style={styles.section}>{t('settings.calorieFloorSection')}</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.calorieFloor')}</Text>
              <Text style={styles.rowValue}>{t('settings.calorieFloorSub')}</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.step, calorieFloor <= CALORIE_FLOOR_MIN && { opacity: 0.4 }]}
                disabled={calorieFloor <= CALORIE_FLOOR_MIN}
                onPress={() => bumpCalorieFloor(-50)}
                testID="calorie-floor-minus"
              >
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.hourValue} testID="calorie-floor">{calorieFloor}</Text>
              <TouchableOpacity
                style={[styles.step, calorieFloor >= CALORIE_FLOOR_MAX && { opacity: 0.4 }]}
                disabled={calorieFloor >= CALORIE_FLOOR_MAX}
                onPress={() => bumpCalorieFloor(50)}
                testID="calorie-floor-plus"
              >
                <Text style={styles.stepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.section}>{t('settings.data')}</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.exportTitle')}</Text>
              <Text style={styles.rowValue}>{t('settings.exportSub')}</Text>
            </View>
            <TouchableOpacity
              style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
              onPress={onExport}
              disabled={exporting}
              testID="settings-export"
            >
              <Ionicons name="download-outline" size={16} color={colors.onInk} />
              <Text style={styles.exportBtnText}>
                {exporting ? t('settings.exportPreparing') : t('settings.exportButton')}
              </Text>
            </TouchableOpacity>
          </View>
          {exportMsg ? <Text style={styles.exportMsg}>{exportMsg}</Text> : null}

          <View style={styles.importDivider} />
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.importTitle')}</Text>
              <Text style={styles.rowValue}>{t('settings.importSub')}</Text>
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={pickImport} testID="settings-import">
              <Ionicons name="cloud-upload-outline" size={16} color={colors.onInk} />
              <Text style={styles.exportBtnText}>{t('settings.importButton')}</Text>
            </TouchableOpacity>
          </View>
          {importPreview ? (
            <View style={styles.importPreview}>
              <Text style={styles.rowLabel}>
                {t('settings.importPreview', {
                  n: importPreview.entries.length,
                  from: importPreview.firstDate ?? '?',
                  to: importPreview.lastDate ?? '?',
                })}
              </Text>
              {importPreview.skipped > 0 ? (
                <Text style={styles.rowValue}>{t('settings.importSkipped', { n: importPreview.skipped })}</Text>
              ) : null}
              <Text style={[styles.rowValue, { color: colors.accent }]}>{t('settings.importDupWarning')}</Text>
              <View style={styles.importActions}>
                <TouchableOpacity
                  style={[styles.exportBtn, importing && styles.exportBtnDisabled]}
                  onPress={confirmImport}
                  disabled={importing}
                  testID="settings-import-confirm"
                >
                  <Text style={styles.exportBtnText}>
                    {importing ? t('settings.importImporting') : t('settings.importConfirm')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setImportPreview(null)} disabled={importing}>
                  <Text style={styles.importCancel}>{t('settings.importCancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          {importMsg ? <Text style={styles.exportMsg}>{importMsg}</Text> : null}
        </View>

        <Text style={styles.section}>{t('settings.account')}</Text>
        <View style={styles.card}>
          {/* Email on its own line, single-line + middle-ellipsis — a long
              address wrapped mid-word ("…@gm\nail.com") before. */}
          <View style={styles.accountHead}>
            <Text style={styles.rowLabel}>{t('settings.signedInAs')}</Text>
            <Text style={styles.accountEmail} numberOfLines={1} ellipsizeMode="middle">
              {user?.email ?? '—'}
            </Text>
          </View>
          <TouchableOpacity style={styles.signOut} onPress={signOut} testID="settings-signout">
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>
          <View style={styles.deleteDivider} />
          {/* Deletion runs IN-APP (Apple 5.1.1(v)) — this used to open the web
              privacy page, which does not satisfy the guideline. */}
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={confirmDeleteAccount}
            disabled={deleting}
            testID="settings-delete-account"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.deleteLabel}>{t('settings.deleteAccount')}</Text>
              <Text style={styles.rowValue}>
                {deleting ? t('settings.deleteAccountBusy') : t('settings.deleteAccountSub')}
              </Text>
            </View>
            {deleting ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
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
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
  legalNote: { fontSize: font.tiny, color: colors.muted, marginTop: space.sm, lineHeight: font.tiny * 1.5 },
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
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  exportBtnDisabled: { opacity: 0.5 },
  exportBtnText: { color: colors.onInk, fontWeight: '700', fontSize: font.small },
  exportMsg: { fontSize: font.small, color: colors.muted, marginTop: space.sm },
  proActiveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  proActive: { fontSize: font.body, color: colors.good, fontWeight: '700' },
  proFeatures: { gap: space.xs, marginTop: space.sm },
  proFeatRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  proFeat: { fontSize: font.small, color: colors.ink },
  proUnlockBtn: { marginTop: space.md, alignSelf: 'flex-start', opacity: 0.6 },
  importDivider: { height: 1, backgroundColor: colors.line, marginVertical: space.md },
  importPreview: { marginTop: space.sm, gap: space.xs, backgroundColor: colors.paper, borderRadius: radius.md, padding: space.md },
  importActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
  importCancel: { fontSize: font.body, color: colors.muted, fontWeight: '700' },
  refineRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  digestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  segment: { flexDirection: 'row', gap: space.sm },
  segmentBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  segmentBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segmentText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  segmentTextOn: { color: colors.onInk },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg,
  },
  stepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  hourValue: { fontSize: font.body, color: colors.ink, fontWeight: '700', minWidth: 56, textAlign: 'center' },
  accountHead: { gap: 2, marginBottom: space.md },
  accountEmail: { fontSize: font.small, color: colors.muted },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'flex-start' },
  signOutText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  deleteDivider: { height: 1, backgroundColor: colors.line, marginVertical: space.md },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  deleteLabel: { fontSize: font.body, color: colors.danger, fontWeight: '600' },
});
