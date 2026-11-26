/**
 * User data, requested 2026-11-26 (America/Puerto_Rico), the third prompt of
 * the day: the 11/26 lunches on two accounts, the owner's day note reworded,
 * the Mon 11/30 tape reminder with chest tracked. Everything else in the
 * request is already stored by `owner-data-2026-11-26-push-review.mts` and
 * `user-data-2026-11-26-breakfasts.mts` (both re-run to plan 0), so it is
 * only checked here.
 *
 * What the read found (2026-11-26, `scripts/user-state.mts`):
 *
 * Owner (gabrielandresbermudez@gmail.com, targets 1,850 / 140, unchanged)
 *   11/25        Denny's 480/35 [qcrhcvP1CNgAuq6zAE2Z], day 1,954 / 188: checked, unchanged.
 *   11/26 meals  breakfast 463/71 [VH8nGrjczyayrWOR3Ed3]; the leftovers are
 *                created → 1,012 / 106. Day stays open (dinner planned).
 *   Day note     "Thu 11/26 — low-sodium day" → the request's new wording
 *                (same note, not a second one).
 *   Reminder     the home plan's `checkIn` IS the reminder (7 AM local
 *                notification on its day + the Body card for a week): moved
 *                11/26 → Mon 11/30 with the request's text, baseline 10/30
 *                kept, `sites` waist · neck · chest (chest has no baseline:
 *                the card shows its first reading).
 *   Chest        no per-account setting exists; the sheet always has chest
 *                and Body charts any taped site. "Tracked" = the check-in
 *                card, which read waist and neck only (code change, same commit).
 *
 * Stephanie (stph.ctllo@gmail.com, targets 1,500 / 110)
 *   11/26 meals  breakfast 495/64 [jGYWXCKFqYkksYFy6dQb]; the burger lunch is
 *                created → 945 / 80. Day stays open. Nothing else touched.
 *
 * A log row has no "estimated" flag: the note says it. No steps, no targets.
 * Dry run unless `--apply`; a re-run plans nothing.
 *
 *   npx jiti scripts/user-data-2026-11-26-lunches.mts [--apply]
 */
import { Timestamp, type DocumentReference } from 'firebase-admin/firestore';
import { homePlanOf } from '../packages/core/src/index.ts';
import { at, hm, open, type MealInput } from './lib/user-data.mts';

const DAY = '2026-11-26';
const s = await open('user-data-2026-11-26-lunches');
const owner = await s.user('gabrielandresbermudez@gmail.com');
const steph = await s.user('stph.ctllo@gmail.com');

const dayRows = async (user: DocumentReference, day: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(new Date(at(day, '00:00').getTime() + 86_400_000)))
  .orderBy('timestamp').get()).docs;

/** Log the lunch; the day must hold the known rows and nothing else. */
async function lunch(user: DocumentReference, who: string, known: Record<string, [number, number]>, meal: MealInput & { note: string }, total: [number, number]) {
  const rows = await dayRows(user, DAY);
  const have = rows.find((d) => d.get('mealLabel') === meal.label);
  if (!have) s.logMeal(user, meal);
  else if (have.get('calories') !== meal.kcal || have.get('protein') !== meal.protein) s.problem(`${who}: ${DAY} already has "${meal.label}" as ${have.get('calories')}/${have.get('protein')}`);
  for (const d of rows.filter((r) => r.get('mealLabel') !== meal.label)) {
    const k = known[d.id];
    if (!k) s.problem(`${who}: ${DAY} has a row that was not there when it was read: "${d.get('mealLabel')}" [${d.id}]`);
    else if (d.get('calories') !== k[0] || d.get('protein') !== k[1]) s.problem(`${who}: [${d.id}] is ${d.get('calories')}/${d.get('protein')}, read as ${k[0]}/${k[1]}`);
  }
  const sum = Object.values(known).reduce((a, [k, p]) => [a[0] + k, a[1] + p], [meal.kcal, meal.protein]);
  if (sum[0] !== total[0] || sum[1] !== total[1]) s.problem(`${who}: total would be ${sum.join('/')}, the request says ${total.join('/')}`);
  s.markDay(await user.collection('dailyLogged').doc(DAY).get(), null);
}

// ═══ Owner ═══
await lunch(owner, 'owner', { VH8nGrjczyayrWOR3Ed3: [463, 71] }, {
  day: DAY, time: '13:15', slot: 'lunch', label: "Denny's leftovers: bourbon chicken + potatoes, vegetables, avocado", kcal: 549, protein: 35,
  note: "Estimated. Chicken breast with glaze 86 g (weighed) 155/27 · potatoes with glaze 144 g (weighed) 230/3 · broccoli + cauliflower 178 g (weighed) 50/4 · avocado 71 g (weighed) 114/1. Leftovers from the 11/25 Denny's skillet.",
}, [1012, 106]);

// 11/25 stays as it is.
const d25 = await dayRows(owner, '2026-11-25');
const dennys = d25.find((d) => d.id === 'qcrhcvP1CNgAuq6zAE2Z');
const t25 = d25.reduce((a, d) => [a[0] + (d.get('calories') ?? 0), a[1] + (d.get('protein') ?? 0)], [0, 0]);
if (dennys?.get('calories') !== 480 || dennys?.get('protein') !== 35 || t25[0] !== 1954 || t25[1] !== 188) s.problem(`owner 11/25: Denny's ${dennys?.get('calories')}/${dennys?.get('protein')}, day ${t25.join('/')} — expected 480/35 and 1954/188`);

const profile = await owner.get();
const stored = JSON.parse(JSON.stringify(profile.get('homePlan') ?? null)) as Record<string, unknown> & { notes?: { from: string; to: string; label: string; note: string }[] } | null;
if (!stored?.notes) s.problem('owner: profile.homePlan has no notes');
else {
  let next = stored;
  const LABEL = 'Thu 11/26 — low-sodium day';
  const NOTE = 'Leftovers carry ~700–800 mg sodium; rest of the day kept low-sodium after two restaurant meals on 11/25.';
  const same = stored.notes.filter((n) => n.from === DAY && n.label === LABEL);
  if (same.length !== 1) s.problem(`owner: ${same.length} home-plan notes "${LABEL}"`);
  else if (same[0].note !== NOTE) next = { ...next, notes: stored.notes.map((n) => (n === same[0] ? { ...n, note: NOTE } : n)) };

  const CHECK_IN = {
    date: '2026-11-30',
    title: 'Tape + photo check — Mon 11/30, before Leg Day',
    baseline: { date: '2026-10-30', weightLb: 151.8, waistIn: 31.25, neckIn: 14.5 },
    note: 'Tape: waist, neck and chest (nipple line, arms down, end of a normal breath out), 3 readings each. Photos: front, left side, back, all relaxed, same tile, phone at chest height.',
    sites: ['waist', 'neck', 'chest'],
  };
  const ci = stored['checkIn'] as { date?: string; baseline?: unknown } | undefined;
  if (JSON.stringify(ci?.baseline) !== JSON.stringify(CHECK_IN.baseline)) s.problem(`owner: checkIn baseline is ${JSON.stringify(ci?.baseline)}`);
  else if (ci?.date !== '2026-11-26' && ci?.date !== '2026-11-30') s.problem(`owner: checkIn is dated ${ci?.date}`);
  else if (JSON.stringify(ci) !== JSON.stringify(CHECK_IN)) next = { ...next, checkIn: CHECK_IN };

  if (next !== stored) {
    const kept = homePlanOf({ homePlan: next });
    const k = kept?.checkIn;
    if (kept?.notes?.length !== next.notes!.length || !kept.notes.some((n) => n.label === LABEL && n.note === NOTE)) s.problem('owner: core homePlanOf drops a note');
    else if (k?.date !== CHECK_IN.date || k.note !== CHECK_IN.note || k.title !== CHECK_IN.title || k.sites?.join() !== 'waist,neck,chest') s.problem(`owner: core homePlanOf reads the check-in as ${JSON.stringify(k)}`);
    else s.update(profile, { homePlan: next }, `owner: homePlan — "${LABEL}" reworded; checkIn → 11/30 (waist · neck · chest)`);
  }
}
s.note('owner, already stored by the earlier 11/26 scripts (re-run plans 0): breakfast + Quick add · session v2.4 + note · Push template loads and notes · shoulder-press rename · re-entry rules · Fri 11/27 rest · gym equipment · measurement note');
s.note('owner, left alone: targets · the 11/26 weigh-in and tape · travel templates (all 9 archived since 11/07–11/25) · steps are not read or written');

// ═══ Stephanie: the row only ═══
await lunch(steph, 'Stephanie', { jGYWXCKFqYkksYFy6dQb: [495, 64] }, {
  day: DAY, time: '13:15', slot: 'lunch', label: 'Burger half + avocado + fries + vegetables', kcal: 450, protein: 16,
  note: "Estimated. About half a Denny's burger with bun, cheese and sauce ~250/13 · avocado ~90 g (estimated from photo, not weighed) ~145/2 · about 10 matchstick fries ~40/0 · broccoli, cauliflower and a yellow vegetable slice ~15/1.",
}, [945, 80]);
s.note('Stephanie, left alone: everything else');

await s.run({
  report: async () => {
    for (const [who, user] of [['owner', owner], ['Stephanie', steph]] as const) {
      const docs = await dayRows(user, DAY);
      const flag = await user.collection('dailyLogged').doc(DAY).get();
      console.log(`\n${who} ${DAY}: ${docs.length} row(s) = ${docs.reduce((n, d) => n + (d.get('calories') ?? 0), 0)} kcal / ${docs.reduce((n, d) => n + (d.get('protein') ?? 0), 0)} g · fully logged: ${flag.exists ? flag.get('complete') : 'open'}`);
      for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${d.get('mealType')} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`);
    }
    const hp = homePlanOf((await owner.get()).data() as { homePlan?: unknown });
    console.log(`\nowner checkIn: ${JSON.stringify(hp?.checkIn)}`);
    console.log(`owner note 11/26: ${hp?.notes?.find((n) => n.from === DAY)?.note}`);
  },
});
