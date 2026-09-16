import { describe, it, expect } from 'vitest';
import { inferStructure, isReadableStructure, structureOf, READABLE_STRUCTURES } from './set-structure';
import type { PlannedSet, SetStructure } from './workout';

const planned = (...kinds: string[]): PlannedSet[] => kinds.map((kind) => ({ kind }) as PlannedSet);

describe('inferStructure — the pre-ADR-0040 rule, preserved verbatim', () => {
  it('reads an activation set as myo-reps', () => {
    expect(inferStructure(planned('activation', 'mini', 'mini'))).toBe('myoreps');
  });

  it('reads anything else as straight sets', () => {
    expect(inferStructure(planned('working', 'working', 'working'))).toBe('straight');
    expect(inferStructure(planned('warmup', 'working'))).toBe('straight');
    expect(inferStructure(planned('mobility'))).toBe('straight');
    expect(inferStructure([])).toBe('straight');
    expect(inferStructure(undefined)).toBe('straight');
  });

  it('is not a classifier: a lone drop or continuation is still straight', () => {
    // These kinds belong to structures with no reader. Inference must not
    // start guessing at them — it exists only to keep undeclared legacy data
    // reading exactly as it did, and cleverness here rewrites history.
    expect(inferStructure(planned('working', 'drop'))).toBe('straight');
    expect(inferStructure(planned('working', 'continuation'))).toBe('straight');
  });

  it('sees an activation anywhere in the list, not just first', () => {
    expect(inferStructure(planned('warmup', 'activation', 'mini'))).toBe('myoreps');
  });
});

describe('structureOf — precedence', () => {
  it('prefers the template over the catalog and over inference', () => {
    expect(structureOf(
      { setStructure: 'cluster' },
      { setStructure: 'myoreps' },
      planned('activation', 'mini'),
    )).toBe('cluster');
  });

  it('falls back to the catalog when the template states nothing', () => {
    expect(structureOf({}, { setStructure: 'rest-pause' }, planned('working'))).toBe('rest-pause');
  });

  it('falls back to inference when neither states anything', () => {
    expect(structureOf({}, {}, planned('activation', 'mini'))).toBe('myoreps');
    expect(structureOf({}, {}, planned('working'))).toBe('straight');
  });

  it('infers from the template plannedSets when no set list is passed', () => {
    expect(structureOf({ plannedSets: planned('activation', 'mini') })).toBe('myoreps');
  });

  it('resolves to straight with no arguments at all', () => {
    expect(structureOf()).toBe('straight');
  });

  it('honours a declared structure that contradicts the set list', () => {
    // The whole point of ADR-0040: a cluster logged as straight sets is a
    // DEVIATION the engine must be able to see. If the log could override the
    // declaration, the deviation would be invisible by construction.
    expect(structureOf({ setStructure: 'myoreps' }, undefined, planned('working', 'working')))
      .toBe('myoreps');
  });
});

describe('READABLE_STRUCTURES', () => {
  it('is exactly the structures with an engine reader', () => {
    expect([...READABLE_STRUCTURES].sort()).toEqual(['cluster', 'hit', 'myoreps', 'rest-pause', 'straight']);
  });

  it('refuses every structure that has no reader', () => {
    // `drop` needs within-set load reduction and `superset` needs a pairing
    // between two exercises. Neither is in the model, so neither is cheap the
    // way `hit` was (ADR-0040 §Consequences).
    const unreadable: SetStructure[] = ['drop', 'superset'];
    for (const s of unreadable) expect(isReadableStructure(s)).toBe(false);
  });
});
