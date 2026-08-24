import { describe, expect, it } from 'vitest';
import type { CardioBlock } from './cardio';
import type { WorkoutSession } from './workout';
import {
  METERS_PER_MILE,
  cardioSummaryCells,
  cardioWeekStats,
  distanceUnit,
  formatDistance,
  formatDuration,
  formatRate,
  longestEffortSec,
  modalityCounts,
  parseDistanceToM,
  paceSecPerUnit,
  sessionCardioDistanceM,
  sessionCardioSec,
  speedPerHour,
  toDisplayDistance,
} from './cardio-view';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 7, 24, 12, 0).getTime();

const block = (b: Partial<CardioBlock> = {}): CardioBlock => ({
  modality: 'run',
  durationSec: 1800,
  source: 'manual',
  ...b,
});

function session(daysAgo: number, cardio: CardioBlock[]): WorkoutSession {
  const date = new Date(NOW - daysAgo * DAY);
  return { status: 'completed', date, exercises: [], cardio, createdAt: date, updatedAt: date };
}

describe('formatDuration', () => {
  it('is unpadded minutes under an hour', () => {
    expect(formatDuration(1930)).toBe('32:10');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('grows an hours field, padding the minutes once it does', () => {
    expect(formatDuration(3750)).toBe('1:02:30');
    expect(formatDuration(3600)).toBe('1:00:00');
  });

  // Display code: a history list must not be taken down by one corrupt row.
  it('reads zero for junk instead of throwing', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-90)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('distance conversion', () => {
  it('shows miles by default and km on metric', () => {
    expect(distanceUnit(undefined)).toBe('mi');
    expect(distanceUnit('us')).toBe('mi');
    expect(distanceUnit('metric')).toBe('km');
  });

  it('converts a 5k both ways', () => {
    expect(toDisplayDistance(5000, 'metric')).toBe(5);
    expect(toDisplayDistance(5000, 'us')).toBe(3.11);
  });

  it('formats with its unit', () => {
    expect(formatDistance(8046.72, 'us')).toBe('5 mi');
    expect(formatDistance(8046.72, 'metric')).toBe('8.05 km');
  });

  it('round-trips what the user typed', () => {
    expect(parseDistanceToM('5', 'us')).toBeCloseTo(METERS_PER_MILE * 5, 6);
    expect(parseDistanceToM('5', 'metric')).toBe(5000);
  });

  // es-PR and pt-BR keyboards produce a comma; parseLoadToLb already handles
  // this and a distance field that did not would silently reject real input.
  it('accepts a comma decimal separator', () => {
    expect(parseDistanceToM('5,5', 'metric')).toBe(5500);
  });

  it('returns null for unparseable or negative input', () => {
    expect(parseDistanceToM('', 'us')).toBeNull();
    expect(parseDistanceToM('far', 'us')).toBeNull();
    expect(parseDistanceToM('-3', 'us')).toBeNull();
  });
});

describe('rate', () => {
  it('derives pace per mile', () => {
    // 3.11 mi in 1800s → 578.8 s/mi ≈ 9:39
    const pace = paceSecPerUnit(1800, 5000, 'us');
    expect(pace).not.toBeNull();
    expect(formatDuration(pace as number)).toBe('9:39');
  });

  it('derives speed per hour', () => {
    expect(speedPerHour(3600, 30000, 'metric')).toBe(30);
  });

  // Without the zero guard these render `Infinity` in a history row — a
  // treadmill session with no GPS is the ordinary case, not an edge case.
  it('is null when either half is missing', () => {
    expect(paceSecPerUnit(1800, undefined, 'us')).toBeNull();
    expect(paceSecPerUnit(1800, 0, 'us')).toBeNull();
    expect(paceSecPerUnit(0, 5000, 'us')).toBeNull();
    expect(speedPerHour(0, 5000, 'us')).toBeNull();
  });

  it('quotes a run as pace and a ride as speed', () => {
    expect(formatRate({ modality: 'run', durationSec: 1800, distanceM: 5000 }, 'metric'))
      .toBe('6:00 /km');
    expect(formatRate({ modality: 'ride', durationSec: 3600, distanceM: 30000 }, 'metric'))
      .toBe('30 km/h');
  });

  it('has no rate at all without a distance', () => {
    expect(formatRate({ modality: 'run', durationSec: 1800 }, 'us')).toBeNull();
  });
});

describe('cardioSummaryCells', () => {
  it('omits cells it has no data for rather than rendering blanks', () => {
    expect(cardioSummaryCells(block({ durationSec: 1440 }), 'us')).toEqual(['24:00']);
  });

  it('builds the full line when the numbers are there', () => {
    expect(
      cardioSummaryCells(block({ durationSec: 1800, distanceM: 5000, avgHr: 148 }), 'metric'),
    ).toEqual(['30:00', '5 km', '6:00 /km', '148 bpm']);
  });

  // kcal is display provenance (ADR-0024 decision 4, ADR-0026 decision 5).
  // Putting it in a summary line beside real numbers is how it starts reading
  // as a budget the user can spend.
  it('never includes kcal', () => {
    const cells = cardioSummaryCells(
      block({ durationSec: 1800, distanceM: 5000, avgHr: 148, kcal: 612 }),
      'metric',
    );
    expect(cells.join(' ')).not.toContain('612');
  });
});

describe('roll-ups', () => {
  it('sums only logged blocks on a session', () => {
    const s = session(1, [
      block({ durationSec: 1800, distanceM: 5000 }),
      block({ durationSec: 600, distanceM: 1200 }),
      // A prescribed block the user never performed.
      block({ durationSec: 0, targetDurationSec: 1200 }),
    ]);
    expect(sessionCardioSec(s)).toBe(2400);
    expect(sessionCardioDistanceM(s)).toBe(6200);
  });

  it('counts only the trailing seven days', () => {
    const stats = cardioWeekStats(
      [
        session(1, [block({ durationSec: 1800, distanceM: 5000 })]),
        session(3, [block({ durationSec: 600, distanceM: 1000 })]),
        session(30, [block({ durationSec: 9000, distanceM: 40000 })]),
      ],
      NOW,
    );
    expect(stats).toEqual({ sessions: 2, blocks: 2, minutes: 40, distanceM: 6000 });
  });

  it('ignores sessions whose only cardio is an unperformed prescription', () => {
    const stats = cardioWeekStats([session(1, [block({ durationSec: 0 })])], NOW);
    expect(stats).toEqual({ sessions: 0, blocks: 0, minutes: 0, distanceM: 0 });
  });

  it('handles a session with no cardio field at all', () => {
    const date = new Date(NOW - DAY);
    const bare: WorkoutSession = {
      status: 'completed', date, exercises: [], createdAt: date, updatedAt: date,
    };
    expect(sessionCardioSec(bare)).toBe(0);
    expect(cardioWeekStats([bare], NOW).sessions).toBe(0);
    expect(longestEffortSec([bare])).toBe(0);
    expect(modalityCounts([bare])).toEqual({});
  });

  it('finds the longest single effort, not the longest session', () => {
    expect(
      longestEffortSec([
        session(1, [block({ durationSec: 1200 }), block({ durationSec: 900 })]),
        session(2, [block({ durationSec: 1500 })]),
      ]),
    ).toBe(1500);
  });

  // Absent, not zero — so a caller can render "what you actually do" without
  // filtering a table of nine zeroes first.
  it('omits modalities with no blocks', () => {
    const counts = modalityCounts([
      session(1, [block({ modality: 'run' }), block({ modality: 'run' }), block({ modality: 'ride' })]),
    ]);
    expect(counts).toEqual({ run: 2, ride: 1 });
    expect('swim' in counts).toBe(false);
  });
});
