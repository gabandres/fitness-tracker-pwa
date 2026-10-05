/**
 * Every rest notification's id starts with this, then a per-rest suffix.
 *
 * **Must equal `RestDoneNotification.idPrefix` in
 * `targets/_shared/RestActivity.swift`.** The rest Live Activity's "+30 s" and
 * "Skip" buttons run natively while JS may be suspended, and they move or
 * cancel this notification by matching the prefix — otherwise the phone buzzes
 * "rest over" 30 s early, or for a rest the lifter skipped. A prefix rather than
 * one fixed id because each rest still needs its OWN id: the stale-schedule
 * guard in `useRestTimer` cancels by id, and a shared one would cancel the
 * next rest's.
 *
 * Its own module so the foreground handler in `reminders.ts` (which keeps the
 * banner away while the app is open) need not import the timer hook.
 */
export const REST_DONE_ID_PREFIX = 'ignia.restDone.';
