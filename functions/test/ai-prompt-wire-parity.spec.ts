import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `functions/src/ai-prompt-wire.ts` is a byte-for-byte copy of
 * `packages/core/src/ai-prompt-wire.ts` (`functions/` is not a workspace and
 * cannot import core, ADR-0012). The app BUILDS requests with the core copy
 * and the server VALIDATES and RENDERS them with this one, so any drift is a
 * request the server rejects or a prompt that differs from what core's tests
 * pin. Byte equality, not behavioural sampling: the file is small and has no
 * imports, so "the same file" is both the strongest and the cheapest check.
 *
 * Fix a failure by editing the core copy and copying it over:
 *   cp packages/core/src/ai-prompt-wire.ts functions/src/ai-prompt-wire.ts
 */
describe("ai-prompt-wire mirror parity", () => {
  it("is byte-identical to the packages/core source", () => {
    const core = readFileSync(join(__dirname, "../../packages/core/src/ai-prompt-wire.ts"), "utf8");
    const mirror = readFileSync(join(__dirname, "../src/ai-prompt-wire.ts"), "utf8");
    expect(mirror).toBe(core);
  });
});
