import { describe, expect, it } from 'vitest';
import {
  activeMinutes,
  canResume,
  closeAsPartial,
  finishedSegments,
  isExpiredPause,
  pausedSession,
  remainingStepText,
  remainingSteps,
  resumeDeadline,
  resumedSession,
  sessionStatusLabel,
} from './session-pause';
import { MIDNIGHT, setDayStartHour } from './day-boundary';
import type { DateKey } from './date';
import { buildCsv } from './csv-export';
import { volumeBetween } from './volume-credits';
import type { SessionExercise, WorkoutSession, WorkoutSet } from './workout';

// Tests run in the process TZ; the instants are absolute, the day keys are not.
const at = (iso: string) => new Date(iso);
const cl = (w: number, done: boolean): WorkoutSet[] => (['activation', 'mini', 'mini'] as const).map((kind) => (done ? { kind, group: 1, weight: w, reps: kind === 'activation' ? 9 : 4, rir: 0, done: true } : { kind, group: 1 }));
const ex = (exerciseId: string, name: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise => ({ exerciseId, name, cues: [], sets, logStyle: 'weight-reps', ...extra });

/** The 11/4 Travel D shape: a done straight lift, a superset with one member
 *  done, and an untouched tri-set whose middle lift has two clusters + drop. */
function travelD(): WorkoutSession {
  const start = at('2026-11-04T06:40:00');
  return {
    id: 's1', status: 'active', templateId: 'travel-gym-d', templateName: 'Travel D', date: start,
    exercises: [
      ex('rdl', 'DB Romanian deadlift', [{ kind: 'working', weight: 26.45544, reps: 8, rir: 1, done: true }, { kind: 'working', weight: 26.45544, reps: 8, rir: 1, done: true }]),
      ex('pull', 'Pull-up', cl(0, true), { supersetGroup: 'C', pairPosition: 1 }),
      ex('crunch', 'Kneeling Cable Crunch', cl(0, false), { supersetGroup: 'C', pairPosition: 2 }),
      ex('skull', 'Skull Crusher', cl(0, false), { supersetGroup: 'E', pairPosition: 1 }),
      ex('lat', 'DB Lateral Raise', [...cl(0, false), ...cl(0, false).map((x) => ({ ...x, group: 2 })), { kind: 'drop', group: 2 }], { supersetGroup: 'E', pairPosition: 2 }),
      ex('hammer', 'DB Hammer Curl', cl(22.0462, true), { supersetGroup: 'E', pairPosition: 3 }),
      ex('face', 'Rope Face Pull', cl(0, false)),
    ],
    createdAt: start, updatedAt: start,
  };
}

describe('pause / resume', () => {
  it('pause closes the part, stamps logged sets 1, keeps the scaffold, counts active minutes only', () => {
    const p = pausedSession(travelD(), at('2026-11-04T07:17:00'));
    expect(p.status).toBe('paused');
    expect(p.durationMin).toBe(37);
    expect(p.segments).toEqual([{ start: at('2026-11-04T06:40:00'), end: at('2026-11-04T07:17:00') }]);
    expect(p.exercises[0].sets.every((s) => s.segment === 1)).toBe(true);
    expect(p.exercises[2].sets.every((s) => s.segment == null)).toBe(true);
    expect(p.exercises).toHaveLength(7);
  });

  it('lists what is left in flow order, superset rounds interleaved', () => {
    const left = remainingSteps(pausedSession(travelD(), at('2026-11-04T07:17:00')));
    expect(left.map(remainingStepText)).toEqual([
      'C2 Kneeling Cable Crunch',
      'E1 Skull Crusher',
      'E2 DB Lateral Raise c1',
      'E2 DB Lateral Raise c2 + drop',
      'Rope Face Pull',
    ]);
  });

  it('resume reopens the same record; the gap is not counted; new sets are part 2', () => {
    const paused = pausedSession(travelD(), at('2026-11-04T07:17:00'));
    const resumed = resumedSession(paused, at('2026-11-04T17:00:00'));
    expect(resumed.status).toBe('active');
    expect(resumed.date).toEqual(paused.date);
    expect(resumed.templateId).toBe('travel-gym-d');
    expect(resumed.segments).toHaveLength(2);
    expect(activeMinutes(resumed.segments!, at('2026-11-04T17:20:00'))).toBe(57);
    const logged = { ...resumed, exercises: resumed.exercises.map((e) => (e.exerciseId === 'face' ? { ...e, sets: cl(20, true) } : e)) };
    const done = finishedSegments(logged, at('2026-11-04T17:20:00'));
    expect(done.durationMin).toBe(57);
    expect(done.exercises.find((e) => e.exerciseId === 'face')!.sets[0].segment).toBe(2);
    expect(done.exercises[0].sets[0].segment).toBe(1);
  });

  it('a session that never paused finishes as before (no segments, caller owns the duration)', () => {
    const s = travelD();
    expect(finishedSegments(s, at('2026-11-04T08:00:00'))).toBe(s);
  });

  it('the window: until the end of the session day, never past 24 h; a later day boundary extends it past midnight', () => {
    const p = pausedSession(travelD(), at('2026-11-04T07:17:00'));
    expect(resumeDeadline(p, MIDNIGHT)).toEqual(new Date(at('2026-11-05T00:00:00').getTime() - 1));
    expect(canResume(p, at('2026-11-04T23:59:00'), MIDNIGHT)).toBe(true);
    expect(canResume(p, at('2026-11-05T00:00:01'), MIDNIGHT)).toBe(false);
    expect(isExpiredPause(p, at('2026-11-05T00:00:01'), MIDNIGHT)).toBe(true);
    const four = setDayStartHour(MIDNIGHT, '2026-01-01' as DateKey, 4);
    expect(canResume(p, at('2026-11-05T02:00:00'), four)).toBe(true);
    // A session begun late, on a 4 am boundary: the 24 h cap is not what binds.
    const late = { ...p, date: at('2026-11-05T03:00:00') };
    expect(resumeDeadline(late, four)).toEqual(new Date(at('2026-11-05T04:00:00').getTime() - 1));
  });

  it('a part left running is capped at 24 h from the start', () => {
    const p = pausedSession(travelD(), at('2026-11-06T12:00:00'));
    expect(p.durationMin).toBe(24 * 60);
  });

  it('partial close: completed, only logged sets, skipped named, not a regression for any lift', () => {
    const p = pausedSession(travelD(), at('2026-11-04T07:17:00'));
    const c = closeAsPartial(p, at('2026-11-05T00:00:05'));
    expect(c.status).toBe('completed');
    expect(sessionStatusLabel(c)).toBe('partial');
    expect(c.durationMin).toBe(37);
    expect(c.exercises.map((e) => e.exerciseId)).toEqual(['rdl', 'pull', 'hammer']);
    expect(c.partial!.skipped).toEqual(remainingSteps(p).map(remainingStepText));
    // Volume counts only what was done.
    const v = volumeBetween([c], [{ id: 'hammer', name: 'DB Hammer Curl', muscles: ['biceps'] } as never], at('2026-11-02T00:00:00').getTime(), at('2026-11-09T00:00:00').getTime());
    expect(v.total).toBe(4);
    expect(v.week.find((m) => m.muscle === 'triceps')?.direct ?? 0).toBe(0);
  });

  it('status labels', () => {
    expect(sessionStatusLabel({ status: 'completed' })).toBe('complete');
    expect(sessionStatusLabel({ status: 'paused' })).toBe('paused');
  });
});

describe('export: sessionStatus / segmentIndex', () => {
  const cells = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const read = (sessions: WorkoutSession[]) => {
    const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, workoutSessions: sessions });
    const [head, ...lines] = csv.split(/\r?\n/);
    const cols = cells(head);
    return lines.filter(Boolean).map((l) => {
      const c = cells(l);
      return Object.fromEntries(cols.map((k, i) => [k, c[i] ?? '']));
    });
  };

  it('a paused session exports its logged sets as paused, part 1, and names what is left', () => {
    const rows = read([pausedSession(travelD(), at('2026-11-04T07:17:00'))]);
    const w = rows.find((r) => r['type'] === 'workout')!;
    expect(w['sessionStatus']).toBe('paused');
    expect(w['notes']).toContain('left C2 Kneeling Cable Crunch');
    const sets = rows.filter((r) => r['type'] === 'workout_set');
    expect(sets.length).toBe(8);
    expect(sets.every((r) => r['sessionStatus'] === 'paused' && r['segmentIndex'] === '1')).toBe(true);
  });

  it('a resumed-and-finished session carries part 2 on the sets logged after the resume', () => {
    const r = resumedSession(pausedSession(travelD(), at('2026-11-04T07:17:00')), at('2026-11-04T17:00:00'));
    const logged = { ...r, exercises: r.exercises.map((e) => (e.exerciseId === 'face' ? { ...e, sets: cl(20, true) } : e)) };
    const done = { ...finishedSegments(logged, at('2026-11-04T17:10:00')), status: 'completed' as const };
    const rows = read([done]);
    expect(rows.find((x) => x['type'] === 'workout')!['sessionStatus']).toBe('complete');
    expect(rows.filter((x) => x['exercise'] === 'Rope Face Pull').every((x) => x['segmentIndex'] === '2')).toBe(true);
    expect(rows.filter((x) => x['exercise'] === 'Pull-up').every((x) => x['segmentIndex'] === '1')).toBe(true);
  });
});
