/**
 * The Android half of the rest countdown outside the app: the seam
 * (`src/lib/rest-timer-activity.ts`) drives an ongoing notification through
 * `modules/rest-timer-notification` on Android, with copy in the profile's
 * locale, and reads ITS status — not the iOS Live Activity's — when it
 * reconciles after a JS restart.
 */

const mockActivity = {
  start: jest.fn(async (..._a: unknown[]) => null),
  update: jest.fn(async (..._a: unknown[]) => null),
  end: jest.fn(async () => null),
  status: jest.fn(async () => 'unavailable'),
};
const mockNotif = {
  start: jest.fn(async (..._a: unknown[]) => null),
  update: jest.fn(async (..._a: unknown[]) => null),
  end: jest.fn(async () => null),
  status: jest.fn(async () => 'stopped'),
};

jest.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android } }));
jest.mock('../../modules/rest-timer-activity', () => ({
  startRestActivity: (...a: unknown[]) => mockActivity.start(...a),
  updateRestActivity: (...a: unknown[]) => mockActivity.update(...a),
  endRestActivity: () => mockActivity.end(),
  getRestActivityStatus: () => mockActivity.status(),
  endAllRestActivities: () => mockActivity.end(),
}));
jest.mock('../../modules/rest-timer-notification', () => ({
  startRestNotification: (...a: unknown[]) => mockNotif.start(...a),
  updateRestNotification: (...a: unknown[]) => mockNotif.update(...a),
  endRestNotification: () => mockNotif.end(),
  getRestNotificationStatus: () => mockNotif.status(),
}));

import {
  __currentRestActivity,
  __resetRestActivity,
  end,
  reconcileWithNative,
  restNotificationCopy,
  start,
  sweepOrphans,
  update,
} from '@/lib/rest-timer-activity';

const T0 = 1_759_600_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  __resetRestActivity();
});

describe('restNotificationCopy', () => {
  it('puts the exercise in the title, in the profile locale', () => {
    expect(restNotificationCopy('Bench', 'en')).toEqual({
      title: 'Rest · Bench',
      body: 'Tap to go back to your workout.',
      channel: 'Rest timer',
    });
    expect(restNotificationCopy('Sentadilla', 'es-PR').title).toBe('Descanso · Sentadilla');
    expect(restNotificationCopy('Agachamento', 'pt-BR').channel).toBe('Timer de descanso');
  });

  it('falls back to the default locale for a tag with no dictionary', () => {
    expect(restNotificationCopy('Row', 'xx-YY').title).toBe('Rest · Row');
  });
});

describe('on Android the seam drives the notification', () => {
  it('start, update and end reach the notification module', () => {
    start(T0 + 90_000, 'Bench', 'es-PR', T0);
    expect(mockNotif.start).toHaveBeenCalledWith(
      T0 + 90_000,
      'Descanso · Bench',
      'Toca para volver a tu entrenamiento.',
      'Temporizador de descanso',
    );
    update(T0 + 120_000);
    expect(mockNotif.update).toHaveBeenCalledWith(T0 + 120_000);
    end();
    expect(mockNotif.end).toHaveBeenCalled();
  });

  it('reconcile reads the notification status and restores a rest still running', async () => {
    mockNotif.status.mockResolvedValueOnce(`running:${T0 + 45_000}`);
    const out = await reconcileWithNative('Bench', 'en', T0);
    expect(mockActivity.status).not.toHaveBeenCalled();
    expect(out).toEqual({ type: 'restore', endsAt: T0 + 45_000, seconds: 45 });
    expect(__currentRestActivity()?.endsAt).toBe(T0 + 45_000);
  });

  it('reconcile ends a notification whose deadline has passed', async () => {
    mockNotif.status.mockResolvedValueOnce(`running:${T0 - 1_000}`);
    expect(await reconcileWithNative('Bench', 'en', T0)).toBeNull();
    expect(mockNotif.end).toHaveBeenCalled();
  });

  it('the orphan sweep ends a stale notification', async () => {
    mockNotif.status.mockResolvedValueOnce('stopped');
    await sweepOrphans(T0);
    expect(mockNotif.end).toHaveBeenCalled();
  });
});
