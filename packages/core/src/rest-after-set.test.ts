import { describe, expect, it } from 'vitest';
import { REST_INTO_CONTINUATION_SEC, restAfterSet } from './rest-after-set';

const rest = { mini: 20, cluster: 150 };
const cluster = [
  { kind: 'activation' as const },
  { kind: 'mini' as const },
  { kind: 'mini' as const },
];

describe('restAfterSet', () => {
  it('rests short inside a cluster and long after its last mini', () => {
    expect(restAfterSet(cluster, 0, rest)).toBe(20);
    expect(restAfterSet(cluster, 1, rest)).toBe(20);
    expect(restAfterSet(cluster, 2, rest)).toBe(150);
  });

  it('rests long before the next cluster of the same exercise', () => {
    const two = [...cluster, ...cluster];
    expect(restAfterSet(two, 2, rest)).toBe(150);
    expect(restAfterSet(two, 3, rest)).toBe(20);
  });

  it('gives straight sets the short rest and the last set the long one', () => {
    const straight = [{ kind: 'working' as const }, { kind: 'working' as const }, { kind: 'working' as const }];
    expect(restAfterSet(straight, 0, rest)).toBe(20);
    expect(restAfterSet(straight, 2, rest)).toBe(150);
  });

  it('is the seam an exercise-level override plugs into', () => {
    // A bodyweight cluster: the caller substitutes the exercise's own mini rest.
    expect(restAfterSet(cluster, 0, { ...rest, mini: 50 })).toBe(50);
    expect(restAfterSet(cluster, 2, { ...rest, mini: 50 })).toBe(150);
  });
});

describe('restAfterSet — into a drop set', () => {
  it('rests only long enough to change the weight, whatever the template says', () => {
    const withDrop = [...cluster, { kind: 'drop' as const }];
    // After the final mini, the NEXT set is the drop: 10s, not the 20s mini
    // rest and not the 150s cluster rest.
    expect(restAfterSet(withDrop, 2, rest)).toBe(10);
    // A template with a long mini rest cannot lengthen it either.
    expect(restAfterSet(withDrop, 2, { mini: 90, cluster: 180 })).toBe(10);
    // Nor can an exercise-level override.
    expect(restAfterSet(withDrop, 2, { ...rest, mini: 50 })).toBe(10);
  });

  it('gives the long rest AFTER the drop, since the exercise is over', () => {
    const withDrop = [...cluster, { kind: 'drop' as const }];
    expect(restAfterSet(withDrop, 3, rest)).toBe(150);
  });

  it('does not disturb a sequence with no drop in it', () => {
    expect(restAfterSet(cluster, 0, rest)).toBe(20);
    expect(restAfterSet(cluster, 2, rest)).toBe(150);
  });
});

describe('restAfterSet — into a continuation set', () => {
  // The two shapes `scaffoldKindsFor` builds for the structures ADR-0040 added.
  const restPause = [{ kind: 'activation' as const }, { kind: 'continuation' as const }];
  const clusterBlock = [
    { kind: 'activation' as const },
    { kind: 'continuation' as const },
    { kind: 'continuation' as const },
  ];
  // Deliberately NOT the file's `rest`, whose `mini` is 20 and would pass this
  // suite by coincidence against the very bug it is here to pin.
  const longRest = { mini: 90, cluster: 180 };

  it('rests the short intra-block pause, not the between-sets rest', () => {
    expect(restAfterSet(restPause, 0, longRest)).toBe(REST_INTO_CONTINUATION_SEC);
    expect(restAfterSet(clusterBlock, 0, longRest)).toBe(REST_INTO_CONTINUATION_SEC);
    expect(restAfterSet(clusterBlock, 1, longRest)).toBe(REST_INTO_CONTINUATION_SEC);
  });

  it('cannot be lengthened by the template or by an exercise-level override', () => {
    // The regression: `continuation` had no case, so both of these returned the
    // straight-set rest and the continuation became an ordinary second set.
    expect(restAfterSet(restPause, 0, { mini: 300, cluster: 600 })).toBe(REST_INTO_CONTINUATION_SEC);
    expect(restAfterSet(restPause, 0, { ...longRest, mini: 120 })).toBe(REST_INTO_CONTINUATION_SEC);
  });

  it('gives the long rest after the block, where the next effort is a real one', () => {
    expect(restAfterSet(restPause, 1, longRest)).toBe(180);
    expect(restAfterSet(clusterBlock, 2, longRest)).toBe(180);
  });

  it('rests long between blocks of a multi-block exercise', () => {
    const twoBlocks = [...restPause, ...restPause];
    expect(restAfterSet(twoBlocks, 1, longRest)).toBe(180); // block 1 → block 2
    expect(restAfterSet(twoBlocks, 2, longRest)).toBe(REST_INTO_CONTINUATION_SEC);
    expect(restAfterSet(twoBlocks, 3, longRest)).toBe(180);
  });

  it('leaves myo-reps mini-sets on the template value', () => {
    // `mini` and `continuation` are different kinds: only the latter is pinned.
    expect(restAfterSet(cluster, 0, longRest)).toBe(90);
    expect(restAfterSet(cluster, 1, longRest)).toBe(90);
  });
});
