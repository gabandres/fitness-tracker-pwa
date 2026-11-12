/**
 * Owner data, 2026-11-11 (America/La_Paz until 11/18, then Puerto Rico): the
 * travel rest block, the return schedule, and what the v2.4 start looks like.
 * Runs AFTER `owner-data-2026-11-06-program-v2-4.mts` (moved to 2026-11-20 and
 * applied the same day), so the re-entry preview reads the v2.4 templates.
 *
 *   11/11     The relabelled "Lat Pulldown (wide)" row (session
 *             oIDkIFEzzxRoiCp5TMj2) + cue "Haven machine has a thigh pad; home
 *             (PR) pulldown has none — loads not comparable"; the same cue on
 *             Haven 2's pulldown alternative. Separate baselines need no write:
 *             `haven-lat-pulldown-wide` and the home `Wide-grip lat pulldown`
 *             are different ids, and core `readableRow` never gives a home row
 *             an away-gym row. Printed as a check.
 *   PLAN      The trip's plan from 11/12 is rewritten: one `rest` entry
 *             11/12 → 11/19 "travel — rest block (9 days)"; Travel A 11/14 and
 *             the optional Travel A 11/17–18 removed; Mon 11/16 kept as ONE
 *             optional short session — a one-off travel template (`travel-v1`:
 *             never re-entry, not "the gym") with push-ups, split squats and
 *             the backpack row, 2 sets each near failure. A planned session
 *             that is not logged shows "skipped, no penalty" (ADR-0048); `rest`
 *             and `note` entries carry no status at all. Location notes 11/13,
 *             11/15, 11/18; 11/19 home rest; 11/20 re-entry rotation; 11/23
 *             v2.4 targets. The week notes: 11/9 final (chest, abs, calves
 *             travel — OK), 11/16 travel + re-entry — OK.
 *             The trip's END stays 2026-11-18: 11/19 is at home with the
 *             scale, so its weigh-in and intake belong in the fit.
 *   TEMPLATES Travel A / B notes: "OPTIONAL — not scheduled" for the rest of
 *             the trip.
 *   PREVIEW   (read only) the first Leg / Pull / Push after the trip as the
 *             app will start them on 11/20+: core `reentryFor`, the session's
 *             call (`sessionCall`), −10 % on a real step (`reentryLoad`), next
 *             to −10 % of the last home working load. Week volume 11/9 and
 *             11/16; the Trends travel check on 11/12 … 11/18.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-11-rest-block.mts [--apply]
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
  dayBoundaryOf,
  dumbbellStepLb,
  hardSetsBetween,
  isTravelTemplate,
  readableRow,
  recommendOptionsFor,
  reentryFor,
  reentryLoad,
  sessionCall,
  sidesOf,
  toWorkoutExercise,
  toWorkoutSession,
  toWorkoutTemplate,
  travelMaintenanceCheck,
  travelPeriodsOf,
  travelWeek,
  volumeBetween,
} from '../packages/core/src/index.ts';
import type { Exercise, SessionExercise, TemplateExercise, WorkoutSession } from '../packages/core/src/workout.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const APPLY = process.argv.includes('--apply');
const SESSION_ID = 'oIDkIFEzzxRoiCp5TMj2';
const H2_ID = 'travel-haven-2';
const PULLDOWN = 'haven-lat-pulldown-wide';
const HOME_PULLDOWN = 'oxOuktVhb6Ghgg7hGkCk';
const PAD_CUE = 'Note: Haven machine has a thigh pad; home (PR) pulldown has none — loads not comparable';
const LEG = 'quxwARQlCnItzpLJgcr4';
const PULL = 'aliWJBD2FND6mU9foLdC';
const PUSH = 'Nx1bxeRuH6bMnGgX7Trv';
const HOME = [LEG, PULL, PUSH];
const TRAVEL_A = 'travel-a-full-body';
const TRAVEL_B = 'travel-b-full-body';
const SHORT_ID = 'travel-short-2026-11-16';
const SHORT_NAME = 'Travel B (optional) — short, 11/16';
const SHORT_ROWS = ['travel-deficit-push-up', 'travel-bulgarian-split-squat', 'travel-backpack-row'];
const NEAR_FAILURE = 'Near failure (RIR 0–1) — 2 sets. Log reps + RIR on the last set.';
const OPTIONAL_NOTE = '2026-11-11 — OPTIONAL for the rest of the trip: travel rest block 11/12 → 11/19, nothing scheduled. Only Mon 11/16 is kept as a possible short session (template "Travel B (optional) — short, 11/16"); not logged = no flag.';
const REST_FROM = '2026-11-12';
const kgOf = (lb?: number) => (lb == null ? '—' : `${+(lb / 2.2046226218).toFixed(1)}`);

/** The trip's plan from 11/12 on (everything earlier is kept as it is). */
const PLAN_FROM_1112: TravelPlanEntry[] = [
  { from: '2026-11-11', to: '2026-11-11', kind: 'note', label: 'Week of 11/9 — final', note: '11/10 Haven 1 + 11/11 Haven 2, as logged. Chest, abs, calves: travel — OK.' },
  { from: '2026-11-12', to: '2026-11-19', kind: 'rest', label: 'travel — rest block (9 days)', note: 'No planned training. Travel A/B optional; skipped is not missed. Steps, meals and weight log as usual.' },
  { from: '2026-11-13', to: '2026-11-13', kind: 'note', label: 'Cochabamba → Buena Vista', note: 'Leave Cochabamba Fri AM; Buena Vista 11/13 → Sun 11/15.' },
  { from: '2026-11-15', to: '2026-11-15', kind: 'note', label: 'Buena Vista → Santa Cruz', note: 'Santa Cruz 11/15 → Wed 11/18.' },
  { from: '2026-11-16', to: '2026-11-16', kind: 'session', label: 'Short session (optional)', templateId: SHORT_ID, note: '10–15 min, bodyweight: push-ups, split squats, backpack row — 2 sets each near failure. Not logged = no flag.' },
  { from: '2026-11-16', to: '2026-11-16', kind: 'note', label: 'Week of 11/16 — travel + re-entry', note: 'No volume targets this week — travel + re-entry, OK.' },
  { from: '2026-11-18', to: '2026-11-18', kind: 'note', label: 'Flight home', note: 'Santa Cruz → Puerto Rico. Last trip day; America/Puerto_Rico from here.' },
  { from: '2026-11-19', to: '2026-11-19', kind: 'note', label: 'Home — rest', note: 'Thu: rest, no training. v2.3 retired (history unchanged); its re-entry session is cancelled.' },
  { from: '2026-11-20', to: '2026-11-20', kind: 'note', label: 'Home v2.4 — re-entry rotation', note: 'First gym session: Leg Day. The first Leg, Pull and Push = −10% of the last home working load, RIR 2 on every exercise, no failure, no drop set. Normal v2.4 effort from the second rotation.' },
  { from: '2026-11-23', to: '2026-11-23', kind: 'note', label: 'v2.4 weekly targets start', note: 'First full v2.4 week: chest 6 · back 6 · quads 5 · hamstrings 5 · calves 3 · sideDelt 3 · rearDelt 2 · biceps 2 · triceps 2 · abs 4 (direct clusters).' },
];

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const uid = (await getAuth().getUserByEmail(OWNER)).uid;
const user = db.doc(`users/${uid}`);
const now = new Date();
const stamp = now.toISOString();
const say = console.log;
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}\n`);

const [profileSnap, sesDoc, exSnap, tplSnap, recentSnap] = await Promise.all([
  user.get(),
  user.collection('workoutSessions').doc(SESSION_ID).get(),
  user.collection('exercises').get(),
  user.collection('workoutTemplates').get(),
  user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(400).get(),
]);
const prof = profileSnap.data()!;
const boundary = dayBoundaryOf(prof);
const dbStep = dumbbellStepLb(prof.dumbbellHalfSteps as boolean | undefined);
const catalog: Exercise[] = exSnap.docs.map((d) => toWorkoutExercise(d.id, d.data()));
const engineCat = (id: string) => { const c = catalog.find((x) => x.id === id); return c ? { ...c, dumbbellStepLb: dbStep } : null; };
const tplDoc = (id: string) => tplSnap.docs.find((d) => d.id === id);
for (const id of [...HOME, H2_ID, TRAVEL_A, TRAVEL_B]) if (!tplDoc(id)) throw new Error(`template ${id} missing`);
if (HOME.some((id) => tplDoc(id)!.get('templateVersion') !== 'v2.4')) throw new Error('home templates are not v2.4 — run the v2.4 script first');

// ── A. the 11/11 pulldown row ──
const raw = sesDoc.data()!;
const exercises = (raw.exercises ?? []) as SessionExercise[];
const pd = exercises.findIndex((e) => e.exerciseId === PULLDOWN);
if (pd < 0) throw new Error('11/11 has no Lat Pulldown (wide) row — run the haven-2 fix first');
const sessionExercises = pd >= 0 && !exercises[pd].cues?.includes(PAD_CUE)
  ? exercises.map((e, i) => (i === pd ? { ...e, cues: [PAD_CUE, ...(e.cues ?? [])] } : e))
  : null;
const h2Rows = (tplDoc(H2_ID)!.get('exercises') as (TemplateExercise & Record<string, unknown>)[]);
let h2Changed = false;
const h2After = h2Rows.map((r) => {
  const alts = (r.alternatives ?? []) as RowAlternative[];
  if (!alts.some((a) => a.exerciseId === PULLDOWN && !(a.cues ?? []).includes(PAD_CUE))) return r;
  h2Changed = true;
  return { ...r, alternatives: alts.map((a) => (a.exerciseId === PULLDOWN ? { ...a, cues: [PAD_CUE, ...(a.cues ?? [])] } : a)), lastModifiedAt: stamp, lastModifiedBy: 'prompt' };
});

// ── B. the one-off short template + Travel A/B notes ──
const aRows = tplDoc(TRAVEL_A)!.get('exercises') as (TemplateExercise & Record<string, unknown>)[];
const shortRows = SHORT_ROWS.map((id) => {
  const r = aRows.find((x) => x.exerciseId === id);
  if (!r) throw new Error(`Travel A has no ${id}`);
  return {
    ...structuredClone(r),
    plannedSets: r.plannedSets.slice(0, 2),
    cues: [NEAR_FAILURE, ...(r.cues ?? []).filter((c) => !/^RIR 1 — stop 1 rep/.test(c))],
  };
});
const shortTpl = tplDoc(SHORT_ID) ? null : {
  name: SHORT_NAME,
  templateVersion: 'travel-v1',
  restMiniSec: 60,
  notes: '2026-11-11 — one-off, optional (owner): Mon 11/16 in Santa Cruz, 10–15 min. Push-ups, split squats, backpack row — 2 sets each near failure (RIR 0–1). Not logged = no flag. A travel template: never a re-entry session and not "the gym".',
  exercises: shortRows,
  createdAt: Timestamp.fromDate(now),
  updatedAt: Timestamp.fromDate(now),
};
const travelNotes = [TRAVEL_A, TRAVEL_B].flatMap((id) => {
  const notes = (tplDoc(id)!.get('notes') as string | undefined) ?? '';
  return notes.includes(OPTIONAL_NOTE) ? [] : [{ id, notes: `${notes}\n${OPTIONAL_NOTE}`.trim() }];
});

// ── B. the plan ──
const rawPeriods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
const iTrip = rawPeriods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
if (iTrip < 0) throw new Error('the Bolivia trip (10/31 → 11/18) is not on the profile');
const oldPlan = (rawPeriods[iTrip].plan ?? []) as TravelPlanEntry[];
const kept = oldPlan.filter((e) => e.from < REST_FROM && !(e.kind === 'note' && e.from === '2026-11-11'));
const plan = [...kept, ...PLAN_FROM_1112].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.kind === 'session' ? -1 : 1));
const dropped = oldPlan.filter((e) => !plan.some((p) => p.from === e.from && p.label === e.label));
const planWrite = JSON.stringify(plan) !== JSON.stringify(oldPlan);
const periodsAfter = rawPeriods.map((p, i) => (i === iTrip ? { ...p, plan } : p));

// ── report ──
const after = toWorkoutSession(SESSION_ID, { ...raw, ...(sessionExercises ? { exercises: sessionExercises } : {}) });
const sessions: WorkoutSession[] = recentSnap.docs.map((d) => (d.id === SESSION_ID ? after : toWorkoutSession(d.id, d.data())));
const completed = sessions.filter((s) => s.status === 'completed');
say(`A. 11/11 pulldown cues: ${JSON.stringify(after.exercises.find((e) => e.exerciseId === PULLDOWN)!.cues)}`);
const homeReads = completed.filter((s) => readableRow(s, HOME_PULLDOWN)).length;
const homeSeesHaven = completed.some((s) => readableRow(s, PULLDOWN) && s.exercises.some((e) => e.exerciseId === PULLDOWN && !e.awayGym));
say(`   separate baselines: home "${catalog.find((c) => c.id === HOME_PULLDOWN)?.name}" (${HOME_PULLDOWN}) ${homeReads} home sessions · Haven "${catalog.find((c) => c.id === PULLDOWN)?.name}" (${PULLDOWN}) — never in a home read: ${!homeSeesHaven}`);
say(`   Haven 2 pulldown alternative: ${h2Changed ? '+ thigh-pad cue' : 'already has it'}`);

say(`\nB. Plan (trip 10/31 → 11/18; end unchanged). Dropped: ${dropped.map((e) => `${e.from} ${e.label}`).join(' · ') || '—'}`);
for (const e of plan) if (e.from >= '2026-11-09') say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''}  ${e.kind.padEnd(7)} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
for (const today of ['2026-11-12', '2026-11-16', '2026-11-17']) {
  const wk = travelWeek(plan, today, completed, boundary);
  say(`  travelWeek(${today}): ${wk.rows.filter((r) => r.kind === 'session').map((r) => `${r.label} [${r.status}]`).join(', ') || 'no sessions'} · next ${wk.next ? `${wk.next.label} ${wk.next.from}` : '—'}`);
}
say(`  short template: ${shortTpl ? `NEW ${SHORT_ID} "${SHORT_NAME}"` : 'exists'} — ${shortRows.map((r) => `${r.name} ×${r.plannedSets.length}`).join(', ')}`);
say(`  Travel A/B notes: ${travelNotes.length ? `+ optional line on ${travelNotes.map((t) => t.id).join(', ')}` : 'already marked'}`);

// ── C. the re-entry rotation, as the app will start it ──
const templates = tplSnap.docs.map((d) => toWorkoutTemplate(d.id, d.data()));
const travelIds = new Set(templates.flatMap((t) => (t.id && isTravelTemplate(t) ? [t.id] : [])));
if (shortTpl) travelIds.add(SHORT_ID);
const periods = travelPeriodsOf({ ...prof, travelPeriods: periodsAfter });
const isHomeRead = (s: WorkoutSession) => !s.reentry && !s.deload && !s.notComparable && HOME.includes(s.templateId ?? '');
/** The newest home session's heaviest done activation / working weight, per side. */
function lastHome(id: string, side?: 'L' | 'R'): { lb: number; on: string } | null {
  for (const s of completed) {
    if (!isHomeRead(s)) continue;
    const e = readableRow(s, id);
    const w = e?.sets.filter((x) => x.done && x.reps != null && x.weight != null && (x.kind === 'activation' || x.kind === 'working') && (!side || x.label === side)).map((x) => x.weight!) ?? [];
    if (w.length) return { lb: Math.max(...w), on: s.date.toISOString().slice(5, 10) };
  }
  return null;
}
say('\nC. Re-entry rotation (lb). "app" = what the app seeds (its call −10 % on a real step); "last×0.9" = −10 % of the last home working load.');
for (const [i, id] of [LEG, PULL, PUSH].entries()) {
  const t = templates.find((x) => x.id === id)!;
  const day = ['2026-11-20', '2026-11-21', '2026-11-22'][i];
  const kind = reentryFor({ templateId: id, today: day, sessions: completed, periods, travelTemplateIds: travelIds, templateCreatedAt: t.createdAt, boundary });
  say(`  ${t.name} [${t.templateVersion}] — first session after the trip: ${kind ?? 'NOT re-entry'}`);
  for (const r of t.exercises) {
    const cat = engineCat(r.exerciseId);
    const { config } = recommendOptionsFor(r, cat);
    const step = { loadSteps: config?.loadSteps, stepLb: config?.stepLb ?? 5, loadGrid: config?.loadGrid, assisted: cat?.assisted === true };
    const call = sessionCall(r, completed, cat);
    const sides = sidesOf(r);
    const parts = (sides.length > 1 ? sides : [undefined]).map((sd) => {
      const c = sd ? call.sides?.[sd] : call;
      const seeded = c && c.rec.action !== 'none' && c.rec.load != null ? c.rec.load : (sd ? r.sideLoads?.[sd] : undefined) ?? r.targetLoad;
      const last = lastHome(r.exerciseId, sd);
      const app = seeded != null ? reentryLoad(seeded, step) : undefined;
      const fromLast = last ? reentryLoad(last.lb, step) : undefined;
      const flag = app != null && fromLast != null && app !== fromLast ? `  ≠ (call ${c?.rec.action} ${seeded})` : '';
      return `${sd ? `${sd} ` : ''}app ${app ?? '—'} · last ${last ? `${last.lb} (${last.on})` : '—'} ×0.9 → ${fromLast ?? '—'}${flag}`;
    });
    const drop = r.plannedSets.some((p) => p.kind === 'drop') ? ' · plan has a DROP set' : '';
    const pending = (r.cues ?? []).some((c) => c.startsWith('Baseline pending')) ? ' · baseline pending' : '';
    say(`    ${(r.supersetGroup ? `${r.supersetGroup}${r.pairPosition}` : '—').padEnd(3)} ${r.name.padEnd(40)} ${parts.join(' | ')}${drop}${pending}`);
  }
}

// ── D. volume ──
const week = (fromKey: string, toKey: string) => {
  const from = new Date(`${fromKey}T00:00:00-04:00`).getTime();
  const to = new Date(`${toKey}T00:00:00-04:00`).getTime();
  return { cl: volumeBetween(sessions, catalog, from, to), hs: hardSetsBetween(sessions, catalog, from, to) };
};
const w9 = week('2026-11-09', '2026-11-16');
say(`\nD. Week of 11/9 (final): ${w9.cl.week.filter((m) => m.direct > 0 || ['chest', 'abs', 'calves'].includes(m.muscle)).map((m) => `${m.muscle} ${m.direct}${['chest', 'abs', 'calves'].includes(m.muscle) ? ' (travel — OK)' : ''}`).join(' · ')}`);
const w16 = week('2026-11-16', '2026-11-23');
say(`   Week of 11/16 so far: ${w16.cl.total} clusters — travel + re-entry, no targets`);
const trip = periods.find((p) => p.start === '2026-10-31')!;
for (const d of ['2026-11-12', '2026-11-15', '2026-11-18']) {
  const chk = travelMaintenanceCheck({ sessions, catalog, period: trip, now: new Date(`${d}T20:00:00-04:00`), boundary });
  say(`   Trends travel check on ${d}: ${chk.okCount}/${chk.rows.length} ok · short: ${chk.rows.filter((r) => !r.ok).map((r) => r.muscle).join(', ') || '—'}`);
}

const writes = (sessionExercises ? 1 : 0) + (h2Changed ? 1 : 0) + (shortTpl ? 1 : 0) + travelNotes.length + (planWrite ? 1 : 0);
say(`\nPLAN: session ${sessionExercises ? 'cue' : '—'}; Haven 2 ${h2Changed ? 'alt cue' : '—'}; short template ${shortTpl ? 'create' : '—'}; Travel A/B notes ${travelNotes.length}; travel plan ${planWrite ? 'WRITE' : 'unchanged'}.`);
if (!APPLY) { say('Dry run. Re-run with --apply to write.'); process.exit(0); }
if (!writes) { say('Nothing to do (already applied).'); process.exit(0); }

const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};
const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `owner-data-2026-11-11-rest-block-${stamp.replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv({ uid, session: { id: SESSION_ID, exercises: raw.exercises }, travelPeriods: prof.travelPeriods, templates: Object.fromEntries([H2_ID, TRAVEL_A, TRAVEL_B].map((id) => [id, tplDoc(id)!.data()])) }), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
say(`backup written: ${backup}`);

const batch = db.batch();
if (sessionExercises) batch.update(sesDoc.ref, { exercises: JSON.parse(JSON.stringify(sessionExercises)), updatedAt: FieldValue.serverTimestamp() });
if (h2Changed) batch.update(tplDoc(H2_ID)!.ref, { exercises: JSON.parse(JSON.stringify(h2After)), updatedAt: FieldValue.serverTimestamp() });
if (shortTpl) batch.set(user.collection('workoutTemplates').doc(SHORT_ID), { ...JSON.parse(JSON.stringify({ ...shortTpl, createdAt: null, updatedAt: null })), createdAt: shortTpl.createdAt, updatedAt: shortTpl.updatedAt });
for (const t of travelNotes) batch.update(tplDoc(t.id)!.ref, { notes: t.notes, updatedAt: FieldValue.serverTimestamp() });
if (planWrite) batch.update(user, { travelPeriods: periodsAfter });
await batch.commit();
const check = toWorkoutSession(SESSION_ID, (await sesDoc.ref.get()).data()!);
say(`written. 11/11 pulldown cue: ${check.exercises.find((e) => e.exerciseId === PULLDOWN)!.cues?.[0]}; plan entries ${plan.length}`);
process.exit(0);
