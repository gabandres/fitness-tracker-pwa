import { renderHook, act } from '@testing-library/react-native';
import { isSplashVisible, setSplashVisible, useSplashVisible } from '@/lib/splash-state';

/**
 * The boot-splash signal the welcome intro keys its choreography on.
 *
 * Pinned: it starts TRUE (a cold start is on the splash — starting false
 * would play the intro's entrance under the loader, to nobody), a hook
 * re-renders on change, and setting the same value twice notifies nobody.
 */
describe('splash-state', () => {
  afterEach(() => setSplashVisible(true));

  it('starts visible — a cold start is on the splash', () => {
    expect(isSplashVisible()).toBe(true);
  });

  it('re-renders subscribers when the overlay lifts and returns', async () => {
    const { result } = await renderHook(() => useSplashVisible());
    expect(result.current).toBe(true);
    await act(async () => setSplashVisible(false));
    expect(result.current).toBe(false);
    await act(async () => setSplashVisible(true));
    expect(result.current).toBe(true);
  });

  it('is idempotent: the same value does not notify', async () => {
    let renders = 0;
    await renderHook(() => {
      renders += 1;
      return useSplashVisible();
    });
    const before = renders;
    await act(async () => setSplashVisible(true));
    expect(renders).toBe(before);
  });
});
