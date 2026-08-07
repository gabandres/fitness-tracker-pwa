import { shouldPromptStoreUpdate } from '@/lib/app-update';

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
