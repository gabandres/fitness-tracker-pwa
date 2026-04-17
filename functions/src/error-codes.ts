/**
 * Typed error codes returned by onCall Cloud Functions via the `details`
 * field of HttpsError. The English `message` argument stays for server
 * logs; clients translate the code via their own error-code twin.
 *
 * Keep in sync with src/app/models/error-codes.ts (client twin). There
 * is no shared package between the two projects, so duplication is
 * intentional — it's the cheapest path to type-safe codes on both sides.
 */
export const enum ErrorCode {
  UNAUTHENTICATED = "UNAUTHENTICATED",
  PHOTO_QUOTA_EXCEEDED = "PHOTO_QUOTA_EXCEEDED",
  PHOTO_MISSING = "PHOTO_MISSING",
  PHOTO_TOO_LARGE = "PHOTO_TOO_LARGE",
  PHOTO_ESTIMATE_FAILED = "PHOTO_ESTIMATE_FAILED",
  PHOTO_ANALYZE_FAILED = "PHOTO_ANALYZE_FAILED",
  CONSULTATION_QUOTA_EXCEEDED = "CONSULTATION_QUOTA_EXCEEDED",
  ACCOUNT_DELETE_FAILED = "ACCOUNT_DELETE_FAILED",
  REPORT_NOT_ENTITLED = "REPORT_NOT_ENTITLED",
  REPORT_TOO_SOON = "REPORT_TOO_SOON",
  REPORT_PAYLOAD_INVALID = "REPORT_PAYLOAD_INVALID",
  REPORT_GENERATE_FAILED = "REPORT_GENERATE_FAILED",
  PHOTO_RATE_LIMITED = "PHOTO_RATE_LIMITED",
  CONSULTATION_RATE_LIMITED = "CONSULTATION_RATE_LIMITED",
}
