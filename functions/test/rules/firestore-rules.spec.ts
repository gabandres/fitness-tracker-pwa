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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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

  // ── usageEvents ────────────────────────────────────────────────
  // The one client-WRITABLE counter in the file, so its guards carry more
  // weight than the deny-write ones around it. Each case below is a way the
  // collection could stop being "counts, scoped to me, for the day named in the
  // id" — which is the entire claim the privacy copy makes about it.
  const usageDoc = (day = '2026-08-12') => ({
    uid: 'alice',
    day,
    platform: 'ios',
    updatedAt: serverTimestamp(),
    log_added: 3,
  });

  it('allows a client to write its OWN usageEvents doc', async () => {
    await assertSucceeds(
      setDoc(doc(authed('alice'), 'usageEvents', 'alice_2026-08-12'), usageDoc()),
    );
  });

  it("blocks writing another user's usageEvents doc", async () => {
    await assertFails(
      setDoc(doc(authed('alice'), 'usageEvents', 'bob_2026-08-12'), {
        ...usageDoc(),
        uid: 'bob',
      }),
    );
    // A prefixing uid must not slip through, same as consultationQuota.
    await assertFails(
      setDoc(doc(authed('ali'), 'usageEvents', 'alice_2026-08-12'), usageDoc()),
    );
  });

  it('blocks a doc id that disagrees with the day inside it', async () => {
    // Otherwise one day's activity could be spread across arbitrary documents,
    // or a streak backfilled after the fact.
    await assertFails(
      setDoc(doc(authed('alice'), 'usageEvents', 'alice_2026-08-12'), usageDoc('2026-01-01')),
    );
  });

  it('blocks an event name outside the catalogue', async () => {
    await assertFails(
      setDoc(doc(authed('alice'), 'usageEvents', 'alice_2026-08-12'), {
        ...usageDoc(),
        meal_label: 'Chicken and rice',
      }),
    );
  });

  it('blocks counts that are negative, fractional, or past the cap', async () => {
    const at = doc(authed('alice'), 'usageEvents', 'alice_2026-08-12');
    await assertFails(setDoc(at, { ...usageDoc(), log_added: -1 }));
    await assertFails(setDoc(at, { ...usageDoc(), log_added: 2.5 }));
    await assertFails(setDoc(at, { ...usageDoc(), log_added: 2001 }));
  });

  it('blocks re-pointing an existing doc at another uid or day', async () => {
    const at = doc(authed('alice'), 'usageEvents', 'alice_2026-08-12');
    await assertSucceeds(setDoc(at, usageDoc()));
    // The id still matches `uid_day`, so only the immutability clause can
    // reject this one.
    await assertFails(updateDoc(at, { day: '2026-08-13' }));
  });

  it("blocks reading another user's usageEvents doc", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'usageEvents', 'bob_2026-08-12'), {
        uid: 'bob',
        day: '2026-08-12',
        platform: 'web',
        log_added: 1,
      });
    });
    await assertFails(getDoc(doc(authed('alice'), 'usageEvents', 'bob_2026-08-12')));
    await assertSucceeds(getDoc(doc(authed('alice'), 'usageEvents', 'alice_2026-08-12')));
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

  // ─── A profile with no `createdAt` can never be updated ─────────────────
  // Raising the calorie floor from Settings against a local emulator failed
  // with:
  //   PERMISSION_DENIED: Unable to evaluate the expression as the maximum of
  //   1000 expressions to evaluate has been reached. for 'update' @ L444
  // That message names a platform limit and reads like the ruleset has simply
  // grown too big — it is not. Bisected 2026-08-11: a 31-field profile updates
  // fine, and the trigger is the **absence of `createdAt`**, which
  // `hasProfileBase` requires. Adding it alone fixes the write; `email` is
  // irrelevant (deliberately not stored since 2026-07-07).
  //
  // Nothing in production creates such a doc — both client create paths write
  // `createdAt` — but `scripts/seed-emulators.mjs` did, so every settings write
  // in local dev failed against the seeded account. The specs below pin both
  // halves so the next person reads "missing field", not "we hit a Firestore
  // ceiling".
  const fullProfile = () => ({
    ...completedProfile(),
    goalDirection: 'lose',
    goalWeightLbs: 175,
    targetWeightLbs: 175,
    manualCaloriesTarget: 1990,
    manualProteinTarget: 130,
    proteinPerKg: 1.8,
    calorieFloor: 1850,
    proteinFloor: 120,
    onboardingV2CompletedAt: Timestamp.now(),
    targetsRefinedAt: Timestamp.now(),
    firstEntryAt: Timestamp.now(),
    ageConfirmedAt: Timestamp.now(),
    welcomeEmailSentAt: Timestamp.now(),
    reminderHour: 19,
    timezoneOffsetMin: 240,
    fcmToken: 'f'.repeat(160),
    preferredLocale: 'es-PR',
    unitSystem: 'us',
    travelMode: false,
    weeklyDigestOptIn: true,
    hiddenRecentLabels: ['oatmeal', 'protein shake'],
    webhookApiKey: '0'.repeat(36),
  });

  it('lets a real-shaped profile change its calorie floor', async () => {
    // The write behind Settings → calorie floor, and the one the Refine-targets
    // note now tells users to go make. `updateDoc`, not `setDoc`, because that
    // is what the app issues — and because rebuilding the whole doc would move
    // the server-pinned `welcomeEmailSentAt` / `firstEntryAt` and fail for a
    // completely different (correct) reason.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        calorieFloor: 1950,
        lastSeenAt: Timestamp.now(),
      }),
    );
  });

  it('lets a real-shaped profile save the Refine-targets sheet', async () => {
    // The heaviest legitimate profile write in the app: the Mifflin inputs,
    // the pace and the protein basis at once, on a fully populated account.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        heightIn: 71,
        age: 34,
        activityLevel: 'active',
        targetPaceLbsPerWeek: 0.9,
        proteinPerKg: 2.0,
        targetsRefinedAt: Timestamp.now(),
        lastSeenAt: Timestamp.now(),
      }),
    );
  });

  it('cannot update a profile that has no createdAt — this is the 1000-expression error', async () => {
    // The exact doc `scripts/seed-emulators.mjs` used to write. The denial is
    // correct (hasProfileBase requires createdAt); only its wording is not.
    const { createdAt: _dropped, ...noCreatedAt } = fullProfile();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), noCreatedAt);
    });
    const db = authed('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice'), {
        calorieFloor: 1950,
        lastSeenAt: Timestamp.now(),
      }),
    );
  });

  it('and updates fine the moment createdAt is present', async () => {
    // Same doc, one field added — the whole difference between a dev loop that
    // silently rejects every setting and one that works.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), {
        ...fullProfile(),
        createdAt: Timestamp.now(),
      });
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        calorieFloor: 1950,
        lastSeenAt: Timestamp.now(),
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
