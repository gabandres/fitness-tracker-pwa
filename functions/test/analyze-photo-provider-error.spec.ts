/**
 * Telling "the provider refused us" apart from "the photograph is unreadable".
 *
 * This classifier exists because of a five-day outage. From 2026-08-30 the
 * project's Gemini prepay balance was unfunded, so every call returned
 * `429 RESOURCE_EXHAUSTED` / "Your prepayment credits are depleted". That fell
 * to `PHOTO_ANALYZE_FAILED`, which the app renders as "Couldn't read that
 * photo. Try another angle." — so for five days Ignia blamed users'
 * photographs for a billing problem and told them to retake the picture, the
 * one action that could not work.
 *
 * The fixtures below are the SHAPES actually observed, not invented ones: the
 * first is the error the `@google/genai` SDK threw in production, copied from
 * the Cloud Functions log.
 */
import { describe, expect, it } from "vitest";
import { isProviderExhausted } from "../src/analyze-photo";

describe("isProviderExhausted", () => {
  it("catches the exact production error from the 2026-08-30 outage", () => {
    // Logged verbatim by analyzePhoto. `status` is a number on the ApiError.
    const err = Object.assign(
      new Error(
        '{"error":{"code":429,"message":"Your prepayment credits are depleted.",' +
          '"status":"RESOURCE_EXHAUSTED"}}',
      ),
      { status: 429 },
    );
    expect(isProviderExhausted(err)).toBe(true);
  });

  it("catches ordinary provider rate limiting too", () => {
    // A different cause, the same truth for the user: not their photo, and
    // retaking it does not help. One message covers both deliberately.
    expect(isProviderExhausted({ status: "RESOURCE_EXHAUSTED" })).toBe(true);
    expect(isProviderExhausted({ code: 429 })).toBe(true);
  });

  it("reads the nested JSON body when the SDK does not lift the status", () => {
    expect(isProviderExhausted({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } })).toBe(true);
  });

  it("does NOT match a genuinely unreadable photo", () => {
    // The case where "try another angle" is honest advice and must survive.
    expect(isProviderExhausted(new Error("no food detected"))).toBe(false);
    expect(isProviderExhausted({ status: 400 })).toBe(false);
    expect(isProviderExhausted({ status: 500 })).toBe(false);
  });

  it("never matches on the provider's wording", () => {
    // Google's message is marketing copy pointing at AI Studio and is not ours
    // to depend on; a string match here would break silently on a reword.
    expect(isProviderExhausted(new Error("Your prepayment credits are depleted."))).toBe(false);
  });

  it("survives the shapes a catch block really receives", () => {
    expect(isProviderExhausted(null)).toBe(false);
    expect(isProviderExhausted(undefined)).toBe(false);
    expect(isProviderExhausted("429")).toBe(false);
    expect(isProviderExhausted(429)).toBe(false);
  });
});
