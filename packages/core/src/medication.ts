/**
 * Medication log (2026-11-20): what a person takes, on which days, and what
 * they logged — nothing more.
 *
 * Built for the people protein-first mode is for: a weekly GLP-1 injection is
 * easy to lose track of ("was it Tuesday or Wednesday? which side?"), and the
 * three big trackers each shipped a log for it in 2026. Ignia's is a RECORD:
 *
 *  - It gives no advice. No dose is suggested, no titration is planned, a
 *    late dose gets no instruction. It says what was scheduled and what was
 *    entered.
 *  - It never leaves the phone. The app stores it in device storage per
 *    account (`apps/mobile/src/lib/medication.ts`); there is no Firestore
 *    collection, no rule, no export to a health store. So this module is the
 *    only place the shape is defined, and `sanitizeMedicationLog` is its
 *    whole validation.
 *  - It is calm. A scheduled day with no entry is "no dose logged for
 *    Tuesday", never "missed" on screen (the state is named `open` here).
 *
 * Pure: day keys in, day keys out. The caller supplies "today".
 */
import type { DateKey } from './date';

export const MEDICATIONS_MAX = 6;
export const MEDICATION_NAME_MAX = 40;
export const MEDICATION_DOSE_MAX = 30;
export const MEDICATION_NOTE_MAX = 200;
/** Entries kept on the device, newest first. Ten years of a weekly dose. */
export const MEDICATION_DOSES_KEPT = 500;
export const MEDICATION_INTERVAL_MIN = 2;
export const MEDICATION_INTERVAL_MAX = 90;
/** How many reminders ahead are handed to the OS per medication. */
export const MEDICATION_REMINDERS_AHEAD = 4;

/** Where an injection went, for rotating sites. Free of anatomy beyond that. */
export const MEDICATION_SITES = [
  'abdomen-left',
  'abdomen-right',
  'thigh-left',
  'thigh-right',
  'arm-left',
  'arm-right',
] as const;
export type MedicationSite = (typeof MEDICATION_SITES)[number];

export type MedicationSchedule =
  /** Every week on one weekday: 0 = Sunday … 6 = Saturday. */
  | { kind: 'weekly'; weekday: number }
  /** Every N days counted from `anchor`, a dose day. */
  | { kind: 'interval'; everyDays: number; anchor: DateKey }
  | { kind: 'daily' };

export interface MedicationReminderTime {
  hour: number;
  minute: number;
}

export interface Medication {
  id: string;
  name: string;
  /** The usual dose as the person writes it: "5 mg", "0.5 mL". */
  dose?: string;
  schedule: MedicationSchedule;
  /** Absent: no reminder. */
  reminder?: MedicationReminderTime;
  /** Epoch ms. Days before it are never reported as open. */
  createdAt: number;
}

export interface MedicationDose {
  id: string;
  medicationId: string;
  /** Epoch ms of the dose. */
  takenAt: number;
  dose?: string;
  site?: MedicationSite;
  note?: string;
}

export interface MedicationLog {
  medications: Medication[];
  /** Newest first. */
  doses: MedicationDose[];
}

export const EMPTY_MEDICATION_LOG: MedicationLog = { medications: [], doses: [] };

// ─── Days ────────────────────────────────────────────────────────

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch for a day key; NaN when it is not one. UTC on both
 *  sides, so a daylight-saving change cannot make a day 23 or 25 hours. */
function dayIndex(key: string): number {
  const m = KEY.exec(key);
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return NaN;
  return Math.round(ms / 86_400_000);
}

function keyOf(index: number): DateKey {
  const d = new Date(index * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` as DateKey;
}

/** The local calendar day of an instant. */
export function medicationDayOf(ms: number): DateKey {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` as DateKey;
}

/** 0 = Sunday … 6 = Saturday, for a day key. */
export function medicationWeekday(day: DateKey): number {
  // 1970-01-01 was a Thursday (4).
  return (((dayIndex(day) + 4) % 7) + 7) % 7;
}

// ─── The schedule ────────────────────────────────────────────────

export function isDoseDay(schedule: MedicationSchedule, day: DateKey): boolean {
  const i = dayIndex(day);
  if (Number.isNaN(i)) return false;
  if (schedule.kind === 'daily') return true;
  if (schedule.kind === 'weekly') return medicationWeekday(day) === schedule.weekday;
  const a = dayIndex(schedule.anchor);
  return (((i - a) % schedule.everyDays) + schedule.everyDays) % schedule.everyDays === 0;
}

/** The first dose day on or after `from`. */
export function nextDoseDay(schedule: MedicationSchedule, from: DateKey): DateKey {
  const start = dayIndex(from);
  const span = schedule.kind === 'interval' ? schedule.everyDays : 7;
  for (let i = start; i <= start + span; i++) {
    if (isDoseDay(schedule, keyOf(i))) return keyOf(i);
  }
  return from;
}

/** The last dose day strictly before `before`. */
export function previousDoseDay(schedule: MedicationSchedule, before: DateKey): DateKey {
  const start = dayIndex(before) - 1;
  const span = schedule.kind === 'interval' ? schedule.everyDays : 7;
  for (let i = start; i >= start - span; i--) {
    if (isDoseDay(schedule, keyOf(i))) return keyOf(i);
  }
  return keyOf(start);
}

// ─── What was logged ─────────────────────────────────────────────

/** The newest dose of one medication, or null. */
export function lastDose(log: MedicationLog, medicationId: string): MedicationDose | null {
  let best: MedicationDose | null = null;
  for (const d of log.doses) {
    if (d.medicationId === medicationId && (!best || d.takenAt > best.takenAt)) best = d;
  }
  return best;
}

/**
 * Where a medication stands today.
 *
 * - `taken`: a dose is logged today.
 * - `due`: today is a dose day and nothing is logged today.
 * - `open`: the last dose day before today has no dose logged on or after
 *   it. A dose taken a day late closes that day — the question is "is the
 *   last scheduled dose accounted for", not "was it on time".
 * - `upcoming`: nothing to do.
 *
 * `nextDay` is today when `due`, otherwise the next dose day after today.
 * `openDay` names the unaccounted day.
 */
export type MedicationState = 'taken' | 'due' | 'open' | 'upcoming';

export interface MedicationStatus {
  state: MedicationState;
  nextDay: DateKey;
  last: MedicationDose | null;
  openDay?: DateKey;
}

export function medicationStatus(med: Medication, log: MedicationLog, today: DateKey): MedicationStatus {
  const last = lastDose(log, med.id);
  const lastDay = last ? medicationDayOf(last.takenAt) : null;
  const tomorrow = keyOf(dayIndex(today) + 1);
  if (lastDay === today) return { state: 'taken', nextDay: nextDoseDay(med.schedule, tomorrow), last };
  if (isDoseDay(med.schedule, today)) return { state: 'due', nextDay: today, last };
  const nextDay = nextDoseDay(med.schedule, tomorrow);
  const prev = previousDoseDay(med.schedule, today);
  const started = medicationDayOf(med.createdAt);
  // Before the medication was added there was nothing to account for.
  const accountable = dayIndex(prev) >= dayIndex(started);
  const accounted = lastDay != null && dayIndex(lastDay) >= dayIndex(prev);
  if (accountable && !accounted) return { state: 'open', nextDay, last, openDay: prev };
  return { state: 'upcoming', nextDay, last };
}

// ─── Reminders ───────────────────────────────────────────────────

export interface MedicationReminderPlan {
  /** Stable per medication and day: scheduling it again replaces it. */
  id: string;
  medicationId: string;
  day: DateKey;
  at: Date;
}

export const MEDICATION_REMINDER_ID_PREFIX = 'medication.';

/**
 * The next reminders to hand the OS: per medication with a reminder time, its
 * next dose days at that time — skipping a moment already past and a day that
 * already has a dose. Re-planned whenever the log changes and when the app
 * opens, so a dose logged early takes its reminder with it.
 */
export function planMedicationReminders(
  log: MedicationLog,
  now: Date,
  ahead: number = MEDICATION_REMINDERS_AHEAD,
): MedicationReminderPlan[] {
  const today = medicationDayOf(now.getTime());
  const out: MedicationReminderPlan[] = [];
  for (const med of log.medications) {
    if (!med.reminder) continue;
    const lastDay = (() => {
      const l = lastDose(log, med.id);
      return l ? medicationDayOf(l.takenAt) : null;
    })();
    let day = nextDoseDay(med.schedule, today);
    let found = 0;
    for (let guard = 0; guard < ahead + 2 && found < ahead; guard++) {
      const m = KEY.exec(day)!;
      const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), med.reminder.hour, med.reminder.minute, 0, 0);
      if (at.getTime() > now.getTime() && day !== lastDay) {
        out.push({ id: `${MEDICATION_REMINDER_ID_PREFIX}${med.id}.${day}`, medicationId: med.id, day, at });
        found += 1;
      }
      day = nextDoseDay(med.schedule, keyOf(dayIndex(day) + 1));
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ─── Stored shape ────────────────────────────────────────────────

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, max);
  return s.length ? s : undefined;
};
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

export function sanitizeMedicationSchedule(raw: unknown): MedicationSchedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'daily') return { kind: 'daily' };
  if (r.kind === 'weekly') {
    const weekday = int(r.weekday, 0, 6);
    return weekday == null ? null : { kind: 'weekly', weekday };
  }
  if (r.kind === 'interval') {
    const everyDays = int(r.everyDays, MEDICATION_INTERVAL_MIN, MEDICATION_INTERVAL_MAX);
    if (everyDays == null || typeof r.anchor !== 'string' || Number.isNaN(dayIndex(r.anchor))) return null;
    return { kind: 'interval', everyDays, anchor: r.anchor as DateKey };
  }
  return null;
}

/**
 * Whatever storage held → a log this module can reason about. Drops what it
 * cannot read rather than throwing: a corrupt entry must not hide the rest.
 * Doses of a medication that no longer exists go with it.
 */
export function sanitizeMedicationLog(raw: unknown): MedicationLog {
  if (!raw || typeof raw !== 'object') return { medications: [], doses: [] };
  const r = raw as { medications?: unknown; doses?: unknown };
  const medications: Medication[] = [];
  for (const m of Array.isArray(r.medications) ? r.medications : []) {
    if (!m || typeof m !== 'object' || medications.length >= MEDICATIONS_MAX) continue;
    const o = m as Record<string, unknown>;
    const id = str(o.id, 40);
    const name = str(o.name, MEDICATION_NAME_MAX);
    const schedule = sanitizeMedicationSchedule(o.schedule);
    if (!id || !name || !schedule || medications.some((x) => x.id === id)) continue;
    const dose = str(o.dose, MEDICATION_DOSE_MAX);
    const rem = o.reminder as Record<string, unknown> | undefined;
    const hour = rem ? int(rem.hour, 0, 23) : null;
    const minute = rem ? int(rem.minute, 0, 59) : null;
    medications.push({
      id,
      name,
      schedule,
      createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : 0,
      ...(dose ? { dose } : {}),
      ...(hour != null && minute != null ? { reminder: { hour, minute } } : {}),
    });
  }
  const known = new Set(medications.map((m) => m.id));
  const doses: MedicationDose[] = [];
  for (const d of Array.isArray(r.doses) ? r.doses : []) {
    if (!d || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    const id = str(o.id, 40);
    const medicationId = str(o.medicationId, 40);
    if (!id || !medicationId || !known.has(medicationId)) continue;
    if (typeof o.takenAt !== 'number' || !Number.isFinite(o.takenAt) || o.takenAt <= 0) continue;
    if (doses.some((x) => x.id === id)) continue;
    const dose = str(o.dose, MEDICATION_DOSE_MAX);
    const note = str(o.note, MEDICATION_NOTE_MAX);
    const site = (MEDICATION_SITES as readonly string[]).includes(o.site as string) ? (o.site as MedicationSite) : undefined;
    doses.push({ id, medicationId, takenAt: o.takenAt, ...(dose ? { dose } : {}), ...(site ? { site } : {}), ...(note ? { note } : {}) });
  }
  doses.sort((a, b) => b.takenAt - a.takenAt);
  return { medications, doses: doses.slice(0, MEDICATION_DOSES_KEPT) };
}

// ─── Edits (each returns a new, sanitised log) ───────────────────

export function withMedication(log: MedicationLog, med: Medication): MedicationLog {
  const others = log.medications.filter((m) => m.id !== med.id);
  const at = log.medications.findIndex((m) => m.id === med.id);
  const medications = at === -1 ? [...others, med] : [...log.medications.slice(0, at), med, ...log.medications.slice(at + 1)];
  return sanitizeMedicationLog({ medications, doses: log.doses });
}

/** Removes the medication AND its doses: a log of something nobody takes any
 *  more is not kept behind the person's back. */
export function withoutMedication(log: MedicationLog, medicationId: string): MedicationLog {
  return sanitizeMedicationLog({
    medications: log.medications.filter((m) => m.id !== medicationId),
    doses: log.doses.filter((d) => d.medicationId !== medicationId),
  });
}

export function withDose(log: MedicationLog, dose: MedicationDose): MedicationLog {
  return sanitizeMedicationLog({ medications: log.medications, doses: [dose, ...log.doses.filter((d) => d.id !== dose.id)] });
}

export function withoutDose(log: MedicationLog, doseId: string): MedicationLog {
  return sanitizeMedicationLog({ medications: log.medications, doses: log.doses.filter((d) => d.id !== doseId) });
}
