import { Timestamp } from 'firebase/firestore';
import { toDomainProfile, toDomainProfilePatch } from './profile-mapper';
import type { UserProfileDoc } from '../../services/firebase.service';

/**
 * Pure tests for the single Timestamp -> Date conversion point. This is the
 * logic the Firestore adapter leans on to keep `Timestamp` from crossing the
 * ledger seam — so it is the highest-value thing to pin without an emulator.
 */
describe('profile-mapper', () => {
  const created = new Date('2026-01-02T03:04:05Z');
  const seen = new Date('2026-05-06T07:08:09Z');

  function baseDoc(overrides: Partial<UserProfileDoc> = {}): UserProfileDoc {
    return {
      email: 'a@example.com',
      createdAt: Timestamp.fromDate(created),
      lastSeenAt: Timestamp.fromDate(seen),
      profileCompleted: true,
      ...overrides,
    } as UserProfileDoc;
  }

  describe('toDomainProfile', () => {
    it('converts required Timestamp dates to Date', () => {
      const p = toDomainProfile(baseDoc());
      expect(p.createdAt).toBeInstanceOf(Date);
      expect(p.lastSeenAt).toBeInstanceOf(Date);
      expect(p.createdAt.getTime()).toBe(created.getTime());
      expect(p.lastSeenAt.getTime()).toBe(seen.getTime());
    });

    it('passes non-date fields through untouched', () => {
      const p = toDomainProfile(baseDoc({ heightIn: 70, profileCompleted: true }));
      expect(p.email).toBe('a@example.com');
      expect(p.heightIn).toBe(70);
      expect(p.profileCompleted).toBe(true);
    });

    it('converts every optional date field when present', () => {
      const d = new Date('2026-03-03T00:00:00Z');
      const p = toDomainProfile(
        baseDoc({
          ageConfirmedAt: Timestamp.fromDate(d),
          onboardingV2CompletedAt: Timestamp.fromDate(d),
          targetsRefinedAt: Timestamp.fromDate(d),
          compedUntil: Timestamp.fromDate(d),
          referralRewardGrantedAt: Timestamp.fromDate(d),
          welcomeEmailSentAt: Timestamp.fromDate(d),
          lastWeeklyDigestSentAt: Timestamp.fromDate(d),
          fastStartedAt: Timestamp.fromDate(d),
        }),
      );
      for (const v of [
        p.ageConfirmedAt,
        p.onboardingV2CompletedAt,
        p.targetsRefinedAt,
        p.compedUntil,
        p.referralRewardGrantedAt,
        p.welcomeEmailSentAt,
        p.lastWeeklyDigestSentAt,
        p.fastStartedAt,
      ]) {
        expect(v).toBeInstanceOf(Date);
      }
    });

    it('leaves a null fastStartedAt as null and absent fields absent', () => {
      const p = toDomainProfile(baseDoc({ fastStartedAt: null }));
      expect(p.fastStartedAt).toBeNull();
      expect('ageConfirmedAt' in p).toBe(false);
    });

    it('lets no Timestamp method leak onto the domain object', () => {
      const p = toDomainProfile(baseDoc({ compedUntil: Timestamp.fromDate(created) }));
      expect((p.createdAt as unknown as { toMillis?: unknown }).toMillis).toBeUndefined();
      expect((p.compedUntil as unknown as { toDate?: unknown }).toDate).toBeUndefined();
    });

    it('is idempotent — a field already a Date is left alone', () => {
      const already = { ...baseDoc(), createdAt: created } as unknown as UserProfileDoc;
      const p = toDomainProfile(already);
      expect(p.createdAt).toBeInstanceOf(Date);
      expect(p.createdAt.getTime()).toBe(created.getTime());
    });
  });

  describe('toDomainProfilePatch', () => {
    it('converts present date fields and keeps it partial', () => {
      const patch = toDomainProfilePatch({
        lastSeenAt: Timestamp.fromDate(seen),
        targetsRefinedAt: Timestamp.fromDate(created),
        heightIn: 68,
      });
      expect(patch.lastSeenAt).toBeInstanceOf(Date);
      expect(patch.targetsRefinedAt).toBeInstanceOf(Date);
      expect(patch.heightIn).toBe(68);
      expect('createdAt' in patch).toBe(false);
    });
  });
});
