import { reloadScreenOptions, shouldAutoApplyOta, shouldPromptStoreUpdate } from '@/lib/app-update';
import { palettes } from '@/theme';

// The store-update banner is the half that cannot resolve itself: it sends the
// user out of the app, so a wrong answer in either direction is expensive. A
// false positive points them at a store page with nothing to install; a false
// negative is precisely the failure this feature exists to fix (a tester sat on
// an old versionCode until they were told to update by hand).

describe('shouldPromptStoreUpdate', () => {
  it('prompts when a newer build is published', () => {
    expect(shouldPromptStoreUpdate(10, 11, null)).toBe(true);
  });

  it('stays silent when the installed build is current', () => {
    expect(shouldPromptStoreUpdate(11, 11, null)).toBe(false);
  });

  it('stays silent when the installed build is ahead of the manifest', () => {
    // Happens on every internal/local build, and between shipping a binary and
    // remembering to bump app-version.json. Must not nag the one person who is
    // by definition already up to date.
    expect(shouldPromptStoreUpdate(12, 11, null)).toBe(false);
  });

  it('stays silent in Expo Go / dev, where the build number is unknown', () => {
    expect(shouldPromptStoreUpdate(null, 11, null)).toBe(false);
  });

  it('stays silent when the manifest never arrived', () => {
    // Offline or a failed fetch. Silence is the only honest answer.
    expect(shouldPromptStoreUpdate(10, null, null)).toBe(false);
  });

  it('respects a dismissal of the same build', () => {
    expect(shouldPromptStoreUpdate(10, 11, 11)).toBe(false);
  });

  it('re-prompts when a build NEWER than the dismissed one ships', () => {
    // The regression that makes dismissal safe: one dismissal must not silence
    // the banner permanently.
    expect(shouldPromptStoreUpdate(10, 12, 11)).toBe(true);
  });

  it('ignores a stale dismissal older than the current build', () => {
    expect(shouldPromptStoreUpdate(11, 12, 9)).toBe(true);
  });
});

// Auto-applying an OTA is the one update path with no user in the loop, so
// both ways it can hurt are pinned here: reloading at the wrong moment throws
// away what they were typing, and re-applying a bundle that failed to launch
// fights expo-updates' own fallback in a loop that leaves the app unusable.

describe('shouldAutoApplyOta', () => {
  const base = {
    isUpdatePending: true,
    targetUpdateId: 'abc',
    failedUpdateId: null as string | null,
    moment: 'mount' as 'mount' | 'foreground',
    pendingAtMount: true,
  };

  it('applies at cold start when the bundle came from an earlier run', () => {
    // The case that removes "restart it twice": no session state exists yet.
    expect(shouldAutoApplyOta(base)).toBe(true);
  });

  it('does NOT apply at mount for a bundle that arrived mid-session', () => {
    // The regression that protects a half-typed entry sheet: isUpdatePending
    // flipping true during a session must not read as a cold start.
    expect(shouldAutoApplyOta({ ...base, pendingAtMount: false })).toBe(false);
  });

  it('applies that same mid-session bundle on the next foreground', () => {
    expect(shouldAutoApplyOta({ ...base, pendingAtMount: false, moment: 'foreground' }))
      .toBe(true);
  });

  it('never re-applies a bundle that failed its own launch', () => {
    // Without this the app is bricked: expo-updates falls back to the previous
    // bundle, we auto-apply the broken one again, and round it goes.
    expect(shouldAutoApplyOta({ ...base, failedUpdateId: 'abc' })).toBe(false);
    expect(shouldAutoApplyOta({ ...base, failedUpdateId: 'abc', moment: 'foreground' }))
      .toBe(false);
  });

  it('still applies a DIFFERENT bundle after an earlier one failed', () => {
    // One bad update must not disable updates forever.
    expect(shouldAutoApplyOta({ ...base, targetUpdateId: 'def', failedUpdateId: 'abc' }))
      .toBe(true);
  });

  it('does nothing when no bundle is waiting', () => {
    expect(shouldAutoApplyOta({ ...base, isUpdatePending: false })).toBe(false);
  });

  it('applies when the target id is unknown but nothing has failed', () => {
    // A rollback UpdateInfo carries no updateId; it is still safe to apply.
    expect(shouldAutoApplyOta({ ...base, targetUpdateId: undefined })).toBe(true);
  });
});

// The restart screen (ADR-0031). It is the only thing a user sees for the
// seconds a `reloadAsync()` process restart takes, and it renders while the JS
// that configured it is already gone — so the options object is the entire
// surface and there is nothing to inspect afterwards.

describe('reloadScreenOptions', () => {
  it('paints the ACTIVE theme, not a fixed colour', () => {
    // ADR-0031 assumed this had to be configured statically because the screen
    // outlives the running app. It does not: the options are an argument to
    // reloadAsync, so a dark-theme user gets a dark restart instead of a white
    // flash. This test is what keeps that true.
    expect(reloadScreenOptions(palettes.dark.colors).backgroundColor)
      .toBe(palettes.dark.colors.paper);
    expect(reloadScreenOptions(palettes.light.colors).backgroundColor)
      .toBe(palettes.light.colors.paper);
    expect(palettes.dark.colors.paper).not.toBe(palettes.light.colors.paper);
  });

  it('always shows something MOVING', () => {
    // The reported defect is that the restart reads as a hang. A still frame —
    // no spinner, or the logo alone — reproduces exactly that, so the spinner
    // is the load-bearing part and not decoration.
    for (const scheme of ['light', 'dark'] as const) {
      expect(reloadScreenOptions(palettes[scheme].colors).spinner?.enabled).toBe(true);
    }
  });

  it('carries no image, so nothing can be laid out at 1024dp', () => {
    // expo-updates resolves a require() id to the asset's PIXEL size and both
    // native reload screens then read width/height as dp. Our splash icon is
    // 1024x1024, which is 3584px on the LG G6. See the note on the function.
    expect(reloadScreenOptions(palettes.dark.colors).image).toBeUndefined();
  });
});
