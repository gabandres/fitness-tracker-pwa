import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  USAGE_COUNT_MAX,
  USAGE_EVENTS,
  usageCountMax,
} from "../../packages/core/src/usage-events";
import {
  BODY_FAT_PCT_BOUNDS,
  MEASUREMENT_BOUNDS_IN,
} from "../../packages/core/src/measurement-bounds";
import { BODY_FAT_METHODS } from "../../packages/core/src/types";

/**
 * `firestore.rules` hand-copies three lists out of `packages/core`, and until
 * this file nothing held them together:
 *
 *   - the usage-event catalogue (`USAGE_EVENTS`) → `usageEventFields()` and
 *     one validator line per event in `validUsageDoc`;
 *   - the measured body-fat band (`BODY_FAT_PCT_BOUNDS`) → `isValidMeasurement`;
 *   - the body-fat method enum (`BODY_FAT_METHODS`) → `isValidMeasurement`.
 *
 * The rules cannot import TypeScript, so the copy is unavoidable; what is
 * avoidable is the copy drifting silently. And drift here does not crash —
 * an event the client emits but the rules do not list gets the WHOLE daily
 * flush rejected (`hasOnly` validates the doc as a whole, so one unknown
 * counter loses every other counter that day), and a band the client allows
 * but the rules do not lands as a save that fails on device with nothing in
 * any test going red. `usage-events.ts` says adding an event means touching
 * "here, the rules, and the rules test"; the rules test only exercises the
 * events someone remembered to write a case for. This is the check that sees
 * all of them.
 *
 * Source-level and emulator-free, like `gdpr-collection-parity.spec.ts`: the
 * property is a fact about two files, not about a running Firestore. The
 * emulator suite (`rules/firestore-rules.spec.ts`) proves the rules BEHAVE as
 * written; this proves they are written to the same numbers as core.
 */

const RULES = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../firestore.rules"),
  "utf8",
);

/** Body of a rules `function name(...) { ... }`, up to its closing brace at
 *  the function's own indent. Throws (rather than returning "") so a renamed
 *  function fails loudly instead of making every assertion vacuously pass. */
function rulesFunctionBody(name: string): string {
  const lines = RULES.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^\\s*function ${name}\\(`).test(l));
  if (start < 0) throw new Error(`function ${name}() not found in firestore.rules`);
  const indent = /^\s*/.exec(lines[start])![0];
  const end = lines.findIndex((l, i) => i > start && l === `${indent}}`);
  if (end < 0) throw new Error(`no closing brace for ${name}() at its indent`);
  return lines.slice(start + 1, end).join("\n");
}

/** Every single-quoted string literal in a chunk of rules source. */
function quoted(src: string): string[] {
  return [...src.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe("usage events — firestore.rules mirrors the core catalogue", () => {
  const allowList = quoted(rulesFunctionBody("usageEventFields"));
  const validator = rulesFunctionBody("validUsageDoc");

  it("finds the allow-list at all", () => {
    // Guards the parse: an empty list would make the set checks below pass
    // against an empty catalogue's worth of nothing.
    expect(allowList.length).toBeGreaterThan(10);
  });

  it("allows every event core can emit", () => {
    // Core → rules: an event missing here gets the whole day's flush rejected.
    const missing = USAGE_EVENTS.filter((e) => !allowList.includes(e));
    expect(missing, `in USAGE_EVENTS but not usageEventFields(): ${missing.join(", ")}`).toEqual([]);
  });

  it("allows nothing core does not emit", () => {
    // Rules → core. "Vice versa" is the right direction here, not a nicety:
    // the list is closed on purpose (usage-events.ts — "that friction is the
    // feature"), so a rules-only field is a counter no client writes and no
    // admin chart reads, i.e. a widening of a privacy-sensitive surface with
    // nothing on the other end. Identity fields (uid/day/platform/updatedAt)
    // are concatenated separately in validUsageDoc, not part of this list.
    const extra = allowList.filter((f) => !(USAGE_EVENTS as readonly string[]).includes(f));
    expect(extra, `in usageEventFields() but not USAGE_EVENTS: ${extra.join(", ")}`).toEqual([]);
  });

  it("lists each event exactly once", () => {
    expect(new Set(allowList).size).toBe(allowList.length);
    expect(allowList.length).toBe(USAGE_EVENTS.length);
  });

  it("validates every allowed event, with the cap core clamps to", () => {
    // A field in the hasOnly list with no validator line is accepted with ANY
    // value — a string, a map, a negative — which is the hole the per-field
    // lines exist to close. And the cap must equal core's clamp: a client
    // clamp ABOVE the rule's cap has the whole daily flush rejected.
    const countCap = Number(
      /function validUsageCount[\s\S]*?<=\s*(\d+)\)/.exec(RULES)?.[1],
    );
    const secondsCap = Number(
      /function validUsageSeconds[\s\S]*?<=\s*(\d+)\)/.exec(RULES)?.[1],
    );
    expect(countCap).toBe(USAGE_COUNT_MAX);

    for (const event of USAGE_EVENTS) {
      const counted = validator.includes(`validUsageCount(d, '${event}')`);
      const timed = validator.includes(`validUsageSeconds(d, '${event}')`);
      expect(counted !== timed, `${event}: exactly one validator line, found ${+counted + +timed}`).toBe(true);
      expect(timed ? secondsCap : countCap, `${event}: rule cap vs usageCountMax`).toBe(
        usageCountMax(event),
      );
    }
  });

  it("covers composition_view — the 2026-10-04 addition", () => {
    expect(allowList).toContain("composition_view");
    expect(validator).toContain("validUsageCount(d, 'composition_view')");
  });
});

describe("measurements — firestore.rules mirrors the core bounds", () => {
  const body = rulesFunctionBody("isValidMeasurement");

  it("bounds bodyFatPct to BODY_FAT_PCT_BOUNDS, inclusive", () => {
    const m = /data\.bodyFatPct is number && data\.bodyFatPct >= ([\d.]+) && data\.bodyFatPct <= ([\d.]+)/.exec(
      body,
    );
    expect(m, "bodyFatPct band not found in isValidMeasurement").not.toBeNull();
    expect([Number(m![1]), Number(m![2])]).toEqual([...BODY_FAT_PCT_BOUNDS]);
  });

  it("enumerates bodyFatMethod as exactly BODY_FAT_METHODS", () => {
    const m = /data\.bodyFatMethod in \[([^\]]*)\]/.exec(body);
    expect(m, "bodyFatMethod enum not found in isValidMeasurement").not.toBeNull();
    expect(quoted(m![1])).toEqual([...BODY_FAT_METHODS]);
  });

  it("allows the pair in the closed key set", () => {
    const hasOnly = /data\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(body);
    expect(hasOnly, "hasOnly list not found in isValidMeasurement").not.toBeNull();
    const keys = quoted(hasOnly![1]);
    expect(keys).toContain("bodyFatPct");
    expect(keys).toContain("bodyFatMethod");
  });

  it("bands every tape field to MEASUREMENT_BOUNDS_IN", () => {
    // The rule's own comment says "mirroring MEASUREMENT_BOUNDS_IN — keep the
    // two in step"; this is what keeps them in step. Same function, same
    // failure shape as the body-fat band.
    for (const [field, [lo, hi]] of Object.entries(MEASUREMENT_BOUNDS_IN)) {
      const m = new RegExp(
        `data\\.${field} is number && data\\.${field} >= ([\\d.]+) && data\\.${field} <= ([\\d.]+)`,
      ).exec(body);
      expect(m, `${field} band not found in isValidMeasurement`).not.toBeNull();
      expect([Number(m![1]), Number(m![2])], `${field} band`).toEqual([lo, hi]);
    }
  });
});
