/**
 * Seeds the local Firebase Emulator Suite with a signed-in test user, an
 * onboarded profile, and a few sample logs — so local dev (`npm run dev`)
 * starts from a usable state instead of an empty database. Idempotent.
 *
 * Bootstrap once:   npm run seed      (boots emulators, seeds, exports to ./.emulator-data)
 * Then every day:   npm run dev       (imports ./.emulator-data, serves, re-exports on exit)
 * Re-seed live:     npm run seed:emulators   (against already-running emulators)
 *
 * Uses the Admin SDK on purpose: it bypasses firestore.rules, which is how you
 * seed an emulator (a client write would be validated by the full ruleset and
 * a raw profile create is rejected). Doc shapes mirror
 * apps/mobile/src/lib/ledger.ts / FirestoreLedgerCore.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const EMAIL = 'e2e@test.com';
const PASSWORD = 'UserTest123';
const HOST = process.env.EMULATOR_HOST || 'localhost';

// The Admin SDK auto-targets the emulators when these env vars are set.
process.env.FIRESTORE_EMULATOR_HOST ||= `${HOST}:8080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `${HOST}:9099`;

initializeApp({ projectId: 'fitness-tracker-gb-1775407101' });
const auth = getAuth();
const db = getFirestore();

/** Local (not UTC) YYYY-MM-DD, matching the app's day-key convention. */
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  // Create the test user, or reuse + reset its password if it already exists.
  let uid;
  try {
    ({ uid } = await auth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true }));
    console.log('✓ created test user', EMAIL);
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      ({ uid } = await auth.getUserByEmail(EMAIL));
      await auth.updateUser(uid, { password: PASSWORD });
      console.log('✓ test user exists — reset password', EMAIL);
    } else {
      throw e;
    }
  }

  // Onboarded profile so dev boots straight into the app (skips onboarding).
  await db.doc(`users/${uid}`).set(
    {
      goalDirection: 'lose',
      manualCaloriesTarget: 1990,
      manualProteinTarget: 130,
      profileCompleted: true,
      onboardingV2CompletedAt: Timestamp.now(),
      lastSeenAt: Timestamp.now(),
      targetWeightLbs: 175,
      goalWeightLbs: 175,
    },
    { merge: true },
  );

  const now = new Date();
  const logs = [
    { calories: 520, protein: 42, carbs: 45, fat: 18, mealLabel: 'Breakfast', mealType: 'breakfast', hoursAgo: 6 },
    { calories: 710, protein: 55, carbs: 60, fat: 25, mealLabel: 'Lunch', mealType: 'lunch', hoursAgo: 3 },
    { calories: 300, protein: 25, carbs: 20, fat: 10, mealLabel: 'Snack', mealType: 'snack', hoursAgo: 1 },
  ];
  // Fixed IDs → re-running the seed upserts the same rows instead of piling up.
  for (const [i, l] of logs.entries()) {
    const ts = new Date(now.getTime() - l.hoursAgo * 3600_000);
    await db.doc(`users/${uid}/dailyLogs/seed-${i}`).set({
      calories: l.calories, protein: l.protein, carbs: l.carbs, fat: l.fat,
      mealLabel: l.mealLabel, mealType: l.mealType, timestamp: Timestamp.fromDate(ts),
    });
  }

  const dateKey = localDateKey(now);
  await db.doc(`users/${uid}/dailyWeights/${dateKey}`).set({ weight: 178 });
  await db.doc(`users/${uid}/dailyWater/${dateKey}`).set({ flOz: 32 });

  console.log(`✓ seeded profile + ${logs.length} logs + weight/water for ${EMAIL} (uid ${uid})`);
  process.exit(0);
}

main().catch((e) => {
  console.error('seed failed:', e);
  process.exit(1);
});
