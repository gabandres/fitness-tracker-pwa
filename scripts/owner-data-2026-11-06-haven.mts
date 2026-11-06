/**
 * Owner data, 2026-11-06 (America/La_Paz): fix the 11/6 "Travel C + D
 * carryover" session, re-cap 11/4, add the Haven machines.
 *
 *   11/6      (`pEgbUbSzSvVt3yS9Pu8u`) → completed + `partial`.
 *             Lat Pulldown (0 kg) → Pull-up (neutral / overhand), bodyweight.
 *             Incline DB Curl 45° → Arm Curl Machine (Haven), all 20 kg (the
 *             50 kg third set was a typo). Overhead DB Extension → Triceps
 *             Extension Machine (Haven), 20 kg — so the home DB lift's history
 *             ends at its own last session again. + Upper Back / Rear Delt
 *             Machine 35 kg, + Pec Deck 25 kg, + Shoulder Press Machine 30 kg.
 *             Swaps are written the way the app writes one
 *             (`swapToAlternative`: the replaced lift becomes the first
 *             alternative). Skipped = Skull Crusher, laterals ×3, leg curl c2.
 *   11/4      (`9G254bQLXwo1B9IePk1K`) was finished AGAIN at 2026-11-06T12:04Z
 *             by the phone, which still held it open from the 11/4 resume.
 *             That stale finish restored the empty part 2 (closed at the 24 h
 *             cap → 897 min) and dropped the per-set kg labels. Back to one
 *             part, 37 min, `durationNote` auto-corrected, kg labels restored.
 *   CATALOG   + five Haven selectorized machines (kg at Haven Gym).
 *   TEMPLATES Travel C / D: the machines as one-tap alternatives; Pull-up
 *             first on the pulldown; 11/9 Travel D starting loads; RIR note on
 *             compounds; the leg press plates-only note.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-06-haven.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { MuscleGroup, SessionExercise, TemplateExercise, WorkoutSet } from '../packages/core/src/workout.ts';
import {
  type RowAlternative,
  type TravelPlanEntry,
  creditsFor,
  kgOf,
  kgToLb,
  lbToKg,
  swapToAlternative,
  toWorkoutSession,
  volumeBetween,
} from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const S6 = 'pEgbUbSzSvVt3yS9Pu8u';
const S4 = '9G254bQLXwo1B9IePk1K';
const S4_SEG = { start: '2026-11-04T10:40:32.075Z', end: '2026-11-04T11:17:33.729Z' };
const C_ID = 'travel-gym-c';
const D_ID = 'travel-gym-d';
const GYM = 'Haven Gym';
const kg = (v: number) => kgToLb(v);

const ID = {
  legPress: 'haven-45-leg-press', pulldown: 'haven-lat-pulldown-wide', pullup: 'GOGOcWJNC9q9aBmN3ENq',
  ohDb: 'AAHHWXTA7UtbNWZbcf7z', ropeOh: 'haven-rope-overhead-triceps', skull: 'EyDTWnfO4WrbYDbDkxrk',
  inclineCurl: 'MVC1wLKBkRz7XYyKp79e', cableCurl: 'haven-behind-body-cable-curl', hammer: 'LvVitCaOS23MmPTKodlk',
  rearDeltDb: 'v2uqmVt1K4fJd0d6t4De', facePull: 'haven-rope-face-pull', plateShoulder: 'haven-plate-shoulder-press',
  deficit: 'Zqb1sTIfs0olSLeDFlx1', rdl: 'vtSvqglnBZdM1f3qOJi4', cableRow: 'haven-seated-cable-row',
  legExt: 'haven-leg-extension', incline: 'haven-30-incline-db-press',
  armCurl: 'haven-arm-curl-machine', triMachine: 'haven-triceps-extension-machine', pecDeck: 'haven-pec-deck',
  rearMachine: 'haven-rear-delt-machine', shoulderMachine: 'haven-shoulder-press-machine',
};
interface NewEx { name: string; muscles: MuscleGroup[]; category: 'compound' | 'isolation'; effortStandard: 'rir1' | 'failure'; defaultCues: string[] }
const NEW_CATALOG: Record<string, NewEx> = {
  [ID.armCurl]: { name: 'Arm Curl Machine (Haven)', muscles: ['biceps'], category: 'isolation', effortStandard: 'failure', defaultCues: ['Selectorized, kg.'] },
  [ID.triMachine]: { name: 'Triceps Extension Machine (Haven)', muscles: ['triceps'], category: 'isolation', effortStandard: 'failure', defaultCues: ['Selectorized, kg. Not the home DB overhead extension — its own history.'] },
  [ID.pecDeck]: { name: 'Pec Deck / Butterfly Machine (Haven)', muscles: ['chest'], category: 'isolation', effortStandard: 'failure', defaultCues: ['Selectorized, kg.'] },
  [ID.rearMachine]: { name: 'Upper Back / Rear Delt Machine (Haven)', muscles: ['shoulders', 'back'], category: 'isolation', effortStandard: 'failure', defaultCues: ['Selectorized, kg. Stack max 65 kg.'] },
  [ID.shoulderMachine]: { name: 'Shoulder Press Machine (Haven)', muscles: ['shoulders', 'triceps'], category: 'compound', effortStandard: 'rir1', defaultCues: ['Selectorized, kg. Not the plate-loaded press (20 kg on 11/4) — its own history.'] },
};
const LEG_PRESS_NOTE = '45° leg press load = plates only (sled excluded); Haven baseline.';
const RIR_NOTE = 'RIR 1 — last two sessions logged RIR 0';

const ALT: Record<string, RowAlternative> = {
  pullup: { exerciseId: ID.pullup, name: 'Pull-up (neutral / overhand)', targetLoad: 0, linkedHome: true, cues: ['Bodyweight, on the pulldown station (as on 11/6).'], note: 'bodyweight' },
  armCurl: { exerciseId: ID.armCurl, name: NEW_CATALOG[ID.armCurl].name, targetLoad: kg(20), cues: ['Start 20 kg (11/6: 20 kg × 10).'], note: 'Haven machine' },
  triMachine: { exerciseId: ID.triMachine, name: NEW_CATALOG[ID.triMachine].name, targetLoad: kg(20), cues: ['Start 20 kg (11/6: 20 kg × 11).'], note: 'Haven machine' },
  pecDeck: { exerciseId: ID.pecDeck, name: NEW_CATALOG[ID.pecDeck].name, targetLoad: kg(25), cues: ['Start 25 kg (11/6: 25 kg × 12).'], note: 'Haven machine, chest' },
  rearMachine: { exerciseId: ID.rearMachine, name: NEW_CATALOG[ID.rearMachine].name, targetLoad: kg(35), cues: ['Start 35 kg (11/6: 35 kg × 10). Stack max 65 kg.'], note: 'Haven machine' },
  shoulderMachine: { exerciseId: ID.shoulderMachine, name: NEW_CATALOG[ID.shoulderMachine].name, targetLoad: kg(30), cues: ['Selectorized: start 30 kg (11/6: 30 kg × 10).', RIR_NOTE], note: 'Haven machine' },
};

// ── read ──
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const [profileSnap, exSnap, tplSnap, sesSnap] = await Promise.all([
  user.get(), user.collection('exercises').get(), user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(200).get(),
]);
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);
const exIds = new Set(exSnap.docs.map((d) => d.id));
for (const [k, id] of Object.entries(ID)) if (!exIds.has(id) && !NEW_CATALOG[id]) throw new Error(`catalog is missing ${k} ${id}`);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const prune = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

// ── 1. the 11/6 session ──
const s6Doc = sesSnap.docs.find((d) => d.id === S6);
if (!s6Doc) throw new Error('11/6 session missing');
const s6Raw = s6Doc.data();
const s6 = toWorkoutSession(S6, s6Raw);
if (s6.templateId !== 'travel-cd-carryover-2026-11-05' || s6.status !== 'completed') throw new Error('not the 11/6 carryover session');
const finishedAt = (s6Raw.updatedAt as Timestamp).toDate();
const kgSets = (sets: WorkoutSet[], fix?: (s: WorkoutSet, i: number) => number | undefined): WorkoutSet[] =>
  sets.map((s, i) => {
    const v = fix?.(s, i);
    return v == null ? s : { ...s, weight: kg(v), unit: 'kg' };
  });
const withNote = (cues: string[], note: string) => (cues.includes(note) ? cues : [note, ...cues]);
/** The app's own swap, with the sets that were actually logged kept. */
const swapped = (ex: SessionExercise, alt: RowAlternative, note: string, fix?: (s: WorkoutSet, i: number) => number | undefined): SessionExercise => {
  const x = swapToAlternative(ex, alt, true);
  return { ...x, cues: withNote(x.cues, note), sets: kgSets(ex.sets, fix), loadUnit: 'kg', awayGym: GYM, recommendation: { action: 'calibrate' } };
};
/** A row the session never had: one cluster (activation + minis), kg, done. */
const added = (id: string, kgLoad: number, reps: number[], cues: string[], replaced?: RowAlternative): SessionExercise => ({
  exerciseId: id,
  name: NEW_CATALOG[id].name,
  targetLoad: kg(kgLoad),
  cues,
  logStyle: 'weight-reps',
  sets: reps.map((r, i) => ({ kind: i === 0 ? 'activation' : 'mini', group: 1, weight: kg(kgLoad), reps: r, done: true, unit: 'kg' }) as WorkoutSet),
  loadUnit: 'kg',
  awayGym: GYM,
  calibration: true,
  recommendation: { action: 'calibrate' },
  ...(replaced ? { alternatives: [replaced] } : {}),
});
const has = (id: string) => s6.exercises.some((e) => e.exerciseId === id);
let ex6 = s6.exercises.map((e): SessionExercise => {
  switch (e.exerciseId) {
    case ID.legPress: return { ...e, cues: withNote(e.cues, `Note: ${LEG_PRESS_NOTE}`) };
    case ID.pulldown: return swapped(e, ALT.pullup, 'Note: lat pulldown station used for pull-ups.');
    case ID.ohDb: return swapped(e, ALT.triMachine, 'Note: machine replaced overhead DB extension (20 kg).', () => 20);
    case ID.inclineCurl: return swapped(e, ALT.armCurl, 'Note: machine replaced incline DB curl.', () => 20);
    default: return e;
  }
});
const rearDeltDbRow = (tplSnap.docs.find((d) => d.id === 'travel-cd-carryover-2026-11-05')?.data().exercises as TemplateExercise[] | undefined)
  ?.find((r) => r.exerciseId === ID.rearDeltDb);
if (!has(ID.rearMachine)) ex6.push(added(ID.rearMachine, 35, [10, 4, 4], ['Note: replaced rear delt DB flye.'], rearDeltDbRow ? { exerciseId: ID.rearDeltDb, name: rearDeltDbRow.name, plannedSets: rearDeltDbRow.plannedSets, ...(rearDeltDbRow.targetLoad != null ? { targetLoad: rearDeltDbRow.targetLoad } : {}), cues: rearDeltDbRow.cues, linkedHome: true } : undefined));
if (!has(ID.pecDeck)) ex6.push(added(ID.pecDeck, 25, [12, 5, 4], ['Note: pec fly, extra chest.']));
if (!has(ID.shoulderMachine)) ex6.push(added(ID.shoulderMachine, 30, [10, 4, 3], ['Note: replaced DB lateral raises today. Selectorized — not the plate-loaded press.']));
ex6 = ex6.map((e) => ({ ...e }));
const SKIPPED = ['D2 Skull Crusher', 'DB Lateral Raise (Haven) c1', 'DB Lateral Raise (Haven) c2', 'DB Lateral Raise (Haven) c3 + drop', 'B2 Seated Leg Curl c2'];
const partial6 = { closedAt: s6.partial?.closedAt ?? finishedAt, skipped: SKIPPED };
const s6Write = !same(ex6, s6.exercises) || !same(s6.partial?.skipped, SKIPPED);

// ── 2. the 11/4 session ──
const s4Doc = sesSnap.docs.find((d) => d.id === S4);
if (!s4Doc) throw new Error('11/4 session missing');
const s4Raw = s4Doc.data();
const s4 = toWorkoutSession(S4, s4Raw);
if (s4.templateId !== D_ID || s4.date.toISOString() !== S4_SEG.start) throw new Error('not the 11/4 Travel D');
const late = s4.exercises.flatMap((e) => e.sets).filter((s) => (s.segment ?? 1) > 1);
if (late.length) throw new Error(`${late.length} sets in part 2 — read again`);
const kgLabel = (e: SessionExercise): SessionExercise => (e.loadUnit !== 'kg' ? e : {
  ...e,
  sets: e.sets.map((s) => {
    if (s.weight == null || s.weight === 0 || s.unit === 'kg') return s;
    const v = Math.round(lbToKg(s.weight) * 10) / 10;
    return { ...s, weight: Math.abs(s.weight - kgToLb(v)) < 1e-6 ? s.weight : kgToLb(v), unit: 'kg' };
  }),
});
const ex4 = s4.exercises.map(kgLabel);
const DUR4 = Math.round((Date.parse(S4_SEG.end) - Date.parse(S4_SEG.start)) / 60000);
const note4 = `auto-corrected: ${s4.durationMin} → ${DUR4} min (timer left running after the 11/4 resume; a stale finish on 11/6 closed the empty part 2 at the 24 h cap). Capped at the end of the last logged part, 11:17Z.`;
const s4Write = s4.durationMin !== DUR4 || (s4.segments?.length ?? 0) !== 1 || !same(ex4, s4.exercises) || s4.durationNote == null;

// ── 3. templates ──
type Row = TemplateExercise & Record<string, unknown>;
const tplRaw = new Map(tplSnap.docs.map((d) => [d.id, d.data()]));
const cRaw = tplRaw.get(C_ID)!;
const dRaw = tplRaw.get(D_ID)!;
const addAlt = (r: Row, a: RowAlternative, first = false): Row => {
  const list = (r.alternatives ?? []).filter((x) => x.exerciseId !== a.exerciseId);
  const cur = (r.alternatives ?? []).find((x) => x.exerciseId === a.exerciseId);
  const next = first ? [a, ...list] : [...(r.alternatives ?? []).map((x) => (x.exerciseId === a.exerciseId ? a : x)), ...(cur ? [] : [a])];
  if (next.length > 4) throw new Error(`${r.name}: more than 4 alternatives`);
  return same(next, r.alternatives) ? r : { ...r, alternatives: next };
};
const addCue = (r: Row, cue: string): Row => (r.cues.includes(cue) ? r : { ...r, cues: [cue, ...r.cues] });
const load = (r: Row, kgLoad: number): Row => (r.targetLoad != null && Math.abs(kgOf(r.targetLoad) - kgLoad) < 0.05 ? r : { ...r, targetLoad: kg(kgLoad) });
const stampRow = (before: Row, after: Row): Row => (same(before, after) ? before : { ...after, lastModifiedAt: stamp, lastModifiedBy: 'prompt' });
const cRows = (cRaw.exercises as Row[]).map((r0) => {
  let r = r0;
  if (r.exerciseId === ID.legPress) r = addCue(r, LEG_PRESS_NOTE);
  if (r.exerciseId === ID.pulldown) r = addAlt(r, ALT.pullup, true);
  if (r.exerciseId === ID.cableCurl) r = addAlt(r, ALT.armCurl);
  if (r.exerciseId === ID.ropeOh) r = addAlt(r, ALT.triMachine);
  if (r.exerciseId === ID.facePull) r = addAlt(r, ALT.rearMachine);
  return stampRow(r0, r);
});
// 11/9 Travel D starting loads (kg). Pec deck / arm curl / triceps machine
// have no row of their own in D: they ride on the nearest row as an alt.
const D_LOADS: Record<string, number> = { [ID.rdl]: 12, [ID.cableRow]: 40, [ID.legExt]: 35, [ID.plateShoulder]: 20, [ID.incline]: 10, [ID.hammer]: 10 };
// RDL is not here: its standard is RIR 2 (low-back rule) and it logged RIR 1 on 11/4.
const COMPOUNDS = new Set([ID.cableRow, ID.plateShoulder, ID.pullup]);
const dRows = (dRaw.exercises as Row[]).map((r0) => {
  let r = r0;
  if (D_LOADS[r.exerciseId] != null) r = load(r, D_LOADS[r.exerciseId]);
  if (COMPOUNDS.has(r.exerciseId)) r = addCue(r, RIR_NOTE);
  if (r.exerciseId === ID.plateShoulder) r = addAlt(r, ALT.shoulderMachine);
  if (r.exerciseId === ID.facePull) r = addAlt(r, ALT.rearMachine);
  if (r.exerciseId === ID.hammer) r = addAlt(r, ALT.armCurl);
  if (r.exerciseId === ID.skull) r = addAlt(r, ALT.triMachine);
  if (r.exerciseId === ID.deficit) r = addAlt(r, ALT.pecDeck);
  return stampRow(r0, r);
});
const cWrite = !same(cRows, cRaw.exercises);
const dWrite = !same(dRows, dRaw.exercises);

// ── 4. catalog ──
const catWrites = Object.entries(NEW_CATALOG).filter(([id]) => !exIds.has(id));
const lpRaw = exSnap.docs.find((d) => d.id === ID.legPress)!.data();
const lpCues = (lpRaw.defaultCues ?? []) as string[];
const lpWrite = !lpCues.includes(LEG_PRESS_NOTE);

// ── 5. plan: the 11/9 note ──
const prof = profileSnap.data()!;
const periods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = periods.findIndex((p) => p.start === '2026-10-31');
const plan = ((periods[iTrip]?.plan ?? []) as TravelPlanEntry[]).map((e) => (e.templateId === D_ID && e.from === '2026-11-09'
  ? { ...e, note: `Starting loads (kg): RDL 12 · row 40 · leg ext 35 · shoulder press 20 plate / 30 machine · incline 10 · hammer 10. Compounds: ${RIR_NOTE}.` }
  : e));
const planWrite = iTrip >= 0 && !same(plan, periods[iTrip].plan);

// ── report ──
const fmtSets = (e: SessionExercise) => {
  const by = new Map<number, string[]>();
  for (const s of e.sets) by.set(s.group ?? 0, [...(by.get(s.group ?? 0) ?? []), String(s.reps ?? '—')]);
  return [...by.values()].map((r) => r.join('/')).join(', ');
};
say(`11/6 ${S6}: ${s6Write ? 'WRITE' : 'unchanged'} → completed, partial, ${s6.durationMin} min`);
for (const e of ex6) {
  const w = e.sets.find((s) => s.weight != null)?.weight;
  say(`  ${(e.name).padEnd(42)} ${w ? `${kgOf(w)} kg` : 'BW'.padEnd(5)}  ${fmtSets(e).padEnd(14)} ${e.alternatives?.[0] && e.exerciseId !== s6.exercises.find((x) => x.exerciseId === e.exerciseId)?.exerciseId ? `(was ${e.alternatives[0].name})` : ''} ${e.cues[0]?.startsWith('Note:') ? e.cues[0] : ''}`);
}
say(`  skipped: ${SKIPPED.join(' · ')}`);
say(`\n11/4 ${S4}: ${s4Write ? 'WRITE' : 'unchanged'} · ${s4.durationMin} → ${DUR4} min · parts ${s4.segments?.length} → 1 · kg labels restored on ${ex4.flatMap((e) => e.sets).filter((s, i) => s.unit === 'kg' && s4.exercises.flatMap((x) => x.sets)[i]?.unit !== 'kg').length} sets`);
say(`  durationNote: ${note4}`);
say(`\nCatalog: ${Object.entries(NEW_CATALOG).map(([id, c]) => `${exIds.has(id) ? '=' : '+'} ${c.name} → ${creditsFor(c.name, c.muscles).map((x) => `${x.muscle} ${x.weight}`).join(', ')}`).join('\n         ')}`);
say(`  leg press defaultCues ${lpWrite ? 'WRITE' : 'unchanged'}`);
for (const [n, rows, before] of [['C', cRows, cRaw.exercises], ['D', dRows, dRaw.exercises]] as const) {
  say(`\nTravel ${n} ${(n === 'C' ? cWrite : dWrite) ? 'WRITE' : 'unchanged'}`);
  rows.forEach((r, i) => {
    if (r === (before as Row[])[i]) return;
    say(`  ${r.name.padEnd(32)} ${r.targetLoad != null ? `${kgOf(r.targetLoad)} kg` : ''}  alts: ${(r.alternatives ?? []).map((a) => a.name).join(' | ')}  cue0: ${r.cues[0]}`);
  });
}
say(`\nPlan 11/9 ${planWrite ? 'WRITE' : 'unchanged'}`);

// Weekly volume 11/2–11/8 (local), with the corrected sessions.
const catalog = [...exSnap.docs.map((d) => ({ id: d.id, muscles: d.data().muscles as MuscleGroup[] })), ...Object.entries(NEW_CATALOG).map(([id, c]) => ({ id, muscles: c.muscles }))];
const sessions = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).map((s) => (s.id === S6 ? { ...s, exercises: ex6 } : s.id === S4 ? { ...s, exercises: ex4 } : s));
const vol = volumeBetween(sessions, catalog, Date.parse('2026-11-02T00:00:00-04:00'), Date.parse('2026-11-08T23:59:59.999-04:00'));
const TARGET: Record<string, number> = { quads: 4, hamstrings: 4, back: 5, chest: 5, sideDelt: 3, rearDelt: 2, biceps: 2, triceps: 2, abs: 4 };
say(`\nWeek 11/2–11/8 clusters (fractional / direct) vs home v2.3 target — sessions: ${vol.perSession.map((p) => p.date.toISOString().slice(0, 10)).join(', ')}`);
for (const m of vol.week.sort((a, b) => a.muscle.localeCompare(b.muscle))) {
  say(`  ${m.muscle.padEnd(11)} ${String(m.fractional).padEnd(5)} (${m.direct})${TARGET[m.muscle] != null ? `  target ${TARGET[m.muscle]}  ${m.fractional >= TARGET[m.muscle] ? 'met' : `short ${TARGET[m.muscle] - m.fractional}`}` : ''}`);
}
if (vol.unattributed.length) say(`  unattributed: ${vol.unattributed.join(', ')}`);

say(`\nPLAN: 11/6 ${s6Write ? 'WRITE' : '—'}, 11/4 ${s4Write ? 'WRITE' : '—'}, catalog +${catWrites.length}${lpWrite ? ' (+leg press cue)' : ''}, C ${cWrite ? 'WRITE' : '—'}, D ${dWrite ? 'WRITE' : '—'}, plan ${planWrite ? 'WRITE' : '—'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-06-haven-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, s6: { id: S6, ...s6Raw }, s4: { id: S4, ...s4Raw }, travelPeriods: prof.travelPeriods, legPress: lpRaw, templates: { [C_ID]: cRaw, [D_ID]: dRaw } }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const batch = db.batch();
if (s6Write) batch.update(s6Doc.ref, { exercises: prune(ex6), partial: { closedAt: Timestamp.fromDate(partial6.closedAt), skipped: SKIPPED }, updatedAt: FieldValue.serverTimestamp() });
if (s4Write) {
  batch.update(s4Doc.ref, {
    exercises: prune(ex4),
    segments: [{ start: Timestamp.fromDate(new Date(S4_SEG.start)), end: Timestamp.fromDate(new Date(S4_SEG.end)) }],
    durationMin: DUR4,
    durationNote: s4.durationNote ?? note4,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
for (const [id, c] of catWrites) {
  batch.set(user.collection('exercises').doc(id), { name: c.name, muscles: c.muscles, defaultCues: c.defaultCues, logStyle: 'weight-reps', category: c.category, effortStandard: c.effortStandard, unitByGym: { [GYM]: 'kg' }, createdAt: Timestamp.fromDate(now) });
}
if (lpWrite) batch.update(user.collection('exercises').doc(ID.legPress), { defaultCues: [...lpCues, LEG_PRESS_NOTE] });
if (cWrite) batch.update(user.collection('workoutTemplates').doc(C_ID), { exercises: prune(cRows), updatedAt: FieldValue.serverTimestamp() });
if (dWrite) batch.update(user.collection('workoutTemplates').doc(D_ID), { exercises: prune(dRows), updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periods.map((p, i) => (i === iTrip ? { ...p, plan } : p)) });
await batch.commit();
const a4 = toWorkoutSession(S4, (await s4Doc.ref.get()).data()!);
const a6 = toWorkoutSession(S6, (await s6Doc.ref.get()).data()!);
say(`written. 11/4: ${a4.durationMin} min, ${a4.segments?.length} part(s), note "${a4.durationNote?.slice(0, 40)}…". 11/6: ${a6.exercises.length} lifts, partial ${a6.partial ? 'yes' : 'no'} (${a6.partial?.skipped.length} skipped).`);
process.exit(0);
