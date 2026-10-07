import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import {
  DEFAULT_MEAL_REMINDERS,
  MAX_DAY_START_HOUR,
  boundaryHourOn,
  dayBoundaryOf,
  dayKeyAt,
  type ImportParseError,
  type ImportParseResult,
  type MealKey,
  type MealReminderSettings,
  type UnitSystem,
  parseImportCsv,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { useDailyTargets } from '@/hooks/useDailyTargets';
import { importLogs, setCalorieFloor, setDayStartHour, setPreferredLocale, setProteinFloor, setUnitSystem, setWeeklyDigestOptIn } from '@/lib/ledger';

/**
 * The hours the segment offers (ADR-0030). 0 is "midnight" — the behaviour
 * every account has today — and the ceiling is `MAX_DAY_START_HOUR`, which is
 * 6 because past roughly 6am a "day start" begins colliding with breakfast and
 * a boundary landing mid-meal is worse than no boundary. Stepped by 1 rather
 * than offering all seven, so the control stays a segment and not a picker.
 */
const DAY_START_HOURS = [0, 3, MAX_DAY_START_HOUR] as const;
import { exportDataCsv } from '@/lib/dataExport';
import { deleteAccountForever } from '@/lib/deleteAccount';
import { isTipIapAvailable } from '@/lib/purchases';
import { FEATURES } from '@/lib/features';
import { APP_STORE_REVIEW_URL } from '@/lib/reviewPrompt';
import { openExternal } from '@/lib/open-external';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useIsOffline } from '@/lib/connectivity';
import { TipSheet } from '@/components/TipSheet';
import { QuickAddCard } from '@/components/QuickAddCard';
import { WatchDiagnosticsCard, watchDiagnosticsAvailable } from '@/components/WatchDiagnosticsCard';
import { SignInMethodsCard } from '@/components/SignInMethodsCard';
import { useSubscription, PRO_ENABLED } from '@/lib/subscription';
import {
  getReminderSettings,
  setMealReminders,
  setRemindersEnabled,
  syncReminders,
} from '@/lib/reminders';
import { LOCALES, LOCALE_DEFS, type I18nKey, type Locale, useLocale, useT } from '@/i18n';
import { formatNumber, formatTime } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';
import { Touchable } from '@/components/Touchable';

/** "8 PM" in English, "20" in pt-BR, "8 p. m." in es-PR — from a 0–23 hour.
 *  Through `formatTime` so the clock convention follows the app locale; the
 *  hand-rolled "AM"/"PM" this replaces showed English to every locale. */
function hourLabel(h: number, locale: Locale): string {
  return formatTime(new Date(2000, 0, 1, h), locale, { hour: 'numeric' });
}

const GOAL_LABEL: Record<string, I18nKey> = {
  lose: 'goalShort.lose',
  maintain: 'goalShort.maintain',
  gain: 'goalShort.gain',
};

// Derived from the i18n registry, never listed here: a language added to
// `src/i18n/registry.ts` appears in this picker with no edit to this file.
const LANGUAGES: { value: Locale; label: string }[] = LOCALES.map((value) => ({
  value,
  label: LOCALE_DEFS[value].label,
}));

// Calorie-floor stepper bounds (kcal). Kept in sync with the PWA settings.
/** The meal windows `planReminders` can schedule, in the order they occur.
 *  Every entry here is user-controllable — that's the point of the row. */
const MEAL_ROWS: { key: MealKey; labelKey: I18nKey }[] = [
  { key: 'breakfast', labelKey: 'settings.reminderBreakfast' },
  { key: 'lunch', labelKey: 'settings.reminderLunch' },
  { key: 'dinner', labelKey: 'settings.reminderDinner' },
];

const CALORIE_FLOOR_MIN = 1200;
const CALORIE_FLOOR_MAX = 3000;
const DEFAULT_CALORIE_FLOOR = 1500;
// Protein floor band. No default constant on purpose — unset means "off".
const PROTEIN_FLOOR_MIN = 80;
const PROTEIN_FLOOR_MAX = 300;

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
  const targetsView = useDailyTargets();
  const targets = targetsView.loaded ? targetsView.targets : null;
  const router = useRouter();
  // Firestore writes from this screen hang silently with no network (S18-12):
  // the SDK queues them, the segment never moves, and nothing says why. The
  // banner says why; the write controls below are disabled while it is true.
  // Theme and reminders are device-local and stay live.
  const offline = useIsOffline();
  const [savingUnit, setSavingUnit] = useState(false);
  const [savingDayStart, setSavingDayStart] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [meals, setMealsState] = useState<MealReminderSettings>(DEFAULT_MEAL_REMINDERS);
  // The current value, readable OUTSIDE the render closure. `bumpMealHour`
  // used to read `meals` from the closure it was created in, so two taps
  // inside one render (a fast double-tap on +) both computed from the same
  // starting hour and the second overwrote the first — one step lost. A ref
  // rather than a functional `setState` because the persist call must see the
  // same `next` the state does, and side effects inside an updater run twice
  // under StrictMode.
  const mealsRef = useRef<MealReminderSettings>(DEFAULT_MEAL_REMINDERS);
  function setMeals(next: MealReminderSettings) {
    mealsRef.current = next;
    setMealsState(next);
  }
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
    getReminderSettings().then((r) => {
      setReminderEnabled(r.enabled);
      setMeals(r.meals);
    });
  }, []);

  // Settings has no live streak/weigh-in state, so it schedules the baseline
  // (meal windows) immediately; the smart streak/weigh-in nudges fill in on the
  // next Today focus via useReminderSync.
  // Settings has no log data; Today's `useReminderSync` re-plans with the
  // real state on its next focus. `daysSinceLastLog: null` anchors the lapsed
  // nudges on today meanwhile, which is the safe direction (never the past).
  const NEUTRAL_STATE = { loggedToday: false, streak: 0, daysSinceWeighIn: null, daysSinceLastLog: null };

  async function toggleReminder(next: boolean) {
    haptics.tap();
    try {
      const applied = await setRemindersEnabled(next);
      setReminderEnabled(applied);
      if (applied) await syncReminders(NEUTRAL_STATE, t);
    } catch (e) {
      // Turning off could not cancel the nudges, so they are still on — and
      // `setRemindersEnabled` put the stored flag back to say so.
      setReminderEnabled(true);
      console.warn('settings: reminders off failed', e);
    }
  }

  /** Persist one meal's row and reschedule. Every edit rewrites the whole
   *  schedule because `syncReminders` cancels and re-adds the full set — there
   *  is no per-notification update path. Optimistic: the row moves at once
   *  and is put BACK if the write fails, so the screen never shows an hour
   *  the OS schedule does not hold. */
  async function applyMeals(next: MealReminderSettings) {
    const prev = mealsRef.current;
    setMeals(next);
    try {
      await setMealReminders(next);
      if (reminderEnabled) await syncReminders(NEUTRAL_STATE, t);
    } catch (e) {
      // Only roll back if nothing newer has landed meanwhile — a later tap's
      // value must not be clobbered by an earlier tap's failure.
      if (mealsRef.current === next) setMeals(prev);
      console.warn('settings: meal reminder write failed', e);
    }
  }

  async function toggleMeal(key: MealKey) {
    haptics.tap();
    const cur = mealsRef.current;
    await applyMeals({ ...cur, [key]: { ...cur[key], enabled: !cur[key].enabled } });
  }

  async function bumpMealHour(key: MealKey, delta: number) {
    const cur = mealsRef.current;
    const hour = (cur[key].hour + delta + 24) % 24;
    await applyMeals({ ...cur, [key]: { ...cur[key], hour } });
  }

  // Calorie floor (kcal safety clamp). Seeded from the profile (1500 default
  // when unset); each ± step persists to Firestore. Bounds match the PWA.
  const calorieFloor = profile?.calorieFloor ?? DEFAULT_CALORIE_FLOOR;
  const stackFloors = useWindowDimensions().fontScale >= 1.5;
  async function bumpCalorieFloor(delta: number) {
    if (!user) return;
    const next = Math.max(CALORIE_FLOOR_MIN, Math.min(CALORIE_FLOOR_MAX, calorieFloor + delta));
    if (next === calorieFloor) return;
    haptics.tap();
    await setCalorieFloor(user.uid, next);
  }

  // Protein floor (g). OPT-IN with no default: null is a real state, so an
  // untouched profile behaves exactly as it did before the field existed.
  // Enabling seeds from the user's own 1.6 g/kg minimum; stepping below the
  // band minimum clears the field. Bounds match the PWA.
  const proteinFloor = profile?.proteinFloor ?? null;
  async function bumpProteinFloor(delta: number) {
    if (!user) return;
    let next: number | null;
    if (proteinFloor == null) {
      if (delta < 0) return;
      const seed = targets?.proteinMinTarget || PROTEIN_FLOOR_MIN;
      next = Math.min(PROTEIN_FLOOR_MAX, Math.max(PROTEIN_FLOOR_MIN, seed));
    } else {
      const stepped = proteinFloor + delta;
      next = stepped < PROTEIN_FLOOR_MIN ? null : Math.min(PROTEIN_FLOOR_MAX, stepped);
    }
    if (next === proteinFloor) return;
    haptics.tap();
    await setProteinFloor(user.uid, next);
  }

  const unit: UnitSystem = profile?.unitSystem ?? 'us';
  const dayBoundary = dayBoundaryOf(profile);
  const dayStartHour = boundaryHourOn(dayKeyAt(new Date(), dayBoundary), dayBoundary);
  // Effective targets (TDEE chain), not the raw manual field — the latter is
  // deleted once the user refines into formula mode.
  // `null` while the three snapshots behind the TDEE chain are still silent or
  // have errored — the row renders its "—" rather than the 1800 kcal seed.
  const kcal = targets && targets.calorieTarget > 0 ? targets.calorieTarget : null;
  const protein = targets && targets.proteinTarget > 0 ? targets.proteinTarget : null;
  const goalKey = profile?.goalDirection ? GOAL_LABEL[profile.goalDirection] : null;

  // ADR-0030. The whole history is written, not the hour — past days keep the
  // rule they were logged under, and `setDayStartHour` in core is what refuses
  // to rewrite them. A re-pick of the hour already in force is a no-op there,
  // so this needs no "did it change" guard of its own.
  async function pickDayStart(next: number) {
    if (!user || savingDayStart) return;
    haptics.tap();
    setSavingDayStart(true);
    try {
      await setDayStartHour(user.uid, dayBoundary, next);
    } finally {
      setSavingDayStart(false);
    }
  }

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

  /** Sign-out asks first (S18-6). Not the account-deletion double `Alert` —
   *  this is reversible, so the branded sheet is the right weight. */
  function confirmSignOut() {
    haptics.tap();
    confirm({
      title: t('settings.signOut'),
      body: t('settings.signOutConfirm'),
      confirmText: t('settings.signOut'),
      destructive: true,
      onConfirm: () => {
        signOut().catch((e) => console.warn('signOut failed', e));
      },
    });
  }

  async function toggleDigest(next: boolean) {
    if (!user) return;
    haptics.tap();
    await setWeeklyDigestOptIn(user.uid, next);
  }


  // The VoiceOver name for a hidden-text Switch: what it turns on, not
  // "switch, off" (S21-2).
  const healthStore = Platform.OS === 'ios' ? t('health.storeIos') : t('health.storeAndroid');

  // ## Order (S21-4)
  //
  // What a person came to change, most-asked first; what they came to READ
  // (about, legal) after it; the account — Sign out, then Delete account — at
  // the very bottom, where every platform's settings put it and where a store
  // reviewer looks for deletion. The screen title is the native header since
  // S21-1 (root `_layout.tsx`), so a section label never repeats a row's own
  // title: a one-row section takes the heading of the GROUP it belongs to.
  //
  // Help & feedback is SECOND on purpose, against the reviewer's "near the
  // bottom": it was moved up after a user named the barrier to sending one as
  // social, not technical (UX_AUDIT, Abdiel Medina) — position is the feature.
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.bannerSlot}>
        <OfflineBanner />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* ── Profile & targets ──────────────────────────────────────────
            Three doors to one subject, each saying what it actually touches:
            the NUMBERS (Daily targets), the INPUTS behind the automatic number
            (Refine), and the whole setup from scratch (Redo). They were three
            differently-shaped controls — a row, an outlined button, a row —
            which read as three unrelated things. */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.profileTargetsSection')}</Text>
        <View style={styles.card}>
          {/* The targets row is the ENTRY POINT to the editor, not a readout.
              A user asked for a custom calorie goal and could not find one
              because there was nowhere to tap (UX_AUDIT, Abdiel Medina). The
              mode is on the row itself, so "am I on automatic?" is answered
              without opening anything. */}
          <Touchable
            style={styles.navRow}
            onPress={() => router.push('/daily-targets')}
            accessibilityRole="button"
            testID="settings-daily-targets"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.dailyTargets')}</Text>
              <Text style={styles.rowValue}>
                {t(profile?.targetMode === 'custom' ? 'targets.summaryCustom' : 'targets.summaryAuto')}
                {'  ·  '}
                {kcal != null ? `${formatNumber(kcal, locale)} ${t('settings.kcalUnit')}` : '—'}
                {/* "145 g", spaced and grouped like every other gram figure (S21 QA). */}
                {protein != null ? `  ·  ${formatNumber(protein, locale)} ${t('settings.proteinUnit')}` : ''}
              </Text>
              {goalKey ? <Text style={styles.rowSub}>{t('settings.goalPrefix', { goal: t(goalKey) })}</Text> : null}
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
          <Touchable
            style={[styles.navRow, styles.navRowDivided]}
            onPress={() => router.push('/refine-targets')}
            accessibilityRole="button"
            testID="settings-refine"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.refine')}</Text>
              <Text style={styles.rowValue}>{t('settings.refineSub')}</Text>
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
          {/* This pushes the WHOLE onboarding wizard, not a goal editor — the
              goal editor is the Daily targets row above. It was labelled "Edit
              goals" until 2026-09-04, which is how an established user ended up
              re-answering every setup question to change one number and had
              their measured target overwritten by the wizard's heuristic seed
              on the way out (the write itself is fixed in
              `toOnboardingV2Patch`; this is the label half). Last of the three,
              because it is the heaviest. */}
          <Touchable
            style={[styles.navRow, styles.navRowDivided]}
            onPress={() => router.push('/onboarding')}
            accessibilityRole="button"
            testID="settings-redo-setup"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.redoSetup')}</Text>
              <Text style={styles.rowValue}>{t('settings.redoSetupSub')}</Text>
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
        </View>

        {/* ── Help & feedback ── one section; it was three (HELP, SEND
            FEEDBACK, and the help link filed under ABOUT & HELP). The tour
            leads: someone who came here confused should meet it before the
            report box. */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.helpFeedbackSection')}</Text>
        <View style={styles.card}>
          <Touchable
            style={styles.navRow}
            onPress={() => router.push('/tour')}
            accessibilityRole="button"
            testID="settings-tour"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.tour')}</Text>
              <Text style={styles.rowValue}>{t('settings.tourSub')}</Text>
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
          <Touchable
            style={[styles.navRow, styles.navRowDivided]}
            onPress={() => router.push('/feedback')}
            accessibilityRole="button"
            testID="settings-feedback"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('feedback.settingsRow')}</Text>
              <Text style={styles.rowValue}>{t('feedback.settingsSub')}</Text>
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
          <Touchable
            style={[styles.linkRow, styles.navRowDivided]}
            onPress={() => void openExternal('https://ignia.fit/support', t)}
            accessibilityRole="link"
            accessibilityLabel={t('settings.supportHelp')}
            testID="settings-help"
          >
            <Text style={styles.rowLabel}>{t('settings.supportHelp')}</Text>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </Touchable>
          {/* A permanent, un-throttled path to the listing for users who
              *want* to leave a rating. The in-app sheet (reviewPrompt.ts)
              can only fire a handful of times per year and never on demand,
              so it can't be the only route. `write-review` opens the
              listing with the review composer already up. iOS-only until
              the Play listing is live — there is nothing to link to yet. */}
          {Platform.OS === 'ios' ? (
            <Touchable
              style={[styles.linkRow, styles.navRowDivided]}
              onPress={() => void openExternal(APP_STORE_REVIEW_URL, t)}
              accessibilityRole="link"
              testID="settings-rate"
            >
              <Text style={styles.rowLabel}>{t('settings.rateApp')}</Text>
              <Ionicons name="star-outline" size={16} color={colors.muted} />
            </Touchable>
          ) : null}
          {/* Tips (ADR-0015). App Review 3.1.1 (submission fe0a9963): a tip
              tied to a digital app must use In-App Purchase, not an external
              link — so on a native iOS build we open the IAP TipSheet. Android
              (and Expo Go) keep the external, no-cut altruistic link, which
              Play permits. Gated by FEATURES.tips (off while operations
              transfer to the LLC — see features.ts). */}
          {FEATURES.tips ? (
            <View style={styles.navRowDivided}>
              <Text style={styles.rowValue}>{t('settings.supportBody')}</Text>
              <Touchable
                style={[styles.exportBtn, styles.tipBtn]}
                onPress={() =>
                  isTipIapAvailable()
                    ? setShowTip(true)
                    : void openExternal('https://ignia.fit/tip', t)
                }
                accessibilityRole="button"
                testID="settings-support"
              >
                <Ionicons name="heart-outline" size={16} color={colors.onInk} />
                <Text style={styles.exportBtnText}>{t('settings.supportBtn')}</Text>
              </Touchable>
            </View>
          ) : null}
        </View>
        {FEATURES.tips ? (
          <TipSheet visible={showTip} onClose={() => setShowTip(false)} />
        ) : null}

        {/* ── Preferences ── how everything else is shown. */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.preferencesSection')}</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.portionDisplay')}</Text>
          <Text style={styles.rowValue}>{t('settings.portionDisplaySub')}</Text>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('settings.portionDisplay')}>
            {(['us', 'metric'] as UnitSystem[]).map((u) => {
              const on = unit === u;
              return (
                <TouchableOpacity
                  key={u}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn, offline && styles.segmentBtnOff]}
                  onPress={() => pickUnit(u)}
                  disabled={offline || savingUnit}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: offline || savingUnit }}
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

        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.theme')}</Text>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('settings.theme')}>
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
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  testID={`settings-theme-${opt.value}`}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{t(opt.labelKey)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.language')}</Text>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('settings.language')}>
            {LANGUAGES.map((l) => {
              const on = locale === l.value;
              return (
                <TouchableOpacity
                  key={l.value}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn, offline && styles.segmentBtnOff]}
                  onPress={() => pickLanguage(l.value)}
                  disabled={offline}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: offline }}
                  testID={`settings-lang-${l.value}`}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{l.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Day start sits last in Preferences: it is the rarest change here,
            and the only one that rewrites how past days are bucketed. */}
        <View style={styles.card}>
          <Text style={styles.rowLabel}>{t('settings.dayStart')}</Text>
          <Text style={styles.rowValue}>{t('settings.dayStartSub')}</Text>
          <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={t('settings.dayStart')}>
            {DAY_START_HOURS.map((h) => {
              const on = dayStartHour === h;
              return (
                <TouchableOpacity
                  key={h}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn, offline && styles.segmentBtnOff]}
                  onPress={() => pickDayStart(h)}
                  disabled={offline || savingDayStart}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: offline || savingDayStart }}
                  testID={`settings-day-start-${h}`}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                    {h === 0 ? t('settings.dayStartMidnight') : t('settings.dayStartHour', { n: h })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.rowValue}>{t('settings.dayStartNote')}</Text>
        </View>

        {/* ── Reminders ── */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.reminders')}</Text>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.dailyReminder')}</Text>
              <Text style={styles.rowValue}>{t('settings.reminderSub')}</Text>
            </View>
            <Switch
              value={reminderEnabled}
              onValueChange={toggleReminder}
              trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
              accessibilityLabel={t('settings.dailyReminder')}
              testID="reminder-toggle"
            />
          </View>
          {/* Per-meal rows. 1.0 exposed a single hour and quietly ran the
              default lunch nudge alongside it, so a 1:30pm notification had no
              off switch anywhere in the UI. Each window the planner can
              schedule now has its own toggle and time. */}
          {reminderEnabled
            ? MEAL_ROWS.map(({ key, labelKey }) => {
                const meal = t(labelKey);
                return (
                  <View key={key} style={styles.rowBetween}>
                    <Text style={styles.rowLabel}>{meal}</Text>
                    <View style={styles.mealControls}>
                      {meals[key].enabled ? (
                        <View style={styles.stepper}>
                          <TouchableOpacity
                            style={styles.step}
                            onPress={() => bumpMealHour(key, -1)}
                            accessibilityRole="button"
                            accessibilityLabel={t('settings.stepEarlier', { what: meal })}
                            testID={`reminder-${key}-hour-minus`}
                          >
                            <Text style={styles.stepText}>−</Text>
                          </TouchableOpacity>
                          <Text style={styles.hourValue} testID={`reminder-${key}-hour`}>
                            {hourLabel(meals[key].hour, locale)}
                          </Text>
                          <TouchableOpacity
                            style={styles.step}
                            onPress={() => bumpMealHour(key, 1)}
                            accessibilityRole="button"
                            accessibilityLabel={t('settings.stepLater', { what: meal })}
                            testID={`reminder-${key}-hour-plus`}
                          >
                            <Text style={styles.stepText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                      <Switch
                        value={meals[key].enabled}
                        onValueChange={() => toggleMeal(key)}
                        trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
                        accessibilityLabel={t('settings.mealReminderA11y', { what: meal })}
                        testID={`reminder-${key}-toggle`}
                      />
                    </View>
                  </View>
                );
              })
            : null}
          {reminderEnabled ? (
            <Text style={styles.rowValue}>{t('settings.reminderTimeHint')}</Text>
          ) : null}

          <View style={styles.digestRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.weeklyDigest')}</Text>
              <Text style={styles.rowValue}>{t('settings.weeklyDigestSub')}</Text>
            </View>
            <Switch
              value={!!profile?.weeklyDigestOptIn}
              onValueChange={toggleDigest}
              disabled={offline}
              trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
              accessibilityLabel={t('settings.weeklyDigest')}
              testID="digest-toggle"
            />
          </View>
        </View>

        {/* Quick add sits with the reminders above it on purpose: both are about
            logging without navigating to it. Native-only — the picker feeds a
            home-screen widget, a Quick Settings tile (Android) and Siri
            (iOS), none of which the web PWA has an analogue for (ADR-0020).

            No longer gated to Android: iOS build 26 carries the App Intents and
            the interactive widget button, so the picker's promise is true on both
            platforms. It was Android-only for exactly one release, while the iOS
            half did not exist — a setting that visibly does nothing is the same
            "merged reads as shipped" failure this repo already pays for. */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.quickAddSection')}</Text>
        <QuickAddCard />

        {/* Why the watch face is or is not current. Read straight off the live
            WCSession — the transport has four ways to fail and all four look
            identical from the wrist, so this is the only thing that turns a
            "my complication is stale" report into a diagnosis. */}
        {/* Header and card gate on the SAME exported condition. They did not,
            and Android rendered an "Apple Watch" heading over empty space. */}
        {watchDiagnosticsAvailable ? (
          <>
            <Text style={styles.section} accessibilityRole="header">{t('settings.watchSection')}</Text>
            <WatchDiagnosticsCard />
          </>
        ) : null}

        {/* ── Safety floors ── the clamps under the targets above. At large
            text the stepper drops under its description: side by side, the
            description column shrank to a word per line and split words
            mid-word (Android, font scale 2.0, 2026-10-06). */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.floorsSection')}</Text>
        <View style={styles.card}>
          <View style={stackFloors ? styles.floorStacked : styles.rowBetween}>
            <View style={stackFloors ? null : styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.calorieFloor')}</Text>
              <Text style={styles.rowValue}>{t('settings.calorieFloorSub')}</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.step, (offline || calorieFloor <= CALORIE_FLOOR_MIN) && { opacity: 0.4 }]}
                disabled={offline || calorieFloor <= CALORIE_FLOOR_MIN}
                onPress={() => bumpCalorieFloor(-50)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.stepLower', { what: t('settings.calorieFloor') })}
                accessibilityState={{ disabled: offline || calorieFloor <= CALORIE_FLOOR_MIN }}
                testID="calorie-floor-minus"
              >
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.hourValue} testID="calorie-floor">{calorieFloor}</Text>
              <TouchableOpacity
                style={[styles.step, (offline || calorieFloor >= CALORIE_FLOOR_MAX) && { opacity: 0.4 }]}
                disabled={offline || calorieFloor >= CALORIE_FLOOR_MAX}
                onPress={() => bumpCalorieFloor(50)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.stepRaise', { what: t('settings.calorieFloor') })}
                accessibilityState={{ disabled: offline || calorieFloor >= CALORIE_FLOOR_MAX }}
                testID="calorie-floor-plus"
              >
                <Text style={styles.stepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={stackFloors ? styles.floorStacked : styles.rowBetween}>
            <View style={stackFloors ? null : styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.proteinFloor')}</Text>
              <Text style={styles.rowValue}>{t('settings.proteinFloorSub')}</Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={[styles.step, (offline || proteinFloor == null) && { opacity: 0.4 }]}
                disabled={offline || proteinFloor == null}
                onPress={() => bumpProteinFloor(-5)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.stepLower', { what: t('settings.proteinFloor') })}
                accessibilityState={{ disabled: offline || proteinFloor == null }}
                testID="protein-floor-minus"
              >
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.hourValue} testID="protein-floor">
                {proteinFloor ?? t('settings.proteinFloorOff')}
              </Text>
              <TouchableOpacity
                style={[
                  styles.step,
                  (offline || (proteinFloor ?? 0) >= PROTEIN_FLOOR_MAX) && { opacity: 0.4 },
                ]}
                disabled={offline || (proteinFloor ?? 0) >= PROTEIN_FLOOR_MAX}
                onPress={() => bumpProteinFloor(5)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.stepRaise', { what: t('settings.proteinFloor') })}
                accessibilityState={{ disabled: offline || (proteinFloor ?? 0) >= PROTEIN_FLOOR_MAX }}
                testID="protein-floor-plus"
              >
                <Text style={styles.stepText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Your data ── what comes in (Connected apps), what it has added
            up to (Milestones), and the file both ways (export / import).

            Connected apps is its own SCREEN (`connected-apps.tsx`): ~85 lines
            of card used to sit here, and nothing ever told the user a link had
            worked. Its row is static, deliberately — live status here would
            mean Settings holding an Oura snapshot listener for one line of
            text, which ADR-0016 rules out. The screen one tap away shows it.

            Milestones — the retrospective record (#108/#109). Each was a
            one-row section whose heading repeated the row's own title
            ("MILESTONES" over "Milestones"); grouped here, the heading says
            what the group is instead. */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.yourDataSection')}</Text>
        <View style={styles.card}>
          <Touchable
            style={styles.navRow}
            onPress={() => router.push('/connected-apps')}
            accessibilityRole="button"
            testID="settings-connected-apps"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('settings.connectedApps')}</Text>
              {/* Names the platform's own health store first (S21-5): "Oura
                  and other services" never said Apple Health / Health Connect
                  lived behind this row, and that is the one most people want. */}
              <Text style={styles.rowValue}>{t('settings.connectedAppsSub', { store: healthStore })}</Text>
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
          <Touchable
            style={[styles.navRow, styles.navRowDivided]}
            // `as Href` because `typedRoutes` regenerates its declaration from
            // a running dev server, not from `expo export` — a route added
            // without one being started is invisible to tsc until then. Same
            // cast `trends.tsx` uses for `/coach`.
            onPress={() => router.push('/milestones' as Href)}
            accessibilityRole="button"
            testID="settings-milestones"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{t('milestones.title')}</Text>
              <Text style={styles.rowValue}>{t('milestones.settingsSub')}</Text>
            </View>
            <Ionicons importantForAccessibility="no-hide-descendants" accessibilityElementsHidden name="chevron-forward" size={18} color={colors.faint} />
          </Touchable>
        </View>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.exportTitle')}</Text>
              <Text style={styles.rowValue}>{t('settings.exportSub')}</Text>
            </View>
            <Touchable
              style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
              onPress={onExport}
              disabled={exporting}
              accessibilityRole="button"
              accessibilityLabel={exporting ? t('settings.exportPreparing') : t('settings.exportTitle')}
              accessibilityState={{ disabled: exporting, busy: exporting }}
              testID="settings-export"
            >
              <Ionicons name="download-outline" size={16} color={colors.onInk} />
              <Text style={styles.exportBtnText}>
                {exporting ? t('settings.exportPreparing') : t('settings.exportButton')}
              </Text>
            </Touchable>
          </View>
          {exportMsg ? <Text style={styles.exportMsg} accessibilityLiveRegion="polite">{exportMsg}</Text> : null}

          <View style={styles.importDivider} />
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.importTitle')}</Text>
              <Text style={styles.rowValue}>{t('settings.importSub')}</Text>
            </View>
            <Touchable
              style={styles.exportBtn}
              onPress={pickImport}
              accessibilityRole="button"
              accessibilityLabel={t('settings.importTitle')}
              testID="settings-import"
            >
              <Ionicons name="cloud-upload-outline" size={16} color={colors.onInk} />
              <Text style={styles.exportBtnText}>{t('settings.importButton')}</Text>
            </Touchable>
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
                <Touchable
                  style={[styles.exportBtn, importing && styles.exportBtnDisabled]}
                  onPress={confirmImport}
                  disabled={importing}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: importing, busy: importing }}
                  testID="settings-import-confirm"
                >
                  <Text style={styles.exportBtnText}>
                    {importing ? t('settings.importImporting') : t('settings.importConfirm')}
                  </Text>
                </Touchable>
                <TouchableOpacity
                  style={styles.textBtn}
                  onPress={() => setImportPreview(null)}
                  disabled={importing}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: importing }}
                  testID="settings-import-cancel"
                >
                  <Text style={styles.importCancel}>{t('settings.importCancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          {importMsg ? <Text style={styles.exportMsg} accessibilityLiveRegion="polite">{importMsg}</Text> : null}
        </View>

        {PRO_ENABLED ? (
        <>
        <Text style={styles.section} accessibilityRole="header">{t('pro.title')}</Text>
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
              <Touchable
                style={[styles.exportBtn, styles.proUnlockBtn]}
                disabled
                accessibilityRole="button"
                accessibilityState={{ disabled: true }}
                testID="pro-unlock"
              >
                <Ionicons name="lock-open-outline" size={16} color={colors.onInk} />
                <Text style={styles.exportBtnText}>{t('pro.unlock')} · {t('pro.unlockSoon')}</Text>
              </Touchable>
            </>
          )}
          <View style={styles.importDivider} />
          <View style={styles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('pro.preview')}</Text>
              <Text style={styles.rowValue}>{t('pro.previewSub')}</Text>
            </View>
            <Switch
              value={proPreview}
              onValueChange={(v) => setProPreview(v)}
              trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
              accessibilityLabel={t('pro.preview')}
              testID="pro-preview-toggle"
            />
          </View>
        </View>
        </>
        ) : null}

        {/* ── About & legal ── Apple 5.1.1(i) requires the privacy policy to
            be reachable inside the app, and 1.4.1 wants a medical disclaimer on
            a health app. The Open Food Facts credit satisfies ODbL attribution
            (5.2.2). It sat ABOVE Units, Theme and Language until S21-4 — what
            people come to read, ahead of what they come to change. */}
        <Text style={styles.section} accessibilityRole="header">{t('settings.aboutLegalSection')}</Text>
        <View style={styles.card}>
          <Touchable
            style={styles.linkRow}
            onPress={() => void openExternal('https://ignia.fit/privacy', t)}
            accessibilityRole="link"
            testID="settings-privacy"
          >
            <Text style={styles.rowLabel}>{t('settings.privacyPolicy')}</Text>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </Touchable>
          <Touchable
            style={styles.linkRow}
            onPress={() => void openExternal('https://ignia.fit/terms', t)}
            accessibilityRole="link"
            testID="settings-terms"
          >
            <Text style={styles.rowLabel}>{t('settings.termsOfUse')}</Text>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </Touchable>
          <Text style={styles.legalNote}>{t('settings.medicalDisclaimer')}</Text>
          <Text style={styles.legalNote}>{t('settings.dataCredit')}</Text>
          {/* Which BUILD and which over-the-air BUNDLE this app is running.
              Not vanity: an OTA lands on the launch after it downloads, so
              "is that bug fixed?" is unanswerable without it, and this repo has
              already twice called a JS behaviour broken while measuring the
              previous bundle. `updateId` is null on an embedded launch — that
              is the honest answer, not a blank. */}
          <Text style={styles.legalNote} selectable testID="settings-build">
            {t('settings.buildLine', {
              version: Application.nativeApplicationVersion ?? '?',
              build: Application.nativeBuildVersion ?? '?',
              bundle: Updates.isEmbeddedLaunch || !Updates.updateId
                ? t('settings.bundleEmbedded')
                : Updates.updateId.slice(0, 8),
            })}
          </Text>
        </View>

        {/* ── Account ── last. Sign-in methods (its own heading, from the
            card), then who you are signed in as and Sign out, then Delete
            account — the very bottom of the screen, alone in its card, in the
            danger colour, where a store reviewer looks for it. Deletion runs
            IN-APP (Apple 5.1.1(v)); this used to open the web privacy page,
            which does not satisfy the guideline. */}
        <SignInMethodsCard />

        <Text style={styles.section} accessibilityRole="header">{t('settings.account')}</Text>
        <View style={styles.card}>
          {/* Email on its own line, single-line + middle-ellipsis — a long
              address wrapped mid-word ("…@gm\nail.com") before. */}
          <View style={styles.accountHead}>
            <Text style={styles.rowLabel}>{t('settings.signedInAs')}</Text>
            <Text style={styles.accountEmail} numberOfLines={1} ellipsizeMode="middle">
              {user?.email ?? '—'}
            </Text>
          </View>
          <Touchable
            style={styles.signOut}
            onPress={confirmSignOut}
            accessibilityRole="button"
            accessibilityLabel={t('settings.signOut')}
            testID="settings-signout"
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>{t('settings.signOut')}</Text>
          </Touchable>
        </View>

        <View style={styles.card}>
          {/* No divider above this row. A separator separates two things, and
              Delete account is the ONLY row in its card — so the rule drew
              across the top of an otherwise empty card and read as a stray
              line. */}
          <Touchable
            style={styles.deleteRow}
            onPress={confirmDeleteAccount}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityState={{ disabled: deleting, busy: deleting }}
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
          </Touchable>
        </View>
      </ScrollView>
      {/* A root-stack screen over the tabs since S21-1: the tab layout's
          confirm host is underneath it, so Sign out's and Sign-in methods'
          confirms are drawn by this one (the arrangement `connected-apps.tsx`
          and `scan.tsx` use). */}
      <ConfirmHost />
    </SafeAreaView>
  );
}

/**
 * Android: a row reaches the card's edges (and a little above and below its
 * text), so its ripple is a band across the card rather than a square box
 * flush against the label (UX_AUDIT S22). The card's padding is `space.lg`;
 * the negative margins keep the text exactly where it was, and iOS — whose
 * press feedback is an opacity dip on the contents — is untouched.
 */
const ROW_BLEED = Platform.select({
  android: { marginHorizontal: -space.lg, paddingHorizontal: space.lg, marginVertical: -space.sm, paddingVertical: space.sm },
});

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
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
  /** Text column beside a trailing control: yields width to it, and keeps a
   *  gap once it does (the same shoving `digestRowText` below describes). */
  rowText: { flex: 1, marginRight: space.md },
  floorStacked: { gap: space.md, alignItems: 'flex-start' },
  /** A row that opens another screen — label, subtitle, chevron. Every one in
   *  the screen is this shape now (S21-4): the targets group mixed a row, an
   *  outlined button and a row, which read as three unrelated controls. */
  navRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET, ...ROW_BLEED },
  /** The second and later rows of a group card: a rule above, never on the
   *  first (a top rule on a card's first row is the stray line `soloRow` was
   *  invented to remove). */
  navRowDivided: {
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    ...Platform.select({ android: { marginTop: 0 } }),
  },
  tipBtn: { marginTop: space.md, alignSelf: 'flex-start', minHeight: TARGET },
  textBtn: { minHeight: TARGET, justifyContent: 'center' },
  rowLabel: { fontSize: font.body, color: colors.ink, fontWeight: '600' },
  // 44 pt minimum (S18-15): three legal links stacked at ~34 pt each were the
  // smallest targets on the screen.
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    minHeight: TARGET,
    ...Platform.select({ android: { marginHorizontal: -space.lg, paddingHorizontal: space.lg } }),
  },
  legalNote: { fontSize: font.tiny, color: colors.muted, marginTop: space.sm, lineHeight: font.tiny * 1.5 },
  rowValue: { fontSize: font.body, color: colors.muted, marginTop: 2 },
  rowSub: { fontSize: font.small, color: colors.faint, marginTop: 2 },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    // 44pt: these were ~33 (S21-2).
    minHeight: TARGET,
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
  digestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.line },
  /** Text column inside a {@link digestRow}. The row is `space-between`, so a
   *  bare <Text> sizes to its own content and shoves the trailing button off
   *  screen — measured on a real iPhone, where "Import now" rendered as
   *  "Impo" against the right edge. `flex: 1` makes the sentence yield; the
   *  gap keeps it off the button once it does. */
  digestRowText: { flex: 1, marginRight: space.md },
  segment: { flexDirection: 'row', gap: space.sm },
  segmentBtn: {
    flex: 1,
    borderWidth: 1,
    // A control's edge (WCAG 1.4.11, 3:1) — `line` is ~1.2:1.
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  segmentBtnOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segmentBtnOff: { opacity: 0.5 },
  bannerSlot: { paddingHorizontal: space.xl },
  segmentText: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
  segmentTextOn: { color: colors.onInk },
  // Stepper + switch share a row; the stepper is hidden when the meal is off,
  // so the switch stays put and the row doesn't reflow as it collapses.
  mealControls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // 44, matching refine-targets' pace stepper (S18-15) — these were 36.
  step: {
    width: TARGET, height: TARGET, borderRadius: TARGET / 2, borderWidth: 1, borderColor: colors.lineStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg,
  },
  stepText: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
  hourValue: { fontSize: font.body, color: colors.ink, fontWeight: '700', minWidth: 56, textAlign: 'center' },
  accountHead: { gap: 2, marginBottom: space.md },
  accountEmail: { fontSize: font.small, color: colors.muted },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'flex-start', minHeight: TARGET },
  signOutText: { color: colors.danger, fontWeight: '700', fontSize: font.body },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
  deleteLabel: { fontSize: font.body, color: colors.danger, fontWeight: '600' },
});
