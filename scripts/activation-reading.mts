/**
 * READ-ONLY: the activation reading `STATUS.md` asks for after the 2026-11-19
 * batch (no verification wall, first-log step, reminder card on Today).
 *
 *   npx jiti scripts/activation-reading.mts [--since 2026-11-19] [--days 120]
 *
 * For accounts whose profile was created before and on/after `--since`:
 * signups, how many ever logged, median time to the first log, and how many
 * turned reminders on, each split by whether the address is verified. Before
 * that date an unverified account could not finish onboarding, so compare the
 * two periods on the VERIFIED rows (`UX_AUDIT.md` S24-1c). Seeded accounts are
 * left out, as in `functions/src/retention.ts`.
 *
 * Reads: one `users` query, one `usageEvents` range, Auth `getUsers`. Writes
 * nothing. Auth: ADC.
 */
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { open } from './lib/user-data.mts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const since = new Date(`${arg('since', '2026-11-19')}T00:00:00-04:00`);
const days = Number(arg('days', '120'));
const s = await open('activation-reading');
const windowStart = new Date(Date.now() - days * 86_400_000);

const profiles = (await s.db.collection('users')
  .where('createdAt', '>=', Timestamp.fromDate(windowStart))
  .select('createdAt', 'firstEntryAt', 'syntheticAccount')
  .get()).docs.filter((d) => d.get('syntheticAccount') !== true);

const verified = new Map<string, boolean>();
for (let i = 0; i < profiles.length; i += 100) {
  const page = await getAuth().getUsers(profiles.slice(i, i + 100).map((d) => ({ uid: d.id })));
  for (const u of page.users) verified.set(u.uid, u.emailVerified === true);
}

const remindersOn = new Set<string>();
const usage = await s.db.collection('usageEvents').where('day', '>=', windowStart.toISOString().slice(0, 10)).select('uid', 'reminders_on').get();
for (const d of usage.docs) if ((d.get('reminders_on') ?? 0) > 0) remindersOn.add(String(d.get('uid')));

interface Bucket { signups: number; everLogged: number; reminders: number; ttfl: number[] }
const bucket = (): Bucket => ({ signups: 0, everLogged: 0, reminders: 0, ttfl: [] });
const out: Record<'before' | 'after', Record<'verified' | 'unverified', Bucket>> = {
  before: { verified: bucket(), unverified: bucket() },
  after: { verified: bucket(), unverified: bucket() },
};
let unknown = 0;
for (const d of profiles) {
  const v = verified.get(d.id);
  if (v == null) { unknown++; continue; }
  const created = (d.get('createdAt') as Timestamp).toDate();
  const b = out[created < since ? 'before' : 'after'][v ? 'verified' : 'unverified'];
  b.signups++;
  const first = d.get('firstEntryAt') as Timestamp | undefined;
  if (first) {
    b.everLogged++;
    const secs = (first.toMillis() - created.getTime()) / 1000;
    if (secs >= 0) b.ttfl.push(secs);
  }
  if (remindersOn.has(d.id)) b.reminders++;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const median = (xs: number[]) => {
  if (!xs.length) return '—';
  const m = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return m < 3600 ? `${Math.round(m / 60)} min` : `${(m / 3600).toFixed(1)} h`;
};
console.log(`Accounts with a profile created in the last ${days} days: ${profiles.length} (seeded left out; ${unknown} no longer in Auth).`);
for (const period of ['before', 'after'] as const) {
  console.log(`\n${period === 'before' ? 'Before' : 'On or after'} ${since.toISOString().slice(0, 10)}:`);
  for (const side of ['verified', 'unverified'] as const) {
    const b = out[period][side];
    console.log(`  ${side.padEnd(10)} signups ${String(b.signups).padStart(3)} · ever logged ${b.everLogged} (${pct(b.everLogged, b.signups)}) · median to first log ${median(b.ttfl)} · reminders on ${b.reminders} (${pct(b.reminders, b.signups)})`);
  }
}
process.exit(0);
