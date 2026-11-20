---
name: owner-data
description: Change one named account's stored data in production from a dated, re-runnable script — log or fix meals, save meals, write the home plan or calendar, edit templates or travel periods. Use when the owner says "log meals for <date>", "update my calendar", "do this for me", or names another account's email with data to enter.
---

# Write an account's data from a script

The app is the normal way data gets in. A script is for what the owner asks to
have entered for them. The script is the record: it is committed, dry-run by
default, and a second run changes nothing.

## Steps

1. **Read what is stored**:
   `npx jiti scripts/user-state.mts <email> <from> [to] [--foods <regex>] [--logs <regex>] [--plan]`
   Done when every row, saved meal, flag and plan field the request names is
   either found, with its document id, or known to be absent.
2. **Reconcile the request with the store**, item by item: create, change the
   existing row, or leave. A meal already logged under another name is renamed
   and moved, never added again. List everything stored for those days that the
   request does not mention: it stays untouched and goes in the report.
3. **Write `scripts/user-data-<YYYY-MM-DD>-<slug>.mts`** (`owner-data-…` when
   only the owner's account is touched) on `scripts/lib/user-data.mts`. Every
   step names its row by id, calls `s.problem(…)` when the stored value is not
   what step 1 read, and plans nothing when the value is already the wanted one.
   New records go through the module's verbs — `s.logMeal`, `s.saveMeal`,
   `s.markDay` — which build the document with core's own writers. A record
   with no verb yet gets one there, on a core writer; a script holds no
   document shape of its own.
4. **Dry run** (`npx jiti scripts/<file>.mts`) and read the plan against the
   request line by line. Done when each request item maps to a plan line or a
   stated reason it has none.
5. **Apply** (`--apply`), then run once more. Done when the second run prints
   `Nothing to do (already applied)`.
6. **Commit the script and report**: the totals as read back from the store,
   every place the result differs from the letter of the request, and what was
   left alone.

## Where things live

- **Log rows** — `dailyLogs`. Label ≤ `LOG_LABEL_MAX` (100), note ≤
  `LOG_NOTE_MAX` (500). Build a new row with core `toLogDoc(withDefaultMealSlot(…))`
  so it has the shape the app writes. A row has no "estimated" flag: say it in
  the note.
- **Day fully logged** — `dailyLogged/{YYYY-MM-DD}` `{ complete, updatedAt }`.
  A complete day feeds the maintenance estimate, so a day still open for a meal
  carries no flag.
- **Saved meals** — two collections. *My Foods* is `customFoods` (`{ name,
  servingSize: 1, servingUnit: 'serving', calories, protein, source: 'manual',
  createdAt }`, no note field); *Quick add* is `presets` (`{ name, calories,
  protein }`). Put a new one where the sibling the request names already lives.
- **Weigh-ins** — `dailyWeights/{YYYY-MM-DD}`.
- **Home plan** — `profile.homePlan` (core `home-plan.ts`, which sanitises it;
  the rules cap the map at 12 keys): dated notes, training days, the review
  card, `weightQuietUntil`, the tape check-in, `estimatedMeals`, `nutrition`
  windows (protein first by date).
- **Travel period** — `profile.travelPeriods`. It freezes the maintenance
  estimate, drops the trip's weigh-ins and makes the first session of each
  template afterwards a re-entry session. A trip that should do none of that is
  written as home-plan notes. A volume waiver is a `{ kind: 'note', volumeOk:
  true }` entry in a period's `plan`.
- **Templates and exercises** — look the ids up; never type one from memory.

## Rules

- **Guard with the app's own functions.** When the request says what the app
  should then show (a re-entry on a date, a review after two rotations), run the
  core function over the planned data (`reentryFor`, `reviewRotations`,
  `nutritionWindowToday`) and refuse when it disagrees.
- **Only the accounts the request names**, and on a second account only the
  rows it names.
- **Steps and activity never reach the measured maintenance estimate** (ADR-0024).
- **A check of a code change is not owner data**: it goes to a throwaway account
  (`test-mobile-web` skill).

Examples: `scripts/user-data-2026-11-20-meals.mts` (rows, flags, saved meals,
two accounts), `scripts/owner-data-2026-11-20-calendar.mts` (home plan,
templates, simulated guards). Scripts before 2026-11-20 carry their own copy of
what `lib/user-data.mts` now holds.
