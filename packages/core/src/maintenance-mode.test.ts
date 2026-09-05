import { describe, expect, it } from 'vitest';
import type { DocCodec } from './firestore-writers';
import { isMaintaining, toMaintenanceSwitchPatch } from './maintenance-mode';
import { computeKcal } from './macro-heuristic';
import type { Profile } from './types';

const REMOVE = Symbol('remove');
const codec: DocCodec<string> = {
  timestamp: (d) => d.toISOString(),
  remove: () => REMOVE,
};
const now = new Date('2026-09-05T12:00:00Z');

const cutProfile: Profile = {
  goalDirection: 'lose',
  targetPaceLbsPerWeek: 1,
  targetWeightLbs: 170,
  goalWeightLbs: 170,
  manualCaloriesTarget: computeKcal(185, 'lose'),
  manualProteinTarget: 135,
  targetMode: 'custom',
} as Profile;

describe('isMaintaining', () => {
  it('is exactly goalDirection === maintain — no second flag', () => {
    expect(isMaintaining({ goalDirection: 'maintain' })).toBe(true);
    expect(isMaintaining({ goalDirection: 'lose' })).toBe(false);
    expect(isMaintaining({ goalDirection: 'gain' })).toBe(false);
  });

  it('an absent direction is a cut (every pre-v2 account), not maintenance', () => {
    expect(isMaintaining({})).toBe(false);
    expect(isMaintaining(null)).toBe(false);
    expect(isMaintaining(undefined)).toBe(false);
  });
});

describe('toMaintenanceSwitchPatch', () => {
  it('writes the two inputs the target chain reads, and puts the mode back on auto', () => {
    const patch = toMaintenanceSwitchPatch(cutProfile, 170, codec, now);
    expect(patch).toMatchObject({
      goalDirection: 'maintain',
      targetPaceLbsPerWeek: 0,
      targetMode: 'auto',
      lastSeenAt: now.toISOString(),
    });
  });

  it('clears BOTH legacy goal-weight fields, as the wizard does for maintain', () => {
    const patch = toMaintenanceSwitchPatch(cutProfile, 170, codec, now);
    expect(patch['targetWeightLbs']).toBe(REMOVE);
    expect(patch['goalWeightLbs']).toBe(REMOVE);
  });

  it('rewrites a stored onboarding seed for maintenance at the CURRENT weight', () => {
    // In auto mode a stored seed outranks formula mode, so leaving the cut
    // seed in place would keep the user eating at the deficit with "Maintain"
    // in Settings. Heuristic basis here (no Mifflin inputs): weight × 14.
    const patch = toMaintenanceSwitchPatch(cutProfile, 170, codec, now);
    expect(patch['manualCaloriesTarget']).toBe(computeKcal(170, 'maintain'));
    expect(patch['manualCaloriesTarget']).toBeGreaterThan(cutProfile.manualCaloriesTarget as number);
  });

  it('uses the formula basis when the profile carries the Mifflin-St Jeor set', () => {
    const refined: Profile = {
      ...cutProfile,
      sex: 'male',
      heightIn: 70,
      age: 35,
      activityLevel: 'moderate',
    } as Profile;
    const patch = toMaintenanceSwitchPatch(refined, 170, codec, now);
    // What matters is that this is the SAME number formula mode will produce
    // once the seed is superseded, so nothing moves on the day it is — not
    // the weight × 14 heuristic.
    expect(patch['manualCaloriesTarget']).not.toBe(computeKcal(170, 'maintain'));
    expect(patch['manualCaloriesTarget']).toBeGreaterThan(2000);
  });

  it('writes NO seed for a profile that has none — a formula-mode user keeps the formula', () => {
    const formulaOnly: Profile = {
      goalDirection: 'lose',
      targetPaceLbsPerWeek: 1,
      targetWeightLbs: 170,
      sex: 'female',
      heightIn: 65,
      age: 40,
      activityLevel: 'light',
    } as Profile;
    const patch = toMaintenanceSwitchPatch(formulaOnly, 170, codec, now);
    expect('manualCaloriesTarget' in patch).toBe(false);
  });

  it('never touches the protein snapshot — protein tracks body weight, not the goal', () => {
    const patch = toMaintenanceSwitchPatch(cutProfile, 170, codec, now);
    expect('manualProteinTarget' in patch).toBe(false);
    expect('proteinPerKg' in patch).toBe(false);
  });
});
