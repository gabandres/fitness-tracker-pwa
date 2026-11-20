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

// 2026-11-20: the shapes below are what REAL exports look like — read off a
// 7,211-row Hevy export and four Strong exports found in public repositories
// (the values here are made up; the columns, quoting, zeros and formats are
// theirs). The first version of this parser was written without one.
describe('parseWorkoutCsv — the shapes real exports have', () => {
  const HEVY_REAL = [
    '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"',
    // Newest first, as Hevy writes it. A rep set carries duration_seconds 0.
    '"Lower A","15 Sep 2025, 07:48","15 Sep 2025, 09:13","","Seated Leg Curl (Machine)",,"",0,"warmup",39,10,,0,6',
    '"Lower A","15 Sep 2025, 07:48","15 Sep 2025, 09:13","","Seated Leg Curl (Machine)",,"",1,"normal",77.5,12,,0,9.5',
    '"Lower A","15 Sep 2025, 07:48","15 Sep 2025, 09:13","","Seated Leg Curl (Machine)",,"",2,"failure",77.5,9,,0,10',
    '"Lower A","15 Sep 2025, 07:48","15 Sep 2025, 09:13","","Crunch (Weighted)",1,"",0,"failure",10,15,,0,',
    '"Lower A","15 Sep 2025, 07:48","15 Sep 2025, 09:13","","Crunch (Weighted)",1,"",1,"failure",10,0,,0,10',
    '"Pull 1","3 Jul 2024, 18:02","3 Jul 2024, 19:03","","Warm Up",,"",0,"normal",,,,300,',
    '"Pull 1","3 Jul 2024, 18:02","3 Jul 2024, 19:03","","Pull Up",,"",0,"warmup",,4,,0,7',
  ].join('\n');

  it('reads a Hevy export in kilograms, oldest workout first', () => {
    const r = parseWorkoutCsv(HEVY_REAL)!;
    expect(r.format).toBe('hevy');
    expect(r.unit).toBe('kg');
    expect(r.workouts.map((w) => w.name)).toEqual(['Pull 1', 'Lower A']);
    expect(r.workouts[0].durationMin).toBe(61);
    expect(r.workouts[1].durationMin).toBe(85);
  });

  it('does not turn duration_seconds 0 into a timed set, and keeps a timed warm-up', () => {
    const r = parseWorkoutCsv(HEVY_REAL)!;
    expect(r.workouts[0].exercises[0]).toEqual({ name: 'Warm Up', sets: [{ kind: 'working', durationSec: 300 }] });
    expect(r.workouts[0].exercises[1]).toEqual({ name: 'Pull Up', sets: [{ kind: 'warmup', reps: 4, rir: 3 }] });
    expect(r.workouts[1].exercises[0].sets[0]).toEqual({ kind: 'warmup', weight: 39, reps: 10, rir: 4 });
  });

  it('reads a failure set as a working set with nothing left, and a half RPE to the nearest rep', () => {
    const sets = parseWorkoutCsv(HEVY_REAL)!.workouts[1].exercises;
    expect(sets[0].sets[1]).toEqual({ kind: 'working', weight: 77.5, reps: 12, rir: 1 });
    expect(sets[0].sets[2]).toEqual({ kind: 'working', weight: 77.5, reps: 9, rir: 0 });
    // No RPE typed: the set type alone says failure.
    expect(sets[1].sets).toEqual([{ kind: 'working', weight: 10, reps: 15, rir: 0 }]);
  });

  it('skips the row Hevy wrote with 0 reps and no time', () => {
    const r = parseWorkoutCsv(HEVY_REAL)!;
    expect(r.skippedRows).toBe(1);
    expect(r.sets).toBe(6);
  });

  const STRONG_REAL = [
    'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
    '2020-12-30 18:51:52,"Evening Workout",2h 38m,"Snatch (Barbell)",1,40.0,3,0,0,"","",',
    '2020-12-30 18:51:52,"Evening Workout",2h 38m,"Snatch (Barbell)",2,42.5,3,0,0,,,',
    '2020-12-30 18:51:52,"Evening Workout",2h 38m,"Push Up",1,0,20,0,0,,,',
    '2021-05-13 12:00:00,"Midday",1h,"Swimming",1,0,0,1.0,30,"","",',
    '2022-09-21 10:26:28,"Wednesday",38min,"Squat (Barbell)",1,45.0,10,0,0,"","",',
  ].join('\n');

  it('reads the three duration spellings Strong has used: "2h 38m", "1h", "38min"', () => {
    const r = parseWorkoutCsv(STRONG_REAL)!;
    expect(r.format).toBe('strong');
    expect(r.workouts.map((w) => w.durationMin)).toEqual([158, 60, 38]);
  });

  it('reads a weight of 0 as no weight (a bodyweight set), and a cardio row as its time', () => {
    const r = parseWorkoutCsv(STRONG_REAL)!;
    expect(r.workouts[0].exercises[0].sets).toEqual([
      { kind: 'working', weight: 40, reps: 3 },
      { kind: 'working', weight: 42.5, reps: 3 },
    ]);
    expect(r.workouts[0].exercises[1]).toEqual({ name: 'Push Up', sets: [{ kind: 'working', reps: 20 }] });
    expect(r.workouts[1].exercises[0]).toEqual({ name: 'Swimming', sets: [{ kind: 'working', durationSec: 30 }] });
    expect(r.skippedRows).toBe(0);
  });

  it('reads the older ten-column export, whose reps and seconds are decimals', () => {
    const legacy = [
      'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,RPE',
      '2024-11-28 17:36:08,"B",35m,"Bent Over Row (Barbell)",1,10.0,13.0,0,0.0,',
      '2024-11-28 17:36:08,"B",35m,"Bent Over Row (Barbell)",2,20.0,5.0,0,0.0,',
    ].join('\n');
    const r = parseWorkoutCsv(legacy)!;
    expect(r.unit).toBeNull();
    expect(r.workouts[0].exercises[0].sets).toEqual([
      { kind: 'working', weight: 10, reps: 13 },
      { kind: 'working', weight: 20, reps: 5 },
    ]);
  });

  it('reads the newer semicolon export with every cell quoted', () => {
    const semi = [
      '"Workout #";"Date";"Workout Name";"Duration (sec)";"Exercise Name";"Set Order";"Weight (kg)";"Reps";"RPE";"Distance (meters)";"Seconds";"Notes";"Workout Notes"',
      '"1";"2025-04-29 12:00:00";"Chest and Triceps";"600";"Bench Press (Barbell)";"1";"100.0";"10";"";"";"";"";""',
    ].join('\n');
    const r = parseWorkoutCsv(semi)!;
    expect(r.unit).toBe('kg');
    expect(r.workouts[0].durationMin).toBe(10);
    expect(r.workouts[0].exercises[0].sets).toEqual([{ kind: 'working', weight: 100, reps: 10 }]);
  });
});
