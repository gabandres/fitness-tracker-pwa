import { shouldAutoOpenTour } from '@/lib/tour';

/**
 * The tour's auto-open decision.
 *
 * Both failure modes here are judgement calls rather than crashes, which is
 * exactly why they are pinned: opening the tour on top of someone mid-task is
 * obnoxious, and never opening it for existing users misses the person who
 * asked for it in the first place.
 */
describe('shouldAutoOpenTour', () => {
  const base = { seen: false, profileCompleted: true, route: 'index' as string | undefined };

  it('opens for a completed user who has not seen it, on the tab root', () => {
    expect(shouldAutoOpenTour(base)).toBe(true);
  });

  it('does NOT open while the seen flag is still loading', () => {
    // The whole point of the tri-state. Guessing false here would skip the
    // tour for the users it exists for; guessing true would flash it at
    // everyone who has already dismissed it.
    expect(shouldAutoOpenTour({ ...base, seen: null })).toBe(false);
  });

  it('does not open once it has been seen or skipped', () => {
    expect(shouldAutoOpenTour({ ...base, seen: true })).toBe(false);
  });

  it('does not interrupt a half-onboarded user', () => {
    // They are already inside a guided flow; two at once is neither.
    expect(shouldAutoOpenTour({ ...base, profileCompleted: false })).toBe(false);
  });

  it.each(['settings', 'scan', 'feedback', 'refine-targets', 'history', 'tour'])(
    'does not hijack /%s',
    (route) => {
      expect(shouldAutoOpenTour({ ...base, route })).toBe(false);
    },
  );

  it('does not open while onboarding\'s first-log sheet holds it', () => {
    // Retention lever 1: the first-log CTA lands on Today with the add sheet
    // open, which is precisely "someone mid-task". The hold is released when
    // that sheet closes, and the tour then offers itself as before.
    expect(shouldAutoOpenTour({ ...base, held: true })).toBe(false);
    expect(shouldAutoOpenTour({ ...base, held: false })).toBe(true);
  });

  it('treats an absent second segment as the tab root', () => {
    // Inside the (app) layout the tab root has no second segment, so the
    // caller passes `segments[1] ?? 'index'`. Guard the contract from here
    // too — a change that starts passing undefined must not silently stop
    // opening the tour for everyone.
    expect(shouldAutoOpenTour({ ...base, route: 'index' })).toBe(true);
  });
});
