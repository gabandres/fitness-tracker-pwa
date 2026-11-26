/**
 * User data, requested 2026-11-26 (America/Puerto_Rico): 11/26 breakfasts on
 * two accounts, the owner's Quick add and day note. Values are the owner's,
 * entered exactly. The session, template, profile and tape items of the same
 * request are `owner-data-2026-11-26-push-review.mts` (applied; re-run plans 0).
 *
 * What the read found (2026-11-26, `scripts/user-state.mts`):
 *
 * Owner (gabrielandresbermudez@gmail.com, targets 1,850 / 140, unchanged)
 *   11/26 meals  none: the shake is created → 463 / 71. Day stays open.
 *   Quick add    no preset matches /pea|shake/ (the pea shakes are My Foods);
 *                the request names Quick add → created there. My Foods left.
 *   Day note     a home-plan note for 11/26 (the 11/24 and 11/25 precedent).
 *
 * Stephanie (stph.ctllo@gmail.com, targets 1,500 / 110)
 *   11/26 meals  none: the shake is created → 495 / 64. Day stays open. Her
 *                Quick add "Protein yogurt bowl + banana" 495/64 is the same
 *                build: left (none asked). Nothing else on her account touched.
 *
 * No steps, no targets, no maintenance inputs (ADR-0024). Dry run unless
 * `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/user-data-2026-11-26-breakfasts.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf, LOG_LABEL_MAX, LOG_NOTE_MAX } from '../packages/core/src/index.ts';
import { at, hm, open, type MealInput } from './lib/user-data.mts';

const DAY = '2026-11-26';
const s = await open('user-data-2026-11-26-breakfasts');
const owner = await s.user('gabrielandresbermudez@gmail.com');
const steph = await s.user('stph.ctllo@gmail.com');

const dayRows = async (user: DocumentReference) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(DAY, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(DAY, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

/** Log the one breakfast; refuse when the day holds anything else. */
async function breakfast(user: DocumentReference, who: string, meal: MealInput & { note: string }) {
  if (meal.label.length > LOG_LABEL_MAX || meal.note.length > LOG_NOTE_MAX) { s.problem(`${who}: label or note too long`); return; }
  const rows = await dayRows(user);
  const have = rows.find((d) => d.get('mealLabel') === meal.label);
  if (!have) s.logMeal(user, meal);
  else if (have.get('calories') !== meal.kcal || have.get('protein') !== meal.protein) s.problem(`${who}: ${DAY} already has "${meal.label}" as ${have.get('calories')}/${have.get('protein')}`);
  const strangers = rows.filter((d) => d.get('mealLabel') !== meal.label);
  if (strangers.length) s.problem(`${who}: ${DAY} has rows that were not there when it was read: ${strangers.map((d) => `"${d.get('mealLabel')}"`).join(', ')}`);
  s.markDay(await user.collection('dailyLogged').doc(DAY).get(), null);
}

// ═══ Owner ═══
await breakfast(owner, 'owner', {
  day: DAY, time: '10:50', slot: 'breakfast', label: 'Pea shake (Greek + pito + PBfit)', kcal: 463, protein: 71,
  note: '3 scoops SOLO pea protein 210/45 · ½ c Greek yogurt 75/13.5 · 1 pea-scoop Andean grain mix / pito (17 g) 63/3 · 1 small banana ~60 g 55/1 · 2 tbsp PBfit 60/8 · water. Greek replaces cottage cheese (lower sodium); pito replaces oats.',
});
const QUICK = { name: 'Pea shake (Greek + pito + PBfit, small banana)', calories: 463, protein: 71 };
const presets = (await owner.collection('presets').get()).docs.filter((d) => d.get('name') === QUICK.name);
if (presets.length > 1) s.problem(`owner: ${presets.length} Quick adds are named "${QUICK.name}"`);
else if (!presets[0]) s.saveMeal(owner, 'quickAdd', QUICK);
else if (presets[0].get('calories') !== QUICK.calories || presets[0].get('protein') !== QUICK.protein) s.problem(`owner: Quick add "${QUICK.name}" exists as ${presets[0].get('calories')}/${presets[0].get('protein')}`);

const NOTE = { from: DAY, to: DAY, label: 'Thu 11/26 — low-sodium day', note: 'Low-sodium day planned after two restaurant meals on 11/25.' };
const profile = await owner.get();
const stored = JSON.parse(JSON.stringify(profile.get('homePlan') ?? null)) as { notes?: (typeof NOTE)[] } | null;
if (!stored?.notes) s.problem('owner: profile.homePlan has no notes');
else {
  const same = stored.notes.filter((n) => n.from === DAY && n.to === DAY && n.label === NOTE.label);
  // Reworded by the next prompt (`user-data-2026-11-26-lunches.mts`).
  const LATER = 'Leftovers carry ~700–800 mg sodium; rest of the day kept low-sodium after two restaurant meals on 11/25.';
  if (same.length && same[0].note !== NOTE.note && same[0].note !== LATER) s.problem(`owner: "${NOTE.label}" exists with another note: ${same[0].note}`);
  else if (!same.length) {
    const next = { ...stored, notes: [...stored.notes, NOTE] };
    const kept = homePlanOf({ homePlan: next })?.notes ?? [];
    if (kept.length !== next.notes.length || !kept.some((n) => n.label === NOTE.label && n.note === NOTE.note)) s.problem(`owner: core homePlanOf keeps ${kept.length} of ${next.notes.length} notes`);
    else s.update(profile, { homePlan: next }, `owner: homePlan + "${NOTE.label}" (${next.notes.length} notes)`);
  }
}
s.note('owner, left alone: targets · the 11/26 weigh-in and tape · the session and templates (push-review script) · My Foods pea shakes · steps are not read or written');

// ═══ Stephanie: the row only ═══
await breakfast(steph, 'Stephanie', {
  day: DAY, time: '10:50', slot: 'breakfast', label: 'Protein yogurt shake', kcal: 495, protein: 64,
  note: 'Same build as 11/24: 2 scoops pea protein · ½ c Greek yogurt · ½ c cottage cheese · ½ c mango kefir · ½ c berries · banana.',
});
s.note('Stephanie, left alone: everything else (no day flag, her saved meals, her Stephanie Split v1 templates)');

await s.run({
  report: async () => {
    for (const [who, user] of [['owner', owner], ['Stephanie', steph]] as const) {
      const docs = await dayRows(user);
      const flag = await user.collection('dailyLogged').doc(DAY).get();
      console.log(`\n${who} ${DAY}: ${docs.length} row(s) = ${docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0)} kcal / ${docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0)} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
      for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${d.get('mealType')} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`);
    }
    const q = (await owner.collection('presets').get()).docs.filter((d) => d.get('name') === QUICK.name);
    console.log(`\nowner Quick add: ${q.map((d) => `"${d.get('name')}" ${d.get('calories')}/${d.get('protein')}`).join(', ')}`);
  },
});
