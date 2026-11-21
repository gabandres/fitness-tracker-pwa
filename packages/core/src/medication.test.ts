import { describe, expect, it } from 'vitest';
import type { DateKey } from './date';
import {
  EMPTY_MEDICATION_LOG,
  MEDICATIONS_MAX,
  MEDICATION_DOSES_KEPT,
  type Medication,
  type MedicationLog,
  isDoseDay,
  lastDose,
  medicationDayOf,
  medicationStatus,
  medicationWeekday,
  nextDoseDay,
  planMedicationReminders,
  previousDoseDay,
  sanitizeMedicationLog,
  withDose,
  withMedication,
  withoutDose,
  withoutMedication,
} from './medication';

const day = (s: string) => s as DateKey;
/** Local noon of a day key, as epoch ms. */
const noon = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

// 2026-11-17 is a Tuesday.
const weekly: Medication = { id: 'm1', name: 'Zepbound', dose: '5 mg', schedule: { kind: 'weekly', weekday: 2 }, createdAt: noon('2026-11-01') };
const logOf = (med: Medication, taken: string[] = []): MedicationLog => ({
  medications: [med],
  doses: taken.map((t, i) => ({ id: `d${i}`, medicationId: med.id, takenAt: noon(t) })).reverse(),
});

describe('days', () => {
  it('names the weekday of a day key', () => {
    expect(medicationWeekday(day('2026-11-17'))).toBe(2);
    expect(medicationWeekday(day('2026-11-22'))).toBe(0);
    expect(medicationWeekday(day('1970-01-01'))).toBe(4);
  });

  it('reads the local calendar day of an instant', () => {
    expect(medicationDayOf(new Date(2026, 10, 20, 23, 59).getTime())).toBe('2026-11-20');
    expect(medicationDayOf(new Date(2026, 10, 21, 0, 1).getTime())).toBe('2026-11-21');
  });
});

describe('the schedule', () => {
  it('weekly: one weekday, every week', () => {
    expect(isDoseDay(weekly.schedule, day('2026-11-17'))).toBe(true);
    expect(isDoseDay(weekly.schedule, day('2026-11-18'))).toBe(false);
    expect(nextDoseDay(weekly.schedule, day('2026-11-17'))).toBe('2026-11-17');
    expect(nextDoseDay(weekly.schedule, day('2026-11-18'))).toBe('2026-11-24');
    expect(previousDoseDay(weekly.schedule, day('2026-11-17'))).toBe('2026-11-10');
  });

  it('every N days, counted from its anchor in both directions', () => {
    const s = { kind: 'interval', everyDays: 3, anchor: day('2026-11-20') } as const;
    expect(isDoseDay(s, day('2026-11-20'))).toBe(true);
    expect(isDoseDay(s, day('2026-11-23'))).toBe(true);
    expect(isDoseDay(s, day('2026-11-17'))).toBe(true);
    expect(isDoseDay(s, day('2026-11-21'))).toBe(false);
    expect(nextDoseDay(s, day('2026-11-21'))).toBe('2026-11-23');
    expect(previousDoseDay(s, day('2026-11-23'))).toBe('2026-11-20');
  });

  it('daily: every day', () => {
    expect(isDoseDay({ kind: 'daily' }, day('2026-11-20'))).toBe(true);
    expect(nextDoseDay({ kind: 'daily' }, day('2026-11-20'))).toBe('2026-11-20');
    expect(previousDoseDay({ kind: 'daily' }, day('2026-11-20'))).toBe('2026-11-19');
  });

  it('crosses a month, a year and a clock change without losing a day', () => {
    expect(nextDoseDay(weekly.schedule, day('2026-12-30'))).toBe('2027-01-05');
    // US clocks went back on 2026-11-01: the week is still seven days.
    expect(nextDoseDay(weekly.schedule, day('2026-10-28'))).toBe('2026-11-03');
  });

  it('is not a dose day for something that is not a day', () => {
    expect(isDoseDay(weekly.schedule, day('2026-02-30'))).toBe(false);
    expect(isDoseDay(weekly.schedule, day('tuesday'))).toBe(false);
  });
});

describe('where a medication stands today', () => {
  it('due on its day with nothing logged', () => {
    expect(medicationStatus(weekly, logOf(weekly, ['2026-11-10']), day('2026-11-17'))).toMatchObject({ state: 'due', nextDay: '2026-11-17' });
  });

  it('taken once a dose is logged today, and the next day is a week on', () => {
    expect(medicationStatus(weekly, logOf(weekly, ['2026-11-17']), day('2026-11-17'))).toMatchObject({ state: 'taken', nextDay: '2026-11-24' });
  });

  it('upcoming between dose days when the last one is accounted for', () => {
    const s = medicationStatus(weekly, logOf(weekly, ['2026-11-17']), day('2026-11-19'));
    expect(s.state).toBe('upcoming');
    expect(s.nextDay).toBe('2026-11-24');
    expect(s.last?.takenAt).toBe(noon('2026-11-17'));
  });

  it('open when the last dose day has no entry — and names that day', () => {
    expect(medicationStatus(weekly, logOf(weekly, ['2026-11-10']), day('2026-11-19'))).toMatchObject({ state: 'open', openDay: '2026-11-17', nextDay: '2026-11-24' });
  });

  it('a dose taken a day late accounts for the day it was due', () => {
    expect(medicationStatus(weekly, logOf(weekly, ['2026-11-18']), day('2026-11-19')).state).toBe('upcoming');
  });

  it('a dose logged today on a day that is not a dose day still reads as taken', () => {
    expect(medicationStatus(weekly, logOf(weekly, ['2026-11-19']), day('2026-11-19')).state).toBe('taken');
  });

  it('reports nothing open for days before the medication was added', () => {
    const fresh: Medication = { ...weekly, createdAt: noon('2026-11-19') };
    expect(medicationStatus(fresh, logOf(fresh), day('2026-11-19')).state).toBe('upcoming');
    expect(medicationStatus(fresh, logOf(fresh), day('2026-11-25'))).toMatchObject({ state: 'open', openDay: '2026-11-24' });
  });

  it('looks only at its own doses', () => {
    const other: Medication = { ...weekly, id: 'm2', name: 'Other' };
    const log: MedicationLog = { medications: [weekly, other], doses: [{ id: 'd', medicationId: 'm2', takenAt: noon('2026-11-17') }] };
    expect(medicationStatus(weekly, log, day('2026-11-17')).state).toBe('due');
    expect(lastDose(log, 'm1')).toBeNull();
  });
});

describe('reminders', () => {
  const withReminder: Medication = { ...weekly, reminder: { hour: 9, minute: 30 } };

  it('plans the next dose days at the reminder time', () => {
    const plan = planMedicationReminders(logOf(withReminder), new Date(2026, 10, 15, 8, 0));
    expect(plan.map((p) => p.day)).toEqual(['2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08']);
    expect(plan[0].at).toEqual(new Date(2026, 10, 17, 9, 30));
    expect(plan[0].id).toBe('medication.m1.2026-11-17');
  });

  it('skips today once the time has passed', () => {
    const plan = planMedicationReminders(logOf(withReminder), new Date(2026, 10, 17, 9, 31));
    expect(plan[0].day).toBe('2026-11-24');
  });

  it('skips a day that already has its dose', () => {
    const plan = planMedicationReminders(logOf(withReminder, ['2026-11-17']), new Date(2026, 10, 17, 7, 0));
    expect(plan[0].day).toBe('2026-11-24');
  });

  it('plans nothing for a medication with no reminder time', () => {
    expect(planMedicationReminders(logOf(weekly), new Date(2026, 10, 15))).toEqual([]);
  });

  it('orders several medications by time', () => {
    const daily: Medication = { id: 'm2', name: 'Daily', schedule: { kind: 'daily' }, reminder: { hour: 7, minute: 0 }, createdAt: 0 };
    const plan = planMedicationReminders({ medications: [withReminder, daily], doses: [] }, new Date(2026, 10, 16, 12, 0), 2);
    expect(plan.map((p) => `${p.medicationId}@${p.day}`)).toEqual(['m2@2026-11-17', 'm1@2026-11-17', 'm2@2026-11-18', 'm1@2026-11-24']);
  });
});

describe('the stored shape', () => {
  it('reads nothing as an empty log', () => {
    expect(sanitizeMedicationLog(null)).toEqual(EMPTY_MEDICATION_LOG);
    expect(sanitizeMedicationLog('{}')).toEqual(EMPTY_MEDICATION_LOG);
  });

  it('keeps what is valid and drops what it cannot read', () => {
    const out = sanitizeMedicationLog({
      medications: [
        { id: 'm1', name: '  Zepbound  ', dose: ' 5 mg ', schedule: { kind: 'weekly', weekday: 2 }, reminder: { hour: 9, minute: 30 }, createdAt: 5 },
        { id: 'm2', name: 'No schedule' },
        { id: 'm3', name: 'Bad weekday', schedule: { kind: 'weekly', weekday: 9 } },
        { id: 'm4', name: 'Bad anchor', schedule: { kind: 'interval', everyDays: 3, anchor: '2026-02-30' } },
        { id: 'm1', name: 'Duplicate id', schedule: { kind: 'daily' } },
        { id: 'm5', name: 'Half a reminder', schedule: { kind: 'daily' }, reminder: { hour: 25, minute: 0 } },
      ],
      doses: [
        { id: 'd1', medicationId: 'm1', takenAt: 100, site: 'thigh-left', note: ' fine ' },
        { id: 'd2', medicationId: 'gone', takenAt: 200 },
        { id: 'd3', medicationId: 'm1', takenAt: 'yesterday' },
        { id: 'd4', medicationId: 'm1', takenAt: 300, site: 'elbow' },
      ],
    });
    expect(out.medications).toEqual([
      { id: 'm1', name: 'Zepbound', dose: '5 mg', schedule: { kind: 'weekly', weekday: 2 }, reminder: { hour: 9, minute: 30 }, createdAt: 5 },
      { id: 'm5', name: 'Half a reminder', schedule: { kind: 'daily' }, createdAt: 0 },
    ]);
    expect(out.doses).toEqual([
      { id: 'd4', medicationId: 'm1', takenAt: 300 },
      { id: 'd1', medicationId: 'm1', takenAt: 100, site: 'thigh-left', note: 'fine' },
    ]);
  });

  it('caps the medications and the doses kept', () => {
    const many = Array.from({ length: MEDICATIONS_MAX + 3 }, (_, i) => ({ id: `m${i}`, name: `Med ${i}`, schedule: { kind: 'daily' } }));
    const doses = Array.from({ length: MEDICATION_DOSES_KEPT + 10 }, (_, i) => ({ id: `d${i}`, medicationId: 'm0', takenAt: i + 1 }));
    const out = sanitizeMedicationLog({ medications: many, doses });
    expect(out.medications).toHaveLength(MEDICATIONS_MAX);
    expect(out.doses).toHaveLength(MEDICATION_DOSES_KEPT);
    // Newest kept.
    expect(out.doses[0].takenAt).toBe(MEDICATION_DOSES_KEPT + 10);
  });
});

describe('edits', () => {
  it('adds a medication, and replaces one in place by id', () => {
    const one = withMedication(EMPTY_MEDICATION_LOG, weekly);
    const two = withMedication(one, { ...weekly, id: 'm2', name: 'Second' });
    const edited = withMedication(two, { ...weekly, dose: '7.5 mg' });
    expect(edited.medications.map((m) => `${m.id}:${m.dose ?? ''}`)).toEqual(['m1:7.5 mg', 'm2:5 mg']);
  });

  it('removing a medication removes its doses too', () => {
    const log = withDose(withMedication(EMPTY_MEDICATION_LOG, weekly), { id: 'd1', medicationId: 'm1', takenAt: 10 });
    expect(withoutMedication(log, 'm1')).toEqual(EMPTY_MEDICATION_LOG);
  });

  it('keeps doses newest first, replaces one by id, and removes one', () => {
    let log = withMedication(EMPTY_MEDICATION_LOG, weekly);
    log = withDose(log, { id: 'd1', medicationId: 'm1', takenAt: 10 });
    log = withDose(log, { id: 'd2', medicationId: 'm1', takenAt: 30 });
    log = withDose(log, { id: 'd1', medicationId: 'm1', takenAt: 20, note: 'moved' });
    expect(log.doses.map((d) => `${d.id}@${d.takenAt}`)).toEqual(['d2@30', 'd1@20']);
    expect(withoutDose(log, 'd2').doses.map((d) => d.id)).toEqual(['d1']);
  });

  it('refuses a dose of a medication that is not in the log', () => {
    expect(withDose(EMPTY_MEDICATION_LOG, { id: 'd', medicationId: 'nope', takenAt: 1 }).doses).toEqual([]);
  });
});
