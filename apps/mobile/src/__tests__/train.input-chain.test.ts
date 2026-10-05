import { chainOrder } from '@/components/train/input-chain';

/**
 * The keyboard's ‹ › / Next walk the live session's number fields weight →
 * reps → next row (Train review item 6). The order is derived from the
 * session on demand; only open cards contribute, because a collapsed card
 * renders no inputs.
 */
describe('chainOrder', () => {
  const ex = (logStyle: string, n: number) => ({ logStyle, sets: Array.from({ length: n }) });

  it('walks weight then reps, row by row, through the open card only', () => {
    const order = chainOrder([ex('weight-reps', 2), ex('weight-reps', 3)], (i) => i === 0);
    expect(order.map((s) => `${s.exerciseIndex}:${s.setIndex}:${s.field}`)).toEqual([
      '0:0:weight', '0:0:count', '0:1:weight', '0:1:count',
    ]);
  });

  it('a bodyweight or timed lift has no weight field to stop on', () => {
    const order = chainOrder([ex('bodyweight', 2), ex('time', 1)], () => true);
    expect(order.map((s) => `${s.exerciseIndex}:${s.setIndex}:${s.field}`)).toEqual([
      '0:0:count', '0:1:count', '1:0:count',
    ]);
  });
});
