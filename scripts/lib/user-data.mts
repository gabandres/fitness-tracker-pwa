/**
 * The shared half of a `scripts/owner-data-*.mts` / `user-data-*.mts` script:
 * auth, the Puerto Rico clock, and a PLAN that is dry-run by default, backs up
 * every document it touches, refuses on any mismatch and writes in one batch.
 *
 *   import { open, at, hm } from './lib/user-data.mts';
 *   const s = await open('user-data-2026-12-01-example');
 *   const owner = await s.user('someone@example.com');
 *   const row = await owner.collection('dailyLogs').doc('abc').get();
 *   if (row.get('calories') !== 530) s.problem('row abc is not the 530 kcal row that was read');
 *   else if (row.get('mealLabel') !== 'New name') s.update(row, { mealLabel: 'New name' }, 'RENAME abc → "New name"');
 *   s.logMeal(owner, { day: '2026-12-01', time: '13:15', label: 'Lunch', kcal: 575, protein: 41 });
 *   s.saveMeal(owner, 'myFoods', { name: 'Lunch bowl', calories: 575, protein: 41 });
 *   s.markDay(await owner.collection('dailyLogged').doc('2026-12-01').get(), true);
 *   await s.run({ report: async () => { ... print the stored result ... } });
 *
 * `logMeal`, `saveMeal` and `markDay` write the records the APP writes, built
 * by core's own writers (`packages/core/src/firestore-writers.ts`): a script
 * runs with admin rights, past the security rules, so the shape has to come
 * from the same code the app uses rather than from a literal typed here.
 *
 * A step plans nothing when the stored value is already the wanted one, so a
 * re-run after `--apply` prints "Nothing to do": that is the proof it landed.
 *
 * Run: `npx jiti scripts/<file>.mts [--apply]` from the repo root. Auth is ADC
 * (`gcloud auth application-default login`). The how-to is the `owner-data` skill.
 */
// The clock is set HERE, before any Date is built: Git Bash on the Windows PC
// drops an inline `TZ=…`, and a script that silently ran in another zone would
// file a 22:30 meal under the next day.
process.env.TZ = 'America/Puerto_Rico';

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  type DocCodec,
  type MealSlot,
  LOG_LABEL_MAX,
  LOG_NOTE_MAX,
  toCustomFoodDoc,
  toLogDoc,
  toPresetDoc,
  withDefaultMealSlot,
} from '../../packages/core/src/index.ts';

export const PROJECT_ID = 'fitness-tracker-gb-1775407101';

/** The same codec the app binds: core's writers build the document, this
 *  supplies the admin SDK's timestamp and delete sentinel. */
export const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };

/** A meal to log: the day and wall-clock time are Puerto Rico's. */
export interface MealInput {
  day: string;
  time: string;
  label: string;
  kcal: number;
  protein: number;
  /** Absent: the slot the app would pick for that time of day. */
  slot?: MealSlot;
  note?: string;
}

/** A saved meal: one serving with its calories and protein. */
export interface SavedMealInput {
  name: string;
  calories: number;
  protein: number;
}
export const ZONE = 'America/Puerto_Rico';

if (new Date(2026, 0, 1).getTimezoneOffset() !== 240) {
  throw new Error(`the process clock is not ${ZONE} (UTC-4); refusing to build dates`);
}

/** A wall-clock moment in Puerto Rico: `at('2026-11-20', '13:15')`. */
export const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);

/** `11/20, 13:15` in Puerto Rico, for plan and report lines. */
export const hm = (d: Date) =>
  d.toLocaleString('en-US', { timeZone: ZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** JSON-safe copy of a document, Timestamps as ISO strings (for the backup). */
export const plain = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};

type Step =
  | { kind: 'update'; ref: DocumentReference; patch: DocumentData }
  | { kind: 'set'; ref: DocumentReference; data: DocumentData }
  | { kind: 'delete'; ref: DocumentReference };

export interface Session {
  db: Firestore;
  apply: boolean;
  /** `users/{uid}` for an email; throws when the account does not exist. */
  user(email: string): Promise<DocumentReference>;
  /** Change fields on a document that was read. Backs up the stored copy. */
  update(snap: DocumentSnapshot, patch: DocumentData, line: string): void;
  /** Create a document, or replace one that was read (then it is backed up). */
  set(ref: DocumentReference, data: DocumentData, line: string, was?: DocumentSnapshot): void;
  /** Delete a document that was read. Backs up the stored copy. */
  remove(snap: DocumentSnapshot, line: string): void;
  /**
   * Log a meal as the app would: core's `toLogDoc` builds the row, so the
   * shape is the one the app writes and reads. The caller checks first that
   * the meal is not already logged (`scripts/user-state.mts`).
   */
  logMeal(user: DocumentReference, meal: MealInput): void;
  /** Save a meal to My Foods (`customFoods`) or Quick add (`presets`), built
   *  by core's writers. The caller checks first that the name is not taken. */
  saveMeal(user: DocumentReference, where: 'myFoods' | 'quickAdd', meal: SavedMealInput): void;
  /**
   * Answer "Day fully logged?" for the flag that was read: `true` / `false`
   * store the answer as the app does, `null` removes it (the day stays open).
   * Plans nothing when the stored answer is already that.
   */
  markDay(flag: DocumentSnapshot, complete: boolean | null): void;
  /** Something stored is not what the script expects: nothing will be written. */
  problem(line: string): void;
  /** A line for the plan that writes nothing ("left alone: …"). */
  note(line: string): void;
  /** Print the plan; with `--apply` and no problems: back up, write, report. */
  run(opts?: { report?: () => Promise<void> }): Promise<never>;
}

/** Firestore batches cap at 500 writes; a script that large should be split. */
const BATCH_MAX = 450;

export async function open(name: string): Promise<Session> {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();
  const apply = process.argv.includes('--apply');
  const steps: Step[] = [];
  const lines: string[] = [];
  const notes: string[] = [];
  const problems: string[] = [];
  const backup: Record<string, unknown> = {};

  const keep = (snap: DocumentSnapshot) => {
    if (!snap.exists) throw new Error(`${snap.ref.path} does not exist: read it before planning a change to it`);
    backup[snap.ref.path] = snap.data();
  };

  return {
    db,
    apply,
    async user(email) {
      return db.doc(`users/${(await getAuth().getUserByEmail(email)).uid}`);
    },
    update(snap, patch, line) {
      keep(snap);
      steps.push({ kind: 'update', ref: snap.ref, patch });
      lines.push(line);
    },
    set(ref, data, line, was) {
      if (was?.exists) keep(was);
      steps.push({ kind: 'set', ref, data });
      lines.push(line);
    },
    remove(snap, line) {
      keep(snap);
      steps.push({ kind: 'delete', ref: snap.ref });
      lines.push(line);
    },
    problem(line) {
      problems.push(line);
    },
    logMeal(user, meal) {
      if (meal.label.length > LOG_LABEL_MAX) return void problems.push(`label over ${LOG_LABEL_MAX} characters: ${meal.label}`);
      if (meal.note && meal.note.length > LOG_NOTE_MAX) return void problems.push(`note over ${LOG_NOTE_MAX} characters (${meal.note.length}): ${meal.label}`);
      const t = at(meal.day, meal.time);
      const row = toLogDoc(
        withDefaultMealSlot(
          { calories: meal.kcal, protein: meal.protein, mealLabel: meal.label, timestamp: t, ...(meal.slot ? { mealType: meal.slot } : {}), ...(meal.note ? { note: meal.note } : {}) },
          t,
        ),
        CODEC,
      );
      steps.push({ kind: 'set', ref: user.collection('dailyLogs').doc(), data: row as DocumentData });
      lines.push(`LOG ${meal.day.slice(5)} ${meal.time} "${meal.label}" ${meal.kcal}/${meal.protein}${meal.note ? ' + note' : ''}`);
    },
    saveMeal(user, where, meal) {
      if (meal.name.length > LOG_LABEL_MAX) return void problems.push(`saved-meal name over ${LOG_LABEL_MAX} characters: ${meal.name}`);
      const data =
        where === 'myFoods'
          ? toCustomFoodDoc({ name: meal.name, servingSize: 1, servingUnit: 'serving', calories: meal.calories, protein: meal.protein, source: 'manual', createdAt: new Date() }, CODEC)
          : toPresetDoc({ name: meal.name, calories: meal.calories, protein: meal.protein });
      steps.push({ kind: 'set', ref: user.collection(where === 'myFoods' ? 'customFoods' : 'presets').doc(), data: data as DocumentData });
      lines.push(`SAVE "${meal.name}" ${meal.calories}/${meal.protein} (${where === 'myFoods' ? 'My Foods, 1 serving' : 'Quick add'})`);
    },
    markDay(flag, complete) {
      const stored = flag.exists ? flag.get('complete') : null;
      const day = flag.ref.id;
      if (complete === null) {
        if (!flag.exists) return;
        keep(flag);
        steps.push({ kind: 'delete', ref: flag.ref });
        lines.push(`dailyLogged/${day} REMOVED (was complete: ${stored}) — the day stays open`);
        return;
      }
      if (stored === complete) return;
      if (flag.exists) keep(flag);
      // The app's own write: both fields, and the server's clock.
      steps.push({ kind: 'set', ref: flag.ref, data: { complete, updatedAt: FieldValue.serverTimestamp() } });
      lines.push(`dailyLogged/${day} → complete: ${complete}${flag.exists ? ` (was ${stored})` : ''}`);
    },
    note(line) {
      notes.push(line);
    },
    async run({ report } = {}) {
      console.log(`${apply ? 'APPLY' : 'DRY RUN'} ${name} — now ${new Date().toString()}`);
      console.log(`\nPLAN (${lines.length}):`);
      for (const l of lines) console.log(`  ${l}`);
      for (const n of notes) console.log(`  · ${n}`);
      if (problems.length) {
        console.log(`\nREFUSING — stored data is not what this script expects:\n${problems.map((p) => `  ${p}`).join('\n')}`);
        process.exit(1);
      }
      if (steps.length > BATCH_MAX) throw new Error(`${steps.length} writes: split the script (one batch is the unit that lands or does not)`);
      if (!apply || steps.length === 0) {
        if (report) { console.log('\nAs stored now:'); await report(); }
        console.log(apply ? '\nNothing to do (already applied).' : '\nDry run. Re-run with --apply to write.');
        process.exit(0);
      }
      const dir = join(homedir(), 'ignia-backups');
      const file = join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(plain(backup), null, 1));
      if (!existsSync(file)) throw new Error('backup not written — refusing to write');
      console.log(`\nbackup written: ${file}`);
      const batch = db.batch();
      for (const s of steps) {
        if (s.kind === 'update') batch.update(s.ref, s.patch);
        else if (s.kind === 'set') batch.set(s.ref, s.data);
        else batch.delete(s.ref);
      }
      await batch.commit();
      console.log(`written: ${steps.length} change(s).`);
      if (report) { console.log('\nAs stored now:'); await report(); }
      process.exit(0);
    },
  };
}
