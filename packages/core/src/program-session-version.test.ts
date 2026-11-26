/**
 * The version a session records (owner, 2026-11-26): a session of a v2.4
 * template read "v2" because only the Program v2 draft marker was written.
 * The template's label wins; the marker moves to `programVersion`.
 */
import { describe, expect, it } from 'vitest';
import { sessionVersionFor, startProgramVersion } from './program';
import { toWorkoutSession } from './workout-mappers';
import { toSessionDoc } from './firestore-writers';

const draft = (draftOf: string, status: 'active' | 'draft') => ({ draftOf, status, program: 'v2' as const });

describe('sessionVersionFor', () => {
  it('a labelled template with an active v2 draft: label + marker', () => {
    expect(sessionVersionFor({ id: 'push', templateVersion: 'v2.4' }, [draft('push', 'active')]))
      .toEqual({ templateVersion: 'v2.4', programVersion: 'v2' });
  });
  it('a labelled template with no draft: label only', () => {
    expect(sessionVersionFor({ id: 'travel-a', templateVersion: 'travel-v1' }, [draft('push', 'active')]))
      .toEqual({ templateVersion: 'travel-v1' });
  });
  it('an unlabelled template with a draft: the marker, as before', () => {
    expect(sessionVersionFor({ id: 'push' }, [draft('push', 'draft')])).toEqual({ templateVersion: 'v1', programVersion: 'v1' });
  });
  it('neither: nothing', () => {
    expect(sessionVersionFor({ id: 'x', templateVersion: '  ' }, [])).toEqual({});
  });
});

describe('startProgramVersion', () => {
  it('reads programVersion first, then an old marker in templateVersion', () => {
    expect(startProgramVersion({ templateVersion: 'v2.4', programVersion: 'v1' })).toBe('v1');
    expect(startProgramVersion({ templateVersion: 'v2' })).toBe('v2');
    expect(startProgramVersion({ templateVersion: 'v2.4' })).toBeUndefined();
  });
});

describe('the stored session', () => {
  it('round-trips the label and the marker', () => {
    const codec = { timestamp: (d: Date) => d, remove: () => null };
    const doc = toSessionDoc(
      { status: 'active', date: new Date('2026-11-30T12:00:00Z'), exercises: [], templateVersion: 'v2.4', programVersion: 'v2' },
      codec,
    );
    expect(doc).toMatchObject({ templateVersion: 'v2.4', programVersion: 'v2' });
    const back = toWorkoutSession('s', { ...(doc as unknown as Record<string, unknown>), timestamp: new Date('2026-11-30T12:00:00Z') });
    expect(back).toMatchObject({ templateVersion: 'v2.4', programVersion: 'v2' });
  });
});
