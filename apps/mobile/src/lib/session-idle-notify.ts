/**
 * The device half of the workout timer's auto-stop (core `session-idle.ts`):
 * the "Still training?" local notification, its two buttons, the lifter's
 * "Keep going" answers, and the hand-off from a notification tap to the Train
 * screen.
 *
 * Kept per device on purpose: the notification is local, and so is the
 * question it asks. A "Keep going" on this phone says nothing about another.
 *
 * Every call swallows its own failure — a lost reminder is not a lost workout.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { TFn } from '@/i18n';

/** Every idle notification's id starts with this, then the session id. The
 *  foreground handler (`reminders.ts`) keeps its banner away while the app is
 *  open — the Train screen asks in-app at the same moment. */
export const SESSION_IDLE_ID_PREFIX = 'ignia.sessionIdle.';
export const SESSION_IDLE_CATEGORY = 'ignia.sessionIdle';
export const IDLE_ACTION_CONTINUE = 'continue';
export const IDLE_ACTION_END = 'end';

let categoryReady: Promise<void> | null = null;

/** Register the notification's "Keep going" / "End session" buttons, once per
 *  run. Both open the app: the session lives in the app's state, and ending it
 *  from a background action would race the screen's own copy. */
export function ensureIdleCategory(t: TFn): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  categoryReady ??= Notifications.setNotificationCategoryAsync(SESSION_IDLE_CATEGORY, [
    { identifier: IDLE_ACTION_CONTINUE, buttonTitle: t('train.idle.actionContinue'), options: { opensAppToForeground: true } },
    { identifier: IDLE_ACTION_END, buttonTitle: t('train.idle.actionEnd'), options: { opensAppToForeground: true } },
  ]).then(() => undefined, () => undefined);
  return categoryReady;
}

/** Schedule "Still training?" for `at`, replacing the session's last one.
 *  Only with permission already granted — never asks (see `useRestTimer`). */
export async function scheduleIdleNotification(sessionId: string, at: Date, t: TFn): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await cancelIdleNotifications();
    if (at.getTime() <= Date.now()) return;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await ensureIdleCategory(t);
    await Notifications.scheduleNotificationAsync({
      identifier: `${SESSION_IDLE_ID_PREFIX}${sessionId}`,
      content: {
        title: t('train.idle.notifTitle'),
        body: t('train.idle.notifBody'),
        categoryIdentifier: SESSION_IDLE_CATEGORY,
        data: { sessionIdle: sessionId },
        interruptionLevel: 'timeSensitive',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // Not scheduled: the in-app ask and the next foreground still apply.
  }
}

/** Cancel every pending or delivered idle notification. One session is ever
 *  open, so any with the prefix is stale once this is called. */
export async function cancelIdleNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((n) => n.identifier.startsWith(SESSION_IDLE_ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) => n.request.identifier.startsWith(SESSION_IDLE_ID_PREFIX))
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})),
    );
  } catch {
    // Not listable (a test double): nothing else to do.
  }
}

// ── The lifter's answers, per session ──

export interface IdleMarks {
  /** The last "Keep going" — restarts the idle clock (core `idleState`). */
  keepGoingAt?: number;
  /** The last time the stale-session question was asked (core `isStaleOpen`). */
  staleAskedAt?: number;
}

const marksKey = (sessionId: string) => `ignia.sessionIdle.marks.${sessionId}`;

export async function readIdleMarks(sessionId: string): Promise<IdleMarks> {
  try {
    const raw = await AsyncStorage.getItem(marksKey(sessionId));
    const v = raw ? (JSON.parse(raw) as IdleMarks) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export async function writeIdleMarks(sessionId: string, marks: IdleMarks): Promise<void> {
  try {
    await AsyncStorage.setItem(marksKey(sessionId), JSON.stringify(marks));
  } catch {
    // A lost mark asks once more; nothing worse.
  }
}

export async function clearIdleMarks(sessionId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(marksKey(sessionId));
  } catch {
    // ignore
  }
}

// ── Notification tap → Train ──

export interface IdleTap {
  sessionId: string;
  action: 'continue' | 'end';
}

let pendingTap: IdleTap | null = null;
const handled = new Set<string>();

/** Read an idle notification's tap, once. The body tap is "continue" ("Tap to
 *  continue or end session"). Null for any other notification, or one already
 *  read. */
export function idleTapOf(r: Notifications.NotificationResponse | null | undefined): IdleTap | null {
  if (!r) return null;
  const req = r.notification.request;
  if (!req.identifier.startsWith(SESSION_IDLE_ID_PREFIX)) return null;
  const key = `${req.identifier}|${r.actionIdentifier}|${r.notification.date}`;
  if (handled.has(key)) return null;
  handled.add(key);
  return {
    sessionId: req.identifier.slice(SESSION_IDLE_ID_PREFIX.length),
    action: r.actionIdentifier === IDLE_ACTION_END ? 'end' : 'continue',
  };
}

/** The router stashes a tap here; the Train screen takes it when it mounts. */
export function stashIdleTap(tap: IdleTap): void {
  pendingTap = tap;
  for (const l of tapListeners) l();
}

export function takeIdleTap(): IdleTap | null {
  const tap = pendingTap;
  pendingTap = null;
  return tap;
}

const tapListeners = new Set<() => void>();
export function onIdleTap(listener: () => void): () => void {
  tapListeners.add(listener);
  return () => tapListeners.delete(listener);
}
