/**
 * The medication log (2026-11-20): kept on the phone, shown on its own screen
 * and on Today, with dose-day reminders.
 *
 * Runs on the real store over the AsyncStorage mock and the real reminders
 * module over a recording notifications mock. The clock is 08:00 on Tuesday
 * 2026-11-17: only `Date` is faked, so promises and timers behave.
 */
type Scheduled = { identifier?: string; content: { title: string; body: string }; trigger: { type: string; date?: Date } };
const mockScheduled: Scheduled[] = [];
/** Identifiers of notifications already DELIVERED and sitting in the shade. */
const mockShown: string[] = [];
let mockPermission = 'granted';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {
    mockScheduled.length = 0;
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    const at = mockScheduled.findIndex((n) => n.identifier === id);
    if (at !== -1) mockScheduled.splice(at, 1);
  }),
  getAllScheduledNotificationsAsync: jest.fn(async () => mockScheduled.map((n) => ({ identifier: n.identifier ?? '' }))),
  scheduleNotificationAsync: jest.fn(async (req: Scheduled) => {
    const at = mockScheduled.findIndex((n) => n.identifier && n.identifier === req.identifier);
    if (at !== -1) mockScheduled.splice(at, 1);
    mockScheduled.push(req);
    return req.identifier ?? 'id';
  }),
  getPresentedNotificationsAsync: jest.fn(async () => mockShown.map((identifier) => ({ request: { identifier } }))),
  dismissNotificationAsync: jest.fn(async (id: string) => {
    const at = mockShown.indexOf(id);
    if (at !== -1) mockShown.splice(at, 1);
  }),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date', WEEKLY: 'weekly' },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Medication, MedicationLog } from '@macrolog/core';
import MedicationScreen from '@/app/medication';
import { MedicationTodayCard } from '@/components/MedicationTodayCard';
import { en } from '@/i18n/en';
import { __resetMedicationStore, clearMedicationLogs, readMedicationLog, writeMedicationLog } from '@/lib/medication';
import { medicationLogText } from '@/lib/medication-text';
import { syncReminders } from '@/lib/reminders';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), en[key] as string)) as Parameters<typeof writeMedicationLog>[2];

const NOW = new Date(2026, 10, 17, 8, 0);
const KEY = 'ignia.medication.v1.u1';
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const weekly = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1',
  name: 'Zepbound',
  dose: '5 mg',
  schedule: { kind: 'weekly', weekday: 2 },
  createdAt: new Date(2026, 10, 1).getTime(),
  ...over,
});
const logWith = (med: Medication, takenAt: number[] = []): MedicationLog => ({
  medications: [med],
  doses: takenAt.map((at, i) => ({ id: `d${i}`, medicationId: med.id, takenAt: at })),
});

beforeEach(async () => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  mockScheduled.length = 0;
  mockShown.length = 0;
  mockPermission = 'granted';
  __resetMedicationStore();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the store on this phone', () => {
  it('reads back what it wrote, sanitised', async () => {
    await writeMedicationLog('u1', { medications: [weekly({ name: '  Zepbound  ' })], doses: [] }, t);
    expect((await readMedicationLog('u1')).medications[0].name).toBe('Zepbound');
    expect(await readMedicationLog('someone-else')).toEqual({ medications: [], doses: [] });
  });

  it('survives storage that holds something unreadable', async () => {
    await AsyncStorage.setItem(KEY, '{not json');
    expect(await readMedicationLog('u1')).toEqual({ medications: [], doses: [] });
  });

  it('an explicit sign-out removes every stored log and its reminders', async () => {
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 9, minute: 0 } })), t);
    await settle();
    expect(mockScheduled.length).toBeGreaterThan(0);
    await clearMedicationLogs();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(mockScheduled).toEqual([]);
  });
});

describe('dose-day reminders', () => {
  it('hands the OS the next dose days at the chosen hour, with no name and no dose in the words', async () => {
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 9, minute: 0 } })), t);
    await settle();
    expect(mockScheduled.map((n) => n.identifier)).toEqual([
      'medication.m1.2026-11-17',
      'medication.m1.2026-11-24',
      'medication.m1.2026-12-01',
      'medication.m1.2026-12-08',
    ]);
    expect(mockScheduled[0].trigger).toEqual({ type: 'date', date: new Date(2026, 10, 17, 9, 0) });
    for (const n of mockScheduled) {
      expect(n.content).toEqual({ title: 'Dose day', body: 'Open Ignia to log it when it is done.' });
      expect(JSON.stringify(n.content)).not.toMatch(/Zepbound|5 mg/);
    }
  });

  it('drops today from the plan once the dose is logged', async () => {
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 9, minute: 0 } }), [NOW.getTime()]), t);
    await settle();
    expect(mockScheduled[0].identifier).toBe('medication.m1.2026-11-24');
  });

  it('plans nothing for a medication with no reminder time', async () => {
    await writeMedicationLog('u1', logWith(weekly()), t);
    await settle();
    expect(mockScheduled).toEqual([]);
  });

  it('comes back after the meal-reminder sync cancels everything', async () => {
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 9, minute: 0 } })), t);
    await settle();
    await syncReminders({ loggedToday: true, streak: 0, daysSinceWeighIn: null, daysSinceLastLog: 0 }, t);
    expect(mockScheduled.filter((n) => n.identifier?.startsWith('medication.'))).toHaveLength(4);
  });
});

describe('a reminder that was already delivered', () => {
  const today = 'medication.m1.2026-11-17';

  it('stays in the shade while its dose is not logged', async () => {
    mockShown.push(today, 'meal-lunch');
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 7, minute: 0 } })), t);
    await settle();
    expect(mockShown).toEqual([today, 'meal-lunch']);
  });

  it('leaves the shade once the dose is logged, and only it', async () => {
    mockShown.push(today, 'meal-lunch');
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 7, minute: 0 } }), [NOW.getTime()]), t);
    await settle();
    expect(mockShown).toEqual(['meal-lunch']);
  });

  it("leaves the shade on sign-out, so it is not the next person's to read", async () => {
    await writeMedicationLog('u1', logWith(weekly({ reminder: { hour: 7, minute: 0 } })), t);
    await settle();
    mockShown.push(today, 'meal-lunch');
    await clearMedicationLogs();
    expect(mockShown).toEqual(['meal-lunch']);
  });

  it('leaves the shade when its medication is removed', async () => {
    mockShown.push(today);
    await writeMedicationLog('u1', { medications: [], doses: [] }, t);
    await settle();
    expect(mockShown).toEqual([]);
  });
});

describe('the Medication screen', () => {
  it('opens on what it is, where it lives, and nothing else', async () => {
    const ui = await render(<MedicationScreen />);
    await settle();
    expect(ui.getByTestId('medication-intro')).toHaveTextContent(/does not give medical advice/);
    expect(ui.getByTestId('medication-privacy')).toHaveTextContent(/Kept on this phone only.*signing out removes it/);
    expect(ui.getByTestId('medication-empty')).toBeTruthy();
    expect(ui.queryByTestId('medication-share')).toBeNull();
  });

  it('adds a weekly medication on today\'s weekday and shows it as a dose day', async () => {
    const ui = await render(<MedicationScreen />);
    await settle();
    await fireEvent.press(ui.getByTestId('medication-add'));
    await fireEvent.changeText(ui.getByTestId('medication-name'), 'Zepbound');
    await fireEvent.changeText(ui.getByTestId('medication-dose'), '5 mg');
    await act(async () => {
      await fireEvent.press(ui.getByTestId('medication-save'));
    });
    await settle();
    const stored = await readMedicationLog('u1');
    expect(stored.medications).toHaveLength(1);
    expect(stored.medications[0]).toMatchObject({ name: 'Zepbound', dose: '5 mg', schedule: { kind: 'weekly', weekday: 2 } });
    const id = stored.medications[0].id;
    expect(ui.getByTestId(`medication-card-${id}`)).toHaveTextContent(/Zepbound.*5 mg.*Every Tuesday/);
    expect(ui.getByTestId(`medication-state-${id}`)).toHaveTextContent('Dose day today');
    expect(mockScheduled).toEqual([]);
  });

  it('cannot save a medication with no name', async () => {
    const ui = await render(<MedicationScreen />);
    await settle();
    await fireEvent.press(ui.getByTestId('medication-add'));
    expect(ui.getByTestId('medication-save').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('logs a dose with a site and shows it in the history', async () => {
    await writeMedicationLog('u1', logWith(weekly()), t);
    const ui = await render(<MedicationScreen />);
    await settle();
    await fireEvent.press(ui.getByTestId('medication-log-m1'));
    await fireEvent.press(ui.getByTestId('medication-site-thigh-left'));
    await fireEvent.changeText(ui.getByTestId('medication-dose-note'), 'evening');
    await act(async () => {
      await fireEvent.press(ui.getByTestId('medication-dose-save'));
    });
    await settle();
    const stored = await readMedicationLog('u1');
    expect(stored.doses).toHaveLength(1);
    expect(stored.doses[0]).toMatchObject({ medicationId: 'm1', dose: '5 mg', site: 'thigh-left', note: 'evening', takenAt: NOW.getTime() });
    expect(ui.getByTestId('medication-state-m1')).toHaveTextContent('Logged today');
    expect(ui.getByTestId('medication-next-m1')).toHaveTextContent(/Next dose day: Tue, Nov 24/);
    expect(ui.getByTestId('medication-history-m1')).toHaveTextContent(/5 mg · Thigh, left · evening/);
    expect(ui.getByTestId('medication-card-m1')).toHaveTextContent(/Last site: Thigh, left/);
    expect(ui.getByTestId('medication-share')).toBeTruthy();
  });

  it('names a dose day that has no entry, without calling it missed', async () => {
    // Wednesday: yesterday was the dose day and nothing was logged.
    jest.setSystemTime(new Date(2026, 10, 18, 8, 0));
    await writeMedicationLog('u1', logWith(weekly()), t);
    const ui = await render(<MedicationScreen />);
    await settle();
    const state = ui.getByTestId('medication-state-m1');
    expect(state).toHaveTextContent('No dose logged for Tue, Nov 17');
    expect(state).not.toHaveTextContent(/miss|late|overdue/i);
  });

  it('saves without the reminder, and says so, when notifications are refused', async () => {
    mockPermission = 'denied';
    const ui = await render(<MedicationScreen />);
    await settle();
    await fireEvent.press(ui.getByTestId('medication-add'));
    await fireEvent.changeText(ui.getByTestId('medication-name'), 'Zepbound');
    await fireEvent(ui.getByTestId('medication-remind'), 'valueChange', true);
    await act(async () => {
      await fireEvent.press(ui.getByTestId('medication-save'));
    });
    await settle();
    expect((await readMedicationLog('u1')).medications[0].reminder).toBeUndefined();
    expect(ui.getByTestId('medication-notice')).toHaveTextContent(/Saved without the reminder/);
    expect(mockScheduled).toEqual([]);
  });

  it('with notifications allowed, the reminder is stored and scheduled', async () => {
    const ui = await render(<MedicationScreen />);
    await settle();
    await fireEvent.press(ui.getByTestId('medication-add'));
    await fireEvent.changeText(ui.getByTestId('medication-name'), 'Zepbound');
    await fireEvent(ui.getByTestId('medication-remind'), 'valueChange', true);
    await fireEvent.press(ui.getByTestId('medication-remind-plus'));
    await act(async () => {
      await fireEvent.press(ui.getByTestId('medication-save'));
    });
    await settle();
    expect((await readMedicationLog('u1')).medications[0].reminder).toEqual({ hour: 10, minute: 0 });
    expect(mockScheduled).toHaveLength(4);
    expect(mockScheduled[0].trigger.date).toEqual(new Date(2026, 10, 17, 10, 0));
  });

  it('an every-few-days schedule counts from the day it was set up', async () => {
    const ui = await render(<MedicationScreen />);
    await settle();
    await fireEvent.press(ui.getByTestId('medication-add'));
    await fireEvent.changeText(ui.getByTestId('medication-name'), 'Other');
    await fireEvent.press(ui.getByTestId('medication-kind-interval'));
    await fireEvent.press(ui.getByTestId('medication-interval-plus'));
    expect(ui.getByTestId('medication-interval')).toHaveTextContent('Every 4 days');
    await act(async () => {
      await fireEvent.press(ui.getByTestId('medication-save'));
    });
    await settle();
    expect((await readMedicationLog('u1')).medications[0].schedule).toEqual({ kind: 'interval', everyDays: 4, anchor: '2026-11-17' });
  });
});

describe('the share text', () => {
  it('lists each medication with its doses, newest first', () => {
    const log: MedicationLog = {
      medications: [weekly()],
      doses: [
        { id: 'd2', medicationId: 'm1', takenAt: new Date(2026, 10, 17, 8, 5).getTime(), dose: '5 mg', site: 'arm-right' },
        { id: 'd1', medicationId: 'm1', takenAt: new Date(2026, 10, 10, 8, 0).getTime(), dose: '2.5 mg', note: 'first' },
      ],
    };
    const text = medicationLogText(log, t, 'en');
    expect(text.split('\n')[0]).toBe('Medication log');
    expect(text).toMatch(/Zepbound · 5 mg · Every Tuesday/);
    expect(text).toMatch(/Nov 17, 2026.*5 mg · Arm, right/);
    expect(text.indexOf('Nov 17')).toBeLessThan(text.indexOf('Nov 10'));
  });
});

describe("Today's card", () => {
  it('is absent for someone with no medication, and on a day with nothing to say', async () => {
    const none = await render(<MedicationTodayCard uid="u1" />);
    await settle();
    expect(none.queryByTestId('medication-today')).toBeNull();
    none.unmount();

    // Thursday, with Tuesday's dose logged: nothing to say.
    jest.setSystemTime(new Date(2026, 10, 19, 8, 0));
    await writeMedicationLog('u1', logWith(weekly(), [new Date(2026, 10, 17, 9, 0).getTime()]), t);
    const quiet = await render(<MedicationTodayCard uid="u1" />);
    await settle();
    expect(quiet.queryByTestId('medication-today')).toBeNull();
  });

  it('on a dose day, logs the usual dose in one tap', async () => {
    await writeMedicationLog('u1', logWith(weekly()), t);
    const ui = await render(<MedicationTodayCard uid="u1" />);
    await settle();
    expect(ui.getByTestId('medication-today-state-m1')).toHaveTextContent('Dose day today');
    await act(async () => {
      await fireEvent.press(ui.getByTestId('medication-today-log-m1'));
    });
    await settle();
    await waitFor(() => expect(ui.getByTestId('medication-today-state-m1')).toHaveTextContent('Logged today'));
    expect(ui.queryByTestId('medication-today-log-m1')).toBeNull();
    expect((await readMedicationLog('u1')).doses[0]).toMatchObject({ medicationId: 'm1', dose: '5 mg' });
  });
});
