#!/usr/bin/env node
/**
 * One-time repair on the owner's account, requested 2026-09-30. Three parts,
 * and ONLY these — every other row is left alone by construction:
 *
 *  1. **RIR 0 on the 2026-09-29 Leg Day sets that stored none.** Leg
 *     Extensions ×3, Standing calf raise ×3, Weighted Floor Crunch ×6. The key
 *     is ABSENT in Firestore (not null), so it never reached the store — the
 *     export was not the cause (see the CHANGELOG entry of the same date). Each
 *     set is matched on exercise name + position AND on the reps/weight the
 *     owner reported, so a session that is not the one described is refused
 *     rather than patched.
 *
 *  2. **Weigh-in 2026-09-28 = 156.4 lb.** One doc,
 *     `users/{uid}/dailyWeights/2026-09-28` = `{ weight }` in pounds — the same
 *     shape `setDailyWeight` writes, so every reader treats it as logged.
 *
 *  3. **Two tape measurements**: 2026-09-14 waist 32.25 / neck 14.5 and
 *     2026-09-28 waist 32.00 / neck 14.5, inches, stamped 09:00 local (the
 *     owner's measurements land between 07:00 and 09:30). The shape is
 *     `toMeasurementDoc`'s: `{ timestamp, waist, neck }`.
 *
 * NOT backfilled, on purpose (values unknown; a fabricated number corrupts
 * progression silently): Skull Crusher 09-24 load, plank 09-29, plank 09-08 /
 * 09-11 / 09-15.
 *
 * Dry run unless `--apply`. REFUSES (exit 1, nothing written) when a target
 * set's reps/weight differ from the report, a set already carries a
 * DIFFERENT rir, the session is still active, a weigh-in exists with another
 * value, or a measurement already exists on either day. A value already equal
 * to the target is a no-op, so re-runs are safe.
 *
 *   node scripts/backfill-2026-09-30.mjs --email gabrielandresbermudez@gmail.com
 *   node scripts/backfill-2026-09-30.mjs --email gabrielandresbermudez@gmail.com --apply
 *
 * Auth: ADC (`gcloud auth application-default login`), same as
 * `backfill-2026-09-21.mjs`.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const TZ = 'America/Puerto_Rico';

const SESSION_DATE = '2026-09-29';
/** exercise name → the sets as reported: [kind, reps, weight]. */
const RIR_TARGETS = {
  'Leg Extensions': [['activation', 13, 70], ['mini', 5, 70], ['mini', 3, 70]],
  'Standing calf raise': [['activation', 12, 25], ['mini', 5, 25], ['mini', 4, 25]],
  'Weighted Floor Crunch': [
    ['activation', 15, 25], ['mini', 7, 25], ['mini', 6, 25],
    ['activation', 15, 25], ['mini', 6, 25], ['mini', 5, 25],
  ],
};
const WEIGH_IN = { date: '2026-09-28', lb: 156.4 };
/** 09:00 at UTC-4 (Puerto Rico has no DST). */
const MEASUREMENTS = [
  { date: '2026-09-14', at: '2026-09-14T13:00:00Z', waist: 32.25, neck: 14.5 },
  { date: '2026-09-28', at: '2026-09-28T13:00:00Z', waist: 32.0, neck: 14.5 },
];

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const email = arg('email');
let uid = arg('uid');
if (!email && !uid) {
  console.error('usage: node scripts/backfill-2026-09-30.mjs (--email <email> | --uid <uid>) [--apply]');
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
if (!uid) uid = (await getAuth().getUserByEmail(email)).uid;
const user = db.collection('users').doc(uid);
console.log(`${apply ? '' : '[dry run] '}uid ${uid}`);

const localDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const refusals = [];
const writes = [];

// ── 1. RIR ──────────────────────────────────────────────────────────────
const sessions = (await user.collection('workoutSessions').get()).docs
  .filter((d) => { const t = d.data().timestamp?.toDate?.(); return t && localDate(t) === SESSION_DATE; });
if (sessions.length !== 1) {
  refusals.push(`${SESSION_DATE}: expected exactly one session, found ${sessions.length}`);
} else {
  const doc = sessions[0];
  const data = doc.data();
  if (data.status !== 'completed') refusals.push(`${SESSION_DATE}: session ${doc.id} is ${data.status} — the device writes it back whole; finish it first`);
  let patched = 0;
  const exercises = data.exercises.map((ex) => {
    const want = RIR_TARGETS[ex.name];
    if (!want) return ex;
    if (ex.sets.length !== want.length) {
      refusals.push(`${ex.name}: ${ex.sets.length} sets stored, ${want.length} reported`);
      return ex;
    }
    const sets = ex.sets.map((s, j) => {
      const [kind, reps, weight] = want[j];
      const label = `${ex.name} set ${j} (${s.kind} ${s.reps} @ ${s.weight})`;
      if (s.kind !== kind || s.reps !== reps || s.weight !== weight) {
        refusals.push(`${label}: does not match the report (${kind} ${reps} @ ${weight})`);
        return s;
      }
      if (s.rir === 0) { console.log(`${label}: rir already 0`); return s; }
      if (s.rir != null) { refusals.push(`${label}: already stores rir=${s.rir} — not overwriting`); return s; }
      patched++;
      console.log(`${apply ? 'SET  ' : 'WOULD'} ${label}: rir (absent) → 0`);
      return { ...s, rir: 0 };
    });
    return { ...ex, sets };
  });
  const seen = new Set(data.exercises.map((e) => e.name));
  for (const name of Object.keys(RIR_TARGETS)) if (!seen.has(name)) refusals.push(`${SESSION_DATE}: no "${name}" in session ${doc.id}`);
  if (patched > 0) writes.push({ label: `workoutSessions/${doc.id}: ${patched} set(s) rir ← 0`, run: () => doc.ref.update({ exercises }) });
}

// ── 2. Weigh-in ─────────────────────────────────────────────────────────
const wRef = user.collection('dailyWeights').doc(WEIGH_IN.date);
const wSnap = await wRef.get();
if (!wSnap.exists) writes.push({ label: `dailyWeights/${WEIGH_IN.date} ← { weight: ${WEIGH_IN.lb} }`, run: () => wRef.set({ weight: WEIGH_IN.lb }) });
else if (Number(wSnap.data().weight) === WEIGH_IN.lb) console.log(`${WEIGH_IN.date}: already ${WEIGH_IN.lb} lb`);
else refusals.push(`${WEIGH_IN.date}: a weigh-in exists with weight=${wSnap.data().weight} — not overwriting`);

// ── 3. Measurements ─────────────────────────────────────────────────────
const existing = (await user.collection('measurements').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
for (const m of MEASUREMENTS) {
  const same = existing.filter((e) => localDate(e.timestamp.toDate()) === m.date);
  if (same.length === 0) {
    const doc = { timestamp: Timestamp.fromDate(new Date(m.at)), waist: m.waist, neck: m.neck };
    writes.push({ label: `measurements/<new> ← ${m.at} waist ${m.waist} neck ${m.neck}`, run: () => user.collection('measurements').add(doc) });
  } else if (same.length === 1 && same[0].waist === m.waist && same[0].neck === m.neck) {
    console.log(`${m.date}: measurement already present (${same[0].id})`);
  } else {
    refusals.push(`${m.date}: ${same.length} measurement(s) already on that day — not adding another`);
  }
}

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
