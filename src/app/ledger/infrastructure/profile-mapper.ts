import {
  toDomainProfile as coreToDomainProfile,
  toDomainProfilePatch as coreToDomainProfilePatch,
} from '@macrolog/core';
import type { Profile, UserProfileDoc } from '../../services/firebase.service';

/**
 * The single Timestamp -> Date conversion point on the profile read path.
 *
 * The mapping logic now lives in `@macrolog/core` (`firestore-mappers.ts`) so
 * the Angular PWA and the Expo app share ONE implementation. This file is a
 * thin, typed adapter: it pins the web's stored-doc type (`UserProfileDoc`,
 * which owns the `Timestamp` import) onto the core mapper's structural input,
 * so every existing importer (`firebase.service`, the contract suite) keeps its
 * exact types. See `CONTEXT.md` -> "Date type at the seam".
 */

/** Convert a stored {@link UserProfileDoc} (Timestamp dates) into a domain
 *  {@link Profile} (Date dates). */
export function toDomainProfile(doc: UserProfileDoc): Profile {
  return coreToDomainProfile(doc as unknown as Record<string, unknown>) as Profile;
}

/** Same conversion for a partial write patch. */
export function toDomainProfilePatch(patch: Partial<UserProfileDoc>): Partial<Profile> {
  return coreToDomainProfilePatch(patch as Record<string, unknown>);
}
