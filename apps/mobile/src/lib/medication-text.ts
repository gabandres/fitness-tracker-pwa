/**
 * The words the medication log is shown in — shared by the Medication screen,
 * Today's card and the share sheet, so a schedule reads the same everywhere.
 */
import { type MedicationLog, type MedicationSchedule, parseYmd } from '@macrolog/core';
import type { I18nKey, Locale, TFn } from '@/i18n';
import { formatDate, formatTime } from '@/lib/date-format';

/** 2026-11-15 is a Sunday: a week of real dates to name the weekdays from. */
export const weekdayName = (weekday: number, locale: Locale, width: 'long' | 'short') =>
  formatDate(new Date(2026, 10, 15 + weekday), locale, { weekday: width });

/** "Tue, Nov 24" for a day key. */
export const medicationDayLabel = (day: string, locale: Locale) =>
  formatDate(parseYmd(day), locale, { weekday: 'short', month: 'short', day: 'numeric' });

/** "9 AM" / "9" / "9 a. m." — the clock convention follows the app locale. */
export const medicationHourLabel = (hour: number, locale: Locale) =>
  formatTime(new Date(2000, 0, 1, hour), locale, { hour: 'numeric' });

export function scheduleSentence(schedule: MedicationSchedule, t: TFn, locale: Locale): string {
  if (schedule.kind === 'daily') return t('medication.everyDay');
  if (schedule.kind === 'weekly') return t('medication.everyWeekday', { day: weekdayName(schedule.weekday, locale, 'long') });
  return t('medication.everyNDays', { n: schedule.everyDays });
}

/** One history line: when, and whatever was entered with it. */
export function doseLine(
  dose: { takenAt: number; dose?: string; site?: string; note?: string },
  t: TFn,
  locale: Locale,
  withYear = false,
): string {
  const when = formatDate(new Date(dose.takenAt), locale, {
    ...(withYear ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return [when, dose.dose, dose.site ? t(`medication.site.${dose.site}` as I18nKey) : undefined, dose.note].filter(Boolean).join(' · ');
}

/** The whole log as plain text, for the share sheet: the only way a copy
 *  leaves the phone, and by the person's own hand. */
export function medicationLogText(log: MedicationLog, t: TFn, locale: Locale): string {
  const lines: string[] = [t('medication.shareTitle')];
  for (const med of log.medications) {
    lines.push('', `${med.name}${med.dose ? ` · ${med.dose}` : ''} · ${scheduleSentence(med.schedule, t, locale)}`);
    for (const d of log.doses.filter((x) => x.medicationId === med.id)) lines.push(`  ${doseLine(d, t, locale, true)}`);
  }
  return lines.join('\n');
}
