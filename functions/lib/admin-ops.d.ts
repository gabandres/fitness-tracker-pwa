export declare const listUsers: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    users: {
        uid: string;
        email: string;
        displayName: string;
        emailVerified: boolean;
        disabled: boolean;
        createdAt: string | null;
        lastSignInAt: string | null;
        providers: string[];
        admin: boolean;
        profileCompleted: boolean;
        stripeRole: string | null;
        preferredLocale: string | null;
    }[];
}>, unknown>;
export declare const getPlatformStats: import("firebase-functions/v2/https").CallableFunction<any, Promise<any>, unknown>;
export declare const getRecentActivity: import("firebase-functions/v2/https").CallableFunction<any, Promise<any>, unknown>;
export declare const getAuditLogs: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    logs: {
        timestamp: string | null;
        id: string;
    }[];
    hasMore: boolean;
}>, unknown>;
export declare const adminSuspendUser: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    targetUid: string;
    disabled: boolean;
}>, unknown>;
export declare const adminDeleteUser: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const adminResetPassword: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    link: string;
}>, unknown>;
export declare const adminOverridePlan: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    targetUid: string;
    role: string | null;
}>, unknown>;
export declare const adminSetCompedEmail: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    emails: string[];
}>, unknown>;
export declare const adminListCompedEmails: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    emails: string[];
}>, unknown>;
export declare const adminResetQuotas: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const adminExportData: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    csv: string;
}>, unknown>;
export declare const adminGetUserDetails: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    user: {
        uid: string;
        email: string;
        displayName: string;
        emailVerified: boolean;
        disabled: boolean;
        createdAt: string | null;
        lastSignInAt: string | null;
        providers: string[];
        admin: boolean;
        stripeRole: string | null;
    };
    profile: Record<string, unknown> | null;
    counts: {
        dailyLogs: number;
        presets: number;
        reports: number;
        measurements: number;
    };
    subscriptions: {
        id: string;
        status: string;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
    }[];
}>, unknown>;
//# sourceMappingURL=admin-ops.d.ts.map