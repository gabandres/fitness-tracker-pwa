import { describe, expect, it } from 'vitest';
import { importedWeightToLb, parseWorkoutCsv, parseWorkoutDate } from './workout-import';

// UX_AUDIT S24-17 (2026-11-19). Neither app documents its export, so these
// pin the parser's CONTRACT — columns by name, either delimiter, unit from the
// header or asked, refuse what is not a workout file — not a byte-exact copy
// of a file from either app.

const HEVY = [
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"',
  '"Push Day","15 Jan 2024, 18:30","15 Jan 2024, 19:35","","Bench Press (Barbell)",,"",0,"warmup",95,10,,,',
  '"Push Day","15 Jan 2024, 18:30","15 Jan 2024, 19:35","","Bench Press (Barbell)",,"",1,"normal",185,8,,,8',
  '"Push Day","15 Jan 2024, 18:30","15 Jan 2024, 19:35","","Bench Press (Barbell)",,"",2,"dropset",135,12,,,',
  '"Push Day","15 Jan 2024, 18:30","15 Jan 2024, 19:35","","Plank",,"",0,"normal",,,,60,',
  '"Pull Day","17 Jan 2024, 07:05","17 Jan 2024, 07:50","","Pull Up",,"",0,"normal",,9,,,',
].join('\n');

const STRONG = [
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
  '2023-03-02 17:45:10,"Legs, heavy",1h 5m,Squat (Barbell),1,100,5,0,0,,,',
  '2023-03-02 17:45:10,"Legs, heavy",1h 5m,Squat (Barbell),2,100,5,0,0,,,9',
  '2023-03-02 17:45:10,"Legs, heavy",1h 5m,Squat (Barbell),Rest Timer,0,0,0,120,,,',
  '2023-03-02 17:45:10,"Legs, heavy",1h 5m,Leg Press,W,60,12,0,0,,,',
  '2023-03-02 17:45:10,"Legs, heavy",1h 5m,Squat (Barbell),1,80,10,0,0,,,',
].join('\r\n');

describe('parseWorkoutCsv — Hevy', () => {
  const r = parseWorkoutCsv(HEVY)!;

  it('reads one workout per start time, oldest first, with its length', () => {
    expect(r.format).toBe('hevy');
    expect(r.workouts.map((w) => w.name)).toEqual(['Push Day', 'Pull Day']);
    expect(r.workouts[0].date).toEqual(new Date(2024, 0, 15, 18, 30));
    expect(r.workouts[0].durationMin).toBe(65);
    expect(r.firstDate).toEqual(r.workouts[0].date);
    expect(r.lastDate).toEqual(r.workouts[1].date);
  });

  it('takes the unit from the header', () => {
    expect(r.unit).toBe('lb');
    expect(parseWorkoutCsv(HEVY.replace('weight_lbs', 'weight_kg'))!.unit).toBe('kg');
  });

  it('keeps warm-ups and drop sets as what they were, and turns an RPE into RIR', () => {
    const bench = r.workouts[0].exercises[0];
    expect(bench.name).toBe('Bench Press (Barbell)');
    expect(bench.sets).toEqual([
      { kind: 'warmup', weight: 95, reps: 10 },
      { kind: 'working', weight: 185, reps: 8, rir: 2 },
      { kind: 'drop', weight: 135, reps: 12 },
    ]);
  });

  it('reads a timed set and a bodyweight set', () => {
    expect(r.workouts[0].exercises[1]).toEqual({ name: 'Plank', sets: [{ kind: 'working', durationSec: 60 }] });
    expect(r.workouts[1].exercises[0]).toEqual({ name: 'Pull Up', sets: [{ kind: 'working', reps: 9 }] });
    expect(r.sets).toBe(5);
    expect(r.skippedRows).toBe(0);
  });
});

describe('parseWorkoutCsv — Strong', () => {
  const r = parseWorkoutCsv(STRONG)!;

  it('reads a quoted workout name with a comma, an ISO date and "1h 5m"', () => {
    expect(r.format).toBe('strong');
    expect(r.workouts).toHaveLength(1);
    expect(r.workouts[0].name).toBe('Legs, heavy');
    expect(r.workouts[0].date).toEqual(new Date(2023, 2, 2, 17, 45, 10));
    expect(r.workouts[0].durationMin).toBe(65);
  });

  it('cannot know the unit from a bare Weight column, and says so', () => {
    expect(r.unit).toBeNull();
  });

  it('drops the rest-timer row, reads "W" as a warm-up, and keeps a lift done twice as two cards', () => {
    expect(r.workouts[0].exercises.map((e) => e.name)).toEqual(['Squat (Barbell)', 'Leg Press', 'Squat (Barbell)']);
    expect(r.workouts[0].exercises[0].sets).toEqual([
      { kind: 'working', weight: 100, reps: 5 },
      { kind: 'working', weight: 100, reps: 5, rir: 1 },
    ]);
    expect(r.workouts[0].exercises[1].sets).toEqual([{ kind: 'warmup', weight: 60, reps: 12 }]);
    expect(r.sets).toBe(4);
  });

  it('reads the semicolon export with the unit in the header', () => {
    const semi = [
      'Workout #;Date;Workout Name;Duration (sec);Exercise Name;Set Order;Weight (kg);Reps;RPE;Distance (meters);Seconds;Notes;Workout Notes',
      '1;2025-06-01 09:00:00;Morning;3600;Deadlift (Barbell);1;140,5;3;;;;;',
    ].join('\n');
    const s = parseWorkoutCsv(semi)!;
    expect(s.unit).toBe('kg');
    expect(s.workouts[0].durationMin).toBe(60);
    // A decimal comma, as a European export writes it.
    expect(s.workouts[0].exercises[0].sets[0]).toEqual({ kind: 'working', weight: 140.5, reps: 3 });
  });
});

describe('parseWorkoutCsv — what it refuses', () => {
  it('is null for a food diary, an empty file and a header with no rows', () => {
    expect(parseWorkoutCsv('Date,Meal,Calories,Protein (g)\n2024-01-01,Lunch,650,40')).toBeNull();
    expect(parseWorkoutCsv('')).toBeNull();
    expect(parseWorkoutCsv(HEVY.split('\n')[0])).toBeNull();
  });

  it('counts rows it cannot read instead of inventing a set', () => {
    const bad = [
      'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
      '03/02/2023,A,45m,Squat,1,100,5,0,0,,,', // ambiguous day/month: refused
      '2023-03-02 10:00:00,A,45m,,1,100,5,0,0,,,', // no exercise
      '2023-03-02 10:00:00,A,45m,Squat,1,100,0,0,0,,,', // no reps, no time
      '2023-03-02 10:00:00,A,45m,Squat,2,100,5,0,0,,,',
    ].join('\n');
    const r = parseWorkoutCsv(bad)!;
    expect(r.skippedRows).toBe(3);
    expect(r.sets).toBe(1);
    expect(r.workouts[0].durationMin).toBe(45);
  });

  it('ignores absurd numbers rather than storing them', () => {
    const r = parseWorkoutCsv(
      'Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n2023-03-02 10:00:00,A,Squat,1,999999,5',
    )!;
    expect(r.workouts[0].exercises[0].sets[0]).toEqual({ kind: 'working', reps: 5 });
  });
});

describe('parseWorkoutDate', () => {
  it('reads both shapes as local time and refuses the rest', () => {
    expect(parseWorkoutDate('2023-01-15 18:30:00')).toEqual(new Date(2023, 0, 15, 18, 30, 0));
    expect(parseWorkoutDate('5 Feb 2024, 06:05')).toEqual(new Date(2024, 1, 5, 6, 5));
    expect(parseWorkoutDate('2023-02-31 10:00:00')).toBeNull();
    expect(parseWorkoutDate('01/02/2023')).toBeNull();
    expect(parseWorkoutDate('')).toBeNull();
  });
});

describe('importedWeightToLb', () => {
  it('keeps pounds and converts kilograms, to two decimals', () => {
    expect(importedWeightToLb(185, 'lb')).toBe(185);
    expect(importedWeightToLb(100, 'kg')).toBe(220.46);
  });
});
