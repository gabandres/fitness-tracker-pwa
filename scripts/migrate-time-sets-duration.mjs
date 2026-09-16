#!/usr/bin/env node
/**
 * One-time repair: a `time`-style set that stores its seconds in `reps`.
 *
 * ## What actually broke
 *
 * Plank was logged as a normal reps exercise for months, and the number typed
 * into `reps` was always SECONDS (2026-08-24 = 90, 07-06 = 85, 06-30 = 71,
 * 06-23 = 61). On 2026-09-02 the Plank catalog doc gained `logStyle: 'time'`,
 * and from then on the app wrote the same number into `durationSec`, which is
 * correct (2026-09-08 = 67, 2026-09-15 = 92).
 *
 * `isLoggedSet(s, 'time')` reads `durationSec` and nothing else
 * (`packages/core/src/workout.ts`). So the moment the catalog flipped, every
 * plank logged BEFORE it stopped counting as logged at all — it vanished from
 * history and from volume without a single write touching it. The data was
 * never lost; it became unreadable, which looks identical from the app.
 *
 * The owner first reported this as the mirror image ("plank saves with a kind
 * but no reps since 09-08"). That framing is wrong: the post-09-02 rows are
 * correct, and an empty `reps` on a time-style lift is correct by design. The
 * bug is entirely in the rows the flip left behind.
 *
 * ## What this does
 *
 * For every set of an exercise that resolves to `logStyle: 'time'`, where
 * `durationSec` is absent and `reps` is present: move the value
 * (`durationSec = reps`, `reps` deleted). Nothing else is touched.
 *
 * ## What it refuses to do
 *
 * This is surgery on live logged history, so it is a dry run unless you pass
 * `--apply`, and it ABORTS rather than half-applying when:
 *
 *  - a target set is dated ON OR AFTER the cutoff. That would mean a client is
 *    STILL writing seconds into `reps`, so the shape is not legacy, it is a
 *    live bug — and migrating underneath it races the device.
 *  - a target value is outside {@link PLAUSIBLE} seconds. A time-style set of
 *    3 or of 4,000 is not a hold this script understands, and guessing at it
 *    is how a repair becomes a corruption.
 *  - a set has BOTH fields with different values. There is no rule for which
 *    one wins that is not a guess.
 *
 * A set with NEITHER field is left alone: those are genuinely empty scaffold
 * rows (the owner has three from 2026-06-15) and they are not this script's
 * business.
 *
 * An ACTIVE session is reported and skipped — the device writes it back whole,
 * so a write here would be overwritten. Re-run after it is finished.
 *
 *   node scripts/migrate-time-sets-duration.mjs --uid <uid>            # dry run
 *   node scripts/migrate-time-sets-duration.mjs --uid <uid> --apply
 *   node scripts/migrate-time-sets-duration.mjs --all-users            # dry run
 *
 * Auth: ADC (`gcloud auth application-default login`) or
 * GOOGLE_APPLICATION_CREDENTIALS. Same precedent as
 * `scripts/mark-legacy-effort-standard.mjs`.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

/**
 * The catalog flip (`logStyle: 'time'` on Plank) landed 2026-09-02. Anything
 * still carrying the old shape AFTER this instant is a live client bug, not
 * legacy data, and the script aborts on it rather than racing the device.
 * Generous by a week on purpose: the first correctly-shaped log is 09-08, and
 * the gap between the flip and that log is exactly the window where a stale
 * app build could still have written the old shape legitimately.
 */
const CUTOFF = new Date('2026-09-08T00:00:00-04:00');

/** Seconds a held position can plausibly be. Outside this, abort and ask. */
const PLAUSIBLE = { min: 5, max: 1800 };

const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const uidArg = arg('uid');
const allUsers = has('all-users');
const apply = has('apply');

if (!uidArg && !allUsers) {
  console.error('usage: node scripts/migrate-time-sets-duration.mjs (--uid <uid> | --all-users) [--apply]');
  process.exit(2);
}

// Same collapse as packages/core `exerciseNameKey` — inlined because this is a
// plain .mjs script and core is TypeScript. Mirrors mark-legacy-effort-standard.mjs.
const nameKey = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~()]/g, '')
    .replace(/\s+/g, ' ');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

/** Names (collapsed) of this user's catalog exercises with logStyle 'time'. */
async function timeStyleKeys(uid) {
  const cat = await db.collection('users').doc(uid).collection('exercises').get();
  const keys = new Set();
  const names = [];
  for (const doc of cat.docs) {
    const d = doc.data();
    if (d.logStyle !== 'time') continue;
    keys.add(nameKey(d.name));
    names.push(d.name);
  }
  return { keys, names };
}

async function migrateUser(uid) {
  const { keys, names } = await timeStyleKeys(uid);
  const snap = await db.collection('users').doc(uid).collection('workoutSessions').get();

  const moves = [];       // { date, name, from, sessionId }
  const refusals = [];    // { reason, ... } — any entry means abort
  const activeSkipped = [];
  const emptyLeft = [];
  const writes = [];      // { ref, exercises }

  for (const doc of snap.docs) {
    const data = doc.data();
    const when = data.timestamp?.toDate?.() ?? null;
    const date = when ? when.toISOString().slice(0, 10) : '(no timestamp)';
    let changed = false;

    const exercises = (data.exercises ?? []).map((ex) => {
      // The exercise's own logStyle wins; the catalog entry is the fallback,
      // and it is the fallback that matters here — the whole bug is that the
      // catalog changed while the logged rows did not.
      const style = ex.logStyle ?? (keys.has(nameKey(ex.name)) ? 'time' : null);
      if (style !== 'time') return ex;

      const sets = (ex.sets ?? []).map((s) => {
        const hasDur = s.durationSec != null;
        const hasReps = s.reps != null;

        if (hasDur && hasReps && Number(s.durationSec) !== Number(s.reps)) {
          refusals.push({ reason: 'both fields disagree', date, name: ex.name, durationSec: s.durationSec, reps: s.reps, sessionId: doc.id });
          return s;
        }
        if (hasDur) return s;                       // already correct
        if (!hasReps) { emptyLeft.push({ date, name: ex.name, sessionId: doc.id }); return s; }

        const secs = Number(s.reps);
        if (!Number.isFinite(secs) || secs < PLAUSIBLE.min || secs > PLAUSIBLE.max) {
          refusals.push({ reason: `reps=${s.reps} is not plausible seconds`, date, name: ex.name, sessionId: doc.id });
          return s;
        }
        if (when && when >= CUTOFF) {
          refusals.push({ reason: 'dated on/after the cutoff — a client may still be writing this shape', date, name: ex.name, sessionId: doc.id });
          return s;
        }

        changed = true;
        moves.push({ date, name: ex.name, from: secs, sessionId: doc.id });
        const { reps: _dropped, ...rest } = s;
        return { ...rest, durationSec: secs };
      });

      return { ...ex, sets };
    });

    if (!changed) continue;
    if (data.status === 'active') { activeSkipped.push(doc.id); continue; }
    writes.push({ ref: doc.ref, exercises });
  }

  return { uid, names, moves, refusals, activeSkipped, emptyLeft, writes, sessions: snap.size };
}

const uids = allUsers
  ? (await db.collection('users').listDocuments()).map((d) => d.id)
  : [uidArg];

console.log(`${apply ? '' : '[dry run] '}cutoff < ${CUTOFF.toISOString()} · ${uids.length} user(s)`);

const results = [];
for (const uid of uids) results.push(await migrateUser(uid));

let aborted = false;
for (const r of results) {
  if (r.moves.length === 0 && r.refusals.length === 0 && r.emptyLeft.length === 0) continue;
  console.log(`\n${r.uid} — ${r.sessions} sessions · time-style catalog: ${r.names.join(', ') || '(none)'}`);
  for (const m of r.moves) console.log(`  MOVE  ${m.date}  ${m.name}: reps ${m.from} → durationSec ${m.from}`);
  for (const e of r.emptyLeft) console.log(`  leave ${e.date}  ${e.name}: neither field — genuinely empty, untouched`);
  for (const x of r.refusals) { aborted = true; console.log(`  REFUSE ${x.date}  ${x.name}: ${x.reason} (${x.sessionId})`); }
  if (r.activeSkipped.length) console.log(`  ACTIVE session skipped, re-run when finished: ${r.activeSkipped.join(', ')}`);
}

const totalMoves = results.reduce((n, r) => n + r.moves.length, 0);
const totalWrites = results.reduce((n, r) => n + r.writes.length, 0);

if (aborted) {
  console.error(`\nABORTED — ${results.reduce((n, r) => n + r.refusals.length, 0)} set(s) this script will not guess at. Nothing was written.`);
  process.exit(1);
}

if (!apply) {
  console.log(`\n[dry run] would move ${totalMoves} set(s) across ${totalWrites} session(s). Re-run with --apply.`);
  process.exit(0);
}

for (const r of results) {
  let batch = db.batch();
  let pending = 0;
  for (const w of r.writes) {
    batch.update(w.ref, { exercises: w.exercises });
    if (++pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending > 0) await batch.commit();
}
console.log(`\nmoved ${totalMoves} set(s) across ${totalWrites} session(s).`);
