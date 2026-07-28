#!/usr/bin/env node
/**
 * Seeds the App Store **demo account** with a realistic history.
 *
 * Two jobs, one account:
 *   1. Screenshots — the capture checklist calls for populated data (empty
 *      rings and a blank Trends tab sell nothing), and it must not be the
 *      owner's own account, which carries real PII.
 *   2. App Review — App Store Connect's review notes need working demo
 *      credentials; a missing one is a common avoidable rejection.
 *
 * This writes to **PRODUCTION Firestore** (there is no app server; prod is
 * where the shipped iOS binary looks). It only ever touches documents under
 * the one target uid, and refuses to run against an account that already has
 * a real history unless you pass --force.
 *
 * Auth: Admin SDK via Application Default Credentials.
 *     gcloud auth application-default login
 *   or  GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
 *
 * Usage:
 *   node scripts/seed-demo-account.mjs --email demo@ignia.fit --password '…'
 *   node scripts/seed-demo-account.mjs --email demo@ignia.fit --dry-run
 *   node scripts/seed-demo-account.mjs --email demo@ignia.fit --force
 *
 * Idempotent: doc ids are derived, not random, and the data is generated from
 * a fixed seed, so re-running overwrites the same rows with the same values
 * instead of piling up a second history.
 *
 * Doc shapes mirror apps/mobile/src/lib/ledger.ts / FirestoreLedgerCore and
 * satisfy firestore.rules — the Admin SDK bypasses rules, but the account has
 * to stay editable from the client afterwards, so the shapes must still pass.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';

// How much history to fabricate. Weights run longer than logs so the Trends
// weight-trend line has a slope before the logging history starts.
const LOG_DAYS = 21;
const WEIGHT_DAYS = 28;

// ─── Args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const has = (n) => argv.includes(`--${n}`);

const email = arg('email');
const password = arg('password');
const dryRun = has('dry-run');
const force = has('force');

if (!email) {
  console.error(
    'Usage: node scripts/seed-demo-account.mjs --email <demo address> [--password <pw>] [--dry-run] [--force]',
  );
  process.exit(1);
}

// Cheap typo guard. The whole point of this account is that it is NOT a real
// user's, and a fat-fingered address here would write 100+ documents into
// someone's live history.
if (!/(demo|test|review|appstore)/i.test(email) && !force) {
  console.error(
    `Refusing to seed "${email}" — the address doesn't look like a demo account.\n` +
      'Use an address containing demo/test/review/appstore, or pass --force if you are sure.',
  );
  process.exit(1);
}

// ─── Deterministic generator ───────────────────────────────────────────
// A fixed-seed LCG, not Math.random: re-running must produce byte-identical
// data or "idempotent" is a lie and every run leaves a slightly different
// history behind the same doc ids.
let _seed = 20260728;
const rnd = () => {
  _seed = (_seed * 1103515245 + 12345) % 2147483648;
  return _seed / 2147483648;
};
/** Symmetric jitter in ±amount. */
const jitter = (amount) => (rnd() * 2 - 1) * amount;
const round = (n, dp = 0) => Number(n.toFixed(dp));

/** Local (not UTC) YYYY-MM-DD — the app's day-key convention. */
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `daysAgo` days before today, at the given local hour. */
const dayAt = (daysAgo, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
};

// ─── The demo persona ──────────────────────────────────────────────────
// A lifter on a moderate cut — the exact user the store listing addresses,
// so the screenshots show the app doing the thing the copy claims.
const PROFILE = {
  heightIn: 70,
  age: 32,
  sex: 'male',
  activityLevel: 'moderate',
  goalDirection: 'lose',
  targetPaceLbsPerWeek: 0.8,
  goalWeightLbs: 172,
  targetWeightLbs: 172,
  manualCaloriesTarget: 2180,
  manualProteinTarget: 165,
  proteinPerKg: 1.8,
  unitSystem: 'us',
  preferredLocale: 'en',
  weeklyDigestOptIn: true,
};

const START_WEIGHT = 184.2;
const END_WEIGHT = 178.9;

/** Meal rotation — plausible, protein-forward, never the same day twice. */
const MEALS = [
  [
    { mealType: 'breakfast', mealLabel: 'Greek yogurt, berries, granola', calories: 430, protein: 34, carbs: 52, fat: 8, hour: 7, minute: 40 },
    { mealType: 'lunch', mealLabel: 'Chicken burrito bowl', calories: 720, protein: 52, carbs: 78, fat: 20, hour: 12, minute: 30 },
    { mealType: 'snack', mealLabel: 'Whey shake + banana', calories: 280, protein: 28, carbs: 34, fat: 3, hour: 16, minute: 10 },
    { mealType: 'dinner', mealLabel: 'Salmon, rice, broccoli', calories: 690, protein: 48, carbs: 62, fat: 26, hour: 19, minute: 20 },
  ],
  [
    { mealType: 'breakfast', mealLabel: 'Egg white omelette, toast', calories: 390, protein: 32, carbs: 38, fat: 10, hour: 8, minute: 5 },
    { mealType: 'lunch', mealLabel: 'Turkey sandwich, apple', calories: 610, protein: 41, carbs: 72, fat: 16, hour: 12, minute: 50 },
    { mealType: 'snack', mealLabel: 'Cottage cheese, almonds', calories: 260, protein: 24, carbs: 12, fat: 14, hour: 15, minute: 45 },
    { mealType: 'dinner', mealLabel: 'Steak, sweet potato, salad', calories: 780, protein: 56, carbs: 58, fat: 32, hour: 19, minute: 40 },
  ],
  [
    { mealType: 'breakfast', mealLabel: 'Overnight oats, whey', calories: 460, protein: 36, carbs: 58, fat: 10, hour: 7, minute: 15 },
    { mealType: 'lunch', mealLabel: 'Poke bowl', calories: 660, protein: 44, carbs: 74, fat: 18, hour: 13, minute: 10 },
    { mealType: 'snack', mealLabel: 'Protein bar', calories: 210, protein: 20, carbs: 22, fat: 7, hour: 16, minute: 30 },
    { mealType: 'dinner', mealLabel: 'Chicken thighs, jasmine rice', calories: 740, protein: 52, carbs: 68, fat: 26, hour: 20, minute: 0 },
  ],
];

/** Presets — the "log in five seconds" story needs saved rows to exist. */
const PRESETS = [
  { id: 'demo-preset-shake', name: 'Whey shake + banana', calories: 280, protein: 28, carbs: 34, fat: 3 },
  { id: 'demo-preset-yogurt', name: 'Greek yogurt bowl', calories: 430, protein: 34, carbs: 52, fat: 8 },
  { id: 'demo-preset-chicken', name: 'Chicken + rice (meal prep)', calories: 610, protein: 55, carbs: 64, fat: 14 },
  { id: 'demo-preset-eggs', name: '3 eggs + toast', calories: 380, protein: 26, carbs: 30, fat: 18 },
];

const EXERCISES = [
  { id: 'demo-ex-squat', name: 'Back Squat', muscles: ['quads', 'glutes'], defaultCues: ['Brace before you unrack', 'Knees track over toes'] },
  { id: 'demo-ex-bench', name: 'Bench Press', muscles: ['chest', 'triceps'], defaultCues: ['Shoulder blades down and back', 'Touch mid-sternum'] },
  { id: 'demo-ex-row', name: 'Barbell Row', muscles: ['back', 'biceps'], defaultCues: ['Hinge to ~45°', 'Pull to the belly button'] },
  { id: 'demo-ex-ohp', name: 'Overhead Press', muscles: ['shoulders', 'triceps'], defaultCues: ['Squeeze glutes', 'Head through at lockout'] },
  { id: 'demo-ex-rdl', name: 'Romanian Deadlift', muscles: ['hamstrings', 'glutes'], defaultCues: ['Push hips back', 'Bar stays on the legs'] },
];

/** Progressive sessions: the load creeps up week over week, which is what
 *  makes the Train screenshot read as a real training history rather than
 *  four identical days. */
const SESSIONS = [
  { id: 'demo-session-1', daysAgo: 12, name: 'Upper A', durationMin: 58, lifts: [['demo-ex-bench', 'Bench Press', 165], ['demo-ex-row', 'Barbell Row', 155], ['demo-ex-ohp', 'Overhead Press', 105]] },
  { id: 'demo-session-2', daysAgo: 10, name: 'Lower A', durationMin: 64, lifts: [['demo-ex-squat', 'Back Squat', 225], ['demo-ex-rdl', 'Romanian Deadlift', 185]] },
  { id: 'demo-session-3', daysAgo: 5, name: 'Upper A', durationMin: 61, lifts: [['demo-ex-bench', 'Bench Press', 170], ['demo-ex-row', 'Barbell Row', 160], ['demo-ex-ohp', 'Overhead Press', 105]] },
  { id: 'demo-session-4', daysAgo: 3, name: 'Lower A', durationMin: 66, lifts: [['demo-ex-squat', 'Back Squat', 235], ['demo-ex-rdl', 'Romanian Deadlift', 190]] },
  { id: 'demo-session-5', daysAgo: 1, name: 'Upper A', durationMin: 59, lifts: [['demo-ex-bench', 'Bench Press', 170], ['demo-ex-row', 'Barbell Row', 165], ['demo-ex-ohp', 'Overhead Press', 110]] },
];

// ─── Build the document set ────────────────────────────────────────────
/** Every write this run will make: [path, data]. Built before anything is
 *  sent so --dry-run can print the exact plan. */
function buildDocs(uid) {
  const docs = [];
  const now = new Date();
  const createdAt = dayAt(WEIGHT_DAYS + 2, 9);

  docs.push([
    `users/${uid}`,
    {
      ...PROFILE,
      createdAt: Timestamp.fromDate(createdAt),
      lastSeenAt: Timestamp.fromDate(now),
      profileCompleted: true,
      onboardingV2CompletedAt: Timestamp.fromDate(createdAt),
      ageConfirmedAt: Timestamp.fromDate(createdAt),
      targetsRefinedAt: Timestamp.fromDate(dayAt(WEIGHT_DAYS - 3, 9)),
      timezoneOffsetMin: -new Date().getTimezoneOffset(),
    },
  ]);

  // Weight: a real cut is a noisy downward line, not a ruler. The trend has
  // to survive the noise — that is the whole claim of the first screenshot.
  for (let d = WEIGHT_DAYS - 1; d >= 0; d--) {
    const progress = (WEIGHT_DAYS - 1 - d) / (WEIGHT_DAYS - 1);
    const weight = START_WEIGHT + (END_WEIGHT - START_WEIGHT) * progress + jitter(0.7);
    docs.push([`users/${uid}/dailyWeights/${dateKey(dayAt(d, 7))}`, { weight: round(weight, 1) }]);
  }

  // Logs. Today is deliberately PARTIAL — a full day leaves nothing left in
  // the rings, and "calories left" is the number the app is about.
  for (let d = LOG_DAYS - 1; d >= 0; d--) {
    const day = MEALS[(LOG_DAYS - d) % MEALS.length];
    const meals = d === 0 ? day.slice(0, 3) : day;
    for (const [i, m] of meals.entries()) {
      const ts = dayAt(d, m.hour, m.minute);
      if (ts > new Date()) continue; // don't write meals in the future
      docs.push([
        `users/${uid}/dailyLogs/demo-${dateKey(ts)}-${i}`,
        {
          calories: Math.round(m.calories + jitter(35)),
          protein: Math.round(m.protein + jitter(4)),
          carbs: Math.round(m.carbs + jitter(6)),
          fat: Math.round(m.fat + jitter(3)),
          mealLabel: m.mealLabel,
          mealType: m.mealType,
          timestamp: Timestamp.fromDate(ts),
        },
      ]);
    }
    docs.push([`users/${uid}/dailyWater/${dateKey(dayAt(d, 12))}`, { flOz: Math.round(72 + jitter(20)) }]);
    docs.push([`users/${uid}/dailySleep/${dateKey(dayAt(d, 7))}`, { hours: round(7 + jitter(1), 1) }]);
  }

  for (const p of PRESETS) {
    const { id, ...data } = p;
    docs.push([`users/${uid}/presets/${id}`, data]);
  }

  for (const e of EXERCISES) {
    const { id, ...data } = e;
    docs.push([
      `users/${uid}/exercises/${id}`,
      { ...data, createdAt: Timestamp.fromDate(dayAt(WEIGHT_DAYS, 18)) },
    ]);
  }

  docs.push([
    `users/${uid}/workoutTemplates/demo-template-upper`,
    {
      name: 'Upper A',
      notes: 'Bench → row → press. Add 5 lb when all sets hit the top of the rep range.',
      exercises: [
        { exerciseId: 'demo-ex-bench', name: 'Bench Press', targetLoad: 170, cues: ['Shoulder blades down and back'], plannedSets: [{ kind: 'working' }, { kind: 'working' }, { kind: 'working' }], progression: { targetReps: 8, holdSessions: 2, incrementLb: 5 } },
        { exerciseId: 'demo-ex-row', name: 'Barbell Row', targetLoad: 165, cues: ['Pull to the belly button'], plannedSets: [{ kind: 'working' }, { kind: 'working' }, { kind: 'working' }] },
        { exerciseId: 'demo-ex-ohp', name: 'Overhead Press', targetLoad: 110, cues: ['Squeeze glutes'], plannedSets: [{ kind: 'working' }, { kind: 'working' }, { kind: 'working' }] },
      ],
      createdAt: Timestamp.fromDate(dayAt(WEIGHT_DAYS, 18)),
      updatedAt: Timestamp.fromDate(dayAt(6, 18)),
    },
  ]);

  for (const s of SESSIONS) {
    const ts = dayAt(s.daysAgo, 18, 15);
    docs.push([
      `users/${uid}/workoutSessions/${s.id}`,
      {
        status: 'completed',
        templateId: 'demo-template-upper',
        templateName: s.name,
        timestamp: Timestamp.fromDate(ts),
        durationMin: s.durationMin,
        bodyweight: round(START_WEIGHT + (END_WEIGHT - START_WEIGHT) * ((WEIGHT_DAYS - s.daysAgo) / WEIGHT_DAYS), 1),
        sleepHours: round(7 + jitter(0.8), 1),
        exercises: s.lifts.map(([exerciseId, name, load]) => ({
          exerciseId,
          name,
          targetLoad: load,
          cues: [],
          sets: [
            { kind: 'warmup', weight: Math.round(load * 0.55), reps: 8, done: true },
            { kind: 'working', weight: load, reps: 8, rir: 2, done: true },
            { kind: 'working', weight: load, reps: 8, rir: 1, done: true },
            { kind: 'working', weight: load, reps: rnd() > 0.5 ? 7 : 8, rir: 0, done: true },
          ],
        })),
        createdAt: Timestamp.fromDate(ts),
        updatedAt: Timestamp.fromDate(new Date(ts.getTime() + s.durationMin * 60_000)),
      },
    ]);
  }

  for (const [i, daysAgo] of [WEIGHT_DAYS - 1, 14, 0].entries()) {
    const ts = dayAt(daysAgo, 7, 30);
    docs.push([
      `users/${uid}/measurements/demo-measurement-${i}`,
      {
        timestamp: Timestamp.fromDate(ts),
        waist: round(34.5 - i * 0.6, 1),
        chest: round(41 + i * 0.1, 1),
        neck: 15.5,
      },
    ]);
  }

  assertWritable(docs);
  return docs;
}

/** Firestore rejects `undefined` and NaN at write time, which on a 171-doc
 *  batch means a half-seeded account. Catch it while it is still cheap —
 *  --dry-run runs this too, so a bad edit surfaces before any credentials. */
function assertWritable(docs) {
  const walk = (value, path) => {
    if (value === undefined) throw new Error(`undefined at ${path}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`non-finite number at ${path}`);
    if (value instanceof Timestamp || value === null) return;
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (typeof value === 'object') return Object.entries(value).forEach(([k, v]) => walk(v, `${path}.${k}`));
  };
  for (const [docPath, data] of docs) walk(data, docPath);
}

// ─── Run ───────────────────────────────────────────────────────────────
async function main() {
  // --dry-run touches neither Auth nor Firestore, so it needs no credentials
  // and cannot write anything. Build the plan and print it.
  if (dryRun) {
    const docs = buildDocs('DRY-RUN-UID');
    const byCollection = {};
    for (const [path] of docs) {
      const col = path.split('/').slice(0, -1).join('/').replace('DRY-RUN-UID', '{uid}');
      byCollection[col] = (byCollection[col] ?? 0) + 1;
    }
    console.log(`(dry run) ${docs.length} document(s) for ${email}:`);
    for (const [col, n] of Object.entries(byCollection)) {
      console.log(`  ${String(n).padStart(4)}  ${col}`);
    }
    console.log('\nNothing was written. Drop --dry-run to apply.');
    return;
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  let uid;
  let created = false;
  try {
    ({ uid } = await auth.getUserByEmail(email));
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    if (!password) {
      console.error(
        `No account exists for ${email} and no --password given.\n` +
          'Pass --password to create it (App Review needs credentials that actually work).',
      );
      process.exit(1);
    }
    ({ uid } = await auth.createUser({ email, password, emailVerified: true }));
    created = true;
  }

  // Guard: never overwrite an account with a real history by mistake. The
  // seed's own rows are recognisable by their `demo-` id prefix, so a re-seed
  // of this same account still passes.
  if (!force) {
    const existing = await db.collection(`users/${uid}/dailyLogs`).limit(400).get();
    const foreign = existing.docs.filter((d) => !d.id.startsWith('demo-')).length;
    if (foreign > 0) {
      console.error(
        `Refusing to seed: ${email} already has ${foreign} log(s) this script did not write.\n` +
          'That looks like a real account. Pass --force only if you are certain.',
      );
      process.exit(1);
    }
  }

  const docs = buildDocs(uid);

  // 450, not 500: Firestore's cap is 500 writes per batch and the same margin
  // the ledger's importLogs uses.
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    for (const [path, data] of docs.slice(i, i + 450)) batch.set(db.doc(path), data, { merge: true });
    await batch.commit();
  }

  if (password && !created) await auth.updateUser(uid, { password, emailVerified: true });

  console.log(`✓ seeded ${docs.length} docs for ${email} (uid ${uid})${created ? ' — account created' : ''}`);
  console.log('\nNext:');
  console.log('  1. Sign in on the phone, confirm Today/Trends/Train look right');
  console.log('  2. Capture into store-assets/raw/<locale>/ (see store-assets/README.md)');
  console.log('  3. Put these credentials in the App Review notes — docs/app-store-metadata.md §1');
}

main().catch((e) => {
  console.error('seed failed:', e);
  process.exit(1);
});
