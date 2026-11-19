/**
 * Owner data, 2026-11-17 (America/La_Paz): fix the logged 11/17 "Santa Cruz
 * Airbnb — Full Body (one-off)" session (`0G7LWF9xKKQN1B5OzctJ`).
 *
 *   RELABEL   "One-arm Cable Overhead Triceps Extension" 30 kg (12/5/4 L,
 *             11/4/4 R) were cable PUSHDOWNS, both arms → `airbnb-cable-pushdown`
 *             "Cable Pushdown (Airbnb)": 2 clusters (no L/R), RIR 0. The
 *             overhead-extension row leaves the session, so that lift has no
 *             11/17 history.
 *   LOADS     "DB hammer curl" (home `LvVitCaOS23MmPTKodlk`, lb): 8 was typed
 *             into an lb row → 8 kg/hand, unit kg, moved to a NEW catalog lift
 *             `airbnb-db-hammer-curl` so the home lb history is untouched.
 *             Captain's chair 54 kg → bodyweight (0); reps / RIR kept.
 *   CLUSTERS  Hammer curl = 1 cluster (A 12 · m 4 · m 4, RIR 0). Deficit
 *             push-up (home `Zqb1sTIfs0olSLeDFlx1`) → `airbnb-deficit-push-up`,
 *             1 cluster (A 9 · m 4 · m 3, RIR 0, BW), so it is never compared
 *             with home. Chest press cluster 2: empty RIR → 0.
 *   SKIPPED   Bulgarian split squat, leg extension, dips: rows with no sets and
 *             `skipped: <reason>` (core `SessionExercise.skipped`) — skipped,
 *             not missed. Status stays `completed`; no `partial` (that would
 *             read "partial"). `sessionNote` says what happened.
 *   STACK     Unmarked ≈11-plate stack, ≈5 kg/plate (±20 %): each set keeps
 *             its kg AND `plate` (row 55 kg = 11, press 50 kg = 10, pushdown
 *             30 kg = 6), cue "estimated load — unmarked stack". The session
 *             stays `notComparable`.
 *   VOLUME    Week of Mon 2026-11-16 recomputed (printed); the plan's
 *             "travel + re-entry — OK" waiver is read back, not changed.
 *   TEMPLATE  Archived (the app did it at 15:54Z; set here if not).
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-17-airbnb-fix.mts [--apply]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  creditsFor,
  dayBoundaryOf,
  hardSetsBetween,
  kgToLb,
  lbToKg,
  toWorkoutExercise,
  toWorkoutSession,
  travelPeriodsOf,
  volumeBetween,
  volumeWaiver,
} from '../packages/core/src/index.ts';
import type { SessionExercise, WorkoutSet } from '../packages/core/src/workout.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = '0G7LWF9xKKQN1B5OzctJ';
const TPL_ID = 'travel-airbnb-2026-11-17';
const CONTEXT = 'Airbnb multi-gym — loads not comparable';
const AIRBNB = 'Airbnb — not compared to home';
const ESTIMATE = 'estimated load — unmarked stack (≈11 vinyl plates, ≈5 kg/plate ±20 %)';
const SESSION_NOTE = 'unstable equipment — skipped split squat, leg extension, dips; added hammer curl + deficit push-up; triceps done as pushdowns';
const HOME_HAMMER = 'LvVitCaOS23MmPTKodlk';
const HOME_PUSHUP = 'Zqb1sTIfs0olSLeDFlx1';
const OH_EXT = 'airbnb-one-arm-cable-oh-triceps-ext';
const PUSHDOWN = 'airbnb-cable-pushdown';
const HAMMER = 'airbnb-db-hammer-curl';
const PUSHUP = 'airbnb-deficit-push-up';
const PLATES: Record<string, number> = { 'airbnb-seated-low-pulley-row': 11, 'airbnb-machine-chest-press': 10, [PUSHDOWN]: 6 };
const KG: Record<string, number> = { 'airbnb-seated-low-pulley-row': 55, 'airbnb-machine-chest-press': 50, [PUSHDOWN]: 30 };
const SKIPS = [
  { exerciseId: 'airbnb-bulgarian-split-squat-db', name: 'Bulgarian Split Squat (DB)', reason: 'no stable bench', before: 'airbnb-pull-up' },
  { exerciseId: 'airbnb-leg-extension', name: 'Leg Extension (multi-gym)', reason: 'machine unstable', group: 'C', pos: 1 as const, before: 'airbnb-captains-chair-leg-raise' },
  { exerciseId: 'airbnb-dips', name: 'Dips (power tower)', reason: 'station unstable', group: 'D', pos: 2 as const, before: 'airbnb-db-curl' },
];
const lb = (k: number) => +kgToLb(k).toFixed(5);
const kgOf = (v?: number) => (v == null ? '—' : `${+lbToKg(v).toFixed(1)}`);
const withCue = (cues: string[] | undefined, ...add: string[]) => [...(cues ?? []), ...add.filter((c) => !(cues ?? []).includes(c))];
const clusterKinds = (sets: WorkoutSet[]) => sets.map((s, i) => ({ ...s, kind: i === 0 ? 'activation' as const : 'mini' as const, group: 1 }));

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const [sesDoc, exSnap, tplDoc, profDoc, recent] = await Promise.all([
  user.collection('workoutSessions').doc(SESSION_ID).get(),
  user.collection('exercises').get(),
  user.collection('workoutTemplates').doc(TPL_ID).get(),
  user.get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(60).get(),
]);
if (!sesDoc.exists) throw new Error('session not found');
const raw = sesDoc.data()!;
if (raw.templateId !== TPL_ID) throw new Error(`session is ${raw.templateId}, not ${TPL_ID}`);
const before = (raw.exercises ?? []) as (SessionExercise & Record<string, unknown>)[];

// ── catalog ──
const catCreates: { id: string; doc: Record<string, unknown> }[] = [];
if (!exSnap.docs.some((d) => d.id === HAMMER)) {
  catCreates.push({ id: HAMMER, doc: { name: 'DB Hammer Curl (Airbnb)', muscles: ['biceps'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'failure', category: 'isolation', createdAt: Timestamp.fromDate(now) } });
}
for (const id of [PUSHDOWN, PUSHUP]) if (!exSnap.docs.some((d) => d.id === id)) throw new Error(`catalog lift ${id} missing`);
const catalog = [...exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data())), ...catCreates.map((c) => toWorkoutExercise(c.id, c.doc))];
const catOf = (id: string) => catalog.find((c) => c.id === id);

// ── session rows ──
const fixRow = (r: SessionExercise & Record<string, unknown>): SessionExercise & Record<string, unknown> => {
  const id = r.exerciseId;
  if (id === OH_EXT || id === PUSHDOWN) {
    const { sideRecommendations: _sr, ...rest } = r;
    return {
      ...rest,
      exerciseId: PUSHDOWN,
      name: 'Cable Pushdown (Airbnb)',
      cues: withCue(id === OH_EXT ? [CONTEXT, 'RIR 0 — to failure'] : r.cues, 'Relabelled 2026-11-17: logged as One-arm Cable Overhead Triceps Extension (L/R); done as cable pushdowns, both arms.', ESTIMATE),
      recommendation: { action: 'calibrate' },
      sets: r.sets.map(({ label: _l, ...s }) => ({ ...s, weight: lb(KG[PUSHDOWN]), unit: 'kg', plate: PLATES[PUSHDOWN], rir: 0 })),
    };
  }
  if (id === HOME_HAMMER || id === HAMMER) {
    return {
      exerciseId: HAMMER,
      name: 'DB Hammer Curl (Airbnb)',
      logStyle: 'weight-reps',
      loadUnit: 'kg',
      cues: withCue(id === HAMMER ? r.cues : [], CONTEXT, 'Added on the day; logged as the home "DB hammer curl" (8 typed into an lb row) — 8 kg per hand.'),
      sets: clusterKinds(r.sets).map((s) => ({ ...s, weight: lb(8), unit: 'kg', rir: 0 })),
    };
  }
  if (id === HOME_PUSHUP || id === PUSHUP) {
    return {
      exerciseId: PUSHUP,
      name: 'Push-up (deficit)',
      logStyle: 'weight-reps',
      loadUnit: 'kg',
      cues: withCue(id === PUSHUP ? r.cues : [], AIRBNB, 'Added on the day; logged as the home "Deficit Push-up" — bodyweight.'),
      sets: clusterKinds(r.sets).map((s) => ({ ...s, weight: 0, unit: 'kg', rir: 0 })),
    };
  }
  if (id === 'airbnb-machine-chest-press' || id === 'airbnb-seated-low-pulley-row') {
    return {
      ...r,
      cues: withCue(r.cues, ESTIMATE),
      sets: r.sets.map((s) => ({ ...s, weight: lb(KG[id]), unit: 'kg', plate: PLATES[id], ...(s.rir == null ? { rir: 0 } : {}) })),
    };
  }
  if (id === 'airbnb-captains-chair-leg-raise') {
    return { ...r, cues: withCue(r.cues, 'Bodyweight — 54 kg was a typo.'), sets: r.sets.map((s) => ({ ...s, weight: 0, unit: 'kg' })) };
  }
  return r;
};
let after = before.map(fixRow);
for (const sk of SKIPS) {
  if (after.some((r) => r.exerciseId === sk.exerciseId)) continue;
  const row = {
    exerciseId: sk.exerciseId,
    name: sk.name,
    logStyle: 'weight-reps' as const,
    loadUnit: 'kg' as const,
    ...(sk.group ? { supersetGroup: sk.group, pairPosition: sk.pos } : {}),
    cues: [CONTEXT],
    sets: [],
    skipped: sk.reason,
  };
  const at = after.findIndex((r) => r.exerciseId === sk.before);
  after = at < 0 ? [...after, row] : [...after.slice(0, at), row, ...after.slice(at)];
}
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Timestamp ? x.toMillis() : x));
const patch: Record<string, unknown> = {};
if (stable(after) !== stable(before)) patch.exercises = after;
if (raw.sessionNote !== SESSION_NOTE) patch.sessionNote = SESSION_NOTE;
if (raw.notComparable !== true) patch.notComparable = true;
if (raw.status !== 'completed') throw new Error(`status is ${raw.status}`);
const archive = tplDoc.exists && tplDoc.get('archivedAt') == null;

// ── report ──
const fixed = toWorkoutSession(SESSION_ID, { ...raw, ...patch });
say(`Session ${SESSION_ID} · ${fixed.templateName} · ${fixed.status} · notComparable ${!!fixed.notComparable} · ${fixed.durationMin} min`);
say(`  note: ${fixed.sessionNote}`);
for (const e of fixed.exercises) {
  const x = e as SessionExercise & { skipped?: string };
  const groups = new Map<string, string[]>();
  for (const s of e.sets) {
    const key = s.kind === 'working' ? 'straight' : `c${s.group}`;
    groups.set(key, [...(groups.get(key) ?? []), `${s.kind === 'activation' ? 'A ' : s.kind === 'mini' ? 'm ' : ''}${s.weight === 0 ? 'BW' : kgOf(s.weight)}${s.plate != null ? `[#${s.plate}]` : ''}×${s.reps}@${s.rir ?? '?'}`]);
  }
  const c = catOf(e.exerciseId);
  const cr = c ? creditsFor(c.name, c.muscles).map((m) => `${m.muscle} ${m.weight}`).join(', ') : '?';
  say(`  ${(e.supersetGroup ? `${e.supersetGroup}${e.pairPosition}` : '—').padEnd(3)} ${e.name.padEnd(40)} ${x.skipped ? `SKIPPED (${x.skipped})` : [...groups].map(([k, v]) => `${k}: ${v.join(' ')}`).join(' | ')}   [${cr}]`);
}

const sessions = recent.docs.map((d) => (d.id === SESSION_ID ? fixed : toWorkoutSession(d.id, d.data())));
const from = new Date('2026-11-16T00:00:00-04:00').getTime();
const to = new Date('2026-11-23T00:00:00-04:00').getTime();
const cl = volumeBetween(sessions, catalog, from, to);
const hs = hardSetsBetween(sessions, catalog, from, to);
const inWeek = sessions.filter((s) => s.status === 'completed' && s.date.getTime() >= from && s.date.getTime() < to);
say(`\nWeek 11/16–11/22: ${inWeek.map((s) => `${s.date.toISOString().slice(0, 10)} ${s.templateName}`).join(', ')}`);
const EXPECT: Record<string, number> = { back: 4, chest: 3, sideDelt: 2, hamstrings: 2, biceps: 2, triceps: 2, abs: 1, quads: 0, calves: 0 };
const byM = new Map(cl.week.map((m) => [m.muscle, m]));
const hsBy = new Map(hs.week.map((m) => [m.muscle, m]));
let mismatch = 0;
for (const m of [...new Set([...Object.keys(EXPECT), ...byM.keys()])]) {
  const v = byM.get(m);
  const d = v?.direct ?? 0;
  const exp = EXPECT[m];
  if (exp != null && exp !== d) mismatch++;
  say(`  ${m.padEnd(11)} direct ${String(d).padStart(2)} · frac ${String(v?.fractional ?? 0).padEnd(4)} · hard sets ${hsBy.get(m)?.direct ?? 0}${exp != null ? (exp === d ? '  ✓' : `  ≠ expected ${exp}`) : ''}`);
}
say(`  unattributed: ${cl.unattributed.join(', ') || '—'}`);
const prof = profDoc.data() ?? {};
const periods = travelPeriodsOf(prof);
for (const d of ['2026-11-17', '2026-11-22', '2026-11-23']) say(`  volume waiver ${d}: ${volumeWaiver(periods, d)?.label ?? '—'}`);
const plan = periods.flatMap((p) => p.plan ?? []);
say('\nPlan 11/16 → 11/23 (read only)');
for (const e of plan) if (e.to >= '2026-11-16' && e.from <= '2026-11-23') say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''}  ${e.kind.padEnd(7)} ${e.label}`);
say(`\nTemplate ${TPL_ID}: archivedAt ${tplDoc.get('archivedAt')?.toDate?.().toISOString() ?? '—'}${archive ? ' → ARCHIVE' : ''}`);
void dayBoundaryOf;

say(`\nPLAN: catalog +${catCreates.length}; session ${Object.keys(patch).join(', ') || 'unchanged'}; template ${archive ? 'ARCHIVE' : 'unchanged'}.${mismatch ? ` ${mismatch} volume mismatch(es)` : ''}`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!catCreates.length && !Object.keys(patch).length && !archive) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const file = join(dir, `owner-data-2026-11-17-airbnb-fix-${now.toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(file, JSON.stringify(conv({ uid, session: { id: SESSION_ID, ...raw }, template: tplDoc.data() ?? null }), null, 1));
if (!existsSync(file)) throw new Error('backup not written — refusing to write');
say(`backup: ${file}`);
const batch = db.batch();
for (const c of catCreates) batch.set(user.collection('exercises').doc(c.id), c.doc);
if (Object.keys(patch).length) batch.update(sesDoc.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
if (archive) batch.update(tplDoc.ref, { archivedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
await batch.commit();
say('Applied.');
