/**
 * The scan screen's warm-up call (`{ warmup: true }`) boots an instance and
 * nothing else.
 *
 * The property that matters is what it does NOT touch: no rate-limit stamp
 * (a stamp would make the user's real scan, seconds later, fail with
 * PHOTO_RATE_LIMITED), no spend ceiling, no quota slot, no model call. Every
 * one of those sits behind `callerAccess.resolveCaller` / `withCostGuards`,
 * so both are spies here and must stay uncalled.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCaller = vi.fn();
const withCostGuards = vi.fn();
const loadFoods = vi.fn(() => []);
const getGeminiClient = vi.fn(() => ({}));

vi.mock("../src/init", () => ({
  callerAccess: { resolveCaller: (...a: unknown[]) => resolveCaller(...a) },
  withCostGuards: (...a: unknown[]) => withCostGuards(...a),
  dailyQuota: { limitFor: () => 3 },
  db: {},
  geminiApiKey: { value: () => "test" },
}));
vi.mock("../src/usda-db", () => ({ loadFoods: () => loadFoods() }));
vi.mock("../src/gemini-client", () => ({
  GEMINI_MODEL: "test-model",
  getGeminiClient: () => getGeminiClient(),
}));

import { analyzePhoto, isWarmupRequest } from "../src/analyze-photo";

type RunArg = Parameters<typeof analyzePhoto.run>[0];
const call = (data: unknown, auth: { uid: string } | null = { uid: "u1" }) =>
  analyzePhoto.run({
    data,
    auth: auth ? { uid: auth.uid, token: {} } : undefined,
    rawRequest: {},
    acceptsStreaming: false,
  } as unknown as RunArg);

beforeEach(() => {
  resolveCaller.mockReset();
  withCostGuards.mockReset();
  loadFoods.mockClear();
  getGeminiClient.mockClear();
});

describe("isWarmupRequest", () => {
  it("is only the literal `warmup: true`", () => {
    expect(isWarmupRequest({ warmup: true })).toBe(true);
    // A truthy non-boolean is not a warm-up: it falls through to a normal
    // (and, with no photo, rejected) scan rather than skipping the guards.
    expect(isWarmupRequest({ warmup: "true" })).toBe(false);
    expect(isWarmupRequest({ warmup: 1 })).toBe(false);
    expect(isWarmupRequest({ photoBase64: "x" })).toBe(false);
    expect(isWarmupRequest(null)).toBe(false);
    expect(isWarmupRequest(undefined)).toBe(false);
  });
});

describe("analyzePhoto warm-up", () => {
  it("returns at once and records nothing — no rate limit, no guard, no model", async () => {
    await expect(call({ warmup: true })).resolves.toEqual({ warm: true });
    expect(resolveCaller).not.toHaveBeenCalled();
    expect(withCostGuards).not.toHaveBeenCalled();
  });

  it("pre-pays the instance's lazy loads, so the real scan finds them ready", async () => {
    await call({ warmup: true });
    expect(loadFoods).toHaveBeenCalledTimes(1);
    expect(getGeminiClient).toHaveBeenCalledTimes(1);
  });

  it("still requires a signed-in caller", async () => {
    await expect(call({ warmup: true }, null)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(loadFoods).not.toHaveBeenCalled();
    expect(resolveCaller).not.toHaveBeenCalled();
  });

  it("never fails on a preparation error — the real call just pays as before", async () => {
    loadFoods.mockImplementationOnce(() => {
      throw new Error("disk");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(call({ warmup: true })).resolves.toEqual({ warm: true });
    warn.mockRestore();
  });

  it("leaves an ordinary request on the guarded path", async () => {
    resolveCaller.mockRejectedValueOnce(new Error("guarded"));
    await expect(call({ photoBase64: "abc" })).rejects.toThrow("guarded");
    expect(resolveCaller).toHaveBeenCalledTimes(1);
  });
});
