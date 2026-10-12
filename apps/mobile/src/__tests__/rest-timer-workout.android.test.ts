/**
 * S23-8 round 2b on Android (REVIEW-R2-NATIVE P1-2): inside an armed workout on
 * a binary with `workout`, the notification's receiver owns the "Rest over"
 * buzz, so `useRestTimer` must not schedule a second one; outside a workout,
 * or on an older binary, the JS schedule is the only buzz there is.
 */

const mockNotifWorkout = jest.fn(async (_json: string) => null);
let mockWorkoutAvailable = true;

jest.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android } }));
jest.mock('../../modules/rest-timer-activity', () => ({
  startRestActivity: jest.fn(async () => null),
  updateRestActivity: jest.fn(async () => null),
  endRestActivity: jest.fn(async () => null),
  getRestActivityStatus: jest.fn(async () => 'unavailable'),
  endAllRestActivities: jest.fn(async () => null),
  isRestActivityWorkoutAvailable: false,
  syncRestActivityWorkout: jest.fn(async () => 'unavailable'),
}));
jest.mock('../../modules/rest-timer-notification', () => ({
  startRestNotification: jest.fn(async () => null),
  updateRestNotification: jest.fn(async () => null),
  endRestNotification: jest.fn(async () => null),
  getRestNotificationStatus: jest.fn(async () => 'stopped'),
  get isRestNotificationWorkoutAvailable() {
    return mockWorkoutAvailable;
  },
  syncRestNotificationWorkout: (json: string) => mockNotifWorkout(json),
}));

import { __resetRestActivity, armWorkout, endWorkout, nativeOwnsRestAlert, start } from '@/lib/rest-timer-activity';

beforeEach(() => {
  jest.clearAllMocks();
  mockWorkoutAvailable = true;
  __resetRestActivity();
});

it('hands the buzz to native only inside an armed workout on a binary that has it', () => {
  expect(nativeOwnsRestAlert()).toBe(false);
  armWorkout('s1', [], 'en');
  expect(nativeOwnsRestAlert()).toBe(true);
  endWorkout();
  expect(nativeOwnsRestAlert()).toBe(false);
  mockWorkoutAvailable = false;
  armWorkout('s1', [], 'en');
  expect(nativeOwnsRestAlert()).toBe(false);
});

it("sends native the rest's own rest-over text, for its alert", () => {
  armWorkout('s1', [], 'en');
  start(Date.now() + 60_000, 'Leg Extensions', 'en', Date.now(), 'Next: A2 · Leg Curls');
  const sent = JSON.parse(mockNotifWorkout.mock.calls.at(-1)![0]);
  expect(sent.rest.alertBody).toBe('Next: A2 · Leg Curls');
  expect(sent.copy.alertChannel).toBe('Rest over alerts');
});
