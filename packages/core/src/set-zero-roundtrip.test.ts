import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import { toSessionPatch, type DocCodec } from './firestore-writers';
import { parseLoadToLb } from './load-units';
import { pruneUndefined } from './prune-undefined';
import { clampSetLoad } from './set-load-bounds';
import { clampRir, fillMissingClusterLoads, type WorkoutSession } from './workout';
import { toWorkoutSession } from './workout-mappers';
import { applySessionAction, newCluster } from './workout-session';

/**
 * Zero is a value, end to end (2026-09-30).
 *
 * RIR 0 is the effort standard (ADR-0039) and load 0 is how a bodyweight lift
 * says "no added load" — both are the most common value in their column, and
 * both are exactly what a stray `if (x)` / `x || null` would turn into a
 * blank. The report that prompted this found twelve 09-29 sets with no RIR in
 * Firestore; no falsy check caused it, and this pins that none ever does.
 *
 * Each step is the one the app runs, in order: the value the input hands the
 * reducer (`clampRir` from the RIR picker, `clampSetLoad(parseLoadToLb(...))`
 * from the load field), the reducer, the finish-boundary heal, the write
 * serializer and its undefined-pruning, a JSON round trip standing in for
 * Firestore, the reader, and the CSV export.
 */
const codec: DocCodec<string> = { timestamp: (d) => d.toISOString(), remove: () => null };

function logClusterAtZero(session: WorkoutSession): WorkoutSession {
  let s = session;
  const reps = [10, 3, 2];
  reps.forEach((r, j) => {
    s = applySessionAction(s, {
      type: 'patchSet', exerciseIndex: 0, setIndex: j,
      patch: {
        weight: clampSetLoad(parseLoadToLb('0', 'us')),
        reps: r,
        rir: clampRir(0),
      },
    });
  });
  return s;
}

function saveReadExport(session: WorkoutSession): Record<string, string>[] {
  const exercises = fillMissingClusterLoads(session.exercises);
  const patch = pruneUndefined(toSessionPatch({ exercises }, codec));
  // A JSON round trip stands in for Firestore: it keeps 0 and drops undefined,
  // which is exactly the distinction under test.
  const stored = {
    ...JSON.parse(JSON.stringify(patch)),
    status: 'completed',
    timestamp: { toDate: () => session.date },
  };
  const read = toWorkoutSession('s1', stored);
  expect(read.exercises[0].sets.map((x) => [x.weight, x.rir])).toEqual([[0, 0], [0, 0], [0, 0]]);

  const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, workoutSessions: [read] });
  const [head, ...rows] = csv.trim().split('\n');
  const cols = head.split(',');
  return rows
    .map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])))
    .filter((r) => r.type === 'workout_set');
}

describe('RIR 0 and load 0 survive input → save → read → export', () => {
  const base: WorkoutSession = {
    id: 's1',
    status: 'active',
    date: new Date('2026-09-30T12:00:00Z'),
    createdAt: new Date('2026-09-30T12:00:00Z'),
    updatedAt: new Date('2026-09-30T12:00:00Z'),
    exercises: [{
      exerciseId: 'pullup', name: 'Neutral-grip pull-up', cues: [], logStyle: 'weight-reps',
      sets: newCluster(),
    }],
  };

  it('the input seams hand the reducer 0, not undefined', () => {
    expect(clampRir(0)).toBe(0);
    expect(clampRir('0')).toBe(0);
    expect(clampSetLoad(parseLoadToLb('0', 'us'))).toBe(0);
    expect(clampSetLoad(parseLoadToLb('0', 'metric'))).toBe(0);
  });

  it('exports setRir 0 and setWeight 0 on every set of a bodyweight cluster at RIR 0', () => {
    const rows = saveReadExport(logClusterAtZero(base));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.setRir).toBe('0');
      expect(r.setWeight).toBe('0');
    }
  });

  it('a set left blank beside explicit 0s exports 0 too, not a blank', () => {
    let s = logClusterAtZero(base);
    // The 09-23 shape: the last row's load cell was never typed.
    s = { ...s, exercises: [{ ...s.exercises[0], sets: s.exercises[0].sets.map((x, j) => (j === 2 ? { ...x, weight: undefined } : x)) }] };
    const rows = saveReadExport(s);
    expect(rows.map((r) => r.setWeight)).toEqual(['0', '0', '0']);
  });
});
