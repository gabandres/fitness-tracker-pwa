/**
 * Google Play rejected vc 37 (2026-09-03) under the Health Connect "Minimum
 * Scope" policy for requesting `Steps`. These pin that the Android port never
 * asks for, and never reads, a kind that is not declared in the shipped
 * manifest — and that the two lists cannot drift apart.
 */
import { HC_PERMISSIONS, HC_SKIPPED_KINDS } from '@/lib/health';

const RECORD_FOR_KIND: Record<string, string> = {
  weight: 'Weight',
  water: 'Hydration',
  sleep: 'SleepSession',
  steps: 'Steps',
  activeEnergy: 'ActiveCaloriesBurned',
};

describe('Health Connect minimum scope', () => {
  it('skips steps on Android (Play rejection, 2026-09-03)', () => {
    expect(HC_SKIPPED_KINDS.has('steps')).toBe(true);
  });

  it('never requests a permission for a skipped kind', () => {
    for (const kind of HC_SKIPPED_KINDS) {
      const record = RECORD_FOR_KIND[kind];
      expect(record).toBeDefined();
      expect(HC_PERMISSIONS.some((p) => p.recordType === record)).toBe(false);
    }
  });

  it('still asks for the kinds the product actually shows', () => {
    const asked = new Set(HC_PERMISSIONS.filter((p) => p.accessType === 'read').map((p) => p.recordType));
    expect(asked.has('Weight')).toBe(true);
    expect(asked.has('SleepSession')).toBe(true);
    expect(asked.has('Hydration')).toBe(true);
    expect(asked.has('ActiveCaloriesBurned')).toBe(true);
    expect(asked.has('ExerciseSession')).toBe(true);
  });
});
