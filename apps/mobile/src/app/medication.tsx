import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  MEDICATIONS_MAX,
  MEDICATION_DOSE_MAX,
  MEDICATION_INTERVAL_MAX,
  MEDICATION_INTERVAL_MIN,
  MEDICATION_NAME_MAX,
  MEDICATION_NOTE_MAX,
  MEDICATION_SITES,
  type Medication,
  type MedicationDose,
  type MedicationSchedule,
  type MedicationSite,
  medicationDayOf,
  medicationStatus,
  newLedgerId,
} from '@macrolog/core';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';
import { Touchable } from '@/components/Touchable';
import { type I18nKey, useLocale, useT } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { useMedicationLog } from '@/lib/medication';
import { medicationDayLabel as dayLabel, medicationHourLabel as hourLabel, medicationLogText, scheduleSentence, weekdayName } from '@/lib/medication-text';
import { requestNotificationPermission } from '@/lib/reminders';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { contentColumn, font, radius, space, TARGET } from '@/theme';

/**
 * Medication — a record of what someone takes and when (2026-11-20).
 *
 * The second half of the protein-first work: the people that mode is for are
 * mostly on a weekly injection, and "was it Tuesday, and which side" is the
 * question this answers. Core `medication.ts` holds the shape and the
 * schedule; `lib/medication.ts` keeps the log on this phone and nowhere else.
 *
 * ## What it will not do
 *
 * It suggests no dose, plans no titration and tells nobody what to do about a
 * late one. A dose day with no entry reads "No dose logged for Tuesday": a
 * fact, with no word like "missed". The first line of the screen says Ignia
 * gives no medical advice, and the line under it says where the log lives and
 * what removes it.
 *
 * ## One scroll view, forms in place
 *
 * No sheets: adding, editing and logging open inside the card they belong to.
 * This shipped without a rendered check (no simulator, 2026-11-20), and a
 * form that is ordinary rows in an ordinary scroll view has the least that
 * can go wrong unseen.
 *
 * A ROOT route with the shared native header (`lib/root-stack.ts`).
 */

/** The clock, for handlers. A bare `Date.now()` inside a component body reads
 *  as an impure render to the React Compiler lint, handler or not. */
const stamp = (): number => Date.now();

interface FormState {
  id: string | null;
  name: string;
  dose: string;
  kind: MedicationSchedule['kind'];
  weekday: number;
  everyDays: number;
  remind: boolean;
  hour: number;
}

const blankForm = (weekday: number): FormState => ({ id: null, name: '', dose: '', kind: 'weekly', weekday, everyDays: 3, remind: false, hour: 9 });

const formOf = (med: Medication, weekday: number): FormState => ({
  id: med.id,
  name: med.name,
  dose: med.dose ?? '',
  kind: med.schedule.kind,
  weekday: med.schedule.kind === 'weekly' ? med.schedule.weekday : weekday,
  everyDays: med.schedule.kind === 'interval' ? med.schedule.everyDays : 3,
  remind: med.reminder != null,
  hour: med.reminder?.hour ?? 9,
});

interface DoseFormState {
  medicationId: string;
  dose: string;
  site: MedicationSite | null;
  note: string;
}

export default function MedicationScreen() {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const store = useMedicationLog(user?.uid, t);
  const { log } = store;

  // "Now" is state, read when the screen gains focus: the status lines depend
  // on today's date, and a render must not read the clock itself.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  const today = medicationDayOf(now);
  const todayWeekday = new Date(now).getDay();

  const [form, setForm] = useState<FormState | null>(null);
  const [doseForm, setDoseForm] = useState<DoseFormState | null>(null);
  const [notice, setNotice] = useState<I18nKey | null>(null);

  const patchForm = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function saveForm() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return;
    let remind = form.remind;
    if (remind && !(await requestNotificationPermission())) {
      // Saved without the reminder, and said so: a switch left on would claim
      // a reminder the phone will never show.
      remind = false;
      setNotice('medication.reminderDenied');
    } else {
      setNotice(null);
    }
    const existing = form.id ? log.medications.find((m) => m.id === form.id) : undefined;
    const schedule: MedicationSchedule =
      form.kind === 'daily'
        ? { kind: 'daily' }
        : form.kind === 'weekly'
          ? { kind: 'weekly', weekday: form.weekday }
          : {
              kind: 'interval',
              everyDays: form.everyDays,
              // Counted from the day it was set up, and kept when only the
              // name or the dose is edited.
              anchor: existing?.schedule.kind === 'interval' && existing.schedule.everyDays === form.everyDays ? existing.schedule.anchor : today,
            };
    const dose = form.dose.trim();
    const med: Medication = {
      id: form.id ?? newLedgerId(Math.random),
      name,
      schedule,
      createdAt: existing?.createdAt ?? stamp(),
      ...(dose ? { dose } : {}),
      ...(remind ? { reminder: { hour: form.hour, minute: 0 } } : {}),
    };
    const ok = await store.saveMedication(med);
    if (!ok) return setNotice('medication.saveFailed');
    haptics.success();
    setForm(null);
  }

  async function saveDose() {
    if (!doseForm) return;
    const dose = doseForm.dose.trim();
    const note = doseForm.note.trim();
    const entry: MedicationDose = {
      id: newLedgerId(Math.random),
      medicationId: doseForm.medicationId,
      takenAt: stamp(),
      ...(dose ? { dose } : {}),
      ...(doseForm.site ? { site: doseForm.site } : {}),
      ...(note ? { note } : {}),
    };
    const ok = await store.logDose(entry);
    if (!ok) return setNotice('medication.saveFailed');
    haptics.success();
    setNotice(null);
    setDoseForm(null);
    setNow(stamp());
  }

  function askRemove(med: Medication) {
    confirm({
      title: t('medication.removeTitle', { name: med.name }),
      body: t('medication.removeBody'),
      confirmText: t('medication.removeConfirm'),
      destructive: true,
      onConfirm: () => {
        setForm(null);
        void store.removeMedication(med.id);
      },
    });
  }

  function askRemoveDose(dose: MedicationDose) {
    confirm({
      title: t('medication.removeDoseTitle'),
      confirmText: t('medication.removeConfirm'),
      destructive: true,
      onConfirm: () => void store.removeDose(dose.id),
    });
  }

  const canAdd = log.medications.length < MEDICATIONS_MAX;

  const renderForm = (f: FormState) => (
    <View style={styles.form} testID="medication-form">
      <View style={styles.field}>
        <Text style={styles.label}>{t('medication.name')}</Text>
        <TextInput
          style={styles.input}
          value={f.name}
          onChangeText={(name) => patchForm({ name })}
          placeholder={t('medication.namePlaceholder')}
          placeholderTextColor={colors.faint}
          maxLength={MEDICATION_NAME_MAX}
          autoCapitalize="words"
          accessibilityLabel={t('medication.name')}
          testID="medication-name"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{t('medication.dose')}</Text>
        <TextInput
          style={styles.input}
          value={f.dose}
          onChangeText={(dose) => patchForm({ dose })}
          placeholder={t('medication.dosePlaceholder')}
          placeholderTextColor={colors.faint}
          maxLength={MEDICATION_DOSE_MAX}
          autoCapitalize="none"
          accessibilityLabel={t('medication.dose')}
          testID="medication-dose"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{t('medication.schedule')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {(['weekly', 'interval', 'daily'] as const).map((kind) => {
            const on = f.kind === kind;
            return (
              <TouchableOpacity
                key={kind}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => patchForm({ kind })}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                testID={`medication-kind-${kind}`}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {t(kind === 'weekly' ? 'medication.scheduleWeekly' : kind === 'interval' ? 'medication.scheduleInterval' : 'medication.scheduleDaily')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {f.kind === 'weekly' ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t('medication.weekday')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {[0, 1, 2, 3, 4, 5, 6].map((weekday) => {
              const on = f.weekday === weekday;
              return (
                <TouchableOpacity
                  key={weekday}
                  style={[styles.chip, styles.dayChip, on && styles.chipOn]}
                  onPress={() => patchForm({ weekday })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={weekdayName(weekday, locale, 'long')}
                  testID={`medication-weekday-${weekday}`}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{weekdayName(weekday, locale, 'short')}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
      {f.kind === 'interval' ? (
        <View style={styles.stepRow}>
          <Text style={styles.stepLabel} testID="medication-interval">{t('medication.everyNDays', { n: f.everyDays })}</Text>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => patchForm({ everyDays: Math.max(MEDICATION_INTERVAL_MIN, f.everyDays - 1) })}
            accessibilityRole="button"
            accessibilityLabel={t('medication.intervalLess')}
            testID="medication-interval-minus"
          >
            <Ionicons name="remove" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => patchForm({ everyDays: Math.min(MEDICATION_INTERVAL_MAX, f.everyDays + 1) })}
            accessibilityRole="button"
            accessibilityLabel={t('medication.intervalMore')}
            testID="medication-interval-plus"
          >
            <Ionicons name="add" size={20} color={colors.ink} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{t('medication.reminder')}</Text>
        <Switch
          value={f.remind}
          onValueChange={(remind) => patchForm({ remind })}
          accessibilityLabel={t('medication.reminder')}
          testID="medication-remind"
        />
      </View>
      {f.remind ? (
        <View style={styles.stepRow}>
          <Text style={styles.stepLabel} testID="medication-remind-hour">{t('medication.reminderAt', { time: hourLabel(f.hour, locale) })}</Text>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => patchForm({ hour: (f.hour + 23) % 24 })}
            accessibilityRole="button"
            accessibilityLabel={t('medication.reminderEarlier')}
            testID="medication-remind-minus"
          >
            <Ionicons name="remove" size={20} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => patchForm({ hour: (f.hour + 1) % 24 })}
            accessibilityRole="button"
            accessibilityLabel={t('medication.reminderLater')}
            testID="medication-remind-plus"
          >
            <Ionicons name="add" size={20} color={colors.ink} />
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Touchable
          style={[styles.primary, !f.name.trim() && styles.disabled]}
          onPress={() => void saveForm()}
          disabled={!f.name.trim()}
          accessibilityRole="button"
          accessibilityState={{ disabled: !f.name.trim() }}
          testID="medication-save"
        >
          <Text style={styles.primaryText}>{t('medication.save')}</Text>
        </Touchable>
        <TouchableOpacity style={styles.textBtn} onPress={() => setForm(null)} accessibilityRole="button" testID="medication-cancel">
          <Text style={styles.textBtnText}>{t('medication.cancel')}</Text>
        </TouchableOpacity>
        {f.id ? (
          <TouchableOpacity
            style={styles.textBtn}
            onPress={() => {
              const med = log.medications.find((m) => m.id === f.id);
              if (med) askRemove(med);
            }}
            accessibilityRole="button"
            testID="medication-remove"
          >
            <Text style={[styles.textBtnText, styles.dangerText]}>{t('medication.remove')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const renderDoseForm = (d: DoseFormState) => (
    <View style={styles.form} testID="medication-dose-form">
      <View style={styles.field}>
        <Text style={styles.label}>{t('medication.doseTaken')}</Text>
        <TextInput
          style={styles.input}
          value={d.dose}
          onChangeText={(dose) => setDoseForm({ ...d, dose })}
          placeholder={t('medication.dosePlaceholder')}
          placeholderTextColor={colors.faint}
          maxLength={MEDICATION_DOSE_MAX}
          autoCapitalize="none"
          accessibilityLabel={t('medication.doseTaken')}
          testID="medication-dose-amount"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{t('medication.site')}</Text>
        <View style={styles.chips}>
          {MEDICATION_SITES.map((site) => {
            const on = d.site === site;
            return (
              <TouchableOpacity
                key={site}
                style={[styles.chip, on && styles.chipOn]}
                // Tapping the chosen site again clears it: the site is optional.
                onPress={() => setDoseForm({ ...d, site: on ? null : site })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                testID={`medication-site-${site}`}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`medication.site.${site}` as I18nKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{t('medication.note')}</Text>
        <TextInput
          style={styles.input}
          value={d.note}
          onChangeText={(note) => setDoseForm({ ...d, note })}
          maxLength={MEDICATION_NOTE_MAX}
          accessibilityLabel={t('medication.note')}
          testID="medication-dose-note"
        />
      </View>
      <View style={styles.actions}>
        <Touchable style={styles.primary} onPress={() => void saveDose()} accessibilityRole="button" testID="medication-dose-save">
          <Text style={styles.primaryText}>{t('medication.saveDose')}</Text>
        </Touchable>
        <TouchableOpacity style={styles.textBtn} onPress={() => setDoseForm(null)} accessibilityRole="button" testID="medication-dose-cancel">
          <Text style={styles.textBtnText}>{t('medication.cancel')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderMedication = (med: Medication) => {
    const status = medicationStatus(med, log, today);
    const doses = log.doses.filter((d) => d.medicationId === med.id);
    const lastSite = doses.find((d) => d.site)?.site;
    const stateLine =
      status.state === 'due'
        ? t('medication.stateDue')
        : status.state === 'taken'
          ? t('medication.stateTaken')
          : status.state === 'open' && status.openDay
            ? t('medication.stateOpen', { day: dayLabel(status.openDay, locale) })
            : null;
    const editing = form?.id === med.id;
    const logging = doseForm?.medicationId === med.id;
    return (
      <View key={med.id} style={styles.card} testID={`medication-card-${med.id}`}>
        <View style={styles.cardHead}>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardTitle} accessibilityRole="header">
              {med.name}
              {med.dose ? <Text style={styles.cardDose}>{`  ${med.dose}`}</Text> : null}
            </Text>
            <Text style={styles.line}>{scheduleSentence(med.schedule, t, locale)}</Text>
          </View>
          {!editing ? (
            <TouchableOpacity
              style={styles.textBtn}
              onPress={() => {
                setDoseForm(null);
                setForm(formOf(med, todayWeekday));
              }}
              accessibilityRole="button"
              accessibilityLabel={`${t('medication.edit')}, ${med.name}`}
              testID={`medication-edit-${med.id}`}
            >
              <Text style={styles.textBtnText}>{t('medication.edit')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {editing && form ? (
          renderForm(form)
        ) : (
          <>
            {stateLine ? (
              <Text style={[styles.state, status.state === 'taken' && styles.stateDone]} testID={`medication-state-${med.id}`}>
                {stateLine}
              </Text>
            ) : null}
            {status.state !== 'due' ? (
              <Text style={styles.line} testID={`medication-next-${med.id}`}>{t('medication.next', { day: dayLabel(status.nextDay, locale) })}</Text>
            ) : null}
            {status.last ? (
              <Text style={styles.line}>{t('medication.last', { day: dayLabel(medicationDayOf(status.last.takenAt), locale) })}</Text>
            ) : null}
            {lastSite ? <Text style={styles.line}>{t('medication.lastSite', { site: t(`medication.site.${lastSite}` as I18nKey) })}</Text> : null}
            {logging && doseForm ? (
              renderDoseForm(doseForm)
            ) : (
              <Touchable
                style={styles.primary}
                onPress={() => {
                  haptics.tap();
                  setForm(null);
                  setDoseForm({ medicationId: med.id, dose: med.dose ?? '', site: null, note: '' });
                }}
                accessibilityRole="button"
                testID={`medication-log-${med.id}`}
              >
                <Text style={styles.primaryText}>{t('medication.logDose')}</Text>
              </Touchable>
            )}
            {doses.length > 0 ? (
              <View style={styles.history} testID={`medication-history-${med.id}`}>
                <Text style={styles.label}>{t('medication.history')}</Text>
                {doses.slice(0, 12).map((d) => {
                  const when = formatDate(new Date(d.takenAt), locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                  const parts = [when, d.dose, d.site ? t(`medication.site.${d.site}` as I18nKey) : undefined, d.note].filter(Boolean).join(' · ');
                  return (
                    <View key={d.id} style={styles.historyRow}>
                      <Text style={styles.historyText}>{parts}</Text>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => askRemoveDose(d)}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('medication.removeDose')}, ${when}`}
                        testID={`medication-dose-remove-${d.id}`}
                      >
                        <Ionicons name="close" size={18} color={colors.muted} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.fill}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro} testID="medication-intro">{t('medication.intro')}</Text>
          <Text style={styles.line} testID="medication-privacy">{t('medication.privacy')}</Text>
          {notice ? (
            <Text style={styles.notice} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="medication-notice">
              {t(notice)}
            </Text>
          ) : null}
          {store.ready && log.medications.length === 0 && !form ? (
            <Text style={styles.line} testID="medication-empty">{t('medication.empty')}</Text>
          ) : null}
          {log.medications.map(renderMedication)}
          {form && form.id === null ? <View style={styles.card}>{renderForm(form)}</View> : null}
          {!form && canAdd ? (
            <Touchable
              style={styles.secondary}
              onPress={() => {
                haptics.tap();
                setDoseForm(null);
                setForm(blankForm(todayWeekday));
              }}
              accessibilityRole="button"
              testID="medication-add"
            >
              <Ionicons name="add" size={20} color={colors.ink} />
              <Text style={styles.secondaryText}>{t('medication.add')}</Text>
            </Touchable>
          ) : null}
          {!canAdd ? <Text style={styles.line}>{t('medication.limit', { n: MEDICATIONS_MAX })}</Text> : null}
          {log.doses.length > 0 ? (
            <TouchableOpacity
              style={styles.textBtn}
              onPress={() => void Share.share({ message: medicationLogText(log, t, locale) }).catch(() => undefined)}
              accessibilityRole="button"
              testID="medication-share"
            >
              <Text style={styles.textBtnText}>{t('medication.share')}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      <ConfirmHost />
    </SafeAreaView>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    fill: { flex: 1 },
    body: { ...contentColumn, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl, gap: space.md },
    intro: { fontSize: font.body, color: colors.ink },
    line: { fontSize: font.small, color: colors.muted },
    notice: { fontSize: font.small, color: colors.danger },
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
    cardTitleWrap: { flex: 1, gap: 2 },
    cardTitle: { fontSize: font.h3, color: colors.ink, fontWeight: '700' },
    cardDose: { fontSize: font.body, color: colors.muted, fontWeight: '400' },
    state: { fontSize: font.body, color: colors.ink, fontWeight: '700' },
    stateDone: { color: colors.muted, fontWeight: '600' },
    form: { gap: space.md, marginTop: space.xs },
    field: { gap: space.xs },
    label: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      fontSize: font.body,
      color: colors.ink,
      minHeight: TARGET,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: {
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      minHeight: TARGET,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.inputBg,
    },
    dayChip: { minWidth: TARGET, paddingHorizontal: space.sm },
    chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    chipText: { fontSize: font.small, color: colors.ink, fontWeight: '600' },
    chipTextOn: { color: colors.onInk },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    stepLabel: { flex: 1, fontSize: font.body, color: colors.ink },
    stepBtn: {
      width: TARGET,
      height: TARGET,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inputBg,
    },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TARGET },
    switchLabel: { flex: 1, fontSize: font.body, color: colors.ink },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
    primary: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      minHeight: TARGET,
      paddingHorizontal: space.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
    disabled: { opacity: 0.45 },
    secondary: {
      flexDirection: 'row',
      gap: space.xs,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      minHeight: TARGET,
      backgroundColor: colors.inputBg,
    },
    secondaryText: { color: colors.ink, fontWeight: '700', fontSize: font.body },
    textBtn: { minHeight: TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
    textBtnText: { fontSize: font.body, color: colors.ink, fontWeight: '600', textDecorationLine: 'underline' },
    dangerText: { color: colors.danger },
    history: { gap: 2, marginTop: space.xs },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TARGET },
    historyText: { flex: 1, fontSize: font.small, color: colors.ink },
    iconBtn: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center' },
  });
