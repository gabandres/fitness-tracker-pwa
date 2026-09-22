#!/usr/bin/env node
/**
 * Stamp `logStyle: 'time'` on a SESSION exercise whose sets already hold a
 * `durationSec` but which carries no `logStyle` of its own.
 *
 * ## Why this exists
 *
 * `scripts/migrate-time-sets-duration.mjs` (2026-09-16) moved legacy plank
 * holds from `reps` to `durationSec`, and decided WHICH rows to move by
 * falling back to the catalog when the session exercise had no `logStyle`.
 * But it only rewrote the sets. It never wrote `logStyle` onto the exercise.
 *
 * No reader consults the catalog. Every one of them resolves the style as
 * `ex.logStyle ?? DEFAULT_LOG_STYLE`, and `DEFAULT_LOG_STYLE` is
 * `'weight-reps'` (`packages/core/src/workout.ts`). So after that migration
 * those rows resolved to weight-reps and were read through `reps`, which the
 * migration had just emptied — `isLoggedSet` returned false and the holds
 * stayed invisible in history, in volume and in the CSV. The migration
 * swapped one invisibility for another, and on 2026-08-24 it CAUSED one: that
 * row read fine as `reps: 90` beforehand.
 *
 * ## What it writes
 *
 * `logStyle: 'time'` and nothing else, and only where all four hold: the
 * exercise name resolves to a `time`-style catalog entry, the row has no
 * `logStyle` already, at least one set carries `durationSec`, and NO set
 * carries `reps`. It never invents a duration, never moves a value between
 * fields, and skips an active session (the device rewrites it whole).
 *
 * A row with neither field is left alone — those are genuinely empty scaffold
 * sets (the owner has three from 2026-06-15) and stamping them would change
 * nothing except their shape.
 *
 *   node scripts/stamp-time-logstyle.mjs --email <email>            # dry run
 *   node scripts/stamp-time-logstyle.mjs --email <email> --apply
 *
 * Auth: ADC or GOOGLE_APPLICATION_CREDENTIALS, as with the other repair
 * scripts here.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const TZ = 'America/Puerto_Rico';

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: node scripts/stamp-time-logstyle.mjs (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;

// Same collapse as packages/core `exerciseNameKey`, inlined: this is a plain
// .mjs script and core is TypeScript (precedent: migrate-time-sets-duration).
const key = (n) => String(n ?? '').trim().toLowerCase().replace(/[.,/#!$%^&*;:{}=_`~()]/g, '').replace(/\s+/g, ' ');

const cat = await db.collection(`users/${uid}/exercises`).get();
const timeNames = new Set(cat.docs.filter((d) => d.data().logStyle === 'time').map((d) => key(d.data().name)));
console.log(`${apply ? '' : '[dry run] '}time-style catalog: ${[...timeNames].join(', ') || '(none)'}`);

const snap = await db.collection(`users/${uid}/workoutSessions`).get();
const todo = [];
const skippedActive = [];
for (const doc of snap.docs) {
  const d = doc.data();
  let changed = false;
  const exercises = (d.exercises ?? []).map((ex) => {
    const sets = ex.sets ?? [];
    const eligible = timeNames.has(key(ex.name))
      && ex.logStyle !== 'time'
      && sets.some((s) => s.durationSec != null)
      && !sets.some((s) => s.reps != null);
    if (!eligible) return ex;
    changed = true;
    return { ...ex, logStyle: 'time' };
  });
  if (!changed) continue;
  if (d.status === 'active') { skippedActive.push(doc.id); continue; }
  const when = d.timestamp?.toDate?.();
  const date = when ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(when) : '(no timestamp)';
  todo.push({ date, ref: doc.ref, id: doc.id, exercises });
}
todo.sort((a, b) => a.date.localeCompare(b.date));

console.log(`\nsessions to stamp: ${todo.length}`);
for (const t of todo) console.log(`  ${apply ? 'STAMP' : 'would'}  ${t.date}  ${t.id}`);
if (skippedActive.length) console.log(`  ACTIVE session skipped, re-run when finished: ${skippedActive.join(', ')}`);

if (!apply) { console.log('\nDry run — re-run with --apply.'); process.exit(0); }
for (const t of todo) await t.ref.update({ exercises: t.exercises });
console.log(`\nApplied ${todo.length} update(s).`);
