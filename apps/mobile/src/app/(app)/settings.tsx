import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { type ImportParseError, type ImportParseResult, type UnitSystem, parseImportCsv } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { useDailyTargets } from '@/hooks/useDailyTargets';
import { importLogs, setPreferredLocale, setUnitSystem, setWeeklyDigestOptIn } from '@/lib/ledger';
import { exportDataCsv } from '@/lib/dataExport';
import { DEFAULT_REMINDER_HOUR, getReminder, setReminder } from '@/lib/reminders';
import { type I18nKey, type Locale, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { colors, font, radius, space } from '@/theme';

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
  const locale = useLocale();
  const { user, profile, signOut } = useAuth();
  const targets = useDailyTargets();
  const router = useRouter();
  const [savingUnit, setSavingUnit] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(DEFAULT_REMINDER_HOUR);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

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
              <Ionicons name="download-outline" size={16} color={colors.white} />
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
              <Ionicons name="cloud-upload-outline" size={16} color={colors.white} />
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
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>{t('settings.signedInAs')}</Text>
            <Text style={styles.rowValueRight}>{user?.email ?? '—'}</Text>
          </View>
          <TouchableOpacity style={styles.signOut} onPress={signOut} testID="settings-signout">
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </TouchableOpacity>
          <View style={styles.deleteDivider} />
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={() => Linking.openURL('https://macrolog.web.app/privacy#delete')}
            testID="settings-delete-account"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.deleteLabel}>{t('settings.deleteAccount')}</Text>
              <Text style={styles.rowValue}>{t('settings.deleteAccountSub')}</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
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
  exportBtnText: { color: colors.white, fontWeight: '700', fontSize: font.small },
  exportMsg: { fontSize: font.small, color: colors.muted, marginTop: space.sm },
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
  deleteDivider: { height: 1, backgroundColor: colors.line, marginVertical: space.md },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  deleteLabel: { fontSize: font.body, color: colors.danger, fontWeight: '600' },
});
