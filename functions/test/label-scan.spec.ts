/**
 * The nutrition-label scan (`{ mode: "label" }` on `analyzePhoto`, 2026-11-20).
 *
 * Two things are pinned. The SANITISER: the model is trusted to transcribe a
 * printed panel, so anything out of range is dropped, never clamped into a
 * number that looks right, and a label that disagrees with its own macros is
 * flagged. And the GUARDS: the label read spends the meal scan's quota slot
 * and ceiling unit — one image, kind `photo` — and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCaller = vi.fn();
const withCostGuards = vi.fn();
const generateContent = vi.fn();
const recordAiUsage = vi.fn();

vi.mock("../src/init", () => ({
  callerAccess: { resolveCaller: (...a: unknown[]) => resolveCaller(...a) },
  withCostGuards: (...a: unknown[]) => withCostGuards(...a),
  dailyQuota: { limitFor: () => 3 },
  db: {},
  geminiApiKey: { value: () => "test" },
}));
vi.mock("../src/usda-db", () => ({ loadFoods: () => [] }));
vi.mock("../src/gemini-client", () => ({
  GEMINI_MODEL: "test-model",
  getGeminiClient: () => ({ models: { generateContent: (...a: unknown[]) => generateContent(...a) } }),
}));
vi.mock("../src/ai-usage", () => ({
  recordAiUsage: (...a: unknown[]) => recordAiUsage(...a),
  usageFromMetadata: () => ({}),
}));

import { analyzePhoto } from "../src/analyze-photo";
import { LABEL_PROMPT, sanitizeLabel } from "../src/label-scan";

type RunArg = Parameters<typeof analyzePhoto.run>[0];
const call = (data: unknown) =>
  analyzePhoto.run({ data, auth: { uid: "u1", token: {} }, rawRequest: {}, acceptsStreaming: false } as unknown as RunArg);

const printed = {
  found: true,
  name: "Greek Yogurt, Plain",
  brand: "Kirkland",
  servingText: "3/4 cup (170g)",
  servingGrams: 170,
  calories: 100,
  protein: 18,
  carbs: 6,
  fat: 0,
};

describe("sanitizeLabel", () => {
  it("keeps a clean panel as printed", () => {
    expect(sanitizeLabel(printed)).toEqual({
      name: "Greek Yogurt, Plain",
      brand: "Kirkland",
      servingText: "3/4 cup (170g)",
      servingGrams: 170,
      calories: 100,
      protein: 18,
      carbs: 6,
      fat: 0,
    });
  });

  it("is null when the model found no panel, or no calories", () => {
    expect(sanitizeLabel({ ...printed, found: false })).toBeNull();
    expect(sanitizeLabel({ ...printed, calories: null })).toBeNull();
    expect(sanitizeLabel(null)).toBeNull();
    expect(sanitizeLabel("a label")).toBeNull();
  });

  it("drops a value it cannot trust instead of clamping it", () => {
    const out = sanitizeLabel({ ...printed, protein: -3, carbs: 9000, fat: "2", servingGrams: 0 });
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty("protein");
    expect(out).not.toHaveProperty("carbs");
    expect(out).not.toHaveProperty("fat");
    expect(out).not.toHaveProperty("servingGrams");
    expect(sanitizeLabel({ ...printed, calories: 99_999 })).toBeNull();
  });

  it("keeps a missing macro missing — not printed is not zero", () => {
    const out = sanitizeLabel({ ...printed, fat: null });
    expect(out).not.toHaveProperty("fat");
    expect(out?.protein).toBe(18);
  });

  it("trims and bounds the words", () => {
    const out = sanitizeLabel({ ...printed, name: `  ${"x".repeat(300)}  `, brand: "  ", servingText: " 1  bar\n(60g) " });
    expect(out?.name).toHaveLength(100);
    expect(out).not.toHaveProperty("brand");
    expect(out?.servingText).toBe("1 bar (60g)");
  });

  it("flags calories that disagree with the label's own macros", () => {
    // 18 g protein + 6 g carbs is ~96 kcal: a "1000" is a misread digit.
    expect(sanitizeLabel({ ...printed, calories: 1000 })?.check).toBe(true);
    expect(sanitizeLabel(printed)).not.toHaveProperty("check");
    // Honest rounding and fibre stay unflagged: 190 kcal printed, 201 from macros.
    expect(sanitizeLabel({ ...printed, calories: 190, protein: 21, carbs: 22, fat: 3.2 })).not.toHaveProperty("check");
  });

  it("flags a serving lighter than the macros inside it", () => {
    expect(sanitizeLabel({ ...printed, servingGrams: 10 })?.check).toBe(true);
  });
});

describe('analyzePhoto, mode "label"', () => {
  const markBilled = vi.fn();

  beforeEach(() => {
    resolveCaller.mockReset().mockResolvedValue({ uid: "u1", tier: "free", unlimited: false });
    withCostGuards.mockReset().mockImplementation(async (_opts: unknown, work: (ctx: unknown) => unknown) =>
      work({ reservation: { remaining: 2 }, markBilled }),
    );
    generateContent.mockReset().mockResolvedValue({ text: JSON.stringify(printed), usageMetadata: { promptTokenCount: 400 } });
    recordAiUsage.mockReset();
    markBilled.mockReset();
  });

  it("reads the label behind the photo scan's own guards: one slot, one image", async () => {
    const out = await call({ photoBase64: "AAAA", mode: "label", locale: "en" });
    expect(out).toEqual({ label: sanitizeLabel(printed), photosRemaining: 2 });
    expect(withCostGuards).toHaveBeenCalledTimes(1);
    expect(withCostGuards.mock.calls[0][0]).toMatchObject({ kind: "photo", recordUnits: 1 });
    expect(markBilled).toHaveBeenCalledTimes(1);
    expect(recordAiUsage.mock.calls[0][1]).toMatchObject({ kind: "photo", images: 1 });
  });

  it("sends the one image and the transcription prompt, at temperature 0", async () => {
    await call({ photoBase64: "AAAA", mode: "label" });
    const req = generateContent.mock.calls[0][0] as { contents: { parts: unknown[] }[]; config: { temperature: number } };
    expect(req.contents[0].parts).toEqual([{ inlineData: { mimeType: "image/jpeg", data: "AAAA" } }, { text: LABEL_PROMPT }]);
    expect(req.config.temperature).toBe(0);
    expect(LABEL_PROMPT).toMatch(/Never estimate/);
  });

  it("refuses a second photo before anything is charged", async () => {
    await expect(call({ photosBase64: ["AAAA", "BBBB"], mode: "label" })).rejects.toMatchObject({ details: { code: "PHOTO_TOO_LARGE" } });
    expect(withCostGuards).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("answers label: null for a photo with no panel — a spent slot, not an error", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...printed, found: false, calories: null }) });
    expect(await call({ photoBase64: "AAAA", mode: "label" })).toEqual({ label: null, photosRemaining: 2 });
    expect(markBilled).toHaveBeenCalledTimes(1);
  });

  it("answers label: null for an answer that is not JSON", async () => {
    generateContent.mockResolvedValue({ text: "I cannot read this." });
    expect(await call({ photoBase64: "AAAA", mode: "label" })).toEqual({ label: null, photosRemaining: 2 });
  });

  it("says the provider refused, not that the photo was bad, when it did", async () => {
    generateContent.mockRejectedValue(Object.assign(new Error("quota"), { status: 429 }));
    await expect(call({ photoBase64: "AAAA", mode: "label" })).rejects.toMatchObject({ details: { code: "PHOTO_PROVIDER_UNAVAILABLE" } });
    expect(markBilled).not.toHaveBeenCalled();
  });

  it("without the mode, a request is the meal scan it always was", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ items: [], description: "", confidence: "low" }) });
    await call({ photoBase64: "AAAA" }).catch(() => undefined);
    const req = generateContent.mock.calls[0][0] as { contents: { parts: { text?: string }[] }[] };
    expect(req.contents[0].parts.some((p) => p.text === LABEL_PROMPT)).toBe(false);
  });
});
