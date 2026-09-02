import { describe, expect, it } from 'vitest';
import { restAfterSet } from './rest-after-set';

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
