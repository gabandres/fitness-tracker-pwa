import { encodeEntryPrefill, parseEntryPrefill } from '@/lib/entry-prefill';

// The draft that a scan-screen repeat hands to Today's add sheet (ADR-0029,
// settled 2026-09-08: a repeat lands on an editable draft, never logs silently).

describe('entry-prefill', () => {
  it('round-trips a full draft', () => {
    const p = { calories: 330, protein: 52, carbs: 2, fat: 12, mealLabel: 'Grilled chicken steak' };
    expect(parseEntryPrefill(encodeEntryPrefill(p))).toEqual(p);
  });

  it('keeps only the fields that are present and numeric', () => {
    expect(parseEntryPrefill(JSON.stringify({ calories: 200, protein: 'x', mealLabel: '  ' }))).toEqual({ calories: 200 });
  });

  it('rejects garbage, missing calories and negatives', () => {
    expect(parseEntryPrefill(undefined)).toBeNull();
    expect(parseEntryPrefill('')).toBeNull();
    expect(parseEntryPrefill('{not json')).toBeNull();
    expect(parseEntryPrefill(JSON.stringify({ protein: 10 }))).toBeNull();
    expect(parseEntryPrefill(JSON.stringify({ calories: -5 }))).toBeNull();
    expect(parseEntryPrefill(JSON.stringify([1, 2]))).toBeNull();
  });

  it('caps the label at 100 characters (the rules ceiling)', () => {
    const long = 'a'.repeat(140);
    expect(parseEntryPrefill(JSON.stringify({ calories: 1, mealLabel: long }))?.mealLabel).toHaveLength(100);
  });
});
