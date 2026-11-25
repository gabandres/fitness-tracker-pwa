/**
 * Owner data, requested 2026-11-24 (America/Puerto_Rico): close 11/24 — the
 * 17:40 protein-oats dinner (estimated), the day marked fully logged, and the
 * day's home-plan note extended with the early dinner. Values are the owner's,
 * entered exactly. The other account (stph) is not opened.
 *
 * What the read found (2026-11-24, `scripts/user-state.mts`):
 *
 *   11/24 meals   three rows, already the request's (`user-data-2026-11-24-breakfasts`,
 *                 `-lunch`): breakfast [zjwp3WQurCWI9EDInieT] 545/62, lunch
 *                 [TJAWiCgjr3XkBhmJhTo3] 435/31, banana + coffee [UcW8NoEeD8iYFRtYfUCx]
 *                 81/1 — checked, not rewritten. Dinner is created → 1,531 / 137
 *                 (the request's 1,530 rounds the 1,061 already stored).
 *                 No David bar was reported → none logged. "Fully logged" unset → true.
 *   Quick add     "Protein oats + banana + PBfit (standard dinner bowl)" 470/43 exists → checked.
 *   home plan     "Tue 11/24 — high-sodium day" exists (lunch script) → its note
 *                 gains the soup wording and the early dinner; no second note.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/owner-data-2026-11-24-close-day.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open } from './lib/user-data.mts';

const OWNER = 'gabrielandresbermudez@gmail.com';
const DAY = '2026-11-24';
const s = await open('owner-data-2026-11-24-close-day');
const owner = await s.user(OWNER);

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

// ── the four meals: three stored, dinner new ──
const STORED = [
  { id: 'zjwp3WQurCWI9EDInieT', time: '09:15', label: 'Pancake + 2 eggs + Canadian bacon', kcal: 545, protein: 62 },
  { id: 'TJAWiCgjr3XkBhmJhTo3', time: '13:45', label: 'Pork rib rice-noodle soup + hard-boiled egg', kcal: 435, protein: 31 },
  { id: 'UcW8NoEeD8iYFRtYfUCx', time: '14:10', label: 'Banana + black coffee', kcal: 81, protein: 1 },
];
const NEW = [
  {
    day: DAY, time: '17:40', slot: 'dinner' as const, label: 'Protein oats (standard dinner bowl)', kcal: 470, protein: 43,
    note: 'Estimated. ½ c oats 150/5 · ½ c egg whites 63/13 · ¼ c milk 25/2 · 2 tbsp PBfit 60/8 · banana ~60 g 55/1 · ½ c berries 40/0 · ½ c Greek yogurt 75/13.5. Banana weight and PBfit amount not confirmed; standard recipe assumed.',
  },
];
const total = [...STORED, ...NEW].reduce((n, m) => [n[0] + m.kcal, n[1] + m.protein], [0, 0]);
if (total[0] !== 1531 || total[1] !== 137) s.problem(`the four meals add up to ${total.join('/')}, not 1,531 / 137`);
const rows = await dayRows(owner, DAY);
for (const m of STORED) {
  const d = rows.find((r) => r.id === m.id);
  const time = d && hm((d.get('timestamp') as Timestamp).toDate()).slice(7);
  if (!d || d.get('mealLabel') !== m.label || d.get('calories') !== m.kcal || d.get('protein') !== m.protein || time !== m.time) s.problem(`${m.id} is not ${m.time} "${m.label}" ${m.kcal}/${m.protein}`);
}
for (const m of NEW) {
  if (m.label.length > LOG_LABEL_MAX || m.note.length > LOG_NOTE_MAX) { s.problem(`label or note too long: ${m.label}`); continue; }
  const have = rows.find((d) => d.get('mealLabel') === m.label);
  if (!have) s.logMeal(owner, m);
  else if (have.get('calories') !== m.kcal || have.get('protein') !== m.protein) s.problem(`${DAY} already has "${m.label}" as ${have.get('calories')}/${have.get('protein')}`);
}
const strangers = rows.filter((d) => !STORED.some((m) => m.id === d.id) && !NEW.some((m) => m.label === d.get('mealLabel')));
if (strangers.length) s.problem(`${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`).join(', ')}`);
s.markDay(await owner.collection('dailyLogged').doc(DAY).get(), true);

// ── Quick add: the dinner bowl, checked ──
const BOWL = { name: 'Protein oats + banana + PBfit (standard dinner bowl)', calories: 470, protein: 43 };
const bowl = (await owner.collection('presets').get()).docs.find((d) => d.get('name') === BOWL.name);
if (!bowl || bowl.get('calories') !== BOWL.calories || bowl.get('protein') !== BOWL.protein) s.problem(`Quick add "${BOWL.name}" is ${bowl ? `${bowl.get('calories')}/${bowl.get('protein')}` : 'absent'}`);

// ── home plan: the day note, extended ──
const NOTE_LABEL = 'Tue 11/24 — high-sodium day';
const OLD_NOTE = 'high-sodium day (broth + Canadian bacon); expect water on tomorrow\'s weigh-in';
const NEW_NOTE = 'high-sodium day (rib soup + Canadian bacon); expect water on tomorrow\'s weigh-in. Dinner eaten early, 17:40.';
const profile = await owner.get();
const stored = profile.get('homePlan') as Record<string, unknown> | undefined;
const plan = homePlanOf({ homePlan: stored });
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
const dayNote = plan?.notes?.find((n) => n.from === DAY && n.to === DAY && n.label === NOTE_LABEL);
if (!stored || !plan?.notes) s.problem('profile.homePlan has no notes: not the plan that was read');
else if (stable(stored) !== stable(plan)) s.problem('profile.homePlan holds something core `homePlanOf` drops: not the plan that was read');
else if (!dayNote) s.problem(`home-plan note "${NOTE_LABEL}" is gone`);
else if (dayNote.note !== NEW_NOTE) {
  if (dayNote.note !== OLD_NOTE) s.problem(`"${NOTE_LABEL}" is not the note that was read: ${dayNote.note}`);
  else {
    const notes = plan.notes.map((n) => (n === dayNote ? { ...n, note: NEW_NOTE } : n));
    const next = homePlanOf({ homePlan: { ...plan, notes } })!;
    if (next.notes!.length !== notes.length || !next.notes!.some((n) => n.note === NEW_NOTE)) s.problem('core `homePlanOf` dropped or cut the day note');
    else s.update(profile, { homePlan: JSON.parse(JSON.stringify(next)) }, `homePlan: "${NOTE_LABEL}" → ${NEW_NOTE}`);
  }
}
s.note('left alone: the three stored 11/24 rows, Quick add / My Foods, every other home-plan field; no David bar (none reported); steps are not read or written; stph account not opened');

await s.run({
  report: async () => {
    const docs = await dayRows(owner, DAY);
    const kcal = docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
    const protein = docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
    const flag = await owner.collection('dailyLogged').doc(DAY).get();
    console.log(`\n${DAY}: ${docs.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? 0}`);
    const hp = homePlanOf({ homePlan: (await owner.get()).get('homePlan') });
    console.log(`\nhomePlan ${DAY}: ${hp?.notes?.filter((n) => n.from <= DAY && n.to >= DAY).map((n) => `${n.label} — ${n.note}`).join(' | ')}`);
  },
});
