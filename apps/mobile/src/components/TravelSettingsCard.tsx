import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  activeTravel,
  calendarDateKey,
  DEFAULT_USUAL_STEPS,
  parseYmd,
  travelPeriodsOf,
  type Profile,
  type TravelPeriod,
} from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { NativeDateField } from '@/components/NativeDatePicker';
import { useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { formatDate } from '@/lib/date-format';
import * as haptics from '@/lib/haptics';
import { setTravelPeriods } from '@/lib/ledger';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET } from '@/theme';

/**
 * Settings → Travel (travel mode, 2026-10-26, core `travel.ts`). One trip is
 * edited at a time; every trip stays on the profile (`travelPeriods`) because
 * a past trip's days must stay out of the maintenance fit. Dates are the
 * user's days (YYYY-MM-DD), inclusive at both ends; the trip ends on its own
 * after the last one.
 */
type Draft = {
  label: string;
  start: string;
  end: string;
  usualSteps: string;
  place: string;
  meters: string;
  arrival: string;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const okKey = (k: string) => YMD.test(k) && !Number.isNaN(parseYmd(k).getTime());

function toDraft(p: TravelPeriod | null, today: string): Draft {
  return {
    label: p?.label ?? '',
    start: p?.start ?? today,
    end: p?.end ?? today,
    usualSteps: String(p?.usualSteps ?? DEFAULT_USUAL_STEPS),
    place: p?.altitude?.place ?? '',
    meters: p?.altitude ? String(p.altitude.meters) : '',
    arrival: p?.altitude?.arrival ?? '',
  };
}

/** The draft as a period, or the first problem with it. Exported for the test. */
export function draftToPeriod(d: Draft): TravelPeriod | 'dates' | 'altitude' {
  if (!okKey(d.start) || !okKey(d.end) || d.start > d.end) return 'dates';
  const p: TravelPeriod = { start: d.start, end: d.end };
  if (d.label.trim()) p.label = d.label.trim().slice(0, 40);
  const steps = Number(d.usualSteps);
  if (Number.isFinite(steps) && steps > 0 && steps <= 100_000) p.usualSteps = Math.round(steps);
  const any = d.place.trim() || d.meters.trim() || d.arrival.trim();
  if (any) {
    const m = Number(d.meters);
    if (!d.place.trim() || !(m > 0 && m < 9000) || !okKey(d.arrival) || d.arrival < d.start || d.arrival > d.end) return 'altitude';
    p.altitude = { place: d.place.trim().slice(0, 40), meters: Math.round(m), arrival: d.arrival };
  }
  return p;
}

/** The trip to show: the one under way, else the next one, else the last. */
function focusTrip(periods: TravelPeriod[], today: string): TravelPeriod | null {
  return activeTravel(today, periods) ?? periods.find((p) => p.start > today) ?? periods[periods.length - 1] ?? null;
}

export function TravelSettingsCard({ uid, profile, offline }: { uid: string; profile: Profile | null; offline: boolean }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const today = calendarDateKey(new Date());
  const periods = travelPeriodsOf(profile);
  const shown = focusTrip(periods, today);
  const [editing, setEditing] = useState<{ original: TravelPeriod | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'dates' | 'altitude' | 'save' | null>(null);

  const day = (k: string) => formatDate(parseYmd(k), locale, { month: 'short', day: 'numeric', year: 'numeric' });

  async function write(next: TravelPeriod[]) {
    setBusy(true);
    setProblem(null);
    try {
      await setTravelPeriods(uid, next);
      haptics.success();
      setEditing(null);
    } catch {
      setProblem('save');
      announce(t('settings.travel.saveErr'));
    }
    setBusy(false);
  }

  function save() {
    if (!editing) return;
    const p = draftToPeriod(editing.draft);
    if (p === 'dates' || p === 'altitude') {
      setProblem(p);
      announce(t(p === 'dates' ? 'settings.travel.badDates' : 'settings.travel.badAltitude'));
      return;
    }
    const others = periods.filter((x) => x !== editing.original);
    void write([...others, p].sort((a, b) => (a.start < b.start ? -1 : 1)));
  }

  function remove(p: TravelPeriod) {
    confirm({
      title: t('settings.travel.removeTitle'),
      body: t('settings.travel.removeBody'),
      confirmText: t('settings.travel.remove'),
      cancelText: t('common.cancel'),
      destructive: true,
      onConfirm: () => void write(periods.filter((x) => x !== p)),
    });
  }

  const set = (k: keyof Draft) => (v: string) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e));

  const dateField = (k: 'start' | 'end' | 'arrival', label: string) => {
    const v = editing?.draft[k] ?? '';
    const asDate = okKey(v) ? parseYmd(v) : new Date();
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <NativeDateField
          mode="date"
          value={asDate}
          onChange={(d) => set(k)(calendarDateKey(d))}
          accessibilityLabel={label}
          testID={`travel-${k}`}
          fallback={
            <TextInput
              style={styles.input}
              value={v}
              onChangeText={set(k)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              maxLength={10}
              accessibilityLabel={label}
              testID={`travel-${k}-text`}
            />
          }
        />
      </View>
    );
  };

  return (
    <View style={styles.card} testID="settings-travel">
      {!editing ? (
        <>
          {shown ? (
            <View style={styles.trip}>
              <Text style={styles.rowLabel} testID="settings-travel-summary">
                {t('settings.travel.summary', { label: shown.label ?? t('travel.defaultLabel'), start: day(shown.start), end: day(shown.end) })}
              </Text>
              <Text style={styles.rowValue}>
                {activeTravel(today, periods) === shown
                  ? t('settings.travel.now')
                  : shown.start > today ? t('settings.travel.upcoming') : t('settings.travel.past')}
                {shown.altitude ? ` · ${t('settings.travel.altitudeLine', { place: shown.altitude.place, meters: shown.altitude.meters, arrival: day(shown.altitude.arrival) })}` : ''}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.link}
                  onPress={() => setEditing({ original: shown, draft: toDraft(shown, today) })}
                  disabled={offline || busy}
                  accessibilityRole="button"
                  testID="settings-travel-edit"
                >
                  <Text style={styles.linkText}>{t('settings.travel.edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.link}
                  onPress={() => remove(shown)}
                  disabled={offline || busy}
                  accessibilityRole="button"
                  testID="settings-travel-remove"
                >
                  <Text style={[styles.linkText, styles.danger]}>{t('settings.travel.remove')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.rowValue}>{t('settings.travel.none')}</Text>
          )}
          <Text style={styles.explain}>{t('settings.travel.explain')}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => setEditing({ original: null, draft: toDraft(null, today) })}
            disabled={offline || busy}
            accessibilityRole="button"
            testID="settings-travel-add"
          >
            <Text style={styles.buttonText}>{t('settings.travel.add')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>{t('settings.travel.label')}</Text>
            <TextInput
              style={styles.input}
              value={editing.draft.label}
              onChangeText={set('label')}
              placeholder={t('settings.travel.labelPlaceholder')}
              placeholderTextColor={colors.faint}
              maxLength={40}
              accessibilityLabel={t('settings.travel.label')}
              testID="travel-label"
            />
          </View>
          {dateField('start', t('settings.travel.start'))}
          {dateField('end', t('settings.travel.end'))}
          <View style={styles.field}>
            <Text style={styles.label}>{t('settings.travel.usualSteps')}</Text>
            <TextInput
              style={styles.input}
              value={editing.draft.usualSteps}
              onChangeText={set('usualSteps')}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel={t('settings.travel.usualSteps')}
              testID="travel-usual-steps"
            />
          </View>
          <Text style={styles.sub}>{t('settings.travel.altitudeHead')}</Text>
          <View style={styles.field}>
            <Text style={styles.label}>{t('settings.travel.place')}</Text>
            <TextInput
              style={styles.input}
              value={editing.draft.place}
              onChangeText={set('place')}
              placeholder={t('settings.travel.placePlaceholder')}
              placeholderTextColor={colors.faint}
              maxLength={40}
              accessibilityLabel={t('settings.travel.place')}
              testID="travel-place"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t('settings.travel.meters')}</Text>
            <TextInput
              style={styles.input}
              value={editing.draft.meters}
              onChangeText={set('meters')}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel={t('settings.travel.meters')}
              testID="travel-meters"
            />
          </View>
          {dateField('arrival', t('settings.travel.arrival'))}
          {problem ? (
            <Text style={styles.err} accessibilityRole="alert" testID="travel-problem">
              {t(problem === 'dates' ? 'settings.travel.badDates' : problem === 'altitude' ? 'settings.travel.badAltitude' : 'settings.travel.saveErr')}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.link} onPress={() => { setEditing(null); setProblem(null); }} accessibilityRole="button" testID="travel-cancel">
              <Text style={styles.linkText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={save} disabled={offline || busy} accessibilityRole="button" testID="travel-save">
              {busy ? <ActivityIndicator color={colors.onInk} /> : <Text style={styles.buttonText}>{t('settings.travel.save')}</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
    trip: { gap: 2 },
    rowLabel: { fontSize: font.body, fontWeight: '600', color: colors.ink },
    rowValue: { fontSize: font.small, color: colors.muted },
    explain: { fontSize: font.small, color: colors.muted },
    sub: { fontSize: font.small, fontWeight: '700', color: colors.muted, marginTop: space.sm },
    field: { gap: space.xs },
    label: { fontSize: font.small, color: colors.muted },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      fontSize: font.body,
      color: colors.ink,
      minHeight: TARGET,
    },
    actions: { flexDirection: 'row', gap: space.md, alignItems: 'center', justifyContent: 'flex-end' },
    link: { minHeight: TARGET, justifyContent: 'center', paddingHorizontal: space.xs },
    linkText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    danger: { color: colors.danger },
    button: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      minHeight: TARGET,
      paddingHorizontal: space.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
    err: { fontSize: font.small, color: colors.danger },
  });
