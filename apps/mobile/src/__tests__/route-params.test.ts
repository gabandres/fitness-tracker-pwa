import { type ReadyRef, whenNavigationReady } from '@/lib/route-params';

/** A container ref that is not ready until `fireReady()`. */
function fakeRef(ready: boolean) {
  let listener: (() => void) | null = null;
  const ref: ReadyRef & { fireReady(): void; listening(): boolean } = {
    isReady: () => ready,
    addListener: (_type, cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    fireReady() {
      ready = true;
      listener?.();
    },
    listening: () => listener !== null,
  };
  return ref;
}

describe('whenNavigationReady', () => {
  it('runs immediately once the navigator is ready (a warm widget tap)', () => {
    const fn = jest.fn();
    whenNavigationReady(fakeRef(true), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits for `ready` on a cold deep-link start, then runs once and unsubscribes', () => {
    const ref = fakeRef(false);
    const fn = jest.fn();
    whenNavigationReady(ref, fn);
    expect(fn).not.toHaveBeenCalled();
    ref.fireReady();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ref.listening()).toBe(false);
  });
});
