/**
 * The food index warms in SLICES, one per idle callback — never as one task.
 *
 * The old warm was `requestIdleCallback(warmFoodIndex)` around a single
 * ~250 ms decode (Hermes, Mac; several hundred ms on a mid-range phone). Idle
 * scheduling chose when that task STARTED, not how long it held the JS thread,
 * so a tap in that window stalled. What is pinned here is the shape that fixes
 * it: the work is spread over many callbacks, each bounded, and a search that
 * arrives mid-warm still answers from the whole corpus.
 *
 * Real bundled index, real core — only the idle scheduler is faked, so each
 * callback can be run (and counted) by hand.
 */

type Deadline = { timeRemaining: () => number };
type IdleCb = (d?: Deadline) => void;

let queue: IdleCb[] = [];
const g = globalThis as { requestIdleCallback?: (cb: IdleCb) => number };
const original = g.requestIdleCallback;

beforeEach(() => {
  queue = [];
  g.requestIdleCallback = (cb) => queue.push(cb);
  jest.resetModules();
});

afterAll(() => {
  g.requestIdleCallback = original;
});

// A fresh module per test: the warm state is module-level on purpose.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const load = () => require('@/lib/localFoodSearch') as typeof import('@/lib/localFoodSearch');

/** Run queued idle callbacks until none are left; how many ran. */
function drain(remainingMs: number): number {
  let ran = 0;
  while (queue.length) {
    const cb = queue.shift()!;
    cb({ timeRemaining: () => remainingMs });
    ran++;
    if (ran > 100) throw new Error('warm never finished');
  }
  return ran;
}

describe('warmFoodIndex', () => {
  it('spreads the build over many idle callbacks, at most two 1,000-food slices each', () => {
    const m = load();
    m.warmFoodIndex();
    expect(m.isFoodIndexWarm()).toBe(false);
    // 1 callback to evaluate + wrap the JSON, then 13,272 foods at <= 2,000 a
    // callback = 7. A regression to one big task would read 1 or 2.
    expect(drain(50)).toBe(8);
    expect(m.isFoodIndexWarm()).toBe(true);
  });

  it('takes ONE slice per callback when the idle period is nearly spent', () => {
    const m = load();
    m.warmFoodIndex();
    expect(drain(1)).toBe(1 + 14);
    expect(m.isFoodIndexWarm()).toBe(true);
  });

  it('is a no-op while a warm is under way, and after it is done', () => {
    const m = load();
    m.warmFoodIndex();
    m.warmFoodIndex(); // FoodSearch mounting while Today's warm runs
    expect(queue).toHaveLength(1);
    drain(50);
    m.warmFoodIndex();
    expect(queue).toHaveLength(0);
  });

  it('lets a search arrive mid-warm and answers from the WHOLE corpus', () => {
    const m = load();
    m.warmFoodIndex();
    // Load + one slice: 1,000 of 13,272 foods indexed.
    queue.shift()!({ timeRemaining: () => 1 });
    queue.shift()!({ timeRemaining: () => 1 });
    expect(m.isFoodIndexWarm()).toBe(false);
    const midWarm = m.localSearch('zucchini', 20).map((h) => h.id);

    jest.resetModules();
    queue = [];
    const cold = load();
    const full = cold.localSearch('zucchini', 20).map((h) => h.id);
    expect(midWarm.length).toBeGreaterThan(0);
    expect(midWarm).toEqual(full);
  });
});
