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
  /** The per-user daily quota on report generation (1/day, every tier).
      Distinct from REPORT_TOO_SOON, which is the 6-day cadence read off the
      user's own reports; this one is the cost guard, and it holds even when
      the newest report doc has been deleted. */
  REPORT_QUOTA_EXCEEDED = "REPORT_QUOTA_EXCEEDED",
  REPORT_PAYLOAD_INVALID = "REPORT_PAYLOAD_INVALID",
  /** The request used a wire shape the server no longer serves (the pre-v2
      `{ systemInstruction, prompt }` body of the coach and weekly report, once
      `ACCEPT_LEGACY_PROMPT_SHAPE` is false). Updating the app is the fix. */
  CLIENT_UPDATE_REQUIRED = "CLIENT_UPDATE_REQUIRED",
  REPORT_GENERATE_FAILED = "REPORT_GENERATE_FAILED",
  PHOTO_RATE_LIMITED = "PHOTO_RATE_LIMITED",
  CONSULTATION_RATE_LIMITED = "CONSULTATION_RATE_LIMITED",
  RATE_LIMITED = "RATE_LIMITED",
  VERIFY_EMAIL_FAILED = "VERIFY_EMAIL_FAILED",
  // Food database (USDA FDC proxy).
  FOOD_API_NOT_CONFIGURED = "FOOD_API_NOT_CONFIGURED",
  FOOD_QUERY_INVALID = "FOOD_QUERY_INVALID",
  FOOD_SEARCH_FAILED = "FOOD_SEARCH_FAILED",
  FOOD_DETAIL_FAILED = "FOOD_DETAIL_FAILED",
  FOOD_NOT_FOUND = "FOOD_NOT_FOUND",
  FOOD_NO_NUTRITION = "FOOD_NO_NUTRITION",
  // Oura account linking (completeOuraLink, oura-link.ts).
  /** The state is forged, older than 15 minutes, superseded by a newer
      Connect tap, or already redeemed. The user taps Connect again. */
  OURA_LINK_EXPIRED = "OURA_LINK_EXPIRED",
  /** The state was minted for a different Ignia account than the caller's —
      the cross-account CSRF the callable exists to refuse. */
  OURA_LINK_WRONG_ACCOUNT = "OURA_LINK_WRONG_ACCOUNT",
  /** Oura's token endpoint refused or was unreachable. Nothing was stored. */
  OURA_LINK_FAILED = "OURA_LINK_FAILED",
  // Org-wide spend guard (spend-ceiling.ts). Distinct from the *_QUOTA_EXCEEDED
  // codes above: those mean "you have used your allowance", these mean "the
  // feature is off for everybody". Clients must not tell the user to come back
  // tomorrow or to upgrade — neither would help.
  /** An admin threw the kill-switch. Sticky until a human clears it. */
  FEATURE_DISABLED = "FEATURE_DISABLED",
  /** Today's org-wide ceiling is spent. Clears at UTC midnight. */
  SERVICE_CEILING_REACHED = "SERVICE_CEILING_REACHED",
  /**
   * The AI provider refused us, not the user — a 429 from Gemini itself.
   *
   * Distinct from every code above, and the distinction is the whole point.
   * `PHOTO_QUOTA_EXCEEDED` means "you used your allowance",
   * `SERVICE_CEILING_REACHED` means "we spent today's budget, back at UTC
   * midnight", and `PHOTO_ANALYZE_FAILED` means "the photograph was the
   * problem". This one means none of those: the request never reached a model,
   * and there is no time we can honestly promise it back.
   *
   * It exists because of a five-day outage. From 2026-08-30 the project's new
   * billing account had an unfunded Gemini prepay balance, so every call
   * returned `429 RESOURCE_EXHAUSTED` / "Your prepayment credits are
   * depleted". That fell to `PHOTO_ANALYZE_FAILED`, so the app told users
   * "Couldn't read that photo. Try another angle." for five days — blaming the
   * photograph and prescribing the one action guaranteed not to work. That is
   * the same defect the 2026-08-23 rewrite fixed for quota, arriving through a
   * door that fix did not cover.
   */
  PHOTO_PROVIDER_UNAVAILABLE = "PHOTO_PROVIDER_UNAVAILABLE",
}
