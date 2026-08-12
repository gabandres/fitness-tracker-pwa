import { describe, expect, it } from 'vitest';
import {
  USAGE_COUNT_MAX,
  USAGE_EVENTS,
  addUsageCount,
  clampUsageCounts,
  hasUsageCounts,
  usageDocId,
} from './usage-events';

describe('usageDocId', () => {
  it('puts the uid first, so the rules can authorize on the prefix', () => {
    expect(usageDocId('abc123', '2026-08-12')).toBe('abc123_2026-08-12');
    expect(usageDocId('abc123', '2026-08-12').split('_')[0]).toBe('abc123');
  });
});

describe('addUsageCount', () => {
  it('accumulates without mutating the batch it was handed', () => {
    const first = addUsageCount({}, 'log_added');
    const second = addUsageCount(first, 'log_added');

    expect(first).toEqual({ log_added: 1 });
    expect(second).toEqual({ log_added: 2 });
  });

  it('keeps events apart', () => {
    const counts = addUsageCount(addUsageCount({}, 'app_open'), 'coach_ask', 3);
    expect(counts).toEqual({ app_open: 1, coach_ask: 3 });
  });
});

describe('hasUsageCounts', () => {
  it('is false for an empty batch — a background cycle should not write', () => {
    expect(hasUsageCounts({})).toBe(false);
    expect(hasUsageCounts({ app_open: 1 })).toBe(true);
  });
});

describe('clampUsageCounts', () => {
  it('caps a runaway counter instead of losing the whole document', () => {
    expect(clampUsageCounts({ log_added: 999_999 })).toEqual({ log_added: USAGE_COUNT_MAX });
  });

  it('drops values that are never a measurement', () => {
    // increment(NaN) corrupts the stored total rather than failing loudly.
    expect(clampUsageCounts({ log_added: Number.NaN })).toEqual({});
    expect(clampUsageCounts({ log_added: -5 })).toEqual({});
    expect(clampUsageCounts({ log_added: 0 })).toEqual({});
    expect(clampUsageCounts({ log_added: Number.POSITIVE_INFINITY })).toEqual({});
  });

  it('rounds, so a fractional count cannot reach an int-typed rule', () => {
    expect(clampUsageCounts({ log_added: 2.6 })).toEqual({ log_added: 3 });
  });

  it('passes through only names in the catalogue', () => {
    const dirty = { log_added: 1, meal_photo_contents: 1 } as never;
    expect(clampUsageCounts(dirty)).toEqual({ log_added: 1 });
  });
});

describe('the catalogue itself', () => {
  it('has no duplicates — a repeat would silently double-count', () => {
    expect(new Set(USAGE_EVENTS).size).toBe(USAGE_EVENTS.length);
  });

  it('is a legal Firestore field name in every entry', () => {
    // Written as top-level fields, so anything needing backticks or holding a
    // dot would be a nested path rather than a counter.
    for (const event of USAGE_EVENTS) {
      expect(event).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('records no content — only names that describe an action', () => {
    // The privacy promise is structural, not editorial: if a name here ever
    // implies a payload, the shape has stopped being counters.
    for (const event of USAGE_EVENTS) {
      expect(event).not.toMatch(/name|label|text|photo_data|content|value/);
    }
  });
});
