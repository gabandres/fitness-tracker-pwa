/**
 * The device's IANA time zone ("America/La_Paz"), or undefined when the
 * runtime cannot say. HealthKit buckets a day's steps at midnight in THIS
 * zone, so each stored day records it (core `steps.ts`, `stepDaysToWrite`).
 */
export function deviceTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 && tz.length <= 64 ? tz : undefined;
  } catch {
    return undefined;
  }
}
