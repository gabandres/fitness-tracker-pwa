/**
 * Today's activation surfaces (2026-11-19): the first-meal card, the reminders
 * ask (moved here from onboarding), the hero's status line for never-logged
 * accounts, and the tracker switches on the metrics card. The gates are pure
 * and pinned in `today-activation-gates.test.ts`; this pins what renders and
 * what each button calls.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, renderHook, renderWithProviders as render } from '@/test-utils';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/VerifyEmailBanner', () => ({ VerifyEmailBanner: () => null }));

const mockReminders = { enabled: false, grant: true };
jest.mock('@/lib/reminders', () => ({
  getReminderSettings: jest.fn(async () => ({ enabled: mockReminders.enabled, meals: {} })),
  setRemindersEnabled: jest.fn(async () => mockReminders.grant),
}));

import { DailyMetrics } from '@/components/DailyMetrics';
import { FirstMealCard } from '@/components/FirstMealCard';
import { HeroRings } from '@/components/HeroRings';
import { ReminderAskCard, reminderAskKey, useReminderAsk } from '@/components/ReminderAskCard';
import { setRemindersEnabled } from '@/lib/reminders';
import { ALL_TRACKERS_ON, NEW_ACCOUNT_TRACKERS } from '@/lib/tracker-prefs';
import { en } from '@/i18n/en';
import type { MeasurementProgress } from '@macrolog/core';

beforeEach(async () => {
  await AsyncStorage.clear();
  mockReminders.enabled = false;
  mockReminders.grant = true;
  (setRemindersEnabled as jest.Mock).mockClear();
});

describe('FirstMealCard', () => {
  it('shows the title, the line and one button that logs', async () => {
    const onLog = jest.fn();
    const view = await render(<FirstMealCard onLog={onLog} />);
    expect(view.getByText(en['firstMeal.title'])).toBeTruthy();
    expect(view.getByText(en['firstMeal.body'])).toBeTruthy();
    const btn = view.getByTestId('first-meal-log');
    expect(btn.props.accessibilityRole).toBe('button');
    await fireEvent.press(btn);
    expect(onLog).toHaveBeenCalledTimes(1);
  });
});

describe('HeroRings hideStatusLine', () => {
  const base = { calConsumed: 0, calTarget: 2000, protConsumed: 0, protTarget: 150, carbs: 0, fat: 0, maintenance: null };
  const progress: MeasurementProgress = {
    loggedDays: 0, neededDays: 14, daysToGo: 14, weighIns: 0, neededWeighIns: 2, weighInsToGo: 2, fraction: 0, notEnoughCompleteDays: false,
  };
  it('default unchanged: the measure line shows', async () => {
    const view = await render(<HeroRings {...base} progress={progress} />);
    expect(view.queryByTestId('measure-progress')).toBeTruthy();
  });
  it('hidden for a never-logged account', async () => {
    const view = await render(<HeroRings {...base} progress={progress} hideStatusLine />);
    expect(view.queryByTestId('measure-progress')).toBeNull();
  });
});

describe('DailyMetrics tracker switches', () => {
  const noop = () => {};
  const props = {
    water: 0, sleep: null, activity: undefined, fastStartedAt: null as Date | null,
    onAddWater: noop, onSetSleep: noop, onStartFast: noop, onBreakFast: noop,
    onSetHunger: noop, onSetDayLogged: noop,
  };
  it('no prefs: every row, as before', async () => {
    const view = await render(<DailyMetrics {...props} />);
    for (const id of ['fast-row', 'water-row', 'sleep-row', 'hunger-row', 'day-logged-row']) {
      expect(view.queryByTestId(id)).toBeTruthy();
    }
  });
  it('new-account prefs: water and sleep only', async () => {
    const view = await render(<DailyMetrics {...props} shown={NEW_ACCOUNT_TRACKERS} />);
    expect(view.queryByTestId('water-row')).toBeTruthy();
    expect(view.queryByTestId('sleep-row')).toBeTruthy();
    expect(view.queryByTestId('fast-row')).toBeNull();
    expect(view.queryByTestId('hunger-row')).toBeNull();
    expect(view.queryByTestId('day-logged-row')).toBeNull();
  });
  it('a running fast shows its row even when fasting is switched off', async () => {
    const view = await render(
      <DailyMetrics {...props} fastStartedAt={new Date(Date.now() - 3_600_000)} shown={NEW_ACCOUNT_TRACKERS} />,
    );
    expect(view.queryByTestId('fast-row')).toBeTruthy();
  });
  it('every row off: the card is not rendered', async () => {
    const off = { fasting: false, water: false, sleep: false, hunger: false, dayLogged: false };
    const view = await render(<DailyMetrics {...props} shown={off} />);
    expect(view.queryByTestId('daily-metrics')).toBeNull();
  });
  it('the steps row keeps its own condition', async () => {
    const off = { ...ALL_TRACKERS_ON, fasting: false, water: false, sleep: false, hunger: false, dayLogged: false };
    const view = await render(
      <DailyMetrics {...props} shown={off} activity={{ steps: 4000 } as never} />,
    );
    expect(view.queryByTestId('activity-value')).toBeTruthy();
  });
});

describe('useReminderAsk + ReminderAskCard', () => {
  async function mountAsk() {
    const hook = await renderHook(() => useReminderAsk('u1'));
    await act(async () => {});
    return hook;
  }

  it('reads reminders off and never answered', async () => {
    const { result } = await mountAsk();
    expect(result.current.remindersOn).toBe(false);
    expect(result.current.answered).toBe(false);
  });

  it('reads a stored answer', async () => {
    await AsyncStorage.setItem(reminderAskKey('u1'), '1');
    const { result } = await mountAsk();
    expect(result.current.answered).toBe(true);
  });

  it('"Turn on reminders" runs the onboarding enable path, then re-plans and closes', async () => {
    const onEnabled = jest.fn();
    const { result } = await mountAsk();
    const view = await render(<ReminderAskCard ask={result.current} onEnabled={onEnabled} />);
    expect(view.getByText(en['reminderAsk.title'])).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('reminder-ask-on'));
    });
    expect(setRemindersEnabled).toHaveBeenCalledWith(true);
    expect(onEnabled).toHaveBeenCalled();
    expect(result.current.answered).toBe(true);
    expect(await AsyncStorage.getItem(reminderAskKey('u1'))).toBe('1');
  });

  it('OS denial: stores the answer, shows the line and Open Settings', async () => {
    mockReminders.grant = false;
    const { result } = await mountAsk();
    await act(async () => {
      await result.current.enable();
    });
    expect(await AsyncStorage.getItem(reminderAskKey('u1'))).toBe('1');
    expect(result.current.phase).toBe('denied');
    // Still on screen so the line can be read.
    expect(result.current.answered).toBe(false);
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const view = await render(<ReminderAskCard ask={result.current} />);
    expect(view.getByTestId('reminder-ask-denied')).toBeTruthy();
    await fireEvent.press(view.getByTestId('reminder-ask-open-settings'));
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });

  it('"Not now" stores the answer without asking the OS', async () => {
    const { result } = await mountAsk();
    await act(async () => {
      result.current.notNow();
    });
    expect(setRemindersEnabled).not.toHaveBeenCalled();
    expect(result.current.answered).toBe(true);
    expect(await AsyncStorage.getItem(reminderAskKey('u1'))).toBe('1');
  });

  it('suppressed renders nothing', async () => {
    const { result } = await mountAsk();
    const view = await render(<ReminderAskCard ask={result.current} suppressed />);
    expect(view.queryByTestId('reminder-ask-card')).toBeNull();
  });
});
