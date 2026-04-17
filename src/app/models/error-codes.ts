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
