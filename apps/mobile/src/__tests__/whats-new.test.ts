/**
 * When the What's New screen opens by itself.
 *
 * The two ways this goes wrong are both judgement calls worth a test: opening
 * it over someone mid-task (onboarding, the tour, a sub-screen), and showing a
 * fresh install release notes for a release they never saw the "before" of.
 */
import { WHATS_NEW_ITEMS, WHATS_NEW_VERSION, shouldAutoOpenWhatsNew } from '@/lib/whatsNew';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';

const ready = { seen: 'older', profileCompleted: true, route: 'index', tourSeen: true, held: false };

describe('shouldAutoOpenWhatsNew', () => {
  it('opens once for a release the device has not seen', () => {
    expect(shouldAutoOpenWhatsNew(ready)).toBe('open');
    expect(shouldAutoOpenWhatsNew({ ...ready, seen: WHATS_NEW_VERSION })).toBe('none');
  });

  it('never guesses while storage is still loading', () => {
    expect(shouldAutoOpenWhatsNew({ ...ready, seen: undefined })).toBe('none');
    expect(shouldAutoOpenWhatsNew({ ...ready, tourSeen: null })).toBe('none');
  });

  it('a fresh install reads nothing — it is marked seen so the NEXT release is its first', () => {
    // Never stored a seen version AND has not been through the tour: day one.
    expect(shouldAutoOpenWhatsNew({ ...ready, seen: null, tourSeen: false })).toBe('mark');
    // An existing user who simply never dismissed a banner has toured: show.
    expect(shouldAutoOpenWhatsNew({ ...ready, seen: null, tourSeen: true })).toBe('open');
  });

  it('waits behind onboarding, the tour and the first-log sheet', () => {
    expect(shouldAutoOpenWhatsNew({ ...ready, profileCompleted: false })).toBe('none');
    expect(shouldAutoOpenWhatsNew({ ...ready, tourSeen: false })).toBe('none');
    expect(shouldAutoOpenWhatsNew({ ...ready, held: true })).toBe('none');
  });

  it('only opens from the tab root, never over a sub-screen', () => {
    expect(shouldAutoOpenWhatsNew({ ...ready, route: 'settings' })).toBe('none');
    expect(shouldAutoOpenWhatsNew({ ...ready, route: 'scan' })).toBe('none');
  });
});

describe('the release notes', () => {
  it('have at least one item, each with copy in all three locales', () => {
    expect(WHATS_NEW_ITEMS.length).toBeGreaterThan(0);
    for (const item of WHATS_NEW_ITEMS) {
      for (const dict of [en, esPR, ptBR] as Record<string, string>[]) {
        expect(dict[item.titleKey]).toBeTruthy();
        expect(dict[item.bodyKey]).toBeTruthy();
      }
    }
  });
});
