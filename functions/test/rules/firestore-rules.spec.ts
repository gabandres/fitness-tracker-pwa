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

  it('allows profile creation WITHOUT an email field (PII minimization)', async () => {
    // Email is no longer persisted on the profile doc — it lives only in
    // Firebase Auth. A verified user must be able to create a profile that
    // omits `email` entirely.
    const db = authed('alice');
    const { email, ...noEmail } = baseProfile();
    void email;
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), noEmail));
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

  // Reads are uid-scoped so Coach can show the day's remaining consultations
  // before one is spent. The doc id is `<uid>_<day>`, so the prefix is the
  // tenant key — these two cases are the whole contract.
  it('allows a client to read its OWN consultationQuota doc', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'consultationQuota', 'alice_2026-04-17'), {
        count: 2,
        uid: 'alice',
        date: '2026-04-17',
      });
    });
    await assertSucceeds(getDoc(doc(authed('alice'), 'consultationQuota', 'alice_2026-04-17')));
  });

  it("blocks a client from reading ANOTHER user's consultationQuota doc", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'consultationQuota', 'bob_2026-04-17'), {
        count: 2,
        uid: 'bob',
        date: '2026-04-17',
      });
    });
    await assertFails(getDoc(doc(authed('alice'), 'consultationQuota', 'bob_2026-04-17')));
    // A uid that merely PREFIXES another's must not slip through a
    // startsWith-style check — this is why the rule splits on '_'.
    await assertFails(getDoc(doc(authed('ali'), 'consultationQuota', 'alice_2026-04-17')));
  });

  // opsBudget holds the org-wide spend ceiling and the per-feature
  // kill-switch. Both directions matter and for different reasons: a
  // client-writable switch is a denial-of-service primitive (turn the
  // feature off for every user), and a client-writable counter lets anyone
  // zero the meter and spend straight past the ceiling. Reads are denied
  // too so the doc can't be used to probe org-wide usage.
  it('blocks client reads + writes to opsBudget', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'opsBudget', 'photo'), {
        date: '2026-08-03',
        used: 7,
        limit: 2000,
        killed: false,
      });
    });
    const db = authed('alice');
    await assertFails(getDoc(doc(db, 'opsBudget', 'photo')));
    await assertFails(setDoc(doc(db, 'opsBudget', 'photo'), { used: 0 }));
    await assertFails(setDoc(doc(db, 'opsBudget', 'photo'), { killed: true }));
  });

  // Deliberately stricter than /config, which admins CAN read directly to
  // render panel tabs. This one goes through adminGetSpendCeilings instead,
  // so every change lands in the audit log rather than as a silent client
  // write. If this test ever starts failing because someone opened the doc
  // up to admins, that audit trail is what was traded away.
  it('blocks even an admin-claim client from opsBudget', async () => {
    const db = env
      .authenticatedContext('owner', { email_verified: true, admin: true })
      .firestore();
    await assertFails(getDoc(doc(db, 'opsBudget', 'photo')));
    await assertFails(setDoc(doc(db, 'opsBudget', 'photo'), { killed: false }));
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

  // ─── syntheticAccount: the seeded-account marker ────────────────────────
  // Written by scripts/seed-demo-account.mjs over the admin SDK to keep the
  // demo/review logins out of the retention cohorts. Two things must hold: a
  // client can still edit a profile that carries it (or the demo account App
  // Review signs into becomes read-only), and a client can never change it.

  const completedProfile = () => ({
    ...baseProfile(),
    profileCompleted: true,
    heightIn: 70,
    age: 33,
    sex: 'male',
    activityLevel: 'moderate',
    targetPaceLbsPerWeek: 1.0,
  });

  it('lets a client update a profile that already carries syntheticAccount', async () => {
    // The demo account is seeded with the flag; it must stay usable. Before
    // the field was added to the hasOnly() allowlist this failed, which would
    // have locked App Review out of every profile write in the app.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), {
        ...completedProfile(),
        syntheticAccount: true,
      });
    });
    const db = authed('alice');
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice'), {
        ...completedProfile(),
        syntheticAccount: true,
        manualCaloriesTarget: 2200,
      }),
    );
  });

  it('blocks a client from marking itself syntheticAccount at CREATE time', async () => {
    // The update rule pins the field, but create is a separate path: a brand
    // new verified user setting it on their first write would permanently
    // remove themselves from every cohort, and the update pin would then hold
    // that choice in place. Pinning update alone left this open.
    const db = authed('alice');
    await assertFails(
      setDoc(doc(db, 'users', 'alice'), { ...baseProfile(), syntheticAccount: true }),
    );
  });

  it('still allows an ordinary profile create', async () => {
    // Guards the fix above against over-reach: forbidding the key must not
    // break the normal first-write path every new user takes.
    const db = authed('alice');
    await assertSucceeds(setDoc(doc(db, 'users', 'alice'), baseProfile()));
  });

  it('blocks a client from marking itself syntheticAccount', async () => {
    // Self-marking would delete the user from every cohort the project
    // measures — a metrics flag, not a user setting.
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice'), { ...completedProfile(), syntheticAccount: true }),
    );
  });

  it('blocks a client from clearing syntheticAccount', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), {
        ...completedProfile(),
        syntheticAccount: true,
      });
    });
    const db = authed('alice');
    // Dropping the field puts the seeded 83-log account back in the numbers.
    await assertFails(setDoc(doc(db, 'users', 'alice'), completedProfile()));
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

  it('accepts an in-range proteinFloor on a completed profile', async () => {
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
        proteinFloor: 150,
      }),
    );
  });

  it('rejects an out-of-range proteinFloor on a completed profile', async () => {
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
        proteinFloor: 1200, // above the 1000 g rule ceiling
      }),
    );
  });

  it('rejects a zero proteinFloor — "off" is an absent field, not 0', async () => {
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
        proteinFloor: 0,
      }),
    );
  });

  it('accepts a completed profile with no proteinFloor at all', async () => {
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

  // ── dailyActivity (Health steps / active-energy import) ──
  // The dev app talks to PROD Firestore, so these rules must be deployed
  // before any client writes the new collection.

  it('accepts a dailyActivity doc with both activity fields', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice', 'dailyActivity', '2026-07-23'), {
        steps: 8432,
        activeKcal: 512,
      }),
    );
  });

  it.each([['steps', { steps: 8432 }], ['activeKcal', { activeKcal: 512 }]])(
    'accepts a dailyActivity doc carrying only %s (the two importers merge)',
    async (_label, data) => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(
        setDoc(doc(db, 'users', 'alice', 'dailyActivity', '2026-07-23'), data),
      );
    },
  );

  it('rejects a dailyActivity doc with an unknown field', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'dailyActivity', '2026-07-23'), {
        steps: 8432,
        distanceKm: 6.2,
      }),
    );
  });

  it.each([
    ['negative steps', { steps: -1 }],
    ['absurd steps', { steps: 200001 }],
    ['negative activeKcal', { activeKcal: -1 }],
    ['absurd activeKcal', { activeKcal: 20001 }],
    ['non-numeric steps', { steps: '8432' }],
  ])('rejects dailyActivity with %s', async (_label, data) => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'dailyActivity', '2026-07-23'), data),
    );
  });

  it("rejects writing another user's dailyActivity", async () => {
    const db = authed('mallory');
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'dailyActivity', '2026-07-23'), { steps: 1 }),
    );
  });
});
