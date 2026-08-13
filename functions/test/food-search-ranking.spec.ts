import { describe, expect, it } from "vitest";
import { mergeHits, qualityTier } from "../src/food-ranking";

/**
 * What reaches the top of a food search.
 *
 * The merge used to interleave strictly round-robin, which handed position 2 to
 * a crowd-sourced entry on every single query — the slot a user taps without
 * reading. These tests pin the replacement: quality first, but never at the
 * cost of losing branded coverage entirely, because that is the half of the
 * catalogue OFF is there for.
 */

const usda = (id: string, dataType: string, over: Partial<{ suspect: boolean }> = {}) => ({
  source: "fdc" as const,
  id,
  description: `usda-${id}`,
  dataType,
  ...over,
});

const off = (id: string, over: Partial<{ suspect: boolean }> = {}) => ({
  source: "off" as const,
  id,
  description: `off-${id}`,
  dataType: "OFF",
  ...over,
});

describe("qualityTier", () => {
  it("ranks a lab assay above curated above crowd data", () => {
    expect(qualityTier(usda("1", "foundation_food"))).toBeGreaterThan(
      qualityTier(usda("2", "sr_legacy_food")),
    );
    expect(qualityTier(usda("2", "sr_legacy_food"))).toBeGreaterThan(qualityTier(off("3")));
  });

  it("demotes a flagged entry below a clean one from the same source", () => {
    expect(qualityTier(off("1"))).toBeGreaterThan(qualityTier(off("2", { suspect: true })));
    expect(qualityTier(usda("1", "sr_legacy_food"))).toBeGreaterThan(
      qualityTier(usda("2", "sr_legacy_food", { suspect: true })),
    );
  });
});

describe("mergeHits", () => {
  it("no longer hands position 2 to a crowd entry when better rows matched", () => {
    const fdc = ["1", "2", "3", "4", "5"].map((i) => usda(i, "foundation_food"));
    const out = mergeHits(fdc, [off("x")], 6);
    expect(out[0].source).toBe("fdc");
    expect(out[1].source).toBe("fdc");
  });

  it("still gives community results a place in the page", () => {
    // The branded half of the catalogue only exists in OFF — a store-brand
    // yogurt has no USDA row — so purity-first must not bury it.
    const fdc = Array.from({ length: 20 }, (_, i) => usda(String(i), "sr_legacy_food"));
    const offHits = Array.from({ length: 5 }, (_, i) => off(String(i)));
    const out = mergeHits(fdc, offHits, 10);
    expect(out.filter((h) => h.source === "off").length).toBeGreaterThanOrEqual(4);
  });

  it("preserves each source's own ordering inside a tier", () => {
    const fdc = ["a", "b", "c"].map((i) => usda(i, "sr_legacy_food"));
    const out = mergeHits(fdc, [], 3);
    expect(out.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("fills the page from whatever is left when one source runs dry", () => {
    const out = mergeHits([], [off("1"), off("2"), off("3")], 3);
    expect(out).toHaveLength(3);
  });

  it("de-dupes the same product reported by both databases", () => {
    const a = { ...usda("1", "sr_legacy_food"), description: "Greek Yogurt", brand: "Fage" };
    const b = { ...off("2"), description: "greek yogurt", brand: "fage" };
    const out = mergeHits([a], [b], 5);
    expect(out).toHaveLength(1);
    // The curated copy is the one that survives.
    expect(out[0].source).toBe("fdc");
  });

  it("respects the size cap", () => {
    const fdc = Array.from({ length: 30 }, (_, i) => usda(String(i), "sr_legacy_food"));
    expect(mergeHits(fdc, [off("x")], 8)).toHaveLength(8);
  });

  it("sinks a flagged crowd entry below a clean one", () => {
    const out = mergeHits([], [off("bad", { suspect: true }), off("good")], 2);
    expect(out.map((h) => h.id)).toEqual(["good", "bad"]);
  });
});
