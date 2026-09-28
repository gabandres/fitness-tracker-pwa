import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mirrorWeightsFromEdges } from "../src/public-profile";

/**
 * The public-profile mirror's weights come from the OLDEST and NEWEST
 * `dailyWeights` docs, whose ID is the local `YYYY-MM-DD` key and whose body is
 * `{ weight }` — no `date` field exists (`firestore.rules` allows `weight`
 * alone). `buildMirrorFromProfile` ordered both queries on `date` since the
 * feature shipped, and Firestore silently omits documents lacking the ordered
 * field, so every public profile read "—" for start and current weight.
 * `weekly-digest.ts` fixed the identical bug in its own queries on 2026-08-23;
 * this file is the copy nobody re-read.
 */

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/public-profile.ts"),
  "utf8",
);

describe("mirrorWeightsFromEdges", () => {
  it("reads start and current weight off the two edge docs", () => {
    const r = mirrorWeightsFromEdges(
      { id: "2026-06-01", weight: 190.2 },
      { id: "2026-08-20", weight: 181.6 },
    );
    expect(r.startWeight).toBe(190.2);
    expect(r.currentWeight).toBe(181.6);
    expect(r.startedAt?.toDate().toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("is null across the board when there are no weigh-ins", () => {
    expect(mirrorWeightsFromEdges(null, null)).toEqual({
      startWeight: null,
      currentWeight: null,
      startedAt: null,
    });
  });

  it("does not invent a start date from a malformed doc id, nor a weight from junk", () => {
    const r = mirrorWeightsFromEdges({ id: "legacy", weight: "180" }, { id: "2026-08-20", weight: NaN });
    expect(r.startedAt).toBeNull();
    expect(r.startWeight).toBeNull();
    expect(r.currentWeight).toBeNull();
  });
});

describe("buildMirrorFromProfile queries dailyWeights by document id", () => {
  it("never orders dailyWeights on a `date` field the docs do not carry", () => {
    // Source-level on purpose: the defect is a query shape, and the only way
    // to see it at runtime is an emulator and a user with weigh-ins.
    expect(SRC).not.toMatch(/dailyWeights`\)\s*\.orderBy\("date"/);
    expect(SRC).toMatch(/orderBy\(FieldPath\.documentId\(\), "asc"\)/);
    expect(SRC).toMatch(/orderBy\(FieldPath\.documentId\(\), "desc"\)/);
  });
});
