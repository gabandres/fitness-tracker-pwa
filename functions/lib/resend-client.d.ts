import { defineSecret } from "firebase-functions/params";
import { Resend } from "resend";
export declare const resendApiKey: ReturnType<typeof defineSecret>;
export declare const FROM_EMAIL: string;
export declare const REPLY_TO = "gabrielandresbermudez@gmail.com";
export declare function getResend(): Resend;
export declare function emailHeaders(): Record<string, string>;
export declare function baseSendOptions(): {
    from: string;
    replyTo: string;
    headers: Record<string, string>;
};
//# sourceMappingURL=resend-client.d.ts.map