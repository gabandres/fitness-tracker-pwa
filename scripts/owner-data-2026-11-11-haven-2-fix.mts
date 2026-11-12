/**
 * Owner data, 2026-11-11 (America/La_Paz): fix the 11/11 "Haven 2 — Hinge/
 * Pull/Arms (simplified)" session and close the Haven trip block.
 *
 *   SESSION   oIDkIFEzzxRoiCp5TMj2 (started 2026-11-11 07:10 La Paz)
 *             · B1 "Pull-up (neutral / overhand)" → "Lat Pulldown (wide)"
 *               (`haven-lat-pulldown-wide`): the 35 kg sets (14/4/4, 14/4/3,
 *               RIR 0) were done on the lat pulldown machine. Core
 *               `swapToAlternative` builds the row (the pull-up becomes its
 *               first alternative; the pull-up's frozen call, `linkedHome` and
 *               progression go), then the logged sets are put back unchanged.
 *               Cue "Note: pulldown machine — load = stack". Credits: core
 *               `creditsFor` → back 1 direct, biceps 0.5.
 *               The 11/6 bodyweight pull-up history is not touched.
 *             · D1 Pec Deck: rows 4–6 re-tagged (were mini/mini/working, all
 *               group 1) → cluster 1 = A 11 · m 3 · m 3, cluster 2 = A 10 ·
 *               m 4 · m 4, RIR 0, weights and `loggedAt` kept.
 *             · `sessionNote` "~24 h after Haven 1; strength up …".
 *   HAVEN 2   · B1 Pull-up stays primary. At Finish the engine moved its
 *               `targetLoad` 0 → 37.5 kg off the mislabelled sets; reverted
 *               to bodyweight (0) with a `loadLog` entry. + "Lat Pulldown
 *               (wide)" as FIRST alternative at 40 kg (One-arm DB Row second).
 *             · Next starting loads (owner, 11/11): RDL 12.5, lateral 7.5,
 *               shoulder press 30 (go up at ≥ 12), leg ext 40, pec deck 25,
 *               rear delt 35 → 37.5, arm curl 25, triceps 25. Each row's
 *               "Start …" cue is re-dated to 11/11.
 *             · − the one-day cue "Note: back-to-back day; user chose failure
 *               — 3 rest days follow" (it was for 11/11; the session keeps it).
 *   HAVEN 1   arm curl 20 → 25, triceps 20 → 25, lateral 7.5 (same lifts).
 *             Home templates use their own ids/loads: re-entry (−10 %, RIR 2)
 *             is derived by the app — not touched here.
 *   PLAN      Haven 2 note "done · block complete"; Travel A 11/14 Buena
 *             Vista, Travel B 11/16 Santa Cruz; 11/19 re-entry note names home
 *             v2.3; + note 11/23 "Home v2.4 starts".
 *   VOLUME    week of Mon 2026-11-09 recomputed with the fixes (printed).
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-11-haven-2-fix.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  type RowAlternative,
  type TravelPlanEntry,
  creditsFor,
  dayBoundaryOf,
  hardSetsBetween,
  kgToLb,
  lbToKg,
  sessionCall,
  swapToAlternative,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelWeek,
  volumeBetween,
} from '../packages/core/src/index.ts';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSet } from '../packages/core/src/workout.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = 'oIDkIFEzzxRoiCp5TMj2';
const GYM = 'Haven Gym';
const H1_ID = 'travel-haven-1';
const H2_ID = 'travel-haven-2';
const PULLUP = 'GOGOcWJNC9q9aBmN3ENq';
const PULLDOWN = 'haven-lat-pulldown-wide';
const PULLDOWN_NAME = 'Lat Pulldown (wide)';
const PEC = 'haven-pec-deck';
const STACK_CUE = 'Note: pulldown machine — load = stack';
const RELABEL_CUE = 'Relabelled 2026-11-11: logged as Pull-up (neutral / overhand), done on the lat pulldown machine.';
const SESSION_NOTE = '~24 h after Haven 1; strength up on leg ext (35→40), arm curl (20→25), triceps machine (20→25), shoulder press (+1 rep)';
const B2B_CUE = 'Note: back-to-back day; user chose failure — 3 rest days follow';
const kg = (v: number) => +kgToLb(v).toFixed(2);
const kgOf = (lb?: number) => (lb == null ? '—' : `${+lbToKg(lb).toFixed(1)}`);
const near = (lb: number | undefined, k: number) => lb != null && Math.abs(lbToKg(lb) - k) < 0.05;

/** Next starting loads (owner, 2026-11-11) and the cue each row starts from. */
const NEXT: Record<string, { kg: number; cue: string }> = {
  vtSvqglnBZdM1f3qOJi4: { kg: 12.5, cue: 'Start 12.5 kg — 11/11: 12.5 × 10, 8 @ RIR 1.' },
  'haven-db-lateral-raise': { kg: 7.5, cue: 'Start 7.5 kg — 11/11: 7.5 × 11 (+ 4, 3) @ RIR 0; cleaner reps at 10–15.' },
  'haven-shoulder-press-machine': { kg: 30, cue: 'Start 30 kg — 11/11: 30 × 11 @ RIR 0 (+1 rep); go up when the activation reaches ≥ 12.' },
  'haven-leg-extension': { kg: 40, cue: 'Start 40 kg — 11/11: 40 × 12, 11 @ RIR 0 (up from 35).' },
  [PEC]: { kg: 25, cue: 'Start 25 kg — 11/11: 25 × 11, 10 @ RIR 0.' },
  'haven-rear-delt-machine': { kg: 37.5, cue: 'Start 37.5 kg — 11/11: 35 × 12, 12 @ RIR 0.' },
  'haven-arm-curl-machine': { kg: 25, cue: 'Start 25 kg — 11/11: 25 × 9 @ RIR 1 (up from 20).' },
  'haven-triceps-extension-machine': { kg: 25, cue: 'Start 25 kg — 11/11: 25 × 13 @ RIR 0 (up from 20).' },
};
const PULLDOWN_KG = 40;
const PULLDOWN_ALT: RowAlternative = {
  exerciseId: PULLDOWN,
  name: PULLDOWN_NAME,
  targetLoad: kg(PULLDOWN_KG),
  logStyle: 'weight-reps',
  cues: [
    STACK_CUE,
    'RIR 1 — stop 1 rep before failure; minis RIR 0–1',
    `Start ${PULLDOWN_KG} kg — 11/11: 35 kg × 14, 14 (minis 4/4, 4/3) @ RIR 0.`,
    'Progression: activation ≥ 12 at target effort → increase load next session.',
  ],
  note: 'alternative',
};

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const [profileSnap, sesDoc, exSnap, h1Doc, h2Doc, recentSnap] = await Promise.all([
  user.get(),
  user.collection('workoutSessions').doc(SESSION_ID).get(),
  user.collection('exercises').get(),
  user.collection('workoutTemplates').doc(H1_ID).get(),
  user.collection('workoutTemplates').doc(H2_ID).get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
]);
if (!sesDoc.exists || sesDoc.get('templateId') !== H2_ID) throw new Error(`${SESSION_ID} is not the Haven 2 session`);
if (!h1Doc.exists || !h2Doc.exists) throw new Error('Haven templates missing');
const raw = sesDoc.data()!;
const lt = ((raw.exercises ?? []) as { sets: { loggedAt?: unknown }[] }[]).flatMap((e) => e.sets).map((s) => s.loggedAt);
if (!lt.every((x) => x == null || typeof x === "string")) throw new Error("loggedAt is not a string — the JSON round-trip would mangle it");
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const catOf = (id: string) => catalog.find((c) => c.id === id);
const pulldownCat = catOf(PULLDOWN);
if (!pulldownCat || pulldownCat.name !== PULLDOWN_NAME) throw new Error(`${PULLDOWN} is not "${PULLDOWN_NAME}"`);

// ── session ──
const exercises = (raw.exercises ?? []) as SessionExercise[];
const reps = (e: SessionExercise) => e.sets.map((s) => s.reps).join('/');
const nextExercises = exercises.map((e) => {
  if (e.exerciseId === PULLUP) {
    if (reps(e) !== '14/4/4/14/4/3' || !e.sets.every((s) => near(s.weight, 35))) throw new Error(`pull-up row is not the 35 kg 14/4/4, 14/4/3: ${reps(e)}`);
    // Not a calibration: the row ran as a real RIR 0 session, so the engine judges it.
    const swapped = swapToAlternative({ ...e, sets: e.sets.map((s) => ({ ...s, done: false })) }, { exerciseId: PULLDOWN, name: PULLDOWN_NAME, logStyle: 'weight-reps', cues: [STACK_CUE, RELABEL_CUE] }, false);
    return { ...swapped, sets: e.sets };
  }
  if (e.exerciseId === PEC) {
    if (reps(e) === '11/3/3/10/4/4' && e.sets.map((s) => `${s.kind}${s.group ?? ''}`).join(',') === 'activation1,mini1,mini1,activation2,mini2,mini2') return e; // applied
    if (reps(e) !== '11/3/3/10/4/4' || e.sets.length !== 6) throw new Error(`pec deck rows are not 11/3/3/10/4/4: ${reps(e)}`);
    const tags: [WorkoutSet['kind'], number][] = [['activation', 1], ['mini', 1], ['mini', 1], ['activation', 2], ['mini', 2], ['mini', 2]];
    return { ...e, sets: e.sets.map((s, i) => ({ ...s, kind: tags[i][0], group: tags[i][1], rir: 0 })) };
  }
  return e;
});
const sessionPatch: Record<string, unknown> = {};
if (JSON.stringify(nextExercises) !== JSON.stringify(exercises)) sessionPatch.exercises = nextExercises;
if (raw.sessionNote !== SESSION_NOTE) sessionPatch.sessionNote = SESSION_NOTE;

// ── templates ──
type Row = TemplateExercise & Record<string, unknown>;
function editTemplate(doc: FirebaseFirestore.DocumentSnapshot) {
  const rows = (doc.get('exercises') as Row[]).map((r) => ({ ...r, cues: [...(r.cues ?? [])] }));
  const changes: string[] = [];
  const touch = (r: Row, what: string) => { r.lastModifiedAt = stamp; r.lastModifiedBy = 'prompt'; changes.push(`${r.supersetGroup}${r.pairPosition} ${r.name}: ${what}`); };
  const setLoad = (r: Row, lb: number, reason: string) => {
    const from = r.targetLoad;
    r.targetLoad = lb;
    r.loadLog = [...((r.loadLog as unknown[]) ?? []), { at: stamp, to: lb, ...(from != null ? { from } : {}), by: 'prompt', reason }];
    touch(r, `targetLoad ${kgOf(from)} → ${kgOf(lb)} kg`);
  };
  for (const r of rows) {
    if (r.cues.includes(B2B_CUE)) { r.cues = r.cues.filter((c) => c !== B2B_CUE); touch(r, '− back-to-back cue (11/11 only)'); }
    if (r.exerciseId === PULLUP) {
      if (r.targetLoad !== 0) setLoad(r, 0, 'revert the engine 0 → 37.5 kg: the 11/11 sets were on the lat pulldown (relabelled); pull-up is bodyweight (owner, 2026-11-11)');
      const alts = (r.alternatives ?? []) as RowAlternative[];
      if (alts[0]?.exerciseId !== PULLDOWN || JSON.stringify(alts[0]) !== JSON.stringify(PULLDOWN_ALT)) {
        r.alternatives = [PULLDOWN_ALT, ...alts.filter((a) => a.exerciseId !== PULLDOWN)];
        touch(r, `alternatives → ${r.alternatives.map((a) => a.name).join(', ')}`);
      }
      continue;
    }
    const n = NEXT[r.exerciseId];
    if (!n) continue;
    if (!near(r.targetLoad, n.kg)) setLoad(r, kg(n.kg), `next start ${n.kg} kg after 11/11 (owner, 2026-11-11)`);
    const at = r.cues.findIndex((c) => /^Start /.test(c));
    if (at >= 0 && r.cues[at] !== n.cue) { r.cues[at] = n.cue; touch(r, `cue → "${n.cue}"`); }
    if (at < 0) { const p = r.cues.findIndex((c) => /^Progression:/.test(c)); r.cues.splice(p < 0 ? r.cues.length : p, 0, n.cue); touch(r, `+ cue "${n.cue}"`); }
  }
  return { rows, changes };
}
const h1 = editTemplate(h1Doc);
const h2 = editTemplate(h2Doc);
if (!h2.rows.some((r) => r.exerciseId === PULLUP && r.supersetGroup === 'B' && r.pairPosition === 1)) throw new Error('Haven 2 B1 is not the pull-up');

// ── plan ──
const prof = profileSnap.data()!;
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip is not on the profile');
const oldPlan = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
const NOTES: Record<string, Partial<TravelPlanEntry>> = {
  '2026-11-11 session': { note: 'done 11/11 (48 min), ~24 h after Haven 1 · Haven trip block complete' },
  '2026-11-14 session': { note: 'bodyweight · Buena Vista' },
  '2026-11-16 session': { note: 'bodyweight · Santa Cruz' },
  '2026-11-17 session': { note: 'optional — Tue 11/17 or Wed 11/18' },
  '2026-11-19 note': { label: 'Re-entry — home v2.3', note: 'home v2.3 at −10% load, RIR 2 (post-travel re-entry); first Leg / Pull / Push back' },
};
let plan = oldPlan.map((e) => ({ ...e, ...(NOTES[`${e.from} ${e.kind}`] ?? {}) }));
const V24: TravelPlanEntry = { from: '2026-11-23', to: '2026-11-23', kind: 'note', label: 'Home v2.4 starts', note: 'v2.4 from 2026-11-23 (2×/week chest, back, hamstrings; calves raised)' };
if (!plan.some((e) => e.from === V24.from && e.kind === 'note')) plan = [...plan, V24];
plan.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
for (const [d, t] of [['2026-11-14', 'travel-a-full-body'], ['2026-11-16', 'travel-b-full-body'], ['2026-11-17', 'travel-a-full-body']]) {
  if (!plan.some((e) => e.from === d && e.templateId === t)) throw new Error(`plan has no ${t} on ${d}`);
}
const planWrite = JSON.stringify(plan) !== JSON.stringify(oldPlan);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const after = toWorkoutSession(SESSION_ID, { ...raw, ...sessionPatch });
const sessions = recentSnap.docs.map((d) => (d.id === SESSION_ID ? after : toWorkoutSession(d.id, d.data())));
const completed = sessions.filter((s) => s.status === 'completed');
say(`Session ${SESSION_ID} · ${after.templateName} · ${after.date.toISOString()} · ${after.durationMin} min`);
say(`  sessionNote: ${after.sessionNote}`);
for (const e of after.exercises) {
  const groups = new Map<string, string[]>();
  for (const s of e.sets) {
    const key = s.kind === 'drop' ? 'drop' : s.kind === 'working' ? 'straight' : `c${s.group}`;
    groups.set(key, [...(groups.get(key) ?? []), `${s.kind === 'activation' ? 'A ' : s.kind === 'mini' ? 'm ' : ''}${kgOf(s.weight)}×${s.reps}${s.rir != null ? `@${s.rir}` : ''}`]);
  }
  const c = catOf(e.exerciseId);
  const cr = c ? creditsFor(c.name, c.muscles).map((x) => `${x.muscle} ${x.weight}`).join(', ') : '?';
  say(`  ${(e.supersetGroup ? `${e.supersetGroup}${e.pairPosition}` : '—').padEnd(3)} ${e.name.padEnd(38)} ${[...groups].map(([k, v]) => `${k}: ${v.join(' ')}`).join(' | ')}   [${cr}]`);
  if (e.exerciseId === PULLDOWN) say(`        cues ${JSON.stringify(e.cues)} · alts ${(e.alternatives ?? []).map((a) => a.name).join(', ')} · calibration ${!!e.calibration} · rec ${e.recommendation ? 'kept' : 'dropped'}`);
}
const pullupLeft = completed.filter((s) => s.exercises.some((x) => x.exerciseId === PULLUP && x.sets.some((y) => y.done)));
say(`  pull-up history now: ${pullupLeft.map((s) => `${s.date.toISOString().slice(0, 10)} ${s.exercises.find((x) => x.exerciseId === PULLUP)!.sets.map((y) => `${kgOf(y.weight)}×${y.reps}`).join(' ')}`).join(' · ') || '—'}`);

for (const [name, t, doc] of [['Haven 2', h2, h2Doc], ['Haven 1', h1, h1Doc]] as const) {
  say(`\n${name}: ${t.changes.length ? '' : 'no change'}`);
  for (const c of t.changes) say(`  · ${c}`);
  const tpl = toWorkoutTemplate(doc.id, { ...doc.data(), exercises: t.rows });
  say('  next use (template load | app call, core sessionCall, against history incl. the fixed 11/11):');
  for (const r of tpl.exercises) {
    const c = catOf(r.exerciseId)!;
    const { rec } = sessionCall(r, completed, c);
    say(`   ${(r.supersetGroup! + r.pairPosition).padEnd(3)} ${r.name.padEnd(38)} ${r.targetLoad === 0 ? 'BW' : `${kgOf(r.targetLoad)} kg`}`.padEnd(56) + ` | ${rec.action}${rec.load != null ? ` ${kgOf(rec.load)} kg` : ''}`);
    for (const a of r.alternatives ?? []) {
      const { rec: ar } = sessionCall({ ...r, exerciseId: a.exerciseId, name: a.name, targetLoad: a.targetLoad }, completed, catOf(a.exerciseId)!);
      say(`       alt ${a.name.padEnd(34)} ${a.targetLoad != null ? `${kgOf(a.targetLoad)} kg` : '—'}`.padEnd(52) + ` | ${ar.action}${ar.load != null ? ` ${kgOf(ar.load)} kg` : ''}`);
    }
  }
}

// Week of Mon 2026-11-09 (America/La_Paz), with the corrected 11/11.
{
  const from = new Date('2026-11-09T00:00:00-04:00').getTime();
  const to = new Date('2026-11-16T00:00:00-04:00').getTime();
  const cl = volumeBetween(sessions, catalog, from, to);
  const hs = hardSetsBetween(sessions, catalog, from, to);
  const inWeek = completed.filter((s) => s.exercises.length && s.date.getTime() >= from && s.date.getTime() < to);
  say(`\nWeek 11/9–11/15: ${inWeek.map((s) => `${s.date.toISOString().slice(0, 10)} ${s.templateName}`).join(', ')}`);
  const TARGET: Record<string, number> = { quads: 4, hamstrings: 4, back: 5, chest: 5, sideDelt: 3, rearDelt: 2, biceps: 2, triceps: 2, abs: 4 };
  const EXPECT: Record<string, number> = { quads: 4, hamstrings: 4, back: 4, chest: 4, sideDelt: 3, rearDelt: 2, biceps: 3, triceps: 2, abs: 3, calves: 0 };
  const TRAVEL_OK = new Set(['chest', 'abs', 'calves']);
  const hsBy = new Map(hs.week.map((m) => [m.muscle, m]));
  const byM = new Map(cl.week.map((m) => [m.muscle, m]));
  for (const m of [...new Set([...Object.keys(EXPECT), ...byM.keys()])]) {
    const v = byM.get(m);
    const d = v?.direct ?? 0;
    const t = TARGET[m];
    const flag = TRAVEL_OK.has(m) ? 'travel — OK' : t == null ? '' : d >= t ? 'met' : `short ${t - d}`;
    const exp = EXPECT[m];
    say(`  ${m.padEnd(11)} direct ${String(d).padStart(2)} · frac ${String(v?.fractional ?? 0).padEnd(4)} · straight ${hsBy.get(m)?.direct ?? 0} · target ${t ?? '—'} · ${flag}${exp != null && exp !== d ? `  ≠ expected ${exp}` : ''}`);
  }
  say(`  unattributed: ${cl.unattributed.join(', ') || '—'}`);
}

say('\nTravel plan after');
for (const e of plan) if (e.from >= '2026-11-09') say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''} ${e.kind.padEnd(7)} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
const wk = travelWeek(plan, '2026-11-11', completed, dayBoundaryOf(prof));
say(`  travelWeek(11/11) next: ${wk.next ? `${wk.next.label} ${wk.next.from}` : '—'}`);

const planned = Object.keys(sessionPatch).length + h1.changes.length + h2.changes.length + (planWrite ? 1 : 0);
say(`\nPLAN: session ${Object.keys(sessionPatch).join(', ') || '—'}; Haven 2 ${h2.changes.length}; Haven 1 ${h1.changes.length}; travel plan ${planWrite ? 'WRITE' : 'unchanged'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!planned) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-11-haven-2-fix-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, session: { id: SESSION_ID, ...raw }, travelPeriods: prof.travelPeriods, templates: { [H1_ID]: h1Doc.data(), [H2_ID]: h2Doc.data() } }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const batch = db.batch();
if (Object.keys(sessionPatch).length) batch.update(sesDoc.ref, { ...JSON.parse(JSON.stringify(sessionPatch)), updatedAt: FieldValue.serverTimestamp() });
if (h1.changes.length) batch.update(h1Doc.ref, { exercises: JSON.parse(JSON.stringify(h1.rows)), updatedAt: FieldValue.serverTimestamp() });
if (h2.changes.length) batch.update(h2Doc.ref, { exercises: JSON.parse(JSON.stringify(h2.rows)), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();

const check = (await sesDoc.ref.get()).data()!.exercises as SessionExercise[];
const b1 = check.find((e) => e.supersetGroup === 'B' && e.pairPosition === 1)!;
const pec = check.find((e) => e.exerciseId === PEC)!;
say(`written. B1 = ${b1.name} (${b1.sets.map((s) => s.reps).join('/')}); pec deck = ${pec.sets.map((s) => `${s.kind[0]}${s.group}:${s.reps}`).join(' ')}`);
process.exit(0);
