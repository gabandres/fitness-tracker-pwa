#!/usr/bin/env node
/**
 * One-time repair on the owner's account, requested 2026-09-21. Two parts:
 *
 *  1. **Plank 2026-09-21 = 100 seconds.** The report said plank rows "save
 *     with setKind but no duration" on 09-08, 09-11, 09-15 and 09-21. In code
 *     a plank is a `time`-style exercise and its count is `durationSec`;
 *     `reps` is empty on it BY DESIGN (ADR-0028; `isLoggedSet(s, 'time')`
 *     reads `durationSec` and nothing else). The previous round of this report
 *     (2026-09-16, `migrate-time-sets-duration.mjs`) found the post-09-02 rows
 *     correct in Firestore and only the pre-flip rows unreadable. So this
 *     script PRINTS every plank set on the five reported dates with all four
 *     fields before it touches anything, and it writes `durationSec: 100` on
 *     the 09-21 set ONLY when that set carries neither `reps` nor
 *     `durationSec`. A set that already holds a duration is left alone and
 *     reported — the value the user is missing is then in the database and
 *     the reader that showed them a blank is the bug, not the write.
 *
 *     09-08, 09-11 and 09-15 are never written. Their durations are unknown
 *     and a fabricated one corrupts progression history silently.
 *
 *  2. **Two weigh-ins**: 2026-09-19 = 156.4 lb and 2026-09-20 = 155.6 lb.
 *     A weigh-in is exactly one doc, `users/{uid}/dailyWeights/{YYYY-MM-DD}`
 *     = `{ weight }` in pounds (`setDailyWeight` in `apps/mobile/src/lib/
 *     ledger.ts`; the `weight_logged` event is analytics and the Health
 *     mirror is device-only, so neither applies to a backfill). Every reader
 *     — the Body trend, Trends, `dailyTargets` → the measured maintenance
 *     estimate — subscribes to that collection, so a doc written here is
 *     indistinguishable from one logged on the day. Nothing is written for
 *     09-21; if a 09-21 weigh-in exists it is reported, never deleted.
 *
 * Dry run unless `--apply`. REFUSES (exit 1, nothing written) when:
 *  - the 09-21 plank set already has a `durationSec` other than 100, or the
 *    session has more than one plank set with neither field (which one is
 *    the 100 is then a guess), or the session is still `active`;
 *  - a target weigh-in doc exists with a different value.
 * A doc that already holds the target value is a no-op, so re-runs are safe.
 *
 *   node scripts/backfill-2026-09-21.mjs --email gabrielandresbermudez@gmail.com
 *   node scripts/backfill-2026-09-21.mjs --email gabrielandresbermudez@gmail.com --apply
 *
 * Auth: ADC (`gcloud auth application-default login`) or
 * GOOGLE_APPLICATION_CREDENTIALS — same as `migrate-time-sets-duration.mjs`.
 * Runs from the Windows workstation, where ADC lives; `ignia-mac` has neither
 * gcloud nor a key (checked 2026-09-21).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
/** The owner's local day. es-PR account; the migration script used -04:00 too. */
const TZ = 'America/Puerto_Rico';

const PLANK_DATES = ['2026-08-24', '2026-09-08', '2026-09-11', '2026-09-15', '2026-09-21'];
const PLANK_FIX = { date: '2026-09-21', durationSec: 100 };
const WEIGH_INS = { '2026-09-19': 156.4, '2026-09-20': 155.6 };
const NO_WEIGH_IN = '2026-09-21';
const AVG_WINDOW = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: node scripts/backfill-2026-09-21.mjs (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const nameKey = (s) => String(s ?? '').trim().toLowerCase().replace(/[.,/#!$%^&*;:{}=_`~()]/g, '').replace(/\s+/g, ' ');
const localDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const fmt = (s) => `kind=${s.kind ?? '-'} reps=${s.reps ?? 'null'} durationSec=${s.durationSec ?? 'null'} rir=${s.rir ?? 'null'} done=${s.done ?? '-'}`;

const refusals = [];
const writes = []; // { label, run }

// ── 1. Plank ────────────────────────────────────────────────────────────
const sessions = await db.collection('users').doc(uid).collection('workoutSessions').get();
const plankSessions = [];
for (const doc of sessions.docs) {
  const data = doc.data();
  const when = data.timestamp?.toDate?.();
  if (!when) continue;
  const date = localDate(when);
  if (!PLANK_DATES.includes(date)) continue;
  const planks = (data.exercises ?? []).map((ex, i) => ({ ex, i })).filter(({ ex }) => nameKey(ex.name) === 'plank');
  if (planks.length === 0) continue;
  plankSessions.push({ doc, data, date, planks });
}
plankSessions.sort((a, b) => a.date.localeCompare(b.date));

console.log('\n── Plank sets on the reported dates (all fields, as stored) ──');
for (const date of PLANK_DATES) {
  const hits = plankSessions.filter((s) => s.date === date);
  if (hits.length === 0) { console.log(`${date}  (no session with a Plank exercise)`); continue; }
  for (const s of hits) {
    for (const { ex } of s.planks) {
      console.log(`${date}  ${s.doc.id}  status=${s.data.status}  exercise.logStyle=${ex.logStyle ?? 'undefined'}`);
      for (const set of ex.sets ?? []) console.log(`            ${fmt(set)}`);
    }
  }
}

const fixTargets = plankSessions.filter((s) => s.date === PLANK_FIX.date);
if (fixTargets.length !== 1) {
  refusals.push(`${PLANK_FIX.date}: expected exactly one session with a Plank, found ${fixTargets.length}`);
} else {
  const s = fixTargets[0];
  if (s.data.status === 'active') refusals.push(`${PLANK_FIX.date}: session ${s.doc.id} is still active — the device writes it back whole; finish it first`);
  const empties = [];
  const held = [];
  for (const { ex, i } of s.planks) {
    (ex.sets ?? []).forEach((set, j) => {
      if (set.durationSec != null) held.push({ i, j, set });
      else if (set.reps == null) empties.push({ i, j });
      else refusals.push(`${PLANK_FIX.date}: set ${j} stores reps=${set.reps} on a time-style exercise — the old shape; run migrate-time-sets-duration.mjs, not this`);
    });
  }
  if (held.length > 0 && empties.length === 0) {
    const vals = held.map((h) => h.set.durationSec);
    if (vals.length === 1 && vals[0] === PLANK_FIX.durationSec) {
      console.log(`\n${PLANK_FIX.date}: durationSec is already ${PLANK_FIX.durationSec} — nothing to do.`);
    } else {
      refusals.push(`${PLANK_FIX.date}: the hold is already in the database (durationSec=${vals.join(',')}). The write path worked; whatever showed a blank is a reader, not the store. Not overwriting a logged value.`);
    }
  } else if (empties.length === 1 && held.length === 0) {
    const { i, j } = empties[0];
    const exercises = s.data.exercises.map((ex, ei) => ei !== i ? ex : {
      ...ex,
      sets: ex.sets.map((set, sj) => sj !== j ? set : { ...set, durationSec: PLANK_FIX.durationSec }),
    });
    writes.push({
      label: `${PLANK_FIX.date} Plank set ${j}: durationSec ← ${PLANK_FIX.durationSec} (session ${s.doc.id})`,
      run: () => s.doc.ref.update({ exercises }),
    });
  } else if (empties.length > 1) {
    refusals.push(`${PLANK_FIX.date}: ${empties.length} plank sets carry neither field — which one is the 100 s hold is a guess`);
  } else if (empties.length === 1 && held.length > 0) {
    refusals.push(`${PLANK_FIX.date}: one set holds a duration and one is empty — ambiguous, decide by hand`);
  } else {
    refusals.push(`${PLANK_FIX.date}: no plank set found on the session`);
  }
}

// ── 2. Weigh-ins ────────────────────────────────────────────────────────
const weightsCol = db.collection('users').doc(uid).collection('dailyWeights');
console.log('\n── Weigh-ins ──');
for (const [dateKey, lb] of Object.entries(WEIGH_INS)) {
  const snap = await weightsCol.doc(dateKey).get();
  const existing = snap.exists ? snap.data()?.weight : undefined;
  if (existing === undefined) {
    writes.push({ label: `dailyWeights/${dateKey} ← { weight: ${lb} }`, run: () => weightsCol.doc(dateKey).set({ weight: lb }) });
  } else if (Number(existing) === lb) {
    console.log(`${dateKey}: already ${lb} lb — nothing to do.`);
  } else {
    refusals.push(`${dateKey}: a weigh-in already exists with weight=${existing} (asked for ${lb}) — not overwriting`);
  }
}
const noSnap = await weightsCol.doc(NO_WEIGH_IN).get();
if (noSnap.exists) console.log(`NOTE ${NO_WEIGH_IN}: a weigh-in EXISTS (weight=${noSnap.data()?.weight}). The request said there is none; leaving it as is.`);
else console.log(`${NO_WEIGH_IN}: no weigh-in, as expected — none created.`);

// ── Decide ──────────────────────────────────────────────────────────────
console.log('');
for (const r of refusals) console.log(`REFUSE  ${r}`);
for (const w of writes) console.log(`${apply ? 'WRITE ' : 'WOULD '} ${w.label}`);

if (refusals.length > 0) {
  console.log('\nAborted: nothing written (refusals above).');
  process.exit(1);
}
if (apply) {
  for (const w of writes) await w.run();
  console.log(`\nApplied ${writes.length} write(s).`);
} else if (writes.length > 0) {
  console.log('\nDry run — re-run with --apply.');
}

// ── 7-day average, as the collection reads now ──────────────────────────
// Fetched by ID rather than by a `__name__` range: the doc ids ARE the dates,
// so seven point reads need no index and cannot be tripped by how the Admin
// SDK resolves a document-id range.
const after = await db.getAll(...AVG_WINDOW.map((k) => weightsCol.doc(k)));
const byDay = new Map(after.filter((d) => d.exists).map((d) => [d.id, Number(d.data().weight)]));
// In a dry run, fold the pending writes in so the number printed is the one --apply will produce.
if (!apply) for (const [k, v] of Object.entries(WEIGH_INS)) if (!byDay.has(k)) byDay.set(k, v);
console.log(`\n── Weigh-ins ${AVG_WINDOW[0]} … ${AVG_WINDOW[AVG_WINDOW.length - 1]}${apply ? '' : ' (dry run: pending writes folded in)'} ──`);
for (const k of AVG_WINDOW) console.log(`${k}  ${byDay.has(k) ? byDay.get(k).toFixed(1) + ' lb' : '—'}`);
const vals = AVG_WINDOW.filter((k) => byDay.has(k)).map((k) => byDay.get(k));
if (vals.length === 0) console.log('7-day average: no weigh-ins in the window');
else console.log(`7-day average (${vals.length} of 7 days weighed): ${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)} lb`);
