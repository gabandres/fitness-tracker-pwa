/**
 * One-time bootstrap: creates config/admins and sets the admin custom
 * claim on the seed account(s). Only callable by a seed email, only
 * runs if the admins doc does not exist yet.
 */
export declare const bootstrapAdmin: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    seeded: string[];
}>, unknown>;
/**
 * Grant or revoke admin access for a user by email. Caller must already
 * have the admin custom claim. Keeps config/admins and the target user's
 * custom claims in sync.
 */
export declare const setAdminClaims: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    email: string;
    admin: boolean;
    totalAdmins: number;
}>, unknown>;
//# sourceMappingURL=admin-claims.d.ts.map