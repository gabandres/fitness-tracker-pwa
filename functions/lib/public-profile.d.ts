/**
 * Atomically claim or change a public profile slug. Validates format,
 * blocks reserved words, and uses a Firestore transaction so two users
 * can't claim the same slug. On success, writes the slug + display name
 * to the user's profile; the `onUserUpdateMirrorPublicProfile` trigger
 * builds the public mirror.
 *
 * Releases the previous slug (if any) atomically inside the same
 * transaction so a slug change doesn't leave the old one orphaned.
 */
export declare const claimPublicSlug: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    slug: string;
}>, unknown>;
/**
 * Disable the public profile + release the slug. Idempotent.
 */
export declare const releasePublicSlug: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    released: boolean;
    slug?: undefined;
} | {
    released: boolean;
    slug: string | null;
}>, unknown>;
export declare const onUserUpdateMirrorPublicProfile: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    uid: string;
}>>;
export declare const onDailyWeightWriteMirrorPublicProfile: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    uid: string;
    dateKey: string;
}>>;
//# sourceMappingURL=public-profile.d.ts.map