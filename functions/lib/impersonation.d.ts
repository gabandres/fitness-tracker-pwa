/**
 * Admin signs in as another user. Returns a Firebase custom token the
 * client uses with signInWithCustomToken. The target's existing session
 * (if any) is unaffected — they'd need to re-auth on their own device.
 */
export declare const startImpersonation: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    customToken: string;
    targetUser: {
        uid: string;
        email: string;
        displayName: string;
    };
}>, unknown>;
/**
 * Returns the admin to their own account. Requires the client to hand
 * over the original admin uid (which the client captured before the
 * impersonation swap). Verified against the custom-claims admin flag.
 */
export declare const stopImpersonation: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    customToken: string;
}>, unknown>;
//# sourceMappingURL=impersonation.d.ts.map