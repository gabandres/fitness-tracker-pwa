/**
 * The wall clock, for EVENT handlers that record when something happened
 * (Program v2: when a lift's last set was ticked, for the superset timer's
 * minimum rest). Never call it during render — a render must not read time.
 */
export function nowMs(): number {
  return Date.now();
}
