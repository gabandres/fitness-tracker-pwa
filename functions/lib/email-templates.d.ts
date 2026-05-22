export interface WelcomeEmailParams {
    locale: "en" | "es-PR";
    displayName?: string | null;
}
export declare function welcomeEmail(params: WelcomeEmailParams): {
    subject: string;
    html: string;
};
export interface WeeklyDigestParams {
    locale: "en" | "es-PR";
    displayName?: string | null;
    avgCalories: number | null;
    avgProtein: number | null;
    weightDeltaLbs: number | null;
    daysLogged: number;
    streak: number;
}
export declare function weeklyDigestEmail(params: WeeklyDigestParams): {
    subject: string;
    html: string;
};
//# sourceMappingURL=email-templates.d.ts.map