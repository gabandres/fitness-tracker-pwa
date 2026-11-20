import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING_PHASE, effectiveTrainingPhase } from './workout';

// UX_AUDIT S24-10 (2026-11-19): the training phase follows the diet goal until
// the lifter picks one. It was 'cut' for every account, including one set to
// gain weight.
describe('effectiveTrainingPhase', () => {
  it('follows the diet goal when no phase was picked', () => {
    expect(effectiveTrainingPhase({ goalDirection: 'lose' })).toBe('cut');
    expect(effectiveTrainingPhase({ goalDirection: 'maintain' })).toBe('maintenance');
    expect(effectiveTrainingPhase({ goalDirection: 'gain' })).toBe('bulk');
  });

  it('keeps the picked phase whatever the goal says', () => {
    expect(effectiveTrainingPhase({ trainingPhase: 'cut', goalDirection: 'gain' })).toBe('cut');
    expect(effectiveTrainingPhase({ trainingPhase: 'bulk', goalDirection: 'lose' })).toBe('bulk');
  });

  it('stays on the phase that never adds volume without a goal or a profile', () => {
    expect(DEFAULT_TRAINING_PHASE).toBe('cut');
    expect(effectiveTrainingPhase({})).toBe('cut');
    expect(effectiveTrainingPhase(null)).toBe('cut');
    expect(effectiveTrainingPhase(undefined)).toBe('cut');
  });
});
