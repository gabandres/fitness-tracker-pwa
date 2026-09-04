/**
 * The Train tab's handling of an unreadable activation set.
 *
 * The rule these pin down is not a training preference, it is a claim about
 * evidence: a rep count only means something given how close to failure the
 * set stopped, so an activation logged at RIR 4+ (or taken to failure, or with
 * no RIR at all) is not a weaker basis for a load increase — it is not a basis
 * for one. The app used to recommend anyway, which is advertising a number the
 * data does not support.
 *
 * Two things are deliberately NOT tested as failures here, because they are
 * the ways this could go wrong in the other direction:
 *   - a straight-set user, who has no activation sets and must keep their
 *     progression exactly as it was;
 *   - a user who never logs RIR at all, which is most of them.
 */
import {
  activationIssue,
  blocksProgression,
  sessionActivationIssues,
  suggestProgression,
} from '@macrolog/core';
import type { SessionExercise } from '@/lib/workout';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';

const ISSUE_KEYS = [
  'train.invalidRirFailure',
  'train.invalidRirEasy',
  'train.invalidRirMissing',
  'train.invalidNotClustered',
] as const;

const clustered = (rir: number | undefined, reps = 12): SessionExercise => ({
  exerciseId: 'press',
  name: 'Seated DB Shoulder Press',
  cues: [],
  logStyle: 'weight-reps',
  sets: [
    { kind: 'activation', group: 1, weight: 50, reps, ...(rir != null ? { rir } : {}) },
    { kind: 'mini', group: 1, weight: 50, reps: 6 },
  ],
});

describe('Train — a load is not recommended off an unreadable activation', () => {
  const rule = { targetReps: 11, holdSessions: 2, incrementLb: 5 };

  it('withholds the bump and says why, rather than going quiet', () => {
    const s = suggestProgression([clustered(5), clustered(5)], rule, 'weight-reps');
    expect(s.bumped).toBe(false);
    // The REASON is what makes this different from "no bump today".
    expect(s.blockedBy).toBe('rir-too-easy');
  });

  it('keeps straight-set logging completely unaffected', () => {
    const straight = (rir: number): SessionExercise => ({
      exerciseId: 'bench',
      name: 'Bench',
      cues: [],
      logStyle: 'weight-reps',
      sets: [{ kind: 'working', weight: 100, reps: 12, rir }],
    });
    // Taking a straight set to failure is ordinary training, and hitting the
    // target with reps to spare is exactly when load SHOULD go up.
    for (const rir of [0, 5]) {
      const s = suggestProgression([straight(rir), straight(rir)], rule, 'weight-reps');
      expect(s.bumped).toBe(true);
      expect(s.blockedBy).toBeUndefined();
    }
  });

  it('does not punish a user who logs no RIR', () => {
    const s = suggestProgression([clustered(undefined), clustered(undefined)], rule, 'weight-reps');
    expect(s.bumped).toBe(true);
    expect(blocksProgression(activationIssue(clustered(undefined)))).toBe(false);
  });

  it('detects straight sets logged against a cluster template — the pull-up case', () => {
    // 2026-09-02: the pull-up was prescribed as a cluster and logged as three
    // straight sets with no RIR, so its 40-60s mini rest never applied and the
    // position change could not be judged.
    const found = sessionActivationIssues(
      [
        {
          exerciseId: 'pullup',
          name: 'Neutral-grip pull-up',
          cues: [],
          logStyle: 'weight-reps',
          sets: [
            { kind: 'working', weight: 0, reps: 5 },
            { kind: 'working', weight: 0, reps: 2 },
          ],
        },
      ],
      {
        exercises: [
          {
            exerciseId: 'pullup',
            plannedSets: [{ kind: 'activation' }, { kind: 'mini' }, { kind: 'mini' }],
          },
        ],
      },
    );
    expect(found).toEqual([
      { exerciseId: 'pullup', name: 'Neutral-grip pull-up', issue: 'not-clustered' },
    ]);
  });
});

describe('Train — every issue has a string in every locale', () => {
  // A missing key renders the raw key in production (a known repeat offender,
  // dossier §8 item 12), and these strings only appear on the rare bad-data
  // path, so nothing else would catch it.
  it.each(ISSUE_KEYS)('%s is translated everywhere', (key) => {
    for (const [name, dict] of [['en', en], ['es-PR', esPR], ['pt-BR', ptBR]] as const) {
      const value = (dict as Record<string, string>)[key];
      expect(`${name}:${key}:${value ?? ''}`).not.toMatch(/:$/);
      expect(value.length).toBeGreaterThan(0);
      expect(value).not.toBe(key);
    }
  });

  it('keeps the notice copy short enough for an exercise card', () => {
    for (const key of ISSUE_KEYS) {
      expect((en as Record<string, string>)[key].length).toBeLessThanOrEqual(56);
    }
  });
});
