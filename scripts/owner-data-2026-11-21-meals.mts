/**
 * Owner data, requested 2026-11-21 (America/Puerto_Rico): fix the 11/20 rows,
 * close that day, note the 11/21 weigh-in, log 11/21's breakfast and lunch,
 * four Quick add meals. Values are the owner's, entered exactly.
 *
 * What the read found (2026-11-21, `scripts/user-state.mts`):
 *
 *   11/20 rows    nine rows, 2,095 kcal / 146 g. The three "Green Olé" 60/0 rows
 *                 get protein 4 and carbs 13; "Olé Green x2" gets carbs 26 (it stored 10);
 *                 "Trail Mix" gets protein 8; "Casein Full" gets its recipe.
 *                 A log row has no fiber field and no "estimated" flag: both go
 *                 in the row's note. Result 2,095 / 166. "Unreal", the shake and
 *                 the QDOBA bowl are not touched.
 *   11/20 day     `dailyLogged/2026-11-20` → complete. There is no per-day note
 *                 in the app, so the day note is a home-plan note dated 11/20
 *                 (a dated note shows only on its day: this one is a record).
 *                 Nothing in the app alerts on a past day over target, and the
 *                 streak counts logged days, not targets: nothing to write.
 *   11/21 weight  154.8 lb is ALREADY stored: only the note is added (the app
 *                 stores a weigh-in note and shows it nowhere, so the same
 *                 words go into the 11/20 → 11/22 home-plan note, which shows
 *                 on Today). `weightQuietUntil` is already 2026-12-10.
 *                 "Weigh-ins start Mon 11/23" in that note and "since Mon 11/23"
 *                 in the 11/26 check-in become Sat 11/21.
 *   11/21 meals   no rows yet: breakfast 08:00 and lunch 13:00 are created.
 *                 The day carries no "fully logged" flag (open for dinner).
 *   Quick add     `presets`, as the request says. No "Green Olé" Quick add
 *                 exists: the 0 g came from the Recents row, which repeats the
 *                 newest log row of that name, so the row fix is the fix. The
 *                 older "Casein Full" 325/32 Quick add and the My Foods "Olé
 *                 Xtreme Wellness High Fiber tortilla" 60/4 are left alone.
 *
 * No steps, no targets, no training data. Dry run unless `--apply`; every
 * touched doc is backed up to ~/ignia-backups first; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-21-meals.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const s = await open('owner-data-2026-11-21-meals');
const owner = await s.user(OWNER);

// ── 11/20: the rows that are already there ──
const OLE_NOTE = 'Olé Xtreme Wellness Spinach & Herbs, 1 tortilla 42 g (label): 60 kcal · 4 g protein · 13 g carbs · 12 g fiber.';
interface Fix {
  id: string;
  was: { label: string; kcal: number; protein: number };
  protein?: number;
  carbs?: number;
  /** The carbs the row held when it was read (absent: none). */
  carbsWas?: number;
  note: string;
}
const FIXES: Fix[] = [
  { id: '4u2qWImjYC2xcpO5XhSv', was: { label: 'Green Olé', kcal: 60, protein: 0 }, protein: 4, carbs: 13, note: OLE_NOTE },
  { id: 'FO5G3NtWiOx8kgFav1YX', was: { label: 'Green Olé', kcal: 60, protein: 0 }, protein: 4, carbs: 13, note: OLE_NOTE },
  { id: '5B1yVdPFcwEZO1p8r0nq', was: { label: 'Green Olé', kcal: 60, protein: 0 }, protein: 4, carbs: 13, note: OLE_NOTE },
  { id: 'AjfrhrAfa3GOqUR9meyc', was: { label: 'Olé Green x2', kcal: 120, protein: 8 }, carbs: 26, carbsWas: 10, note: 'Olé Xtreme Wellness Spinach & Herbs ×2 (label, 42 g each): 26 g carbs · 24 g fiber.' },
  { id: 'wbVC1wzKr7epq7crQBt6', was: { label: 'Trail Mix', kcal: 300, protein: 0 }, protein: 8, note: 'Estimated: protein 8 g, brand unknown.' },
  {
    id: 'EpK3Wtx0N2oipwcvjdGw', was: { label: 'Casein Full', kcal: 300, protein: 31 },
    note: '½ c Kirkland Greek yogurt 75/13.5 · ½ c Daisy low fat cottage cheese 90/13 · ½ c wild berries 40/0.5 · 1 tbsp peanut butter ~95/4 · vanilla, cinnamon',
  },
];
/** Named in the request as "leave as they are": read, never written. */
const LEFT = [
  { id: 'p6li3KfEX7ycuXZUynRx', label: 'Unreal', kcal: 90, protein: 2 },
  { id: 'q7oGkkXG1Nbquzdq4IcK', label: 'Pea shake (cottage, ½ c oats, no chia)', kcal: 530, protein: 64 },
  { id: 'Nov6lMpnxweK5pkCeNrR', label: 'QDOBA salad bowl, double chicken', kcal: 575, protein: 41 },
];

for (const f of FIXES) {
  if (f.note.length > LOG_NOTE_MAX) { s.problem(`note over ${LOG_NOTE_MAX} characters: ${f.was.label}`); continue; }
  const d = await owner.collection('dailyLogs').doc(f.id).get();
  if (!d.exists) { s.problem(`log ${f.id} ("${f.was.label}") is gone`); continue; }
  const wantProtein = f.protein ?? f.was.protein;
  const label = d.get('mealLabel');
  const kcal = d.get('calories');
  const protein = d.get('protein') ?? 0;
  if (label !== f.was.label || kcal !== f.was.kcal || (protein !== f.was.protein && protein !== wantProtein)) {
    s.problem(`log ${f.id} is now "${label}" ${kcal}/${protein}, not "${f.was.label}" ${f.was.kcal}/${f.was.protein}`);
    continue;
  }
  const patch: Record<string, unknown> = {};
  if (protein !== wantProtein) patch['protein'] = wantProtein;
  if (f.carbs != null && d.get('carbs') !== f.carbs) {
    if ((d.get('carbs') ?? undefined) !== f.carbsWas) { s.problem(`log ${f.id} has carbs ${d.get('carbs')}, not the ${f.carbsWas ?? 'none'} that was read`); continue; }
    patch['carbs'] = f.carbs;
  }
  if (d.get('note') !== f.note) {
    if (d.get('note') != null) { s.problem(`log ${f.id} already has a different note: ${d.get('note')}`); continue; }
    patch['note'] = f.note;
  }
  if (Object.keys(patch).length === 0) continue;
  s.update(d, patch, `11-20 ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} "${label}" ${kcal}/${protein} → ${kcal}/${wantProtein}${f.carbs != null ? ` · carbs ${f.carbs}` : ''} + note`);
}
for (const l of LEFT) {
  const d = await owner.collection('dailyLogs').doc(l.id).get();
  if (!d.exists || d.get('mealLabel') !== l.label || d.get('calories') !== l.kcal || d.get('protein') !== l.protein) s.problem(`log ${l.id} is not the "${l.label}" ${l.kcal}/${l.protein} row that was read`);
  else s.note(`left alone: 11/20 "${l.label}" ${l.kcal}/${l.protein}`);
}

// ── day rows, for the guards and the report ──
const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

const KNOWN_20 = new Set([...FIXES.map((f) => f.id), ...LEFT.map((l) => l.id)]);
const rows20 = await dayRows(owner, '2026-11-20');
const strangers = rows20.filter((d) => !KNOWN_20.has(d.id));
if (strangers.length || rows20.length !== KNOWN_20.size) s.problem(`11/20 no longer holds exactly the nine rows that were read (${rows20.length} rows; unknown: ${strangers.map((d) => `"${d.get('mealLabel')}"`).join(', ') || 'none'})`);

// ── 11/20: day complete ──
s.markDay(await owner.collection('dailyLogged').doc('2026-11-20').get(), true);

// ── 11/21: the weigh-in's note ──
const WEIGHT_NOTE = 'post-trip, travel water expected; evaluate 7-day average from 11/26';
const w21 = await owner.collection('dailyWeights').doc('2026-11-21').get();
if (!w21.exists || w21.get('weight') !== 154.8) s.problem(`dailyWeights/2026-11-21 is ${w21.exists ? w21.get('weight') : 'absent'}, not the 154.8 that was read`);
else if (w21.get('note') !== WEIGHT_NOTE) {
  if (w21.get('note') != null) s.problem(`dailyWeights/2026-11-21 already has a different note: ${w21.get('note')}`);
  else s.update(w21, { note: WEIGHT_NOTE }, 'dailyWeights/2026-11-21 154.8 lb (already stored) + note');
}

// ── 11/21: breakfast and lunch ──
const MEALS = [
  {
    day: '2026-11-21', time: '08:00', slot: 'breakfast' as const, label: 'Egg scramble + Canadian bacon + Olé', kcal: 470, protein: 60,
    note: '2 large eggs 140/12.5 · 1 c liquid egg whites 126/26 · butter swipe ~22/0 · mushrooms + diced onions ~20/1 · Jones Canadian bacon 5 slices 100/17 (label: 3 slices 51 g = 60 kcal / 10 g, 520 mg sodium) · Olé green tortilla ×1 60/4.',
  },
  {
    day: '2026-11-21', time: '13:00', slot: 'lunch' as const, label: 'Gathering lunch: chicken, salad, chips + hummus', kcal: 690, protein: 47,
    note: 'Estimated. Lean chicken ~4.5 oz cooked (eyeballed) ~210/39 · salad greens ~20/1 · dressing residue ~1 tbsp ~70/0 · dried cranberries ~1–2 tbsp ~50/0 · croutons small handful ~60/2 · chips ~1 oz (one handful) + hummus ~3 tbsp ~280/5.',
  },
];
const rows21 = await dayRows(owner, '2026-11-21');
for (const m of MEALS) {
  const have = rows21.find((d) => d.get('mealLabel') === m.label);
  if (!have) s.logMeal(owner, m);
  else if (have.get('calories') !== m.kcal || have.get('protein') !== m.protein) s.problem(`11/21 already has "${m.label}" as ${have.get('calories')}/${have.get('protein')}`);
}
const others21 = rows21.filter((d) => !MEALS.some((m) => m.label === d.get('mealLabel')));
for (const d of others21) s.note(`11/21 row not in the request, left alone: "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
// The day stays open for dinner: no "fully logged" answer.
s.markDay(await owner.collection('dailyLogged').doc('2026-11-21').get(), null);

// ── Quick add ──
const QUICK = [
  { name: 'Casein bowl (full)', calories: 300, protein: 31 },
  { name: 'Olé Xtreme green tortilla (Spinach & Herbs)', calories: 60, protein: 4 },
  { name: 'Jones Canadian bacon, 1 slice', calories: 20, protein: 3.3 },
  { name: 'Egg scramble + Canadian bacon + Olé', calories: 470, protein: 60 },
];
const presets = (await owner.collection('presets').get()).docs;
for (const q of QUICK) {
  const have = presets.find((d) => d.get('name') === q.name);
  if (!have) s.saveMeal(owner, 'quickAdd', q);
  else if (have.get('calories') !== q.calories || have.get('protein') !== q.protein) s.problem(`Quick add "${q.name}" exists as ${have.get('calories')}/${have.get('protein')}`);
}
const greenOle = presets.filter((d) => /green ol[eé]/i.test(String(d.get('name') ?? '')));
if (greenOle.length) s.problem(`a "Green Olé" Quick add now exists (${greenOle.map((d) => `${d.get('calories')}/${d.get('protein')}`).join(', ')}): its protein needs the fix, not just the rows`);
else s.note('no "Green Olé" Quick add is stored: the 0 g default was the Recents row repeating the newest log row of that name');
s.note('left alone: Quick add "Casein Full" 325/32 · My Foods "Olé Xtreme Wellness High Fiber tortilla" 60/4');

// ── home plan: the rest note, the check-in's wording, the 11/20 day note ──
const REST_LABEL = 'No training 11/20 → 11/22';
const REST_WAS = 'Rest. Nothing is scheduled and nothing is flagged. Weigh-ins start Mon 11/23.';
const REST_NOW = 'Rest. Nothing is scheduled and nothing is flagged. Weigh-ins are daily from Sat 11/21. 154.8 lb on 11/21 is post-trip (travel water expected): the 7-day average is read from Thu 11/26.';
const CHECK_WAS = 'Average of the weigh-ins since Mon 11/23 vs 10/30';
const CHECK_NOW = 'Average of the weigh-ins since Sat 11/21 vs 10/30';
const DAY_NOTE = { from: '2026-11-20', to: '2026-11-20', label: 'Fri 11/20 — at maintenance, no compensation', note: 'at maintenance (~2,150); protein above target; no compensation planned' };

const profile = await owner.get();
const stored = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: stored });
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
if (!stored || !plan?.notes || !plan.checkIn?.note) s.problem('profile.homePlan has no notes or no check-in: not the plan that was read');
else if (stable(stored) !== stable(plan)) s.problem('profile.homePlan holds something core `homePlanOf` drops: not the plan that was read');
else {
  const rest = plan.notes.find((n) => n.label === REST_LABEL && n.from === '2026-11-20' && n.to === '2026-11-22');
  if (!rest || (rest.note !== REST_WAS && rest.note !== REST_NOW)) s.problem(`home-plan note "${REST_LABEL}" is not the one that was read`);
  else if (!plan.checkIn.note.includes(CHECK_WAS) && !plan.checkIn.note.includes(CHECK_NOW)) s.problem('the 11/26 check-in note is not the one that was read');
  else {
    const notes = plan.notes.map((n) => (n === rest ? { ...n, note: REST_NOW } : n));
    if (!notes.some((n) => n.from === DAY_NOTE.from && n.to === DAY_NOTE.to && n.label === DAY_NOTE.label)) notes.push(DAY_NOTE);
    const next = homePlanOf({ homePlan: { ...plan, notes, checkIn: { ...plan.checkIn, note: plan.checkIn.note.replace(CHECK_WAS, CHECK_NOW) } } })!;
    if (Object.keys(next).length > 12) s.problem('homePlan would have more than 12 keys (rules cap)');
    else if (next.notes!.length !== notes.length || !next.notes!.some((n) => n.note === REST_NOW) || !next.notes!.some((n) => n.note === DAY_NOTE.note)) s.problem('core `homePlanOf` dropped or cut a note: too long or malformed');
    else if (next.weightQuietUntil !== '2026-12-10') s.problem(`weightQuietUntil is ${next.weightQuietUntil}, not the 2026-12-10 that was read`);
    else if (stable(next) !== stable(plan)) {
      s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `homePlan: "${REST_LABEL}" says weigh-ins are daily from 11/21 · check-in averages "since Sat 11/21" · day note for 11/20 (${next.notes!.length} notes)`);
    }
  }
}
s.note('weight alerts are already quiet until 2026-12-10 · steps, targets, templates and sessions are not read or written');

await s.run({
  report: async () => {
    for (const day of ['2026-11-20', '2026-11-21']) {
      const docs = await dayRows(owner, day);
      const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
      const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
      const flag = await owner.collection('dailyLogged').doc(day).get();
      const w = await owner.collection('dailyWeights').doc(day).get();
      console.log(`\n${day}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'} · weigh-in: ${w.exists ? `${w.get('weight')} lb${w.get('note') ? ` ("${w.get('note')}")` : ''}` : '—'}`);
      for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}${d.get('carbs') != null ? ` · carbs ${d.get('carbs')}` : ''}${d.get('note') ? ' · note' : ''}`);
    }
    const names = new Set(QUICK.map((q) => q.name));
    const saved = (await owner.collection('presets').get()).docs.filter((d) => names.has(String(d.get('name'))));
    console.log(`\nQuick add (${saved.length} of ${QUICK.length}): ${saved.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join(' · ') || 'none yet'}`);
    const now = homePlanOf({ homePlan: (await owner.get()).get('homePlan') });
    console.log(`\nhome-plan notes on 11/20–11/22: ${(now?.notes ?? []).filter((n) => n.from <= '2026-11-22').map((n) => `[${n.from}→${n.to}] ${n.label}: ${n.note}`).join('\n  ')}`);
    console.log(`check-in ${now?.checkIn?.date}: ${now?.checkIn?.note}`);
  },
});
