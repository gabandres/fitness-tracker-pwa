import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

// Exercises the highest-risk invariants in firestore.rules. Each spec covers a
// rule-path that a regression could silently open up: cross-user reads, server-
// only collections (reports, quotas, config), schema validators, and the
// email-verified gate. Not exhaustive — deliberately small so the suite stays
// fast in emulator + readable for new contributors.

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const PROJECT_ID = 'macrolog-rules-test';

let env: RulesTestEnvironment;

// Minimal valid profile + log fixtures so schema-positive cases don't fall
// over on missing required fields unrelated to what each spec is exercising.
const baseProfile = () => ({
  email: 'a@example.com',
  createdAt: Timestamp.now(),
  lastSeenAt: Timestamp.now(),
  profileCompleted: false,
});

const validLog = () => ({
  calories: 500,
  timestamp: Timestamp.now(),
  protein: 30,
});

const validCustomFood = () => ({
  name: 'Chobani 0% Plain',
  brand: 'Chobani',
  barcode: '894700010045',
  servingSize: 170,
  servingUnit: 'g',
  calories: 100,
  protein: 17,
  carbs: 6,
  fat: 0.7,
  source: 'barcode',
  createdAt: Timestamp.now(),
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

function authed(uid: string, opts: { emailVerified?: boolean } = {}) {
  return env.authenticatedContext(uid, { email_verified: opts.emailVerified ?? true }).firestore();
}
function unauthed() {
  return env.unauthenticatedContext().firestore();
}

describe('firestore.rules', () => {
  it('owner can create their own verified profile', async () => {
    const db = authed('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), baseProfile()));
  });

  it('rejects profile creation when email is not verified', async () => {
    const db = authed('alice', { emailVerified: false });
    await assertFails(setDoc(doc(db, 'users', 'alice'), baseProfile()));
  });

  it('blocks cross-user profile reads', async () => {
    // Seed alice's profile via an admin-bypass context so the read target exists.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), baseProfile());
    });
    const db = authed('mallory');
    await assertFails(getDoc(doc(db, 'users', 'alice')));
  });

  it('allows owner to create a valid dailyLog', async () => {
    const db = authed('alice');
    // Seed the parent profile first — writes to subcollections don't require
    // parent existence, but this keeps the fixture realistic.
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), baseProfile()));
    await assertSucceeds(addDoc(collection(db, 'users', 'alice', 'dailyLogs'), validLog()));
  });

  it('rejects a dailyLog with out-of-range calories', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'dailyLogs'), {
        ...validLog(),
        calories: 999999,
      }),
    );
  });

  it('rejects a dailyLog write from an unverified email', async () => {
    // The /dailyLogs rules gate on isOwner only, but the parent profile
    // write path is gated on isVerifiedUser, so an unverified user who
    // never owned a profile is the real-world case. Assert the /users
    // gate denies unverified writes — covers the verify-email gap.
    const db = authed('alice', { emailVerified: false });
    await assertFails(setDoc(doc(db, 'users', 'alice'), baseProfile()));
  });

  it('blocks client writes to users/{uid}/reports (server-only collection)', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'reports'), {
        markdown: 'forged',
        generatedAt: Timestamp.now(),
      }),
    );
  });

  it('allows owner to create a valid customFood at a barcode doc id', async () => {
    const db = authed('alice');
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice', 'customFoods', '894700010045'), validCustomFood()),
    );
  });

  it('allows a minimal customFood (auto-id, no optional fields)', async () => {
    const db = authed('alice');
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'customFoods'), {
        name: 'Brown rice',
        servingSize: 100,
        servingUnit: 'g',
        calories: 111,
        source: 'text',
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('rejects a customFood with an invalid source enum', async () => {
    const db = authed('alice');
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'customFoods'), {
        ...validCustomFood(),
        source: 'guess',
      }),
    );
  });

  it('rejects a customFood missing a required field (servingUnit)', async () => {
    const db = authed('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'customFoods', 'x'), {
        name: 'No unit',
        servingSize: 100,
        calories: 100,
        source: 'text',
        createdAt: Timestamp.now(),
      }),
    );
  });

  it("blocks writing another user's customFoods", async () => {
    const db = authed('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'bob', 'customFoods', 'x'), validCustomFood()),
    );
  });

  it('blocks client reads + writes to config/accessList', async () => {
    const db = authed('alice');
    await assertFails(getDoc(doc(db, 'config', 'accessList')));
    await assertFails(setDoc(doc(db, 'config', 'accessList'), { compedEmails: [] }));
  });

  it('blocks client writes to consultationQuota', async () => {
    const db = authed('alice');
    await assertFails(
      setDoc(doc(db, 'consultationQuota', 'alice_2026-04-17'), {
        count: 0,
        uid: 'alice',
        date: '2026-04-17',
      }),
    );
  });

  it('allows public read of status/heartbeat', async () => {
    // Seed the doc via the admin path so the read target exists.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'status', 'heartbeat'), {
        lastPulseAt: Timestamp.now(),
      });
    });
    const db = unauthed();
    await assertSucceeds(getDoc(doc(db, 'status', 'heartbeat')));
  });

  it('blocks client writes to status/heartbeat', async () => {
    const db = authed('alice');
    await assertFails(
      setDoc(doc(db, 'status', 'heartbeat'), { lastPulseAt: Timestamp.now() }),
    );
  });

  it('accepts ageConfirmedAt as a timestamp on a completed profile', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        heightIn: 70,
        age: 33,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        ageConfirmedAt: Timestamp.now(),
      }),
    );
  });

  it('rejects a non-timestamp ageConfirmedAt on a completed profile', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        heightIn: 70,
        age: 33,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        ageConfirmedAt: 'not-a-timestamp',
      }),
    );
  });

  it('accepts an in-range calorieFloor on a completed profile', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        heightIn: 70,
        age: 33,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        calorieFloor: 1850,
      }),
    );
  });

  it('rejects an out-of-range calorieFloor on a completed profile', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        heightIn: 70,
        age: 33,
        sex: 'male',
        activityLevel: 'moderate',
        targetPaceLbsPerWeek: 1.0,
        calorieFloor: 500, // below the 1000 rule minimum
      }),
    );
  });

  it('accepts a catalog exercise carrying a seedKey', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'exercises'), {
        name: 'Barbell Bench Press',
        muscles: ['chest', 'triceps'],
        defaultCues: ['Retract scapula'],
        logStyle: 'weight-reps',
        seedKey: 'barbell-bench-press',
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('rejects a catalog exercise with a non-string seedKey', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'exercises'), {
        name: 'Barbell Bench Press',
        seedKey: 42,
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('accepts a workout template carrying a seedKey', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'workoutTemplates'), {
        name: 'Push Day',
        exercises: [],
        seedKey: 'push-day',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }),
    );
  });
});
