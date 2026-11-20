import { unitSwitchInline } from '@/components/train/train-shared';

// UX_AUDIT S24-14 (2026-11-19): the kg | lb switch sat on every weight card and
// saved the lift's unit on a stray tap. It stays on the card only for a lift
// that uses it; everywhere else it is a row in the card's ⋯ menu.
describe('unitSwitchInline', () => {
  it('is off for a lift that has never used another unit', () => {
    expect(unitSwitchInline({}, undefined, 'lb')).toBe(false);
    expect(unitSwitchInline({ awayGym: '' }, {}, 'lb')).toBe(false);
    expect(unitSwitchInline({ awayGym: null }, null, 'kg')).toBe(false);
  });

  // Every row is stamped with a unit when the workout starts; found in the
  // browser check — the first version read any stamp as "uses the switch".
  it('is off for a row stamped with the account\'s own unit', () => {
    expect(unitSwitchInline({ loadUnit: 'lb' }, undefined, 'lb')).toBe(false);
    expect(unitSwitchInline({ loadUnit: 'kg' }, undefined, 'kg')).toBe(false);
  });

  it('is on for a row in another unit', () => {
    expect(unitSwitchInline({ loadUnit: 'kg' }, undefined, 'lb')).toBe(true);
    expect(unitSwitchInline({ loadUnit: 'lb' }, undefined, 'kg')).toBe(true);
  });

  it('is on at an away gym', () => {
    expect(unitSwitchInline({ awayGym: 'Hotel gym' }, undefined, 'lb')).toBe(true);
  });

  it('is on when a unit is remembered for some gym, and ignores junk in the map', () => {
    expect(unitSwitchInline({}, { home: 'kg' }, 'lb')).toBe(true);
    expect(unitSwitchInline({}, { home: 'stone' }, 'lb')).toBe(false);
    expect(unitSwitchInline({}, ['kg'], 'lb')).toBe(false);
  });
});
