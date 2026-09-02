import { describe, expect, it } from 'vitest';
import {
  BATCH_CHUNK,
  type DocCodec,
  toCustomFoodDoc,
  toExerciseDoc,
  toLogDoc,
  toLogPatch,
  toMeasurementDoc,
  toMeasurementPatch,
  toOnboardingV2Patch,
  toPresetDoc,
  toSessionDoc,
  toSessionPatch,
  toTemplateDoc,
  toTemplatePatch,
} from './firestore-writers';

/**
 * A stand-in for the SDK values the real adapters inject. Both are plain,
 * comparable values so a test can assert on the emitted doc directly — which
 * is the whole reason the codec is a parameter rather than an SDK import.
 */
const REMOVE = '<delete>';
const codec: DocCodec<{ ts: number }> = {
  timestamp: (d) => ({ ts: d.getTime() }),
  remove: () => REMOVE,
};

const NOW = new Date('2026-07-30T12:00:00Z');
const stamp = { ts: NOW.getTime() };

describe('toLogDoc', () => {
  it('emits calories + timestamp and omits every unset optional', () => {
    expect(toLogDoc({ calories: 500 }, codec, NOW)).toEqual({
      calories: 500,
      timestamp: stamp,
    });
  });

  it('carries every provided field', () => {
    const at = new Date('2026-07-29T08:30:00Z');
    expect(
      toLogDoc(
        {
          calories: 620,
          weight: 181.4,
          protein: 44,
          carbs: 61,
          fat: 18,
          exerciseCompleted: true,
          mealLabel: 'Greek yogurt',
          mealType: 'breakfast',
          timestamp: at,
        },
        codec,
        NOW,
      ),
    ).toEqual({
      calories: 620,
      timestamp: { ts: at.getTime() },
      weight: 181.4,
      protein: 44,
      carbs: 61,
      fat: 18,
      exerciseCompleted: true,
      mealLabel: 'Greek yogurt',
      mealType: 'breakfast',
    });
  });

  it('keeps a zero macro but drops an empty meal label', () => {
    // 0 is real data (`!= null`); '' is the UI's "not entered" (falsy check).
    const doc = toLogDoc({ calories: 0, protein: 0, mealLabel: '' }, codec, NOW);
    expect(doc.protein).toBe(0);
    expect('mealLabel' in doc).toBe(false);
  });

  it('never writes exerciseCompleted: false — the key is simply absent', () => {
    expect('exerciseCompleted' in toLogDoc({ calories: 1, exerciseCompleted: false }, codec, NOW))
      .toBe(false);
  });

  it('stamps `now` only when the entry carries no timestamp', () => {
    expect(toLogDoc({ calories: 1 }, codec, NOW).timestamp).toEqual(stamp);
  });
});

describe('toLogPatch', () => {
  it('removes each cleared macro instead of leaving the stored value', () => {
    const patch = toLogPatch({ calories: 300 }, codec);
    expect(patch).toMatchObject({
      calories: 300,
      protein: REMOVE,
      carbs: REMOVE,
      fat: REMOVE,
      exerciseCompleted: REMOVE,
      mealLabel: REMOVE,
      mealType: REMOVE,
    });
  });

  it('always removes the legacy completion fields, migrating the row on edit', () => {
    const patch = toLogPatch({ calories: 300, exerciseCompleted: true }, codec);
    expect(patch['liftCompleted']).toBe(REMOVE);
    expect(patch['cardioCompleted']).toBe(REMOVE);
    expect(patch['exerciseCompleted']).toBe(true);
  });

  it('omits timestamp and weight rather than removing them', () => {
    // Both are owned elsewhere (the row keeps its instant; weight lives in
    // dailyWeights), so "not provided" must mean "leave alone", not "delete".
    const patch = toLogPatch({ calories: 300 }, codec);
    expect('timestamp' in patch).toBe(false);
    expect('weight' in patch).toBe(false);
  });

  it('sets timestamp and weight when provided', () => {
    const at = new Date('2026-01-02T03:04:05Z');
    const patch = toLogPatch({ calories: 300, weight: 179, timestamp: at }, codec);
    expect(patch['timestamp']).toEqual({ ts: at.getTime() });
    expect(patch['weight']).toBe(179);
  });
});

describe('toPresetDoc', () => {
  it('keeps the required pair and drops unset macros', () => {
    expect(toPresetDoc({ name: 'Shake', calories: 240 })).toEqual({
      name: 'Shake',
      calories: 240,
    });
  });

  it('carries provided macros', () => {
    expect(toPresetDoc({ name: 'Shake', calories: 240, protein: 30, carbs: 12, fat: 5 })).toEqual({
      name: 'Shake',
      calories: 240,
      protein: 30,
      carbs: 12,
      fat: 5,
    });
  });
});

describe('toCustomFoodDoc', () => {
  const base = {
    name: 'Skyr',
    servingSize: 150,
    servingUnit: 'g' as const,
    calories: 96,
    source: 'barcode' as const,
    createdAt: NOW,
  };

  it('maps createdAt through the codec and omits unset optionals', () => {
    expect(toCustomFoodDoc(base, codec)).toEqual({ ...base, createdAt: stamp });
  });

  it('carries brand, barcode and macros when present', () => {
    expect(
      toCustomFoodDoc({ ...base, brand: 'Siggi', barcode: '0123456789012', protein: 17 }, codec),
    ).toMatchObject({ brand: 'Siggi', barcode: '0123456789012', protein: 17 });
  });

  it('uses the food\'s own createdAt, not the write instant', () => {
    const authored = new Date('2025-12-25T00:00:00Z');
    expect(toCustomFoodDoc({ ...base, createdAt: authored }, codec).createdAt).toEqual({
      ts: authored.getTime(),
    });
  });
});

describe('measurements', () => {
  it('stamps the doc with the write instant', () => {
    expect(toMeasurementDoc({ waist: 34 }, codec, NOW)).toEqual({ timestamp: stamp, waist: 34 });
  });

  it('omits unmeasured sites on create', () => {
    const doc = toMeasurementDoc({ waist: 34 }, codec, NOW);
    for (const site of ['chest', 'bicep', 'hip', 'neck']) expect(site in doc).toBe(false);
  });

  it('removes cleared sites on edit, and leaves the row\'s date alone', () => {
    const patch = toMeasurementPatch({ waist: 34, neck: 15 }, codec);
    expect(patch).toEqual({
      waist: 34,
      chest: REMOVE,
      bicep: REMOVE,
      hip: REMOVE,
      neck: 15,
    });
    expect('timestamp' in patch).toBe(false);
  });
});

describe('toExerciseDoc', () => {
  it('defaults both arrays so the doc always satisfies isValidExercise', () => {
    expect(toExerciseDoc({ name: 'Row' }, codec, NOW)).toEqual({
      name: 'Row',
      muscles: [],
      defaultCues: [],
      createdAt: stamp,
    });
  });

  it('carries muscles, cues, logStyle and seedKey', () => {
    expect(
      toExerciseDoc(
        {
          name: 'Plank',
          muscles: ['core'],
          defaultCues: ['Brace'],
          logStyle: 'time',
          seedKey: 'plank',
        },
        codec,
        NOW,
      ),
    ).toEqual({
      name: 'Plank',
      muscles: ['core'],
      defaultCues: ['Brace'],
      logStyle: 'time',
      seedKey: 'plank',
      createdAt: stamp,
    });
  });
});

describe('templates', () => {
  const draft = { name: 'Push A', exercises: [] };

  it('stamps createdAt and updatedAt identically on create', () => {
    const doc = toTemplateDoc(draft, codec, NOW);
    expect(doc.createdAt).toEqual(stamp);
    expect(doc.updatedAt).toEqual(doc.createdAt);
  });

  it('never writes createdAt on edit — a merge would reset the row\'s age', () => {
    const patch = toTemplatePatch(draft, codec, NOW);
    expect('createdAt' in patch).toBe(false);
    expect(patch['updatedAt']).toEqual(stamp);
  });

  it('rewrites the whole exercise list rather than patching into it', () => {
    // A merged array would union with the stored one, so the full list ships
    // on every edit — including an emptied one.
    expect(toTemplatePatch({ name: 'Push A' }, codec, NOW)['exercises']).toEqual([]);
  });

  it('omits unset optionals from both create and edit', () => {
    const doc = toTemplateDoc(draft, codec, NOW);
    const patch = toTemplatePatch(draft, codec, NOW);
    for (const key of ['notes', 'restMiniSec', 'restClusterSec', 'seedKey']) {
      expect(key in doc).toBe(false);
      expect(key in patch).toBe(false);
    }
  });
});

describe('sessions', () => {
  const started = new Date('2026-07-30T17:15:00Z');
  const draft = { status: 'active' as const, date: started, exercises: [] };

  it('stores the domain `date` as the `timestamp` field', () => {
    const doc = toSessionDoc(draft, codec, NOW);
    expect(doc.timestamp).toEqual({ ts: started.getTime() });
    expect(doc.createdAt).toEqual(stamp);
    expect(doc.updatedAt).toEqual(stamp);
  });

  it('carries the full draft when finishing a session', () => {
    expect(
      toSessionDoc(
        {
          ...draft,
          status: 'completed',
          templateId: 't1',
          templateName: 'Push A',
          bodyweight: 180,
          sleepHours: 7.5,
          durationMin: 52,
          nextNotes: 'Bump the row',
        },
        codec,
        NOW,
      ),
    ).toMatchObject({
      status: 'completed',
      templateId: 't1',
      templateName: 'Push A',
      bodyweight: 180,
      sleepHours: 7.5,
      durationMin: 52,
      nextNotes: 'Bump the row',
    });
  });

  it('patches only what the logger touched, always bumping updatedAt', () => {
    expect(toSessionPatch({ bodyweight: 181 }, codec, NOW)).toEqual({
      bodyweight: 181,
      updatedAt: stamp,
    });
  });

  it('drops a bodyweight outside the storable range on both write paths', () => {
    // 11 lb and 1 lb were stored on real sessions; `weight-bounds.ts` promised
    // a backstop on every path and this one had none.
    const draft = { status: 'completed' as const, date: NOW, exercises: [], bodyweight: 11 };
    expect('bodyweight' in toSessionDoc(draft, codec, NOW)).toBe(false);
    expect('bodyweight' in toSessionPatch({ bodyweight: 1 }, codec, NOW)).toBe(false);
    expect(toSessionDoc({ ...draft, bodyweight: 157.7 }, codec, NOW).bodyweight).toBe(157.7);
  });

  it('distinguishes an absent field from a falsy one', () => {
    // The live logger writes one field at a time, so a key the caller did not
    // mention must survive the write — but 0 / '' are real values.
    const patch = toSessionPatch({ durationMin: 0, nextNotes: '' }, codec, NOW);
    expect(patch['durationMin']).toBe(0);
    expect(patch['nextNotes']).toBe('');
    expect('bodyweight' in patch).toBe(false);
  });

  it('maps a patched date onto `timestamp` too', () => {
    const moved = new Date('2026-07-28T10:00:00Z');
    expect(toSessionPatch({ date: moved }, codec, NOW)['timestamp']).toEqual({
      ts: moved.getTime(),
    });
  });
});

describe('toOnboardingV2Patch', () => {
  const submission = {
    weightLbs: 160,
    goalDirection: 'lose' as const,
    targetWeightLbs: 150,
    manualCaloriesTarget: 1760,
    manualProteinTarget: 115,
  };

  it('writes the heuristic targets, the stamps, and the goal-weight pair', () => {
    expect(toOnboardingV2Patch(submission, codec, NOW)).toEqual({
      goalDirection: 'lose',
      manualCaloriesTarget: 1760,
      manualProteinTarget: 115,
      onboardingV2CompletedAt: stamp,
      profileCompleted: true,
      lastSeenAt: stamp,
      targetWeightLbs: 150,
      goalWeightLbs: 150,
      targetsRefinedAt: REMOVE,
      targetMode: 'auto',
    });
  });

  it("writes 'custom' when the user edited a number on the plan step", () => {
    const patch = toOnboardingV2Patch({ ...submission, targetMode: 'custom' }, codec, NOW);
    expect(patch['targetMode']).toBe('custom');
  });

  it("writes 'auto' EXPLICITLY when they did not, rather than omitting it", () => {
    // Omitting would leave a stale 'custom' in place for someone re-running
    // onboarding to get back to automatic — which is one of the two ways out
    // of custom mode.
    expect(toOnboardingV2Patch(submission, codec, NOW)['targetMode']).toBe('auto');
  });

  it('clears BOTH goal-weight fields on maintain', () => {
    const patch = toOnboardingV2Patch(
      { ...submission, goalDirection: 'maintain', targetWeightLbs: undefined },
      codec,
      NOW,
    );
    expect(patch['targetWeightLbs']).toBe(REMOVE);
    expect(patch['goalWeightLbs']).toBe(REMOVE);
  });

  /**
   * The invariant this function exists to hold: `targetsRefinedAt` set ⟺ manual
   * targets absent. `saveRefinedTargets` deletes the manual targets and stamps
   * the field; re-running onboarding re-writes the manual targets, so it MUST
   * clear the stamp. Leaving it set produced a profile that was "refined" and
   * still carried a manual target — which outranks the formula result forever
   * (targets.ts precedence), so a refined user who changed their goal was stuck
   * on a heuristic number derived from a pace they had already replaced.
   */
  it('clears targetsRefinedAt so a re-onboard cannot shadow the formula target', () => {
    expect(toOnboardingV2Patch(submission, codec, NOW)['targetsRefinedAt']).toBe(REMOVE);
  });

  /**
   * UX_AUDIT F1/F2: onboarding now collects the four Mifflin-St Jeor inputs
   * itself. They are written as a GROUP or not at all — `firestore.rules`
   * fires its strict branch the moment `heightIn` appears and then demands
   * age, sex, activityLevel and a pace alongside it, so a half-written set is
   * a rejected write rather than a degraded one.
   */
  describe('the Mifflin-St Jeor set', () => {
    const refined = {
      ...submission,
      sex: 'female' as const,
      heightIn: 64,
      age: 38,
      activityLevel: 'light' as const,
      targetPaceLbsPerWeek: 1,
    };

    it('writes all five fields when onboarding collected them', () => {
      const patch = toOnboardingV2Patch(refined, codec, NOW);
      expect(patch['sex']).toBe('female');
      expect(patch['heightIn']).toBe(64);
      expect(patch['age']).toBe(38);
      expect(patch['activityLevel']).toBe('light');
      expect(patch['targetPaceLbsPerWeek']).toBe(1);
    });

    it('stamps targetsRefinedAt instead of clearing it', () => {
      // The stamp is the Refine-targets prompt's latch. A run that asked these
      // questions has nothing left to send the user to that screen for.
      expect(toOnboardingV2Patch(refined, codec, NOW)['targetsRefinedAt']).toEqual(stamp);
    });

    it('rounds the pace to the storable 0.1 precision', () => {
      const patch = toOnboardingV2Patch({ ...refined, targetPaceLbsPerWeek: 0.7333 }, codec, NOW);
      expect(patch['targetPaceLbsPerWeek']).toBe(0.7);
    });

    it.each([
      ['sex', { sex: undefined }],
      ['age', { age: undefined }],
      ['height', { heightIn: undefined }],
      ['activity', { activityLevel: undefined }],
      ['pace', { targetPaceLbsPerWeek: undefined }],
      ['an in-band height', { heightIn: 12 }],
      ['an in-band age', { age: 9 }],
    ])('writes NONE of them when the set is missing %s', (_label, override) => {
      const patch = toOnboardingV2Patch({ ...refined, ...override }, codec, NOW);
      for (const key of ['sex', 'heightIn', 'age', 'activityLevel', 'targetPaceLbsPerWeek']) {
        expect(patch[key]).toBeUndefined();
      }
      // ...and such a user is still shown the Refine prompt, because they
      // genuinely have not answered.
      expect(patch['targetsRefinedAt']).toBe(REMOVE);
    });
  });
});

describe('BATCH_CHUNK', () => {
  it('stays under Firestore\'s 500-write cap', () => {
    expect(BATCH_CHUNK).toBeLessThan(500);
  });
});
