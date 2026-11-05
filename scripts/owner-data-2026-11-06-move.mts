/**
 * Owner, 2026-11-04 night (America/La_Paz): the 11/5 sessions move to Fri 11/6
 * on both accounts; 11/5 is a planned rest (a `rest` plan entry — never
 * "missed", nothing counts planned sessions).
 *
 *   GABRIEL   plan: "Travel C + D carryover" 11/5 → 11/6, + rest 11/5.
 *             One-off template: 11/6 is not back-to-back with 11/4, so the
 *             back-to-back wording goes — isolations to failure (RIR 0),
 *             compounds RIR 1–2 ("you logged RIR 0 on 11/4"). The app's own
 *             back-to-back banner reads the dates and stays off by itself.
 *   STEPHANIE plan: "Day 2B" 11/5 → 11/6, + rest 11/5; Day 1 now from 11/7.
 *   BOTH      pre-session note "Altitude: eat 60–90 min before and drink
 *             ~500 mL water." — on the 11/6 plan entry (Today's This week
 *             card), as the first cue of the session's first lift (the card
 *             open at start), and atop the template notes.
 *
 * DRY RUN unless `--apply`; backs up first; re-runs plan nothing.
 *
 *   TZ=America/La_Paz npx jiti scripts/owner-data-2026-11-06-move.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { TemplateExercise } from '../packages/core/src/workout.ts';
import { type TravelPlanEntry, dayBoundaryOf, toDomainProfile, toWorkoutSession, travelWeek } from '../packages/core/src/index.ts';

const APPLY = process.argv.includes('--apply');
const ALTITUDE = 'Altitude: eat 60–90 min before and drink ~500 mL water.';
const REST_11_5: TravelPlanEntry = { from: '2026-11-05', to: '2026-11-05', kind: 'rest', label: 'Rest', note: 'planned rest day' };

interface Account {
  email: string;
  templateId: string;
  /** The new plan entries this account's 11/5 → 11/6 move produces. */
  plan: TravelPlanEntry[];
  /** Plan entries replaced (matched by template + first day). */
  replaces: (e: TravelPlanEntry) => boolean;
  /** Row cue rewrites, old → new. */
  cues: Record<string, string>;
  /** Template notes, old line → new line ('' drops it). */
  notes: Record<string, string>;
}
const ACCOUNTS: Account[] = [
  {
    email: 'gabrielandresbermudez@gmail.com',
    templateId: 'travel-cd-carryover-2026-11-05',
    plan: [
      { from: '2026-11-04', to: '2026-11-04', kind: 'session', label: 'Travel D', templateId: 'travel-gym-d', note: 'partial: 37 min; the rest carried to 11/6' },
      REST_11_5,
      { from: '2026-11-06', to: '2026-11-06', kind: 'session', label: 'Travel C + D carryover', templateId: 'travel-cd-carryover-2026-11-05', note: `equipment-adjusted, one-off; compounds RIR 1–2, isolations to failure. ${ALTITUDE}` },
    ],
    replaces: (e) => e.templateId === 'travel-cd-carryover-2026-11-05' || (e.kind === 'rest' && e.from === '2026-11-05') || (e.templateId === 'travel-gym-d' && e.from === '2026-11-04'),
    cues: {
      'RIR 1–2 — back-to-back day; you logged RIR 0 on 11/4.': 'RIR 1–2 — you logged RIR 0 on 11/4.',
      'RIR 1 — back-to-back day.': 'RIR 0 — to failure.',
    },
    notes: {
      '2026-11-05 — Travel C + D carryover (equipment-adjusted). ONE-OFF: Travel C and D templates unchanged. Haven Gym, Cochabamba, 2,577 m. Loads in kg.':
        `${ALTITUDE}\n2026-11-06 (moved from 11/5; 11/5 = planned rest) — Travel C + D carryover (equipment-adjusted). ONE-OFF: Travel C and D templates unchanged. Haven Gym, Cochabamba, 2,577 m. Loads in kg.`,
      'Back-to-back with 11/4 D: compounds RIR 1–2 (you logged RIR 0 on 11/4), isolations RIR 1.':
        'Not back-to-back (11/5 rest): compounds RIR 1–2 (you logged RIR 0 on 11/4), isolations to failure.',
    },
  },
  {
    email: 'stph.ctllo@gmail.com',
    templateId: 'stph-sv2-day-2b',
    plan: [
      REST_11_5,
      { from: '2026-11-06', to: '2026-11-06', kind: 'session', label: 'Day 2B — Legs + Core', templateId: 'stph-sv2-day-2b', note: ALTITUDE },
      { from: '2026-11-07', to: '2026-11-09', kind: 'session', label: 'Day 1 — Squat + Glutes', templateId: 'stph-sv2-day-1', note: 'next in order, any day' },
    ],
    replaces: (e) => e.templateId === 'stph-sv2-day-2b' || (e.templateId === 'stph-sv2-day-1' && (e.from === '2026-11-06' || e.from === '2026-11-07')) || (e.kind === 'rest' && e.from === '2026-11-05'),
    cues: {},
    notes: {
      '2026-11-05 — S-v2 Day 2B — Legs + Core (Haven Gym, Cochabamba, 2,577 m). Travel version of the hinge / legs day. Loads in kg.':
        `${ALTITUDE}\n2026-11-06 (moved from 11/5; 11/5 = planned rest) — S-v2 Day 2B — Legs + Core (Haven Gym, Cochabamba, 2,577 m). Travel version of the hinge / legs day. Loads in kg.`,
    },
  },
];

initializeApp({ credential: applicationDefault(), projectId: 'fitness-tracker-gb-1775407101' });
const db = getFirestore();
const say = console.log;
const now = new Date();
const stamp = now.toISOString();
say(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${now.toString()}`);
const byDate = (a: TravelPlanEntry, b: TravelPlanEntry) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.kind < b.kind ? -1 : 1);

for (const acct of ACCOUNTS) {
  const uid = (await getAuth().getUserByEmail(acct.email)).uid;
  const user = db.doc(`users/${uid}`);
  const [profSnap, tplSnap, sesSnap] = await Promise.all([
    user.get(), user.collection('workoutTemplates').doc(acct.templateId).get(),
    user.collection('workoutSessions').orderBy('timestamp', 'desc').limit(60).get(),
  ]);
  const prof = profSnap.data()!;
  const tpl = tplSnap.data();
  if (!tpl) throw new Error(`${acct.email}: template ${acct.templateId} missing`);
  // Nothing may have been logged on the template yet — moving a done session would be wrong.
  const ran = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.templateId === acct.templateId);
  if (ran.length) throw new Error(`${acct.email}: ${acct.templateId} already has ${ran.length} session(s) — read again`);

  // plan
  const periods = (prof.travelPeriods ?? []) as Record<string, unknown>[];
  const i = periods.findIndex((p) => p.start === '2026-10-31' && p.end === '2026-11-18');
  if (i < 0) throw new Error(`${acct.email}: no Bolivia trip`);
  const before = [...((periods[i].plan ?? []) as TravelPlanEntry[])].sort(byDate);
  const plan = [...before.filter((e) => !acct.replaces(e)), ...acct.plan].sort(byDate);
  const planWrite = JSON.stringify(plan) !== JSON.stringify(before);

  // template: cues, the altitude cue on the first row, notes
  const rows = tpl.exercises as (TemplateExercise & Record<string, unknown>)[];
  const newRows = rows.map((r, k) => {
    let cues = (r.cues ?? []).map((c) => acct.cues[c] ?? c);
    if (k === 0 && !cues.includes(ALTITUDE)) cues = [ALTITUDE, ...cues];
    return JSON.stringify(cues) === JSON.stringify(r.cues) ? r : { ...r, cues, lastModifiedAt: stamp, lastModifiedBy: 'prompt' };
  });
  const notesBefore = String(tpl.notes ?? '');
  const notes = notesBefore.split('\n').map((l) => (l in acct.notes ? acct.notes[l] : l)).filter((l) => l !== '').join('\n');
  const tplWrite = notes !== notesBefore || newRows.some((r, k) => r !== rows[k]);

  say(`\n== ${acct.email}`);
  say(`plan ${planWrite ? 'WRITE' : 'unchanged'}:`);
  for (const e of plan.filter((x) => x.from >= '2026-11-04' && x.from <= '2026-11-12')) say(`  ${e.from}${e.to !== e.from ? ` → ${e.to}` : ''} ${e.kind.padEnd(7)} ${e.label}${e.note ? ` · ${e.note}` : ''}`);
  const boundary = dayBoundaryOf(toDomainProfile(prof));
  const done = sesSnap.docs.map((d) => toWorkoutSession(d.id, d.data())).filter((s) => s.status === 'completed');
  for (const day of ['2026-11-05', '2026-11-06']) {
    const wk = travelWeek(plan, day, done, boundary);
    say(`  Today ${day}: ${wk.rows.filter((r) => r.from >= '2026-11-04').map((r) => `${r.label} [${r.status}]`).join(' · ')} · next: ${wk.next?.label}`);
  }
  say(`template ${acct.templateId} ${tplWrite ? 'WRITE' : 'unchanged'}:`);
  newRows.forEach((r, k) => { if (r !== rows[k]) say(`  ${r.name}: ${(r.cues ?? []).filter((c) => !(rows[k].cues ?? []).includes(c)).join(' | ')}`); });
  if (notes !== notesBefore) say(`  notes:\n    ${notes.split('\n').slice(0, 3).join('\n    ')}`);
  if (!APPLY || (!planWrite && !tplWrite)) continue;

  const dir = join(homedir(), 'ignia-backups');
  const backup = join(dir, `owner-data-2026-11-06-move-${acct.templateId}-${stamp.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dir, { recursive: true });
  const conv = (v: unknown): unknown => (v instanceof Timestamp ? v.toDate().toISOString() : Array.isArray(v) ? v.map(conv) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)])) : v);
  writeFileSync(backup, JSON.stringify(conv({ uid, travelPeriods: prof.travelPeriods, template: tpl }), null, 1));
  if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
  const batch = db.batch();
  if (planWrite) batch.update(user, { travelPeriods: periods.map((p, k) => (k === i ? { ...p, plan } : p)) });
  if (tplWrite) batch.update(tplSnap.ref, { exercises: JSON.parse(JSON.stringify(newRows)), notes, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  say(`  written (backup ${backup})`);
}
if (!APPLY) say('\nDry run. Re-run with --apply to write.');
process.exit(0);
