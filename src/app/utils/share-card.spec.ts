import { shareStatItems } from './share-card';

describe('shareStatItems', () => {
  it('always includes streak and days', () => {
    const items = shareStatItems({ streak: 12, loggedDays: 47, weightDeltaLb: null });
    expect(items.map((i) => i.kind)).toEqual(['streak', 'days']);
    expect(items[0].value).toBe('12');
    expect(items[1].value).toBe('47');
  });

  it('adds a "lost" tile with an unsigned value for a positive delta', () => {
    const items = shareStatItems({ streak: 5, loggedDays: 20, weightDeltaLb: 6.3 });
    const w = items.find((i) => i.kind === 'lost' || i.kind === 'gained')!;
    expect(w.kind).toBe('lost');
    expect(w.value).toBe('6.3 lb'); // unsigned — direction is in the kind
  });

  it('adds a "gained" tile for a negative delta', () => {
    const items = shareStatItems({ streak: 5, loggedDays: 20, weightDeltaLb: -2.0 });
    const w = items.find((i) => i.kind === 'gained')!;
    expect(w.kind).toBe('gained');
    expect(w.value).toBe('2.0 lb');
  });

  it('omits the weight tile when the move is below the noise floor', () => {
    expect(shareStatItems({ streak: 5, loggedDays: 20, weightDeltaLb: 0.05 })).toHaveLength(2);
    expect(shareStatItems({ streak: 5, loggedDays: 20, weightDeltaLb: 0 })).toHaveLength(2);
  });

  it('formats large counts with separators', () => {
    const items = shareStatItems({ streak: 1000, loggedDays: 1234, weightDeltaLb: null });
    expect(items[0].value).toBe((1000).toLocaleString());
    expect(items[1].value).toBe((1234).toLocaleString());
  });
});
