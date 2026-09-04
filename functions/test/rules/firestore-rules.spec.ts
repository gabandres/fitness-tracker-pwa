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
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  deleteField,
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

  // ── log provenance (`source`, the `first-scan` evidence — #109) ──
  //
  // The whole point of the field is that the milestone is awarded off it, so
  // the rules have to be the thing that keeps it honest: a value nothing
  // produces must not be writable, and the key must be allowed at all (it was
  // not until 2026-09-03, and an un-deployed rule rejects the write silently
  // from the client's point of view — the dev app talks to PROD Firestore).
  it("allows a dailyLog carrying source: 'photo'", async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'dailyLogs'), { ...validLog(), source: 'photo' }),
    );
  });

  it('rejects a dailyLog with an unknown source value', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'dailyLogs'), { ...validLog(), source: 'manual' }),
    );
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'dailyLogs'), { ...validLog(), source: 1 }),
    );
  });

  it('rejects a dailyLog carrying a key outside the allow-list', async () => {
    // Pins the `hasOnly` list itself: adding `source` must not have opened the
    // door to arbitrary keys.
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'dailyLogs'), { ...validLog(), scanned: true }),
    );
  });

  it('lets an edit keep the source it was created with', async () => {
    // `toLogPatch` deliberately never names `source` — provenance is a fact
    // about creation, so an edit leaves it in place. Assert the rules accept
    // the resulting merged document.
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    const ref = doc(db, 'users', 'alice', 'dailyLogs', 'scanned-row');
    await assertSucceeds(setDoc(ref, { ...validLog(), source: 'photo' }));
    await assertSucceeds(updateDoc(ref, { calories: 620 }));
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

  it('accepts the onboarding funnel step events (2026-08-31 additions)', async () => {
    // These pin the rules half of the catalogue: the client fires them from
    // onboarding.tsx, and because validUsageDoc is hasOnly over the whole doc,
    // a missing field here rejects the entire day's flush, not just one count.
    await assertSucceeds(
      setDoc(doc(authed('alice'), 'usageEvents', 'alice_2026-08-12'), {
        ...usageDoc(),
        onboarding_start: 1,
        onboarding_step_body: 1,
        onboarding_step_plan: 1,
      }),
    );
  });

  it('accepts log_secs up to a day, and no further (2026-09-02, retention lever 3)', async () => {
    // Seconds, not taps: a heavy day passes the 2000 tally cap honestly, so
    // this field carries its own ceiling. Both directions pinned, because a
    // rejected doc drops the whole flush — every counter, not just this one.
    const at = doc(authed('alice'), 'usageEvents', 'alice_2026-08-12');
    await assertSucceeds(setDoc(at, { ...usageDoc(), log_secs: 5_000 }));
    await assertSucceeds(setDoc(at, { ...usageDoc(), log_secs: 86_400 }));
    await assertFails(setDoc(at, { ...usageDoc(), log_secs: 86_401 }));
    await assertFails(setDoc(at, { ...usageDoc(), log_secs: -1 }));
    await assertFails(setDoc(at, { ...usageDoc(), log_secs: 12.5 }));
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

  // ─── The onboarding write, after UX_AUDIT F1/F2 ─────────────────────────
  // Onboarding now collects sex/height/age/activity itself and writes them
  // alongside the heuristic targets. Nothing in `firestore.rules` changed for
  // it — the fields were already on the completed-profile allowlist and the
  // strict branch already validated them — and THAT is the claim worth
  // pinning: "no rules deploy needed" is exactly the belief that, when wrong,
  // rejects every new client's very first write.

  it('accepts the full onboarding-v2 write with the Mifflin-St Jeor set', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        goalDirection: 'lose',
        targetWeightLbs: 165,
        goalWeightLbs: 165,
        manualCaloriesTarget: 1500,
        manualProteinTarget: 130,
        targetMode: 'auto',
        onboardingV2CompletedAt: Timestamp.now(),
        // The five that used to arrive only from Settings → Refine targets.
        sex: 'female',
        heightIn: 64,
        age: 45,
        activityLevel: 'light',
        targetPaceLbsPerWeek: 1,
        targetsRefinedAt: Timestamp.now(),
      }),
    );
  });

  it('rejects a HALF-written Mifflin-St Jeor set, which is why the client writes it as a group', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        goalDirection: 'lose',
        manualCaloriesTarget: 1500,
        manualProteinTarget: 130,
        // `heightIn` present flips the rule to its strict branch, which then
        // demands age, sex, activityLevel and a pace. A skipped body step must
        // therefore write NONE of them, not the ones it happens to have.
        heightIn: 64,
        sex: 'female',
      }),
    );
  });

  it('still accepts the skipped-body shape: heuristic targets and no profile fields', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        profileCompleted: true,
        goalDirection: 'lose',
        manualCaloriesTarget: 1980,
        manualProteinTarget: 130,
        targetMode: 'auto',
        onboardingV2CompletedAt: Timestamp.now(),
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
    day1NudgeSentAt: Timestamp.now(),
    reminderHour: 19,
    timezoneOffsetMin: 240,
    fcmToken: 'f'.repeat(160),
    preferredLocale: 'es-PR',
    unitSystem: 'us',
    travelMode: false,
    weeklyDigestOptIn: true,
    hiddenRecentLabels: ['oatmeal', 'protein shake'],
    webhookApiKey: '0'.repeat(36),
    targetMode: 'auto',
  });

  // ─── targetMode + in-app feedback (2026-08-21) ──────────────────────────
  // `targetMode` decides whether the estimator is overridden, so an
  // unrecognised value must not be storable at all — the client is not the
  // control here.
  it('lets a profile switch to custom targets', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        targetMode: 'custom',
        manualCaloriesTarget: 2000,
        lastSeenAt: Timestamp.now(),
      }),
    );
  });

  // ─── Day boundary (ADR-0030, 2026-08-25) ───────────────────────────────
  // Rules cannot iterate a list, so these pin what IS checkable: the field is
  // storable, it must be a list, and it is capped. Per-element shape is
  // deliberately NOT enforced here because it cannot be — `sanitizeDayBoundary`
  // in packages/core owns that, and its tests own proving it.
  it('lets a user store a day boundary history', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        dayBoundary: [{ from: '2026-08-25', hour: 3 }],
        lastSeenAt: Timestamp.now(),
      }),
    );
  });

  it('lets a user append a second boundary change', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), {
        ...fullProfile(),
        dayBoundary: [{ from: '2026-08-25', hour: 3 }],
      });
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        dayBoundary: [
          { from: '2026-08-25', hour: 3 },
          { from: '2026-09-01', hour: 5 },
        ],
      }),
    );
  });

  it('rejects a day boundary that is not a list', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { dayBoundary: 3 }));
  });

  // An append-only list on a doc read at every app open is a cost problem
  // before it is a correctness one, which is what the cap is actually for.
  it('rejects a day boundary longer than the cap', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice'), {
        dayBoundary: Array.from({ length: 25 }, (_, i) => ({
          from: `2026-01-${String(i + 1).padStart(2, '0')}`,
          hour: 3,
        })),
      }),
    );
  });

  it('accepts a day boundary on profile create', async () => {
    const db = authed('carol');
    await assertSucceeds(
      setDoc(doc(db, 'users', 'carol'), {
        ...baseProfile(),
        dayBoundary: [{ from: '2026-08-25', hour: 4 }],
      }),
    );
  });

  it('rejects a targetMode outside the closed set', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice'), { targetMode: 'manual' }),
    );
  });

  it('lets a user file feedback about themselves', async () => {
    const db = authed('alice');
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'feedback'), {
        message: 'the speed dial covers the scan result',
        category: 'bug',
        createdAt: Timestamp.now(),
        appVersion: '1.2.1',
        platform: 'android',
        locale: 'es-PR',
      }),
    );
  });

  it('lets a user file feedback with no category chosen', async () => {
    // An unset chip must stay a legitimate submission — the chooser is
    // optional by design, and a rule that quietly required it would turn a
    // "just tell me what you think" box into a form.
    const db = authed('alice');
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'feedback'), {
        message: 'love the app',
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('refuses feedback filed into someone else’s subcollection', async () => {
    const db = authed('alice');
    await assertFails(
      addDoc(collection(db, 'users', 'bob', 'feedback'), {
        message: 'not mine to write',
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('caps the message length in the RULE, not only in the client', async () => {
    // This is the one collection any authenticated user can append to at
    // will, so the cap has to hold where the client cannot reach it.
    const db = authed('alice');
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'feedback'), {
        message: 'x'.repeat(4001),
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('refuses an empty feedback message', async () => {
    const db = authed('alice');
    await assertFails(
      addDoc(collection(db, 'users', 'alice', 'feedback'), {
        message: '',
        createdAt: Timestamp.now(),
      }),
    );
  });

  it('does not let the reporter read back what they sent', async () => {
    // Deliberate: there is no in-app inbox, and a readable copy would imply
    // one. The owner reads these through the admin panel.
    let id = '';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), 'users', 'alice', 'feedback'), {
        message: 'sent earlier',
        createdAt: Timestamp.now(),
      });
      id = ref.id;
    });
    const db = authed('alice');
    await assertFails(getDoc(doc(db, 'users', 'alice', 'feedback', id)));
  });

  it('does not let the reporter edit or delete a filed report', async () => {
    let id = '';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), 'users', 'alice', 'feedback'), {
        message: 'sent earlier',
        createdAt: Timestamp.now(),
      });
      id = ref.id;
    });
    const db = authed('alice');
    await assertFails(updateDoc(doc(db, 'users', 'alice', 'feedback', id), { message: 'rewritten' }));
    await assertFails(deleteDoc(doc(db, 'users', 'alice', 'feedback', id)));
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

  it('pins the day-1 nudge latch to the server — the owner cannot move or clear it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { day1NudgeSentAt: Timestamp.fromMillis(0), lastSeenAt: Timestamp.now() }));
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { day1NudgeSentAt: deleteField(), lastSeenAt: Timestamp.now() }));
    // Leaving it alone is fine.
    await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { calorieFloor: 1950, lastSeenAt: Timestamp.now() }));
  });

  // ─── expoPushToken (#114, silent OTA pre-download push) ─────────────────
  // Unlike the latches above this one is CLIENT-writable: the device is the
  // only party that knows its own Expo push token. It must also be clearable
  // (null or delete) so disabling notifications can actually take effect.
  it('lets the owner write, replace, and clear their expoPushToken', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
        lastSeenAt: Timestamp.now(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), {
        expoPushToken: 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]',
        lastSeenAt: Timestamp.now(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), { expoPushToken: null, lastSeenAt: Timestamp.now() }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), { expoPushToken: deleteField(), lastSeenAt: Timestamp.now() }),
    );
  });

  it('accepts an expoPushToken on an INCOMPLETE profile too', async () => {
    // Registration runs on auth-ready in the app shell, which can precede
    // onboarding completing — so the initial-branch validator must list it.
    const db = authed('alice');
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice'), {
        ...baseProfile(),
        expoPushToken: 'ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]',
      }),
    );
  });

  it('rejects a malformed expoPushToken (wrong type, empty, oversized)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'alice'), fullProfile());
    });
    const db = authed('alice');
    await assertFails(
      updateDoc(doc(db, 'users', 'alice'), { expoPushToken: 12345, lastSeenAt: Timestamp.now() }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', 'alice'), { expoPushToken: '', lastSeenAt: Timestamp.now() }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', 'alice'), { expoPushToken: 'x'.repeat(301), lastSeenAt: Timestamp.now() }),
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

  it('accepts an in-range activityMultiplier on a completed profile', async () => {
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
        // The FAO/WHO/UNU free-living floor, and what a real account's
        // device window resolves to.
        activityMultiplier: 1.4,
      }),
    );
  });

  it('rejects an out-of-range activityMultiplier on a completed profile', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    for (const bad of [0.5, 3.0]) {
      await assertFails(
        setDoc(doc(db, 'users', 'alice'), {
          ...baseProfile(),
          profileCompleted: true,
          heightIn: 70,
          age: 33,
          sex: 'male',
          activityLevel: 'moderate',
          targetPaceLbsPerWeek: 1.0,
          activityMultiplier: bad, // outside the 1.0..2.5 sanity band
        }),
      );
    }
  });

  it('rejects a non-numeric activityMultiplier', async () => {
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
        activityMultiplier: 'moderate',
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

  // ── Cardio blocks on sessions + templates (ADR-0025) ──
  // `isValidWorkoutSession` validates with hasOnly(), which is an ALLOW-LIST:
  // before this rule shipped, a session carrying `cardio` was not partially
  // accepted and the field was not silently stripped — the ENTIRE write was
  // rejected, logged strength sets included. The dev app talks to PROD
  // Firestore, so these must be deployed before any client writes the field.

  const validSession = (extra: Record<string, unknown> = {}) => ({
    status: 'completed',
    timestamp: Timestamp.now(),
    exercises: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...extra,
  });

  const validTemplate = (extra: Record<string, unknown> = {}) => ({
    name: 'Push Day',
    exercises: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...extra,
  });

  const cardioBlock = () => ({
    modality: 'run',
    durationSec: 1930,
    distanceM: 8046,
    avgHr: 148,
    source: 'manual',
  });

  it('accepts a workout session with no cardio field at all', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'workoutSessions'), validSession()),
    );
  });

  it('accepts a workout session carrying an empty cardio list', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(collection(db, 'users', 'alice', 'workoutSessions'), validSession({ cardio: [] })),
    );
  });

  it('accepts a strength session that also carries a cardio finisher', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(
        collection(db, 'users', 'alice', 'workoutSessions'),
        validSession({
          exercises: [{ exerciseId: 'x1', name: 'Bench Press', cues: [], sets: [] }],
          cardio: [cardioBlock()],
        }),
      ),
    );
  });

  it('accepts a standalone cardio session — zero exercises, one block', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(
        collection(db, 'users', 'alice', 'workoutSessions'),
        validSession({ exercises: [], cardio: [cardioBlock()] }),
      ),
    );
  });

  it('rejects a workout session with more than 20 cardio blocks', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(
        collection(db, 'users', 'alice', 'workoutSessions'),
        validSession({ cardio: Array.from({ length: 21 }, cardioBlock) }),
      ),
    );
  });

  it('rejects a workout session whose cardio is a map, not a list', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(
        collection(db, 'users', 'alice', 'workoutSessions'),
        validSession({ cardio: { modality: 'run', durationSec: 1930 } }),
      ),
    );
  });

  // The allow-list must stay closed. If widening it for `cardio` had been done
  // by dropping hasOnly rather than extending it, every test above would still
  // pass and this one would not.
  it('still rejects a workout session carrying an unknown sibling field', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(
        collection(db, 'users', 'alice', 'workoutSessions'),
        validSession({ cardio: [cardioBlock()], vo2max: 51.2 }),
      ),
    );
  });

  it('accepts a workout template prescribing cardio blocks', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      addDoc(
        collection(db, 'users', 'alice', 'workoutTemplates'),
        validTemplate({ cardioBlocks: [{ modality: 'run', targetDurationSec: 1800 }] }),
      ),
    );
  });

  it('rejects a workout template with more than 20 cardio blocks', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(
        collection(db, 'users', 'alice', 'workoutTemplates'),
        validTemplate({
          cardioBlocks: Array.from({ length: 21 }, () => ({
            modality: 'run',
            targetDurationSec: 1800,
          })),
        }),
      ),
    );
  });

  it('rejects a workout template whose cardioBlocks is a string', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      addDoc(
        collection(db, 'users', 'alice', 'workoutTemplates'),
        validTemplate({ cardioBlocks: 'run 30 min' }),
      ),
    );
  });

  // ── dailySleep provenance (manual vs imported) ──
  //
  // `source` is what lets an automatic import decline to overwrite a night the
  // user typed. Enforcing the enum in rules is the point: a free-form string
  // would let an importer claim `manual` and defeat the protection, and rules
  // are the only access-control layer this app has.

  it('accepts a dailySleep doc with no source — every doc written before 2026-08-24', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice', 'dailySleep', '2026-08-24'), { hours: 7.5 }),
    );
  });

  it.each(['manual', 'import'])('accepts a dailySleep source of %s', async (source) => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      setDoc(doc(db, 'users', 'alice', 'dailySleep', '2026-08-24'), { hours: 7.5, source }),
    );
  });

  it('rejects a dailySleep source outside the enum', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'dailySleep', '2026-08-24'), {
        hours: 7.5,
        source: 'oura',
      }),
    );
  });

  it('rejects an unknown field alongside dailySleep hours', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(
      setDoc(doc(db, 'users', 'alice', 'dailySleep', '2026-08-24'), { hours: 7.5, note: 'x' }),
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

  // ── Regression proof for Sentry IGNIA-MOBILE-9 / -A (2026-08-17) ──
  //
  // The mobile entry sheet hand-built these payloads and skipped every bound the
  // rules enforce, so Firestore rejected the CREATE and the row was silently
  // lost. These specs run the REAL payloads — the rejected ones, and the ones
  // packages/core now produces — against the real rules. The "before" cases must
  // fail, or the fix is being proven against a bug that was never there.
  describe('preset / custom-food write bounds (the silently-lost-row bug)', () => {
    const LONG = 'x'.repeat(240); // a dictated or photo-scanned label, easily >100

    it('REJECTS the pre-fix preset payload (raw label, unclamped macros)', async () => {
      const db = authed('u1');
      await assertFails(
        addDoc(collection(db, 'users/u1/presets'), {
          name: LONG,
          calories: 999_999,
          protein: 5_000,
        }),
      );
    });

    it('ACCEPTS what buildMealPreset produces from that same input', async () => {
      const db = authed('u1');
      // buildMealPreset({ name: LONG, calories: 999999, protein: 5000 })
      await assertSucceeds(
        addDoc(collection(db, 'users/u1/presets'), {
          name: LONG.slice(0, 100),
          calories: 19_999,
          protein: 999,
        }),
      );
    });

    it('REJECTS the pre-fix custom-food payload (raw name, unclamped calories)', async () => {
      const db = authed('u1');
      await assertFails(
        addDoc(collection(db, 'users/u1/customFoods'), {
          name: LONG,
          servingSize: 1,
          servingUnit: 'serving',
          calories: 50_000,
          source: 'manual',
          createdAt: Timestamp.now(),
        }),
      );
    });

    it('ACCEPTS what buildCustomFood produces for the same manual save', async () => {
      const db = authed('u1');
      await assertSucceeds(
        addDoc(collection(db, 'users/u1/customFoods'), {
          name: LONG.slice(0, 100),
          servingSize: 1,
          servingUnit: 'serving',
          calories: 19_999,
          source: 'manual',
          createdAt: Timestamp.now(),
        }),
      );
    });
  });

  describe('Oura link — the credential must be unreachable from a client', () => {
    // `users/{uid}/private/oura` holds an Oura REFRESH TOKEN. It is protected
    // by the ABSENCE of a match block: nothing in firestore.rules names
    // `private/**`, so the `match /{document=**} { allow read, write: if
    // false }` catch-all denies it. Protection-by-absence is invisible when
    // reading the file, which is exactly why it is asserted here — someone
    // adding a convenience `match /private/{doc}` would open a refresh token
    // to the client and nothing else in the repo would complain.

    it('denies the OWNER reading their own stored Oura credential', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice/private/oura'), {
          accessToken: 'at_forged',
          refreshToken: 'rt_forged',
          expiresAt: Timestamp.now(),
        });
      });
      await assertFails(getDoc(doc(authed('alice'), 'users/alice/private/oura')));
    });

    it('denies a client writing a forged Oura credential', async () => {
      await assertFails(
        setDoc(doc(authed('alice'), 'users/alice/private/oura'), { refreshToken: 'rt_forged' }),
      );
    });

    it('lets the owner READ their integration status', async () => {
      // The client half: enough to render "Connected since <date>" and a
      // Disconnect button, and nothing more.
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice/integrations/oura'), {
          connected: true,
          scope: 'workout',
          connectedAt: Timestamp.now(),
        });
      });
      await assertSucceeds(getDoc(doc(authed('alice'), 'users/alice/integrations/oura')));
    });

    it('denies the owner WRITING integration status — server-only', async () => {
      // A client that could write here could claim to be connected with no
      // token behind it, or forge connectedAt.
      await assertFails(
        setDoc(doc(authed('alice'), 'users/alice/integrations/oura'), { connected: true }),
      );
    });

    it('denies another user reading the integration status', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice/integrations/oura'), { connected: true });
      });
      await assertFails(getDoc(doc(authed('mallory'), 'users/alice/integrations/oura')));
    });
  });

  // ── fasts (completed-fast archive, ADR-0032 / #97) ──
  //
  // These rules exist BEFORE any client writes the collection, which is the
  // whole point of writing them first: the dev app talks to PROD Firestore, so
  // an un-deployed rule rejects the very first write and reads like a broken
  // feature rather than a missing deploy. That is the trap #61 exists for.
  //
  // The interval bounds matter more here than in most validators. `breakFast`
  // is a batch — create the fast, null `fastStartedAt`, one commit — so a
  // document these rules REJECT does not merely fail to save: it fails the
  // whole batch and leaves the user's timer running forever. The writer
  // therefore has to agree with these bounds exactly, and these specs are what
  // pin the agreement.

  describe('fasts — the completed-fast archive', () => {
    const validFast = () => ({
      startedAt: Timestamp.fromMillis(Date.parse('2026-08-25T20:00:00Z')),
      endedAt: Timestamp.fromMillis(Date.parse('2026-08-26T12:00:00Z')),
    });

    const writeFast = (db: ReturnType<typeof authed>, data: object) =>
      setDoc(doc(db, 'users', 'alice', 'fasts', 'f1'), data);

    it('accepts a completed fast that crosses midnight', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(writeFast(db, validFast()));
    });

    it.each(['timer', 'manual'])('accepts a source of %s', async (source) => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(writeFast(db, { ...validFast(), source }));
    });

    it('rejects a source outside the enum', async () => {
      // A free-form string would let a hand-entered fast claim the timer
      // measured it — the same reasoning that enumerates dailySleep.source.
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(writeFast(db, { ...validFast(), source: 'import' }));
    });

    it('rejects a fast with no endedAt — a document exists only once it is over', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(writeFast(db, { startedAt: Timestamp.now() }));
    });

    it('rejects an inverted interval', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(
        writeFast(db, { startedAt: validFast().endedAt, endedAt: validFast().startedAt }),
      );
    });

    it('rejects a zero-length fast — not a short fast, a corrupt one', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      const t = Timestamp.fromMillis(Date.parse('2026-08-26T12:00:00Z'));
      await assertFails(writeFast(db, { startedAt: t, endedAt: t }));
    });

    it('accepts a 20-minute fast — no minimum length, deliberately', async () => {
      // ADR-0032 refuses to discard a fast for being short. Zero and Simple do,
      // and the review complaints the ADR quotes are the result.
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      const start = Date.parse('2026-08-26T12:00:00Z');
      await assertSucceeds(
        writeFast(db, {
          startedAt: Timestamp.fromMillis(start),
          endedAt: Timestamp.fromMillis(start + 20 * 60_000),
        }),
      );
    });

    it('accepts a fast one second under the 14-day ceiling', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      const start = Date.parse('2026-08-01T00:00:00Z');
      await assertSucceeds(
        writeFast(db, {
          startedAt: Timestamp.fromMillis(start),
          endedAt: Timestamp.fromMillis(start + 14 * 86_400_000 - 1000),
        }),
      );
    });

    it('rejects a fast past the 14-day ceiling — a corruption guard, not a product opinion', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      const start = Date.parse('2026-08-01T00:00:00Z');
      await assertFails(
        writeFast(db, {
          startedAt: Timestamp.fromMillis(start),
          endedAt: Timestamp.fromMillis(start + 14 * 86_400_000 + 1000),
        }),
      );
    });

    it('rejects an unknown field alongside the interval', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(writeFast(db, { ...validFast(), hours: 16 }));
    });

    it('rejects a non-timestamp interval', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(
        writeFast(db, { startedAt: '2026-08-25T20:00:00Z', endedAt: '2026-08-26T12:00:00Z' }),
      );
    });

    it('lets the owner correct and delete a fast', async () => {
      // Editing is the feature, not the polish (ADR-0032 decision 3): a fast
      // the user forgot to end has to be fixable, or the archive records the
      // forgetting rather than the fast.
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(writeFast(db, validFast()));
      await assertSucceeds(writeFast(db, { ...validFast(), source: 'manual' }));
      await assertSucceeds(deleteDoc(doc(db, 'users', 'alice', 'fasts', 'f1')));
    });

    it('denies another user reading or writing a fast', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice/fasts/f1'), validFast());
      });
      await assertFails(getDoc(doc(authed('mallory'), 'users/alice/fasts/f1')));
      await assertFails(setDoc(doc(authed('mallory'), 'users/alice/fasts/f2'), validFast()));
    });
  });
  // ── milestones (the retrospective record, #108/#109/#110) ──
  //
  // Written and deployed BEFORE the client writes the collection, for the same
  // reason the fasts block above was: the dev app talks to PROD Firestore, so
  // an un-deployed rule rejects the first write and reads like a broken feature.
  //
  // The write-once case is the one that carries product meaning rather than
  // hygiene. `UX_AUDIT.md` §S12 rejects streak-break punishment; this record is
  // permitted precisely because nothing can take an entry away. `allow update:
  // if false` is what makes that true in the database rather than in a comment —
  // and it also stops `earnedAt` moving, which would re-fire the Today
  // celebration for something that happened weeks ago.

  describe('milestones — the retrospective record', () => {
    const earned = (at = '2026-08-20T10:00:00Z') => ({
      earnedAt: Timestamp.fromMillis(Date.parse(at)),
    });

    const writeMilestone = (db: ReturnType<typeof authed>, key: string, data: object) =>
      setDoc(doc(db, 'users', 'alice', 'milestones', key), data);

    it('accepts a known milestone key', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(writeMilestone(db, 'streak-7', earned()));
      await assertSucceeds(writeMilestone(db, 'goal-reached', earned()));
    });

    it('denies a key outside the closed union', async () => {
      // A client bug must not be able to invent entries in an archive the user
      // has no easy way to clean.
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(writeMilestone(db, 'streak-9999', earned()));
      await assertFails(writeMilestone(db, 'lost-50-lbs', earned()));
    });

    it('denies extra fields', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(
        writeMilestone(db, 'streak-7', { ...earned(), note: 'nice work' }),
      );
    });

    it('denies a non-timestamp earnedAt', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(writeMilestone(db, 'streak-7', { earnedAt: '2026-08-20' }));
    });

    it('denies a FUTURE earnedAt', async () => {
      // The Today row renders while `earnedAt` is inside the current day and
      // expires by itself. A future date would pin the celebration on screen
      // with no dismiss control to escape it.
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertFails(
        writeMilestone(db, 'streak-7', {
          earnedAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      );
    });

    it('is WRITE-ONCE — the second attempt is denied, not merged', async () => {
      // Clients re-attempt idempotently and swallow the rejection. This test
      // pins that the rejection is real: without it `earnedAt` could move.
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(writeMilestone(db, 'streak-7', earned()));
      await assertFails(writeMilestone(db, 'streak-7', earned('2026-08-28T10:00:00Z')));
    });

    it('lets the owner delete one', async () => {
      const db = authed('alice');
      await setDoc(doc(db, 'users', 'alice'), baseProfile());
      await assertSucceeds(writeMilestone(db, 'first-scan', earned()));
      await assertSucceeds(
        deleteDoc(doc(db, 'users', 'alice', 'milestones', 'first-scan')),
      );
    });

    it('denies another user reading or writing a milestone', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'users/alice/milestones/streak-7'), earned());
      });
      await assertFails(getDoc(doc(authed('mallory'), 'users/alice/milestones/streak-7')));
      await assertFails(
        setDoc(doc(authed('mallory'), 'users/alice/milestones/streak-14'), earned()),
      );
    });
  });

  // ── the profile validator's expression budget (#100) ──
  //
  // `isValidProfile` is `isValidProfileInitial(data) || isValidProfileCompleted(data)`.
  // A write that satisfies NEITHER branch evaluates both, and the two together
  // used to exceed Firestore's documented ceiling of **1,000 expressions per
  // request**. The emulator names that exactly; PRODUCTION returns a bare
  // `PERMISSION_DENIED`, indistinguishable from a rule that simply rejected the
  // data — so the failure was invisible on the platform where it mattered.
  //
  // Two fixes, and this pins both. `data.keys()` was called 46 times across the
  // two validators and each call re-materialises the key list; it is now one
  // `let` binding per function. And `fastStartedAt` was listed in the Completed
  // branch only, which is what sent an incomplete profile through both.

  it('accepts fastStartedAt on an INCOMPLETE profile — the write that blew the budget', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'alice'), { fastStartedAt: Timestamp.now() }),
    );
    await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { fastStartedAt: null }));
  });

  it('still rejects a non-timestamp fastStartedAt on an incomplete profile', async () => {
    // The cheaper validator must not also be a laxer one.
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { fastStartedAt: 'yesterday' }));
  });

  it('still rejects an unknown field on an incomplete profile', async () => {
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { notAField: 1 }));
  });

  it('evaluates a two-branch MISS without running out of expressions', async () => {
    // The worst case: a completed-only field on an incomplete profile, so both
    // branches run to completion. It must fail as a VALIDATION failure and not
    // by exhausting the budget — which from the client looks identical, and is
    // why this asserts the neighbouring writes above still succeed.
    const db = authed('alice');
    await setDoc(doc(db, 'users', 'alice'), baseProfile());
    await assertFails(updateDoc(doc(db, 'users', 'alice'), { heightIn: 70 }));
    await assertSucceeds(updateDoc(doc(db, 'users', 'alice'), { lastSeenAt: Timestamp.now() }));
  });

});
