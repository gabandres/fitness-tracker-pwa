import { unitSwitchInline } from '@/components/train/train-shared';

// UX_AUDIT S24-14 (2026-11-19): the kg | lb switch sat on every weight card and
// saved the lift's unit on a stray tap. It stays on the card only for a lift
// that uses it; everywhere else it is a row in the card's ⋯ menu.
describe('unitSwitchInline', () => {
  it('is off for a lift that has never used another unit', () => {
    expect(unitSwitchInline({}, undefined)).toBe(false);
    expect(unitSwitchInline({ awayGym: '' }, {})).toBe(false);
    expect(unitSwitchInline({ awayGym: null }, null)).toBe(false);
  });

  it('is on for a row already in a unit of its own', () => {
    expect(unitSwitchInline({ loadUnit: 'kg' }, undefined)).toBe(true);
  });

  it('is on at an away gym', () => {
    expect(unitSwitchInline({ awayGym: 'Hotel gym' }, undefined)).toBe(true);
  });

  it('is on when a unit is remembered for some gym, and ignores junk in the map', () => {
    expect(unitSwitchInline({}, { home: 'kg' })).toBe(true);
    expect(unitSwitchInline({}, { home: 'stone' })).toBe(false);
    expect(unitSwitchInline({}, ['kg'])).toBe(false);
  });
});
