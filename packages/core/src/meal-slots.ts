import type { DailyLog, LogEntry, MealType } from './types';

/** A diary slot: the four meal types plus `other` for untagged entries. */
export type MealSlot = MealType | 'other';

export interface MealGroup {
  slot: MealSlot;
  entries: DailyLog[];
  /** Sum of calories across the group's entries. */
  totalCalories: number;
}

/** Fixed diary order; untagged entries fall into `other` last. */
const SLOT_ORDER: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

/**
 * Group day entries into diary slots (breakfast → lunch → dinner → snack →
 * other) with per-slot calorie subtotals, in fixed order. Entries keep their
 * given order within a slot. Empty slots are omitted. Pure port of the Angular
 * ui-day-summary `mealGroups`.
 */
export function groupByMealSlot(logs: DailyLog[]): MealGroup[] {
  const buckets = new Map<MealSlot, DailyLog[]>();
  for (const l of logs) {
    const slot: MealSlot = l.mealType ?? 'other';
    const arr = buckets.get(slot);
    if (arr) arr.push(l);
    else buckets.set(slot, [l]);
  }
  const groups: MealGroup[] = [];
  for (const slot of SLOT_ORDER) {
    const entries = buckets.get(slot);
    if (entries && entries.length > 0) {
      groups.push({ slot, entries, totalCalories: entries.reduce((s, l) => s + l.calories, 0) });
    }
  }
  return groups;
}

/**
 * Which meal slot an entry logged at `at` most likely belongs to.
 *
 * ## Why this exists
 *
 * `mealType` is optional and every add surface left it `undefined`, so anything
 * logged without explicitly tapping the meal field fell into `other`. On a real
 * day that produced two entries two minutes apart — 12:52 PM and 12:54 PM — in
 * *different* buckets, and an `other` group larger than dinner. The user was not
 * being inconsistent; one entry had the field tapped and the other did not.
 *
 * Making the clock supply a default removes a required decision from every add,
 * which is the cheapest simplification available to that flow.
 *
 * ## Why a snack band, and why the edges are wide
 *
 * A confidently wrong slot is worse than no slot: `other` reads as "untagged",
 * while "Dinner" on a 3 PM cookie reads as a bug. So the bands that people eat
 * *meals* in are narrow and everything between them is `snack` — the slot whose
 * meaning is closest to "not really a meal", and the one it is least costly to
 * be wrong about.
 *
 * Local time on purpose: this is about the user's day, not UTC.
 *
 * The result is a **default, never a decision** — every caller must let the user
 * override it, and the diary keeps `other` for entries that genuinely have no
 * slot.
 */
export function slotForTime(at: Date): MealType {
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (minutes < 10 * 60 + 30) return 'breakfast'; // until 10:30
  if (minutes < 14 * 60 + 30) return 'lunch'; //     10:30 – 14:30
  if (minutes < 17 * 60 + 30) return 'snack'; //     14:30 – 17:30
  if (minutes < 21 * 60 + 30) return 'dinner'; //    17:30 – 21:30
  return 'snack'; //                                 late night
}

/**
 * Whether a row represents food the user ate — the only kind of row a diary
 * slot means anything for.
 *
 * `dailyLogs` also carries two marker shapes: the 0-kcal `exerciseCompleted`
 * row that makes a training day count toward the streak, and weight-bearing
 * rows. Neither is a meal, and tagging them would file a workout under Lunch.
 */
export function isMealRow(entry: Pick<LogEntry, 'exerciseCompleted' | 'weight'>): boolean {
  return entry.exerciseCompleted !== true && entry.weight == null;
}

/**
 * Fill in `mealType` from the clock when the caller left it absent.
 *
 * ## Why the write path owns this
 *
 * The default used to sit in `useToday`'s add wrapper, one level above the
 * ledger. `useHistory` has an add wrapper too — the day-detail sheet — and it
 * never got the same line, so the identical meal filed into its slot when
 * logged from Today and into `other` when logged from a past day. A default
 * that every caller has to remember is not a default.
 *
 * It belongs at the write, which is the one point every in-app add surface
 * passes through, and which no new surface can be written without touching.
 *
 * An explicit choice always wins: this only fills an ABSENT `mealType`. The
 * widget/tile quick-add path deliberately does not come through here (see
 * `quickAddEntry` — a preset tapped from a home screen carries no meal, and
 * `addLogWithId` is its write).
 *
 * `at` is the fallback clock for an entry with no timestamp of its own; an
 * entry that carries one is slotted by *its* time, which is what makes a
 * back-dated add from History land correctly.
 */
export function withDefaultMealSlot(entry: LogEntry, at: Date): LogEntry {
  if (entry.mealType != null || !isMealRow(entry)) return entry;
  return { ...entry, mealType: slotForTime(entry.timestamp ?? at) };
}
