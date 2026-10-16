import { describe, expect, it } from 'vitest';
import { isAboveZone2, zone2Summary, type CardioBlock } from './cardio';

const z2 = (avgHr?: number, label = 'Zone 2'): CardioBlock => ({ modality: 'walk', label, durationSec: 1200, source: 'manual', ...(avgHr != null ? { avgHr } : {}) }) as CardioBlock;
const s = (d: number, cardio: CardioBlock[], status = 'completed') => ({ status, date: new Date(2026, 9, d), cardio });

describe('Zone 2 in band — n of last 6', () => {
  it('counts the last 6 sessions with a Zone 2 HR, newest first; a block with no HR is not counted', () => {
    const sessions = [
      s(1, [z2(125)]), s(2, [z2(131)]), s(3, [z2(128)]), s(4, [z2()]), s(5, [z2(137)]),
      s(6, [z2(122)]), s(7, [z2(127)]), s(8, [z2(119)]), s(9, [{ ...z2(140), label: 'Run' } as CardioBlock]),
    ];
    const out = zone2Summary(sessions);
    expect(out.band).toEqual({ min: 120, max: 130 });
    expect(out.sessions.map((x) => [x.date.getDate(), x.avgHr, x.inBand])).toEqual([
      [8, 119, false], [7, 127, true], [6, 122, true], [5, 137, false], [3, 128, true], [2, 131, false],
    ]);
    expect(out.inBand).toBe(3);
  });

  it('an active session is not counted; nothing logged is 0 of 0', () => {
    expect(zone2Summary([s(1, [z2(125)], 'active')]).sessions).toEqual([]);
    expect(zone2Summary([])).toMatchObject({ inBand: 0, sessions: [] });
  });

  it('above Zone 2 is over the band\'s top only', () => {
    expect(isAboveZone2(z2(131))).toBe(true);
    expect(isAboveZone2(z2(130))).toBe(false);
    expect(isAboveZone2(z2(110))).toBe(false);
    expect(isAboveZone2(z2())).toBe(false);
    expect(isAboveZone2({ ...z2(150), label: 'Run' } as CardioBlock)).toBe(false);
  });
});
