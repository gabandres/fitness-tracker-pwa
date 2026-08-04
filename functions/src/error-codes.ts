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
  BAD_REQUEST = "BAD_REQUEST",
  PHOTO_QUOTA_EXCEEDED = "PHOTO_QUOTA_EXCEEDED",
  PHOTO_MISSING = "PHOTO_MISSING",
  PHOTO_TOO_LARGE = "PHOTO_TOO_LARGE",
  PHOTO_ESTIMATE_FAILED = "PHOTO_ESTIMATE_FAILED",
  PHOTO_ANALYZE_FAILED = "PHOTO_ANALYZE_FAILED",
  /** Caller is on the free tier and photo-scan is paid-only. Distinct from
      PHOTO_QUOTA_EXCEEDED: that one means "come back tomorrow", this one
      means "this is not your tier". Mirrors REPORT_NOT_ENTITLED. */
  PHOTO_NOT_ENTITLED = "PHOTO_NOT_ENTITLED",
  CONSULTATION_QUOTA_EXCEEDED = "CONSULTATION_QUOTA_EXCEEDED",
  ACCOUNT_DELETE_FAILED = "ACCOUNT_DELETE_FAILED",
  REPORT_NOT_ENTITLED = "REPORT_NOT_ENTITLED",
  REPORT_TOO_SOON = "REPORT_TOO_SOON",
  REPORT_PAYLOAD_INVALID = "REPORT_PAYLOAD_INVALID",
  REPORT_GENERATE_FAILED = "REPORT_GENERATE_FAILED",
  PHOTO_RATE_LIMITED = "PHOTO_RATE_LIMITED",
  CONSULTATION_RATE_LIMITED = "CONSULTATION_RATE_LIMITED",
  RATE_LIMITED = "RATE_LIMITED",
  // Food database (USDA FDC proxy).
  FOOD_API_NOT_CONFIGURED = "FOOD_API_NOT_CONFIGURED",
  FOOD_QUERY_INVALID = "FOOD_QUERY_INVALID",
  FOOD_SEARCH_FAILED = "FOOD_SEARCH_FAILED",
  FOOD_DETAIL_FAILED = "FOOD_DETAIL_FAILED",
  FOOD_NOT_FOUND = "FOOD_NOT_FOUND",
  FOOD_NO_NUTRITION = "FOOD_NO_NUTRITION",
  // Recipe-URL import (fetch proxy).
  RECIPE_URL_INVALID = "RECIPE_URL_INVALID",
  RECIPE_FETCH_FAILED = "RECIPE_FETCH_FAILED",
  RECIPE_NOT_FOUND = "RECIPE_NOT_FOUND",
  // Org-wide spend guard (spend-ceiling.ts). Distinct from the *_QUOTA_EXCEEDED
  // codes above: those mean "you have used your allowance", these mean "the
  // feature is off for everybody". Clients must not tell the user to come back
  // tomorrow or to upgrade — neither would help.
  /** An admin threw the kill-switch. Sticky until a human clears it. */
  FEATURE_DISABLED = "FEATURE_DISABLED",
  /** Today's org-wide ceiling is spent. Clears at UTC midnight. */
  SERVICE_CEILING_REACHED = "SERVICE_CEILING_REACHED",
}
