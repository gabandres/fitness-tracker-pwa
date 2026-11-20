/**
 * READ-ONLY: what an account holds for a span of days. Run it BEFORE writing a
 * `user-data-*.mts` script — a request describes the days as the person
 * remembers them, and the stored days are often already different (meals
 * logged under short names, a day already marked complete, a saved meal under
 * another name).
 *
 *   npx jiti scripts/user-state.mts <email> <from YYYY-MM-DD> [to YYYY-MM-DD]
 *     [--foods <regex>]   saved meals (My Foods + Quick add) whose name matches
 *     [--logs <regex>]    past log rows whose label matches (newest 1,500)
 *     [--plan]            homePlan and travelPeriods
 *
 * Prints document ids, so a script can name the exact row it means to change.
 */
import { open, at, hm } from './lib/user-data.mts';
import { Timestamp } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !['--foods', '--logs'].includes(args[i - 1] ?? ''));
const [email, from, to = from] = positional;
if (!email || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error('usage: npx jiti scripts/user-state.mts <email> <from YYYY-MM-DD> [to YYYY-MM-DD] [--foods <regex>] [--logs <regex>] [--plan]');
  process.exit(64);
}

const s = await open('user-state');
const user = await s.user(email);
const p = (await user.get()).data() ?? {};
console.log(`uid ${user.id.slice(0, 6)}… · targets ${p.targetMode ?? '-'} ${p.manualCaloriesTarget ?? '-'}/${p.manualProteinTarget ?? '-'} · units ${p.unitSystem ?? '-'} · proteinFirst ${p.proteinFirst ?? false}`);

const days: string[] = [];
for (let d = at(from, '12:00'); d <= at(to, '12:00'); d = new Date(d.getTime() + 86_400_000)) days.push(d.toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' }));

const end = new Date(at(to, '00:00').getTime() + 86_400_000);
const logs = (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(from, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(end))
  .orderBy('timestamp').get()).docs;

for (const day of days) {
  const rows = logs.filter((d) => (d.get('timestamp') as Timestamp).toDate().toLocaleDateString('en-CA', { timeZone: 'America/Puerto_Rico' }) === day);
  const kcal = rows.reduce((n, d) => n + (d.get('calories') ?? 0), 0);
  const protein = rows.reduce((n, d) => n + (d.get('protein') ?? 0), 0);
  const logged = await user.collection('dailyLogged').doc(day).get();
  const weight = await user.collection('dailyWeights').doc(day).get();
  console.log(`\n${day}: ${rows.length} rows = ${kcal} kcal / ${protein} g · fully logged: ${logged.exists ? logged.get('complete') : 'unset'} · weigh-in: ${weight.exists ? weight.get('weight') : '—'}`);
  for (const d of rows) {
    const note = d.get('note') ? ` note:"${String(d.get('note')).slice(0, 50)}…"` : '';
    console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType') ?? '-').padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? '-'}${note} [${d.id}]`);
  }
}

const foods = flag('foods');
if (foods) {
  const re = new RegExp(foods, 'i');
  for (const [name, label] of [['customFoods', 'My Foods'], ['presets', 'Quick add']] as const) {
    const hits = (await user.collection(name).get()).docs.filter((d) => re.test(String(d.get('name') ?? '')));
    console.log(`\n${label} matching /${foods}/ (${hits.length}):`);
    for (const d of hits) console.log(`  "${d.get('name')}" ${d.get('calories')}/${d.get('protein') ?? '-'} [${d.id}]`);
  }
}

const past = flag('logs');
if (past) {
  const re = new RegExp(past, 'i');
  const all = (await user.collection('dailyLogs').orderBy('timestamp', 'desc').limit(1500).get()).docs;
  const hits = all.filter((d) => re.test(String(d.get('mealLabel') ?? '')));
  console.log(`\nlog rows matching /${past}/ (${hits.length} of the newest ${all.length}):`);
  for (const d of hits) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate())} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein') ?? '-'} note:${d.get('note') ? `"${String(d.get('note')).slice(0, 70)}"` : '—'} [${d.id}]`);
}

if (args.includes('--plan')) {
  console.log(`\nhomePlan: ${JSON.stringify(p.homePlan ?? null, null, 1)}`);
  console.log(`\ntravelPeriods: ${JSON.stringify((p.travelPeriods ?? []).map((t: { start: string; end: string; label?: string }) => ({ start: t.start, end: t.end, label: t.label })), null, 1)}`);
}
process.exit(0);
