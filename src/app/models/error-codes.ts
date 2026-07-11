/**
 * Typed error codes returned by onCall Cloud Functions in the `details`
 * field of an HttpsError. Client passes the code through
 * TranslationService.tError(code, params) to render a localized message.
 *
 * Keep in sync with functions/src/error-codes.ts (server twin).
 */
export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PHOTO_QUOTA_EXCEEDED: 'PHOTO_QUOTA_EXCEEDED',
  PHOTO_MISSING: 'PHOTO_MISSING',
  PHOTO_TOO_LARGE: 'PHOTO_TOO_LARGE',
  PHOTO_ESTIMATE_FAILED: 'PHOTO_ESTIMATE_FAILED',
  PHOTO_ANALYZE_FAILED: 'PHOTO_ANALYZE_FAILED',
  CONSULTATION_QUOTA_EXCEEDED: 'CONSULTATION_QUOTA_EXCEEDED',
  ACCOUNT_DELETE_FAILED: 'ACCOUNT_DELETE_FAILED',
  REPORT_NOT_ENTITLED: 'REPORT_NOT_ENTITLED',
  REPORT_TOO_SOON: 'REPORT_TOO_SOON',
  REPORT_PAYLOAD_INVALID: 'REPORT_PAYLOAD_INVALID',
  REPORT_GENERATE_FAILED: 'REPORT_GENERATE_FAILED',
  PHOTO_RATE_LIMITED: 'PHOTO_RATE_LIMITED',
  CONSULTATION_RATE_LIMITED: 'CONSULTATION_RATE_LIMITED',
  RATE_LIMITED: 'RATE_LIMITED',
  FOOD_API_NOT_CONFIGURED: 'FOOD_API_NOT_CONFIGURED',
  FOOD_QUERY_INVALID: 'FOOD_QUERY_INVALID',
  FOOD_SEARCH_FAILED: 'FOOD_SEARCH_FAILED',
  FOOD_DETAIL_FAILED: 'FOOD_DETAIL_FAILED',
  FOOD_NOT_FOUND: 'FOOD_NOT_FOUND',
  FOOD_NO_NUTRITION: 'FOOD_NO_NUTRITION',
  RECIPE_URL_INVALID: 'RECIPE_URL_INVALID',
  RECIPE_FETCH_FAILED: 'RECIPE_FETCH_FAILED',
  RECIPE_NOT_FOUND: 'RECIPE_NOT_FOUND',
} as const;

export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Extract the typed error code from an HttpsError-shaped failure. Returns
 * undefined when the error didn't originate from our Cloud Functions.
 */
export function extractErrorCode(err: unknown): string | undefined {
  const details = (err as { details?: unknown })?.details;
  if (details && typeof details === 'object' && 'code' in details) {
    const code = (details as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
