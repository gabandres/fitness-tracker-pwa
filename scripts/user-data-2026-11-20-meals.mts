/**
 * User data, requested 2026-11-20 (America/Puerto_Rico): the meals of 11/19 and
 * 11/20 for the owner, one row for Stephanie, and four saved meals. Values are
 * the owner's, entered exactly.
 *
 * What the read found (2026-11-20 ~13:30): both of them had ALREADY logged
 * these meals in the app under short names ("Pea Protein", "Patty", "Jugo"…),
 * so this RENAMES those rows, moves them to the stated times and adds the
 * recipe notes — it never adds a second copy. Only the 11/20 QDOBA lunch has no
 * row and is created.
 *
 *   OWNER 11/19   five rows fixed. A SECOND "Unreal" 90/2, logged in the app at
 *                 22:24, is not in the request: left exactly as it is, and
 *                 reported (the day is 1,608 / 147 with it, 1,518 / 145 without).
 *                 `dailyLogged/2026-11-19` → complete.
 *   OWNER 11/20   the shake fixed, the QDOBA lunch created (its note opens
 *                 "Estimated (restaurant)" — a log row has no estimate flag).
 *                 `dailyLogged/2026-11-20` was already `complete: true`; the
 *                 request says to leave the day open for dinner, so it is
 *                 removed (a day marked complete at 1,105 kcal would enter the
 *                 maintenance fit as a full day).
 *   OWNER saved   My Foods (`customFoods`, where "Pea shake v3 (no cottage)"
 *                 lives): the cottage pea shake, two QDOBA bowls, the 1-cup
 *                 egg-white oatmeal. A saved food has no note field, so the
 *                 "protein likely overestimated" note goes on the five older
 *                 QDOBA LOG rows (570–830 kcal, 70–76 g).
 *   STEPHANIE     her 11/19 "Jugo" 280/37 row → "Pea berry shake", 12:30, the
 *                 recipe note. Nothing else on her account is read or written.
 *
 * No weigh-ins, no step data, no targets. Dry run unless `--apply`; every
 * touched doc is backed up to ~/ignia-backups first; a re-run plans 0.
 *
 *   TZ=America/Puerto_Rico npx jiti scripts/user-data-2026-11-20-meals.mts [--apply]
 *
 * Auth: ADC (`gcloud auth application-default login`).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { type DocCodec, LOG_LABEL_MAX, LOG_NOTE_MAX, toLogDoc, withDefaultMealSlot } from '../packages/core/src/index.ts';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const OWNER = 'gabrielandresbermudez@gmail.com';
const STEPHANIE = 'stph.ctllo@gmail.com';
const APPLY = process.argv.includes('--apply');
if (process.env.TZ !== 'America/Puerto_Rico') throw new Error('run with TZ=America/Puerto_Rico');
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);
const hm = (d: Date) => d.toLocaleString('en-US', { timeZone: 'America/Puerto_Rico', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

const SHAKE = 'Pea shake (cottage, ½ c oats, no chia)';
const SHAKE_NOTE = '3 scoops SOLO pea 210/45 · ½ c Daisy low fat cottage cheese 90/13 · ½ c rolled oats 150/5 · banana ~95 g (estimated) 84/1 · 2 c water, cinnamon, vanilla, salt. No chia, no Greek yogurt (out of stock after trip).';
const QDOBA_OLD_NOTE = 'protein likely overestimated; double chicken ≈ 38–40 g';

/** A row that is already there, found by id and checked against what was read. */
type Fix = { id: string; was: { label: string; kcal: number; protein: number }; label: string; day: string; time: string; protein?: number; note?: string };

const OWNER_FIXES: Fix[] = [
  { id: 'VpQQElvGPhrEay4nv94i', was: { label: 'Pea Protein', kcal: 530, protein: 64 }, label: SHAKE, day: '2026-11-19', time: '12:30', note: SHAKE_NOTE },
  // The request gives 1 g; the app's "Unreal" quick-add stores 2.
  { id: 'eIOQDrZZxd8Nb1vTScyN', was: { label: 'Unreal', kcal: 90, protein: 2 }, label: 'UNREAL', day: '2026-11-19', time: '13:30', protein: 1 },
  { id: 'yGpe2HQbm8ZAofZrZKzy', was: { label: 'Patty', kcal: 410, protein: 29 }, label: 'Beef patty + broccoli', day: '2026-11-19', time: '17:00', note: 'Kirkland grass-fed beef patty ×1 (151 g raw) 380/26 · broccoli ~90 g (unweighed, estimated) 30/3. No cheese, tortilla or oil.' },
  { id: 'JuYpuBBQJyni9jCQ043K', was: { label: 'Oatmeal 1 cup', kcal: 298, protein: 30 }, label: 'Egg white oatmeal (1 c whites, backup version)', day: '2026-11-19', time: '20:00', note: '⅓ c rolled oats 100/3.3 · 1 c liquid egg whites 126/26 · ½ c frozen wild berries 40/0.5 · ½ tbsp honey 32/0 · water, salt, vanilla, cinnamon. No chia. Note: fine, but ½ c egg whites stays the standard; 1 c only as a protein backup.' },
  { id: 'km19KOwb4WlmSBsHhs3R', was: { label: 'Kirkland PB', kcal: 190, protein: 21 }, label: 'Kirkland protein bar (PB)', day: '2026-11-19', time: '20:20' },
  { id: 'q7oGkkXG1Nbquzdq4IcK', was: { label: 'Pea Protein', kcal: 530, protein: 64 }, label: SHAKE, day: '2026-11-20', time: '10:00', note: SHAKE_NOTE },
];
/** In the app, not in the request: never touched. */
const OWNER_EXTRA = { id: 'tqkUPko9wYpsEWnY71hZ', label: 'Unreal', kcal: 90, protein: 2 };

const QDOBA_ROW = {
  day: '2026-11-20', time: '13:15', slot: 'lunch' as const, label: 'QDOBA salad bowl, double chicken', kcal: 575, protein: 41,
  note: 'Estimated (restaurant). Grilled adobo chicken ×2 ~380/38 · romaine base 15/1 · pico de gallo + salsa roja ~20/0 · fajita vegetables ~35/1 · pickled red onions ~10/0 · chile crema drizzle ~90/0 (estimate) · cotija light sprinkle ~25/1. No guac, rice, beans, shredded cheese or dressing.',
};

const SAVED = [
  { name: SHAKE, calories: 530, protein: 64 },
  { name: 'QDOBA salad bowl, double chicken (with chile crema)', calories: 575, protein: 41 },
  { name: 'QDOBA salad bowl, double chicken (no crema)', calories: 485, protein: 41 },
  { name: 'Egg white oatmeal (1 c whites, backup)', calories: 298, protein: 30 },
];

const STEPH_FIX: Fix = {
  id: 'mgIwLRc09JaU2YQ0BhrQ', was: { label: 'Jugo', kcal: 280, protein: 37 }, label: 'Pea berry shake', day: '2026-11-19', time: '12:30',
  note: '1.5 scoops SOLO pea 105/22.5 · 1 c mixed berries 80/1 · ½ c spinach 4/0.5 · ½ c Daisy low fat cottage cheese 90/13 · water.',
};

for (const f of [...OWNER_FIXES, STEPH_FIX]) {
  if (f.label.length > LOG_LABEL_MAX) throw new Error(`label too long: ${f.label}`);
  if (f.note && f.note.length > LOG_NOTE_MAX) throw new Error(`note too long (${f.note.length}): ${f.label}`);
}
if (QDOBA_ROW.note.length > LOG_NOTE_MAX) throw new Error(`QDOBA note too long: ${QDOBA_ROW.note.length}`);
for (const s of SAVED) if (s.name.length > 100) throw new Error(`saved name too long: ${s.name}`);

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const CODEC: DocCodec<Timestamp> = { timestamp: (d) => Timestamp.fromDate(d), remove: () => FieldValue.delete() };
const ownerUid = (await getAuth().getUserByEmail(OWNER)).uid;
const stephUid = (await getAuth().getUserByEmail(STEPHANIE)).uid;
const owner = db.doc(`users/${ownerUid}`);
const steph = db.doc(`users/${stephUid}`);

const problems: string[] = [];
const plan: string[] = [];
type Write = { ref: FirebaseFirestore.DocumentReference; patch: Record<string, unknown> };
const updates: Write[] = [];
const backupDocs: Record<string, unknown> = {};
const conv = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  return v;
};

/** Plan one row fix; a row already carrying the new values plans nothing. */
async function planFix(user: FirebaseFirestore.DocumentReference, who: string, f: Fix) {
  const ref = user.collection('dailyLogs').doc(f.id);
  const d = await ref.get();
  if (!d.exists) { problems.push(`${who}: log ${f.id} ("${f.was.label}") is gone`); return; }
  const label = d.get('mealLabel');
  const kcal = d.get('calories');
  const protein = d.get('protein');
  const wantProtein = f.protein ?? f.was.protein;
  const isOld = label === f.was.label && kcal === f.was.kcal && protein === f.was.protein;
  const isNew = label === f.label && kcal === f.was.kcal && protein === wantProtein;
  if (!isOld && !isNew) { problems.push(`${who}: log ${f.id} is now "${label}" ${kcal}/${protein}, not "${f.was.label}" ${f.was.kcal}/${f.was.protein}`); return; }
  const patch: Record<string, unknown> = {};
  if (label !== f.label) patch['mealLabel'] = f.label;
  if (protein !== wantProtein) patch['protein'] = wantProtein;
  const t = at(f.day, f.time);
  if ((d.get('timestamp') as Timestamp).toMillis() !== t.getTime()) patch['timestamp'] = Timestamp.fromDate(t);
  if (f.note && d.get('note') !== f.note) {
    if (d.get('note') != null) { problems.push(`${who}: log ${f.id} already has a different note: ${d.get('note')}`); return; }
    patch['note'] = f.note;
  }
  if (Object.keys(patch).length === 0) return;
  backupDocs[ref.path] = d.data();
  updates.push({ ref, patch });
  plan.push(`${who}: UPDATE "${label}" ${kcal}/${protein} (${hm((d.get('timestamp') as Timestamp).toDate())}) → "${f.label}" ${kcal}/${wantProtein} at ${f.day.slice(5)} ${f.time}${f.note ? ' + note' : ''}`);
}

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — now ${new Date().toString()}`);

// ── owner: rows ──
for (const f of OWNER_FIXES) await planFix(owner, 'owner', f);
const extra = await owner.collection('dailyLogs').doc(OWNER_EXTRA.id).get();
const extraThere = extra.exists && extra.get('calories') === OWNER_EXTRA.kcal;

const dayRows = async (user: FirebaseFirestore.DocumentReference, day: string, next: string) => (await user.collection('dailyLogs')
  .where('timestamp', '>=', Timestamp.fromDate(at(day, '00:00')))
  .where('timestamp', '<', Timestamp.fromDate(at(next, '00:00')))
  .orderBy('timestamp').get()).docs;
const total = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => docs.reduce((a, x) => [a[0] + (x.get('calories') ?? 0), a[1] + (x.get('protein') ?? 0)], [0, 0]);

const owner20 = await dayRows(owner, '2026-11-20', '2026-11-21');
const qdobaThere = owner20.find((d) => d.get('calories') === QDOBA_ROW.kcal && d.get('protein') === QDOBA_ROW.protein);
const qdobaNear = owner20.filter((d) => /qdoba/i.test(String(d.get('mealLabel') ?? '')) && d !== qdobaThere);
if (qdobaNear.length) problems.push(`owner: 11/20 already has a different QDOBA row: ${qdobaNear.map((d) => `"${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`).join(', ')}`);
const createQdoba = !qdobaThere && !qdobaNear.length;
if (createQdoba) plan.push(`owner: CREATE 11-20 ${QDOBA_ROW.time} ${QDOBA_ROW.slot} "${QDOBA_ROW.label}" ${QDOBA_ROW.kcal}/${QDOBA_ROW.protein} + note (estimated, restaurant)`);

// ── owner: day flags ──
const l19 = await owner.collection('dailyLogged').doc('2026-11-19').get();
const l20 = await owner.collection('dailyLogged').doc('2026-11-20').get();
const mark19 = !(l19.exists && l19.get('complete') === true);
const open20 = l20.exists;
if (mark19) plan.push(`owner: dailyLogged/2026-11-19 → complete: true${l19.exists ? ` (was ${l19.get('complete')})` : ''}`);
if (open20) { plan.push(`owner: dailyLogged/2026-11-20 REMOVED (was complete: ${l20.get('complete')}) — the day stays open for dinner`); backupDocs[l20.ref.path] = l20.data(); }
if (l19.exists && mark19) backupDocs[l19.ref.path] = l19.data();

// ── owner: saved meals (My Foods) ──
const foods = (await owner.collection('customFoods').get()).docs;
const foodNames = new Map(foods.map((d) => [String(d.get('name')), d]));
const newFoods = SAVED.filter((s) => {
  const have = foodNames.get(s.name);
  if (!have) return true;
  if (have.get('calories') !== s.calories || have.get('protein') !== s.protein) problems.push(`owner: saved meal "${s.name}" exists as ${have.get('calories')}/${have.get('protein')}`);
  return false;
});
for (const s of newFoods) plan.push(`owner: SAVE "${s.name}" ${s.calories}/${s.protein} (My Foods, 1 serving)`);
for (const need of ['Pea shake v3 (no cottage)']) if (!foodNames.has(need)) problems.push(`owner: expected saved meal "${need}" not found`);
const oatDefaults = [...foodNames.keys()].filter((n) => /light oatmeal \+ egg whites/i.test(n));

// ── owner: the older QDOBA rows ──
const recent = (await owner.collection('dailyLogs').orderBy('timestamp', 'desc').limit(1500).get()).docs;
const oldQdoba = recent.filter((d) => /qdoba/i.test(String(d.get('mealLabel') ?? ''))
  && d.get('calories') >= 570 && d.get('calories') <= 830 && d.get('protein') >= 70 && d.get('protein') <= 76);
for (const d of oldQdoba) {
  if (d.get('note') === QDOBA_OLD_NOTE) continue;
  if (d.get('note') != null) { problems.push(`owner: QDOBA row ${d.id} already has a note: ${d.get('note')}`); continue; }
  backupDocs[d.ref.path] = d.data();
  updates.push({ ref: d.ref, patch: { note: QDOBA_OLD_NOTE } });
  plan.push(`owner: NOTE on ${hm((d.get('timestamp') as Timestamp).toDate())} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}`);
}

// ── Stephanie: one row ──
await planFix(steph, 'stephanie', STEPH_FIX);

console.log(`\nPLAN (${plan.length}):`);
for (const p of plan) console.log(`  ${p}`);
console.log(`\nLeft alone: owner 11/19 22:24 "Unreal" 90/2 (${extraThere ? 'in the app, not in the request' : 'no longer there'}) · every other row on both accounts · no weigh-ins, steps or targets.`);
console.log(`Oatmeal default(s) already saved, unchanged: ${oatDefaults.map((n) => `"${n}"`).join(', ') || 'none found'}`);
if (problems.length) { console.log(`\nREFUSING:\n${problems.map((p) => `  ${p}`).join('\n')}`); process.exit(1); }

const report = async () => {
  const o19 = await dayRows(owner, '2026-11-19', '2026-11-20');
  const o20 = await dayRows(owner, '2026-11-20', '2026-11-21');
  const s19 = await dayRows(steph, '2026-11-19', '2026-11-20');
  for (const [name, docs] of [['owner 11/19', o19], ['owner 11/20', o20], ['stephanie 11/19', s19]] as const) {
    const [k, p] = total(docs);
    console.log(`\n${name}: ${docs.length} rows = ${k} kcal / ${p} g`);
    for (const d of docs) console.log(`  ${hm((d.get('timestamp') as Timestamp).toDate()).slice(7)} ${String(d.get('mealType')).padEnd(9)} "${d.get('mealLabel')}" ${d.get('calories')}/${d.get('protein')}${d.get('note') ? ' · note' : ''}`);
  }
  const f19 = await owner.collection('dailyLogged').doc('2026-11-19').get();
  const f20 = await owner.collection('dailyLogged').doc('2026-11-20').get();
  console.log(`\nowner day flags: 11/19 ${f19.exists ? `complete ${f19.get('complete')}` : 'unset'} · 11/20 ${f20.exists ? `complete ${f20.get('complete')}` : 'open'}`);
};

if (!APPLY) { console.log('\nAs stored now:'); await report(); console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }
if (plan.length === 0) { console.log('\nNothing to do (already applied).'); await report(); process.exit(0); }

const dir = join(homedir(), 'ignia-backups');
const backup = join(dir, `user-data-2026-11-20-meals-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
mkdirSync(dir, { recursive: true });
writeFileSync(backup, JSON.stringify(conv(backupDocs), null, 1));
if (!existsSync(backup)) throw new Error('backup not written — refusing to write');
console.log(`\nbackup written: ${backup}`);

const batch = db.batch();
const ts = Timestamp.now();
for (const u of updates) batch.update(u.ref, u.patch);
if (createQdoba) {
  const t = at(QDOBA_ROW.day, QDOBA_ROW.time);
  batch.set(owner.collection('dailyLogs').doc(), toLogDoc(withDefaultMealSlot({ calories: QDOBA_ROW.kcal, protein: QDOBA_ROW.protein, mealLabel: QDOBA_ROW.label, mealType: QDOBA_ROW.slot, timestamp: t, note: QDOBA_ROW.note }, t), CODEC));
}
if (mark19) batch.set(owner.collection('dailyLogged').doc('2026-11-19'), { complete: true, updatedAt: ts });
if (open20) batch.delete(l20.ref);
for (const s of newFoods) batch.set(owner.collection('customFoods').doc(), { name: s.name, servingSize: 1, servingUnit: 'serving', calories: s.calories, protein: s.protein, source: 'manual', createdAt: ts });
await batch.commit();
console.log(`written: ${plan.length} change(s).`);
await report();
process.exit(0);
