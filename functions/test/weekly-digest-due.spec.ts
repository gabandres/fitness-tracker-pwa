import { describe, expect, it } from "vitest";
import { digestOffsetRanges, isSundayLocalHour } from "../src/weekly-digest";

// The hourly digest now queries only the offsets that are due. The range
// maths must agree EXACTLY with the per-user check it pre-filters for —
// a missed offset is a user who silently never gets their recap.
function covered(ranges: Array<{ min: number; max: number }>, off: number): boolean {
  return ranges.some((r) => r.min <= off && off <= r.max);
}

describe("digestOffsetRanges", () => {
  it("matches isSundayLocalHour for every integer offset, across a whole week", () => {
    const start = Date.UTC(2026, 9, 10, 0, 7, 13); // a Saturday, off the hour
    for (let h = 0; h < 7 * 24 + 3; h++) {
      const now = start + h * 3_600_000 + (h % 5) * 600_000;
      const ranges = digestOffsetRanges(now);
      for (let off = -840; off <= 720; off++) {
        expect(covered(ranges, off), `now=${new Date(now).toISOString()} off=${off}`)
          .toBe(isSundayLocalHour(off, now));
      }
    }
  });

  it("is empty on most hours of the week — zero reads", () => {
    const start = Date.UTC(2026, 9, 12, 0, 0, 0); // Monday
    let empty = 0;
    for (let h = 0; h < 168; h++) if (digestOffsetRanges(start + h * 3_600_000).length === 0) empty++;
    expect(empty).toBeGreaterThan(130);
  });

  it("covers Puerto Rico's Sunday 10:00", () => {
    expect(covered(digestOffsetRanges(Date.UTC(2026, 7, 16, 14, 30)), 240)).toBe(true);
  });
});
